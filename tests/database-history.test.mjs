import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  assertDatabaseRestoreAttachments, captureDatabaseVersions, MAX_DATABASE_VERSION_BYTES, previewDatabaseRestore, recordDatabaseVersion, restoreDatabaseVersion,
} from "../src/domain/databaseHistory.js";
import { createDatabaseView } from "../src/domain/database.js";
import { dashboardProjection } from "../src/domain/dashboard.js";
import { archivePage } from "../src/domain/archive.js";
import { attachmentReferences, permanentlyDelete, trashPage } from "../src/domain/trash.js";
import { removeBrowserAttachmentBlob, writeBrowserAttachmentBlob } from "../src/domain/attachments.js";
import { backupFixture, backupWorkspace, memoryStorage } from "./fixtures/backup-helpers.mjs";
import { fullWorkspaceAttachmentBytes } from "./fixtures/full-workspace.mjs";
import { inspectBrowserBackup, restoreBrowserBackup } from "../src/backup/browserBackup.js";
import { parseJsonBytes } from "../src/backup/serialize.js";
import { convertBrowserPackage } from "../electron/main/backup/legacyConversion.js";
import { assembleWorkspace, initializeWorkspace, openWorkspaceDatabase, prepareWritable, quickCheck, readAllRows, validateWorkspaceSnapshot } from "../electron/main/storage/workspaceDb.js";

const SOURCE = "ds-inline";
const FIRST = "2026-10-02T00:00:00.000Z";
const LATER = "2026-10-03T00:00:00.000Z";
const idMaker = () => { let counter = 0; return (prefix) => `${prefix}-test-${++counter}`; };
const row = (workspace, id) => workspace.databaseItems.find((item) => item.id === id);
const page = (workspace, id) => workspace.pages.find((item) => item.id === id);
const view = (workspace, id) => workspace.databaseViews.find((record) => record.id === id);
const source = (workspace) => workspace.dataSources.find((item) => item.id === SOURCE);
const history = (workspace) => workspace.databaseVersions.filter((version) => version.sourceId === SOURCE);
const update = (workspace, collection, id, patch) => ({ ...workspace, [collection]: workspace[collection].map((item) => item.id === id ? { ...item, ...patch } : item) });
const bodies = (workspace) => workspace.pages.map(({ id, content }) => [id, content]);

function prepared() {
  const idFactory = idMaker();
  const workspace = recordDatabaseVersion(backupWorkspace(), SOURCE, { idFactory, now: FIRST });
  return { workspace, idFactory, version: history(workspace)[0] };
}

test("automatic history records pre-edit data without snapshots for body, link-view, or timestamp edits", () => {
  const idFactory = idMaker(), before = backupWorkspace();
  const patch = update(before, "pages", "p-rec-1", { content: [{ id: "latest", type: "paragraph", content: "当前正文" }] });
  assert.equal(captureDatabaseVersions(before, patch, { idFactory }), patch);
  const linked = update(patch, "databaseViews", "v-inline-linked", { name: "新链接视图名" });
  assert.equal(captureDatabaseVersions(patch, linked, { idFactory }), linked);
  const timestamp = update(linked, "databaseItems", "i-1", { updatedAt: FIRST });
  assert.equal(captureDatabaseVersions(linked, timestamp, { idFactory }), timestamp);
  const changed = update(timestamp, "databaseItems", "i-1", { values: { ...row(timestamp, "i-1").values, done: false } });
  const captured = captureDatabaseVersions(timestamp, changed, { idFactory, now: FIRST });
  const [version] = history(captured);
  assert.equal(version.reason, "before-edit");
  assert.equal(version.items.find(({ id }) => id === "i-1").values.done, true);
  assert.equal(version.items.some((item) => "content" in item), false);
  assert.equal(version.views.some((entry) => entry.id === "v-inline-linked"), false);
  assert.equal(captureDatabaseVersions(timestamp, captured, { idFactory, now: LATER }), captured);
  const durableDelete = permanentlyDelete(captured, { pageIds: ["p-rec-1"] });
  assert.equal(captureDatabaseVersions(captured, durableDelete, { idFactory }), durableDelete);
});

test("full restore rewinds raw values and own views, restores trashed records, and preserves all current page bodies", () => {
  const { workspace, idFactory, version } = prepared();
  let next = update(workspace, "dataSources", SOURCE, {
    properties: source(workspace).properties.filter((field) => field.id !== "files").map((field) => field.id === "done" ? { ...field, type: "text" } : field),
    recordLayout: { mode: "current" }, dependencyConfig: { enabled: true },
  });
  const editedValues = { ...row(next, "i-1").values, title: "今天的名称", done: "yes" };
  delete editedValues.files;
  next = update(next, "databaseItems", "i-1", { values: editedValues });
  next = update(next, "pages", "p-rec-1", { title: "今天的名称", content: [{ id: "current", type: "paragraph", content: "此正文从未进库历史" }] });
  next = update(next, "databaseItems", "i-2", { parentItemId: "i-1" });
  next = update(next, "pages", "p-rec-2", { parentDatabaseItemId: "i-1" });
  next = trashPage(next, "p-rec-1", LATER);
  next = update(next, "databaseViews", "v-inline-table", { sorts: [{ propertyId: "title", direction: "desc" }] });
  next = update(next, "databaseViews", "v-inline-linked", { name: "外部编辑后" });
  const newest = createDatabaseView({ sourceId: SOURCE, id: "v-recent", name: "新视图" });
  const last = { ...row(next, "i-2"), id: "i-recent", pageId: "p-recent", values: { title: "新记录", done: "typed after snapshot" } };
  next = {
    ...next,
    databaseItems: [...next.databaseItems, last],
    databaseViews: [...next.databaseViews, newest],
    pages: [...next.pages, { ...page(next, "p-rec-2"), id: last.pageId, title: "新记录", content: [{ id: "latest-row", type: "paragraph", content: "新记录正文" }] }],
  };
  const original = structuredClone(next);
  const impact = previewDatabaseRestore(next, SOURCE, version.id);
  assert.equal(impact.ok, true, impact.reason);
  assert.equal(impact.summary.rowsRestored, 1);
  assert.equal(impact.summary.rowsToTrash, 1);
  assert.deepEqual(impact.summary.views.map(({ id }) => id), ["v-inline-table"]);
  assert.deepEqual(impact.summary.columns.map(({ id }) => id).sort(), ["done", "files"]);
  assert.deepEqual(impact.attachmentIds, ["att-file"]);
  assert.deepEqual(next, original);
  const restored = restoreDatabaseVersion(next, SOURCE, version.id, { expectedSignature: impact.expectedSignature, now: LATER, idFactory });
  assert.equal(page(restored, "p-rec-1").trashedAt, null);
  assert.equal(page(restored, "p-recent").trashedAt, LATER);
  assert.equal(page(restored, "p-rec-1").title, "任务一");
  assert.equal(row(restored, "i-2").parentItemId, null);
  assert.equal(page(restored, "p-rec-2").parentDatabaseItemId, null);
  assert.deepEqual(row(restored, "i-1").values, row(workspace, "i-1").values);
  assert.equal(row(restored, last.id), last);
  assert.deepEqual(bodies(restored), bodies(next));
  assert.deepEqual(view(restored, "v-inline-table"), view(workspace, "v-inline-table"));
  assert.equal(view(restored, "v-inline-linked"), view(next, "v-inline-linked"));
  assert.equal(view(restored, "v-recent"), newest);
  assert.deepEqual(restored.relations, next.relations);
  assert.equal(history(restored).at(-1).reason, "pre-restore");
  assert.ok(history(restored).at(-1).items.some(({ id }) => id === last.id));
  assert.deepEqual(next, original);
});

test("single-record recovery restores compatible values and dependencies without editing source, views, other rows, or current bodies", () => {
  let workspace = backupWorkspace();
  workspace = update(workspace, "databaseItems", "i-2", { parentItemId: "i-1", dependencyIds: ["i-1"] });
  workspace = update(workspace, "pages", "p-rec-2", { parentDatabaseItemId: "i-1" });
  const idFactory = idMaker();
  workspace = recordDatabaseVersion(workspace, SOURCE, { idFactory, now: FIRST });
  const version = history(workspace)[0];
  let edited = update(workspace, "databaseItems", "i-2", {
    values: { ...row(workspace, "i-2").values, done: true, added: "keep current" }, parentItemId: null, dependencyIds: [],
  });
  edited = update(edited, "pages", "p-rec-2", { parentDatabaseItemId: null });
  edited = update(edited, "dataSources", SOURCE, { properties: [...source(edited).properties, { id: "added", name: "新字段", type: "text" }] });
  const impact = previewDatabaseRestore(edited, SOURCE, version.id, { itemId: "i-2" });
  assert.equal(impact.ok, true, impact.reason);
  const restored = restoreDatabaseVersion(edited, SOURCE, version.id, { itemId: "i-2", expectedSignature: impact.expectedSignature, now: LATER, idFactory });
  assert.deepEqual(bodies(restored), bodies(edited));
  assert.equal(page(restored, "p-rec-1"), page(edited, "p-rec-1"));
  assert.equal(page(restored, "p-rec-2").parentDatabaseItemId, "i-1");
  assert.equal(page(restored, "p-rec-2").content, page(edited, "p-rec-2").content);
  assert.equal(restored.dataSources, edited.dataSources);
  assert.equal(restored.databaseViews, edited.databaseViews);
  assert.equal(row(restored, "i-1"), row(edited, "i-1"));
  assert.deepEqual(row(restored, "i-2").values, { ...row(workspace, "i-2").values, added: "keep current" });
  assert.equal(row(restored, "i-2").parentItemId, "i-1");
  assert.deepEqual(row(restored, "i-2").dependencyIds, ["i-1"]);
});

test("a historical parent or predecessor must be available, unarchived, and unlocked", () => {
  for (const [field, value, label] of [["parentItemId", "i-1", "父级"], ["dependencyIds", ["i-1"], "依赖"]]) {
    const idFactory = idMaker();
    const seeded = update(backupWorkspace(), "databaseItems", "i-2", { [field]: value });
    const captured = recordDatabaseVersion(seeded, SOURCE, { idFactory, now: FIRST });
    const version = history(captured)[0];
    const edited = update(captured, "databaseItems", "i-2", { parentItemId: null, dependencyIds: [] });
    const request = { itemId: "i-2" };
    const earlier = previewDatabaseRestore(edited, SOURCE, version.id, request);
    assert.equal(earlier.ok, true, earlier.reason);
    const unavailable = [
      [archivePage(edited, "p-rec-1", true, LATER), "已归档"],
      [update(edited, "pages", "p-rec-1", { settings: { locked: true } }), "已锁定"],
      [update(edited, "databaseItems", "i-1", { locked: true }), "已锁定"],
      [trashPage(edited, "p-rec-1", LATER), "不可用"],
    ];
    for (const [current, state] of unavailable) {
      const issue = new RegExp(`${label}记录 i-1 ${state}`);
      const copy = structuredClone(current);
      const preview = previewDatabaseRestore(current, SOURCE, version.id, request);
      assert.equal(preview.ok, false);
      assert.match(preview.reason, issue);
      assert.throws(() => restoreDatabaseVersion(current, SOURCE, version.id, {
        ...request, now: LATER, idFactory, expectedSignature: earlier.expectedSignature,
      }), issue);
      assert.deepEqual(current, copy);
    }
  }
});

test("missing rows, locks, references, relation conflicts and stale previews leave the whole graph untouched", () => {
  const { workspace, idFactory, version } = prepared();
  const edited = update(workspace, "databaseItems", "i-1", { values: { ...row(workspace, "i-1").values, done: false } });
  const initial = previewDatabaseRestore(edited, SOURCE, version.id);
  assert.equal(initial.ok, true, initial.reason);
  const cases = [
    [permanentlyDelete(edited, { pageIds: ["p-rec-1"] }), /永久删除/],
    [update(edited, "pages", "p-rec-1", { settings: { locked: true } }), /已锁定/],
    [{ ...edited, attachments: edited.attachments.filter((entry) => entry.id !== "att-file") }, /缺少附件/],
    [update(edited, "databaseItems", "i-3", { values: { ...row(edited, "i-3").values, "rel-back": ["i-2"] } }), /反向关联不一致/],
    [update(edited, "databaseItems", "i-2", { values: { ...row(edited, "i-2").values, done: true } }), /重新预览/],
  ];
  for (const [current, expected] of cases) {
    const copy = structuredClone(current);
    assert.throws(() => restoreDatabaseVersion(current, SOURCE, version.id, { expectedSignature: initial.expectedSignature, now: LATER, idFactory }), expected);
    assert.deepEqual(current, copy);
  }
});

test("archive inheritance protects the database owner and affected row pages", () => {
  const { workspace, version } = prepared();
  const edited = update(workspace, "databaseItems", "i-1", { values: { ...row(workspace, "i-1").values, done: false } });
  const archivedOwner = archivePage(edited, "p-b1", true, LATER);
  assert.match(previewDatabaseRestore(archivedOwner, SOURCE, version.id).reason, /数据库所在页面已归档/);
  assert.doesNotThrow(() => recordDatabaseVersion(archivedOwner, SOURCE, { now: LATER }));
  const child = update(edited, "pages", "p-rec-1", { parentPageId: "p-a1" });
  const archivedParent = archivePage(child, "p-a1", true, LATER);
  for (const itemId of [undefined, "i-1"]) {
    const preview = previewDatabaseRestore(archivedParent, SOURCE, version.id, { itemId });
    assert.equal(preview.ok, false);
    assert.match(preview.reason, /记录.*已归档/);
  }
});

test("restore preserves externally referenced views in multi-source occurrences and checks record-layout references", () => {
  let workspace = backupWorkspace();
  workspace = update(workspace, "dataSources", SOURCE, { recordLayout: {
    mode: "tabs", views: [{ id: "projects-tab", name: "关联项目", sourceId: "ds-full", viewId: "v-full-table" }],
  } });
  const idFactory = idMaker();
  workspace = recordDatabaseVersion(workspace, SOURCE, { now: FIRST, idFactory });
  const version = history(workspace)[0];
  assert.equal(version.views.some(({ id }) => id === "v-inline-table"), true);
  let edited = update(workspace, "pages", "p-z1", { content: [{
    id: "linked-multi-source", type: "databaseView", props: {
      sourceId: "ds-full", sourceIdsJson: '["ds-full","ds-inline"]', viewId: "v-full-table", viewIdsJson: '["v-full-table","v-inline-table"]',
    },
  }] });
  edited = update(edited, "databaseViews", "v-inline-table", { name: "现时外部使用的视图" });
  edited = update(edited, "dataSources", SOURCE, { recordLayout: null });
  const preview = previewDatabaseRestore(edited, SOURCE, version.id);
  assert.equal(preview.ok, true, preview.reason);
  assert.equal(preview.summary.views.length, 0);
  const restored = restoreDatabaseVersion(edited, SOURCE, version.id, { now: LATER, expectedSignature: preview.expectedSignature, idFactory });
  assert.equal(view(restored, "v-inline-table"), view(edited, "v-inline-table"));
  assert.deepEqual(source(restored).recordLayout, version.source.recordLayout);
  const missingTargetView = { ...edited, databaseViews: edited.databaseViews.filter(({ id }) => id !== "v-full-table") };
  const unavailable = previewDatabaseRestore(missingTargetView, SOURCE, version.id);
  assert.equal(unavailable.ok, false);
  assert.match(unavailable.reason, /记录布局.*引用的数据库或视图已不可用/);
});

test("another database's dashboard keeps its live saved-view settings through source history restore", () => {
  const { workspace, idFactory, version } = prepared();
  const tableId = "v-inline-table";
  const dashboard = createDatabaseView({
    id: "external-dashboard", sourceId: "ds-full", type: "dashboard",
    config: { dashboard: { widgets: [{ id: "external-widget", type: "view", sourceId: SOURCE, viewId: tableId }] } },
  });
  let edited = update(workspace, "databaseItems", "i-1", { values: { ...row(workspace, "i-1").values, done: false } });
  edited = update(edited, "databaseViews", tableId, { name: "现在的表格", sorts: [{ propertyId: "title", direction: "desc" }] });
  edited = { ...edited, databaseViews: [...edited.databaseViews, dashboard] };
  const project = (state) => dashboardProjection({
    workspace: state, primary: state.dataSources.find(({ id }) => id === dashboard.sourceId), dashboard, widget: dashboard.config.dashboard.widgets[0],
  });
  const existing = project(edited).view;
  assert.equal(existing.name, "现在的表格");
  const impact = previewDatabaseRestore(edited, SOURCE, version.id);
  assert.equal(impact.ok, true, impact.reason);
  assert.equal(impact.summary.views.some(({ id }) => id === tableId), false);
  const restored = restoreDatabaseVersion(edited, SOURCE, version.id, { now: LATER, idFactory, expectedSignature: impact.expectedSignature });
  assert.equal(row(restored, "i-1").values.done, true);
  assert.equal(project(restored).view, existing);
  assert.equal(view(restored, dashboard.id), dashboard);

  const missing = { ...edited, databaseViews: edited.databaseViews.filter(({ id }) => id !== tableId) };
  const missingPreview = previewDatabaseRestore(missing, SOURCE, version.id);
  assert.equal(missingPreview.ok, false);
  assert.match(missingPreview.reason, /仍有外部引用/);
});

test("historical files use the captured field definition and survive unrelated permanent deletion", () => {
  const { workspace, version } = prepared();
  let edited = update(workspace, "dataSources", SOURCE, { properties: source(workspace).properties.filter((field) => field.id !== "files") });
  const clean = { ...row(edited, "i-1").values };
  delete clean.files;
  edited = update(edited, "databaseItems", "i-1", { values: clean });
  edited = update(edited, "pages", "p-a1", { content: [{ id: "asset", type: "file", props: { attachmentId: "att-file" } }] });
  const unrelated = permanentlyDelete(edited, { pageIds: ["p-a1"] });
  assert.equal(attachmentReferences(unrelated).has("att-file"), true);
  assert.ok(unrelated.attachments.some(({ id }) => id === "att-file"));
  assert.equal(history(unrelated)[0], version);
  const removed = permanentlyDelete(unrelated, { pageIds: ["p-b1"] });
  assert.deepEqual(history(removed), []);
  assert.equal(removed.attachments.some(({ id }) => id === "att-file"), false);
});

test("actual SQLite reopen, browser backup restore, and browser-to-desktop attachment migration retain historical files", async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "life-atlas-db-history-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const { workspace, version } = prepared();
  let edited = update(workspace, "dataSources", SOURCE, { properties: source(workspace).properties.filter((field) => field.id !== "files") });
  const values = { ...row(edited, "i-1").values };
  delete values.files;
  edited = update(edited, "databaseItems", "i-1", { values });
  const sqlFile = path.join(directory, "workspace.sqlite");
  let db = openWorkspaceDatabase(sqlFile);
  try {
    prepareWritable(db);
    initializeWorkspace(db, edited, { generation: "db-history-test", now: LATER });
  } finally { db.close(); }
  db = openWorkspaceDatabase(sqlFile, { readOnly: true });
  let reopened;
  try { assert.equal(quickCheck(db), "ok"); reopened = assembleWorkspace(readAllRows(db)); }
  finally { db.close(); }
  assert.deepEqual(reopened.databaseVersions, edited.databaseVersions);
  assert.equal(previewDatabaseRestore(reopened, SOURCE, version.id).ok, true);

  const backup = await backupFixture({ workspace: edited });
  assert.deepEqual(backup.skippedAttachmentIds, []);
  const inspected = await inspectBrowserBackup(backup.bytes, { now: LATER });
  assert.ok(inspected.token, JSON.stringify(inspected.problems));
  const persistentBlobs = new Map();
  const backupRestored = await restoreBrowserBackup(inspected.token, {
    storage: memoryStorage(), storageKey: "test-history", now: LATER,
    readAttachmentBlob: (id) => persistentBlobs.get(id),
    writeAttachmentBlob: (id, blob) => persistentBlobs.set(id, blob),
  });
  assert.deepEqual(backupRestored.workspace.databaseVersions, edited.databaseVersions);
  const attachment = backupRestored.workspace.attachments.find(({ id }) => id === "att-file");
  const restoredBytes = new Uint8Array(await persistentBlobs.get(attachment.storageKey).arrayBuffer());
  assert.deepEqual(restoredBytes, fullWorkspaceAttachmentBytes().get("att-file"));

  const assetIndex = parseJsonBytes(backup.files.get("assets/index.json"));
  const oldWire = structuredClone(backupRestored.workspace);
  oldWire.databaseVersions[0].items[0].values.files = [
    "blob:https://old.invalid/file#life-attachment=att-file",
    "data:text/plain;base64,aGVsbG8=",
  ];
  const copiedAssets = new Map();
  const converted = await convertBrowserPackage(oldWire, assetIndex, { putAsset(bytes) {
    const hash = createHash("sha256").update(bytes).digest("hex");
    copiedAssets.set(hash, Buffer.from(bytes));
    return { url: `life-asset://${hash}` };
  } });
  assert.deepEqual(converted.report.leftovers, []);
  const attachmentIds = converted.workspace.databaseVersions[0].items[0].values.files;
  assert.deepEqual(attachmentIds, ["att-file", "att-orphan"]);
  assert.equal(converted.workspace.attachments.find(({ id }) => id === "att-file").provider, "asset");
  assert.equal(copiedAssets.get(createHash("sha256").update("hello").digest("hex")).toString(), "hello");
  assert.notEqual(converted.workspace.databaseVersions[0].signature, oldWire.databaseVersions[0].signature);
  assert.equal(previewDatabaseRestore(converted.workspace, SOURCE, version.id).ok, true);
});

test("restore attachment preflight verifies browser payload availability before mutation", async () => {
  const { workspace, version } = prepared();
  const edited = update(workspace, "databaseItems", "i-1", { values: { ...row(workspace, "i-1").values, done: false } });
  const impact = previewDatabaseRestore(edited, SOURCE, version.id);
  assert.equal(impact.ok, true, impact.reason);
  await assert.rejects(assertDatabaseRestoreAttachments(edited, impact), /文件不可用/);
  await writeBrowserAttachmentBlob("att-file", new Blob([fullWorkspaceAttachmentBytes().get("att-file")]));
  try { await assertDatabaseRestoreAttachments(edited, impact); }
  finally { await removeBrowserAttachmentBlob("att-file"); }
});

test("oversized history warns without blocking the current edit and refuses a restore without its pre-restore version", () => {
  const { workspace, idFactory, version } = prepared();
  const oldHistory = workspace.databaseVersions;
  const value = "文".repeat(Math.ceil(MAX_DATABASE_VERSION_BYTES / 6));
  let large = update(workspace, "dataSources", SOURCE, { properties: [...source(workspace).properties, { id: "large", name: "长文本", type: "text" }] });
  for (const id of ["i-1", "i-2"]) large = update(large, "databaseItems", id, { values: { ...row(large, id).values, large: value } });
  const next = update(large, "databaseItems", "i-1", { values: { ...row(large, "i-1").values, done: false } });
  const edited = captureDatabaseVersions(large, next, { now: LATER, idFactory });
  assert.equal(edited.databaseVersions, oldHistory);
  assert.equal(edited.databaseItems, next.databaseItems);
  assert.equal(row(edited, "i-1").values.done, false);
  assert.equal(edited.ui.databaseHistoryCaptureWarning.sourceId, SOURCE);
  assert.match(edited.ui.databaseHistoryCaptureWarning.message, /当前编辑已保留/);
  assert.doesNotThrow(() => validateWorkspaceSnapshot(edited));
  assert.throws(() => recordDatabaseVersion(edited, SOURCE, { now: LATER, idFactory }), /超过 19 MiB/);
  const preview = previewDatabaseRestore(edited, SOURCE, version.id);
  assert.equal(preview.ok, false);
  assert.match(preview.reason, /恢复前的快照/);
  assert.throws(() => restoreDatabaseVersion(edited, SOURCE, version.id, {
    expectedSignature: "a-prior-preview", now: LATER, idFactory,
  }), /恢复前的快照/);
  assert.equal(edited.databaseVersions, oldHistory);
  assert.equal(edited.databaseItems, next.databaseItems);
});
