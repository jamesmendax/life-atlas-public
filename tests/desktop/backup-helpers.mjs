import fs from "node:fs";
import path from "node:path";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { createAssetStore } from "../../electron/main/storage/assetStore.js";
import { openWorkspaceDatabase, prepareWritable, initializeWorkspace, replaceDatabaseWorkspace, readAllRows, assembleWorkspace } from "../../electron/main/storage/workspaceDb.js";
import { ensureDataRootMarker, assertPhysicalPath } from "../../electron/main/storage/dataRoot.js";
import { createWorkspaceService } from "../../electron/main/storage/workspaceService.js";
import { createSnapshotService } from "../../electron/main/storage/snapshots.js";
import { createVaultService } from "../../electron/main/vault/index.js";
import { deriveKeyArgon2id } from "../../electron/main/vault/crypto.js";
import { convertBrowserPackage } from "../../electron/main/backup/legacyConversion.js";
import { backupDate } from "../../electron/main/backup/files.js";
import { sha256File } from "../../electron/main/backup/files.js";
import { verifyBackupFile } from "../../electron/main/backup/inspection.js";
import { openZipFileReader } from "../../electron/main/backup/zipNode.js";
import { BACKUP_COLLECTIONS, requiredCollections } from "../../src/backup/format.js";
import { filesToWorkspace } from "../../src/backup/serialize.js";
import { recordVisit } from "../../src/domain/recents.js";
import { processReminders } from "../../src/domain/reminders.js";
import { sortedEntities } from "../fixtures/backup-helpers.mjs";
import { normalizeLoadedWorkspace } from "../../src/persistence/normalize.js";
import { fullWorkspace, fullWorkspaceAttachmentBytes, withLargeAttachment, largeAttachmentBytes, FIXTURE_TIME, fixtureBytes } from "../fixtures/full-workspace.mjs";
import { createMarkers, vaultTenItems, TEST_PASSWORD } from "../fixtures/vault-items.mjs";
import assert from "node:assert/strict";
import { REPO_ROOT, assertTestPath, createIsolatedDirectory, removeIsolatedDirectory, launchApp, closeApp, queueDialogResponse, assertNoNetworkAndErrors } from "./helpers.mjs";
import { callVault } from "./vault-helpers.mjs";

export async function seedDesktopFullWorkspace(dataRoot, { large = false } = {}) {
  const root = assertTestPath(dataRoot);
  ensureDataRootMarker(root, { appVersion: "0.1.0", now: FIXTURE_TIME });
  const input = large ? withLargeAttachment(fullWorkspace()) : fullWorkspace();
  const workspace = normalizeLoadedWorkspace({ ...input, workspaceId: "ws-backup-fixture" }, { fallbackWorkspace: input, now: FIXTURE_TIME, idFactory: (prefix) => `${prefix}-fixture` });
  const bytesById = fullWorkspaceAttachmentBytes();
  if (large) bytesById.set("att-big", largeAttachmentBytes());
  const db = openWorkspaceDatabase(path.join(root, "workspace.db"));
  try {
    prepareWritable(db);
    initializeWorkspace(db, workspace, { now: FIXTURE_TIME, generation: "gen-fixture" });
    const store = createAssetStore({ assetsDir: path.join(root, "assets"), db, now: FIXTURE_TIME });
    const index = [];
    for (const attachment of workspace.attachments) {
      const bytes = bytesById.get(attachment.id);
      if (!bytes) continue;
      const { assetId } = store.put({ bytes, mime: attachment.mime, name: attachment.name });
      index.push({ sha256: assetId, size: bytes.length, mime: attachment.mime, originalName: attachment.name, createdAt: attachment.createdAt, legacyAttachmentId: attachment.id });
    }
    const converted = await convertBrowserPackage(workspace, index, { putAsset: (bytes, metadata) => store.put({ bytes, mime: metadata.mime, name: metadata.name }) });
    if (converted.report.leftovers.length) throw new Error("fixture conversion has leftovers");
    replaceDatabaseWorkspace(db, converted.workspace, { generation: "gen-fixture", now: FIXTURE_TIME });
    return converted.workspace;
  } finally { db.close(); }
}

export async function createDesktopBackupContext(context, { large = false, now = () => FIXTURE_TIME, seed = true, vaultService, appVersion = "0.1.0", retainOnFailure = false } = {}) {
  const dataRoot = createIsolatedDirectory("backup-unit");
  let completed = false;
  let snapshots;
  let vault;
  let workspaceService;
  context.after(async () => {
    const cleanupErrors = [];
    for (const close of [() => snapshots?.stop(), () => vault?.lock("app-quit"), () => vault?.closeDatabase(), () => workspaceService?.close()]) {
      try { await close(); } catch (error) { cleanupErrors.push(error); }
    }
    if (cleanupErrors.length || retainOnFailure && !completed) console.log(`LIFE_ATLAS_BACKUP_FIXTURE_RETAINED ${JSON.stringify({ dataRoot, completed })}`);
    else removeIsolatedDirectory(dataRoot);
    if (cleanupErrors.length) throw new AggregateError(cleanupErrors, "Backup fixture service cleanup failed; evidence directory retained");
  });
  if (seed) await seedDesktopFullWorkspace(dataRoot, { large });
  let sequence = 0;
  vault = typeof vaultService === "function" ? vaultService(dataRoot) : vaultService;
  workspaceService = createWorkspaceService({ dataRoot, now: () => backupDate(now).toISOString(), appVersion, idFactory: (prefix) => `${prefix}-backup-${++sequence}`, beforeMigration: (input) => snapshots.beforeMigration(input), beforeUpgrade: (input) => snapshots.beforeUpgrade(input) });
  snapshots = createSnapshotService({ dataRoot, workspaceService, vaultService: vault, now, appVersion });
  const assetStore = createAssetStore({ assetsDir: path.join(dataRoot, "assets"), db: () => workspaceService.db, now });
  await workspaceService.load();
  return { dataRoot, workspaceService, assetStore, snapshotService: snapshots, vaultService: vault, now, appVersion, idFactory: (prefix) => `${prefix}-restore-${++sequence}`, complete() { completed = true; } };
}

export const fastBackupDeriveKey = (value, salt, params) => deriveKeyArgon2id(value, salt, { ...params, memoryKiB: 8192 });

export function backupVaultFactory({ production = false, now = () => FIXTURE_TIME } = {}) {
  return (dataRoot) => createVaultService({ dataRoot, appVersion: "0.1.0", clock: { now: () => backupDate(now).getTime() }, deriveKey: production ? deriveKeyArgon2id : fastBackupDeriveKey });
}

export async function seedBackupVault(service) {
  const markers = createMarkers();
  const inputs = vaultTenItems(markers);
  inputs[0] = { ...inputs[0], title: `中文 🔐 ${inputs[0].title}`, favorite: true };
  const { recoveryKey } = await service.create({ password: TEST_PASSWORD });
  service.confirmRecoveryKey({ lastTwoGroups: recoveryKey.split("-").slice(-2).join("-") });
  const ids = [];
  for (const input of inputs) ids.push(service.createItem({ input }).summary.id);
  const { item } = service.getItem({ id: ids[0] });
  const secretId = item.fields.find((field) => field.kind === "secret").id;
  service.updateItem({ id: ids[0], patch: { fields: item.fields.map((field) => ({ id: field.id, label: field.label, kind: field.kind, sensitive: field.sensitive, ...(field.id === secretId ? { value: markers.next() } : field.sensitive ? { keepValue: true } : { value: field.value }) })) } });
  service.trashItem({ id: ids.at(-1) });
  service.updateSettings({ patch: { autoLockMinutes: 15, clipboardClearSeconds: 60, lockOnMinimize: true, verifyBeforeReveal: false } });
  return { ids, inputs, markers: markers.all(), recoveryKey, secretId, password: TEST_PASSWORD };
}

export async function readBackupVaultState(service, ids) {
  const items = [];
  for (const id of ids) {
    const { item } = service.getItem({ id });
    const fields = [];
    for (const field of item.fields) {
      const history = service.getHistory({ id, fieldId: field.id }).entries;
      const entries = [];
      for (const entry of history) entries.push({ ...entry, value: (await service.revealHistory({ id, fieldId: field.id, index: entry.index })).value });
      fields.push({ ...field, ...(field.sensitive ? { value: (await service.revealField({ id, fieldId: field.id })).value } : {}), history: entries });
    }
    items.push({ ...item, fields });
  }
  return { items, settings: service.status().settings };
}

export function seedGigabyteAssets({ dataRoot, workspaceService }) {
  const root = assertTestPath(dataRoot);
  const hashes = [];
  for (let index = 0; index < 4; index += 1) {
    const block = fixtureBytes(`big-${index}`, 1048576);
    const hash = createHash("sha256");
    const temporary = path.join(root, `big-${index}.bin`);
    const descriptor = fs.openSync(temporary, "wx");
    try {
      for (let repetition = 0; repetition < 256; repetition += 1) { fs.writeSync(descriptor, block); hash.update(block); }
      fs.fsyncSync(descriptor);
    } finally { fs.closeSync(descriptor); }
    const sha256 = hash.digest("hex");
    const target = path.join(root, "assets", sha256.slice(0, 2), sha256);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.renameSync(temporary, target);
    workspaceService.db.prepare("INSERT INTO assets(sha256,size,mime,original_name,created_at) VALUES(?,?,?,?,?)").run(sha256, 256 * 1048576, "application/octet-stream", `big-${index}.bin`, FIXTURE_TIME);
    hashes.push(sha256);
  }
  return hashes;
}

export function readClosedBackupWorkspace(dataRoot) {
  const db = openWorkspaceDatabase(path.join(assertTestPath(dataRoot), "workspace.db"), { readOnly: true });
  try { return assembleWorkspace(readAllRows(db)); } finally { db.close(); }
}

export function assertBackupWorkspaceEntitiesEqual(actual, expected) {
  const required = requiredCollections(expected.schemaVersion);
  for (const collection of BACKUP_COLLECTIONS) {
    const optional = !required.includes(collection);
    const actualEntities = optional && actual[collection] === undefined ? [] : actual[collection];
    const expectedEntities = optional && expected[collection] === undefined ? [] : expected[collection];
    assert.ok(Array.isArray(actualEntities), `${collection}: actual collection must be an array`);
    assert.ok(Array.isArray(expectedEntities), `${collection}: expected collection must be an array`);
    assert.deepEqual(sortedEntities(actualEntities), sortedEntities(expectedEntities), collection);
  }
  const otherFields = (workspace) => Object.fromEntries(Object.entries(workspace).filter(([name]) => name !== "ui" && !BACKUP_COLLECTIONS.includes(name)));
  assert.deepEqual(otherFields(actual), otherFields(expected));
  assert.equal(actual.workspaceId, expected.workspaceId);
  assert.equal(actual.savedAt, expected.savedAt);
}

export function assertBackupWorkspaceEqual(actual, expected) {
  assertBackupWorkspaceEntitiesEqual(actual, expected);
  assert.deepEqual(actual.ui, expected.ui);
}

export function backupWorkspaceAfterInitialVisit(workspace, time = FIXTURE_TIME) {
  let ui = {
    ...workspace.ui,
    activeSection: workspace.ui?.activeSection || "private",
    expandedPageIds: workspace.ui?.expandedPageIds ?? [],
    selectedBlockId: workspace.ui?.selectedBlockId ?? null,
  };
  if (Object.hasOwn(ui, "recentVisits") && ui.activeSection === "private" && workspace.pages.some((page) => page.id === ui.selectedPageId && !page.trashedAt)) ui = recordVisit(ui, ui.selectedPageId, time);
  const visited = { ...workspace, ui };
  return Number(workspace.schemaVersion) >= 15 ? processReminders(visited, { nowMs: Date.parse(time), startedAt: Date.parse(time), initial: true }).workspace : visited;
}

export function assertBackupWorkspaceAfterInitialVisit(actual, expected, time = FIXTURE_TIME) {
  assertBackupWorkspaceEqual(actual, backupWorkspaceAfterInitialVisit(expected, time));
}

export async function captureBackupWorkspace(handle) {
  const read = () => handle.page.evaluate(() => window.lifeAtlas.workspace.load());
  const initial = await read();
  assert.equal(initial.ok, true, initial.error?.message);
  let loaded = initial;
  const workspace = initial.value.workspace;
  const pageId = workspace.ui?.selectedPageId;
  const requiresVisit = Object.hasOwn(workspace.ui, "recentVisits") && (workspace.ui.activeSection || "private") === "private" && workspace.pages.some((page) => page.id === pageId && !page.trashedAt);
  const requiresReminders = Number(workspace.schemaVersion) >= 15;
  if (requiresVisit || requiresReminders) {
    let time = await handle.page.evaluate(() => new Date().toISOString());
    const startedAt = handle.rendererClock?.mode === "running" ? new Date(handle.rendererClock.time).getTime() : Date.parse(handle.processOwnership?.mainCreatedAt);
    const runningClock = handle.rendererClock?.mode !== "fixed" && Number.isFinite(startedAt);
    const deadline = performance.now() + 30000;
    const startupTimestamp = (timestamp) => runningClock ? Date.parse(timestamp) >= startedAt && Date.parse(timestamp) <= Date.parse(time) : timestamp === time;
    const ready = (value) => (!requiresVisit || value.ui?.recentVisits?.some((visit) => visit.pageId === pageId && startupTimestamp(visit.visitedAt))) && (!requiresReminders || startupTimestamp(value.ui?.lastReminderCheckAt));
    while (!ready(loaded.value.workspace)) {
      assert.ok(performance.now() < deadline, `Timed out awaiting persisted backup visit/reminder startup for ${pageId} at ${time}`);
      await new Promise((resolve) => setTimeout(resolve, 100));
      loaded = await read();
      assert.equal(loaded.ok, true, loaded.error?.message);
      if (runningClock) time = await handle.page.evaluate(() => new Date().toISOString());
    }
  }
  return loaded.value.workspace;
}

export async function readBackupFileWorkspace(filePath) {
  const reader = await openZipFileReader(filePath);
  try {
    const files = new Map();
    for (const entry of reader.entries()) if (entry === "workspace/meta.json" || entry.startsWith("workspace/entities/")) files.set(entry, await reader.read(entry));
    return filesToWorkspace((entry) => files.get(entry));
  } finally { reader.close(); }
}

export async function assertBackupDataRootsEqual(actualRoot, expectedRoot) {
  assertBackupWorkspaceEqual(readClosedBackupWorkspace(actualRoot), readClosedBackupWorkspace(expectedRoot));
  const db = openWorkspaceDatabase(path.join(expectedRoot, "workspace.db"), { readOnly: true });
  let assets;
  try { assets = db.prepare("SELECT sha256,size FROM assets ORDER BY sha256").all(); } finally { db.close(); }
  for (const asset of assets) {
    const actual = await sha256File(path.join(actualRoot, "assets", asset.sha256.slice(0, 2), asset.sha256));
    const expected = await sha256File(path.join(expectedRoot, "assets", asset.sha256.slice(0, 2), asset.sha256));
    assert.deepEqual(actual, expected);
    assert.equal(actual.sha256, asset.sha256);
    assert.equal(actual.size, asset.size);
  }
}

export async function createBackupDesktopCase(context, { seed = false, large = false, vault = false, gigabyte = false, packaged = false, setup = false, ready = true, retainOnFailure = false, env = {}, prepare } = {}) {
  const dataRoot = setup ? null : createIsolatedDirectory("backup-e2e-data");
  const bootstrapDir = createIsolatedDirectory("backup-e2e-bootstrap");
  const roots = [dataRoot, bootstrapDir].filter(Boolean);
  const launches = [];
  let completed = false;
  const state = { dataRoot, bootstrapDir, handle: null, fixtureWorkspace: null, expectedWorkspace: null, exportedWorkspace: null, seededVault: null, expectedVault: null, gigabyteHashes: [], own(directory) { roots.push(assertTestPath(directory)); return directory; }, complete() { completed = true; } };
  context.after(async () => {
    const cleanupErrors = [];
    for (const launch of [...launches].reverse()) if (!launch.closed) {
      try { await closeApp(launch.handle, { keepDirs: true }); launch.closed = true; }
      catch (error) { cleanupErrors.push(error); }
    }
    const directories = [...new Set(roots)].reverse();
    if (cleanupErrors.length || retainOnFailure && !completed) console.log(`LIFE_ATLAS_BACKUP_CASE_RETAINED ${JSON.stringify({ directories: directories.filter((directory) => fs.existsSync(directory)), completed })}`);
    else for (const directory of directories) if (fs.existsSync(directory)) removeIsolatedDirectory(directory);
    if (cleanupErrors.length) throw new AggregateError(cleanupErrors, "Backup case process cleanup failed; evidence directories retained");
  });
  if (seed) {
    state.fixtureWorkspace = await seedDesktopFullWorkspace(dataRoot, { large });
    state.expectedWorkspace = state.fixtureWorkspace;
    assertBackupWorkspaceEqual(readClosedBackupWorkspace(dataRoot), state.fixtureWorkspace);
  }
  if (vault) {
    const service = backupVaultFactory({ production: true })(dataRoot);
    try { state.seededVault = await seedBackupVault(service); state.expectedVault = await readBackupVaultState(service, state.seededVault.ids); }
    finally { service.lock("app-quit"); service.closeDatabase(); }
  }
  if (gigabyte) {
    const service = createWorkspaceService({ dataRoot, now: () => FIXTURE_TIME, appVersion: "0.1.0", idFactory: (prefix) => `${prefix}-gigabyte` });
    try { await service.load(); state.gigabyteHashes = seedGigabyteAssets({ dataRoot, workspaceService: service }); } finally { service.close(); }
  }
  if (prepare) await prepare(state);
  state.launch = async ({ waitForReady = ready, wizard = setup } = {}) => {
    const clock = new Date(Number(env.LIFE_ATLAS_TEST_CLOCK_MS ?? Date.parse(FIXTURE_TIME)));
    const handle = await launchApp({ dataRoot, bootstrapDir, packaged: setup || packaged, env: { LIFE_ATLAS_TEST_CLOCK_MS: String(Date.parse(FIXTURE_TIME)), ...env }, ...(wizard ? {} : { rendererClock: { mode: "fixed", time: clock } }) });
    launches.push({ handle, closed: false });
    roots.push(handle.tempDir);
    state.handle = handle;
    if (wizard) { await handle.page.clock.setFixedTime(clock); await handle.page.locator('html[data-la-setup-ready="1"]').waitFor(); await handle.page.getByRole("status").waitFor(); }
    else if (waitForReady) {
      await handle.page.locator('html[data-la-ready="1"]').waitFor();
      await handle.page.locator(".workspace-sidebar").waitFor();
      const workspace = await captureBackupWorkspace(handle);
      if (state.fixtureWorkspace && launches.length === 1) assertBackupWorkspaceAfterInitialVisit(workspace, state.fixtureWorkspace, clock.toISOString());
      state.expectedWorkspace = workspace;
    }
    return handle;
  };
  state.close = async ({ check = true } = {}) => {
    const launch = launches.find((entry) => entry.handle === state.handle);
    if (!launch || launch.closed) return;
    if (check) await assertNoNetworkAndErrors(state.handle);
    await closeApp(state.handle, { keepDirs: true });
    launch.closed = true;
    state.handle = null;
  };
  await state.launch();
  return state;
}

export async function openBackupDialog(handle, tab = "完整备份") {
  await handle.page.locator(".workspace-switcher").click();
  await handle.page.getByRole("menuitem", { name: "备份与恢复…", exact: true }).click();
  const dialog = handle.page.getByRole("dialog", { name: "备份与恢复", exact: true });
  await dialog.waitFor();
  if (tab !== "完整备份") await dialog.getByRole("button", { name: tab, exact: true }).click();
  return dialog;
}

export async function exportBackupUi(handle, targetPath, { dialog, includeVault = false, encryptPassword = null, vaultPage, onConfirm, onWorkspace } = {}) {
  const panel = dialog || await openBackupDialog(handle);
  if (includeVault) {
    await handle.page.waitForFunction(() => [...document.querySelectorAll(".mb-backup-dialog label")].some((label) => label.textContent.startsWith("包含密钥库") && !label.querySelector("input")?.disabled));
    assert.equal(await panel.getByLabel(/^包含密钥库/).isChecked(), true);
  } else if (await panel.getByLabel(/^包含密钥库/).isEnabled()) await panel.getByLabel(/^包含密钥库/).uncheck();
  if (encryptPassword !== null) {
    await panel.getByLabel("加密整个备份", { exact: true }).check();
    const inputs = panel.locator('input[type="password"]');
    assert.equal(await inputs.count(), 2);
    await inputs.nth(0).fill(encryptPassword);
    await inputs.nth(1).fill(encryptPassword);
  }
  const workspace = await captureBackupWorkspace(handle);
  if (onWorkspace) await onWorkspace(workspace);
  await queueDialogResponse(handle, "showSaveDialog", { canceled: false, filePath: targetPath });
  await panel.getByRole("button", { name: "导出", exact: true }).click();
  if (includeVault) {
    assert.ok(vaultPage, "The vault confirmation window must be supplied");
    const confirmation = vaultPage.getByRole("dialog", { name: "导出完整备份（包含密钥库）", exact: true });
    await confirmation.waitFor();
    await panel.getByText("请在密钥库窗口中输入主密码确认", { exact: true }).waitFor();
    if (onConfirm) await onConfirm(confirmation);
    else { await confirmation.getByLabel("确认操作的主密码", { exact: true }).fill(TEST_PASSWORD); await confirmation.getByRole("button", { name: "确认", exact: true }).click(); }
  }
  await panel.getByRole("status").filter({ hasText: "已导出：" }).waitFor({ timeout: 180000 });
  assert.equal(fs.existsSync(targetPath), true);
  return panel;
}

export async function selectBackupUi(handle, sourcePath, { dialog, encryptPassword = null } = {}) {
  const panel = dialog || await openBackupDialog(handle);
  await queueDialogResponse(handle, "showOpenDialog", { canceled: false, filePaths: [sourcePath] });
  await panel.getByRole("button", { name: "选择备份文件…", exact: true }).click();
  if (encryptPassword !== null) {
    const encrypted = handle.page.getByRole("dialog", { name: "输入备份密码", exact: true });
    await encrypted.getByLabel("备份密码", { exact: true }).fill(encryptPassword);
    await encrypted.getByRole("button", { name: "解锁备份", exact: true }).click();
    await encrypted.waitFor({ state: "hidden" });
  }
  return panel;
}

export async function restoreBackupUi(handle, sourcePath, options = {}) {
  const panel = await selectBackupUi(handle, sourcePath, options);
  return confirmBackupRestoreUi(handle, panel);
}

export async function confirmBackupRestoreUi(handle, panel) {
  await panel.getByRole("button", { name: "恢复", exact: true }).click();
  const confirmation = handle.page.getByRole("alertdialog", { name: "恢复这个备份？", exact: true });
  const reload = handle.page.waitForEvent("domcontentloaded", { timeout: 180000 });
  await confirmation.getByRole("button", { name: "确认恢复", exact: true }).click();
  await reload;
  await handle.page.locator('html[data-la-ready="1"]').waitFor();
  await handle.page.locator(".workspace-sidebar").waitFor();
  return captureBackupWorkspace(handle);
}

export async function restoreWizardUi(state, sourcePath, { encryptPassword = null, beforeLaunch } = {}) {
  const parent = state.own(createIsolatedDirectory("backup-wizard-target"));
  const target = path.join(parent, "data");
  await queueDialogResponse(state.handle, "showOpenDialog", { canceled: false, filePaths: [target] });
  await state.handle.page.locator(".wizard .wiz-choice").nth(1).click();
  await state.handle.page.getByRole("status").filter({ hasText: "将创建这个文件夹" }).waitFor();
  await state.handle.page.getByRole("button", { name: "继续", exact: true }).click();
  await state.handle.page.getByRole("button", { name: /^从备份恢复/ }).click();
  await queueDialogResponse(state.handle, "showOpenDialog", { canceled: false, filePaths: [sourcePath] });
  await state.handle.page.getByRole("button", { name: "选择备份文件…", exact: true }).click();
  if (encryptPassword !== null) {
    await state.handle.page.getByLabel("备份密码", { exact: true }).fill(encryptPassword);
    await state.handle.page.getByRole("button", { name: "解锁备份", exact: true }).click();
  }
  await state.handle.page.locator(".wiz-summary").waitFor();
  await state.handle.page.getByRole("button", { name: "继续", exact: true }).click();
  const exited = once(state.handle.app.process(), "exit");
  await state.handle.page.getByRole("button", { name: "开始使用", exact: true }).click();
  assert.equal((await exited)[0], 0);
  await state.close({ check: false });
  assert.equal(JSON.parse(fs.readFileSync(path.join(state.bootstrapDir, "bootstrap.json"), "utf8")).dataRoot, target);
  if (beforeLaunch) await beforeLaunch(target);
  await state.launch({ wizard: false });
  return target;
}

export async function readBackupVaultUiState(page, ids) {
  const items = [];
  for (const id of ids) {
    const { item } = await callVault(page, "getItem", { id });
    const fields = [];
    for (const field of item.fields) {
      const history = (await callVault(page, "getHistory", { id, fieldId: field.id })).entries;
      const entries = [];
      for (const entry of history) entries.push({ ...entry, value: (await callVault(page, "revealHistory", { id, fieldId: field.id, index: entry.index })).value });
      fields.push({ ...field, ...(field.sensitive ? { value: (await callVault(page, "revealField", { id, fieldId: field.id })).value } : {}), history: entries });
    }
    items.push({ ...item, fields });
  }
  return { items, settings: (await callVault(page, "status")).settings };
}

export async function tamperBackupFile(source, target) {
  fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
  const descriptor = fs.openSync(target, "r+");
  try {
    const size = fs.fstatSync(descriptor).size;
    const tail = Buffer.alloc(Math.min(size, 65558));
    fs.readSync(descriptor, tail, 0, tail.length, size - tail.length);
    const end = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    assert.ok(end >= 0);
    const central = tail.readUInt32LE(end + 16);
    const byte = Buffer.alloc(1);
    fs.readSync(descriptor, byte, 0, 1, central + 46);
    byte[0] ^= 1;
    fs.writeSync(descriptor, byte, 0, 1, central + 46);
    fs.fsyncSync(descriptor);
  } finally { fs.closeSync(descriptor); }
  assert.equal((await verifyBackupFile(target)).ok, false);
}

export async function stopBackupMemory(context, handle, label) {
  const measurement = await handle.app.evaluate(() => globalThis.__lifeAtlasTest.memory.stop());
  const delta = measurement.peakRss - measurement.baselineRss;
  context.diagnostic(`${label}=${(delta / 1048576).toFixed(2)}; baselineRss=${measurement.baselineRss}; peakRss=${measurement.peakRss}; sampleMs=100`);
  assert.ok(delta < 300 * 1048576, `${label} exceeded the strict 300MiB memory budget`);
  return measurement;
}

export async function shootBackupModes(handle, page, directory, name, { preserveSize = false } = {}) {
  const target = assertPhysicalPath(directory, { root: path.join(REPO_ROOT, ".qa") });
  if (!/^[a-z0-9-]+$/i.test(name)) throw new Error("备份截图名称无效");
  fs.mkdirSync(target, { recursive: true });
  if (!preserveSize) await page.setViewportSize({ width: 1440, height: 900 });
  try {
    for (const mode of ["light", "dark"]) {
      await handle.app.evaluate(({ nativeTheme }, source) => { nativeTheme.themeSource = source; }, mode);
      await page.emulateMedia({ colorScheme: mode });
      await page.waitForFunction((dark) => matchMedia("(prefers-color-scheme: dark)").matches === dark, mode === "dark");
      if (await page.evaluate(() => document.documentElement.dataset.laReady === "1")) await page.locator(`html[data-theme="${mode}"]`).waitFor();
      await new Promise((resolve) => setTimeout(resolve, 300));
      await page.screenshot({ path: path.join(target, `${name}-${mode}.png`) });
    }
  } finally {
    await page.emulateMedia({ colorScheme: null });
    await handle.app.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = "system"; });
  }
}
