import test from "node:test";
import assert from "node:assert/strict";
import { createProperty, resolvePropertyValue } from "../src/domain/database.js";
import { convertPropertyType, updatePropertyDefinition } from "../src/domain/propertyChanges.js";
import { normalizeLoadedWorkspace } from "../src/persistence/normalize.js";
import { createChangeTracker } from "../src/persistence/changeset.js";
import { createWorkspaceService } from "../electron/main/storage/workspaceService.js";
import { createIsolatedDirectory, removeIsolatedDirectory } from "./desktop/helpers.mjs";
import { fullWorkspace, FIXTURE_TIME } from "./fixtures/full-workspace.mjs";

const NOW = "2026-11-13T04:00:00.000Z";
const EXPRESSION = 'if(prop("状态") == "Published" and not empty(prop("发布日期")) and dateBetween(now(), prop("发布日期"), "days") <= 21, "SHOW", "HIDE")';
const SOURCE = "ds-inline";
const RECENT = "recent97";

function resultFor(workspace, itemId) {
  const source = workspace.dataSources.find((entry) => entry.id === SOURCE);
  const item = workspace.databaseItems.find((entry) => entry.id === itemId);
  const property = source.properties.find((entry) => entry.id === RECENT);
  const originalNow = Date.now;
  Date.now = () => Date.parse(NOW);
  try { return resolvePropertyValue(workspace, source, item, property); }
  finally { Date.now = originalNow; }
}

test("same-ID formula conversion and dynamic option labels survive incremental SQLite saves and reopen", async (context) => {
  const dataRoot = createIsolatedDirectory("formula-conversion97");
  context.diagnostic(`isolatedDataRoot=${dataRoot}`);
  let service;
  let sequence = 0;
  const makeService = () => createWorkspaceService({ dataRoot, now: NOW, normalize: normalizeLoadedWorkspace,
    idFactory: (prefix) => `${prefix}-formula97-${++sequence}` });
  context.after(() => { try { service?.close(); } finally { removeIsolatedDirectory(dataRoot); } });
  service = makeService();
  await service.load();

  const fixture = fullWorkspace();
  // Keep the existing trash fixture inside its normal retention window at NOW.
  for (const page of fixture.pages.filter((entry) => entry.trashedAt)) {
    page.trashedAt = "2026-11-12T04:00:00.000Z";
    page.updatedAt = page.trashedAt;
  }
  const seed = normalizeLoadedWorkspace(fixture, { fallbackWorkspace: fixture, now: FIXTURE_TIME,
    idFactory: (prefix) => `${prefix}-seed97-${++sequence}` });
  const source = seed.dataSources.find((entry) => entry.id === SOURCE);
  source.properties.find((entry) => entry.id === "status").options.find((entry) => entry.id === "doing").name = "Published";
  source.properties.find((entry) => entry.id === "due").name = "发布日期";
  source.properties.push(createProperty({ id: RECENT, name: "首页近期", type: "text" }));
  const records = seed.databaseItems.filter((entry) => entry.sourceId === SOURCE);
  assert.ok(records.length >= 2);
  records.forEach((item, index) => {
    item.values[RECENT] = "HIDE";
    item.values.status = index === 0 ? "doing" : "todo";
    item.values.due = { start: "2026-11-12", end: null, includeTime: false, timeZone: null };
  });
  service.replaceWorkspace(seed);
  const baseline = service.readWorkspace();
  const original = structuredClone(baseline);
  const generation = service.getMeta("generation");
  const tracker = createChangeTracker(baseline);
  const converted = convertPropertyType(baseline, { sourceId: SOURCE, propertyId: RECENT,
    nextType: "formula", now: NOW, idFactory: () => { throw new Error("conversion must preserve IDs"); } });
  const configured = updatePropertyDefinition(converted, { sourceId: SOURCE, propertyId: RECENT,
    definition: { config: { expression: EXPRESSION } }, now: NOW });
  const changes = tracker.diff(configured);
  assert.deepEqual(changes.deletes, []);
  assert.ok(changes.upserts.every((entry) => ["dataSources", "databaseItems"].includes(entry.collection)));
  assert.deepEqual(baseline, original);
  await service.applyChanges({ ...changes, generation, schemaVersion: configured.schemaVersion });
  service.close();

  service = makeService();
  const reopened = await service.load();
  assert.equal(reopened.generation, generation);
  for (const collection of Object.keys(configured).filter((key) => Array.isArray(configured[key]))) {
    assert.deepEqual(reopened.workspace[collection], configured[collection], `${collection} changed on reopen`);
  }
  const restoredSource = reopened.workspace.dataSources.find((entry) => entry.id === SOURCE);
  const restoredProperty = restoredSource.properties.find((entry) => entry.id === RECENT);
  assert.equal(restoredProperty.type, "formula");
  assert.equal(restoredProperty.config.expression, EXPRESSION);
  assert.equal(resultFor(reopened.workspace, records[0].id), "SHOW");
  assert.equal(resultFor(reopened.workspace, records[1].id), "HIDE");
  assert.ok(reopened.workspace.databaseItems.filter((entry) => entry.sourceId === SOURCE)
    .every((entry) => entry.values[RECENT] === null));
  assert.equal(reopened.workspace.databaseItems.find((entry) => entry.id === records[0].id).values.status, "doing");

  const changed = { ...reopened.workspace, databaseItems: reopened.workspace.databaseItems.map((item) =>
    item.id !== records[0].id ? item : { ...item, values: { ...item.values, status: "todo" }, updatedAt: NOW }) };
  assert.equal(resultFor(changed, records[0].id), "HIDE");
  const nextChanges = createChangeTracker(reopened.workspace).diff(changed);
  assert.deepEqual(nextChanges.deletes, []);
  assert.equal(nextChanges.upserts.length, 1);
  assert.equal(nextChanges.upserts[0].collection, "databaseItems");
  await service.applyChanges({ ...nextChanges, generation, schemaVersion: changed.schemaVersion });
  service.close();
  service = makeService();
  const final = (await service.load()).workspace;
  assert.equal(resultFor(final, records[0].id), "HIDE");
  assert.equal(final.databaseItems.find((entry) => entry.id === records[0].id).values[RECENT], null);
  assert.deepEqual(final.pages, original.pages);
  assert.deepEqual(final.pageVersions, original.pageVersions);
  assert.deepEqual(final.attachments, original.attachments);
  assert.deepEqual(final.databaseViews, original.databaseViews);
});
