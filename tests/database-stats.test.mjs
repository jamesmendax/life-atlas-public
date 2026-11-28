import test from "node:test";
import assert from "node:assert/strict";
import { availableCalculations, computeColumnStat } from "../src/domain/databaseStats.js";
import { createProperty, groupViewItems, projectViewItems, resolvePropertyValue, searchViewItems } from "../src/domain/database.js";
import { updatePropertyDefinition } from "../src/domain/propertyChanges.js";
import { normalizeViewConfig } from "../src/domain/viewRegistry.js";
import { upgradeWorkspace } from "../src/persistence/migrations.js";
import { fullWorkspace } from "./fixtures/full-workspace.mjs";

function statsWorkspace() {
  const properties = [
    createProperty({ id: "title", type: "title" }), createProperty({ id: "amount", type: "number" }),
    createProperty({ id: "done", type: "checkbox" }), createProperty({ id: "due", type: "date" }),
    createProperty({ id: "tags", type: "multi_select", options: [{ id: "a", name: "a" }, { id: "b", name: "b" }, { id: "c", name: "c" }] }),
  ];
  const source = { id: "stats", properties };
  const values = [
    { amount: 10, done: true, due: "2026-09-01", tags: ["a", "b"] },
    { amount: 20, done: false, due: { start: "2026-09-05", end: "2026-09-08" }, tags: ["a"] },
    { amount: null, done: true, due: null, tags: [] },
    { amount: 5, done: false, due: "2026-08-30", tags: ["c"] },
    { amount: 15, done: true, due: null, tags: [] },
  ];
  const items = values.map((entry, index) => ({ id: `stats-${index}`, sourceId: source.id, values: entry }));
  const workspace = { dataSources: [source], databaseItems: items };
  return { workspace, source, items, property: (propertyId) => properties.find((entry) => entry.id === propertyId) };
}

test("column statistics match the known answers", () => {
  const { workspace, source, items, property } = statsWorkspace();
  const answers = [
    ["amount", "count_all", 5], ["amount", "count_values", 4], ["amount", "count_unique", 4], ["amount", "count_empty", 1],
    ["amount", "count_not_empty", 4], ["amount", "percent_empty", 0.2, "20%"], ["amount", "percent_not_empty", 0.8, "80%"],
    ["amount", "sum", 50], ["amount", "average", 12.5], ["amount", "median", 12.5], ["amount", "min", 5], ["amount", "max", 20], ["amount", "range", 15],
    ["tags", "count_values", 4], ["tags", "count_unique", 3], ["tags", "count_empty", 2], ["tags", "count_not_empty", 3],
    ["done", "checked", 3], ["done", "unchecked", 2], ["done", "percent_checked", 0.6, "60%"], ["done", "percent_unchecked", 0.4, "40%"],
    ["due", "earliest", "2026-08-30", "2026年8月30日"], ["due", "latest", "2026-09-08", "2026年9月8日"], ["due", "date_range", 9, "9 天"],
  ];
  for (const [propertyId, calculation, value, text = String(value)] of answers) assert.deepEqual(computeColumnStat(workspace, source, items, property(propertyId), calculation), { value, text }, `${propertyId}:${calculation}`);
  assert.deepEqual(computeColumnStat(workspace, source, items, property("amount"), "none"), { value: null, text: "" });
  for (const calculation of ["average", "median", "min", "max", "range"]) assert.deepEqual(computeColumnStat(workspace, source, [], property("amount"), calculation), { value: null, text: "" });
  assert.deepEqual(computeColumnStat(workspace, source, [], property("amount"), "sum"), { value: 0, text: "0" });
});

test("statistics follow the filtered rows", () => {
  const { workspace, source, items, property } = statsWorkspace();
  assert.equal(computeColumnStat(workspace, source, items.slice(0, 2), property("amount"), "sum").value, 30);
});

test("removing a multi-select option hides it from filters and statistics while retaining stored choices", () => {
  const { workspace, source, items, property } = statsWorkspace();
  const options = property("tags").options;
  const [mixed, removedOnly] = items;
  const updateOptions = (state, next) => updatePropertyDefinition(state, {
    sourceId: source.id, propertyId: "tags", definition: { options: next },
  });
  const updated = updateOptions(workspace, options.filter(option => option.id !== "a"));
  assert.equal(updated.databaseItems, workspace.databaseItems);

  const reopened = JSON.parse(JSON.stringify(updated));
  const [currentSource] = reopened.dataSources;
  const tags = currentSource.properties.find(field => field.id === "tags");
  const ids = (state, operator, value) => projectViewItems(state, {
    sourceId: source.id, filter: { propertyId: tags.id, operator, value },
  }).map(item => item.id);

  assert.deepEqual(ids(reopened, "equals", "a"), []);
  assert.deepEqual(ids(reopened, "contains", "a"), []);
  assert.deepEqual(ids(reopened, "contains", "b"), [mixed.id]);
  assert.deepEqual(ids(reopened, "is_empty"), [removedOnly.id, items[2].id, items[4].id]);
  assert.deepEqual(ids(reopened, "is_not_empty"), [mixed.id, items[3].id]);
  assert.equal(computeColumnStat(reopened, currentSource, [reopened.databaseItems[1]], tags, "count_values").value, 0);
  assert.equal(computeColumnStat(reopened, currentSource, [reopened.databaseItems[0]], tags, "count_values").value, 1);
  assert.deepEqual(reopened.databaseItems[0].values.tags, ["a", "b"]);
  assert.deepEqual(reopened.databaseItems[1].values.tags, ["a"]);

  const restored = updateOptions(reopened, options);
  assert.equal(restored.databaseItems, reopened.databaseItems);
  assert.deepEqual(ids(restored, "equals", "a"), [mixed.id, removedOnly.id]);
});

test("a removed single-select option reads as empty until the same option ID is restored", () => {
  const options = [{ id: "archived", name: "Archived" }, { id: "current", name: "Current" }];
  const choice = createProperty({ id: "choice", type: "select", options });
  const source = { id: "choices", properties: [choice] };
  const item = { id: "row", sourceId: source.id, values: { choice: "archived" } };
  const workspace = { dataSources: [source], databaseItems: [item] };
  const updateOptions = (state, next) => updatePropertyDefinition(state, {
    sourceId: source.id, propertyId: choice.id, definition: { options: next },
  });
  const updated = updateOptions(workspace, [options[1]]);
  const view = (operator, value) => ({ sourceId: source.id, filter: { propertyId: choice.id, operator, value } });

  assert.deepEqual(projectViewItems(updated, view("is_empty")), [item]);
  assert.deepEqual(projectViewItems(updated, view("equals", "archived")), []);
  assert.equal(item.values.choice, "archived");
  const restored = updateOptions(updated, options);
  const [restoredSource] = restored.dataSources;
  assert.equal(resolvePropertyValue(restored, restoredSource, item, restoredSource.properties[0]), "archived");
});

test("statistics and board groups follow the searched rows", () => {
  const workspace = upgradeWorkspace(fullWorkspace());
  const source = workspace.dataSources.find((entry) => entry.id === "ds-inline");
  const view = workspace.databaseViews.find((entry) => entry.id === "v-inline-board");
  const items = searchViewItems(workspace, source, projectViewItems(workspace, view), "进行中");
  const groups = groupViewItems(workspace, view, items);
  const grouped = groups.flatMap((group) => group.items);
  assert.deepEqual(grouped.map((item) => item.id), ["i-2"]);
  assert.deepEqual(computeColumnStat(workspace, source, grouped, source.properties.find((property) => property.id === "done"), "count_all"), { value: 1, text: "1" });
  assert.equal(projectViewItems(workspace, view).length, 2);
});

test("available calculations depend on the property type", () => {
  assert.deepEqual(availableCalculations({ type: "checkbox" }), ["none", "count_all", "checked", "unchecked", "percent_checked", "percent_unchecked"]);
  const date = availableCalculations({ type: "date" });
  for (const calculation of ["earliest", "latest", "date_range"]) assert.ok(date.includes(calculation));
  assert.ok(!date.includes("sum"));
  assert.ok(!availableCalculations({ type: "text" }).includes("sum"));
});

test("table view config keeps only valid values", () => {
  const config = normalizeViewConfig("table", { future: { retained: true }, table: { columnWidths: { small: 50, big: 900, invalid: "x", fractional: 180.7 }, wrapPropertyIds: ["tags", 3, "tags"], calculations: { amount: "sum", unknown: "nope" } } });
  assert.deepEqual(config.table, { columnWidths: { small: 80, big: 800, fractional: 181 }, wrapPropertyIds: ["tags"], calculations: { amount: "sum" } });
  assert.deepEqual(config.future, { retained: true });
});

test("table normalization preserves absent configuration and unknown metadata", () => {
  for (const input of [{}, { future: { retained: true } }]) {
    const before = structuredClone(input);
    const config = normalizeViewConfig("table", input);
    assert.deepEqual(config, before);
    assert.equal(Object.hasOwn(config, "table"), false);
    assert.deepEqual(input, before);
    assert.deepEqual(normalizeViewConfig("table", config), config);
  }
  assert.deepEqual(normalizeViewConfig("table"), {});
});

test("table render defaults are explicit and preserve persisted options", () => {
  const missing = { future: { retained: true } };
  const defaults = normalizeViewConfig("table", { ...missing, table: missing.table ?? {} }).table;
  assert.deepEqual(defaults, { columnWidths: {}, wrapPropertyIds: [], calculations: {} });
  assert.deepEqual(missing, { future: { retained: true } });
  const present = { table: { columnWidths: { title: 260 }, wrapPropertyIds: ["notes"], calculations: { amount: "sum" } } };
  assert.deepEqual(normalizeViewConfig("table", { ...present, table: present.table ?? {} }).table, present.table);
});
