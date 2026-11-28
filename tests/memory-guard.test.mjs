import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { EventEmitter } from "node:events";
import { fileURLToPath } from "node:url";
import {
  MEMORY_GUARD_LIMIT_MIB,
  MEMORY_GUARD_DEFAULT_TIMEOUT_SECONDS,
  MEMORY_GUARD_ROOT,
  parseMemoryGuardArgs,
  launchMemoryGuard,
} from "../scripts/run-memory-guard.mjs";

const nodeExecutable = "D:/life-atlas-guard-tools/node.exe";
const pythonExecutable = "D:/life-atlas-guard-tools/python.exe";
const parserOptions = { nodeExecutable, pythonExecutable };
const guardScript = fileURLToPath(new URL("../scripts/run-memory-guard.py", import.meta.url));

async function injectedLaunch(argv, {
  code = 0,
  signal = null,
  spawnError,
  throwError,
  pythonOverride = pythonExecutable,
  validateExecutable = (executable) => executable,
} = {}) {
  const launches = [];
  const validated = [];
  const errors = [];
  const exitCode = await launchMemoryGuard(argv, {
    environment: { LIFE_ATLAS_GUARD_PYTHON: pythonOverride },
    nodeExecutable,
    validateExecutable: (executable) => {
      validated.push(executable);
      return validateExecutable(executable);
    },
    spawnProcess: (executable, args, options) => {
      launches.push({ executable, args, options });
      if (throwError) throw throwError;
      const child = new EventEmitter();
      queueMicrotask(() => {
        if (spawnError) child.emit("error", spawnError);
        child.emit("close", code, signal);
      });
      return child;
    },
    writeError: (message) => errors.push(message),
  });
  return { exitCode, launches, validated, errors };
}

test("memory guard defaults to 12 GiB and a bounded timeout", () => {
  const parsed = parseMemoryGuardArgs(["--", "node", "--version"], parserOptions);
  assert.equal(MEMORY_GUARD_LIMIT_MIB, 12 * 1024);
  assert.equal(parsed.memoryMiB, 12288);
  assert.equal(parsed.timeoutSeconds, MEMORY_GUARD_DEFAULT_TIMEOUT_SECONDS);
  assert.equal(parsed.timeoutSeconds, 600);
  assert.equal(parsed.output, undefined);
  assert.deepEqual(parsed.command, [nodeExecutable, "--version"]);
});

test("memory guard accepts a lower 512 MiB cap and 60 second timeout", () => {
  const parsed = parseMemoryGuardArgs(["--memory-mib", "512", "--timeout", "60", "--", nodeExecutable], parserOptions);
  assert.equal(parsed.memoryMiB, 512);
  assert.equal(parsed.timeoutSeconds, 60);
  assert.deepEqual(parsed.command, [nodeExecutable]);
});

test("memory guard rejects limits above 12 GiB before any process launch", async () => {
  for (const value of ["12289", "16384", "999999999999999999999999"]) {
    assert.throws(() => parseMemoryGuardArgs(["--memory-mib", value, "--", "node"], parserOptions), /64 through 12288/);
    const result = await injectedLaunch(["--memory-mib", value, "--", "node"]);
    assert.equal(result.exitCode, 125);
    assert.equal(result.launches.length, 0);
    assert.equal(result.validated.length, 0);
  }
});

test("memory guard rejects invalid memory and timeout options", () => {
  for (const value of ["0", "63", "-1", "512.5", "1e3", "NaN", ""]) {
    assert.throws(() => parseMemoryGuardArgs(["--memory-mib", value, "--", "node"], parserOptions), /64 through 12288/);
  }
  for (const value of ["0", "3601", "-1", "60.5", "Infinity", ""]) {
    assert.throws(() => parseMemoryGuardArgs(["--timeout", value, "--", "node"], parserOptions), /1 through 3600/);
  }
  assert.equal(parseMemoryGuardArgs(["--memory-mib", "64", "--timeout", "3600", "--", "node"], parserOptions).memoryMiB, 64);
});

test("memory guard rejects missing duplicate and unknown options", () => {
  for (const argv of [[], ["node"], ["--"], ["--memory-mib", "--", "node"],
    ["--timeout", "1", "--timeout", "2", "--", "node"], ["--unknown", "1", "--", "node"]]) {
    assert.throws(() => parseMemoryGuardArgs(argv, parserOptions));
  }
  assert.throws(() => parseMemoryGuardArgs(["--output", "", "--", "node"], parserOptions), /nonempty file path/);
});

test("memory guard requires an absolute executable and resolves only approved aliases", () => {
  assert.deepEqual(parseMemoryGuardArgs(["--", pythonExecutable], parserOptions).command, [pythonExecutable]);
  assert.deepEqual(parseMemoryGuardArgs(["--", "python", "-V"], parserOptions).command, [pythonExecutable, "-V"]);
  for (const executable of ["python.exe", "npm", "bin/node.exe", "D:node.exe", "/node.exe", "\\node.exe", "\\\\.\\pipe\\guard"]) {
    assert.throws(() => parseMemoryGuardArgs(["--", executable], parserOptions), /fully absolute/);
  }
});

test("memory guard preserves quotes spaces Chinese and command options literally", async () => {
  const args = ["--eval", 'console.log("中文 空格")', 'literal"quote', "space argument", "$() & | ; > <", "--memory-mib", "50000"];
  const argv = ["--", "node", ...args];
  assert.deepEqual(parseMemoryGuardArgs(argv, parserOptions).command, [nodeExecutable, ...args]);
  assert.equal(argv[1], "node");
  const result = await injectedLaunch(argv);
  assert.equal(result.exitCode, 0);
  assert.equal(result.launches.length, 1);
  assert.deepEqual(result.launches[0].args.slice(result.launches[0].args.indexOf("--") + 1), [nodeExecutable, ...args]);
});

test("memory guard launches physical Python and passes the same app cwd to the native guard", async () => {
  const result = await injectedLaunch(["--", "node", "--version"]);
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.validated, [pythonExecutable, nodeExecutable]);
  assert.equal(result.launches[0].executable, pythonExecutable);
  assert.equal(MEMORY_GUARD_ROOT, path.resolve(fileURLToPath(new URL("../", import.meta.url))));
  assert.deepEqual(result.launches[0].args, [guardScript, "--memory-mib", "12288", "--timeout", "600", "--cwd", MEMORY_GUARD_ROOT, "--", nodeExecutable, "--version"]);
  assert.deepEqual(result.launches[0].options, { cwd: MEMORY_GUARD_ROOT, stdio: "inherit", windowsHide: true, shell: false });
});

test("memory guard resolves output paths against the app root and forwards lower caps", async () => {
  const output = path.resolve(MEMORY_GUARD_ROOT, ".qa/LOCAL-NOTION-001/memory-guard-cli-fixture.json");
  const result = await injectedLaunch(["--memory-mib", "512", "--timeout", "60", "--output", ".qa/LOCAL-NOTION-001/memory-guard-cli-fixture.json", "--", "node"]);
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.launches[0].args, [guardScript, "--memory-mib", "512", "--timeout", "60", "--output", output, "--cwd", MEMORY_GUARD_ROOT, "--", nodeExecutable]);
});

test("memory guard validates explicit Python overrides and executable paths before spawning", async () => {
  const invalidPython = await injectedLaunch(["--", "node"], { pythonOverride: "python.exe" });
  assert.equal(invalidPython.exitCode, 125);
  assert.equal(invalidPython.launches.length, 0);
  const invalidPhysicalPath = await injectedLaunch(["--", "node"], {
    validateExecutable: () => { throw new Error("synthetic physical-path rejection"); },
  });
  assert.equal(invalidPhysicalPath.exitCode, 125);
  assert.equal(invalidPhysicalPath.launches.length, 0);
  assert.match(invalidPhysicalPath.errors[0], /synthetic physical-path rejection/);
});

test("memory guard propagates native memory bug timeout guard failure and command exits", async () => {
  for (const code of [0, 23, 86, 124, 125]) {
    const result = await injectedLaunch(["--", "node"], { code });
    assert.equal(result.exitCode, code);
    assert.equal(result.launches.length, 1);
  }
});

test("memory guard reports spawn errors and indeterminate exits as guard failure", async () => {
  for (const options of [{ spawnError: new Error("synthetic emitted spawn failure") },
    { throwError: new Error("synthetic thrown spawn failure") }, { code: null }, { code: 0, signal: "SIGTERM" }]) {
    const result = await injectedLaunch(["--", "node"], options);
    assert.equal(result.exitCode, 125);
    assert.equal(result.launches.length, 1);
  }
});
