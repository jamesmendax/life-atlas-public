import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CURRENT_SCHEMA_VERSION, upgradeWorkspace } from "../src/persistence/migrations.js";
import { workspaceToFiles, filesToWorkspace } from "../src/backup/serialize.js";
import { backupWorkspace } from "./fixtures/backup-helpers.mjs";
import { openWorkspaceDatabase, prepareWritable, initializeWorkspace, readAllRows, assembleWorkspace, quickCheck } from "../electron/main/storage/workspaceDb.js";
import { archivePage, isPageArchived } from "../src/domain/archive.js";
import { buildSearchDocuments, querySearch } from "../src/search/searchIndex.js";
import { itemsForSource, projectViewItems, resolvePropertyValue } from "../src/domain/database.js";

test("schema 19 migrates to one current model without altering the original graph", () => {
  const previous = {
    schemaVersion: 19, workspaceId: "legacy19", ui: {}, folders: [],
    pages: [{ id: "owner", pageType: "database", databaseSourceId: "a", databaseViewId: "va", content: [{ id: "db", type: "databaseView", props: { sourceId: "a", viewId: "va", viewIdsJson: '["va"]' } }] }],
    dataSources: [{ id: "a", properties: [] }], databaseItems: [{ id: "i", sourceId: "a", pageId: "p", values: { title: "original" } }],
    databaseViews: [{ id: "va", sourceId: "a" }], relations: [], pageVersions: [{ id: "pv", pageId: "owner", content: [] }],
  };
  const before = structuredClone(previous), next = upgradeWorkspace(previous);
  assert.equal(CURRENT_SCHEMA_VERSION, 20);
  assert.equal(next.schemaVersion, 20);
  assert.deepEqual(previous, before);
  assert.deepEqual(next.pages[0].databaseSourceIds, ["a"]);
  assert.equal(next.pages[0].content[0].props.sourceIdsJson, '["a"]');
  assert.deepEqual(next.databaseItems[0], { ...previous.databaseItems[0], dependencyIds: [] });
  assert.deepEqual(next.pageVersions, previous.pageVersions);
  assert.deepEqual(next.databaseVersions, []);
  assert.deepEqual(upgradeWorkspace(next), next);
});

test("schema 20 history is a required backup collection, while schema 19 can omit it", () => {
  const current = backupWorkspace();
  current.databaseVersions = [{ id: "db-v1", sourceId: current.dataSources[0].id, createdAt: "2026-11-27T11:00:00.000Z", items: [], source: structuredClone(current.dataSources[0]) }];
  const files = new Map(workspaceToFiles(current).map((file) => [file.path, file.bytes]));
  assert.deepEqual(filesToWorkspace((name) => files.get(name)).databaseVersions, current.databaseVersions);
  files.delete("workspace/entities/databaseVersions.jsonl");
  assert.throws(() => filesToWorkspace((name) => files.get(name)), /databaseVersions/);
  const previous = { ...current, schemaVersion: 19 };
  const oldFiles = new Map(workspaceToFiles(previous).map((file) => [file.path, file.bytes]));
  assert.deepEqual(filesToWorkspace((name) => oldFiles.get(name)).databaseVersions, []);
});

test("SQLite closes and reopens the same archive flags and independent database versions", (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "life-atlas-v20-data-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, "workspace.sqlite"), workspace = backupWorkspace();
  workspace.pages[0].archivedAt = "2026-11-27T11:00:00.000Z";
  workspace.databaseVersions = [{ id: "v-db", sourceId: workspace.dataSources[0].id, source: structuredClone(workspace.dataSources[0]), items: structuredClone(workspace.databaseItems) }];
  let db = openWorkspaceDatabase(file);
  try { prepareWritable(db); initializeWorkspace(db, workspace, { generation: "schema20", now: workspace.savedAt }); }
  finally { db.close(); }
  db = openWorkspaceDatabase(file, { readOnly: true });
  try {
    assert.equal(quickCheck(db), "ok");
    const loaded = assembleWorkspace(readAllRows(db));
    assert.deepEqual(loaded.databaseVersions, workspace.databaseVersions);
    assert.equal(loaded.pages[0].archivedAt, workspace.pages[0].archivedAt);
    assert.deepEqual(loaded.databaseItems, workspace.databaseItems);
  } finally { db.close(); }
});

test("archived rows disappear from normal views and search while explicit relation rollups remain", () => {
  let workspace = backupWorkspace();
  const item = workspace.databaseItems[0], source = workspace.dataSources.find((entry) => entry.id === item.sourceId);
  const view = { id: "all", sourceId: item.sourceId, type: "table", filter: null, sorts: [] };
  const relationValues = source.properties.filter((property) => property.type === "relation" || property.type === "rollup").map((property) => [property, resolvePropertyValue(workspace, source, item, property)]);
  workspace = archivePage(workspace, item.pageId, true, "2026-11-27T11:00:00Z");
  assert.equal(isPageArchived(workspace, item.pageId), true);
  assert.equal(itemsForSource(workspace, source.id).some((entry) => entry.id === item.id), true);
  assert.equal(projectViewItems(workspace, view).some((entry) => entry.id === item.id), false);
  for (const [property, value] of relationValues) assert.deepEqual(resolvePropertyValue(workspace, source, item, property), value);
  const documents = buildSearchDocuments(workspace.folders, workspace.pages, workspace);
  assert.equal(querySearch(documents, "", "all").some((doc) => doc.entityId === item.pageId || doc.entityId === item.id), false);
  assert.equal(querySearch(documents, "", "all", { archive: "archived" }).some((doc) => doc.entityId === item.pageId), true);
});
