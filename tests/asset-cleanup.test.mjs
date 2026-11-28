import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { collectAssetReferences, collectAttachmentReferences, unreferencedAssets, trashBatchId, expiredBatches, createAssetCleanupService } from "../electron/main/storage/assetCleanup.js";
import { createAssetStore } from "../electron/main/storage/assetStore.js";
import { openWorkspaceDatabase, prepareWritable, initializeWorkspace, replaceDatabaseWorkspace, readAssetRows } from "../electron/main/storage/workspaceDb.js";
import { createSnapshot, createSnapshotService } from "../electron/main/storage/snapshots.js";
import { normalizeLoadedWorkspace } from "../src/persistence/normalize.js";
import { createPageVersion } from "../src/domain/pageHistory.js";
import { fullWorkspace, fixtureBytes, FIXTURE_TIME } from "./fixtures/full-workspace.mjs";
import { createIsolatedDirectory, removeIsolatedDirectory } from "./desktop/helpers.mjs";
import { registerAssetsIpc } from "../electron/main/ipc/assets.js";

const DAY = 86400000;
const instant = Date.parse(FIXTURE_TIME);

async function fixture(context, { withSnapshot = true } = {}) {
  const dataRoot = createIsolatedDirectory("asset-cleanup-test");
  const db = openWorkspaceDatabase(path.join(dataRoot, "workspace.db"));
  context.after(() => { db.close(); removeIsolatedDirectory(dataRoot); });
  prepareWritable(db);
  const input = fullWorkspace();
  let workspace = normalizeLoadedWorkspace({ ...input, workspaceId: "ws-asset-cleanup" }, { fallbackWorkspace: input, now: FIXTURE_TIME, idFactory: (prefix) => `${prefix}-cleanup` });
  initializeWorkspace(db, workspace, { generation: "gen-cleanup", now: FIXTURE_TIME });
  const store = createAssetStore({ assetsDir: path.join(dataRoot, "assets"), db, now: FIXTURE_TIME });
  const hashes = Object.fromEntries(["current", "version", "snapshot", "orphan", "record"].map((label) => [label, store.put({ bytes: fixtureBytes(`cleanup-${label}`, 128), mime: "text/plain", name: `${label}.txt` }).assetId]));
  const image = (label) => ({ id: `cleanup-${label}`, type: "image", props: { url: `life-asset://${hashes[label]}` } });
  workspace = {
    ...workspace,
    pages: workspace.pages.map((page) => page.id === "p-a1" ? { ...page, content: [...page.content, image("current"), ...(withSnapshot ? [image("snapshot")] : [])] } : page),
    pageVersions: [createPageVersion({ ...workspace.pages.find((page) => page.id === "p-a1"), content: [image("version")] }, { id: "version-cleanup", now: instant, reason: "manual" })],
    attachments: [
      ...workspace.attachments,
      { id: "att-cleanup-record", provider: "asset", storageKey: hashes.record, name: "record.txt", mime: "text/plain", size: 128, createdAt: FIXTURE_TIME },
      { id: "att-cleanup-orphan", provider: "asset", storageKey: hashes.orphan, name: "orphan.txt", mime: "text/plain", size: 128, createdAt: FIXTURE_TIME },
    ],
    databaseItems: workspace.databaseItems.map((item) => item.id === "i-1" ? { ...item, values: { ...item.values, files: ["att-cleanup-record"] } } : item),
  };
  replaceDatabaseWorkspace(db, workspace, { generation: "gen-cleanup", now: FIXTURE_TIME });
  let snapshot;
  if (withSnapshot) {
    snapshot = await createSnapshot({ dataRoot, reason: "manual", databases: [{ name: "workspace.db", db }], appVersion: "0.1.0", schemaVersion: workspace.schemaVersion, now: FIXTURE_TIME });
    workspace = { ...workspace, pages: workspace.pages.map((page) => ({ ...page, content: page.content.filter((block) => block.id !== "cleanup-snapshot") })) };
    replaceDatabaseWorkspace(db, workspace, { generation: "gen-cleanup", now: FIXTURE_TIME });
  } else {
    workspace = { ...workspace, pages: workspace.pages.map((page) => page.id === "p-a1" ? { ...page, content: [...page.content, image("snapshot")] } : page) };
    replaceDatabaseWorkspace(db, workspace, { generation: "gen-cleanup", now: FIXTURE_TIME });
  }
  let time = instant;
  let sequence = 0;
  let connection = db;
  const cleanup = createAssetCleanupService({ dataRoot, db: () => connection, now: () => time, randomHex4: () => (++sequence).toString(16).padStart(4, "0") });
  return { dataRoot, db, store, hashes, cleanup, snapshot, get workspace() { return workspace; }, save(next) { workspace = next; replaceDatabaseWorkspace(db, workspace, { generation: "gen-cleanup", now: FIXTURE_TIME }); }, advance(days) { time += days * DAY; }, setConnection(value) { connection = value; } };
}

test("asset references are found in any json text", () => {
  const firstHash = "a".repeat(64);
  const secondHash = "b".repeat(64);
  const uppercaseHash = "C".repeat(64);
  const texts = [`{"x":"life-asset://${firstHash}","y":"life-asset://${secondHash}"}`, `{"z":"life-asset://${firstHash}","w":"life-asset://${uppercaseHash}"}`];
  assert.deepEqual(collectAssetReferences(texts), new Set([firstHash, secondHash]));
});

test("attachments referenced by id keep their files", () => {
  const fileHash = "f".repeat(64);
  const orphanHash = "0".repeat(64);
  const attachments = [{ id: "att-file", provider: "asset", storageKey: fileHash }, { id: "att-orphan", provider: "asset", storageKey: orphanHash }, { id: "att-web", provider: "indexeddb", storageKey: "att-web" }];
  assert.deepEqual(collectAttachmentReferences(attachments, ['{"values":{"files":["att-file"]}}']), new Set([fileHash]));
});

test("unreferenced assets exclude every referenced hash", () => {
  const rows = [{ sha256: "a".repeat(64) }, { sha256: "b".repeat(64) }, { sha256: "c".repeat(64) }];
  assert.deepEqual(unreferencedAssets(rows, new Set([rows[0].sha256, rows[2].sha256])), [rows[1]]);
});

test("trash batch ids use utc time", () => {
  assert.equal(trashBatchId(Date.UTC(2026, 10, 1, 9, 30, 5), "a1b2"), "20261101-093005-a1b2");
});

test("batches expire after thirty days", () => {
  const batches = [{ trashId: "young", createdAt: instant - 29 * DAY }, { trashId: "old", createdAt: new Date(instant - 31 * DAY).toISOString() }, { trashId: "boundary", createdAt: String(instant - 30 * DAY) }];
  assert.deepEqual(expiredBatches(batches, instant), [batches[1]]);
});

test("current pages history snapshots and record file ids retain their assets", async (context) => {
  const state = await fixture(context);
  const { candidates } = await state.cleanup.scanUnreferenced();
  assert.deepEqual(candidates.map((row) => row.sha256), [state.hashes.orphan]);
  assert.deepEqual(Object.keys(candidates[0]).sort(), ["createdAt", "mime", "originalName", "sha256", "size"]);
  assert.equal(candidates[0].originalName, "orphan.txt");
});

test("snapshots resolve file ids using each database attachment rows", async (context) => {
  const state = await fixture(context);
  const replacement = state.store.put({ bytes: fixtureBytes("cleanup-new-record", 128), mime: "text/plain", name: "new-record.txt" }).assetId;
  state.save({ ...state.workspace, attachments: state.workspace.attachments.map((attachment) => attachment.id === "att-cleanup-record" ? { ...attachment, storageKey: replacement } : attachment) });
  assert.deepEqual((await state.cleanup.scanUnreferenced()).candidates.map((row) => row.sha256), [state.hashes.orphan]);
});

test("trashed pages retain their referenced assets", async (context) => {
  const state = await fixture(context);
  state.save({ ...state.workspace, pages: state.workspace.pages.map((page) => page.id === "p-b-solo" ? { ...page, content: [{ id: "cleanup-trashed", type: "file", props: { url: `life-asset://${state.hashes.orphan}` } }] } : page) });
  assert.deepEqual((await state.cleanup.scanUnreferenced()).candidates, []);
});

test("an unreadable snapshot fails the entire cleanup scan closed", async (context) => {
  const state = await fixture(context);
  const file = path.join(state.dataRoot, "snapshots", state.snapshot.id, "workspace.db");
  fs.writeFileSync(file, "not a sqlite database");
  const before = readAssetRows(state.db);
  await assert.rejects(async () => state.cleanup.scanUnreferenced(), (error) => error.code === "E_IO" && error.message.includes(state.snapshot.id) && error.message.includes("为安全起见暂不清理附件"));
  await assert.rejects(() => state.cleanup.moveToTrash({ sha256s: [state.hashes.orphan] }), { code: "E_IO" });
  assert.deepEqual(readAssetRows(state.db), before);
  assert.equal(fs.existsSync(state.store.filePath(state.hashes.orphan)), true);
  assert.equal(fs.existsSync(path.join(state.dataRoot, "asset-trash")), false);
});

test("moving assets rescans immediately and skips newly referenced files", async (context) => {
  const state = await fixture(context);
  assert.deepEqual((await state.cleanup.scanUnreferenced()).candidates.map((row) => row.sha256), [state.hashes.orphan]);
  state.save({ ...state.workspace, pages: state.workspace.pages.map((page) => page.id === "p-a1" ? { ...page, cover: { kind: "upload", value: `life-asset://${state.hashes.orphan}`, position: 50 } } : page) });
  assert.deepEqual(await state.cleanup.moveToTrash({ sha256s: [state.hashes.orphan] }), { trashId: null, movedCount: 0 });
  assert.equal(fs.existsSync(state.store.filePath(state.hashes.orphan)), true);
  assert.deepEqual((await state.cleanup.listTrash()).batches, []);
});

test("references added during the first scan survive the final rescan", async (context) => {
  const state = await fixture(context);
  let changed = false;
  state.setConnection({ prepare(sql) {
    const statement = state.db.prepare(sql);
    if (!sql.startsWith("SELECT sha256, size, mime")) return statement;
    return { all() {
      const rows = statement.all();
      if (!changed) {
        changed = true;
        state.save({ ...state.workspace, pages: state.workspace.pages.map((page) => page.id === "p-a1" ? { ...page, cover: { kind: "upload", value: `life-asset://${state.hashes.orphan}`, position: 50 } } : page) });
      }
      return rows;
    } };
  } });
  assert.deepEqual(await state.cleanup.moveToTrash({ sha256s: [state.hashes.orphan] }), { trashId: null, movedCount: 0 });
  assert.equal(changed, true);
  assert.equal(fs.existsSync(state.store.filePath(state.hashes.orphan)), true);
});

test("scanning and moving flush unsaved new references before reading storage", async (context) => {
  const state = await fixture(context);
  assert.deepEqual((await state.cleanup.scanUnreferenced()).candidates.map((row) => row.sha256), [state.hashes.orphan]);
  let flushes = 0;
  const cleanup = createAssetCleanupService({ dataRoot: state.dataRoot, db: state.db, now: instant, requestFlush: async () => {
    flushes += 1;
    state.save({ ...state.workspace, pages: state.workspace.pages.map((page) => page.id === "p-a1" ? { ...page, cover: { kind: "upload", value: `life-asset://${state.hashes.orphan}`, position: 50 } } : page) });
    return true;
  } });
  assert.deepEqual((await cleanup.scanUnreferenced()).candidates, []);
  assert.deepEqual(await cleanup.moveToTrash({ sha256s: [state.hashes.orphan] }), { trashId: null, movedCount: 0 });
  assert.equal(flushes, 2);
  assert.equal(fs.existsSync(state.store.filePath(state.hashes.orphan)), true);
});

test("a failed flush rejects cleanup without reading stale references or moving files", async (context) => {
  const state = await fixture(context);
  let reads = 0;
  const cleanup = createAssetCleanupService({ dataRoot: state.dataRoot, db: () => { reads += 1; return state.db; }, now: instant, requestFlush: async () => false });
  const before = readAssetRows(state.db);
  await assert.rejects(() => cleanup.scanUnreferenced(), { code: "E_IO" });
  await assert.rejects(() => cleanup.moveToTrash({ sha256s: [state.hashes.orphan] }), { code: "E_IO" });
  assert.equal(reads, 0);
  assert.deepEqual(readAssetRows(state.db), before);
  assert.equal(fs.existsSync(state.store.filePath(state.hashes.orphan)), true);
  assert.equal(fs.existsSync(path.join(state.dataRoot, "asset-trash")), false);
});

test("attachment trash restores files and metadata and expires after thirty days", async (context) => {
  const state = await fixture(context);
  const original = state.store.get(state.hashes.orphan);
  const first = await state.cleanup.moveToTrash({ sha256s: Object.values(state.hashes) });
  assert.equal(first.movedCount, 1);
  const directory = path.join(state.dataRoot, "asset-trash", first.trashId);
  assert.equal(fs.existsSync(state.store.filePath(state.hashes.orphan)), false);
  assert.equal(state.store.get(state.hashes.orphan), null);
  assert.equal(fs.existsSync(path.join(directory, state.hashes.orphan)), true);
  const batches = (await state.cleanup.listTrash()).batches;
  assert.deepEqual(batches, [{ trashId: first.trashId, createdAt: FIXTURE_TIME, count: 1, sizeBytes: 128, expiresAt: new Date(instant + 30 * DAY).toISOString() }]);
  assert.deepEqual(await state.cleanup.restoreTrash({ trashId: first.trashId }), { restoredCount: 1 });
  assert.deepEqual(state.store.get(state.hashes.orphan), original);
  assert.equal(fs.existsSync(directory), false);
  const second = await state.cleanup.moveToTrash({ sha256s: [state.hashes.orphan] });
  state.advance(29);
  assert.deepEqual(await state.cleanup.purgeExpired(), { deletedCount: 0 });
  assert.equal(fs.existsSync(path.join(state.dataRoot, "asset-trash", second.trashId)), true);
  state.advance(2);
  assert.deepEqual(await state.cleanup.purgeExpired(), { deletedCount: 1 });
  assert.deepEqual((await state.cleanup.listTrash()).batches, []);
});

test("restoring trash never overwrites a conflicting destination", async (context) => {
  const state = await fixture(context);
  const batch = await state.cleanup.moveToTrash({ sha256s: [state.hashes.orphan] });
  const target = state.store.filePath(state.hashes.orphan);
  fs.writeFileSync(target, "different bytes");
  await assert.rejects(() => state.cleanup.restoreTrash({ trashId: batch.trashId }), { code: "E_CORRUPT" });
  assert.equal(fs.readFileSync(target, "utf8"), "different bytes");
  assert.equal(fs.existsSync(path.join(state.dataRoot, "asset-trash", batch.trashId, state.hashes.orphan)), true);
  assert.equal(state.store.get(state.hashes.orphan), null);
});

test("restoring a duplicate preserves the current file and newer metadata", async (context) => {
  const state = await fixture(context);
  const batch = await state.cleanup.moveToTrash({ sha256s: [state.hashes.orphan] });
  state.store.put({ bytes: fixtureBytes("cleanup-orphan", 128), mime: "text/plain", name: "uploaded-again.txt" });
  const before = state.store.get(state.hashes.orphan);
  assert.deepEqual(await state.cleanup.restoreTrash({ trashId: batch.trashId }), { restoredCount: 1 });
  assert.deepEqual(state.store.get(state.hashes.orphan), before);
  assert.deepEqual((await state.cleanup.listTrash()).batches, []);
});

test("moving rolls file changes back when the asset row transaction fails", async (context) => {
  const state = await fixture(context);
  const before = readAssetRows(state.db);
  state.setConnection({ prepare(sql) { if (sql.startsWith("DELETE FROM assets")) throw new Error("simulated database failure"); return state.db.prepare(sql); }, exec(sql) { return state.db.exec(sql); } });
  await assert.rejects(() => state.cleanup.moveToTrash({ sha256s: [state.hashes.orphan] }), { code: "E_IO" });
  assert.deepEqual(readAssetRows(state.db), before);
  assert.equal(fs.existsSync(state.store.filePath(state.hashes.orphan)), true);
  assert.deepEqual(fs.readdirSync(path.join(state.dataRoot, "asset-trash")), []);
});

test("candidate ordering supports numeric and iso datastore timestamps", async (context) => {
  const state = await fixture(context);
  const extra = state.store.put({ bytes: fixtureBytes("cleanup-older", 128), mime: "text/plain", name: "older.txt" }).assetId;
  state.db.prepare("UPDATE assets SET created_at=? WHERE sha256=?").run(String(instant - DAY), extra);
  assert.deepEqual((await state.cleanup.scanUnreferenced()).candidates.map((row) => row.sha256), [extra, state.hashes.orphan]);
});

test("daily snapshot timers and checkNow both trigger attachment expiry", async (context) => {
  const state = await fixture(context);
  const timers = { timeouts: [], intervals: [], setTimeout(callback, delay) { const timer = { callback, delay, unref() {} }; this.timeouts.push(timer); return timer; }, setInterval(callback, delay) { const timer = { callback, delay, unref() {} }; this.intervals.push(timer); return timer; }, clearTimeout() {}, clearInterval() {} };
  let time = instant;
  let checks = 0;
  const service = createSnapshotService({ dataRoot: state.dataRoot, appVersion: "0.1.0", now: () => time, timers, workspaceService: { status: () => ({ loaded: true }), readWorkspace: () => state.workspace, get db() { return state.db; } }, onDailyCheck: async () => { checks += 1; await state.cleanup.purgeExpired(); } });
  context.after(() => service.stop());
  const first = await state.cleanup.moveToTrash({ sha256s: [state.hashes.orphan] });
  state.advance(31);
  time += 31 * DAY;
  service.start();
  assert.equal(timers.timeouts[0].delay, 60000);
  assert.equal(timers.intervals[0].delay, 3600000);
  await timers.timeouts[0].callback();
  await service.stop();
  assert.equal(checks, 1);
  assert.equal(fs.existsSync(path.join(state.dataRoot, "asset-trash", first.trashId)), false);
  state.store.put({ bytes: fixtureBytes("cleanup-orphan", 128), mime: "text/plain", name: "orphan.txt" });
  const second = await state.cleanup.moveToTrash({ sha256s: [state.hashes.orphan] });
  state.advance(31);
  time += 31 * DAY;
  const result = await service.checkNow();
  assert.equal(result.created, true);
  assert.equal(checks, 2);
  assert.equal(fs.existsSync(path.join(state.dataRoot, "asset-trash", second.trashId)), false);
});

test("cleanup callback errors remain non sensitive and do not block snapshots", async (context) => {
  const state = await fixture(context);
  const logs = [];
  const service = createSnapshotService({ dataRoot: state.dataRoot, appVersion: "0.1.0", now: FIXTURE_TIME, workspaceService: { status: () => ({ loaded: true }), readWorkspace: () => state.workspace, get db() { return state.db; } }, logger: (event, fields) => logs.push({ event, ...fields }), onDailyCheck: () => { throw Object.assign(new Error("private content must not be logged"), { code: "E_IO" }); } });
  context.after(() => service.stop());
  assert.equal((await service.checkNow()).created, true);
  assert.deepEqual(logs.find((record) => record.event === "asset-trash.cleanup-failed"), { event: "asset-trash.cleanup-failed", errorCode: "E_IO" });
  assert.equal(JSON.stringify(logs).includes("private content"), false);
});

test("asset maintenance IPC checks ownership before exact arguments", async () => {
  const handlers = new Map();
  const frame = { routingId: 1, processId: 10, isDestroyed: () => false };
  const contents = { id: 42, mainFrame: frame, isDestroyed: () => false };
  const window = { webContents: contents, isDestroyed: () => false };
  let scans = 0;
  registerAssetsIpc({ ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) }, getWorkspaceWindow: () => window, assetStore: {}, maintenance: { scanUnreferenced: () => { scans += 1; return { candidates: [] }; }, moveToTrash: () => ({}), listTrash: () => ({ batches: [] }), restoreTrash: () => ({}) } });
  const event = { sender: contents, senderFrame: frame };
  const scan = handlers.get("la:assets:scan-unreferenced");
  assert.equal((await scan({ sender: { id: 42 }, senderFrame: frame }, {})).error.code, "E_FORBIDDEN");
  assert.equal((await scan(event, {})).error.code, "E_INVALID_ARGUMENT");
  assert.deepEqual(await scan(event), { ok: true, value: { candidates: [] } });
  assert.equal(scans, 1);
  const move = handlers.get("la:assets:move-to-trash");
  for (const args of [{ sha256s: [] }, { sha256s: ["A".repeat(64)] }, { sha256s: ["a".repeat(64), "a".repeat(64)] }]) assert.equal((await move(event, args)).error.code, "E_INVALID_ARGUMENT");
  for (const trashId of ["../outside", "arbitrary", "20261101-093005-ABCD"]) assert.equal((await handlers.get("la:assets:restore-trash")(event, { trashId })).error.code, "E_INVALID_ARGUMENT");
});
