import test from "node:test";
import assert from "node:assert/strict";
import { coreParityWorkspace } from "./fixtures/core-parity-workspace.mjs";
import { chartProjection, aggregateNumbers, formDefaults, validateFormValues, mapProjection } from "../src/domain/viewProjections.js";
import { projectViewItems } from "../src/domain/database.js";

test("chart aggregation uses original rows, honors grouping and never converts missing values to zero averages", () => {
  const workspace = coreParityWorkspace(), source = workspace.dataSources[0];
  const items = projectViewItems(workspace, workspace.databaseViews[0]);
  const copy = structuredClone(workspace);
  assert.equal(chartProjection(workspace, source, items, { valuePropertyId: "amount", aggregation: "sum" }).total, 180);
  assert.equal(chartProjection(workspace, source, items, { valuePropertyId: "amount", aggregation: "average" }).total, 60);
  assert.equal(chartProjection(workspace, source, items, { xPropertyId: "status", aggregation: "count" }).points.length, 3);
  assert.equal(aggregateNumbers([null, "", 0, 6], "average"), 3);
  assert.equal(aggregateNumbers([], "average"), null);
  assert.deepEqual(workspace, copy);
});

test("forms enforce required fields and typed validation, retain hidden defaults and exclude computed fields", () => {
  const workspace = coreParityWorkspace(), source = workspace.dataSources[0];
  const config = { fields: [{ propertyId: "title", required: true }, { propertyId: "status", hidden: true, required: true, defaultValue: "todo" }, { propertyId: "email", required: false }] };
  assert.deepEqual(formDefaults(source, config), { status: "todo" });
  assert.equal(validateFormValues(source, config, {}).valid, false);
  assert.equal(validateFormValues(source, config, { title: "New", email: "not an email" }).valid, false);
  const result = validateFormValues(source, config, { title: "New", email: "new@example.com", amount: "42", people: ["person-a", "person-a"] });
  assert.equal(result.valid, true);
  assert.equal(result.values.status, "todo");
  assert.equal(result.values.amount, 42);
  assert.deepEqual(result.values.people, ["person-a"]);
});

test("map projection preserves zero coordinates and keeps missing/invalid coordinates in the list", () => {
  const workspace = coreParityWorkspace(), source = workspace.dataSources[0];
  const items = projectViewItems(workspace, workspace.databaseViews[0]);
  const result = mapProjection(workspace, source, items, { placePropertyId: "place" });
  assert.equal(result.located.length, 3);
  assert.equal(result.located.find((entry) => entry.item.id === "gamma").place.latitude, 0);
  items[0].values.place = { name: "Not yet located" };
  const next = mapProjection(workspace, source, items, { placePropertyId: "place" });
  assert.equal(next.located.length, 2);
  assert.equal(next.unlocated[0].label, "Alpha 项目");
});