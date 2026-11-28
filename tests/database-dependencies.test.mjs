import assert from "node:assert/strict";
import test from "node:test";
import { applyDependencyDateChange, applyDependencyDateChanges, setItemDependencies } from "../src/domain/databaseDependencies.js";
import { filterSubitems, setDatabaseItemParent, subitemRows, subitemViewConfig } from "../src/domain/databaseSubitems.js";

const day = (number) => `2026-11-${String(number).padStart(2, "0")}`;
const range = (start, end, timeZone) => ({ start, end, includeTime: start.includes("T"), timeZone: timeZone ?? null });
const time = "2026-11-27T05:00:00.000Z";
const read = (workspace, id) => workspace.databaseItems.find((item) => item.id === id);
const start = (workspace, id) => read(workspace, id).values.due?.start || read(workspace, id).values.due;

function fixture(mode, edges = { b: ["a"], c: ["b"] }, dates = { a: day(2), b: day(4), c: day(6), x: day(9) }, skipWeekends = false) {
  const properties = [{ id: "due", type: "date" }, { id: "extra", type: "date" }, { id: "link", type: "relation" }];
  const source = { id: "source", ownerPageId: "owner", dependencyConfig: { datePropertyId: "due", mode, skipWeekends }, properties };
  return {
    pages: [{ id: "owner" }, { id: "foreignPage" }, ...Object.keys(dates).map((id) => ({ id: "page-" + id }))],
    dataSources: [source, { id: "foreign", properties }],
    databaseItems: [...Object.entries(dates).map(([id, due]) => ({ id, pageId: "page-" + id, sourceId: source.id, dependencyIds: edges[id] || [], values: { due } })), { id: "foreign", pageId: "foreignPage", sourceId: "foreign", values: {} }],
  };
}

const apply = (workspace, itemId, value, propertyId = "due") => applyDependencyDateChange(workspace, { itemId, propertyId, value, now: time });

test("none mode and unrelated dates/relations leave successor dates untouched", () => {
  const original = fixture("none");
  read(original, "x").values.link = ["a"];
  const updated = apply(original, "a", day(7));
  assert.deepEqual([start(updated, "a"), start(updated, "b"), start(updated, "c")], [day(7), day(4), day(6)]);
  assert.equal(read(updated, "x"), read(original, "x"));
  original.dataSources[0].dependencyConfig.mode = "overlap";
  const other = apply(original, "a", day(9), "extra");
  assert.equal(read(other, "b"), read(original, "b"));
  assert.equal(read(other, "a").values.extra.start, day(9));
});

test("overlap mode pushes only actual collisions, including a three-node chain", () => {
  const original = fixture("overlap");
  const free = apply(original, "a", day(3));
  assert.equal(read(free, "b"), read(original, "b"));
  const shifted = apply(free, "a", day(6));
  assert.deepEqual([start(shifted, "b"), start(shifted, "c"), start(shifted, "x")], [day(7), day(8), day(9)]);
  const reversed = apply(shifted, "a", day(2));
  assert.equal(read(reversed, "b"), read(shifted, "b"));
  const overlapping = fixture("overlap", { b: ["a"] }, { a: day(2), b: day(2) });
  const reminder = apply(overlapping, "a", { start: day(2), reminder: { offset: "atTime" } });
  assert.equal(read(reminder, "b"), read(overlapping, "b"));
});

test("preserving spacing propagates forward and backward through a chain", () => {
  const original = fixture("preserve-gap");
  const later = apply(original, "a", day(4));
  assert.deepEqual([start(later, "a"), start(later, "b"), start(later, "c")], [day(4), day(6), day(8)]);
  const earlier = apply(later, "a", day(1));
  assert.deepEqual([start(earlier, "a"), start(earlier, "b"), start(earlier, "c")], [day(1), day(3), day(5)]);
  assert.equal(read(later, "b").updatedAt, time);
  assert.equal(read(earlier, "x"), read(original, "x"));
});

test("fan-in takes the latest boundary and stages multiple explicit dates before scheduling", () => {
  const original = fixture("preserve-gap", { b: ["a", "x"], c: ["b"] }, { a: day(5), x: day(8), b: day(9), c: day(11) });
  const earlier = apply(original, "a", day(3));
  assert.equal(read(earlier, "b"), read(original, "b"));
  const forward = applyDependencyDateChanges(original, [{ itemId: "x", propertyId: "due", value: day(10) }, { itemId: "a", propertyId: "due", value: day(9) }], time);
  assert.deepEqual([start(forward, "b"), start(forward, "c")], [day(13), day(15)]);
  const manual = applyDependencyDateChanges(original, [{ itemId: "a", propertyId: "due", value: day(9) }, { itemId: "b", propertyId: "due", value: day(16) }], time);
  assert.deepEqual([start(manual, "b"), start(manual, "c")], [day(16), day(18)]);
});

test("whole-day ranges preserve working duration and skip weekends in both directions", () => {
  const dates = { a: day(4), b: range(day(5), day(6)) };
  const original = fixture("preserve-gap", { b: ["a"] }, dates, true);
  const later = apply(original, "a", day(6));
  assert.deepEqual(read(later, "b").values.due, range(day(9), day(10)));
  const earlier = apply(later, "a", day(5));
  assert.deepEqual(read(earlier, "b").values.due, range(day(6), day(9)));
});

test("timed ranges preserve format, fractional precision, zone and duration across DST", () => {
  const dates = {
    a: range("2026-10-30T11:30:00.125Z", "2026-10-30T13:30:00.125Z", "UTC"),
    b: range("2026-10-30T10:30:00.125", "2026-10-30T12:30:00.125", "America/New_York"),
    c: range("2026-10-30T13:01-0330", null, "UTC-03:30"),
  };
  const original = fixture("preserve-gap", { b: ["a"], c: ["b"] }, dates);
  const later = apply(original, "a", range("2026-11-02T11:30:00.125Z", "2026-11-02T13:30:00.125Z", "UTC"));
  assert.deepEqual(read(later, "b").values.due, range("2026-11-02T09:30:00.125", "2026-11-02T11:30:00.125", "America/New_York"));
  assert.equal(start(later, "c"), "2026-11-02T13:01-0330");
});

test("missing or invalid dates, cycles and locks reject an entire change without mutating data", () => {
  const workspaces = [
    [fixture("overlap", { b: ["a"], c: ["b"] }, { a: day(2), b: day(4), c: null }), "missing-dependency-date"],
    [fixture("overlap", { a: ["c"], b: ["a"], c: ["b"] }), "dependency-cycle"],
    [fixture("overlap"), "locked-record", (workspace) => { workspace.pages.find((page) => page.id === "page-c").settings = { locked: true }; }],
    [fixture("overlap"), "locked-record", (workspace) => { workspace.pages[0].settings = { locked: true }; }],
  ];
  for (const [workspace, code, prepare] of workspaces) {
    prepare?.(workspace);
    const before = structuredClone(workspace);
    assert.throws(() => apply(workspace, "a", day(8)), { code });
    assert.deepEqual(workspace, before);
  }
  const workspace = fixture("overlap");
  assert.throws(() => apply(workspace, "a", null), { code: "missing-dependency-date" });
  assert.throws(() => apply(workspace, "b", ""), { code: "missing-dependency-date" });
  assert.throws(() => apply(workspace, "a", "2026-02-31"), { code: "invalid-dependency-date" });
  assert.throws(() => apply(workspace, "a", range(day(9), day(7))), { code: "invalid-dependency-date" });
  const manual = fixture("none");
  assert.throws(() => apply(manual, "a", {}), { code: "invalid-dependency-date" });
  assert.throws(() => apply(manual, "a", " "), { code: "invalid-dependency-date" });
  assert.equal(start(apply(manual, "a", null), "a"), null);
  const archived = { ...workspace, pages: workspace.pages.map((page) => page.id === "page-b" ? { ...page, archivedAt: time } : page) };
  assert.throws(() => apply(archived, "b", day(8)), { code: "unavailable-record" });
});

test("editing predecessor IDs enforces same-source acyclicity and retains independent relations", () => {
  const workspace = fixture("none");
  read(workspace, "b").values.link = ["foreign"];
  assert.throws(() => setItemDependencies(workspace, "a", ["c"], time), { code: "dependency-cycle" });
  assert.throws(() => setItemDependencies(workspace, "a", ["foreign"], time), { code: "invalid-dependency" });
  const updated = setItemDependencies(workspace, "b", ["a", "x", "a"], time);
  assert.deepEqual(read(updated, "b").dependencyIds, ["a", "x"]);
  assert.deepEqual(read(updated, "b").values, read(workspace, "b").values);
});

test("parent changes preserve identity and project visible hierarchy, flattening and filters", () => {
  const original = fixture("none");
  const child = setDatabaseItemParent(original, "b", "a", time);
  const workspace = setDatabaseItemParent(child, "c", "b", time);
  assert.deepEqual([read(workspace, "b").id, read(workspace, "b").pageId, read(workspace, "b").parentItemId], ["b", "page-b", "a"]);
  assert.equal(workspace.pages.find((page) => page.id === "page-b").parentDatabaseItemId, "a");
  assert.throws(() => setDatabaseItemParent(workspace, "a", "c", time), { code: "parent-cycle" });
  assert.throws(() => setDatabaseItemParent(workspace, "b", "foreign", time), { code: "invalid-parent" });
  const scoped = ["c", "a", "x", "b"].map((id) => read(workspace, id));
  const ids = (rows) => rows.map(({ item, depth }) => [item.id, depth]);
  assert.deepEqual(ids(subitemRows(scoped, "nested")), [["a", 0], ["b", 1], ["c", 2], ["x", 0]]);
  assert.deepEqual(ids(subitemRows(scoped, "nested", new Set(["a"]))), [["a", 0], ["x", 0]]);
  assert.deepEqual(ids(subitemRows(scoped, "flat")), [["c", 0], ["a", 0], ["x", 0], ["b", 0]]);
  assert.deepEqual(filterSubitems(scoped, "parents").map(({ id }) => id), ["a", "x"]);
  assert.deepEqual(ids(subitemRows(filterSubitems(scoped, "children"), "nested")), [["b", 0], ["c", 1]]);
  assert.deepEqual(ids(subitemRows([read(workspace, "c")], "nested")), [["c", 0]]);
  assert.equal(subitemViewConfig({ type: "calendar", config: { subitems: { filter: "children" } } }).filter, "all");
  const detached = setDatabaseItemParent(workspace, "b", null, time);
  assert.equal(read(detached, "b").parentItemId, null);
  assert.deepEqual(read(detached, "b").dependencyIds, ["a"]);
});
