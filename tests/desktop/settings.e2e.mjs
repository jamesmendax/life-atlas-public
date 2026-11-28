import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { once } from "node:events";
import { sha256File } from "../../electron/main/backup/files.js";
import { createAssetStore } from "../../electron/main/storage/assetStore.js";
import { assertPhysicalPath } from "../../electron/main/storage/dataRoot.js";
import { openWorkspaceDatabase, readAssetRows, replaceDatabaseWorkspace } from "../../electron/main/storage/workspaceDb.js";
import { createBlankWorkspace } from "../../src/domain/blankWorkspace.js";
import { createDataSource, createDatabaseItem, createDatabaseView, createProperty } from "../../src/domain/database.js";
import { createPageVersion } from "../../src/domain/pageHistory.js";
import { FIXTURE_TIME, fixtureBytes } from "../fixtures/full-workspace.mjs";
import { createBackupDesktopCase, assertBackupWorkspaceEqual, captureBackupWorkspace, readClosedBackupWorkspace } from "./backup-helpers.mjs";
import { answerProductDialog, assertNoNetworkAndErrors, assertTestPath, closeApp, createIsolatedDirectory, launchApp, queueDialogResponse, readDialogCalls, seedWorkspaceDatabase } from "./helpers.mjs";
import { callVault, openVaultWindow, unlockUi } from "./vault-helpers.mjs";

const DAY = 86400000;
const fileBlock = (label, asset) => ({ id: `settings-file-${label}`, type: "file", props: { url: asset.url, name: `cleanup-${label}.txt`, caption: "" } });

async function desktopCall(page, group, method, args) {
  const result = await page.evaluate(({ group: section, method: name, args: value }) => window.lifeAtlas[section][name](value), { group, method, args });
  assert.equal(result.ok, true, `${group}.${method}: ${result.error?.code || "unknown error"}`);
  return result.value;
}

async function openSettings(page, section = "外观") {
  await page.keyboard.press("Control+,");
  const dialog = page.getByRole("dialog", { name: "设置", exact: true });
  await dialog.waitFor();
  await dialog.getByRole("tab", { name: section, exact: true }).click();
  return dialog;
}

async function payloadInventory(dataRoot) {
  const root = assertTestPath(dataRoot);
  const directories = [];
  const files = [];
  const visit = async (relative = "") => {
    const directory = assertPhysicalPath(path.join(root, relative), { root, allowMissing: false });
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      if (!relative && ["runtime", ".lock"].includes(entry.name)) continue;
      const name = path.join(relative, entry.name);
      const target = assertPhysicalPath(path.join(root, name), { root, allowMissing: false });
      if (entry.isDirectory()) { directories.push(name); await visit(name); }
      else {
        assert.equal(entry.isFile(), true, `Unexpected payload entry: ${name}`);
        files.push({ path: name, ...await sha256File(target) });
      }
    }
  };
  await visit();
  return { directories, files };
}

function writeBootstrap(state) {
  state.bootstrapFile = path.join(assertTestPath(state.bootstrapDir), "bootstrap.json");
  state.bootstrapBytes = Buffer.from(`${JSON.stringify({ dataRoot: state.dataRoot }, null, 2)}\n`);
  fs.writeFileSync(state.bootstrapFile, state.bootstrapBytes);
}

async function prepareMove(state) {
  writeBootstrap(state);
  const db = openWorkspaceDatabase(path.join(state.dataRoot, "workspace.db"));
  try {
    const store = createAssetStore({ assetsDir: path.join(state.dataRoot, "assets"), db, now: FIXTURE_TIME });
    const bytes = fixtureBytes("wp17-migration-proof", 256);
    state.extraAsset = store.put({ bytes, mime: "application/octet-stream", name: "migration-proof.bin" });
    const workspace = {
      ...state.fixtureWorkspace,
      pages: state.fixtureWorkspace.pages.map((page) => page.id === "p-a1" ? { ...page, content: [...page.content, { id: "migration-proof", type: "file", props: { url: state.extraAsset.url, name: "migration-proof.bin", caption: "" } }] } : page),
      attachments: [...state.fixtureWorkspace.attachments, { id: "att-migration-proof", provider: "asset", storageKey: state.extraAsset.assetId, name: "migration-proof.bin", mime: "application/octet-stream", size: bytes.length, createdAt: FIXTURE_TIME, updatedAt: FIXTURE_TIME }],
    };
    replaceDatabaseWorkspace(db, workspace, { generation: "gen-fixture", now: FIXTURE_TIME });
    state.fixtureWorkspace = workspace;
    state.expectedWorkspace = workspace;
  } finally { db.close(); }
  fs.mkdirSync(path.join(state.dataRoot, "preserved-empty", "child"), { recursive: true });
  fs.mkdirSync(path.join(state.dataRoot, "runtime"), { recursive: true });
  fs.writeFileSync(path.join(state.dataRoot, "runtime", "do-not-copy.txt"), "old runtime must remain here");
}

async function prepareCleanup(state) {
  let sequence = 0;
  const blank = createBlankWorkspace({ now: FIXTURE_TIME, idFactory: (prefix) => `${prefix}-settings-${++sequence}` });
  const base = await seedWorkspaceDatabase(state.dataRoot, { ...blank, ui: { ...blank.ui, activeSection: "home" } });
  const db = openWorkspaceDatabase(path.join(state.dataRoot, "workspace.db"));
  try {
    const store = createAssetStore({ assetsDir: path.join(state.dataRoot, "assets"), db, now: FIXTURE_TIME });
    state.cleanupAssets = Object.fromEntries(["A", "B", "C", "D", "E"].map((label) => [label, store.put({ bytes: fixtureBytes(`wp17-cleanup-${label}`, 128), mime: "text/plain", name: `cleanup-${label}.txt` })]));
    const primary = { ...base.pages[0], title: "附件引用页面", content: [fileBlock("A", state.cleanupAssets.A), fileBlock("C", state.cleanupAssets.C)] };
    state.cleanupPageId = primary.id;
    const databasePage = { ...primary, id: "page-settings-database", title: "附件记录", content: [], pageType: "database", databaseSourceId: "ds-settings-cleanup", databaseViewId: "view-settings-cleanup", sortIndex: 20 };
    const recordPage = { ...primary, id: "page-settings-record", title: "仅文件属性引用", content: [], databaseSourceId: "ds-settings-cleanup", sortIndex: 30 };
    const workspace = {
      ...base,
      pages: [primary, databasePage, recordPage, ...base.pages.slice(1)],
      pageVersions: [createPageVersion({ ...primary, content: [fileBlock("B", state.cleanupAssets.B)] }, { id: "version-settings-cleanup", now: Date.parse(FIXTURE_TIME), reason: "manual" })],
      dataSources: [createDataSource({ id: "ds-settings-cleanup", ownerPageId: databasePage.id, title: "附件记录", createdAt: FIXTURE_TIME, properties: [createProperty({ id: "title", name: "名称", type: "title" }), createProperty({ id: "files", name: "附件", type: "files" })] })],
      databaseViews: [createDatabaseView({ id: "view-settings-cleanup", sourceId: "ds-settings-cleanup" })],
      databaseItems: [createDatabaseItem({ id: "item-settings-cleanup", sourceId: "ds-settings-cleanup", pageId: recordPage.id, createdAt: FIXTURE_TIME, values: { title: recordPage.title, files: ["att-settings-E"] } })],
      attachments: Object.entries(state.cleanupAssets).map(([label, asset]) => ({ id: `att-settings-${label}`, provider: "asset", storageKey: asset.assetId, name: `cleanup-${label}.txt`, mime: "text/plain", size: 128, createdAt: FIXTURE_TIME, updatedAt: FIXTURE_TIME })),
    };
    replaceDatabaseWorkspace(db, workspace, { generation: "gen-e2e", now: FIXTURE_TIME });
    state.fixtureWorkspace = workspace;
    state.expectedWorkspace = workspace;
    assert.equal(readAssetRows(db).length, 5);
  } finally { db.close(); }
}

async function moveUnusedFile(state, panel) {
  await panel.getByRole("button", { name: "查找未使用的附件", exact: true }).click();
  await panel.getByRole("checkbox", { name: "选择 cleanup-D.txt", exact: true }).waitFor();
  assert.equal(await panel.locator(".settings-asset-row").count(), 1);
  await panel.getByRole("checkbox", { name: "选择 cleanup-D.txt", exact: true }).check();
  await panel.getByRole("button", { name: "移到附件回收站", exact: true }).click();
  await state.handle.page.locator('[data-la-dialog="confirm"]').waitFor();
  await answerProductDialog(state.handle.page);
  await panel.getByRole("status").filter({ hasText: "已将 1 个附件移到回收站" }).waitFor();
  const { batches } = await desktopCall(state.handle.page, "assets", "listTrash");
  assert.equal(batches.length, 1);
  assert.equal(batches[0].count, 1);
  return batches[0];
}

test("system theme follows the operating system", { timeout: 60000 }, async (context) => {
  const state = await createBackupDesktopCase(context, { seed: true, packaged: true, retainOnFailure: true });
  await state.handle.page.emulateMedia({ colorScheme: null });
  const panel = await openSettings(state.handle.page);
  await panel.getByRole("radiogroup", { name: "模式", exact: true }).getByRole("radio", { name: "跟随系统", exact: true }).click();
  for (const theme of ["light", "dark"]) {
    await state.handle.app.evaluate(({ nativeTheme }, source) => { nativeTheme.themeSource = source; }, theme);
    await state.handle.page.waitForFunction((source) => document.documentElement.dataset.theme === source, theme);
    assert.equal(await state.handle.page.locator(".bn-container").getAttribute("data-color-scheme"), theme);
    assert.equal((await desktopCall(state.handle.page, "workspace", "load")).workspace.ui.preferences.theme, "system");
  }
  await state.close();
  state.complete();
});

test("changing the data root copies verifies and restarts", { timeout: 180000 }, async (context) => {
  const state = await createBackupDesktopCase(context, { seed: true, packaged: true, retainOnFailure: true, prepare: prepareMove });
  const target = state.own(createIsolatedDirectory("settings-move-target"));
  const panel = await openSettings(state.handle.page, "数据");
  const expected = await captureBackupWorkspace(state.handle);
  await queueDialogResponse(state.handle, "showOpenDialog", { canceled: false, filePaths: [target] });
  await queueDialogResponse(state.handle, "showMessageBox", { response: 0 });
  await assertNoNetworkAndErrors(state.handle);
  const networkAttempts = [];
  state.handle.page.on("request", (request) => { if (/^(?:https?|wss?):/.test(request.url())) networkAttempts.push(request.url()); });
  const exited = once(state.handle.app.process(), "exit");
  await panel.getByRole("button", { name: "更换数据目录…", exact: true }).click();
  const [exitCode, signal] = await exited;
  assert.equal(exitCode, 0);
  assert.equal(signal, null);
  assert.deepEqual(state.handle.errors.page, []);
  assert.deepEqual(state.handle.errors.console, []);
  assert.deepEqual(networkAttempts, []);
  await state.close({ check: false });
  const oldPayload = await payloadInventory(state.dataRoot);
  assert.deepEqual(await payloadInventory(target), oldPayload);
  assert.ok(oldPayload.files.some((file) => file.path === "workspace.db"));
  assert.ok(oldPayload.files.some((file) => file.sha256 === state.extraAsset.assetId));
  assert.ok(oldPayload.directories.includes(path.join("preserved-empty", "child")));
  assertBackupWorkspaceEqual(readClosedBackupWorkspace(state.dataRoot), expected);
  assert.deepEqual(JSON.parse(fs.readFileSync(state.bootstrapFile, "utf8")), { dataRoot: target });
  assert.equal(fs.existsSync(`${state.bootstrapFile}.tmp`), false);
  assert.equal(fs.readFileSync(path.join(state.dataRoot, "runtime", "do-not-copy.txt"), "utf8"), "old runtime must remain here");
  assert.equal(fs.existsSync(path.join(target, "runtime", "do-not-copy.txt")), false);
  const auditDir = path.join(target, "runtime", "migration-logs");
  const auditFiles = fs.readdirSync(auditDir);
  assert.equal(auditFiles.length, 1);
  const audit = JSON.parse(fs.readFileSync(path.join(auditDir, auditFiles[0]), "utf8"));
  assert.deepEqual(audit, { at: FIXTURE_TIME, event: "data-root.moved", from: state.dataRoot, to: target });
  const restarted = await launchApp({ packaged: true, dataRoot: null, bootstrapDir: state.bootstrapDir, env: { LIFE_ATLAS_TEST_CLOCK_MS: String(Date.parse(FIXTURE_TIME)) }, rendererClock: { mode: "fixed", time: new Date(FIXTURE_TIME) } });
  state.own(restarted.tempDir);
  try {
    await restarted.page.locator('html[data-la-ready="1"]').waitFor();
    assert.equal((await desktopCall(restarted.page, "app", "getInfo")).dataRoot, target);
    assertBackupWorkspaceEqual(await captureBackupWorkspace(restarted), expected);
    assert.deepEqual(await payloadInventory(state.dataRoot), oldPayload);
    await assertNoNetworkAndErrors(restarted);
  } finally { await closeApp(restarted, { keepDirs: true }); }
  state.complete();
});

test("a failed data root copy keeps the old folder", { timeout: 90000 }, async (context) => {
  const state = await createBackupDesktopCase(context, { seed: true, packaged: true, retainOnFailure: true, prepare: prepareMove });
  const target = state.own(createIsolatedDirectory("settings-failed-move-target"));
  const panel = await openSettings(state.handle.page, "数据");
  const expected = await captureBackupWorkspace(state.handle);
  await state.handle.app.evaluate(() => globalThis.__lifeAtlasTest.injectFailure("data-root-copy"));
  await queueDialogResponse(state.handle, "showOpenDialog", { canceled: false, filePaths: [target] });
  await queueDialogResponse(state.handle, "showMessageBox", { response: 0 });
  await panel.getByRole("button", { name: "更换数据目录…", exact: true }).click();
  await panel.getByRole("status").filter({ hasText: "继续使用原来的数据目录" }).waitFor();
  const calls = await readDialogCalls(state.handle);
  assert.ok(calls.some((call) => call.kind === "showMessageBox" && call.options.message.startsWith("更换数据目录失败")));
  assert.equal(state.handle.app.process().exitCode, null);
  assert.equal((await desktopCall(state.handle.page, "app", "getInfo")).dataRoot, state.dataRoot);
  assert.deepEqual(fs.readdirSync(target), []);
  assert.deepEqual(fs.readFileSync(state.bootstrapFile), state.bootstrapBytes);
  assert.equal(fs.existsSync(`${state.bootstrapFile}.tmp`), false);
  assertBackupWorkspaceEqual((await desktopCall(state.handle.page, "workspace", "load")).workspace, expected);
  assert.equal((await sha256File(path.join(state.dataRoot, "assets", state.extraAsset.assetId.slice(0, 2), state.extraAsset.assetId))).sha256, state.extraAsset.assetId);
  await state.handle.app.evaluate(() => globalThis.__lifeAtlasTest.snapshots.checkNow());
  await state.close();
  state.complete();
});

test("asset cleanup only offers unreferenced files and can restore them", { timeout: 120000 }, async (context) => {
  const state = await createBackupDesktopCase(context, { packaged: true, retainOnFailure: true, prepare: prepareCleanup });
  const { snapshot } = await desktopCall(state.handle.page, "backup", "createSnapshot");
  const loaded = await desktopCall(state.handle.page, "workspace", "load");
  const original = loaded.workspace.pages.find((page) => page.id === state.cleanupPageId);
  const updated = { ...original, content: original.content.filter((block) => block.id !== "settings-file-C") };
  await desktopCall(state.handle.page, "workspace", "applyChanges", { generation: loaded.generation, schemaVersion: loaded.workspace.schemaVersion, upserts: [{ collection: "pages", id: updated.id, json: JSON.stringify(updated) }], deletes: [], ui: null });
  await state.handle.page.reload();
  await state.handle.page.locator('html[data-la-ready="1"]').waitFor();
  const current = (await desktopCall(state.handle.page, "workspace", "load")).workspace;
  assert.equal(JSON.stringify(current).includes(state.cleanupAssets.C.url), false);
  assert.equal(JSON.stringify(current.pages).includes(state.cleanupAssets.B.url), false);
  assert.equal(JSON.stringify(current.pageVersions).includes(state.cleanupAssets.B.url), true);
  assert.equal(JSON.stringify(readClosedBackupWorkspace(path.join(state.dataRoot, "snapshots", snapshot.id))).includes(state.cleanupAssets.C.url), true);
  assert.deepEqual(current.databaseItems[0].values.files, ["att-settings-E"]);
  const panel = await openSettings(state.handle.page, "数据");
  const { candidates } = await desktopCall(state.handle.page, "assets", "scanUnreferenced");
  assert.deepEqual(candidates.map((row) => row.sha256), [state.cleanupAssets.D.assetId]);
  const first = await moveUnusedFile(state, panel);
  const orphanFile = path.join(state.dataRoot, "assets", state.cleanupAssets.D.assetId.slice(0, 2), state.cleanupAssets.D.assetId);
  const firstTrash = path.join(state.dataRoot, "asset-trash", first.trashId);
  assert.equal(fs.existsSync(orphanFile), false);
  assert.equal(fs.existsSync(path.join(firstTrash, state.cleanupAssets.D.assetId)), true);
  await panel.locator(".settings-trash-row").getByRole("button", { name: "恢复", exact: true }).click();
  await panel.getByRole("status").filter({ hasText: "已恢复 1 个附件" }).waitFor();
  assert.equal((await sha256File(orphanFile)).sha256, state.cleanupAssets.D.assetId);
  assert.equal(fs.existsSync(firstTrash), false);
  assert.deepEqual((await desktopCall(state.handle.page, "assets", "listTrash")).batches, []);
  const second = await moveUnusedFile(state, panel);
  const secondTrash = path.join(state.dataRoot, "asset-trash", second.trashId);
  assert.equal(fs.existsSync(secondTrash), true);
  await state.handle.app.evaluate((_, amount) => globalThis.__lifeAtlasTest.clock.advance(amount), 31 * DAY);
  await state.handle.app.evaluate(() => globalThis.__lifeAtlasTest.snapshots.checkNow());
  assert.equal(fs.existsSync(secondTrash), false);
  assert.equal(fs.existsSync(orphanFile), false);
  assert.deepEqual((await desktopCall(state.handle.page, "assets", "listTrash")).batches, []);
  for (const label of ["A", "B", "C", "E"]) {
    const asset = state.cleanupAssets[label];
    assert.equal((await sha256File(path.join(state.dataRoot, "assets", asset.assetId.slice(0, 2), asset.assetId))).sha256, asset.assetId);
  }
  const db = openWorkspaceDatabase(path.join(state.dataRoot, "workspace.db"), { readOnly: true });
  try { assert.deepEqual(readAssetRows(db).map((row) => row.sha256).sort(), ["A", "B", "C", "E"].map((label) => state.cleanupAssets[label].assetId).sort()); }
  finally { db.close(); }
  await state.close();
  state.complete();
});

test("vault dialogs use the product dialog", { timeout: 90000 }, async (context) => {
  const state = await createBackupDesktopCase(context, { seed: true, vault: true, packaged: true, retainOnFailure: true });
  const page = await openVaultWindow(state.handle);
  let nativeDialogs = 0;
  page.on("dialog", (dialog) => { nativeDialogs += 1; void dialog.dismiss(); });
  await unlockUi(page);
  const id = state.seededVault.ids[0];
  const title = state.expectedVault.items.find((item) => item.id === id).title;
  const escapedTitle = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const select = async () => {
    await page.getByRole("button", { name: new RegExp(escapedTitle) }).first().click();
    await page.getByRole("heading", { name: title, exact: true }).waitFor();
  };
  await select();
  await page.getByRole("button", { name: "移到回收站", exact: true }).click();
  await page.getByRole("button", { name: /^回收站/ }).click();
  await select();
  assert.ok((await callVault(page, "getItem", { id })).item.deletedAt);
  await page.getByRole("button", { name: "永久删除", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "永久删除密钥条目", exact: true });
  await dialog.waitFor();
  assert.equal(await dialog.getAttribute("data-la-dialog"), "confirm");
  assert.equal(await dialog.locator("[data-la-dialog-cancel]").evaluate((button) => button === document.activeElement), true);
  await answerProductDialog(page);
  await page.getByRole("heading", { name: title, exact: true }).waitFor({ state: "detached" });
  const missing = await page.evaluate((itemId) => window.lifeAtlasVault.getItem({ id: itemId }), id);
  assert.equal(missing.ok, false);
  assert.equal(missing.error.code, "E_NOT_FOUND");
  assert.equal(nativeDialogs, 0);
  await state.close();
  state.complete();
});
