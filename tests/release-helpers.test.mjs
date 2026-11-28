import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { createVaultService } from "../electron/main/vault/index.js";
import { KDF_PARAMS } from "../electron/main/vault/crypto.js";
import { lastTwoGroups } from "../electron/main/vault/recoveryKey.js";
import { seedVault } from "./desktop/seed-vault.mjs";
import { createIsolatedDirectory, removeIsolatedDirectory, REPO_ROOT, seedWorkspaceDatabase, TASK_RUNTIME_ROOT } from "./desktop/helpers.mjs";
import { createMarkers, TEST_PASSWORD, vaultItemInputs } from "./fixtures/vault-items.mjs";
import { fullWorkspace } from "./fixtures/full-workspace.mjs";
import { upgradeWorkspace } from "../src/persistence/migrations.js";
import { BACKUP_COLLECTIONS } from "../src/backup/format.js";
import { canCompensateInstallerAction, closeAppGracefully, INSTALL_TEST_NAME, installTestInstaller, logEvents, parseQuietUninstallString, readVaultRows, readWorkspaceState, reconcileInstallerProcesses, releaseAppEnvironment, runSilent, selectOwnedReleaseProcesses, snapshotDirs, startApp, treeHash, uninstallEntries, waitFor } from "./release/helpers.mjs";

test("the vault seed helper creates a locked confirmed vault", async (context) => {
  const dataRoot = createIsolatedDirectory("release-vault-seed");
  context.after(() => removeIsolatedDirectory(dataRoot));
  const inputs = vaultItemInputs(createMarkers()).slice(0, 2);
  const result = await seedVault(dataRoot, { password: TEST_PASSWORD, inputs });
  assert.deepEqual(Object.keys(result), ["recoveryKey"]);
  assert.equal(typeof result.recoveryKey, "string");
  assert.ok(result.recoveryKey.length > 20);
  const file = path.join(dataRoot, "vault.db");
  assert.equal(fs.existsSync(file), true);
  const service = createVaultService({ dataRoot });
  try {
    const status = service.status();
    assert.equal(status.exists, true);
    assert.equal(status.locked, true);
    assert.equal(status.recoveryConfirmed, true);
  } finally { service.closeDatabase(); }
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const header = JSON.parse(db.prepare("SELECT json FROM vault_header WHERE id = 1").get().json);
    assert.equal(Number.isFinite(Date.parse(header.createdAt)), true);
    for (const [name, value] of Object.entries(KDF_PARAMS)) assert.equal(header.kdf[name], value, name);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM vault_items").get().count, inputs.length);
  } finally { db.close(); }
});

test("vault timestamps preserve injected numeric function and method clocks", async (context) => {
  const instant = Date.UTC(2026, 10, 7, 1, 2, 3);
  for (const clock of [() => instant, { instant, now() { return this.instant; } }]) {
    const dataRoot = createIsolatedDirectory("release-vault-clock");
    context.after(() => removeIsolatedDirectory(dataRoot));
    const service = createVaultService({ dataRoot, clock });
    try {
      const { recoveryKey } = await service.create({ password: TEST_PASSWORD });
      service.confirmRecoveryKey({ lastTwoGroups: lastTwoGroups(recoveryKey) });
      const { summary } = service.createItem({ input: vaultItemInputs(createMarkers())[0] });
      assert.equal(service.getItem({ id: summary.id }).item.createdAt, new Date(instant).toISOString());
      service.lock("app-quit");
      assert.equal(service.status().locked, true);
      assert.equal(service.status().recoveryConfirmed, true);
    } finally { service.lock("app-quit"); service.closeDatabase(); }
    const db = new DatabaseSync(path.join(dataRoot, "vault.db"), { readOnly: true });
    try { assert.equal(JSON.parse(db.prepare("SELECT json FROM vault_header WHERE id = 1").get().json).createdAt, new Date(instant).toISOString()); }
    finally { db.close(); }
  }
});

test("the vault seed helper rejects paths outside task runtime", async () => {
  await assert.rejects(() => seedVault(path.dirname(TASK_RUNTIME_ROOT), { password: TEST_PASSWORD, inputs: [] }), /当前任务的物理 runtime/);
});

test("release helpers force runtime roots after environment overrides", (context) => {
  const root = createIsolatedDirectory("release-environment");
  context.after(() => removeIsolatedDirectory(root));
  const dataRoot = path.join(root, "data");
  const tempDir = path.join(root, "installer-temp");
  const env = releaseAppEnvironment(dataRoot, { LIFE_ATLAS_DATA_ROOT: "D:/LifeAtlas", LIFE_ATLAS_BOOTSTRAP_DIR: "C:/Users/example-user/AppData/Roaming/Life Atlas", TEMP: "C:/Users/example-user/AppData/Local/Temp", TMP: "D:/unowned", ELECTRON_RUN_AS_NODE: "1", RELEASE_TEST_VALUE: "retained" }, { tempDir });
  assert.equal(env.LIFE_ATLAS_DATA_ROOT, path.resolve(dataRoot));
  assert.equal(env.LIFE_ATLAS_BOOTSTRAP_DIR, path.resolve(dataRoot, "runtime", "bootstrap"));
  assert.equal(env.TEMP, path.resolve(tempDir));
  assert.equal(env.TMP, path.resolve(tempDir));
  assert.equal(env.ELECTRON_RUN_AS_NODE, "1");
  assert.equal(env.RELEASE_TEST_VALUE, "retained");
  assert.equal(fs.existsSync(dataRoot), false);
});

test("release helper paths reject real-data and installer traversal targets", async () => {
  assert.equal(INSTALL_TEST_NAME, "Life Atlas Install Test");
  assert.throws(() => installTestInstaller("../1.0.0"), /x.y.z/);
  assert.throws(() => installTestInstaller("1.0.0/../../release"), /x.y.z/);
  assert.throws(() => installTestInstaller("987654321.0.0"), /先运行 node scripts\/desktop-build\.mjs release --install-test/);
  assert.throws(() => uninstallEntries("Life Atlas"), /只能查询 Life Atlas Install Test/);
  assert.throws(() => uninstallEntries("Life Atlas Install Test'; Remove-Item"), /只能查询/);
  assert.throws(() => releaseAppEnvironment(path.dirname(TASK_RUNTIME_ROOT)), /当前任务的物理 runtime/);
  assert.throws(() => startApp("relative.exe", TASK_RUNTIME_ROOT), /绝对路径/);
  await assert.rejects(() => runSilent("relative.exe", ["/S"]), /绝对路径/);
  await assert.rejects(() => runSilent("relative.exe", ["/S"], { timeoutMs: 0 }), /期限无效/);
});

test("release polling accepts truthy results and preserves failures", async () => {
  let checks = 0;
  const result = await waitFor(() => ++checks === 3 ? { complete: true } : false, { timeoutMs: 100, intervalMs: 1, message: "not complete" });
  assert.deepEqual(result, { complete: true });
  assert.equal(checks, 3);
  const failure = new Error("read failed");
  await assert.rejects(() => waitFor(() => { throw failure; }, { timeoutMs: 100 }), (error) => error === failure);
  await assert.rejects(() => waitFor(() => true, { timeoutMs: -1 }), /期限或间隔无效/);
});

test("release polling enforces the supplied deadline", async () => {
  let checks = 0;
  await assert.rejects(() => waitFor(() => { checks += 1; return false; }, { timeoutMs: 0, intervalMs: 1, message: "exact deadline" }), /exact deadline/);
  assert.equal(checks, 1);
});

test("release process ownership rejects reused pids and unowned descendants", (context) => {
  const root = createIsolatedDirectory("release-process-owner");
  context.after(() => removeIsolatedDirectory(root));
  const executablePath = path.join(root, `${INSTALL_TEST_NAME}.exe`);
  const runtimeDir = path.join(root, "data", "runtime");
  const createdAt = "2026-11-07T12:00:00.0000000Z";
  const ownership = { kind: "app", mainPid: 100, launcherPid: 100, executablePath, runtimeDir, mainCreatedAt: createdAt, launcherCreatedAt: createdAt };
  const main = { pid: 100, parentPid: 99, executablePath, createdAt, commandLine: `"${executablePath}"` };
  const renderer = { pid: 101, parentPid: 100, executablePath, createdAt: "2026-11-07T12:00:01.0000000Z", commandLine: `"${executablePath}" --type=renderer --user-data-dir="${runtimeDir}"` };
  const unowned = { ...renderer, pid: 103, parentPid: 102 };
  assert.deepEqual(selectOwnedReleaseProcesses([main, renderer, unowned], ownership).map((entry) => entry.pid), [100, 101]);
  assert.deepEqual(selectOwnedReleaseProcesses([renderer, unowned], ownership).map((entry) => entry.pid), [101]);
  assert.throws(() => selectOwnedReleaseProcesses([{ ...main, createdAt: renderer.createdAt }], ownership), /PID was reused/);
  assert.throws(() => selectOwnedReleaseProcesses([{ ...main, executablePath: "C:/Windows/notepad.exe" }], ownership), /executable changed/);
  assert.throws(() => selectOwnedReleaseProcesses([main, { ...renderer, commandLine: 'exe --user-data-dir="D:/unowned"' }], ownership), /unowned runtime/);
});

test("silent installer descendants must remain in the owned physical temp directory", (context) => {
  const root = createIsolatedDirectory("release-installer-owner");
  context.after(() => removeIsolatedDirectory(root));
  const executablePath = path.join(REPO_ROOT, "release", "install-test-1.0.0", `${INSTALL_TEST_NAME} Setup 1.0.0.exe`);
  const createdAt = "2026-11-07T12:00:00.0000000Z";
  const tempDir = path.join(root, "temp");
  const ownership = { kind: "silent", mainPid: 100, executablePath, mainCreatedAt: createdAt, tempDir };
  const main = { pid: 100, parentPid: 99, executablePath, createdAt, commandLine: `"${executablePath}" /S` };
  const descendant = { pid: 101, parentPid: 100, executablePath: path.join(tempDir, "ns-owned.tmp", "helper.exe"), createdAt: "2026-11-07T12:00:01.0000000Z", commandLine: "helper.exe" };
  assert.deepEqual(selectOwnedReleaseProcesses([main, descendant], ownership).map((entry) => entry.pid), [101, 100]);
  assert.throws(() => selectOwnedReleaseProcesses([main, { ...descendant, executablePath: "C:/Windows/notepad.exe" }], ownership), /当前任务的物理 runtime|Unexpected process/);
  assert.throws(() => selectOwnedReleaseProcesses([main, { ...descendant, createdAt: "2026-11-07T11:59:59.0000000Z" }], ownership), /predates/);
  assert.throws(() => selectOwnedReleaseProcesses([main, main], ownership), /Duplicate process IDs/);
});

test("release database readers preserve file hashes and raw vault blobs", async (context) => {
  const root = createIsolatedDirectory("release-database-reader");
  context.after(() => removeIsolatedDirectory(root));
  const expected = await seedWorkspaceDatabase(root, upgradeWorkspace(fullWorkspace()));
  const db = new DatabaseSync(path.join(root, "vault.db"));
  const firstBlob = Buffer.from([0, 255, 8, 9]);
  const secondBlob = Buffer.from([12, 0, 127]);
  try {
    db.exec("CREATE TABLE vault_header(id INTEGER PRIMARY KEY,json TEXT NOT NULL); CREATE TABLE vault_items(id TEXT PRIMARY KEY,blob BLOB NOT NULL);");
    db.prepare("INSERT INTO vault_header VALUES(?,?)").run(1, '{"encrypted":"raw-header"}');
    const insert = db.prepare("INSERT INTO vault_items VALUES(?,?)");
    insert.run("z-item", secondBlob);
    insert.run("a-item", firstBlob);
  } finally { db.close(); }
  const before = await treeHash(root);
  const state = readWorkspaceState(root);
  assert.equal(state.meta.schemaVersion, expected.schemaVersion);
  assert.deepEqual(state.meta.ui, expected.ui);
  for (const collection of BACKUP_COLLECTIONS) assert.deepEqual(state.entities[collection], Object.fromEntries((expected[collection] || []).map((entity) => [entity.id, entity])), collection);
  assert.deepEqual(readVaultRows(root), { header: [{ id: 1, json: '{"encrypted":"raw-header"}' }], items: [{ id: "a-item", blob: firstBlob }, { id: "z-item", blob: secondBlob }] });
  assert.equal(await treeHash(root), before);
});

test("release database readers fail closed while a data root is locked", (context) => {
  const root = createIsolatedDirectory("release-database-lock");
  context.after(() => removeIsolatedDirectory(root));
  fs.writeFileSync(path.join(root, ".lock"), "{}", "utf8");
  assert.throws(() => readWorkspaceState(root), /应用关闭后/);
  assert.throws(() => readVaultRows(root), /应用关闭后/);
  assert.deepEqual(fs.readdirSync(root), [".lock"]);
});

test("release database readers never ignore an uncheckpointed WAL", async (context) => {
  const root = createIsolatedDirectory("release-database-wal");
  context.after(() => removeIsolatedDirectory(root));
  fs.writeFileSync(path.join(root, "workspace.db"), "not opened", "utf8");
  fs.writeFileSync(path.join(root, "workspace.db-wal"), Buffer.from([1, 2, 3]));
  const before = await treeHash(root);
  assert.throws(() => readWorkspaceState(root), /未完成的 WAL.*保留现场/);
  assert.equal(await treeHash(root), before);
});

test("release tree hashes match the specified sorted relative-path format", async (context) => {
  const root = createIsolatedDirectory("release-tree-hash");
  context.after(() => removeIsolatedDirectory(root));
  fs.mkdirSync(path.join(root, "sub"));
  fs.mkdirSync(path.join(root, "empty"));
  fs.writeFileSync(path.join(root, "z.bin"), Buffer.from([0, 255, 4]));
  fs.writeFileSync(path.join(root, "sub", "a.txt"), "Unicode 中文", "utf8");
  const rows = [
    ["sub/a.txt", Buffer.from("Unicode 中文", "utf8")],
    ["z.bin", Buffer.from([0, 255, 4])],
  ].map(([relative, bytes]) => `${relative}\0${createHash("sha256").update(bytes).digest("hex")}\n`).join("");
  assert.equal(await treeHash(root), createHash("sha256").update(rows).digest("hex"));
  await assert.rejects(() => treeHash(path.dirname(TASK_RUNTIME_ROOT)), /当前任务的物理 runtime/);
});

test("release logs and snapshots are physically confined and deterministic", (context) => {
  const root = createIsolatedDirectory("release-log-reader");
  context.after(() => removeIsolatedDirectory(root));
  assert.deepEqual(logEvents(root), []);
  assert.deepEqual(snapshotDirs(root), []);
  fs.mkdirSync(path.join(root, "logs"));
  fs.writeFileSync(path.join(root, "logs", "b.log"), '{"event":"window.created"}\r\n', "utf8");
  fs.writeFileSync(path.join(root, "logs", "a.log"), '{"event":"app.start"}\n\n', "utf8");
  fs.writeFileSync(path.join(root, "logs", "ignored.txt"), "not json", "utf8");
  assert.deepEqual(logEvents(root), [{ event: "app.start" }, { event: "window.created" }]);
  fs.mkdirSync(path.join(root, "snapshots", "z-pre-upgrade"), { recursive: true });
  fs.mkdirSync(path.join(root, "snapshots", "a-daily"));
  fs.writeFileSync(path.join(root, "snapshots", "ignored.json"), "{}", "utf8");
  assert.deepEqual(snapshotDirs(root), ["a-daily", "z-pre-upgrade"]);
  fs.writeFileSync(path.join(root, "logs", "c.log"), "malformed", "utf8");
  assert.throws(() => logEvents(root), SyntaxError);
});

test("quiet uninstall parsing rejects shell expansion and other products", (context) => {
  const root = createIsolatedDirectory("release-uninstall-parser");
  context.after(() => removeIsolatedDirectory(root));
  const installDir = path.join(root, "app");
  const exe = path.join(installDir, `Uninstall ${INSTALL_TEST_NAME}.exe`);
  assert.deepEqual(parseQuietUninstallString(`"${exe}" /currentuser /S`, { installDir }), { exe, args: ["/currentuser", "/S"] });
  assert.throws(() => parseQuietUninstallString(`"${path.join(installDir, "Uninstall Life Atlas.exe")}" /S`), /非安装测试版/);
  assert.throws(() => parseQuietUninstallString(`"${exe}" /S & cmd.exe`), /参数无效/);
  assert.throws(() => parseQuietUninstallString(`"${exe}" /S /D=D:/unowned`), /参数无效/);
  assert.throws(() => parseQuietUninstallString(`"${exe}" /S`, { installDir: path.join(root, "another") }), /本次安装目录/);
  assert.throws(() => parseQuietUninstallString(`"C:/Users/example-user/AppData/Local/Programs/${INSTALL_TEST_NAME}/Uninstall ${INSTALL_TEST_NAME}.exe" /S`), /当前任务的物理 runtime/);
});

test("release process closing refuses untracked children", async () => {
  await assert.rejects(() => closeAppGracefully({ pid: 1, exitCode: null, signalCode: null }), /不是本辅助程序启动/);
});

test("release paths reject an external scope before any lstat", async (context) => {
  const root = createIsolatedDirectory("release-lexical-boundary");
  context.after(() => removeIsolatedDirectory(root));
  const dataRoot = path.join(root, "data");
  const tempDir = path.join(root, "temp");
  const allowedExe = path.join(root, `${INSTALL_TEST_NAME}.exe`);
  const outside = path.resolve(TASK_RUNTIME_ROOT, "..", "release-outside-sentinel");
  let metadataReads = 0;
  context.mock.method(fs, "lstatSync", () => { metadataReads += 1; throw new Error("unexpected filesystem metadata access"); });
  try {
    assert.throws(() => releaseAppEnvironment(outside), /当前任务的物理 runtime/);
    assert.throws(() => releaseAppEnvironment(dataRoot, {}, { tempDir: outside }), /当前任务的物理 runtime/);
    assert.throws(() => startApp(allowedExe, outside), /当前任务的物理 runtime/);
    assert.throws(() => startApp(path.join(outside, `${INSTALL_TEST_NAME}.exe`), dataRoot), /项目 release 或当前任务物理 runtime/);
    assert.throws(() => parseQuietUninstallString(`"${path.join(outside, `Uninstall ${INSTALL_TEST_NAME}.exe`)}" /S`), /当前任务的物理 runtime/);
    assert.throws(() => parseQuietUninstallString(`"${path.join(root, `Uninstall ${INSTALL_TEST_NAME}.exe`)}" /S`, { installDir: outside }), /当前任务的物理 runtime/);
    assert.throws(() => readWorkspaceState(outside), /当前任务的物理 runtime/);
    assert.throws(() => readVaultRows(outside), /当前任务的物理 runtime/);
    assert.throws(() => logEvents(outside), /当前任务的物理 runtime/);
    assert.throws(() => snapshotDirs(outside), /当前任务的物理 runtime/);
    await assert.rejects(() => treeHash(outside), /当前任务的物理 runtime/);
    await assert.rejects(() => runSilent(allowedExe, [], { dataRoot: outside, tempDir }), /当前任务的物理 runtime/);
    await assert.rejects(() => runSilent(allowedExe, [], { dataRoot, tempDir: outside }), /当前任务的物理 runtime/);
    await assert.rejects(() => runSilent(path.join(outside, `${INSTALL_TEST_NAME}.exe`), [], { dataRoot, tempDir }), /项目 release 或当前任务物理 runtime/);
    assert.equal(metadataReads, 0);
  } finally { context.mock.restoreAll(); }
});

test("release profile argv overrides never reach filesystem access or spawn", async (context) => {
  const root = createIsolatedDirectory("release-profile-argv");
  context.after(() => removeIsolatedDirectory(root));
  const dataRoot = path.join(root, "data");
  const tempDir = path.join(root, "temp");
  const exe = path.join(root, `${INSTALL_TEST_NAME}.exe`);
  let metadataReads = 0;
  context.mock.method(fs, "lstatSync", () => { metadataReads += 1; throw new Error("unexpected filesystem metadata access"); });
  try {
    for (const flag of ["user-data-dir", "profile-directory", "disk-cache-dir", "crash-dumps-dir"]) {
      for (const args of [[`--${flag}`, "D:/release-unowned-profile"], [`--${flag}=D:/release-unowned-profile`], [`--${flag.toUpperCase()}`, "D:/release-unowned-profile"], [`-${flag}=D:/release-unowned-profile`], [`/${flag}=D:/release-unowned-profile`]]) {
        assert.throws(() => startApp(exe, dataRoot, { args }), /不能覆盖本次隔离 profile/);
        await assert.rejects(() => runSilent(exe, args, { dataRoot, tempDir }), /不能覆盖本次隔离 profile/);
      }
    }
    assert.equal(metadataReads, 0);
  } finally { context.mock.restoreAll(); }
  assert.equal(fs.existsSync(dataRoot), false);
  assert.equal(fs.existsSync(tempDir), false);
});

function installerReconciliationFixture() {
  const root = path.join(TASK_RUNTIME_ROOT, "installer-reconciliation-pure");
  const installDir = path.join(root, "app");
  const tempDir = path.join(root, "temp");
  const executablePath = path.join(REPO_ROOT, "release", "install-test-1.0.0", `${INSTALL_TEST_NAME} Setup 1.0.0.exe`);
  const main = { pid: 100, parentPid: 99, executablePath, createdAt: "2026-11-07T12:00:00.0000000Z", commandLine: `"${executablePath}" /S /D=${installDir}` };
  const descendant = { pid: 101, parentPid: 100, executablePath: path.join(tempDir, "ns-owned.tmp", "helper.exe"), createdAt: "2026-11-07T12:00:01.0000000Z", commandLine: "helper.exe /S" };
  const grandchild = { pid: 102, parentPid: 101, executablePath: path.join(tempDir, "ns-owned.tmp", "worker.exe"), createdAt: "2026-11-07T12:00:02.0000000Z", commandLine: "worker.exe /S" };
  const ownership = { kind: "silent", mainPid: main.pid, mainParentPid: main.parentPid, mainCreatedAt: main.createdAt, mainCommandLine: main.commandLine, executablePath, tempDir };
  return { installDir, main, descendant, grandchild, ownership };
}

test("installer reconciliation remembers a parent that disappears before its descendant", () => {
  const { main, descendant, grandchild, ownership } = installerReconciliationFixture();
  const first = reconcileInstallerProcesses([main, descendant], ownership);
  assert.deepEqual(first.liveProcesses, [descendant, main]);
  const second = reconcileInstallerProcesses([grandchild], ownership, first.observedProcesses);
  assert.deepEqual(second.liveProcesses, [grandchild]);
  assert.deepEqual(second.observedProcesses, [main, descendant, grandchild]);
  const stopped = reconcileInstallerProcesses([], ownership, second.observedProcesses);
  assert.deepEqual(stopped.liveProcesses, []);
  assert.deepEqual(stopped.observedProcesses, [main, descendant, grandchild]);
});

test("installer reconciliation rejects remembered identity changes and unassigned temp processes", () => {
  const { main, descendant, grandchild, ownership } = installerReconciliationFixture();
  const first = reconcileInstallerProcesses([main, descendant], ownership);
  assert.throws(() => reconcileInstallerProcesses([{ ...descendant, createdAt: grandchild.createdAt }], ownership, first.observedProcesses), /PID was reused/);
  assert.throws(() => reconcileInstallerProcesses([{ ...descendant, executablePath: grandchild.executablePath }], ownership, first.observedProcesses), /executable changed/);
  assert.throws(() => reconcileInstallerProcesses([{ ...descendant, commandLine: "helper.exe /different" }], ownership, first.observedProcesses), /command line changed/);
  assert.throws(() => reconcileInstallerProcesses([{ ...descendant, parentPid: 999 }], ownership, first.observedProcesses), /ancestry changed/);
  assert.throws(() => reconcileInstallerProcesses([descendant, descendant], ownership, first.observedProcesses), /Duplicate process IDs/);
  assert.throws(() => reconcileInstallerProcesses([{ ...grandchild, pid: 103, parentPid: 999 }], ownership, first.observedProcesses), /Unassigned installer descendant/);
  const unrelated = { ...grandchild, pid: 104, parentPid: 999, executablePath: path.join(path.parse(TASK_RUNTIME_ROOT).root, "unowned", path.basename(ownership.executablePath)) };
  assert.deepEqual(reconcileInstallerProcesses([unrelated], ownership, first.observedProcesses).liveProcesses, []);
});

test("installer compensation requires a settled owned install or upgrade for the exact directory", () => {
  const { installDir, main, ownership } = installerReconciliationFixture();
  const stopped = reconcileInstallerProcesses([], ownership, [main]);
  const action = { operation: "install", state: "settled", observedClose: true, identityVerified: true, reconciled: true, directoryOwned: true, installDir, succeeded: false, ownership, ...stopped };
  assert.equal(canCompensateInstallerAction(action, { installDir }), true);
  assert.equal(canCompensateInstallerAction({ ...action, operation: "upgrade" }, { installDir }), true);
  for (const changes of [{ operation: "uninstall" }, { state: "running" }, { state: "uncertain" }, { observedClose: false }, { identityVerified: false }, { reconciled: false }, { directoryOwned: false }, { liveProcesses: [main] }]) assert.equal(canCompensateInstallerAction({ ...action, ...changes }, { installDir }), false);
  assert.equal(canCompensateInstallerAction(action, { installDir: path.join(installDir, "other") }), false);
  assert.equal(canCompensateInstallerAction(undefined, { installDir }), false);
  assert.equal(canCompensateInstallerAction({}, { installDir }), false);
});
