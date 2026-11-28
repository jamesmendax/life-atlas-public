import test from "node:test";
import assert from "node:assert/strict";
import { createProperty } from "../src/domain/database.js";
import { convertPropertyType, deleteProperty } from "../src/domain/propertyChanges.js";
import { upgradeWorkspace } from "../src/persistence/migrations.js";
import { FIXTURE_TIME, fullWorkspace } from "./fixtures/full-workspace.mjs";

const idGenerator = () => { let sequence = 0; return (prefix) => `${prefix}-${++sequence}`; };
const sourceFor = (workspace) => workspace.dataSources.find((source) => source.id === "ds-inline");
const convert = (workspace, nextType, propertyId = "change") => convertPropertyType(workspace, { sourceId: "ds-inline", propertyId, nextType, now: FIXTURE_TIME, idFactory: idGenerator() });

test("select and multi select convert without losing colors", () => {
  const workspace = upgradeWorkspace(fullWorkspace());
  const options = [{ id: "first", name: "甲", color: "red" }, { id: "second", name: "乙", color: "blue" }];
  sourceFor(workspace).properties.push(createProperty({ id: "change", type: "select", options }));
  workspace.databaseItems[0].values.change = "first";
  const multiple = convert(workspace, "multi_select");
  assert.deepEqual(multiple.databaseItems[0].values.change, ["first"]);
  assert.deepEqual(sourceFor(multiple).properties.find((property) => property.id === "change").options, options);
  const single = convert(multiple, "select");
  assert.equal(single.databaseItems[0].values.change, "first");
  assert.deepEqual(sourceFor(single).properties.find((property) => property.id === "change").options, options);
});

test("text converts to number checkbox date and select", () => {
  const answers = [["12", "number", 12], ["是", "checkbox", true], ["2026/9/3", "date", { start: "2026-09-03", end: null, includeTime: false, timeZone: null }], ["甲", "select", "opt-1"]];
  for (const [text, type, expected] of answers) {
    const workspace = upgradeWorkspace(fullWorkspace());
    sourceFor(workspace).properties.push(createProperty({ id: "change", type: "text" }));
    workspace.databaseItems[0].values.change = text;
    const result = convert(workspace, type);
    assert.deepEqual(result.databaseItems[0].values.change, expected);
    if (type === "select") assert.deepEqual(sourceFor(result).properties.find((property) => property.id === "change").options, [{ id: "opt-1", name: "甲", color: "default" }]);
  }
});

test("unconvertible values become empty", () => {
  const workspace = upgradeWorkspace(fullWorkspace());
  sourceFor(workspace).properties.push(createProperty({ id: "change", type: "text" }));
  workspace.databaseItems[0].values.change = "abc";
  workspace.databaseViews[0].config.table = { calculations: { change: "earliest" } };
  const now = new Date(Date.parse(FIXTURE_TIME) + 1).toISOString();
  const result = convertPropertyType(workspace, { sourceId: "ds-inline", propertyId: "change", nextType: "number", now, idFactory: idGenerator() });
  assert.equal(result.databaseItems[0].values.change, null);
  assert.equal(result.databaseItems[0].updatedAt, now);
  assert.ok(!Object.hasOwn(result.databaseViews[0].config.table.calculations, "change"));
});

test("deleting a property cleans items views and relations", () => {
  const workspace = upgradeWorkspace(fullWorkspace());
  const propertyId = "rel-to-full";
  workspace.databaseViews[0] = { ...workspace.databaseViews[0], visiblePropertyIds: ["title", propertyId], sorts: [{ propertyId, direction: "asc" }], filter: { kind: "group", op: "and", children: [{ kind: "group", op: "or", children: [{ kind: "condition", propertyId, operator: "contains", value: "i-3" }] }, { kind: "condition", propertyId: "status", operator: "equals", value: "done" }] }, groupBy: propertyId, grouping: { primaryPropertyId: propertyId, secondaryPropertyId: propertyId }, config: { table: { columnWidths: { [propertyId]: 200 }, wrapPropertyIds: [propertyId, "status"] }, nested: { list: [propertyId, "status"], single: propertyId } } };
  const original = structuredClone(workspace);
  const result = deleteProperty(workspace, { sourceId: "ds-inline", propertyId });
  assert.ok(sourceFor(result).properties.every((property) => property.id !== propertyId));
  assert.ok(result.databaseItems.filter((item) => item.sourceId === "ds-inline").every((item) => !Object.hasOwn(item.values, propertyId)));
  assert.ok(result.databaseViews[0].visiblePropertyIds.every((id) => id !== propertyId));
  assert.deepEqual(result.databaseViews[0].sorts, []);
  assert.deepEqual(result.databaseViews[0].filter.children, [{ kind: "condition", propertyId: "status", operator: "equals", value: "done" }]);
  assert.deepEqual(result.databaseViews[0].grouping, { primaryPropertyId: null, secondaryPropertyId: null });
  assert.deepEqual(result.databaseViews[0].config, { table: { columnWidths: {}, wrapPropertyIds: ["status"] }, nested: { list: ["status"], single: null } });
  assert.ok(result.relations.every((relation) => relation.propertyId !== propertyId && relation.reciprocalPropertyId !== propertyId));
  assert.deepEqual(workspace, original);
});

test("the title property cannot be converted or deleted", () => {
  const workspace = upgradeWorkspace(fullWorkspace());
  assert.throws(() => convert(workspace, "number", "title"), /名称属性不能更改类型或删除/);
  assert.throws(() => deleteProperty(workspace, { sourceId: "ds-inline", propertyId: "title" }), /名称属性不能更改类型或删除/);
});
