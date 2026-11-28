import test from "node:test";
import assert from "node:assert/strict";
import { afterCapture, compareBlocks, createPageVersion, dueCapture, IDLE_MS, INTERVAL_MS, latestVersionOf, MAX_VERSION_BYTES, pageSnapshotOf, prunePageVersions, recordEdit, restorePageVersion, snapshotSignature } from "../src/domain/pageHistory.js";
import { fullWorkspace } from "./fixtures/full-workspace.mjs";
import { derivePageSummary } from "../src/domain/content.js";

const NOW = new Date(2026, 9, 1, 12, 0).getTime();
const at = (year, month, day, hour) => new Date(year, month - 1, day, hour, 0).toISOString();
const versionAt = (id, createdAt, pageId = "p") => ({ id, pageId, createdAt });
const paragraph = (id, content) => ({ id, type: "paragraph", content });

test("retention keeps the specified versions", () => {
  const versions = [
    versionAt("v1", new Date(NOW - 3600000).toISOString()), versionAt("v2", new Date(NOW - 7200000).toISOString()),
    versionAt("v3", at(2026, 9, 20, 10)), versionAt("v4", at(2026, 9, 20, 18)), versionAt("v5", at(2026, 9, 21, 9)),
    versionAt("v6", at(2026, 8, 10, 9)), versionAt("v7", at(2026, 8, 12, 9)),
    versionAt("v8", at(2025, 8, 3, 9)), versionAt("v9", at(2025, 8, 20, 9)), versionAt("v10", at(2025, 7, 1, 9)),
  ];
  const before = structuredClone(versions);
  assert.deepEqual(prunePageVersions(versions, NOW).map((version) => version.id), ["v1", "v2", "v4", "v5", "v7", "v9", "v10"]);
  assert.deepEqual(versions, before);
});

test("retention keeps fifty recent versions", () => {
  const versions = Array.from({ length: 60 }, (_, index) => versionAt(`v${index + 1}`, new Date(NOW - (index + 1) * 60000).toISOString()));
  const kept = prunePageVersions(versions, NOW);
  assert.equal(kept.length, 50);
  assert.equal(kept[0].id, "v1");
  assert.equal(kept.at(-1).id, "v50");
});

test("continuous editing captures two interval versions and one idle version", () => {
  let tracker;
  const captured = [];
  for (let seconds = 0; seconds <= 30 * 60; seconds += 30) {
    const now = seconds * 1000;
    if (seconds <= 25 * 60) tracker = recordEdit(tracker, now);
    const reason = dueCapture(tracker, now);
    if (reason) { captured.push({ minutes: seconds / 60, reason }); tracker = afterCapture(tracker, reason, now); }
  }
  assert.deepEqual(captured, [{ minutes: 10, reason: "interval" }, { minutes: 20, reason: "interval" }, { minutes: 27, reason: "idle" }]);
  assert.equal(IDLE_MS, 120000);
  assert.equal(INTERVAL_MS, 600000);
});

test("idle capture waits two minutes", () => {
  let tracker;
  for (const now of [0, 30000, 60000]) tracker = recordEdit(tracker, now);
  assert.equal(dueCapture(tracker, 150000), null);
  assert.equal(dueCapture(tracker, 180000), "idle");
  assert.deepEqual(afterCapture(tracker, "idle", 180000), { dirtySince: null, lastEditAt: 60000 });
  assert.equal(dueCapture(afterCapture(tracker, "idle", 180000), 900000), null);
});

test("identical snapshots share a signature", () => {
  const page = fullWorkspace().pages[0];
  const first = pageSnapshotOf(page);
  const second = pageSnapshotOf(page);
  assert.equal(snapshotSignature(first), snapshotSignature(second));
  assert.equal(snapshotSignature(first), snapshotSignature(createPageVersion(page, { id: "version", now: NOW, reason: "idle" })));
  second.title += "一";
  assert.notEqual(snapshotSignature(first), snapshotSignature(second));
  first.content[0].content = "另一个标题";
  first.settings.locked = true;
  first.cover.position = 10;
  assert.equal(page.content[0].content, "概览");
  assert.equal(page.settings.locked, false);
  assert.equal(page.cover.position, 50);
});

test("oversized pages do not create versions", () => {
  const page = { ...fullWorkspace().pages[1], content: [paragraph("large", "x".repeat(MAX_VERSION_BYTES + 1))] };
  assert.equal(createPageVersion(page, { id: "large-version", now: NOW, reason: "idle" }), null);
});

test("block comparison counts added removed and changed blocks", () => {
  const before = [paragraph("a", "a"), paragraph("b", "b"), paragraph("c", "c")];
  const current = [paragraph("a", "a"), paragraph("b", "b′"), paragraph("d", "d")];
  assert.deepEqual(compareBlocks(before, current), { added: 1, removed: 1, changed: 1 });
  assert.deepEqual(compareBlocks([{ id: "parent", type: "toggleListItem", children: [paragraph("child", "旧")] }], [{ id: "parent", type: "toggleListItem", children: [paragraph("child", "新")] }]), { added: 0, removed: 0, changed: 2 });
});

test("restoring a version saves the current state first", () => {
  const workspace = fullWorkspace();
  const page = workspace.pages.find((entry) => entry.id === "p-rec-1");
  const old = { ...page, title: "旧任务", content: [paragraph("old-block", "旧的正文")] };
  const version = createPageVersion(old, { id: "old-version", now: NOW - 3600000, reason: "before-edit" });
  workspace.pageVersions = [version];
  const original = structuredClone(workspace);
  const restored = restorePageVersion(workspace, { pageId: page.id, versionId: version.id, now: NOW, preRestoreId: "pre-copy" });
  const result = restored.pages.find((entry) => entry.id === page.id);
  assert.equal(restored.pageVersions.length, 2);
  assert.equal(restored.pageVersions.at(-1).reason, "pre-restore");
  assert.equal(restored.pageVersions.at(-1).id, "pre-copy");
  assert.equal(snapshotSignature(restored.pageVersions.at(-1)), snapshotSignature(page));
  assert.deepEqual(result.content, version.content);
  assert.notEqual(result.content, version.content);
  assert.equal(result.content[0].id, "old-block");
  assert.equal(result.importRevision, (page.importRevision || 0) + 1);
  assert.equal(result.contentRevision, page.contentRevision + 1);
  assert.equal(result.summary, derivePageSummary(result, 96, restored));
  assert.ok(result.summary.includes("旧的正文"));
  assert.equal(result.summarySourceRevision, result.contentRevision);
  assert.equal(result.summaryUpdatedAt, new Date(NOW).toISOString());
  assert.equal(result.updatedAt, new Date(NOW).toISOString());
  assert.equal(restored.databaseItems.find((entry) => entry.pageId === page.id).values.title, "旧任务");
  assert.deepEqual(restored.databaseItems.find((entry) => entry.pageId === page.id).values.status, workspace.databaseItems.find((entry) => entry.pageId === page.id).values.status);
  assert.equal(restored.dataSources, workspace.dataSources);
  assert.equal(restored.pages[0], workspace.pages[0]);
  assert.deepEqual(workspace, original);
});

test("retention uses local ISO weeks across the year boundary", () => {
  const now = new Date(2021, 2, 1, 12).getTime();
  const versions = [versionAt("december", at(2020, 12, 31, 9)), versionAt("january", at(2021, 1, 1, 9)), versionAt("next-week", at(2021, 1, 4, 9))];
  assert.deepEqual(prunePageVersions(versions, now).map((version) => version.id), ["january", "next-week"]);
});

test("retention caps each page separately at one hundred twenty versions", () => {
  const historical = Array.from({ length: 150 }, (_, index) => versionAt(`old-${index}`, at(2000 + Math.floor(index / 12), index % 12 + 1, 1, 9)));
  const recent = Array.from({ length: 50 }, (_, index) => versionAt(`new-${index}`, new Date(NOW - index * 60000).toISOString()));
  const versions = [...historical, ...recent, ...recent.map((version) => ({ ...version, id: `other-${version.id}`, pageId: "other" }))];
  const kept = prunePageVersions(versions, NOW);
  assert.equal(kept.filter((version) => version.pageId === "p").length, 120);
  assert.equal(kept.filter((version) => version.pageId === "other").length, 50);
});

test("version size is the UTF8 byte count of the six snapshot fields", () => {
  const page = { ...fullWorkspace().pages[1], content: [paragraph("text", "中文😀")] };
  const version = createPageVersion(page, { id: "unicode", now: NOW, reason: "idle" });
  assert.equal(version.sizeBytes, Buffer.byteLength(JSON.stringify(pageSnapshotOf(page)), "utf8"));
  assert.equal(version.blockCount, 1);
  assert.equal(latestVersionOf([version, { ...version, id: "later", createdAt: new Date(NOW + 1000).toISOString() }], page.id).id, "later");
  assert.equal(latestVersionOf([version], "absent"), null);
});

test("restore rejects a locked trashed missing or mismatched page without mutation", () => {
  const workspace = fullWorkspace();
  const page = workspace.pages[1];
  workspace.pageVersions = [createPageVersion(page, { id: "version", now: NOW, reason: "idle" })];
  const options = { pageId: page.id, versionId: "version", now: NOW, preRestoreId: "pre" };
  for (const patch of [{ settings: { ...page.settings, locked: true } }, { trashedAt: new Date(NOW).toISOString() }]) {
    const changed = { ...workspace, pages: workspace.pages.map((entry) => entry.id === page.id ? { ...entry, ...patch } : entry) };
    assert.throws(() => restorePageVersion(changed, options), /无法恢复这个版本/);
  }
  assert.throws(() => restorePageVersion(workspace, { ...options, pageId: "missing" }), /无法恢复这个版本/);
  assert.throws(() => restorePageVersion(workspace, { ...options, pageId: workspace.pages[0].id }), /无法恢复这个版本/);
  assert.equal(workspace.pageVersions.length, 1);
  assert.equal(workspace.pages[1], page);
});

test("restore refuses to overwrite when its mandatory pre-restore copy is oversized", () => {
  const workspace = fullWorkspace();
  const page = workspace.pages[1];
  workspace.pageVersions = [createPageVersion(page, { id: "version", now: NOW, reason: "idle" })];
  workspace.pages = workspace.pages.map((entry) => entry.id === page.id ? { ...entry, content: [paragraph("large", "x".repeat(MAX_VERSION_BYTES + 1))] } : entry);
  const content = workspace.pages[1].content;
  assert.throws(() => restorePageVersion(workspace, { pageId: page.id, versionId: "version", now: NOW, preRestoreId: "pre" }), /无法保存恢复前版本/);
  assert.equal(workspace.pages[1].content, content);
  assert.equal(workspace.pageVersions.length, 1);
});
