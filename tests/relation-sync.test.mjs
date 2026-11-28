import test from "node:test";
import assert from "node:assert/strict";
import { applyRelationChange } from "../src/domain/database.js";
import { updateTableItemsProperty } from "../src/domain/tableRecordActions.js";
import { permanentlyDelete } from "../src/domain/trash.js";
import { fullWorkspace } from "./fixtures/full-workspace.mjs";

const NOW = "2026-11-01T02:00:00.000Z";
const item = (workspace, id) => workspace.databaseItems.find((entry) => entry.id === id);
const limit = (workspace, sourceId, propertyId) => {
  const property = workspace.dataSources.find(source => source.id === sourceId).properties.find(entry => entry.id === propertyId);
  property.config.relationLimit = 1;
};

test("adding a relation updates the reciprocal side", () => {
  const input = fullWorkspace();
  const result = applyRelationChange(input, { itemId: "i-4", propertyId: "rel-back", nextIds: ["i-2", "i-1", "i-1", "missing"], now: NOW });
  assert.deepEqual(item(result, "i-4").values["rel-back"], ["i-2", "i-1"]);
  assert.deepEqual(item(result, "i-1").values["rel-to-full"], ["i-3", "i-4"]);
  assert.equal(item(result, "i-4").updatedAt, NOW);
  assert.equal(item(result, "i-1").updatedAt, NOW);
  assert.equal(item(result, "i-2").updatedAt, item(input, "i-2").updatedAt);
});

test("removing a relation updates the reciprocal side", () => {
  const result = applyRelationChange(fullWorkspace(), { itemId: "i-4", propertyId: "rel-back", nextIds: [], now: NOW });
  assert.deepEqual(item(result, "i-4").values["rel-back"], []);
  assert.deepEqual(item(result, "i-2").values["rel-to-full"], ["i-3"]);
  assert.equal(item(result, "i-2").updatedAt, NOW);
});

test("both sides change in one workspace update", () => {
  const input = fullWorkspace();
  const original = structuredClone(input);
  const result = applyRelationChange(input, { itemId: "i-4", propertyId: "rel-back", nextIds: ["i-1"], now: NOW });
  assert.notEqual(result, input);
  assert.deepEqual(input, original);
  assert.deepEqual(item(result, "i-4").values["rel-back"], ["i-1"]);
  assert.deepEqual(item(result, "i-1").values["rel-to-full"], ["i-3", "i-4"]);
  assert.deepEqual(item(result, "i-2").values["rel-to-full"], ["i-3"]);
});

test("relations without a reciprocal property only change one side", () => {
  const input = fullWorkspace();
  input.relations.find((entry) => entry.sourceId === "ds-full").reciprocalPropertyId = null;
  const result = applyRelationChange(input, { itemId: "i-4", propertyId: "rel-back", nextIds: ["i-1"], now: NOW });
  assert.deepEqual(item(result, "i-4").values["rel-back"], ["i-1"]);
  assert.deepEqual(item(result, "i-1"), item(input, "i-1"));
  assert.deepEqual(item(result, "i-2"), item(input, "i-2"));
});

test("deleting one side cleans the other", () => {
  const result = permanentlyDelete(fullWorkspace(), { pageIds: ["p-rec-2"] });
  assert.ok(!result.databaseItems.some((entry) => entry.id === "i-2"));
  assert.deepEqual(item(result, "i-3").values["rel-back"], ["i-1"]);
  assert.deepEqual(item(result, "i-4").values["rel-back"], []);
});

test("rejects an existing row from another source without changing either side", () => {
  const input = fullWorkspace();
  assert.equal(applyRelationChange(input, { itemId: "i-4", propertyId: "rel-back", nextIds: ["i-1", "i-3"], now: NOW }), input);
  input.relations = [];
  assert.equal(applyRelationChange(input, { itemId: "i-4", propertyId: "rel-back", nextIds: ["i-3"], now: NOW }), input);
  assert.equal(applyRelationChange(input, { itemId: "i-4", propertyId: "title", nextIds: ["i-1"], now: NOW }), input);
});

test("single relations reject multiple new IDs and replace a valid link atomically", () => {
  const input = fullWorkspace();
  limit(input, "ds-full", "rel-back");
  assert.equal(applyRelationChange(input, { itemId: "i-4", propertyId: "rel-back", nextIds: ["i-1", "i-2"], now: NOW }), input);
  assert.equal(updateTableItemsProperty(input, {
    sourceId: "ds-full", itemIds: ["i-4"], propertyId: "rel-back", value: ["i-1", "i-2"], now: NOW,
  }), input);
  const result = applyRelationChange(input, { itemId: "i-4", propertyId: "rel-back", nextIds: ["i-1"], now: NOW });
  assert.deepEqual(item(result, "i-4").values["rel-back"], ["i-1"]);
  assert.deepEqual(item(result, "i-1").values["rel-to-full"], ["i-3", "i-4"]);
  assert.deepEqual(item(result, "i-2").values["rel-to-full"], ["i-3"]);
});

test("an occupied reciprocal single relation rejects the entire replacement", () => {
  const input = fullWorkspace();
  limit(input, "ds-inline", "rel-to-full");
  assert.equal(applyRelationChange(input, { itemId: "i-4", propertyId: "rel-back", nextIds: ["i-1"], now: NOW }), input);
  const cleared = applyRelationChange(input, { itemId: "i-1", propertyId: "rel-to-full", nextIds: [], now: NOW });
  const result = applyRelationChange(cleared, { itemId: "i-4", propertyId: "rel-back", nextIds: ["i-1"], now: NOW });
  assert.deepEqual(item(result, "i-1").values["rel-to-full"], ["i-4"]);
  assert.deepEqual(item(result, "i-4").values["rel-back"], ["i-1"]);
});

test("legacy multi-value and foreign references can be removed without touching unrelated rows", () => {
  const input = fullWorkspace();
  const legacy = item(input, "i-3");
  legacy.values["rel-back"] = ["i-1", "i-2", "i-4", "missing"];
  item(input, "i-4").values["rel-to-full"] = ["i-3"];
  limit(input, "ds-full", "rel-back");
  const result = applyRelationChange(input, { itemId: "i-3", propertyId: "rel-back", nextIds: ["i-1", "i-2", "missing"], now: NOW });
  assert.deepEqual(item(result, "i-3").values["rel-back"], ["i-1", "i-2", "missing"]);
  assert.equal(item(result, "i-4"), item(input, "i-4"));
  assert.deepEqual(legacy.values["rel-back"], ["i-1", "i-2", "i-4", "missing"]);
  assert.equal(applyRelationChange(result, { itemId: "i-3", propertyId: "rel-back", nextIds: ["unknown"], now: NOW }), result);
  const repaired = applyRelationChange(result, { itemId: "i-3", propertyId: "rel-back", nextIds: ["i-1"], now: NOW });
  assert.deepEqual(item(repaired, "i-3").values["rel-back"], ["i-1"]);
  assert.deepEqual(item(repaired, "i-2").values["rel-to-full"], ["i-4"]);
});
