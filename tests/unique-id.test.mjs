import test from "node:test";
import assert from "node:assert/strict";
import { createProperty, resolvePropertyValue } from "../src/domain/database.js";
import { formatPropertyValue } from "../src/domain/databaseProperties.js";
import { allocateUniqueIds, assignUniqueIds } from "../src/domain/propertyChanges.js";
import { FIXTURE_TIME, fullWorkspace } from "./fixtures/full-workspace.mjs";
import { upgradeWorkspace } from "../src/persistence/migrations.js";

test("unique ids number existing records by creation time", () => {
  const workspace = upgradeWorkspace(fullWorkspace());
  workspace.dataSources.find((source) => source.id === "ds-full").properties.push(createProperty({ id: "uid", type: "unique_id" }));
  const time = Date.parse(FIXTURE_TIME);
  workspace.databaseItems = [
    { id: "late", sourceId: "ds-full", pageId: "p-rec-3", createdAt: new Date(time + 2).toISOString(), values: {} },
    { id: "b", sourceId: "ds-full", pageId: "p-rec-4", createdAt: new Date(time + 1).toISOString(), values: {} },
    { id: "a", sourceId: "ds-full", pageId: "p-b-solo", createdAt: new Date(time + 1).toISOString(), values: {} },
  ];
  const original = structuredClone(workspace);
  const numbered = assignUniqueIds(workspace, { sourceId: "ds-full", propertyId: "uid" });
  assert.deepEqual(numbered.databaseItems.map((item) => item.values.uid), [3, 2, 1]);
  assert.equal(numbered.dataSources.find((source) => source.id === "ds-full").properties.find((property) => property.id === "uid").config.nextNumber, 4);
  assert.deepEqual(workspace, original);
  const removed = { ...numbered, databaseItems: numbered.databaseItems.filter((item) => item.id !== "late") };
  const allocated = allocateUniqueIds(removed, { sourceId: "ds-full", values: { uid: 1 } });
  assert.equal(allocated.values.uid, 4);
  assert.equal(allocated.workspace.dataSources.find((source) => source.id === "ds-full").properties.find((property) => property.id === "uid").config.nextNumber, 5);
  assert.deepEqual(allocateUniqueIds(removed, { sourceId: "ds-full", values: { uid: 1 } }), allocated);
});

test("unique ids display the prefix", () => {
  assert.equal(formatPropertyValue({}, createProperty({ type: "unique_id", config: { prefix: "TASK" } }), 7), "TASK-7");
  assert.equal(formatPropertyValue({}, createProperty({ type: "unique_id" }), 7), "7");
});

test("created by and last edited by show me", () => {
  for (const type of ["created_by", "last_edited_by"]) {
    const property = createProperty({ id: type, type });
    const value = resolvePropertyValue({}, { properties: [property] }, { id: "item", values: {} }, property);
    assert.equal(value, "我");
    assert.equal(formatPropertyValue({}, property, value), "我");
  }
});
