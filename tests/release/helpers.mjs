import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { execFile, execFileSync, spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { BACKUP_COLLECTIONS } from "../../src/backup/format.js";
import { assertAbsolutePath, assertPhysicalPath, ensureDataRootMarker, isPathInside } from "../../electron/main/storage/dataRoot.js";
import { assertTestPath as assertDesktopTestPath, createIsolatedDirectory, REPO_ROOT, selectOwnedTestProcesses, TASK_RUNTIME_ROOT } from "../desktop/helpers.mjs";

export const INSTALL_TEST_NAME = "Life Atlas Install Test";
const children = new WeakSet();
const installedDirectories = new Set();
const processScript = "$records = if ($env:LIFE_ATLAS_RELEASE_PROCESS_IDS) { foreach ($processId in ($env:LIFE_ATLAS_RELEASE_PROCESS_IDS -split ',')) { Get-CimInstance -ClassName Win32_Process -Filter ('ProcessId=' + [int]$processId) } } elseif ($env:LIFE_ATLAS_RELEASE_PROCESS_NAME) { Get-CimInstance -ClassName Win32_Process -Filter ('Name=' + [char]39 + $env:LIFE_ATLAS_RELEASE_PROCESS_NAME + [char]39) } else { Get-CimInstance -ClassName Win32_Process }; [pscustomobject]@{ records = @($records | ForEach-Object { [pscustomobject]@{ pid = [int]$_.ProcessId; parentPid = [int]$_.ParentProcessId; executablePath = $_.ExecutablePath; createdAt = $_.CreationDate.ToUniversalTime().ToString('o'); commandLine = $_.CommandLine } }) } | ConvertTo-Json -Depth 5 -Compress";
const normalizedPath = (value) => path.win32.normalize(value).toLowerCase();
const hasExited = (child) => child.exitCode !== null || child.signalCode !== null;
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const NSIS_POWERSHELL_SYSTEM32 = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
const NSIS_POWERSHELL_SYSWOW64 = "C:\\Windows\\SysWOW64\\WindowsPowerShell\\v1.0\\powershell.exe";
const NSIS_CONHOST_SYSTEM32 = "C:\\Windows\\System32\\conhost.exe";
const NATIVE_BROKER = fileURLToPath(new URL("./native-launcher.py", import.meta.url));
const NATIVE_CREATION_FLAGS = 0x08080404;
const NATIVE_PIPE_LIMIT = 8 * 1024 * 1024;
const NATIVE_SMOKE_CODE = "import sys; sys.stdout.buffer.write(b'native-fast-exit\\n'); sys.stderr.buffer.write(b'native-fast-diagnostic\\n'); sys.exit(7)";
const NATIVE_SMOKE_ARGS = ["-I", "-B", "-c", NATIVE_SMOKE_CODE, "space value", 'quote"value', "trail\\", "中文"];
const NSIS_READONLY_PREFLIGHTS = [
  "if (Get-Command Get-CimInstance -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }",
  "if ((Get-ExecutionPolicy -Scope Process) -eq 'Restricted') { exit 1 } else { exit 0 }",
];
const exactWindowsPath = (actual, expected) => typeof actual === "string" && actual.toLowerCase() === expected.toLowerCase();

function resolveNativePython() {
  const override = process.env.LIFE_ATLAS_RELEASE_PYTHON;
  const uvDirectory = process.env.UV_PYTHON_INSTALL_DIR;
  if (!override && !uvDirectory) throw new Error("Set LIFE_ATLAS_RELEASE_PYTHON to an absolute 64-bit Windows Python path or configure UV_PYTHON_INSTALL_DIR.");
  const executable = assertAbsolutePath(override || path.join(assertAbsolutePath(uvDirectory), "cpython-3.13.14-windows-x86_64-none", "python.exe"));
  if (executable.split(path.sep).some((segment) => segment.toLowerCase() === "appdata")) throw new Error("Native release Python must be outside AppData.");
  return assertPhysicalPath(executable, { allowMissing: false });
}

function nativeCommandLine(executable, args) {
  const quote = (argument, always = false) => {
    const escaped = argument.replace(/(\\*)"/g, (_, backslashes) => `${backslashes.repeat(2)}\\"`);
    return always || !argument || /[ \t]/.test(argument) ? `"${escaped.replace(/(\\+)$/, (_, backslashes) => backslashes.repeat(2))}"` : escaped;
  };
  return [quote(executable, true), ...args.map((argument) => quote(argument))].join(" ");
}

function nativeCreationTime(fileTime, exact = false) {
  assert.ok(typeof fileTime === "string" && /^\d{17,20}$/.test(fileTime), "Native creation FILETIME is unavailable");
  const ticks = BigInt(fileTime) - 116444736000000000n;
  assert.ok(ticks > 0n && ticks < 86400000000000000000n, "Native creation FILETIME is invalid");
  const seconds = ticks / 10000000n;
  const remainder = ticks % 10000000n;
  const prefix = new Date(Number(seconds * 1000n)).toISOString().slice(0, 19);
  const fraction = exact ? remainder.toString().padStart(7, "0") : `${(remainder / 10n).toString().padStart(6, "0")}0`;
  return `${prefix}.${fraction}Z`;
}

function validateNativeIdentity(proof, { brokerPid, brokerPath, executablePath, args, spawnedAt }) {
  const positivePID = (value) => Number.isSafeInteger(value) && value > 0;
  assert.ok(proof && proof.type === "suspended" && proof.broker && proof.target && proof.native, "Native suspended identity is unavailable");
  const { broker, target, native } = proof;
  for (const entry of [broker, target]) {
    assert.ok(positivePID(entry.pid) && positivePID(entry.parentPid), "Native PID or ancestry is invalid");
    assert.equal(entry.createdAt, nativeCreationTime(entry.createdFileTime), "Native creation time changed");
    assert.equal(entry.createdAtExact, nativeCreationTime(entry.createdFileTime, true), "Exact native creation time changed");
    assert.equal(entry.inJob, true, "Native process does not inherit the parent JobObject");
    assert.equal(typeof entry.commandLine, "string", "Native command line is unavailable");
    assert.ok(entry.commandLine.length < 32768 && !/[\0\r\n]/.test(entry.commandLine), "Native command line is invalid");
    assert.ok(Date.parse(entry.createdAt) >= spawnedAt - 1, "Native process PID was reused");
  }
  assert.equal(broker.pid, brokerPid, "Native broker PID changed");
  assert.equal(broker.parentPid, process.pid, "Native broker does not belong to this Node process");
  assert.equal(normalizedPath(broker.executablePath), normalizedPath(brokerPath), "Native broker executable changed");
  assert.deepEqual(broker.args, ["-I", "-B", "-u", NATIVE_BROKER], "Native broker arguments changed");
  assert.ok(target.pid !== broker.pid && target.pid !== process.pid, "Native target PID is not distinct");
  assert.equal(target.parentPid, broker.pid, "Native target does not belong to this broker");
  assert.equal(normalizedPath(target.executablePath), normalizedPath(executablePath), "Native target executable changed");
  assert.deepEqual(target.args, args, "Native target arguments changed");
  assert.equal(target.commandLine, nativeCommandLine(executablePath, args), "Native target command line changed");
  assert.ok(BigInt(target.createdFileTime) >= BigInt(broker.createdFileTime), "Native target predates its broker");
  assert.equal(native.creationFlags, NATIVE_CREATION_FLAGS, "Native launch flags changed or allowed breakaway");
  assert.equal(native.createdSuspended, true, "Native target was not created suspended");
  assert.equal(native.processHandleRetained, true, "Native target process handle is unavailable");
  assert.equal(native.threadHandleRetained, true, "Native primary thread handle is unavailable");
  assert.equal(native.processIdFromHandle, target.pid, "Native process handle PID changed");
  assert.equal(native.threadProcessIdFromHandle, target.pid, "Native primary thread ownership changed");
  assert.ok(positivePID(native.threadIdFromHandle), "Native primary thread ID is unavailable");
  return { pid: target.pid, parentPid: target.parentPid, createdAt: target.createdAt, executablePath: target.executablePath, commandLine: target.commandLine };
}

function nativeProcessChild(executablePath, args, environment, spawnedAt, timeoutMs, { smoke = false } = {}) {
  if (process.platform !== "win32") throw new Error("Native release launch only supports Windows");
  const python = resolveNativePython();
  const brokerFile = assertPhysicalPath(NATIVE_BROKER, { allowMissing: false });
  assert.ok(fs.statSync(python).isFile() && fs.statSync(brokerFile).isFile(), "Native launch facilities are unavailable");
  const child = new EventEmitter();
  child.pid = undefined;
  child.exitCode = null;
  child.signalCode = null;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  const nonce = randomBytes(16).toString("hex");
  const broker = spawn(python, ["-I", "-B", "-u", brokerFile], {
    cwd: REPO_ROOT,
    env: { ...environment, LIFE_ATLAS_RELEASE_TEST_RUNTIME: TASK_RUNTIME_ROOT },
    windowsHide: true,
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let phase = "starting";
  let sequence = 0;
  let buffer = "";
  let outputBytes = 0;
  let brokerDiagnostic = "";
  let sawExit = false;
  let aborted = false;
  let resolveResume;
  child.releaseNativeResumeReady = new Promise((resolve) => { resolveResume = resolve; });
  const write = (message) => { if (!broker.stdin.destroyed) broker.stdin.write(`${JSON.stringify({ protocol: 1, nonce, ...message })}\n`); };
  const fail = (error) => {
    if (!child.releaseError) child.emit("error", error);
    resolveResume(false);
  };
  const protocolFailure = (error) => { child.releaseOwnershipError = error; fail(error); child.releaseNativeAbort(); };
  child.releaseNativeAbort = () => {
    if (!aborted && !sawExit && phase !== "closed") { aborted = true; write({ type: "abort" }); }
  };
  child.releaseNativeResume = () => {
    assert.equal(phase, "suspended", "Native target cannot resume without its suspended proof");
    assert.ok(child.releaseOwnership, "Native target cannot resume before its verified anchor");
    phase = "resuming";
    write({ type: "resume" });
  };
  const frame = (message) => {
    assert.ok(message && message.protocol === 1 && message.nonce === nonce && message.sequence === sequence++, "Native protocol identity or sequence changed");
    assert.ok(sequence <= 8192, "Native protocol record count is oversized");
    if (message.type === "suspended") {
      assert.equal(phase, "starting", "Native suspended identity was repeated");
      validateNativeIdentity(message, { brokerPid: broker.pid, brokerPath: python, executablePath, args, spawnedAt });
      child.pid = message.target.pid;
      child.releaseNativeIdentity = message;
      phase = "suspended";
      child.emit("spawn");
      return;
    }
    if (message.type === "resumed") {
      assert.equal(phase, "resuming", "Native resume acknowledgement is unexpected");
      assert.equal(message.pid, child.pid, "Native resumed PID changed");
      assert.equal(message.createdFileTime, child.releaseNativeIdentity.target.createdFileTime, "Native resumed creation time changed");
      assert.equal(message.previousSuspendCount, 1, "Native primary thread resumed more than once");
      phase = "running";
      child.releaseNativeResumed = true;
      resolveResume(true);
      return;
    }
    if (message.type === "stdout" || message.type === "stderr") {
      assert.equal(phase, "running", "Native output arrived outside its running phase");
      assert.ok(typeof message.bytes === "string" && message.bytes.length <= 32768 && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(message.bytes), "Native pipe chunk is invalid");
      const bytes = Buffer.from(message.bytes, "base64");
      assert.ok(bytes.length > 0 && bytes.length <= 16384 && bytes.toString("base64") === message.bytes, "Native pipe chunk is invalid");
      outputBytes += bytes.length;
      assert.ok(outputBytes <= NATIVE_PIPE_LIMIT, "Native target output exceeded its bounded pipe budget");
      child[message.type].write(bytes);
      return;
    }
    if (message.type === "exit") {
      assert.equal(phase, "running", "Native target exit arrived without a verified resume");
      assert.equal(message.pid, child.pid, "Native exiting PID changed");
      assert.equal(message.createdFileTime, child.releaseNativeIdentity.target.createdFileTime, "Native exiting creation time changed");
      assert.equal(normalizedPath(message.executablePath), normalizedPath(executablePath), "Native exiting executable changed");
      assert.equal(message.imageProvenAt, "suspended", "Native exit has no suspended image proof");
      assert.equal(message.commandLine, child.releaseNativeIdentity.target.commandLine, "Native exiting command proof changed");
      assert.deepEqual(message.args, child.releaseNativeIdentity.target.args, "Native exiting argument proof changed");
      assert.equal(message.parentPid, child.releaseNativeIdentity.target.parentPid, "Native exiting ancestry proof changed");
      assert.equal(message.handleRetained, true, "Native exit lost its process handle");
      assert.equal(message.signaled, true, "Native exit was not observed on the retained process handle");
      assert.ok(Number.isInteger(message.exitCode) && message.exitCode >= 0 && message.exitCode <= 0xffffffff, "Native exit status is unavailable");
      child.releaseNativeExit = message;
      child.exitCode = message.exitCode;
      sawExit = true;
      phase = "exited";
      return;
    }
    if (message.type === "error") {
      const error = new Error(`Native launch failed${typeof message.phase === "string" ? ` at ${message.phase.slice(0, 100)}` : ""}: ${String(message.message).slice(0, 3000)}`);
      if (typeof message.phase === "string") error.nativeLaunchPhase = message.phase.slice(0, 100);
      throw error;
    }
    throw new Error("Unexpected native launch protocol record");
  };
  broker.stdout.setEncoding("utf8").on("data", (text) => {
    try {
      buffer += text;
      while (buffer.includes("\n")) {
        const end = buffer.indexOf("\n");
        assert.ok(end + 1 <= 65536, "Native protocol buffer is oversized");
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        frame(JSON.parse(line));
      }
      assert.ok(buffer.length <= 65536, "Native protocol buffer is oversized");
    } catch (error) { protocolFailure(error); }
  });
  broker.stderr.setEncoding("utf8").on("data", (text) => {
    brokerDiagnostic += text;
    if (brokerDiagnostic.length > 65536) protocolFailure(new Error("Native broker diagnostics are oversized"));
  });
  broker.stdin.on("error", (error) => { if (!sawExit) fail(error); });
  broker.once("error", fail);
  broker.once("close", (code, signal) => {
    child.releaseNativeBrokerClosed = true;
    if (!sawExit || code !== 0 || signal !== null || buffer.length) protocolFailure(new Error(`Native broker closed without a complete target exit receipt: ${brokerDiagnostic.slice(0, 3000)}`));
    phase = "closed";
    resolveResume(false);
    child.stdout.end();
    child.stderr.end();
    child.emit("close", child.exitCode, child.signalCode);
  });
  broker.once("spawn", () => write({ type: "launch", kind: smoke ? "smoke" : "silent", executablePath, args, cwd: REPO_ROOT, nodePid: process.pid, deadlineAt: spawnedAt + timeoutMs }));
  return child;
}

function quotedProcessCommand(commandLine) {
  if (typeof commandLine !== "string" || !commandLine.startsWith('"') || /[\r\n\0]/.test(commandLine)) return null;
  const end = commandLine.indexOf('"', 1);
  if (end < 0 || commandLine[end + 1] !== " ") return null;
  return { executable: commandLine.slice(1, end), args: commandLine.slice(end + 2) };
}

function ownedTemporaryNSISParent(parent, ownership, installDir) {
  if (typeof parent?.executablePath !== "string" || !isPathInside(ownership.tempDir, parent.executablePath)) return false;
  const name = path.win32.basename(parent.executablePath).toLowerCase();
  if (!["old-uninstaller.exe", "un_a.exe"].includes(name)) return false;
  assertTestPath(parent.executablePath);
  const command = quotedProcessCommand(parent.commandLine);
  if (!command || !exactWindowsPath(command.executable, parent.executablePath)) return false;
  const args = command.args.startsWith(" ") ? command.args.slice(1) : command.args;
  const flags = name === "old-uninstaller.exe"
    ? ["/S /KEEP_APP_DATA /currentuser --updated", "/S /KEEP_APP_DATA /currentuser --keep-shortcuts --updated"]
    : ["/currentuser /S", "/S /currentuser", "/S"];
  return flags.some((value) => [installDir, `${installDir}\\`].some((directory) => args === `${value} _?=${directory}`));
}

function readonlyNSISPowerShell(entry, parent, ownership) {
  if (!parent || typeof ownership.installDir !== "string" || /['"`;&|<>\r\n\0]/.test(ownership.installDir)) return false;
  const installDir = assertTestPath(ownership.installDir);
  const mainName = path.win32.basename(ownership.executablePath);
  const sourceMain = parent.pid === ownership.mainPid && exactWindowsPath(parent.executablePath, ownership.executablePath)
    && (new RegExp(`^${INSTALL_TEST_NAME} Setup \\d+\\.\\d+\\.\\d+\\.exe$`, "i").test(mainName) || mainName.toLowerCase() === `uninstall ${INSTALL_TEST_NAME.toLowerCase()}.exe`);
  if (!sourceMain && !ownedTemporaryNSISParent(parent, ownership, installDir)) return false;
  if (![NSIS_POWERSHELL_SYSTEM32, NSIS_POWERSHELL_SYSWOW64].some((file) => exactWindowsPath(entry.executablePath, file))) return false;
  const command = quotedProcessCommand(entry.commandLine);
  if (!command || !exactWindowsPath(command.executable, NSIS_POWERSHELL_SYSTEM32)) return false;
  const bodies = [...NSIS_READONLY_PREFLIGHTS, ...[installDir, `${installDir}\\`].map((directory) => `if ((Get-CimInstance -ClassName Win32_Process | ? {$_.Path -and $_.Path.StartsWith('${directory}', 'CurrentCultureIgnoreCase')}).Count -gt 0) { exit 0 } else { exit 1 }`)];
  return bodies.some((body) => command.args === `-NoProfile -NonInteractive -C "${body}"`);
}

function readonlyNSISSystemProcess(entry, parent, ownership, known) {
  if (readonlyNSISPowerShell(entry, parent, ownership)) return true;
  return exactWindowsPath(entry.executablePath, NSIS_CONHOST_SYSTEM32) && typeof entry.commandLine === "string"
    && entry.commandLine.slice(-4) === " 0x4" && exactWindowsPath(entry.commandLine.slice(0, -4), `\\??\\${NSIS_CONHOST_SYSTEM32}`)
    && readonlyNSISPowerShell(parent, known.get(parent.parentPid), ownership);
}

function confinedTestPath(value) {
  const absolute = assertAbsolutePath(value);
  if (!isPathInside(TASK_RUNTIME_ROOT, absolute)) throw new Error("测试目录必须位于当前任务的物理 runtime 目录内");
  return absolute;
}

function assertTestPath(value) {
  return assertDesktopTestPath(confinedTestPath(value));
}

function confinedExecutablePath(value) {
  const absolute = assertAbsolutePath(value);
  if (!isPathInside(path.join(REPO_ROOT, "release"), absolute) && !isPathInside(TASK_RUNTIME_ROOT, absolute)) throw new Error("程序必须位于项目 release 或当前任务物理 runtime 内");
  return absolute;
}

function processOptions(pids, name) {
  if (process.platform !== "win32") throw new Error("发布进程检查只支持 Windows");
  if (pids && pids.some((pid) => !Number.isSafeInteger(pid) || pid < 1)) throw new TypeError("进程 ID 无效");
  return { windowsHide: true, encoding: "utf8", timeout: 10000, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, LIFE_ATLAS_RELEASE_PROCESS_IDS: pids?.join(",") || "", LIFE_ATLAS_RELEASE_PROCESS_NAME: name || "" } };
}

function readProcessRecords(pids, name) {
  const text = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", processScript], processOptions(pids, name));
  return JSON.parse(text.trim()).records;
}

function readProcessRecordsAsync(pids) {
  return new Promise((resolve, reject) => {
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", processScript], processOptions(pids), (error, stdout) => {
      if (error) { reject(error); return; }
      try { resolve(JSON.parse(stdout.trim()).records); } catch (parseError) { reject(parseError); }
    });
  });
}

export function runningInstallTestProcesses() {
  return readProcessRecords(undefined, `${INSTALL_TEST_NAME}.exe`);
}

export function installTestInstaller(version) {
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+$/.test(version)) throw new TypeError("安装测试版本必须是 x.y.z");
  const file = assertPhysicalPath(path.join(REPO_ROOT, "release", `install-test-${version}`, `${INSTALL_TEST_NAME} Setup ${version}.exe`));
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error(`先运行 node scripts/desktop-build.mjs release --install-test --version ${version}`);
  return file;
}

export function uninstallEntries(namePrefix) {
  if (namePrefix !== INSTALL_TEST_NAME) throw new Error("只能查询 Life Atlas Install Test 卸载项");
  const script = `Get-ChildItem 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall' | ForEach-Object { Get-ItemProperty $_.PSPath } | Where-Object { $_.DisplayName -like '${namePrefix}*' } | Select-Object DisplayName, DisplayVersion, QuietUninstallString | ConvertTo-Json -Compress`;
  const text = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, encoding: "utf8", timeout: 10000 }).trim();
  return text ? [].concat(JSON.parse(text)) : [];
}

export function parseQuietUninstallString(value, { installDir } = {}) {
  if (typeof value !== "string") throw new TypeError("安装测试版卸载命令无效");
  const match = /^"([^"\r\n]+)"\s*(.*)$/.exec(value);
  if (!match) throw new Error("安装测试版卸载命令必须包含带引号的绝对路径");
  const file = confinedTestPath(match[1]);
  const expectedDir = installDir === undefined ? undefined : confinedTestPath(installDir);
  const exe = assertTestPath(file);
  if (path.basename(exe) !== `Uninstall ${INSTALL_TEST_NAME}.exe`) throw new Error("拒绝处理非安装测试版卸载程序");
  if (expectedDir !== undefined && normalizedPath(path.dirname(exe)) !== normalizedPath(assertTestPath(expectedDir))) throw new Error("卸载路径不属于本次安装目录");
  const args = match[2].trim() ? match[2].trim().split(/\s+/) : [];
  if (!args.includes("/S") || args.some((argument) => !["/S", "/currentuser"].includes(argument))) throw new Error("安装测试版静默卸载参数无效");
  return { exe, args };
}

export function releaseAppEnvironment(dataRoot, env = {}, { tempDir } = {}) {
  const directory = confinedTestPath(dataRoot);
  const tempPath = confinedTestPath(tempDir ?? path.join(directory, "runtime", "temp"));
  const root = assertTestPath(directory);
  const runtimeDir = assertTestPath(path.join(root, "runtime"));
  const temporary = assertTestPath(tempPath);
  const result = { ...process.env, ...env };
  for (const name of ["LIFE_ATLAS_DEV_URL", "LIFE_ATLAS_DEV_SMOKE", "LIFE_ATLAS_TEST", "LIFE_ATLAS_TEST_DEFER_WORKSPACE_LOAD", "LIFE_ATLAS_TEST_CLOCK_MS", "LIFE_ATLAS_TEST_AUTOLOCK_MS", "LIFE_ATLAS_TEST_CLIPBOARD_MS", "LIFE_ATLAS_TEST_CONFIRM_TTL_MS"]) if (!(name in env)) delete result[name];
  result.LIFE_ATLAS_DATA_ROOT = root;
  result.LIFE_ATLAS_BOOTSTRAP_DIR = assertTestPath(path.join(runtimeDir, "bootstrap"));
  result.TEMP = temporary;
  result.TMP = temporary;
  return result;
}

function appExecutable(exe) {
  const file = assertPhysicalPath(confinedExecutablePath(exe), { allowMissing: false });
  if (!fs.statSync(file).isFile() || !["Life Atlas.exe", `${INSTALL_TEST_NAME}.exe`].includes(path.basename(file))) throw new Error("只能运行本任务的 Life Atlas 打包程序");
  return file;
}

function validateArguments(args) {
  if (!Array.isArray(args) || args.some((argument) => typeof argument !== "string" || /[\0\r\n]/.test(argument))) throw new TypeError("进程参数必须是无控制字符的字符串数组");
}

function validateAppArguments(args) {
  validateArguments(args);
  if (args.some((argument) => /^(?:--?|\/)(?:user-data-dir|profile-directory|disk-cache-dir|crash-dumps-dir)(?:=|\s|$)/i.test(argument))) throw new Error("启动参数不能覆盖本次隔离 profile、缓存或崩溃目录");
}

function silentExecutable(exe, args) {
  const file = assertPhysicalPath(confinedExecutablePath(exe), { allowMissing: false });
  const installer = new RegExp(`^${INSTALL_TEST_NAME} Setup (\\d+\\.\\d+\\.\\d+)\\.exe$`).exec(path.basename(file));
  if (installer) {
    if (normalizedPath(file) !== normalizedPath(installTestInstaller(installer[1]))) throw new Error("安装程序不属于本项目的安装测试版");
    if (!args.includes("/S") || args.some((argument) => argument !== "/S" && !argument.startsWith("/D="))) throw new Error("安装测试版静默安装参数无效");
    const destinations = args.filter((argument) => argument.startsWith("/D="));
    if (destinations.length > 1) throw new Error("只能指定一个安装目录");
    if (destinations.length) {
      const destination = destinations[0].slice(3);
      if (args.at(-1) !== destinations[0] || /[\s"]/.test(destination)) throw new Error("/D= 必须是最后一个参数，安装目录不能包含空格或引号");
      const installDir = assertTestPath(destination);
      const entries = uninstallEntries(INSTALL_TEST_NAME);
      if (entries.length && (!installedDirectories.has(installDir) || entries.length !== 1 || normalizedPath(path.dirname(parseQuietUninstallString(entries[0].QuietUninstallString).exe)) !== normalizedPath(installDir))) throw new Error("发现不属于本次运行的安装测试版，保留现场并报告");
      return { file, installDir, operation: installedDirectories.has(installDir) ? "upgrade" : "install" };
    }
    const entries = uninstallEntries(INSTALL_TEST_NAME);
    if (entries.length !== 1) throw new Error("原地升级必须对应本次运行的唯一安装测试版");
    const installDir = path.dirname(parseQuietUninstallString(entries[0].QuietUninstallString).exe);
    if (!installedDirectories.has(installDir)) throw new Error("拒绝升级不是本次运行安装的程序");
    return { file, installDir, operation: "upgrade" };
  }
  if (path.basename(file) === `Uninstall ${INSTALL_TEST_NAME}.exe`) {
    const installDir = assertTestPath(path.dirname(file));
    if (!installedDirectories.has(installDir)) throw new Error("拒绝卸载不是本次运行安装的程序");
    if (!args.includes("/S") || args.some((argument) => !["/S", "/currentuser"].includes(argument))) throw new Error("安装测试版静默卸载参数无效");
    return { file, installDir, operation: "uninstall" };
  }
  return { file: appExecutable(file), app: true };
}

export function reconcileInstallerProcesses(records, ownership, observedProcesses = []) {
  assert.equal(ownership.kind, "silent", "Installer ownership is required");
  assert.equal(new Set(records.map((entry) => entry.pid)).size, records.length, "Duplicate process IDs in ownership inventory");
  assert.equal(new Set(observedProcesses.map((entry) => entry.pid)).size, observedProcesses.length, "Duplicate remembered installer process IDs");
  const main = records.find((entry) => entry.pid === ownership.mainPid);
  const rememberedMain = observedProcesses.find((entry) => entry.pid === ownership.mainPid);
  const anchor = rememberedMain ?? { pid: ownership.mainPid, parentPid: ownership.mainParentPid ?? main?.parentPid, createdAt: ownership.mainCreatedAt, executablePath: ownership.executablePath, commandLine: ownership.mainCommandLine ?? main?.commandLine };
  assert.equal(typeof anchor.commandLine, "string", "Installer main command line is unavailable");
  assert.equal(anchor.createdAt, ownership.mainCreatedAt, "Main process PID was reused");
  assert.equal(normalizedPath(anchor.executablePath), normalizedPath(ownership.executablePath), "Main process executable changed");
  if (ownership.mainCommandLine !== undefined) assert.equal(anchor.commandLine, ownership.mainCommandLine, "Main process command line changed");
  const known = new Map([[anchor.pid, { ...anchor }], ...observedProcesses.map((entry) => [entry.pid, { ...entry }])]);
  const inventory = new Map(records.map((entry) => [entry.pid, entry]));
  for (const expected of known.values()) {
    const entry = inventory.get(expected.pid);
    if (!entry) continue;
    assert.equal(entry.createdAt, expected.createdAt, "Installer process PID was reused");
    assert.equal(typeof entry.executablePath, "string", "Installer process executable is unavailable");
    assert.equal(normalizedPath(entry.executablePath), normalizedPath(expected.executablePath), "Installer process executable changed");
    assert.equal(entry.commandLine, expected.commandLine, "Installer process command line changed");
    assert.equal(entry.parentPid, expected.parentPid, "Installer process ancestry changed");
  }
  let discovered = true;
  while (discovered) {
    discovered = false;
    for (const entry of records) {
      if (known.has(entry.pid) || !known.has(entry.parentPid)) continue;
      const parent = known.get(entry.parentPid);
      assert.ok(Date.parse(entry.createdAt) >= Date.parse(parent.createdAt), "Descendant predates the owned installer");
      const sameExecutable = typeof entry.executablePath === "string" && normalizedPath(entry.executablePath) === normalizedPath(ownership.executablePath);
      const inTemporary = typeof entry.executablePath === "string" && isPathInside(ownership.tempDir, entry.executablePath) && Boolean(assertTestPath(entry.executablePath));
      try {
        assert.ok(sameExecutable || inTemporary || readonlyNSISSystemProcess(entry, parent, ownership, known), "Unexpected process in the owned installer tree");
      } catch (error) {
        error.installerProcessContext = { mainPid: ownership.mainPid, mainCreatedAt: ownership.mainCreatedAt, executablePath: ownership.executablePath, installDir: ownership.installDir, tempDir: ownership.tempDir, parent: { ...parent }, rejected: { ...entry } };
        throw error;
      }
      assert.equal(typeof entry.commandLine, "string", "Installer descendant command line is unavailable");
      known.set(entry.pid, { ...entry });
      discovered = true;
    }
  }
  for (const entry of records) {
    if (known.has(entry.pid) || typeof entry.executablePath !== "string") continue;
    const inTemporary = isPathInside(ownership.tempDir, entry.executablePath);
    const possibleInstaller = normalizedPath(entry.executablePath) === normalizedPath(ownership.executablePath) && Date.parse(entry.createdAt) >= Date.parse(ownership.mainCreatedAt);
    assert.equal(inTemporary || possibleInstaller, false, "Unassigned installer descendant remains; 安装后代归属无法确认，保留现场");
  }
  return { observedProcesses: [...known.values()], liveProcesses: [...known.values()].reverse().filter((entry) => inventory.has(entry.pid)).map((entry) => inventory.get(entry.pid)) };
}

export function selectOwnedReleaseProcesses(records, ownership) {
  return ownership.kind === "silent" ? reconcileInstallerProcesses(records, ownership, ownership.observedProcesses).liveProcesses : selectOwnedTestProcesses(records, ownership);
}

async function resampleIncompleteKnownInstallerRecords(records, ownership) {
  assert.equal(new Set(records.map((entry) => entry.pid)).size, records.length, "Duplicate process IDs in ownership inventory");
  const known = new Map((ownership.observedProcesses ?? []).map((entry) => [entry.pid, entry]));
  const incomplete = records.filter((entry) => known.has(entry.pid) && (typeof entry.executablePath !== "string" || typeof entry.commandLine !== "string"));
  if (!incomplete.length) return records;
  for (const entry of incomplete) {
    const expected = known.get(entry.pid);
    assert.equal(entry.createdAt, expected.createdAt, "Installer process PID was reused");
    assert.equal(entry.parentPid, expected.parentPid, "Installer process ancestry changed");
    if (typeof entry.executablePath === "string") assert.equal(normalizedPath(entry.executablePath), normalizedPath(expected.executablePath), "Installer process executable changed");
    if (typeof entry.commandLine === "string") assert.equal(entry.commandLine, expected.commandLine, "Installer process command line changed");
  }
  const requested = new Set(incomplete.map((entry) => entry.pid));
  const refreshed = await readProcessRecordsAsync([...requested]);
  assert.equal(new Set(refreshed.map((entry) => entry.pid)).size, refreshed.length, "Duplicate process IDs in ownership inventory");
  assert.ok(refreshed.every((entry) => requested.has(entry.pid)), "Unexpected process returned by exact-PID resampling");
  const current = new Map(refreshed.map((entry) => [entry.pid, entry]));
  // Only a previously verified identity confirmed absent by the narrow second read has exited.
  // Unknown or still-incomplete identities remain subject to all original reconciliation assertions.
  return records.flatMap((entry) => !requested.has(entry.pid) ? [entry] : current.has(entry.pid) ? [current.get(entry.pid)] : []);
}

async function readOwnedReleaseProcesses(ownership) {
  const records = await readProcessRecordsAsync();
  if (ownership.kind !== "silent") return selectOwnedReleaseProcesses(records, ownership);
  const result = reconcileInstallerProcesses(await resampleIncompleteKnownInstallerRecords(records, ownership), ownership, ownership.observedProcesses);
  ownership.observedProcesses = result.observedProcesses;
  ownership.liveProcesses = result.liveProcesses;
  return result.liveProcesses;
}

async function captureOwnership(child) {
  if (!Number.isSafeInteger(child.pid) || child.pid < 1) throw new Error("启动进程没有有效 PID");
  if (child.releaseNativeIdentity) {
    const proof = child.releaseNativeIdentity;
    const main = { pid: proof.target.pid, parentPid: proof.target.parentPid, createdAt: proof.target.createdAt, executablePath: proof.target.executablePath, commandLine: proof.target.commandLine };
    const ownership = { ...child.releaseContext, mainPid: main.pid, launcherPid: main.pid, mainCreatedAt: main.createdAt, launcherCreatedAt: main.createdAt, mainParentPid: main.parentPid, mainCommandLine: main.commandLine, nativeLaunch: proof };
    // The handle-backed, suspended root is remembered before any target instruction runs.
    Object.assign(ownership, reconcileInstallerProcesses([main], ownership, [main]));
    child.releaseOwnership = ownership;
    child.releaseNativeResume();
    assert.equal(await child.releaseNativeResumeReady, true, "Native launch did not confirm its one resume");
    if (child.releaseError) throw child.releaseError;
    const records = await readProcessRecordsAsync();
    Object.assign(ownership, reconcileInstallerProcesses(await resampleIncompleteKnownInstallerRecords(records, ownership), ownership, ownership.observedProcesses));
    if (child.releaseOwnershipError) throw child.releaseOwnershipError;
    console.log(`RELEASE_PROCESS_IDENTITY ${JSON.stringify({ pid: child.pid, verified: true, createdAt: main.createdAt, executablePath: main.executablePath, nativeLaunch: { brokerPid: proof.broker.pid, createdFileTime: proof.target.createdFileTime, createdAtExact: proof.target.createdAtExact, createdSuspended: true } })}`);
    return ownership;
  }
  const records = await readProcessRecordsAsync(child.releaseContext.kind === "silent" ? undefined : [child.pid]);
  const main = records.find((entry) => entry.pid === child.pid);
  if (!main && hasExited(child)) {
    console.log(`RELEASE_PROCESS_IDENTITY ${JSON.stringify({ pid: child.pid, verified: false, reason: "exited-before-sampling" })}`);
    return null;
  }
  assert.ok(main, "启动的进程仍在运行但无法核验其创建身份");
  assert.equal(main.parentPid, process.pid, "启动进程的父 PID 与本次 Node 不一致");
  assert.equal(normalizedPath(main.executablePath), normalizedPath(child.releaseContext.executablePath), "启动进程的可执行文件不一致");
  assert.ok(Date.parse(main.createdAt) >= child.releaseSpawnedAt - 1, "启动进程的 PID 已复用");
  if (child.releaseContext.kind === "silent") assert.equal(typeof main.commandLine, "string", "无法核验安装进程的命令行身份，保留现场");
  const ownership = { ...child.releaseContext, mainPid: child.pid, launcherPid: child.pid, mainCreatedAt: main.createdAt, launcherCreatedAt: main.createdAt, mainParentPid: main.parentPid, mainCommandLine: main.commandLine };
  if (ownership.kind === "silent") Object.assign(ownership, reconcileInstallerProcesses(records, ownership));
  else selectOwnedReleaseProcesses(records, ownership);
  child.releaseOwnership = ownership;
  console.log(`RELEASE_PROCESS_IDENTITY ${JSON.stringify({ pid: child.pid, verified: true, createdAt: main.createdAt, executablePath: main.executablePath })}`);
  return ownership;
}

function spawnTracked(exe, args, dataRoot, env, { kind = "app", tempDir, installDir, timeoutMs = 120000, nativeSmoke = false } = {}) {
  const childEnv = releaseAppEnvironment(dataRoot, env, { tempDir });
  const ownedInstallDir = installDir === undefined ? undefined : assertTestPath(installDir);
  fs.mkdirSync(childEnv.TEMP, { recursive: true });
  const spawnedAt = Date.now();
  const child = kind === "silent" ? nativeProcessChild(exe, args, childEnv, spawnedAt, timeoutMs, { smoke: nativeSmoke }) : spawn(exe, args, { cwd: REPO_ROOT, env: childEnv, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  children.add(child);
  child.releaseSpawnedAt = spawnedAt;
  child.releaseContext = { executablePath: exe, dataRoot: childEnv.LIFE_ATLAS_DATA_ROOT, runtimeDir: path.join(childEnv.LIFE_ATLAS_DATA_ROOT, "runtime"), tempDir: childEnv.TEMP, kind, ...(ownedInstallDir ? { installDir: ownedInstallDir } : {}) };
  child.releaseOwnership = null;
  child.releaseOutput = { stdout: "", stderr: "" };
  child.stdout.setEncoding("utf8").on("data", (text) => { child.releaseOutput.stdout += text; });
  child.stderr.setEncoding("utf8").on("data", (text) => { child.releaseOutput.stderr += text; });
  child.once("error", (error) => { child.releaseError = error; });
  child.once("close", () => { child.releaseClosed = true; });
  child.releaseOwnershipReady = new Promise((resolve) => {
    let ownershipCaptureStarted = false;
    child.once("spawn", () => { ownershipCaptureStarted = true; captureOwnership(child).then(resolve, (error) => { child.releaseOwnershipError = error; child.releaseNativeAbort?.(); resolve(null); }); });
    child.once("error", () => { if (kind !== "silent" || !ownershipCaptureStarted) resolve(null); });
  });
  console.log(`RELEASE_PROCESS_LAUNCH ${JSON.stringify({ pid: child.pid, spawnedAt, executablePath: exe, dataRoot: childEnv.LIFE_ATLAS_DATA_ROOT, tempDir: childEnv.TEMP, kind })}`);
  return child;
}

export function startApp(exe, dataRoot, { args = [], env = {} } = {}) {
  validateAppArguments(args);
  const executable = confinedExecutablePath(exe);
  const directory = confinedTestPath(dataRoot);
  const file = appExecutable(executable);
  const root = assertTestPath(directory);
  ensureDataRootMarker(root, { appVersion: "1.0.0", now: new Date().toISOString() });
  return spawnTracked(file, args, root, env);
}

export async function waitFor(check, { timeoutMs, intervalMs = 500, message = "等待条件超时" } = {}) {
  if (typeof check !== "function" || !Number.isFinite(timeoutMs) || timeoutMs < 0 || !Number.isFinite(intervalMs) || intervalMs < 1) throw new TypeError("轮询条件、期限或间隔无效");
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const result = await check();
    if (result) return result;
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error(message);
    await delay(Math.min(intervalMs, remaining));
  }
}

function terminateRecords(records, { force }) {
  if (!records.length) return;
  const script = "$records = ConvertFrom-Json $env:LIFE_ATLAS_RELEASE_TERMINATION_RECORDS; foreach ($record in $records) { $live = Get-CimInstance -ClassName Win32_Process -Filter ('ProcessId=' + [int]$record.pid); if ($live) { if ($live.CreationDate.ToUniversalTime().ToString('o') -ne $record.createdAt -or $live.ExecutablePath -ine $record.executablePath -or $live.CommandLine -ne $record.commandLine) { throw 'Process identity changed before termination' }; if ($env:LIFE_ATLAS_RELEASE_FORCE -eq '1') { Stop-Process -Id ([int]$record.pid) -Force -ErrorAction Stop } else { & taskkill.exe /PID ([string]$record.pid); if ($LASTEXITCODE -ne 0) { throw 'The verified process could not be closed gracefully' } } } }";
  execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, encoding: "utf8", timeout: 15000, env: { ...process.env, LIFE_ATLAS_RELEASE_TERMINATION_RECORDS: JSON.stringify(records), LIFE_ATLAS_RELEASE_FORCE: force ? "1" : "0" } });
  console.log(`RELEASE_PROCESS_TERMINATE ${JSON.stringify({ force, verifiedPids: records.map((entry) => entry.pid) })}`);
}

async function assertNaturallyExited(child) {
  assert.ok(hasExited(child), "未核验身份的启动进程仍在运行，保留现场");
  if (child.releaseError) throw child.releaseError;
  const records = await readProcessRecordsAsync();
  const context = child.releaseContext;
  assert.equal(records.some((entry) => entry.pid === child.pid || entry.parentPid === child.pid || typeof entry.executablePath === "string" && normalizedPath(entry.executablePath) === normalizedPath(context.executablePath) && Date.parse(entry.createdAt) >= child.releaseSpawnedAt - 1), false, "自然退出的进程身份未确认且有可能的残活，保留现场");
}

export async function closeAppGracefully(child) {
  if (!children.has(child)) throw new Error("不能关闭不是本辅助程序启动的进程");
  if (child.releaseNativeBrokerClosed && !child.releaseNativeExit) throw child.releaseError || new Error("Native broker closed without a target exit identity; preserve the failed action");
  const ownership = await child.releaseOwnershipReady;
  if (!ownership) {
    if (!hasExited(child)) throw child.releaseOwnershipError || new Error("无法确认启动进程的身份，保留现场");
    await assertNaturallyExited(child);
    return;
  }
  const wasRunning = !hasExited(child);
  try {
    const records = await readOwnedReleaseProcesses(ownership);
    const main = records.find((entry) => entry.pid === ownership.mainPid);
    if (main) terminateRecords([main], { force: false });
    await waitFor(() => hasExited(child), { timeoutMs: 15000, intervalMs: 25, message: "应用没有正常退出" });
    assert.deepEqual(await readOwnedReleaseProcesses(ownership), [], "应用退出后仍有本次进程存活");
    if (wasRunning && child.exitCode !== 0) throw new Error("应用没有正常退出");
  } catch (error) {
    try {
      const records = await readOwnedReleaseProcesses(ownership);
      terminateRecords(records, { force: true });
      await waitFor(() => hasExited(child), { timeoutMs: 5000, intervalMs: 25, message: "精确终止后启动进程仍在运行" });
      assert.deepEqual(await readOwnedReleaseProcesses(ownership), [], "精确终止后仍有本次进程存活");
    } catch (cleanupError) { throw new AggregateError([error, cleanupError], "应用没有正常退出，且安全清理未完成；保留现场"); }
    throw new Error("应用没有正常退出", { cause: error });
  } finally {
    console.log(`RELEASE_PROCESS_CLOSE ${JSON.stringify({ pid: child.pid, exitCode: child.exitCode, signalCode: child.signalCode, ownershipVerified: true })}`);
  }
}

export function canCompensateInstallerAction(action, { installDir } = {}) {
  return Boolean(action && ["install", "upgrade"].includes(action.operation) && action.state === "settled" && action.observedClose === true && action.identityVerified === true && action.reconciled === true && action.directoryOwned === true && Array.isArray(action.liveProcesses) && action.liveProcesses.length === 0 && typeof action.installDir === "string" && typeof installDir === "string" && normalizedPath(action.installDir) === normalizedPath(installDir));
}

export async function runSilentResult(exe, args, { timeoutMs = 120000, dataRoot, tempDir, env = {}, action } = {}) {
  validateAppArguments(args);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1) throw new TypeError("进程期限无效");
  if (action !== undefined && (!action || typeof action !== "object" || Array.isArray(action) || Object.keys(action).length)) throw new TypeError("安装动作收据必须是新的空对象");
  const boundedDataRoot = dataRoot === undefined ? undefined : confinedTestPath(dataRoot);
  const boundedTempDir = tempDir === undefined ? undefined : confinedTestPath(tempDir);
  const command = silentExecutable(exe, args);
  if (command.app && dataRoot === undefined) throw new Error("运行应用必须明确提供本次数据目录");
  const temporaryRoot = dataRoot === undefined || tempDir === undefined ? createIsolatedDirectory("release-command") : null;
  const root = assertTestPath(boundedDataRoot ?? path.join(temporaryRoot, "data"));
  const temporary = assertTestPath(boundedTempDir ?? path.join(temporaryRoot, "temp"));
  if (command.app) ensureDataRootMarker(root, { appVersion: "1.0.0", now: new Date().toISOString() });
  const receipt = command.installDir ? action ?? {} : undefined;
  const directoryOwnedBefore = command.installDir ? installedDirectories.has(command.installDir) : false;
  const destinationAbsentBefore = command.installDir ? !fs.existsSync(command.installDir) : false;
  if (receipt) Object.assign(receipt, { operation: command.operation, state: "running", executablePath: command.file, installDir: command.installDir, dataRoot: root, tempDir: temporary, observedClose: false, identityVerified: false, reconciled: false, directoryOwnedBefore, destinationAbsentBefore, directoryOwned: directoryOwnedBefore, succeeded: false, ownership: null, observedProcesses: [], liveProcesses: null });
  let child;
  try {
    if (receipt && command.operation === "install" && !destinationAbsentBefore) throw new Error("初次安装目录已存在且不属于本次运行，保留现场");
    child = spawnTracked(command.file, args, root, env, { kind: command.app ? "app" : "silent", tempDir: temporary, installDir: command.installDir, timeoutMs });
    if (receipt) receipt.startedAt = child.releaseSpawnedAt;
    let commandError;
    try {
      await waitFor(() => { if (child.releaseError) throw child.releaseError; return child.releaseClosed === true; }, { timeoutMs: Math.max(0, child.releaseSpawnedAt + timeoutMs - Date.now()), intervalMs: 25, message: `进程运行超过 ${timeoutMs}ms，保留现场` });
    } catch (error) {
      try { await closeAppGracefully(child); } catch (cleanupError) { throw new AggregateError([error, cleanupError], "静默进程失败，且安全关闭未完成；保留现场"); }
      commandError = error;
    }
    const ownership = await child.releaseOwnershipReady;
    if (receipt) {
      if (child.releaseOwnershipError) throw child.releaseOwnershipError;
      assert.ok(ownership, "无法确认安装进程的身份，保留现场");
      assert.equal(child.releaseClosed, true, "未确认安装进程 close，保留现场");
      assert.ok(Number.isInteger(child.exitCode) || typeof child.signalCode === "string", "安装进程 close 没有退出状态，保留现场");
      await waitFor(async () => (await readOwnedReleaseProcesses(ownership)).length === 0, { timeoutMs: Math.max(0, child.releaseSpawnedAt + timeoutMs - Date.now()), intervalMs: 25, message: "安装进程退出后仍有本次后代存活，保留现场" });
      receipt.reconciled = true;
      const destination = assertTestPath(command.installDir);
      receipt.directoryOwned = directoryOwnedBefore || destinationAbsentBefore && fs.existsSync(destination);
      if (receipt.directoryOwned) installedDirectories.add(command.installDir);
      receipt.state = "settled";
      receipt.completedAt = Date.now();
      receipt.succeeded = !commandError && child.exitCode === 0 && child.signalCode === null;
    }
    if (commandError) throw commandError;
    console.log(`RELEASE_SILENT_EXIT ${JSON.stringify({ pid: child.pid, exitCode: child.exitCode, signalCode: child.signalCode, ownershipVerified: Boolean(ownership), temporaryRoot })}`);
    return { exitCode: child.exitCode, stdout: child.releaseOutput.stdout, stderr: child.releaseOutput.stderr, ownership, temporaryRoot, ...(receipt ? { action: receipt } : {}) };
  } catch (error) {
    if (receipt) {
      if (receipt.state !== "settled") receipt.state = "uncertain";
      receipt.error = { name: error.name, message: error.message, ...(error.nativeLaunchPhase ? { nativeLaunchPhase: error.nativeLaunchPhase } : {}), ...(error.installerProcessContext ? { processContext: error.installerProcessContext } : {}) };
    }
    throw error;
  } finally {
    if (receipt) {
      receipt.observedClose = child?.releaseClosed === true;
      receipt.exitCode = child?.exitCode ?? null;
      receipt.signalCode = child?.signalCode ?? null;
      receipt.ownership = child?.releaseOwnership ?? null;
      receipt.identityVerified = Boolean(receipt.ownership) && !child?.releaseOwnershipError;
      receipt.observedProcesses = receipt.ownership?.observedProcesses ?? [];
      receipt.liveProcesses = receipt.ownership?.liveProcesses ?? null;
      console.log(`RELEASE_INSTALLER_ACTION ${JSON.stringify(receipt)}`);
    }
  }
}

export async function runSilent(exe, args, options = {}) {
  return (await runSilentResult(exe, args, options)).exitCode;
}

export async function runNativeLaunchSmoke({ dataRoot, tempDir, timeoutMs = 15000 } = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 15000) throw new TypeError("Native smoke deadline is invalid");
  const root = assertTestPath(dataRoot);
  const temporary = assertTestPath(tempDir);
  const child = spawnTracked(resolveNativePython(), NATIVE_SMOKE_ARGS, root, {}, { kind: "silent", tempDir: temporary, timeoutMs, nativeSmoke: true });
  await waitFor(() => { if (child.releaseError) throw child.releaseError; return child.releaseClosed === true; }, { timeoutMs: Math.max(0, child.releaseSpawnedAt + timeoutMs - Date.now()), intervalMs: 25, message: "Native fast-exit smoke exceeded its deadline" });
  const ownership = await child.releaseOwnershipReady;
  if (child.releaseOwnershipError) throw child.releaseOwnershipError;
  assert.ok(ownership && child.releaseNativeExit, "Native fast-exit smoke has no exact handle identity");
  assert.deepEqual(await readOwnedReleaseProcesses(ownership), [], "Native fast-exit smoke left an owned process");
  assert.equal(child.exitCode, 7, "Native fast-exit smoke status changed");
  return { exitCode: child.exitCode, stdout: child.releaseOutput.stdout, stderr: child.releaseOutput.stderr, ownership, nativeExit: child.releaseNativeExit };
}

function closedDatabase(dataRoot, name) {
  const root = assertTestPath(dataRoot);
  if (fs.existsSync(assertPhysicalPath(path.join(root, ".lock")))) throw new Error("只允许在应用关闭后读取数据库");
  const file = assertPhysicalPath(path.join(root, name), { root, allowMissing: false });
  for (const suffix of ["-wal", "-shm"]) assertPhysicalPath(`${file}${suffix}`, { root });
  if (fs.existsSync(`${file}-wal`) && fs.statSync(`${file}-wal`).size > 0) throw new Error("应用关闭后的数据库仍有未完成的 WAL，请保留现场");
  return new DatabaseSync(`${pathToFileURL(file).href}?immutable=1`, { readOnly: true });
}

export function readWorkspaceState(dataRoot) {
  const db = closedDatabase(dataRoot, "workspace.db");
  try {
    const meta = Object.fromEntries(db.prepare("SELECT key,value FROM meta ORDER BY key").all().map((row) => [row.key, JSON.parse(row.value)]));
    const grouped = new Map(BACKUP_COLLECTIONS.map((collection) => [collection, []]));
    for (const row of db.prepare("SELECT collection,id,json FROM entities ORDER BY collection,id").all()) {
      if (!grouped.has(row.collection)) throw new Error("数据库实体集合不在备份白名单内");
      grouped.get(row.collection).push([row.id, JSON.parse(row.json)]);
    }
    return { meta, entities: Object.fromEntries([...grouped].map(([collection, entries]) => [collection, Object.fromEntries(entries)])) };
  } finally { db.close(); }
}

export function readVaultRows(dataRoot) {
  const db = closedDatabase(dataRoot, "vault.db");
  try {
    return { header: db.prepare("SELECT id,json FROM vault_header ORDER BY id").all().map((row) => ({ ...row })), items: db.prepare("SELECT id,blob FROM vault_items ORDER BY id").all().map((row) => ({ id: row.id, blob: Buffer.from(row.blob) })) };
  } finally { db.close(); }
}

export function logEvents(dataRoot) {
  const root = assertTestPath(dataRoot);
  const directory = assertPhysicalPath(path.join(root, "logs"), { root });
  if (!fs.existsSync(directory)) return [];
  const files = fs.readdirSync(directory).filter((name) => name.endsWith(".log")).sort();
  return files.flatMap((name) => fs.readFileSync(assertPhysicalPath(path.join(directory, name), { root, allowMissing: false }), "utf8").split(/\r?\n/).filter((line) => line.trim()).map((line) => JSON.parse(line)));
}

export function snapshotDirs(dataRoot) {
  const root = assertTestPath(dataRoot);
  const directory = assertPhysicalPath(path.join(root, "snapshots"), { root });
  if (!fs.existsSync(directory)) return [];
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  for (const entry of entries) assertPhysicalPath(path.join(directory, entry.name), { root, allowMissing: false });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
}

export async function treeHash(dir) {
  const root = assertTestPath(dir);
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = assertPhysicalPath(path.join(directory, entry.name), { root, allowMissing: false });
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile()) files.push({ file, relative: path.relative(root, file).split(path.sep).join("/") });
      else throw new Error("目录哈希只接受物理普通文件与目录");
    }
  };
  visit(root);
  files.sort((left, right) => left.relative < right.relative ? -1 : left.relative > right.relative ? 1 : 0);
  const total = createHash("sha256");
  for (const entry of files) {
    assertPhysicalPath(entry.file, { root, allowMissing: false });
    const hash = createHash("sha256");
    for await (const bytes of fs.createReadStream(entry.file)) hash.update(bytes);
    total.update(`${entry.relative}\0${hash.digest("hex")}\n`);
  }
  return total.digest("hex");
}
