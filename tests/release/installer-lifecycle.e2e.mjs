import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { getCurrentFuseWire } from "@electron/fuses";
import { createAssetStore } from "../../electron/main/storage/assetStore.js";
import { assertPhysicalPath } from "../../electron/main/storage/dataRoot.js";
import { openWorkspaceDatabase, prepareWritable } from "../../electron/main/storage/workspaceDb.js";
import { BACKUP_COLLECTIONS } from "../../src/backup/format.js";
import { upgradeWorkspace } from "../../src/persistence/migrations.js";
import { fullWorkspace, fullWorkspaceAttachmentBytes, FIXTURE_TIME } from "../fixtures/full-workspace.mjs";
import { createMarkers, TEST_PASSWORD, vaultItemInputs } from "../fixtures/vault-items.mjs";
import { assertTestPath, createIsolatedDirectory, removeIsolatedDirectory, REPO_ROOT, seedWorkspaceDatabase } from "../desktop/helpers.mjs";
import { seedVault } from "../desktop/seed-vault.mjs";
import { canCompensateInstallerAction, closeAppGracefully, INSTALL_TEST_NAME, installTestInstaller, logEvents, parseQuietUninstallString, readVaultRows, readWorkspaceState, runningInstallTestProcesses, runSilent, snapshotDirs, startApp, treeHash, uninstallEntries, waitFor } from "./helpers.mjs";

const FUSE_BYTES = [48, 49, 48, 48, 49, 49, 48, 48];
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const lifecycle = (step, result) => console.log(`LIFECYCLE ${step} ${JSON.stringify(result)}`);

function verifyInstallation(installDir, version) {
  const entries = uninstallEntries(INSTALL_TEST_NAME);
  assert.equal(entries.length, 1, "必须只有本次安装测试版卸载项");
  assert.equal(entries[0].DisplayName, `${INSTALL_TEST_NAME} ${version}`);
  assert.equal(entries[0].DisplayVersion, version);
  parseQuietUninstallString(entries[0].QuietUninstallString, { installDir });
  return entries[0];
}

function assertEntitiesUnchanged(actual, expected) {
  for (const collection of BACKUP_COLLECTIONS) {
    assert.deepEqual(Object.keys(actual[collection]), Object.keys(expected[collection]), `${collection}: entity IDs changed`);
    for (const id of Object.keys(expected[collection])) assert.deepEqual(actual[collection][id], expected[collection][id], `${collection}/${id}: entity changed`);
  }
}

function assertOwnedRootHasNoLiveExecutables(root) {
  const directory = assertTestPath(root);
  const script = "$prefix = $env:LIFE_ATLAS_RELEASE_CLEANUP_ROOT.TrimEnd([char]92) + [char]92; [pscustomobject]@{ records = @(Get-CimInstance -ClassName Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase) } | Select-Object ProcessId, ExecutablePath) } | ConvertTo-Json -Depth 4 -Compress";
  const output = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, encoding: "utf8", timeout: 10000, env: { ...process.env, LIFE_ATLAS_RELEASE_CLEANUP_ROOT: directory } });
  assert.deepEqual(JSON.parse(output.trim()).records, [], "本次安装临时目录仍有程序运行，保留现场");
}

test("the install test build installs upgrades and uninstalls without touching data", async () => {
  let root;
  let dataRoot;
  let installDir;
  let exe;
  let child;
  let commandOptions;
  let installerAction;
  let installationOwned = false;
  let completed = false;
  let activeStep = 1;
  let failure;
  try {
    const entries = uninstallEntries(INSTALL_TEST_NAME);
    assert.equal(entries.length, 0, "发现既有 Life Atlas Install Test，无法确认属于本次运行；保留现场并报告，不自动卸载");
    const running = runningInstallTestProcesses();
    assert.equal(running.length, 0, "先关闭安装测试版；本测试不会终止既有进程");
    const version = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")).version;
    assert.equal(version, "1.0.0", "发布验收必须使用 1.0.0");
    const previousInstaller = installTestInstaller("0.9.0");
    const currentInstaller = installTestInstaller(version);
    lifecycle(1, { result: "verified", leftoverEntries: 0, runningProcesses: 0, previousInstaller, currentInstaller });

    activeStep = 2;
    root = createIsolatedDirectory("la-release");
    assert.equal(/\s/.test(root), false, "NSIS /D= 安装目录不能有空格");
    dataRoot = path.join(root, "data");
    installDir = path.join(root, "app");
    exe = path.join(installDir, `${INSTALL_TEST_NAME}.exe`);
    commandOptions = { dataRoot, tempDir: path.join(root, "installer-runtime") };
    assert.equal(fs.existsSync(installDir), false, "不要预先创建安装目录");
    const workspace = upgradeWorkspace(fullWorkspace());
    await seedWorkspaceDatabase(dataRoot, workspace);
    const bytesById = fullWorkspaceAttachmentBytes();
    assert.equal(bytesById.size, 3);
    const db = openWorkspaceDatabase(path.join(dataRoot, "workspace.db"));
    try {
      prepareWritable(db);
      const store = createAssetStore({ assetsDir: path.join(dataRoot, "assets"), db, now: FIXTURE_TIME });
      for (const [id, bytes] of bytesById) {
        const attachment = workspace.attachments.find((entry) => entry.id === id);
        assert.ok(attachment, `Missing fixture attachment ${id}`);
        store.put({ bytes, mime: attachment.mime, name: attachment.name });
      }
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM assets").get().count, 3);
    } finally { db.close(); }
    const inputs = vaultItemInputs(createMarkers());
    await seedVault(dataRoot, { password: TEST_PASSWORD, inputs });
    lifecycle(2, { result: "seeded", root, dataRoot, installDir, assets: bytesById.size, vaultItems: inputs.length });

    activeStep = 3;
    installerAction = {};
    assert.equal(await runSilent(previousInstaller, ["/S", `/D=${installDir}`], { ...commandOptions, action: installerAction }), 0);
    installationOwned = true;
    assert.equal(fs.existsSync(assertPhysicalPath(exe, { root, allowMissing: false })), true);
    verifyInstallation(installDir, "0.9.0");
    const wire = await getCurrentFuseWire(exe);
    assert.deepEqual(Array.from({ length: 8 }, (unused, index) => wire[index]), FUSE_BYTES);
    lifecycle(3, { result: "installed", version: "0.9.0", installDir, fuses: FUSE_BYTES });

    activeStep = 4;
    let windowCount = logEvents(dataRoot).filter((entry) => entry.event === "window.created").length;
    child = startApp(exe, dataRoot);
    await waitFor(() => logEvents(dataRoot).filter((entry) => entry.event === "window.created").length > windowCount, { timeoutMs: 30000, message: "0.9.0 没有创建工作区窗口" });
    await delay(8000);
    assert.equal(child.exitCode, null, "0.9.0 提前退出");
    assert.equal(child.signalCode, null, "0.9.0 被意外终止");
    await closeAppGracefully(child);
    child = null;
    assert.equal(fs.existsSync(path.join(dataRoot, ".lock")), false);
    const initialState = readWorkspaceState(dataRoot);
    assert.equal(initialState.meta.lastAppVersion, "0.9.0");
    const before = { entities: initialState.entities, vault: readVaultRows(dataRoot), assets: await treeHash(path.join(dataRoot, "assets")), snapshots: snapshotDirs(dataRoot) };
    lifecycle(4, { result: "opened-and-closed", lastAppVersion: initialState.meta.lastAppVersion, assetsHash: before.assets, snapshots: before.snapshots });

    activeStep = 5;
    installerAction = {};
    assert.equal(await runSilent(currentInstaller, ["/S"], { ...commandOptions, action: installerAction }), 0);
    verifyInstallation(installDir, "1.0.0");
    assert.equal(fs.existsSync(assertPhysicalPath(exe, { root, allowMissing: false })), true);
    lifecycle(5, { result: "upgraded-in-place", version: "1.0.0", installDir });

    activeStep = 6;
    windowCount = logEvents(dataRoot).filter((entry) => entry.event === "window.created").length;
    child = startApp(exe, dataRoot);
    await waitFor(() => logEvents(dataRoot).filter((entry) => entry.event === "window.created").length > windowCount, { timeoutMs: 30000, message: "1.0.0 没有创建工作区窗口" });
    await delay(8000);
    assert.equal(child.exitCode, null, "1.0.0 提前退出");
    assert.equal(child.signalCode, null, "1.0.0 被意外终止");
    await closeAppGracefully(child);
    child = null;
    assert.equal(fs.existsSync(path.join(dataRoot, ".lock")), false);
    const after = readWorkspaceState(dataRoot);
    assert.equal(after.meta.lastAppVersion, "1.0.0");
    const newSnapshots = snapshotDirs(dataRoot).filter((directory) => !before.snapshots.includes(directory));
    const preUpgrade = newSnapshots.filter((directory) => directory.endsWith("-pre-upgrade"));
    assert.equal(preUpgrade.length, 1, "升级必须新增唯一 pre-upgrade 快照");
    const snapshotRoot = assertPhysicalPath(path.join(dataRoot, "snapshots", preUpgrade[0]), { root: dataRoot, allowMissing: false });
    const metadata = JSON.parse(fs.readFileSync(assertPhysicalPath(path.join(snapshotRoot, "snapshot.json"), { root: dataRoot, allowMissing: false }), "utf8"));
    assert.equal(metadata.reason, "pre-upgrade");
    assert.equal(Array.isArray(metadata.files), true);
    const snapshotFiles = metadata.files.map((entry) => entry.name);
    assert.equal(snapshotFiles.includes("workspace.db"), true);
    assert.equal(snapshotFiles.includes("vault.db"), true);
    for (const name of ["workspace.db", "vault.db"]) assert.equal(fs.statSync(assertPhysicalPath(path.join(snapshotRoot, name), { root: dataRoot, allowMissing: false })).isFile(), true);
    assertEntitiesUnchanged(after.entities, before.entities);
    assert.deepEqual(readVaultRows(dataRoot), before.vault, "升级不能改变密钥库头部与加密条目原始行");
    assert.equal(await treeHash(path.join(dataRoot, "assets")), before.assets);
    lifecycle(6, { result: "verified", lastAppVersion: after.meta.lastAppVersion, entities: "unchanged", vaultRows: "unchanged", assetsHash: before.assets, preUpgrade: preUpgrade[0], snapshotFiles });

    activeStep = 7;
    const dataHash = await treeHash(dataRoot);
    const uninstaller = assertPhysicalPath(path.join(installDir, `Uninstall ${INSTALL_TEST_NAME}.exe`), { root, allowMissing: false });
    installerAction = {};
    assert.equal(await runSilent(uninstaller, ["/S"], { ...commandOptions, action: installerAction }), 0);
    await waitFor(() => !fs.existsSync(exe), { timeoutMs: 60000, message: "安装测试版卸载后程序文件仍然存在" });
    await delay(2000);
    assert.deepEqual(uninstallEntries(INSTALL_TEST_NAME), []);
    assert.equal(typeof process.env.APPDATA, "string");
    const shortcut = assertPhysicalPath(path.join(process.env.APPDATA, "Microsoft", "Windows", "Start Menu", "Programs", `${INSTALL_TEST_NAME}.lnk`));
    assert.equal(fs.existsSync(shortcut), false, "安装测试版开始菜单快捷方式未删除");
    assert.equal(await treeHash(dataRoot), dataHash, "卸载不能改变数据目录任何文件");
    installationOwned = false;
    lifecycle(7, { result: "uninstalled", uninstallEntries: 0, startMenuShortcut: "absent", dataHash, data: "unchanged" });
    completed = true;
  } catch (error) {
    failure = error;
    lifecycle(activeStep, { result: "failed", message: error.message, root: root || null, installerAction: installerAction || null });
  } finally {
    const cleanupErrors = [];
    const failedAction = failure ? installerAction || null : null;
    if (child) {
      try { await closeAppGracefully(child); } catch (error) { cleanupErrors.push(error); }
    }
    const compensationAllowed = canCompensateInstallerAction(installerAction, { installDir });
    if (compensationAllowed) installationOwned = true;
    if (installationOwned && compensationAllowed && cleanupErrors.length === 0) {
      try {
        const entries = uninstallEntries(INSTALL_TEST_NAME);
        if (entries.length) {
          assert.equal(entries.length, 1, "卸载项归属不明确，保留现场");
          const command = parseQuietUninstallString(entries[0].QuietUninstallString, { installDir });
          assertPhysicalPath(command.exe, { root, allowMissing: false });
          installerAction = {};
          assert.equal(await runSilent(command.exe, command.args, { ...commandOptions, action: installerAction }), 0);
          await waitFor(() => !fs.existsSync(exe), { timeoutMs: 60000, message: "本次安装测试版安全卸载未完成" });
          await delay(2000);
          assert.deepEqual(uninstallEntries(INSTALL_TEST_NAME), []);
        }
      } catch (error) { cleanupErrors.push(error); }
    }
    if (root && completed && cleanupErrors.length === 0) {
      try { assertOwnedRootHasNoLiveExecutables(root); removeIsolatedDirectory(root); }
      catch (error) { cleanupErrors.push(error); }
    }
    if (root && (!completed || cleanupErrors.length) && installerAction) {
      try { fs.writeFileSync(assertPhysicalPath(path.join(root, "installer-action.json"), { root }), `${JSON.stringify({ failedAction, lastAction: installerAction }, null, 2)}\n`, "utf8"); }
      catch (error) { cleanupErrors.push(error); }
    }
    lifecycle(8, { result: !root ? "not-created" : completed && cleanupErrors.length === 0 ? "removed-owned-root" : "preserved-for-review", root: root || null, cleanupErrors: cleanupErrors.map((error) => error.message), installerAction: installerAction || null, appDataProfiles: "not-read-or-deleted" });
    if (cleanupErrors.length) failure = new AggregateError([...(failure ? [failure] : []), ...cleanupErrors], "安装测试版清理不能确认安全，保留本次目录");
  }
  if (failure) throw failure;
});
