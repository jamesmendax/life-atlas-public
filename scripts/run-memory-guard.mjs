import { spawn } from "node:child_process";
import { lstatSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const MEMORY_GUARD_LIMIT_MIB = 12288;
export const MEMORY_GUARD_DEFAULT_TIMEOUT_SECONDS = 600;
export const MEMORY_GUARD_ROOT = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const GUARD_SCRIPT = fileURLToPath(new URL("./run-memory-guard.py", import.meta.url));
const GUARD_FAILURE_EXIT = 125;
const USAGE = "npm run guard:memory -- [--memory-mib 64..12288] [--timeout 1..3600] [--output <new-json-file>] -- <absolute-executable|node|python> [arguments...]";
const PYTHON_SETUP = "Set LIFE_ATLAS_GUARD_PYTHON to the absolute physical path of a Python executable outside AppData.";

function requireAbsoluteExecutable(executable) {
  if (typeof executable !== "string" || executable.includes("\0") ||
      !/^(?:[a-z]:[\\/]|[\\/]{2}[^\\/]+[\\/][^\\/]+[\\/])/i.test(executable) ||
      /^[\\/]{2}[?.][\\/]/.test(executable)) {
    throw new Error("A fully absolute executable path is required; node and python are supported aliases.");
  }
}

function integerOption(value, option, minimum, maximum) {
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new Error(`${option} must be an integer from ${minimum} through ${maximum}.`);
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw new Error(`${option} must be an integer from ${minimum} through ${maximum}.`);
  }
  return number;
}

export function parseMemoryGuardArgs(argv, {
  nodeExecutable = process.execPath,
  pythonExecutable = process.env.LIFE_ATLAS_GUARD_PYTHON,
} = {}) {
  const separator = argv.indexOf("--");
  if (separator < 0 || separator === argv.length - 1) {
    throw new Error(`Separate guard options and a command with --. Usage: ${USAGE}`);
  }
  let memoryMiB = MEMORY_GUARD_LIMIT_MIB;
  let timeoutSeconds = MEMORY_GUARD_DEFAULT_TIMEOUT_SECONDS;
  let output;
  const seen = new Set();
  for (let index = 0; index < separator; index += 2) {
    const option = argv[index];
    if (!["--memory-mib", "--timeout", "--output"].includes(option)) {
      throw new Error(`Unknown guard option. Usage: ${USAGE}`);
    }
    if (seen.has(option) || index + 1 >= separator) {
      throw new Error(`${option} requires one value and may be specified only once.`);
    }
    seen.add(option);
    const value = argv[index + 1];
    if (option === "--memory-mib") memoryMiB = integerOption(value, option, 64, MEMORY_GUARD_LIMIT_MIB);
    if (option === "--timeout") timeoutSeconds = integerOption(value, option, 1, 3600);
    if (option === "--output") {
      if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
        throw new Error("--output requires a nonempty file path.");
      }
      output = path.resolve(MEMORY_GUARD_ROOT, value);
    }
  }
  const command = argv.slice(separator + 1);
  if (command[0] === "node") command[0] = nodeExecutable;
  if (command[0] === "python") {
    if (!pythonExecutable) throw new Error(PYTHON_SETUP);
    command[0] = pythonExecutable;
  }
  requireAbsoluteExecutable(command[0]);
  if (command.some((argument) => typeof argument !== "string" || argument.includes("\0"))) {
    throw new Error("Command arguments must be strings without null bytes.");
  }
  return { memoryMiB, timeoutSeconds, output, command };
}

function validatePhysicalExecutable(executable) {
  requireAbsoluteExecutable(executable);
  if (/[\\/]AppData(?:[\\/]|$)/i.test(executable)) {
    throw new Error("Executable paths under AppData are not permitted.");
  }
  const absolute = path.resolve(executable);
  const root = path.parse(absolute).root;
  let current = root;
  let entry;
  for (const segment of absolute.slice(root.length).split(/[\\/]/)) {
    current = path.join(current, segment);
    entry = lstatSync(current);
    if (entry.isSymbolicLink()) {
      throw new Error("Use an existing physical executable path without symbolic links or junctions.");
    }
  }
  if (!entry?.isFile()) throw new Error("Executable paths must name existing physical files.");
  return absolute;
}

export async function launchMemoryGuard(argv, {
  environment = process.env,
  nodeExecutable = process.execPath,
  spawnProcess = spawn,
  validateExecutable = validatePhysicalExecutable,
  writeError = (message) => console.error(message),
} = {}) {
  try {
    const selectedPython = environment.LIFE_ATLAS_GUARD_PYTHON;
    const parsed = parseMemoryGuardArgs(argv, { nodeExecutable, pythonExecutable: selectedPython });
    if (!selectedPython) throw new Error(PYTHON_SETUP);
    requireAbsoluteExecutable(selectedPython);
    const pythonExecutable = validateExecutable(selectedPython);
    const commandExecutable = validateExecutable(parsed.command[0]);
    const args = [GUARD_SCRIPT, "--memory-mib", String(parsed.memoryMiB), "--timeout", String(parsed.timeoutSeconds)];
    if (parsed.output !== undefined) args.push("--output", parsed.output);
    args.push("--cwd", MEMORY_GUARD_ROOT, "--", commandExecutable, ...parsed.command.slice(1));
    return await new Promise((resolve, reject) => {
      const child = spawnProcess(pythonExecutable, args, {
        cwd: MEMORY_GUARD_ROOT,
        stdio: "inherit",
        windowsHide: true,
        shell: false,
      });
      child.once("error", reject);
      child.once("close", (code, signal) => {
        resolve(!signal && Number.isInteger(code) && code >= 0 && code <= 255 ? code : GUARD_FAILURE_EXIT);
      });
    });
  } catch (error) {
    writeError(`[guard:memory] ${error instanceof Error ? error.message : "Guard startup failed."}`);
    return GUARD_FAILURE_EXIT;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  if (argv.length === 1 && argv[0] === "--help") console.log(`${USAGE}\n${PYTHON_SETUP}`);
  else process.exitCode = await launchMemoryGuard(argv);
}
