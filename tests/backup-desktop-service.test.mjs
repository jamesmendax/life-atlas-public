import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createBackupService } from "../electron/main/backup/index.js";
import { createDialogs } from "../electron/main/dialogs.js";
import { createAssetResponse } from "../electron/main/assetProtocol.js";
import { exportFullBackup } from "../electron/main/backup/desktopExport.js";
import { sha256File } from "../electron/main/backup/files.js";
import { WORKSPACE_RESCUE_SCOPE } from "../src/backup/manifest.js";
import { createDesktopBackupContext } from "./desktop/backup-helpers.mjs";

const deferred = () => { let resolve; const promise = new Promise((settle) => { resolve = settle; }); return { promise, resolve }; };
const createService = (fixture, extra = {}) => createBackupService({ ...fixture, dialogs: createDialogs({ testHooksEnabled: true }), requestFlush: async () => true, ...extra });

test("backup service exports with progress and persists the last successful time", async (context) => {
  const fixture = await createDesktopBackupContext(context);
  const dialogs = createDialogs({ testHooksEnabled: true });
  const target = path.join(fixture.dataRoot, "service.lifeatlas");
  dialogs.state.queue.showSaveDialog.push(target);
  let flushes = 0;
  const progress = [];
  const service = createService(fixture, { dialogs, requestFlush: async () => { flushes += 1; return true; } });
  const unsubscribe = service.onProgress((value) => progress.push(value));
  try {
    const result = await service.exportFull({ includeVault: false, encryptPassword: null });
    assert.equal(result.filePath, target);
    assert.equal(result.manifest.app.platform, "desktop");
    assert.equal(flushes, 1);
    assert.equal(service.getStatus().lastFullBackupAt, fixture.now());
    assert.ok(progress.some((value) => value.phase === "write" && value.done > 0 && value.total > 0));
    assert.equal(new Set(progress.map((value) => value.jobId)).size, 1);
    assert.ok(progress.every((value) => value.kind === "export"));
    assert.equal(progress.at(-1).phase, "complete");
  } finally { unsubscribe(); await service.stop(); }
});

test("service cancellation preserves an existing target and removes partial files", async (context) => {
  const fixture = await createDesktopBackupContext(context, { large: true });
  const dialogs = createDialogs({ testHooksEnabled: true });
  const target = path.join(fixture.dataRoot, "existing.lifeatlas");
  fs.writeFileSync(target, "preserve-existing-target");
  const before = await sha256File(target);
  dialogs.state.queue.showSaveDialog.push(target);
  const service = createService(fixture, { dialogs });
  service.onProgress((value) => { if (value.phase === "write" && value.done === 1) service.cancel({ jobId: value.jobId }); });
  try {
    await assert.rejects(service.exportFull({ includeVault: false, encryptPassword: null }), { code: "E_CANCELLED" });
    assert.deepEqual(await sha256File(target), before);
    assert.deepEqual(fs.readdirSync(fixture.dataRoot).filter((name) => name.includes(".partial-")), []);
    assert.equal(service.getStatus().lastFullBackupAt, null);
    assert.throws(() => service.cancel({ jobId: "unknown" }), { code: "E_INVALID_ARGUMENT" });
  } finally { await service.stop(); }
});

test("a failed flush never starts an export", async (context) => {
  const fixture = await createDesktopBackupContext(context);
  const dialogs = createDialogs({ testHooksEnabled: true });
  const target = path.join(fixture.dataRoot, "unflushed.lifeatlas");
  dialogs.state.queue.showSaveDialog.push(target);
  const service = createService(fixture, { dialogs, requestFlush: async () => false });
  try {
    await assert.rejects(service.exportFull({ includeVault: false, encryptPassword: null }), { code: "E_IO" });
    assert.equal(fs.existsSync(target), false);
  } finally { await service.stop(); }
});

test("workspace rescue recovers unsaved edits without SQLite, even after a cancelled or failed destination", async (context) => {
  const source = await createDesktopBackupContext(context);
  const destination = await createDesktopBackupContext(context, { seed: false });
  const stored = source.workspaceService.readWorkspace();
  const workspace = structuredClone(stored);
  const editedPage = workspace.pages.find(({ id }) => id === "p-a1");
  const editedItem = workspace.databaseItems.find(({ id }) => id === "i-3");
  editedPage.content[0].content = "这段正文没有写入原工作区";
  editedItem.values.score = 913;
  const changes = { generation: source.workspaceService.getMeta("generation"), schemaVersion: workspace.schemaVersion, ui: null, deletes: [], upserts: [
    { collection: "pages", id: editedPage.id, json: JSON.stringify(editedPage) },
    { collection: "databaseItems", id: editedItem.id, json: JSON.stringify(editedItem) },
  ] };
  source.workspaceService.db.exec("CREATE TRIGGER refuse_rescue_fixture_writes BEFORE INSERT ON entities BEGIN SELECT RAISE(ABORT, 'persistent write failure'); END");
  await assert.rejects(source.workspaceService.applyChanges(changes), /persistent write failure/);
  await assert.rejects(source.workspaceService.applyChanges(changes), /persistent write failure/);

  const dialogs = createDialogs({ testHooksEnabled: true });
  const rescueFile = path.join(destination.dataRoot, "unsaved.lifeatlas");
  const badTarget = path.join(destination.dataRoot, "read-only-target.lifeatlas");
  const sentinel = path.join(badTarget, "keep.txt");
  fs.mkdirSync(badTarget);
  fs.writeFileSync(sentinel, "existing destination");
  dialogs.state.queue.showSaveDialog.push(null, badTarget, rescueFile);
  const unexpected = () => { throw new Error("rescue must run without workspace storage access"); };
  const rescue = createService(source, { dialogs, requestFlush: unexpected, workspaceService: { status: unexpected }, assetStore: { list: unexpected } });
  const restore = createService(destination, { dialogs });
  context.after(async () => { await rescue.stop(); await restore.stop(); });

  await assert.rejects(rescue.exportRescue(workspace), { code: "E_CANCELLED" });
  await assert.rejects(rescue.exportRescue(workspace), { code: "E_IO" });
  assert.equal(fs.readFileSync(sentinel, "utf8"), "existing destination");
  assert.deepEqual(fs.readdirSync(destination.dataRoot).filter((name) => name.includes(".partial-")), []);
  assert.equal(fs.existsSync(rescueFile), false);
  assert.deepEqual(await rescue.exportRescue(workspace), { filePath: rescueFile });
  assert.equal(source.workspaceService.getMeta("lastFullBackupAt"), null);
  assert.deepEqual(source.workspaceService.readWorkspace(), stored);

  dialogs.state.queue.showOpenDialog.push([rescueFile]);
  const inspected = await restore.inspect();
  assert.ok(inspected.token);
  assert.equal(inspected.summary.scope, WORKSPACE_RESCUE_SCOPE);
  assert.deepEqual(inspected.summary.assets, { count: 0, totalBytes: 0 });
  assert.equal(inspected.summary.vault.included, false);
  await restore.restore({ token: inspected.token, restoreVault: false });
  const restored = destination.workspaceService.readWorkspace();
  assert.deepEqual(restored.pages.find(({ id }) => id === editedPage.id).content, editedPage.content);
  assert.equal(restored.databaseItems.find(({ id }) => id === editedItem.id).values.score, 913);
  assert.deepEqual(restored.attachments, workspace.attachments);
  assert.deepEqual(destination.assetStore.list(), []);

  const imageUrl = stored.pages.find(({ id }) => id === "p-b1").content.find(({ id }) => id === "b-b1-img").props.url;
  const readImage = (assetStore) => createAssetResponse(new Request(imageUrl), { assetStore });
  assert.equal(readImage(destination.assetStore).status, 404);
  const original = readImage(source.assetStore);
  assert.equal(original.status, 200);
  const originalBytes = await original.bytes();
  source.workspaceService.db.exec("DROP TRIGGER refuse_rescue_fixture_writes");
  const restoreInPlace = createService(source, { dialogs });
  context.after(() => restoreInPlace.stop());
  dialogs.state.queue.showOpenDialog.push([rescueFile]);
  const inPlace = await restoreInPlace.inspect();
  await restoreInPlace.restore({ token: inPlace.token, restoreVault: false });
  const localImage = readImage(source.assetStore);
  assert.equal(localImage.status, 200);
  assert.deepEqual(await localImage.bytes(), originalBytes);
  assert.equal(source.workspaceService.readWorkspace().databaseItems.find(({ id }) => id === editedItem.id).values.score, 913);
});

test("export jobs are serialized and stop aborts queued exports", async (context) => {
  const fixture = await createDesktopBackupContext(context);
  const dialogs = createDialogs({ testHooksEnabled: true });
  const first = path.join(fixture.dataRoot, "first.lifeatlas");
  const second = path.join(fixture.dataRoot, "second.lifeatlas");
  dialogs.state.queue.showSaveDialog.push(first, second);
  const entered = deferred();
  const released = deferred();
  const service = createService(fixture, { dialogs, requestFlush: async () => { entered.resolve(); await released.promise; return true; } });
  const firstExport = service.exportFull({ includeVault: false, encryptPassword: null });
  const secondExport = service.exportFull({ includeVault: false, encryptPassword: null });
  const outcomes = Promise.allSettled([firstExport, secondExport]);
  await entered.promise;
  assert.equal(dialogs.state.calls.filter((call) => call.kind === "showSaveDialog").length, 1);
  const stopping = service.stop();
  released.resolve();
  await stopping;
  const results = await outcomes;
  assert.ok(results.every((result) => result.status === "rejected" && result.reason.code === "E_CANCELLED"));
  assert.equal(fs.existsSync(first), false);
  assert.equal(fs.existsSync(second), false);
});

test("restore and shutdown wait for the asynchronous renderer reload barrier", async (context) => {
  const source = await createDesktopBackupContext(context);
  const destination = await createDesktopBackupContext(context, { seed: false });
  const targetPath = path.join(source.dataRoot, "reload.lifeatlas");
  await exportFullBackup({ ...source, db: source.workspaceService.db, workspace: source.workspaceService.readWorkspace(), targetPath });
  const entered = deferred();
  const released = deferred();
  const service = createService(destination, { reloadWorkspace: async () => { entered.resolve(); await released.promise; } });
  const { token } = await service.inspectFile(targetPath);
  const restored = service.restore({ token, restoreVault: false });
  await entered.promise;
  let stopped = false;
  const stopping = service.stop().then(() => { stopped = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(stopped, false);
  released.resolve();
  await restored;
  await stopping;
  assert.equal(destination.workspaceService.readWorkspace().pages.length, source.workspaceService.readWorkspace().pages.length);
});
