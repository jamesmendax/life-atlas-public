import test from "node:test";
import assert from "node:assert/strict";
import { fullWorkspace, FIXTURE_TIME } from "./fixtures/full-workspace.mjs";
import { applyTrackedPageEdit, captureTrackedPageVersions, isTrackedPageEdit, planTrackedPageCaptures } from "../src/domain/pageHistoryCapture.js";
import { createPageVersion, snapshotSignature } from "../src/domain/pageHistory.js";
import { createChangeTracker } from "../src/persistence/changeset.js";

const now = Date.parse(FIXTURE_TIME);
const fixture = () => ({ ...fullWorkspace(), pageVersions: [] });
const body = (text) => [{ id: "history-block", type: "paragraph", content: [{ type: "text", text, styles: {} }], children: [] }];

test("tracked editing preserves an independent pre-edit snapshot and block identities", () => {
  const workspace = fixture();
  const before = structuredClone(workspace);
  const original = workspace.pages.find((entry) => entry.id === "p-a1-child");
  const result = applyTrackedPageEdit(workspace, { pageId: original.id, patch: { content: body("新的正文") }, now, beforeEditId: "ver-before" });
  assert.deepEqual(workspace, before);
  assert.equal(result.pageVersions.length, 1);
  assert.equal(result.pageVersions[0].reason, "before-edit");
  assert.deepEqual(result.pageVersions[0].content, original.content);
  assert.notEqual(result.pageVersions[0].content, original.content);
  assert.equal(result.pages.find((entry) => entry.id === "p-a1-child").summary, "新的正文");
  assert.equal(result.pages.find((entry) => entry.id === "p-a1-child").contentRevision, (original.contentRevision || 0) + 1);
  assert.equal(result.pages.find((entry) => entry.id === "p-z1"), workspace.pages.find((entry) => entry.id === "p-z1"));
});

test("replaying a tracked state updater gives the same version IDs and data", () => {
  const workspace = fixture();
  const command = { pageId: "p-a1-child", patch: { title: "重命名" }, now, beforeEditId: "ver-stable" };
  assert.deepEqual(applyTrackedPageEdit(workspace, command), applyTrackedPageEdit(workspace, command));
});

test("unchanged edits and identical latest snapshots do not create redundant versions", () => {
  const workspace = fixture();
  const page = workspace.pages.find((entry) => entry.id === "p-a1-child");
  assert.equal(applyTrackedPageEdit(workspace, { pageId: page.id, patch: { content: structuredClone(page.content) }, now, beforeEditId: "unused" }), workspace);
  workspace.pageVersions = [createPageVersion(page, { id: "existing", reason: "idle", now: now - 1 })];
  const edited = applyTrackedPageEdit(workspace, { pageId: page.id, patch: { title: "修改标题" }, now, beforeEditId: "unused" });
  assert.equal(edited.pageVersions.length, 1);
  assert.equal(edited.pageVersions[0].id, "existing");
});

test("idle and pre-edit captures preserve every previously saved version", () => {
  const workspace = fixture();
  const page = workspace.pages.find((entry) => entry.id === "p-a1-child");
  workspace.pageVersions = Array.from({ length: 55 }, (_, index) => createPageVersion({ ...page, title: `之前 ${index}` }, { id: `ver-${index}`, reason: "interval", now: now - index * 1000 - 1000 }));
  const other = createPageVersion(workspace.pages.find((entry) => entry.id === "p-z1"), { id: "other", reason: "idle", now: now - 400 * 86400000 });
  workspace.pageVersions.push(other);
  const before = structuredClone(workspace.pageVersions);
  const tracker = createChangeTracker(workspace);
  const result = captureTrackedPageVersions(workspace, [{ pageId: page.id, reason: "idle", id: "latest" }], now);
  assert.deepEqual(result.pageVersions.slice(0, -1), before);
  assert.deepEqual(workspace.pageVersions, before);
  assert.equal(result.pageVersions.length, before.length + 1);
  assert.deepEqual(tracker.diff(result).deletes, []);
  assert.equal(result.pageVersions.at(-1).id, "latest");
  assert.equal(snapshotSignature(result.pageVersions.at(-1)), snapshotSignature(page));
  assert.equal(captureTrackedPageVersions(result, [{ pageId: page.id, reason: "idle", id: "duplicate" }], now + 1), result);

  const edited = applyTrackedPageEdit(result, { pageId: page.id, patch: { title: "First edit after capture" }, now: now + 1 });
  const next = applyTrackedPageEdit(edited, { pageId: page.id, patch: { title: "Second edit after capture" }, now: now + 2, beforeEditId: "ver-pre-edit" });
  assert.deepEqual(next.pageVersions.slice(0, -1), result.pageVersions);
  assert.equal(next.pageVersions.at(-1).id, "ver-pre-edit");
  assert.deepEqual(tracker.diff(next).deletes, []);
});

test("capture ignores locked trashed and missing pages", () => {
  const workspace = fixture();
  workspace.pages.find((entry) => entry.id === "p-a1-child").settings.locked = true;
  workspace.pages.find((entry) => entry.id === "p-z1").trashedAt = FIXTURE_TIME;
  const captures = ["p-a1-child", "p-z1", "missing"].map((pageId) => ({ pageId, id: `ver-${pageId}`, reason: "idle" }));
  assert.equal(captureTrackedPageVersions(workspace, captures, now), workspace);
  assert.equal(isTrackedPageEdit(workspace.pages.find((entry) => entry.id === "p-a1-child"), { title: "锁定" }), false);
});

test("record page title editing updates its database title value atomically", () => {
  const workspace = fixture();
  const item = workspace.databaseItems[0];
  const title = workspace.dataSources.find((entry) => entry.id === item.sourceId).properties.find((entry) => entry.type === "title");
  const result = applyTrackedPageEdit(workspace, { pageId: item.pageId, patch: { title: "原子记录改名" }, now, beforeEditId: "ver-record" });
  assert.equal(result.databaseItems.find((entry) => entry.id === item.id).values[title.id], "原子记录改名");
  assert.equal(result.pages.find((entry) => entry.id === item.pageId).title, "原子记录改名");
  assert.equal(result.pageVersions[0].pageId, item.pageId);
  assert.notEqual(workspace.databaseItems.find((entry) => entry.id === item.id).values[title.id], "原子记录改名");
});

test("scheduled captures plan IDs outside state updates and advance only due trackers", () => {
  const trackers = new Map([
    ["idle", { dirtySince: 0, lastEditAt: 480000 }],
    ["continuous", { dirtySince: 0, lastEditAt: 600000 }],
    ["recent", { dirtySince: 590000, lastEditAt: 590000 }],
    ["clean", { dirtySince: null, lastEditAt: 0 }],
  ]);
  const before = structuredClone(trackers);
  let nextId = 0;
  const planned = planTrackedPageCaptures(trackers, 600000, { idFactory: (prefix) => `${prefix}-${++nextId}` });
  assert.deepEqual(planned.captures, [{ pageId: "idle", reason: "idle", id: "ver-1" }, { pageId: "continuous", reason: "interval", id: "ver-2" }]);
  assert.deepEqual(planned.trackers.get("idle"), { dirtySince: null, lastEditAt: 480000 });
  assert.deepEqual(planned.trackers.get("continuous"), { dirtySince: 600000, lastEditAt: 600000 });
  assert.equal(planned.trackers.get("recent"), trackers.get("recent"));
  assert.deepEqual(trackers, before);
  assert.deepEqual(planTrackedPageCaptures(planned.trackers, 600000, { idFactory: () => assert.fail("not due") }).captures, []);
});

test("exit capture saves every dirty page immediately without repeating a clean snapshot", () => {
  const trackers = new Map([["p-a1-child", { dirtySince: now, lastEditAt: now }], ["p-z1", { dirtySince: null, lastEditAt: now }]]);
  const plan = planTrackedPageCaptures(trackers, now + 1, { flush: true, idFactory: () => "ver-exit" });
  assert.deepEqual(plan.captures, [{ pageId: "p-a1-child", reason: "idle", id: "ver-exit" }]);
  const snapshot = captureTrackedPageVersions(fixture(), plan.captures, now + 1);
  assert.equal(snapshot.pageVersions[0].reason, "idle");
  assert.equal(snapshot.pageVersions[0].id, "ver-exit");
  assert.deepEqual(planTrackedPageCaptures(plan.trackers, now + 2, { flush: true, idFactory: () => assert.fail("already flushed") }).captures, []);
});

test("first edit persists its page and pre-edit history together while later edits remain page-only", () => {
  const workspace = fixture();
  const original = workspace.pages.find((entry) => entry.id === "p-a1-child");
  const tracker = createChangeTracker(workspace);
  const first = applyTrackedPageEdit(workspace, { pageId: original.id, patch: { content: body("第一次真实编辑") }, now, beforeEditId: "ver-first-edit" });
  const firstDiff = tracker.diff(first);
  assert.deepEqual(firstDiff.upserts.map(({ collection, id }) => ({ collection, id })), [
    { collection: "pages", id: original.id },
    { collection: "pageVersions", id: "ver-first-edit" },
  ]);
  assert.deepEqual(firstDiff.deletes, []);
  assert.equal(first.pageVersions[0].reason, "before-edit");
  assert.deepEqual(first.pageVersions[0].content, original.content);
  assert.deepEqual(workspace.pageVersions, []);
  tracker.commit(first);
  const second = applyTrackedPageEdit(first, { pageId: original.id, patch: { content: body("第二次真实编辑") }, now: now + 1000, beforeEditId: null });
  const secondDiff = tracker.diff(second);
  assert.deepEqual(secondDiff.upserts.map(({ collection, id }) => ({ collection, id })), [{ collection: "pages", id: original.id }]);
  assert.deepEqual(secondDiff.deletes, []);
  assert.equal(second.pageVersions, first.pageVersions);
});
