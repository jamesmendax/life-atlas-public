import assert from "node:assert/strict";
import test from "node:test";
import { projectViewItems } from "../src/domain/database.js";
import { updateTableItemsProperty } from "../src/domain/tableRecordActions.js";
import { moveTableRow } from "../src/domain/tableRowOrder.js";

const time = "2026-11-25T12:00:00.000Z";
function fixture() {
  const columns = [
    { id: "title", type: "title" }, { id: "points", type: "number" }, { id: "due", type: "date" },
    { id: "calculated", type: "formula" }, { id: "ref", type: "relation", config: { targetSourceId: "design" } },
  ];
  const pages = ["desk", "a", "locked", "b", "hidden", "c", "target", "restricted"].map(id =>
    ({ id, title: id, settings: { locked: ["locked", "restricted"].includes(id) }, content: [] }));
  const items = ["a", "locked", "b", "hidden", "c", "target", "restricted"].map((id, index) =>
    ({ id, pageId: id, sourceId: index < 5 ? "main" : "design", values: { title: id, points: index, ref: [], backlinks: [] } }));
  return { pages, databaseItems: items, dataSources: [{ id: "main", ownerPageId: "desk", properties: columns }, { id: "design", properties: [{ id: "title", type: "title" }] }],
    relations: [{ sourceId: "main", propertyId: "ref", targetSourceId: "design", reciprocalPropertyId: "backlinks" }] };
}
const change = (workspace, propertyId, value, itemIds = ["a", "locked", "b", "target"]) =>
  updateTableItemsProperty(workspace, { sourceId: "main", itemIds, propertyId, value, now: time });
const valueFor = (workspace, id, property) => workspace.databaseItems.find(item => item.id === id).values[property];

test("bulk writes normalize one value and respect source, item and owner locks", () => {
  const initial = fixture();
  const next = change(initial, "points", "37");
  assert.deepEqual(next.databaseItems.map(item => item.values.points), [37, 1, 37, 3, 4, 5, 6]);
  assert.deepEqual(initial.databaseItems.map(item => item.values.points), [0, 1, 2, 3, 4, 5, 6]);
  assert.equal(next.databaseItems[0].updatedAt, time);
  assert.equal(change(next, "points", "bad"), next);
  assert.equal(change(next, "calculated", 99), next);
  next.pages[0].settings.locked = true;
  assert.equal(change(next, "points", 15), next);
});

test("titles update both surfaces, and date normalization rejects an inverted range", () => {
  const initial = fixture();
  const named = change(initial, "title", "甲");
  assert.equal(valueFor(named, "a", "title"), "甲");
  assert.equal(named.pages.find(page => page.id === "b").title, "甲");
  assert.equal(named.pages.find(page => page.id === "locked").title, "locked");
  const dated = change(named, "due", "2026-11-25");
  assert.deepEqual(valueFor(dated, "a", "due"), { start: "2026-11-25", end: null, includeTime: false, timeZone: null });
  assert.equal(change(dated, "due", { start: "2026-11-25", end: "2026-11-24" }), dated);
});

test("a bulk relation synchronizes reciprocal values while preserving locked pages", () => {
  const initial = fixture();
  const changed = change(initial, "ref", ["target"]);
  assert.deepEqual(valueFor(changed, "target", "backlinks"), ["a", "b"]);
  assert.deepEqual(valueFor(changed, "locked", "ref"), []);
  assert.equal(change(changed, "ref", ["restricted"]), changed);
  const cleared = change(changed, "ref", []);
  assert.deepEqual(valueFor(cleared, "target", "backlinks"), []);
});

test("manual order preserves hidden/locked slots, survives sorting, and appends records from older configs", () => {
  const initial = fixture();
  const view = { sourceId: "main", type: "table", config: { table: {} }, sorts: [] };
  const all = projectViewItems(initial, view);
  const manualOrder = moveTableRow(all, ["a", "b", "c"], "c", "a", "before");
  assert.deepEqual(manualOrder, ["c", "locked", "a", "hidden", "b"]);
  const manual = { ...view, config: { table: { manualOrder: ["stale", ...manualOrder, "a"] } } };
  assert.deepEqual(projectViewItems(initial, manual).map(item => item.id), manualOrder);
  assert.deepEqual(projectViewItems(initial, { ...manual, sorts: [{ propertyId: "points", direction: "asc" }] }).map(item => item.id), ["a", "locked", "b", "hidden", "c"]);
  const next = { ...initial, databaseItems: [...initial.databaseItems, { id: "new", sourceId: "main", values: {} }] };
  assert.deepEqual(projectViewItems(next, manual).map(item => item.id), [...manualOrder, "new"]);
  assert.equal(moveTableRow(all, ["a", "b"], "a", "locked", "after"), null);
});
