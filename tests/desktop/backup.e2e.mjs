import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { exportFullBackup } from "../../electron/main/backup/desktopExport.js";
import { sha256File } from "../../electron/main/backup/files.js";
import { createWorkspaceService } from "../../electron/main/storage/workspaceService.js";
import { createSnapshotService } from "../../electron/main/storage/snapshots.js";
import { FIXTURE_TIME } from "../fixtures/full-workspace.mjs";
import { createDesktopBackupContext, createBackupDesktopCase, openBackupDialog, exportBackupUi, selectBackupUi, restoreBackupUi, assertBackupDataRootsEqual, assertBackupWorkspaceEqual, assertBackupWorkspaceAfterInitialVisit, captureBackupWorkspace, readClosedBackupWorkspace, tamperBackupFile, stopBackupMemory, shootBackupModes } from "./backup-helpers.mjs";
import { REPO_ROOT, createIsolatedDirectory, queueDialogResponse } from "./helpers.mjs";

const shotsDir = path.join(REPO_ROOT, ".qa/LOCAL-NOTION-001/WP-05/shots");

async function packageFixture(context, { large = false } = {}) {
  const source = await createDesktopBackupContext(context, { large, retainOnFailure: true });
  const filePath = path.join(source.dataRoot, "fixture.lifeatlas");
  await exportFullBackup({ ...source, db: source.workspaceService.db, workspace: source.workspaceService.readWorkspace(), targetPath: filePath });
  return { ...source, filePath };
}

async function workspace(handle) {
  const loaded = await handle.page.evaluate(() => window.lifeAtlas.workspace.load());
  assert.equal(loaded.ok, true, loaded.error?.message);
  return loaded.value;
}

test("export and restore keep every entity and asset", { timeout: 180000 }, async (context) => {
  const source = await createBackupDesktopCase(context, { seed: true, large: true, packaged: true, retainOnFailure: true });
  assertBackupWorkspaceEqual((await workspace(source.handle)).workspace, source.expectedWorkspace);
  const output = source.own(createIsolatedDirectory("backup-e2e-output"));
  const filePath = path.join(output, "full.lifeatlas");
  const panel = await openBackupDialog(source.handle);
  await shootBackupModes(source.handle, source.handle.page, shotsDir, "backup");
  await exportBackupUi(source.handle, filePath, { dialog: panel, onWorkspace: (value) => { source.exportedWorkspace = value; } });
  await source.close();
  assertBackupWorkspaceEqual(readClosedBackupWorkspace(source.dataRoot), source.exportedWorkspace);
  const destination = await createBackupDesktopCase(context, { packaged: true, retainOnFailure: true });
  const restored = await restoreBackupUi(destination.handle, filePath);
  assertBackupWorkspaceEqual(restored, source.exportedWorkspace);
  await destination.close();
  await assertBackupDataRootsEqual(destination.dataRoot, source.dataRoot);
  source.complete();
  destination.complete();
});

test("restore makes a snapshot and old windows cannot overwrite", { timeout: 90000 }, async (context) => {
  const source = await packageFixture(context);
  const state = await createBackupDesktopCase(context, { seed: true, packaged: true, retainOnFailure: true });
  const loaded = await workspace(state.handle);
  const page = loaded.workspace.pages[0];
  const changeset = { generation: loaded.generation, schemaVersion: loaded.workspace.schemaVersion, upserts: [{ collection: "pages", id: page.id, json: JSON.stringify(page) }], deletes: [], ui: null };
  await restoreBackupUi(state.handle, source.filePath);
  const snapshots = await state.handle.page.evaluate(() => window.lifeAtlas.backup.listSnapshots());
  assert.equal(snapshots.ok, true);
  assert.equal(snapshots.value.snapshots.some((entry) => entry.reason === "pre-restore"), true);
  const stale = await state.handle.page.evaluate((value) => window.lifeAtlas.workspace.applyChanges(value), changeset);
  assert.equal(stale.ok, false);
  assert.equal(stale.error.code, "E_CONFLICT");
  assertBackupWorkspaceAfterInitialVisit((await workspace(state.handle)).workspace, source.workspaceService.readWorkspace());
  await state.close();
  state.complete();
  source.complete();
});

test("broken packages are rejected with readable reasons", { timeout: 60000 }, async (context) => {
  const source = await packageFixture(context);
  const badFile = path.join(source.dataRoot, "broken.lifeatlas");
  await tamperBackupFile(source.filePath, badFile);
  const state = await createBackupDesktopCase(context, { seed: true, packaged: true, retainOnFailure: true });
  const before = await sha256File(path.join(state.dataRoot, "workspace.db"));
  const panel = await selectBackupUi(state.handle, badFile);
  await panel.locator(".mb-problem-list[role=alert]").waitFor();
  assert.match(await panel.locator(".mb-problem-list").textContent(), /manifest\.json/);
  assert.equal(await panel.getByRole("button", { name: "恢复", exact: true }).count(), 0);
  assert.deepEqual(await sha256File(path.join(state.dataRoot, "workspace.db")), before);
  await state.close();
  state.complete();
  source.complete();
});

test("injected swap failure keeps data unchanged", { timeout: 90000 }, async (context) => {
  const source = await packageFixture(context);
  const state = await createBackupDesktopCase(context, { seed: true, packaged: true, retainOnFailure: true });
  const before = await sha256File(path.join(state.dataRoot, "workspace.db"));
  await state.handle.app.evaluate(() => globalThis.__lifeAtlasTest.injectFailure("restore-swap"));
  const panel = await selectBackupUi(state.handle, source.filePath);
  await panel.getByRole("button", { name: "恢复", exact: true }).click();
  await state.handle.page.getByRole("alertdialog", { name: "恢复这个备份？", exact: true }).getByRole("button", { name: "确认恢复", exact: true }).click();
  await panel.locator(".mb-alert-error").waitFor();
  assert.deepEqual(await sha256File(path.join(state.dataRoot, "workspace.db")), before);
  assertBackupWorkspaceEqual((await workspace(state.handle)).workspace, state.expectedWorkspace);
  assert.deepEqual(fs.readdirSync(state.dataRoot).filter((name) => name.startsWith(".staging-") || name.includes(".replaced-")), []);
  await state.close();
  state.complete();
  source.complete();
});

test("verify reports a damaged file", { timeout: 60000 }, async (context) => {
  const source = await packageFixture(context);
  const badFile = path.join(source.dataRoot, "verify-broken.lifeatlas");
  await tamperBackupFile(source.filePath, badFile);
  const state = await createBackupDesktopCase(context, { seed: true, packaged: true, retainOnFailure: true });
  const panel = await openBackupDialog(state.handle, "校验备份");
  await queueDialogResponse(state.handle, "showOpenDialog", { canceled: false, filePaths: [source.filePath] });
  await panel.getByRole("button", { name: "选择并校验备份…", exact: true }).click();
  await panel.getByRole("status").filter({ hasText: "备份完整性校验通过" }).waitFor();
  await queueDialogResponse(state.handle, "showOpenDialog", { canceled: false, filePaths: [badFile] });
  await panel.getByRole("button", { name: "选择并校验备份…", exact: true }).click();
  await panel.getByRole("status").filter({ hasText: "备份未通过校验" }).waitFor();
  assert.match(await panel.locator(".mb-problem-list").textContent(), /manifest\.json/);
  await state.close();
  state.complete();
  source.complete();
});

test("export of one gigabyte stays within memory budget", { timeout: 300000 }, async (context) => {
  const state = await createBackupDesktopCase(context, { seed: true, gigabyte: true, packaged: true, retainOnFailure: true });
  assert.equal(state.gigabyteHashes.length, 4);
  const output = state.own(createIsolatedDirectory("backup-e2e-gigabyte-output"));
  const filePath = path.join(output, "gigabyte.lifeatlas");
  await state.handle.app.evaluate(() => globalThis.__lifeAtlasTest.memory.start());
  const panel = await exportBackupUi(state.handle, filePath);
  await stopBackupMemory(context, state.handle, "WP05_EXPORT_PEAK_MB");
  assert.ok(fs.statSync(filePath).size > 1000000000);
  const cancelled = path.join(output, "cancelled.lifeatlas");
  await queueDialogResponse(state.handle, "showSaveDialog", { canceled: false, filePath: cancelled });
  await panel.getByRole("button", { name: "导出", exact: true }).click();
  await panel.getByRole("button", { name: "取消导出", exact: true }).click();
  await state.handle.page.waitForFunction(() => [...document.querySelectorAll(".mb-backup-dialog button")].some((button) => button.textContent === "导出" && !button.disabled));
  assert.equal(fs.existsSync(cancelled), false);
  assert.deepEqual(fs.readdirSync(output), ["gigabyte.lifeatlas"]);
  context.diagnostic("WP05_GIGABYTE_ASSET_BYTES=1073741824; files=4; bytesPerFile=268435456");
  await state.close();
  state.complete();
});

test("daily snapshots follow the clock", { timeout: 90000 }, async (context) => {
  const state = await createBackupDesktopCase(context, { seed: true, packaged: true, retainOnFailure: true });
  const initial = await state.handle.app.evaluate(() => globalThis.__lifeAtlasTest.snapshots.checkNow());
  assert.equal(initial.created, true);
  await state.handle.app.evaluate(() => globalThis.__lifeAtlasTest.clock.advance(21 * 3600000));
  const next = await state.handle.app.evaluate(() => globalThis.__lifeAtlasTest.snapshots.checkNow());
  assert.equal(next.created, true);
  assert.notEqual(next.id, initial.id);
  const panel = await openBackupDialog(state.handle, "本机快照");
  assert.equal(await panel.locator(".mb-snapshot-list button").filter({ hasText: "每日快照" }).count(), 2);
  await shootBackupModes(state.handle, state.handle.page, shotsDir, "backup-snapshots");
  await state.close();
  state.complete();
});

test("restore is recorded in the log without content", { timeout: 90000 }, async (context) => {
  const source = await packageFixture(context);
  const state = await createBackupDesktopCase(context, { seed: true, packaged: true, retainOnFailure: true });
  await restoreBackupUi(state.handle, source.filePath);
  await state.close();
  const logs = fs.readdirSync(path.join(state.dataRoot, "logs")).filter((name) => name.endsWith(".log")).map((name) => fs.readFileSync(path.join(state.dataRoot, "logs", name), "utf8")).join("\n");
  assert.equal(logs.includes('"event":"backup.restore"'), true);
  for (const page of source.workspaceService.readWorkspace().pages) if (page.title) assert.equal(logs.includes(page.title), false);
  state.complete();
  source.complete();
});

test("error page offers snapshot and backup recovery", { timeout: 120000 }, async (context) => {
  let originalHash;
  const state = await createBackupDesktopCase(context, { seed: true, ready: false, packaged: true, retainOnFailure: true, prepare: async (value) => {
    const service = createWorkspaceService({ dataRoot: value.dataRoot, appVersion: "0.1.0", now: () => FIXTURE_TIME });
    const snapshots = createSnapshotService({ dataRoot: value.dataRoot, workspaceService: service, appVersion: "0.1.0", now: () => FIXTURE_TIME });
    try { await service.load(); await snapshots.createSnapshot({ reason: "manual" }); }
    finally { await snapshots.stop(); service.close(); }
    fs.writeFileSync(path.join(value.dataRoot, "workspace.db"), "isolated corrupted database fixture");
    originalHash = await sha256File(path.join(value.dataRoot, "workspace.db"));
  } });
  await state.handle.page.getByRole("heading", { name: "数据无法读取", exact: true }).waitFor();
  assert.equal(await state.handle.page.getByRole("button", { name: "从备份恢复", exact: true }).isVisible(), true);
  await state.handle.page.getByRole("button", { name: "从快照恢复", exact: true }).click();
  const panel = state.handle.page.getByRole("dialog", { name: "备份与恢复", exact: true });
  const before = await state.handle.page.evaluate(() => window.lifeAtlas.backup.listSnapshots());
  assert.equal(before.ok, true);
  assert.equal(await panel.getByRole("button", { name: "立即创建快照", exact: true }).isDisabled(), true);
  const after = await state.handle.page.evaluate(() => window.lifeAtlas.backup.listSnapshots());
  assert.deepEqual(after, before);
  await panel.locator(".mb-snapshot-list button").filter({ hasText: "手动快照" }).first().click();
  await panel.getByRole("button", { name: "恢复此快照", exact: true }).click();
  const reload = state.handle.page.waitForEvent("domcontentloaded");
  await state.handle.page.getByRole("alertdialog", { name: "恢复这个快照？", exact: true }).getByRole("button", { name: "确认恢复", exact: true }).click();
  await reload;
  await state.handle.page.locator(".workspace-sidebar").waitFor();
  assertBackupWorkspaceAfterInitialVisit(await captureBackupWorkspace(state.handle), state.fixtureWorkspace);
  const archive = fs.readdirSync(state.dataRoot).find((name) => name.startsWith("workspace.db.corrupt-"));
  assert.ok(archive);
  assert.deepEqual(await sha256File(path.join(state.dataRoot, archive)), originalHash);
  await state.close();
  state.complete();
});
