import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createSetupService } from "../electron/main/setup.js";
import { createBackupService } from "../electron/main/backup/index.js";
import { createWorkspaceService } from "../electron/main/storage/workspaceService.js";
import { createVaultService } from "../electron/main/vault/index.js";
import { openWorkspaceDatabase, readAllRows, assembleWorkspace } from "../electron/main/storage/workspaceDb.js";
import { ensureDataRootMarker, isPathInside } from "../electron/main/storage/dataRoot.js";
import { createDialogs } from "../electron/main/dialogs.js";
import { exportFullBackup } from "../electron/main/backup/desktopExport.js";
import { convertBrowserPackage } from "../electron/main/backup/legacyConversion.js";
import { sha256File } from "../electron/main/backup/files.js";
import { createDesktopBackupContext, seedDesktopFullWorkspace, backupVaultFactory, seedBackupVault, readBackupVaultState } from "./desktop/backup-helpers.mjs";
import { createIsolatedDirectory, removeIsolatedDirectory, TASK_RUNTIME_ROOT } from "./desktop/helpers.mjs";
import { FIXTURE_TIME } from "./fixtures/full-workspace.mjs";
import { backupFixture, sortedEntities } from "./fixtures/backup-helpers.mjs";
import { requiredCollections } from "../src/backup/format.js";
import { normalizeLoadedWorkspace } from "../src/persistence/normalize.js";

const time = FIXTURE_TIME;

function fixture(context, extra = {}) {
  const root = createIsolatedDirectory("setup-unit");
  const setupTempDir = path.join(root, "life-atlas-setup-temporary");
  fs.mkdirSync(setupTempDir);
  const bootstrapFile = path.join(root, "bootstrap", "bootstrap.json");
  const dialogs = createDialogs({ testHooksEnabled: true });
  const exits = [];
  let relaunches = 0;
  const service = createSetupService({ bootstrapFile, setupTempDir, appVersion: "0.1.0", now: () => time, dialogs, createWorkspaceService, createBackupService, testHooksEnabled: true, exit: (code) => exits.push(code), relaunch: () => { relaunches += 1; }, ...extra });
  context.after(async () => { await service.stop(); removeIsolatedDirectory(root); });
  return { root, setupTempDir, bootstrapFile, service, dialogs, exits, relaunches: () => relaunches };
}

function readWorkspace(file) {
  const db = openWorkspaceDatabase(file);
  try { return assembleWorkspace(readAllRows(db)); } finally { db.close(); }
}

test("setup defaults and validation stay inside isolated test paths", async (context) => {
  const value = fixture(context, { isPackaged: true, installDir: path.join(TASK_RUNTIME_ROOT, "fake-install") });
  assert.ok(isPathInside(TASK_RUNTIME_ROOT, value.service.getDefaults().suggestedDataRoot));
  assert.equal(value.service.validateFolder({ path: "relative" }).level, "error");
  assert.equal(value.service.validateFolder({ path: path.join(TASK_RUNTIME_ROOT, "fake-install", "data") }).kind, "inside-install");
  assert.equal(value.service.validateFolder({ path: path.join(value.root, "missing") }).kind, "missing");
  const empty = path.join(value.root, "empty");
  fs.mkdirSync(empty);
  assert.equal(value.service.validateFolder({ path: empty }).kind, "empty");
  fs.writeFileSync(path.join(empty, "other.txt"), "keep");
  assert.equal(value.service.validateFolder({ path: empty }).kind, "not-empty");
  const sync = path.join(value.root, "OneDrive", "data");
  assert.equal(value.service.validateFolder({ path: sync }).kind, "sync-drive");
  const existing = path.join(value.root, "existing");
  ensureDataRootMarker(existing, { appVersion: "0.1.0", now: time });
  assert.equal(value.service.validateFolder({ path: existing }).kind, "existing-data-root");
});

test("wizard creates a blank workspace in the chosen folder", async (context) => {
  const value = fixture(context);
  const dataRoot = path.join(value.root, "chosen");
  await value.service.finish({ dataRoot, start: "blank" });
  const bootstrap = JSON.parse(fs.readFileSync(value.bootstrapFile, "utf8"));
  assert.equal(bootstrap.dataRoot, dataRoot);
  const workspace = readWorkspace(path.join(dataRoot, "workspace.db"));
  assert.equal(workspace.folders.filter((folder) => !folder.system).length, 1);
  assert.equal(workspace.folders.filter((folder) => folder.system === "inbox").length, 1);
  assert.equal(workspace.folders.length, 2);
  assert.equal(workspace.pages.length, 1);
  assert.equal(workspace.pages[0].title, "开始使用 Life Atlas");
  assert.deepEqual(value.exits, [0]);
  assert.equal(value.relaunches(), 0);
  assert.equal(fs.existsSync(path.join(dataRoot, ".lock")), false);
});

test("opening an existing data root leaves its database bytes unchanged", async (context) => {
  const value = fixture(context);
  const dataRoot = path.join(value.root, "existing-data");
  await seedDesktopFullWorkspace(dataRoot);
  const file = path.join(dataRoot, "workspace.db");
  const before = await sha256File(file);
  await value.service.finish({ dataRoot, start: "blank" });
  assert.deepEqual(await sha256File(file), before);
  assert.equal(JSON.parse(fs.readFileSync(value.bootstrapFile, "utf8")).dataRoot, dataRoot);
});

test("setup inspection creates no workspace or vault before the target is chosen", async (context) => {
  const source = await createDesktopBackupContext(context);
  const targetPath = path.join(source.dataRoot, "setup-source.lifeatlas");
  await exportFullBackup({ ...source, db: source.workspaceService.db, workspace: source.workspaceService.readWorkspace(), targetPath });
  const value = fixture(context);
  value.dialogs.state.queue.showOpenDialog.push([targetPath]);
  const inspected = await value.service.inspectBackup();
  assert.ok(inspected.token);
  assert.equal(fs.existsSync(path.join(value.setupTempDir, "workspace.db")), false);
  assert.equal(fs.existsSync(path.join(value.setupTempDir, "vault.db")), false);
  const dataRoot = path.join(value.root, "restored");
  await value.service.finish({ dataRoot, start: "restore", token: inspected.token });
  const restored = readWorkspace(path.join(dataRoot, "workspace.db"));
  assert.equal(restored.pages.length, source.workspaceService.readWorkspace().pages.length);
  assert.equal(restored.databaseItems.length, source.workspaceService.readWorkspace().databaseItems.length);
  assert.ok(restored.attachments.every((entry) => entry.provider === "asset" && /^[a-f0-9]{64}$/.test(entry.storageKey)));
  assert.equal(fs.existsSync(path.join(dataRoot, ".lock")), false);
});

test("invalid target folders never create bootstrap or overwrite unrelated files", async (context) => {
  const value = fixture(context);
  const dataRoot = path.join(value.root, "unrelated");
  fs.mkdirSync(dataRoot);
  const file = path.join(dataRoot, "keep.txt");
  fs.writeFileSync(file, "unrelated");
  await assert.rejects(value.service.finish({ dataRoot, start: "blank" }), { code: "E_INVALID_ARGUMENT" });
  assert.equal(fs.readFileSync(file, "utf8"), "unrelated");
  assert.equal(fs.existsSync(value.bootstrapFile), false);
  assert.deepEqual(value.exits, []);
});

test("the wizard imports a browser migration package with every entity and asset", async (context) => {
  const browser = await backupFixture();
  const value = fixture(context);
  const filePath = path.join(value.root, "browser-migration.lifeatlas");
  fs.writeFileSync(filePath, browser.bytes);
  value.dialogs.state.queue.showOpenDialog.push([filePath]);
  const inspected = await value.service.inspectBackup();
  assert.equal(inspected.summary.platform, "browser");
  assert.equal(fs.existsSync(path.join(value.setupTempDir, "workspace.db")), false);
  const dataRoot = path.join(value.root, "browser-restored");
  await value.service.finish({ dataRoot, start: "restore", token: inspected.token });
  const actual = readWorkspace(path.join(dataRoot, "workspace.db"));
  const assets = JSON.parse(Buffer.from(browser.files.get("assets/index.json")).toString("utf8"));
  const converted = await convertBrowserPackage(browser.workspace, assets, { putAsset: (bytes) => { const assetId = createHash("sha256").update(bytes).digest("hex"); return { assetId, url: `life-asset://${assetId}` }; } });
  assert.deepEqual(converted.report.leftovers, []);
  const expected = normalizeLoadedWorkspace(converted.workspace, { fallbackWorkspace: converted.workspace, now: time });
  for (const collection of requiredCollections(browser.workspace.schemaVersion)) assert.deepEqual(sortedEntities(actual[collection]), sortedEntities(expected[collection]), collection);
  assert.deepEqual(actual.ui, expected.ui);
  assert.equal(actual.attachments.length, 3);
  assert.equal(actual.attachments.every((entry) => entry.provider === "asset" && entry.storageKey === entry.checksum), true);
  for (const entry of actual.attachments) assert.equal((await sha256File(path.join(dataRoot, "assets", entry.checksum.slice(0, 2), entry.checksum))).sha256, entry.checksum);
  assert.equal(fs.existsSync(path.join(dataRoot, "vault.db")), false);
  assert.deepEqual(value.exits, [0]);
});

test("the wizard imports an encrypted full backup and preserves the production vault", async (context) => {
  const backupPassword = "Backup-Pass-2026!";
  const source = await createDesktopBackupContext(context, { vaultService: backupVaultFactory({ production: true }) });
  const seeded = await seedBackupVault(source.vaultService);
  const expectedVault = await readBackupVaultState(source.vaultService, seeded.ids);
  const dialogs = createDialogs({ testHooksEnabled: true });
  const filePath = path.join(source.dataRoot, "setup-encrypted.lifeatlas");
  dialogs.state.queue.showSaveDialog.push(filePath);
  const exporting = createBackupService({ ...source, dialogs, requestFlush: async () => true, requestConfirmation: async () => "confirmed" });
  context.after(() => exporting.stop());
  await exporting.exportFull({ includeVault: true, encryptPassword: backupPassword });
  await exporting.stop();
  const value = fixture(context);
  value.dialogs.state.queue.showOpenDialog.push([filePath]);
  const request = await value.service.inspectBackup();
  assert.equal(request.needsPassword, true);
  const inspected = await value.service.inspectBackupWithPassword({ inspectId: request.inspectId, password: backupPassword });
  assert.equal(inspected.summary.vault.itemCount, 10);
  assert.equal(inspected.summary.encrypted, true);
  assert.equal(fs.existsSync(path.join(value.setupTempDir, "workspace.db")), false);
  assert.equal(fs.existsSync(path.join(value.setupTempDir, "vault.db")), false);
  const dataRoot = path.join(value.root, "encrypted-restored");
  await value.service.finish({ dataRoot, start: "restore", token: inspected.token });
  const actual = readWorkspace(path.join(dataRoot, "workspace.db"));
  const expected = source.workspaceService.readWorkspace();
  for (const collection of requiredCollections(expected.schemaVersion)) assert.deepEqual(sortedEntities(actual[collection]), sortedEntities(expected[collection]), collection);
  assert.deepEqual(actual.ui, expected.ui);
  for (const entry of source.assetStore.list()) assert.deepEqual(await sha256File(path.join(dataRoot, "assets", entry.sha256.slice(0, 2), entry.sha256)), await sha256File(source.assetStore.filePath(entry.sha256)));
  const vault = createVaultService({ dataRoot, appVersion: "0.1.0", clock: { now: () => Date.parse(time) } });
  try {
    assert.equal(vault.status().locked, true);
    await vault.unlock({ password: seeded.password });
    assert.deepEqual(await readBackupVaultState(vault, seeded.ids), expectedVault);
  } finally { vault.lock("app-quit"); vault.closeDatabase(); }
  assert.deepEqual(fs.readdirSync(value.setupTempDir), []);
  assert.deepEqual(value.exits, [0]);
});
