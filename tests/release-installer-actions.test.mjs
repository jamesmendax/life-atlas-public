import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import { syncBuiltinESMExports } from "node:module";
import { PassThrough } from "node:stream";
import { assertPhysicalPath } from "../electron/main/storage/dataRoot.js";
import { createIsolatedDirectory, removeIsolatedDirectory, REPO_ROOT, TASK_RUNTIME_ROOT } from "./desktop/helpers.mjs";
import * as releaseHelpers from "./release/helpers.mjs";
import { canCompensateInstallerAction, INSTALL_TEST_NAME, runSilent, runSilentResult } from "./release/helpers.mjs";

let fixtureSequence = 0;
const nativePython = "C:\\Users\\medax\\.uv\\python\\cpython-3.13.14-windows-x86_64-none\\python.exe";
const nativeBrokerFile = path.join(REPO_ROOT, "tests", "release", "native-launcher.py");
const fileTimeFor = (instant) => (BigInt(instant) * 10000n + 116444736000000000n).toString();
const nativeDateFor = (instant) => new Date(instant).toISOString().replace(/\.(\d{3})Z$/, (_, fraction) => `.${fraction}0000Z`);
function nativeCommand(executable, args) {
  const quote = (argument, always = false) => {
    const escaped = argument.replace(/(\\*)"/g, (_, backslashes) => `${backslashes.repeat(2)}\\"`);
    return always || !argument || /[ \t]/.test(argument) ? `"${escaped.replace(/(\\+)$/, (_, backslashes) => backslashes.repeat(2))}"` : escaped;
  };
  return [quote(executable, true), ...args.map((argument) => quote(argument))].join(" ");
}
const observedCimPreflight = '"C:\\windows\\system32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -NonInteractive -C "if (Get-Command Get-CimInstance -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"';
const observedPolicyPreflight = '"C:\\windows\\system32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -NonInteractive -C "if ((Get-ExecutionPolicy -Scope Process) -eq \'Restricted\') { exit 1 } else { exit 0 }"';
const observedFindProcess = (installDir) => `"C:\\windows\\system32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -NonInteractive -C "if ((Get-CimInstance -ClassName Win32_Process | ? {$_.Path -and $_.Path.StartsWith('${installDir}', 'CurrentCultureIgnoreCase')}).Count -gt 0) { exit 0 } else { exit 1 }"`;

function mockedInstaller(context, { descendantsRemain = true, orphanRemains = false, destinationExistsBefore = false, commands } = {}) {
  const root = path.join(TASK_RUNTIME_ROOT, `installer-actions-pure-${++fixtureSequence}`);
  const dataRoot = path.join(root, "data");
  const tempDir = path.join(root, "temp");
  const installDir = path.join(root, "app");
  const executable = path.join(REPO_ROOT, "release", "install-test-1.0.0", `${INSTALL_TEST_NAME} Setup 1.0.0.exe`);
  const exe = path.join(installDir, `${INSTALL_TEST_NAME}.exe`);
  const launched = [];
  const receipts = [];
  let entries = [];
  const metadata = { isSymbolicLink: () => false, isDirectory: () => true, isFile: () => true };
  context.mock.method(fs, "lstatSync", () => metadata);
  context.mock.method(fs, "statSync", () => metadata);
  context.mock.method(fs, "existsSync", (file) => file === installDir ? destinationExistsBefore || entries.length > 0 : file === exe ? entries.length > 0 : true);
  context.mock.method(fs, "mkdirSync", () => undefined);
  context.mock.method(fs, "writeFileSync", (file, text) => { receipts.push({ file, text }); });
  context.mock.method(console, "log", () => undefined);
  context.mock.method(childProcess, "execFileSync", (file, args) => {
    assert.equal(args.includes("-Command"), true);
    assert.equal(args.at(-1).includes("LIFE_ATLAS_RELEASE_TERMINATION_RECORDS"), false, "Unknown process identities must not be terminated");
    return JSON.stringify(entries);
  });
  context.mock.method(childProcess, "execFile", (file, args, options, callback) => {
    const requested = options.env.LIFE_ATLAS_RELEASE_PROCESS_IDS;
    const owner = launched.find((entry) => String(entry.child.pid) === requested);
    if (owner?.plan.ownershipFailure || !requested && launched.some((entry) => entry.plan.ownershipFailure && entry.child.exitCode === null)) { queueMicrotask(() => callback(new Error("process identity unavailable"))); return; }
    const collect = () => requested ? owner ? [owner.main] : launched.flatMap((entry) => {
      if (!entry.plan.nativeProfiles || !(requested.split(",").map(Number)).includes(entry.nativePowerShell.pid)) return [];
      if (entry.plan.nativeResample === "absent") return [];
      return [{ ...entry.nativePowerShell, executablePath: null, commandLine: null }];
    }) : launched.flatMap((entry) => {
      if (entry.plan.fastExitBeforeCim && entry.child.exitCode !== null && entry.inventoryReads === 0) { entry.inventoryReads += 1; return entry.plan.descendantsExitAfterReads ? [entry.descendant] : []; }
      if (entry.child.exitCode === null && !entry.child.releaseClosed) return entry.plan.nativeProfiles ? [entry.main, entry.descendant, entry.nativePowerShell, entry.nativeConhost] : [entry.main];
      entry.inventoryReads += 1;
      if (entry.plan.nativeProfiles) return entry.inventoryReads === 1 ? [entry.descendant, { ...entry.nativePowerShell, executablePath: null, commandLine: null }, entry.nativeConhost] : [];
      if (entry.plan.orphanRemains) return entry.inventoryReads === 1 ? [entry.descendant, entry.grandchild] : [entry.grandchild];
      if (entry.plan.descendantsExitAfterReads !== undefined) return entry.inventoryReads <= entry.plan.descendantsExitAfterReads ? [entry.descendant] : [];
      return entry.plan.descendantsRemain ? [entry.descendant] : [];
    });
    if (launched.some((entry) => entry.plan.fastExitBeforeCim)) setTimeout(() => callback(null, JSON.stringify({ records: collect() })), 1);
    else { const records = collect(); queueMicrotask(() => callback(null, JSON.stringify({ records }))); }
  });
  const applyAction = (target) => {
    if (path.basename(target.file).startsWith("Uninstall ")) {
      if (!target.plan.uninstallEntryRemains) entries = [];
    } else entries = [{ DisplayName: `${INSTALL_TEST_NAME} 1.0.0`, DisplayVersion: "1.0.0", QuietUninstallString: `"${path.join(installDir, `Uninstall ${INSTALL_TEST_NAME}.exe`)}" /S` }];
  };
  const createTarget = (file, args, parentPid, deferAction = false) => {
    const plan = commands?.[launched.length] ?? { descendantsRemain, orphanRemains };
    const child = new EventEmitter();
    child.pid = 670010 + launched.length * 10;
    child.exitCode = null;
    child.signalCode = null;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    const instant = Date.now();
    const main = { pid: child.pid, parentPid, executablePath: file, createdAt: nativeDateFor(instant), commandLine: nativeCommand(file, args) };
    const descendant = { pid: child.pid + 1, parentPid: child.pid, executablePath: path.join(tempDir, "ns-owned.tmp", plan.nativeProfiles ? "old-uninstaller.exe" : "helper.exe"), createdAt: new Date(instant + 1).toISOString(), commandLine: "helper.exe /S" };
    if (plan.nativeProfiles) descendant.commandLine = `"${descendant.executablePath}" /S /KEEP_APP_DATA /currentuser --updated _?=${installDir}`;
    const grandchild = { pid: child.pid + 2, parentPid: descendant.pid, executablePath: path.join(tempDir, "ns-owned.tmp", "worker.exe"), createdAt: new Date(instant + 2).toISOString(), commandLine: "worker.exe /S" };
    const nativePowerShell = { pid: child.pid + 2, parentPid: descendant.pid, executablePath: "C:\\windows\\SysWOW64\\WindowsPowerShell\\v1.0\\powershell.exe", createdAt: new Date(instant + 2).toISOString(), commandLine: observedCimPreflight };
    const nativeConhost = { pid: child.pid + 3, parentPid: nativePowerShell.pid, executablePath: "C:\\windows\\system32\\conhost.exe", createdAt: new Date(instant + 3).toISOString(), commandLine: "\\??\\C:\\windows\\system32\\conhost.exe 0x4" };
    const target = { child, main, descendant, grandchild, nativePowerShell, nativeConhost, plan, inventoryReads: 0, file, instant, args, resumeCount: 0, abortCount: 0 };
    launched.push(target);
    if (!deferAction) applyAction(target);
    return target;
  };
  context.mock.method(childProcess, "spawn", (file, args) => {
    if (path.win32.normalize(file).toLowerCase() === nativePython.toLowerCase()) {
      assert.deepEqual(args, ["-I", "-B", "-u", nativeBrokerFile]);
      const broker = new EventEmitter();
      broker.pid = 660010 + launched.length * 10;
      broker.stdout = new PassThrough();
      broker.stderr = new PassThrough();
      broker.stdin = new PassThrough();
      let target;
      let nonce;
      let sequence = 0;
      let brokerClosed = false;
      const frame = (message) => {
        if (brokerClosed) return;
        const text = `${JSON.stringify({ protocol: 1, nonce, sequence: sequence++, ...message })}\n`;
        const chunks = target?.plan.nativeFrameChunks?.(text, message) ?? [text];
        for (const chunk of chunks) broker.stdout.write(chunk);
      };
      const close = () => { if (!brokerClosed) { brokerClosed = true; broker.stdout.end(); broker.stderr.end(); broker.emit("close", 0, null); } };
      broker.stdin.on("data", (bytes) => {
        if (brokerClosed) return;
        const message = JSON.parse(bytes.toString("utf8").trim());
        if (message.type === "launch") {
          nonce = message.nonce;
          target = createTarget(message.executablePath, message.args, broker.pid, true);
          const brokerInstant = target.instant - 1;
          const identity = (pid, parentPid, executablePath, arguments_, instant, commandLine) => ({ pid, parentPid, executablePath, args: arguments_, commandLine, createdAt: nativeDateFor(instant), createdAtExact: nativeDateFor(instant), createdFileTime: fileTimeFor(instant), inJob: true });
          const proof = { type: "suspended", broker: identity(broker.pid, process.pid, nativePython, args, brokerInstant, nativeCommand(nativePython, args)), target: identity(target.main.pid, broker.pid, target.main.executablePath, target.args, target.instant, target.main.commandLine), native: { creationFlags: 0x08080404, createdSuspended: true, processHandleRetained: true, threadHandleRetained: true, processIdFromHandle: target.main.pid, threadProcessIdFromHandle: target.main.pid, threadIdFromHandle: target.main.pid + 9 } };
          if (target.plan.nativeMutation) target.plan.nativeMutation(proof);
          queueMicrotask(() => frame(proof));
          return;
        }
        assert.equal(message.nonce, nonce);
        if (message.type === "abort") {
          target.abortCount += 1;
          queueMicrotask(() => { frame({ type: "error", message: "native target aborted with retained handle" }); close(); });
          return;
        }
        assert.equal(message.type, "resume");
        target.resumeCount += 1;
        assert.equal(target.resumeCount, 1);
        applyAction(target);
        queueMicrotask(() => {
          frame({ type: "resumed", pid: target.main.pid, createdFileTime: fileTimeFor(target.instant), previousSuspendCount: 1 });
          if (!target.plan.staysRunning) queueMicrotask(() => {
            for (const type of ["stdout", "stderr"]) {
              const output = Buffer.from(target.plan[type] ?? "");
              for (let offset = 0; offset < output.length; offset += 16384) frame({ type, bytes: output.subarray(offset, offset + 16384).toString("base64") });
            }
            if (target.plan.commandError) broker.emit("error", target.plan.commandError);
            if (!target.plan.closedWithoutExit) target.child.exitCode = target.plan.exitCode ?? 0;
            target.child.releaseClosed = true;
            const exit = { type: "exit", pid: target.main.pid, createdFileTime: fileTimeFor(target.instant), executablePath: target.main.executablePath, commandLine: target.main.commandLine, args: target.args, parentPid: target.main.parentPid, imageProvenAt: "suspended", handleRetained: true, signaled: true, exitCode: target.child.exitCode };
            if (target.plan.nativeExitMutation) target.plan.nativeExitMutation(exit);
            frame(exit);
            close();
          });
        });
      });
      queueMicrotask(() => broker.emit("spawn"));
      return broker;
    }
    const target = createTarget(file, args, process.pid);
    const { child, plan } = target;
    queueMicrotask(() => {
      child.emit("spawn");
      if (!plan.staysRunning) queueMicrotask(() => {
        child.stdout.write(plan.stdout ?? "");
        child.stderr.write(plan.stderr ?? "");
        if (plan.commandError) child.emit("error", plan.commandError);
        if (!plan.closedWithoutExit) child.exitCode = plan.exitCode ?? 0;
        child.emit("close", child.exitCode, null);
      });
    });
    return child;
  });
  syncBuiltinESMExports();
  context.after(() => { context.mock.restoreAll(); syncBuiltinESMExports(); });
  return { root, executable, installDir, exe, launched, receipts, options: { dataRoot, tempDir, timeoutMs: 80 } };
}

async function runLifecycleCleanup(state) {
  const source = fs.readFileSync(new URL("./release/installer-lifecycle.e2e.mjs", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const marker = "  } finally {\n    const cleanupErrors = [];";
  const start = source.lastIndexOf(marker);
  assert.ok(start > 0, "The real installer finally call site must remain present");
  const end = source.indexOf("\n  }\n  if (failure) throw failure;", start);
  assert.ok(end > start);
  const body = source.slice(start + "  } finally {\n".length, end);
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const invoke = new AsyncFunction("state", "releaseHelpers", "fs", "path", "assert", "assertPhysicalPath", `
    const { closeAppGracefully, INSTALL_TEST_NAME, parseQuietUninstallString, runSilent, uninstallEntries, waitFor, canCompensateInstallerAction } = releaseHelpers;
    let { child, installationOwned, completed, root, dataRoot, installDir, exe, commandOptions, failure, installerAction } = state;
    const delay = () => Promise.resolve();
    const lifecycle = () => undefined;
    const assertOwnedRootHasNoLiveExecutables = () => { throw new Error("Failed action roots must be retained"); };
    const removeIsolatedDirectory = () => { throw new Error("Failed action roots must not be deleted"); };
    ${body}
    return { failure, installerAction };
  `);
  return invoke(state, releaseHelpers, fs, path, assert, assertPhysicalPath);
}

test("a silent installer stub exit does not complete an owned descendant action", async (context) => {
  const fixture = mockedInstaller(context);
  await assert.rejects(() => runSilentResult(fixture.executable, ["/S", `/D=${fixture.installDir}`], fixture.options), /静默进程|后代|退出|运行超过/);
});

test("an orphaned known installer descendant prevents action completion", async (context) => {
  const fixture = mockedInstaller(context, { orphanRemains: true });
  await assert.rejects(() => runSilentResult(fixture.executable, ["/S", `/D=${fixture.installDir}`], fixture.options), /静默进程|后代|退出|运行超过/);
});

test("the real installer finally does not uninstall after an unresolved upgrade", async (context) => {
  const fixture = mockedInstaller(context, { commands: [{ descendantsRemain: false }, { ownershipFailure: true, staysRunning: true }, { descendantsRemain: false }] });
  assert.equal(await runSilent(fixture.executable, ["/S", `/D=${fixture.installDir}`], fixture.options), 0);
  const installerAction = {};
  let failure;
  try { await runSilent(fixture.executable, ["/S"], { ...fixture.options, action: installerAction }); }
  catch (error) { failure = error; }
  assert.equal(failure instanceof AggregateError, true);
  const outcome = await runLifecycleCleanup({ ...fixture, dataRoot: fixture.options.dataRoot, commandOptions: fixture.options, installationOwned: true, completed: false, failure, installerAction });
  assert.equal(fixture.launched.length, 2, "An unresolved installer must not trigger a second uninstall command");
  assert.equal(outcome.failure, failure);
});

test("a stopped installer error preserves failure and safely compensates its partial output", async (context) => {
  const commandError = new Error("owned installer reported an output failure");
  const fixture = mockedInstaller(context, { commands: [{ descendantsRemain: false, commandError }, { descendantsRemain: false }] });
  const installerAction = {};
  await assert.rejects(() => runSilent(fixture.executable, ["/S", `/D=${fixture.installDir}`], { ...fixture.options, action: installerAction }), (error) => error === commandError);
  assert.equal(installerAction.state, "settled");
  assert.equal(installerAction.observedClose, true);
  assert.equal(installerAction.exitCode, 0);
  assert.equal(installerAction.succeeded, false);
  assert.equal(installerAction.directoryOwned, true);
  const outcome = await runLifecycleCleanup({ ...fixture, dataRoot: fixture.options.dataRoot, commandOptions: fixture.options, installationOwned: false, completed: false, failure: commandError, installerAction });
  assert.equal(fixture.launched.length, 2);
  assert.equal(outcome.failure, commandError);
  const saved = JSON.parse(fixture.receipts[0].text);
  assert.deepEqual(saved.failedAction.error, { name: "Error", message: commandError.message });
  assert.equal(saved.lastAction.succeeded, true);
});

test("the real installer finally does not repeat an unresolved uninstall with a live temp child", async (context) => {
  const fixture = mockedInstaller(context, { commands: [{ descendantsRemain: false }, { descendantsRemain: true, uninstallEntryRemains: true }, { descendantsRemain: false }] });
  assert.equal(await runSilent(fixture.executable, ["/S", `/D=${fixture.installDir}`], fixture.options), 0);
  const installerAction = {};
  const uninstaller = path.join(fixture.installDir, `Uninstall ${INSTALL_TEST_NAME}.exe`);
  let failure;
  try { await runSilent(uninstaller, ["/S"], { ...fixture.options, action: installerAction }); }
  catch (error) { failure = error; }
  assert.ok(failure);
  assert.equal(installerAction.operation, "uninstall");
  assert.equal(installerAction.exitCode, 0);
  assert.equal(installerAction.state, "uncertain");
  assert.deepEqual(installerAction.liveProcesses, [fixture.launched[1].descendant]);
  const outcome = await runLifecycleCleanup({ ...fixture, dataRoot: fixture.options.dataRoot, commandOptions: fixture.options, installationOwned: true, completed: false, failure, installerAction });
  assert.equal(fixture.launched.length, 2, "An unresolved uninstall must not run the same action again");
  assert.equal(outcome.failure, failure);
  const saved = JSON.parse(fixture.receipts[0].text);
  assert.equal(saved.failedAction.state, "uncertain");
  assert.equal(saved.lastAction.operation, "uninstall");
});

test("the real installer finally does not retry a settled uninstall after a later file assertion", async (context) => {
  const fixture = mockedInstaller(context, { commands: [{ descendantsRemain: false }, { descendantsRemain: false, uninstallEntryRemains: true }, { descendantsRemain: false }] });
  assert.equal(await runSilent(fixture.executable, ["/S", `/D=${fixture.installDir}`], fixture.options), 0);
  const installerAction = {};
  assert.equal(await runSilent(path.join(fixture.installDir, `Uninstall ${INSTALL_TEST_NAME}.exe`), ["/S"], { ...fixture.options, action: installerAction }), 0);
  assert.equal(installerAction.state, "settled");
  const failure = new Error("installed executable did not disappear after uninstall");
  const outcome = await runLifecycleCleanup({ ...fixture, dataRoot: fixture.options.dataRoot, commandOptions: fixture.options, installationOwned: true, completed: false, failure, installerAction });
  assert.equal(fixture.launched.length, 2, "A failed post-uninstall assertion must not cause another uninstall");
  assert.equal(outcome.failure, failure);
});

test("a completed installer preserves numeric results output and exact process identities", async (context) => {
  const fixture = mockedInstaller(context, { commands: [{ descendantsExitAfterReads: 2, stdout: "installer output", stderr: "installer diagnostic" }] });
  const action = {};
  const result = await runSilentResult(fixture.executable, ["/S", `/D=${fixture.installDir}`], { ...fixture.options, action });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "installer output");
  assert.equal(result.stderr, "installer diagnostic");
  assert.equal(result.action, action);
  assert.equal(action.operation, "install");
  assert.equal(action.state, "settled");
  assert.equal(action.succeeded, true);
  assert.equal(action.observedClose, true);
  assert.equal(action.reconciled, true);
  assert.deepEqual(action.liveProcesses, []);
  assert.deepEqual(action.observedProcesses, [fixture.launched[0].main, fixture.launched[0].descendant]);
  assert.equal(canCompensateInstallerAction(action, { installDir: fixture.installDir }), true);
});

test("a stopped nonzero partial install remains failed and permits one exact compensation", async (context) => {
  const fixture = mockedInstaller(context, { commands: [{ descendantsRemain: false, exitCode: 7 }, { descendantsRemain: false }] });
  const installerAction = {};
  let failure;
  try { assert.equal(await runSilent(fixture.executable, ["/S", `/D=${fixture.installDir}`], { ...fixture.options, action: installerAction }), 0); }
  catch (error) { failure = error; }
  assert.equal(failure instanceof assert.AssertionError, true);
  assert.equal(installerAction.state, "settled");
  assert.equal(installerAction.exitCode, 7);
  assert.equal(installerAction.succeeded, false);
  assert.equal(installerAction.destinationAbsentBefore, true);
  assert.equal(installerAction.directoryOwned, true);
  assert.equal(canCompensateInstallerAction(installerAction, { installDir: fixture.installDir }), true);
  const outcome = await runLifecycleCleanup({ ...fixture, installDir: fixture.installDir, dataRoot: fixture.options.dataRoot, commandOptions: fixture.options, installationOwned: false, completed: false, failure, installerAction });
  assert.equal(fixture.launched.length, 2);
  assert.equal(fixture.launched[1].file, path.join(fixture.installDir, `Uninstall ${INSTALL_TEST_NAME}.exe`));
  assert.equal(outcome.failure, failure);
  assert.equal(outcome.installerAction.operation, "uninstall");
  assert.equal(outcome.installerAction.succeeded, true);
  assert.equal(fixture.receipts.length, 1);
  assert.equal(fixture.receipts[0].file, path.join(fixture.root, "installer-action.json"));
  const saved = JSON.parse(fixture.receipts[0].text);
  assert.equal(saved.failedAction.exitCode, 7, "The failed action receipt must survive successful compensation");
  assert.equal(saved.lastAction.operation, "uninstall");
});

test("a close without an exit identity remains uncertain and cannot compensate", async (context) => {
  const fixture = mockedInstaller(context, { commands: [{ descendantsRemain: false, closedWithoutExit: true }] });
  const installerAction = {};
  let failure;
  try { await runSilent(fixture.executable, ["/S", `/D=${fixture.installDir}`], { ...fixture.options, action: installerAction }); }
  catch (error) { failure = error; }
  assert.ok(failure, "A close without exitCode or signal must not be accepted as a completed action");
  assert.equal(installerAction.observedClose, true);
  assert.equal(installerAction.exitCode, null);
  assert.equal(installerAction.signalCode, null);
  assert.equal(installerAction.state, "uncertain");
  assert.equal(canCompensateInstallerAction(installerAction, { installDir: fixture.installDir }), false);
  const outcome = await runLifecycleCleanup({ ...fixture, dataRoot: fixture.options.dataRoot, commandOptions: fixture.options, installationOwned: false, completed: false, failure, installerAction });
  assert.equal(fixture.launched.length, 1);
  assert.equal(outcome.failure, failure);
});

test("a first installer never writes into an existing unowned destination", async (context) => {
  const fixture = mockedInstaller(context, { descendantsRemain: false, destinationExistsBefore: true });
  const action = {};
  await assert.rejects(() => runSilent(fixture.executable, ["/S", `/D=${fixture.installDir}`], { ...fixture.options, action }), /安装目录.*已有|安装目录.*已存在/);
  assert.equal(fixture.launched.length, 0);
  assert.equal(action.destinationAbsentBefore, false);
  assert.equal(action.directoryOwned, false);
  assert.equal(action.state, "uncertain");
  assert.equal(canCompensateInstallerAction(action, { installDir: fixture.installDir }), false);
});

function nativeInstallerTree() {
  const root = path.join(TASK_RUNTIME_ROOT, `installer-native-profile-pure-${++fixtureSequence}`);
  const installDir = path.join(root, "app");
  const tempDir = path.join(root, "temp");
  const executablePath = path.join(REPO_ROOT, "release", "install-test-1.0.0", `${INSTALL_TEST_NAME} Setup 1.0.0.exe`);
  const main = { pid: 81000, parentPid: 80999, executablePath, createdAt: "2026-11-08T12:05:20.0000000Z", commandLine: `"${executablePath}" /S /D=${installDir}` };
  const uninstallerPath = path.join(tempDir, "~nsu.tmp", "Un_A.exe");
  const uninstaller = { pid: 81001, parentPid: main.pid, executablePath: uninstallerPath, createdAt: "2026-11-08T12:05:20.1000000Z", commandLine: `"${uninstallerPath}"  /currentuser /S _?=${installDir}\\` };
  const powershell = { pid: 81002, parentPid: uninstaller.pid, executablePath: "C:\\windows\\SysWOW64\\WindowsPowerShell\\v1.0\\powershell.exe", createdAt: "2026-11-08T12:05:20.2000000Z", commandLine: observedCimPreflight };
  const conhost = { pid: 81003, parentPid: powershell.pid, executablePath: "C:\\windows\\system32\\conhost.exe", createdAt: "2026-11-08T12:05:20.3000000Z", commandLine: "\\??\\C:\\windows\\system32\\conhost.exe 0x4" };
  const ownership = { kind: "silent", mainPid: main.pid, mainParentPid: main.parentPid, mainCreatedAt: main.createdAt, mainCommandLine: main.commandLine, executablePath, tempDir, installDir };
  return { installDir, main, uninstaller, powershell, conhost, ownership };
}

test("source-matched NSIS readonly probes retain exact ancestry including an orphaned console host", () => {
  for (const profile of [observedCimPreflight, observedPolicyPreflight, "find"]) {
    const fixture = nativeInstallerTree();
    fixture.powershell.commandLine = profile === "find" ? observedFindProcess(fixture.installDir) : profile;
    const records = [fixture.main, fixture.uninstaller, fixture.powershell, fixture.conhost];
    const first = releaseHelpers.reconcileInstallerProcesses(records, fixture.ownership);
    assert.deepEqual(first.observedProcesses, records);
    assert.deepEqual(first.liveProcesses, [...records].reverse());
    const orphan = releaseHelpers.reconcileInstallerProcesses([fixture.conhost], fixture.ownership, first.observedProcesses);
    assert.deepEqual(orphan.liveProcesses, [fixture.conhost]);
    assert.deepEqual(orphan.observedProcesses, records);
  }
  const native = nativeInstallerTree();
  native.powershell.parentPid = native.main.pid;
  native.powershell.executablePath = "C:\\windows\\system32\\WindowsPowerShell\\v1.0\\powershell.exe";
  assert.deepEqual(releaseHelpers.reconcileInstallerProcesses([native.main, native.powershell], native.ownership).liveProcesses, [native.powershell, native.main]);
});

test("NSIS readonly profiles reject altered scripts flags executables directories and quote injection", () => {
  const mutations = [
    (fixture) => { fixture.powershell.commandLine = observedFindProcess(path.join(fixture.installDir, "..", "other-app")); },
    (fixture) => { fixture.powershell.commandLine = `${observedCimPreflight}; Stop-Process -Id 1`; },
    (fixture) => { fixture.powershell.commandLine = observedCimPreflight.replace("-C", "-ExecutionPolicy Bypass -C"); },
    (fixture) => { fixture.powershell.commandLine = observedCimPreflight.replace("-C", "-EncodedCommand"); },
    (fixture) => { fixture.powershell.commandLine = `${observedCimPreflight}\n`; },
    (fixture) => { fixture.powershell.commandLine = observedCimPreflight.replace("exit 0", "Write-Host injected; exit 0"); },
    (fixture) => { fixture.powershell.executablePath = "C:\\windows\\system32\\WindowsPowerShell\\v1.0\\pwsh.exe"; },
    (fixture) => { fixture.powershell.executablePath = "C:\\Users\\medax\\AppData\\Local\\powershell.exe"; },
    (fixture) => { fixture.powershell.commandLine = observedCimPreflight.replace("system32", "SysWOW64"); },
    (fixture) => { fixture.ownership.installDir = `${fixture.installDir}'; Stop-Process -Id 1; #`; fixture.powershell.commandLine = observedFindProcess(fixture.ownership.installDir); },
    (fixture) => { delete fixture.ownership.installDir; },
    (fixture) => { fixture.uninstaller.commandLine += " /allusers"; },
  ];
  for (const mutate of mutations) {
    const fixture = nativeInstallerTree();
    mutate(fixture);
    assert.throws(() => releaseHelpers.reconcileInstallerProcesses([fixture.main, fixture.uninstaller, fixture.powershell], fixture.ownership), /Unexpected process|物理 runtime/);
  }
});

test("system profiles require the known NSIS parent and exact source console host identity", () => {
  const invalidParents = ["helper.exe", "foreign-uninstaller.exe"];
  for (const name of invalidParents) {
    const fixture = nativeInstallerTree();
    fixture.uninstaller.executablePath = path.join(path.dirname(fixture.uninstaller.executablePath), name);
    assert.throws(() => releaseHelpers.reconcileInstallerProcesses([fixture.main, fixture.uninstaller, fixture.powershell], fixture.ownership), /Unexpected process/);
  }
  for (const mutate of [
    (fixture) => { fixture.conhost.parentPid = fixture.main.pid; },
    (fixture) => { fixture.conhost.commandLine = fixture.conhost.commandLine.replace("0x4", "0x8"); },
    (fixture) => { fixture.conhost.commandLine += " extra"; },
    (fixture) => { fixture.conhost.executablePath = "C:\\windows\\SysWOW64\\conhost.exe"; },
    (fixture) => { fixture.conhost.createdAt = "2026-11-08T12:05:19.0000000Z"; },
  ]) {
    const fixture = nativeInstallerTree();
    mutate(fixture);
    assert.throws(() => releaseHelpers.reconcileInstallerProcesses([fixture.main, fixture.uninstaller, fixture.powershell, fixture.conhost], fixture.ownership), /Unexpected process|predates/);
  }
  const unrelated = nativeInstallerTree();
  unrelated.conhost.parentPid = 999;
  assert.deepEqual(releaseHelpers.reconcileInstallerProcesses([unrelated.main, unrelated.conhost], unrelated.ownership).liveProcesses, [unrelated.main], "An unknown parent must never assign a foreign system console host to this action");
});

test("remembered native identities keep all original PID executable command and ancestry checks", () => {
  const fixture = nativeInstallerTree();
  const observed = releaseHelpers.reconcileInstallerProcesses([fixture.main, fixture.uninstaller, fixture.powershell, fixture.conhost], fixture.ownership).observedProcesses;
  const changes = [
    [{ createdAt: "2026-11-08T12:05:21.0000000Z" }, /PID was reused/],
    [{ executablePath: "C:\\windows\\system32\\WindowsPowerShell\\v1.0\\powershell.exe" }, /executable changed/],
    [{ commandLine: observedPolicyPreflight }, /command line changed/],
    [{ parentPid: 999 }, /ancestry changed/],
    [{ executablePath: null }, /executable is unavailable/],
    [{ commandLine: null }, /command line changed/],
  ];
  for (const [patch, failure] of changes) assert.throws(() => releaseHelpers.reconcileInstallerProcesses([{ ...fixture.powershell, ...patch }], fixture.ownership, observed), failure);
});

test("a previously verified native process confirmed absent by exact PID sampling remains remembered", async (context) => {
  const fixture = mockedInstaller(context, { commands: [{ nativeProfiles: true, nativeResample: "absent" }] });
  const action = {};
  const result = await runSilentResult(fixture.executable, ["/S", `/D=${fixture.installDir}`], { ...fixture.options, action });
  const launch = fixture.launched[0];
  assert.equal(result.exitCode, 0);
  assert.equal(action.ownership.installDir, fixture.installDir);
  assert.deepEqual(action.observedProcesses, [launch.main, launch.descendant, launch.nativePowerShell, launch.nativeConhost]);
  assert.deepEqual(action.liveProcesses, []);
  assert.equal(action.state, "settled");
  assert.equal(action.reconciled, true);
});

test("a native process still missing identity after exact PID sampling leaves the action uncertain", async (context) => {
  const fixture = mockedInstaller(context, { commands: [{ nativeProfiles: true, nativeResample: "incomplete" }] });
  const action = {};
  await assert.rejects(() => runSilentResult(fixture.executable, ["/S", `/D=${fixture.installDir}`], { ...fixture.options, action }), /executable is unavailable|command line changed/);
  assert.equal(action.state, "uncertain");
  assert.equal(action.reconciled, false);
  assert.equal(canCompensateInstallerAction(action, { installDir: fixture.installDir }), false);
});

test("native broker framing accepts fragmented 64 KiB records and coalesced bounded output", async (context) => {
  const stdout = ["a", "b", "c", "d"].map((value) => value.repeat(16384)).join("");
  let pending = "";
  const nativeFrameChunks = (text, message) => {
    if (message.type === "suspended") {
      const bounded = `${text.slice(0, -1).padEnd(65535, " ")}\n`;
      return [bounded.slice(0, 31), bounded.slice(31)];
    }
    if (message.type === "resumed") return [text.slice(0, 7), text.slice(7)];
    if (message.type === "stdout" || message.type === "stderr") {
      pending += text;
      return [];
    }
    if (message.type === "exit") {
      const records = pending + text;
      assert.ok(records.length > 66560);
      return [records.slice(0, 1024), records.slice(1024, 66560), records.slice(66560)];
    }
    return [text];
  };
  const fixture = mockedInstaller(context, { commands: [{ descendantsRemain: false, stdout, stderr: "installer diagnostic", nativeFrameChunks }] });
  const action = {};
  const result = await runSilentResult(fixture.executable, ["/S", `/D=${fixture.installDir}`], { ...fixture.options, action });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout.length, stdout.length);
  assert.equal(result.stdout === stdout, true, "Fragmented and coalesced frames must preserve all output in order");
  assert.equal(result.stderr, "installer diagnostic");
  assert.equal(fixture.launched[0].resumeCount, 1);
  assert.equal(fixture.launched[0].abortCount, 0);
  assert.equal(action.state, "settled");
  assert.equal(action.identityVerified, true);
  assert.equal(action.reconciled, true);
  assert.deepEqual(action.liveProcesses, []);
});

test("native broker framing rejects an oversized complete record and fragmented incomplete record", async (context) => {
  const deliveries = [
    (text) => [`${text.slice(0, -1).padEnd(65536, " ")}\n`],
    (text) => {
      const incomplete = text.slice(0, -1).padEnd(65537, " ");
      return [incomplete.slice(0, 65536), incomplete.slice(65536)];
    },
  ];
  const fixture = mockedInstaller(context, { commands: deliveries.map((deliver) => ({ nativeFrameChunks: (text, message) => message.type === "suspended" ? deliver(text) : [text] })) });
  for (let index = 0; index < deliveries.length; index += 1) {
    const action = {};
    await assert.rejects(() => runSilentResult(fixture.executable, ["/S", `/D=${fixture.installDir}`], { ...fixture.options, action }), (error) => error instanceof AggregateError && error.errors.some((failure) => failure.message === "Native protocol buffer is oversized"));
    assert.equal(fixture.launched[index].resumeCount, 0);
    assert.equal(fixture.launched[index].abortCount, 1);
    assert.equal(action.state, "uncertain");
    assert.equal(action.identityVerified, false);
    assert.equal(action.reconciled, false);
    assert.equal(canCompensateInstallerAction(action, { installDir: fixture.installDir }), false);
  }
});

test("a native root handle proves the fast launcher before the first delayed CIM inventory", async (context) => {
  const fixture = mockedInstaller(context, { commands: [{ fastExitBeforeCim: true, descendantsRemain: false, stdout: "fast launcher" }] });
  const action = {};
  const result = await runSilentResult(fixture.executable, ["/S", `/D=${fixture.installDir}`], { ...fixture.options, action });
  const launch = fixture.launched[0];
  assert.equal(launch.child.exitCode, 0, "The first sampler must observe a launcher that has already exited");
  assert.equal(launch.resumeCount, 1);
  assert.equal(result.stdout, "fast launcher");
  assert.equal(action.identityVerified, true);
  assert.equal(action.state, "settled");
  assert.equal(action.ownership.nativeLaunch.target.createdFileTime, fileTimeFor(launch.instant));
  assert.equal(action.ownership.nativeLaunch.broker.pid, launch.main.parentPid);
  assert.deepEqual(action.observedProcesses, [launch.main]);
  assert.deepEqual(action.liveProcesses, []);
});

test("a fast native launcher retains its exact anchor while its owned temporary child settles", async (context) => {
  const fixture = mockedInstaller(context, { commands: [{ fastExitBeforeCim: true, descendantsExitAfterReads: 2 }] });
  const action = {};
  await runSilentResult(fixture.executable, ["/S", `/D=${fixture.installDir}`], { ...fixture.options, action });
  assert.deepEqual(action.observedProcesses, [fixture.launched[0].main, fixture.launched[0].descendant]);
  assert.deepEqual(action.liveProcesses, []);
  assert.equal(action.reconciled, true);
});

test("native launch proof rejects changed image arguments creation PID ancestry and missing job before resume", async (context) => {
  const mutations = [
    (proof) => { proof.target.executablePath = nativePython; },
    (proof) => { proof.target.args.push("/allusers"); },
    (proof) => { proof.target.commandLine += " /allusers"; },
    (proof) => { proof.target.createdFileTime = "116444736000000000"; },
    (proof) => { proof.native.processIdFromHandle += 1; },
    (proof) => { proof.target.parentPid = process.pid; },
    (proof) => { proof.broker.parentPid += 1; },
    (proof) => { proof.target.inJob = false; },
    (proof) => { proof.native.creationFlags |= 0x01000000; },
    (proof) => { proof.native.processHandleRetained = false; },
  ];
  const fixture = mockedInstaller(context, { commands: mutations.map((nativeMutation) => ({ nativeMutation })) });
  for (let index = 0; index < mutations.length; index += 1) {
    const action = {};
    await assert.rejects(() => runSilentResult(fixture.executable, ["/S", `/D=${fixture.installDir}`], { ...fixture.options, action }));
    assert.equal(fixture.launched[index].resumeCount, 0, "A mismatched native receipt cannot resume its target");
    assert.equal(action.state, "uncertain");
    assert.equal(action.identityVerified, false);
    assert.equal(canCompensateInstallerAction(action, { installDir: fixture.installDir }), false);
  }
});

test("a native anchor does not replace a present changed CIM root identity or hide sampler errors", async (context) => {
  const fixture = mockedInstaller(context, { commands: [{ ownershipFailure: true, staysRunning: true }] });
  const action = {};
  await assert.rejects(() => runSilentResult(fixture.executable, ["/S", `/D=${fixture.installDir}`], { ...fixture.options, action }));
  assert.equal(action.state, "uncertain");
  assert.equal(action.reconciled, false);
  assert.equal(canCompensateInstallerAction(action, { installDir: fixture.installDir }), false);
  const anchor = fixture.launched[0].main;
  for (const patch of [
    { createdAt: nativeDateFor(fixture.launched[0].instant + 1) },
    { executablePath: nativePython },
    { commandLine: `${anchor.commandLine} /allusers` },
    { parentPid: process.pid },
    { executablePath: null },
  ]) {
    assert.throws(() => releaseHelpers.reconcileInstallerProcesses([{ ...anchor, ...patch }], { ...action.ownership, kind: "silent" }, [anchor]));
  }
});

test("a native exit receipt rejects a changed held handle image command arguments creation or ancestry proof", async (context) => {
  const mutations = [
    (exit) => { exit.pid += 1; },
    (exit) => { exit.createdFileTime = "116444736000000000"; },
    (exit) => { exit.executablePath = nativePython; },
    (exit) => { exit.commandLine += " /allusers"; },
    (exit) => { exit.args = [...exit.args, "/allusers"]; },
    (exit) => { exit.parentPid = process.pid; },
    (exit) => { exit.imageProvenAt = "unavailable"; },
    (exit) => { exit.handleRetained = false; },
    (exit) => { exit.signaled = false; },
  ];
  for (const nativeExitMutation of mutations) {
    const fixture = mockedInstaller(context, { commands: [{ nativeExitMutation, descendantsRemain: false }] });
    try {
      const action = {};
      await assert.rejects(() => runSilentResult(fixture.executable, ["/S", `/D=${fixture.installDir}`], { ...fixture.options, action }));
      assert.equal(fixture.launched.length, 1, "Each isolated exit mutation must reach the actual native adapter");
      assert.equal(fixture.launched[0].resumeCount, 1);
      assert.equal(action.state, "uncertain");
      assert.equal(action.identityVerified, false);
      assert.equal(action.reconciled, false);
      assert.equal(canCompensateInstallerAction(action, { installDir: fixture.installDir }), false);
    } finally {
      context.mock.restoreAll();
      syncBuiltinESMExports();
    }
  }
});

test("the real suspended native launch seam preserves exact handle identity for a genuine fast exit", async () => {
  const root = createIsolatedDirectory("native-launch-fast-smoke");
  const dataRoot = path.join(root, "data");
  const tempDir = path.join(root, "temp");
  fs.mkdirSync(dataRoot, { recursive: true });
  fs.mkdirSync(tempDir, { recursive: true });
  let completed = false;
  try {
    const result = await releaseHelpers.runNativeLaunchSmoke({ dataRoot, tempDir, timeoutMs: 15000 });
    assert.equal(result.exitCode, 7);
    assert.equal(result.stdout, "native-fast-exit\n");
    assert.equal(result.stderr, "native-fast-diagnostic\n");
    assert.equal(result.ownership.nativeLaunch.native.createdSuspended, true);
    assert.equal(result.ownership.nativeLaunch.native.processHandleRetained, true);
    assert.equal(result.ownership.nativeLaunch.broker.parentPid, process.pid);
    assert.equal(result.ownership.mainParentPid, result.ownership.nativeLaunch.broker.pid);
    assert.deepEqual(result.ownership.liveProcesses, []);
    assert.equal(result.nativeExit.createdFileTime, result.ownership.nativeLaunch.target.createdFileTime);
    assert.equal(result.nativeExit.handleRetained, true);
    assert.equal(result.nativeExit.signaled, true);
    assert.equal(result.nativeExit.imageProvenAt, "suspended");
    assert.equal(result.nativeExit.commandLine, result.ownership.nativeLaunch.target.commandLine);
    assert.deepEqual(result.nativeExit.args, result.ownership.nativeLaunch.target.args);
    assert.equal(result.nativeExit.parentPid, result.ownership.nativeLaunch.target.parentPid);
    console.log(`RELEASE_NATIVE_FAST_SMOKE ${JSON.stringify({ root, identity: result.ownership.nativeLaunch, nativeExit: result.nativeExit, exitCode: result.exitCode })}`);
    completed = true;
  } finally {
    if (completed) removeIsolatedDirectory(root);
  }
});
