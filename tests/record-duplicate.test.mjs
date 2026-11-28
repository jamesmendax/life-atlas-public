import test from "node:test";
import assert from "node:assert/strict";
import { createProperty, duplicateDatabaseItem } from "../src/domain/database.js";
import { assignUniqueIds } from "../src/domain/propertyChanges.js";
import { walkBlocks } from "../src/domain/blockDocument.js";
import { upgradeWorkspace } from "../src/persistence/migrations.js";
import { FIXTURE_TIME, fullWorkspace } from "./fixtures/full-workspace.mjs";

const idGenerator = () => { let sequence = 0; return (prefix) => `${prefix}-duplicate-${++sequence}`; };

test("duplicating a record copies values content and relations", () => {
  const workspace = upgradeWorkspace(fullWorkspace());
  const original = structuredClone(workspace);
  const result = duplicateDatabaseItem(workspace, { itemId: "i-1", now: FIXTURE_TIME, idFactory: idGenerator() });
  const item = result.databaseItems.at(-1);
  assert.deepEqual(item.values, workspace.databaseItems.find((entry) => entry.id === "i-1").values);
  assert.deepEqual(result.databaseItems.find((entry) => entry.id === "i-3").values["rel-back"], ["i-1", "i-2", item.id]);
  const page = result.pages.find((entry) => entry.id === item.pageId);
  const previous = workspace.pages.find((entry) => entry.id === "p-rec-1");
  assert.equal(page.title, previous.title);
  assert.deepEqual(walkBlocks(page.content).map((block) => block.content), walkBlocks(previous.content).map((block) => block.content));
  assert.ok(walkBlocks(page.content).every((block) => !walkBlocks(previous.content).some((old) => old.id === block.id)));
  assert.equal(result.comments.length, workspace.comments.length);
  assert.equal(result.discussions.length, workspace.discussions.length);
  assert.ok(page.sortIndex > previous.sortIndex && page.sortIndex < workspace.pages.find((entry) => entry.id === "p-rec-2").sortIndex);
  assert.deepEqual(workspace, original);
});

test("duplicated records get a new unique id", () => {
  const workspace = upgradeWorkspace(fullWorkspace());
  workspace.dataSources.find((source) => source.id === "ds-inline").properties.push(createProperty({ id: "uid", type: "unique_id", config: { prefix: "TASK" } }));
  const numbered = assignUniqueIds(workspace, { sourceId: "ds-inline", propertyId: "uid" });
  const nextNumber = numbered.dataSources.find((source) => source.id === "ds-inline").properties.find((property) => property.id === "uid").config.nextNumber;
  const result = duplicateDatabaseItem(numbered, { itemId: "i-1", now: FIXTURE_TIME, idFactory: idGenerator() });
  assert.equal(result.databaseItems.at(-1).values.uid, nextNumber);
  assert.equal(result.dataSources.find((source) => source.id === "ds-inline").properties.find((property) => property.id === "uid").config.nextNumber, nextNumber + 1);
});
