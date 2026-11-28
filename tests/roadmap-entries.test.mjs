import test from "node:test";
import assert from "node:assert/strict";
import { fullWorkspace } from "./fixtures/full-workspace.mjs";
import { roadmapEntries, shiftRoadmapDate } from "../src/domain/roadmapEntries.js";

function fixture() {
  const workspace = fullWorkspace();
  const source = workspace.dataSources.find((entry) => entry.id === "ds-inline");
  source.properties.push(
    { id: "kind", name: "类型", type: "select", options: [{ id: "major", name: "发布", color: "green" }, { id: "other", name: "其他", color: "unsupported" }] },
    { id: "version", name: "版本", type: "text" },
    { id: "progress", name: "进度", type: "number" },
  );
  const items = workspace.databaseItems.filter((item) => item.sourceId === source.id);
  const config = { roadmap: { datePropertyId: "due", colorPropertyId: "status", markerPropertyId: "kind", markerMap: { major: "major", other: "invalid" }, subtitlePropertyId: "version", progressPropertyId: "progress" } };
  return { workspace, source, items, config };
}

test("ranges become phases and single dates become milestones", () => {
  const { workspace, source, items, config } = fixture();
  items[0].values.due = { start: "2026-03-20", end: "2026-03-01", includeTime: false, timeZone: null };
  items[1].values.due = "2026-03-10";
  const original = structuredClone(items);
  const entries = roadmapEntries(workspace, source, items, config);
  assert.equal(entries[0].start, Date.UTC(2026, 2, 1));
  assert.equal(entries[0].end, Date.UTC(2026, 2, 20));
  assert.equal(entries[1].start, Date.UTC(2026, 2, 10));
  assert.equal(entries[1].end, null);
  assert.deepEqual(items, original);
});

test("colors markers subtitles and progress are mapped", () => {
  const { workspace, source, items, config } = fixture();
  Object.assign(items[0].values, { status: "done", kind: "major", version: "1.0.0", progress: 62 });
  Object.assign(items[1].values, { status: "doing", kind: "other", progress: 0.5 });
  let entries = roadmapEntries(workspace, source, items, config);
  assert.equal(entries[0].color, "green");
  assert.equal(entries[0].marker, "major");
  assert.equal(entries[0].subtitle, "1.0.0");
  assert.equal(entries[0].progress, 0.62);
  assert.equal(entries[0].statusLabel, "已完成");
  assert.equal(entries[1].color, "blue");
  assert.equal(entries[1].marker, "diamond");
  assert.equal(entries[1].progress, 0.5);
  items[1].values.progress = "abc";
  assert.equal(roadmapEntries(workspace, source, items, config)[1].progress, null);
  config.roadmap.colorPropertyId = "kind";
  entries = roadmapEntries(workspace, source, items, config);
  assert.equal(entries[1].color, "default");
  assert.equal(entries[1].statusLabel, "其他");
});

test("records in trash are excluded", () => {
  const { workspace, source, items, config } = fixture();
  workspace.pages.find((page) => page.id === items[0].pageId).trashedAt = "2026-03-10T00:00:00.000Z";
  const entries = roadmapEntries(workspace, source, items, config);
  assert.deepEqual(entries.map((entry) => entry.id), [items[1].id]);
});

test("explicit time and timezone are preserved while invalid dates stay unscheduled", () => {
  const { workspace, source, items, config } = fixture();
  items[0].values.due = { start: "2026-03-10T09:30:00+08:00", end: "2026-03-11T10:30:00+08:00", includeTime: true, timeZone: "Asia/Shanghai" };
  items[1].values.due = "not-a-date";
  const entries = roadmapEntries(workspace, source, items, config);
  assert.equal(entries[0].start, Date.parse("2026-03-10T01:30:00Z"));
  assert.equal(entries[0].end, Date.parse("2026-03-11T02:30:00Z"));
  assert.equal(entries[1].start, null);
  items[0].values.due = { start: "2026-03-10T09:30:00", includeTime: true, timeZone: "Asia/Shanghai" };
  assert.equal(roadmapEntries(workspace, source, items, config)[0].start, Date.parse("2026-03-10T01:30:00Z"));
});

test("empty date selection is not silently replaced and computed numeric progress resolves", () => {
  const { workspace, source, items, config } = fixture();
  config.roadmap.datePropertyId = null;
  assert.ok(roadmapEntries(workspace, source, items, config).every((entry) => entry.start === null));
  const fullSource = workspace.dataSources.find((entry) => entry.id === "ds-full");
  const fullItems = workspace.databaseItems.filter((item) => item.sourceId === fullSource.id);
  const entries = roadmapEntries(workspace, fullSource, fullItems, { progressPropertyId: "task-count" });
  assert.equal(entries[0].progress, 0.02);
  assert.equal(entries[1].progress, 1);
});

test("date dragging shifts whole UTC calendar days without losing time or metadata", () => {
  const value = { start: "2026-03-10T09:30:00+08:00", end: "2026-03-12T11:45:00+08:00", includeTime: true, timeZone: "Asia/Shanghai", future: { keep: true } };
  const original = structuredClone(value);
  assert.deepEqual(shiftRoadmapDate(value, 3), { ...value, start: "2026-03-13T09:30:00+08:00", end: "2026-03-15T11:45:00+08:00" });
  assert.deepEqual(shiftRoadmapDate("2026-03-01", -1), { start: "2026-02-28", end: null, includeTime: false, timeZone: null });
  assert.deepEqual(shiftRoadmapDate({ start: "2026-12-31", end: "2027-01-02", includeTime: false, timeZone: null }, 1), { start: "2027-01-01", end: "2027-01-03", includeTime: false, timeZone: null });
  assert.equal(shiftRoadmapDate(null, 1), null);
  assert.equal(shiftRoadmapDate(value, 0.5), null);
  assert.deepEqual(value, original);
});
