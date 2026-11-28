import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fullWorkspace, SOLO_TRASHED_AT } from "./fixtures/full-workspace.mjs";
import { migrateTrashGroups } from "../src/persistence/migrations.js";
import { createWorkspaceBackup, parseWorkspaceBackup } from "../src/domain/workspaceBackup.js";

test("v11 adds trash group fields with null defaults", () => {
  const input = fullWorkspace();
  const before = structuredClone(input);
  const migrated = migrateTrashGroups(input);
  assert.equal(migrated.schemaVersion, 11);
  for (const folder of migrated.folders) {
    assert.equal(folder.trashedAt, null);
    assert.equal(folder.trashedByFolderId, null);
  }
  for (const page of migrated.pages) {
    assert.equal(page.trashedByFolderId, null);
    assert.equal(page.trashedByPageId, null);
  }
  const restoredShape = structuredClone(migrated);
  restoredShape.schemaVersion = 10;
  for (const folder of restoredShape.folders) {
    delete folder.trashedAt;
    delete folder.trashedByFolderId;
  }
  for (const page of restoredShape.pages) {
    delete page.trashedByFolderId;
    delete page.trashedByPageId;
  }
  assert.deepEqual(restoredShape, before);
  assert.deepEqual(input, before);
});

test("v11 keeps every collection count and entity id", () => {
  const input = fullWorkspace();
  const migrated = migrateTrashGroups(input);
  for (const [collection, entities] of Object.entries(input)) {
    if (!Array.isArray(entities)) continue;
    assert.equal(migrated[collection].length, entities.length, collection);
    assert.deepEqual(migrated[collection].map((entity) => entity.id), entities.map((entity) => entity.id), collection);
  }
});

test("v11 is idempotent", () => {
  const migrated = migrateTrashGroups(fullWorkspace());
  assert.deepEqual(migrateTrashGroups(migrated), migrated);
});

test("v11 upgrades the frozen v10 fixture", () => {
  const input = JSON.parse(fs.readFileSync(new URL("./fixtures/workspace-v10.json", import.meta.url), "utf8"));
  const before = structuredClone(input);
  const migrated = migrateTrashGroups(input);
  assert.equal(migrated.schemaVersion, 11);
  assert.equal(migrated.pages.length, 6);
  assert.equal(migrated.databaseItems.length, 4);
  assert.equal(migrated.databaseViews.length, 10);
  assert.deepEqual(input, before);
});

test("v11 keeps an already trashed page as its own group root", () => {
  const migrated = migrateTrashGroups(fullWorkspace());
  const solo = migrated.pages.find((page) => page.id === "p-b-solo");
  assert.equal(solo.trashedAt, SOLO_TRASHED_AT);
  assert.equal(solo.trashedByFolderId, null);
  assert.equal(solo.trashedByPageId, null);
});

test("legacy JSON backup preserves shell 10 compatibility and already upgraded workspaces", () => {
  const legacy = fullWorkspace();
  legacy.schemaVersion = 9;
  const backup = createWorkspaceBackup(legacy);
  assert.equal(backup.schemaVersion, 10);
  assert.equal(backup.workspace.schemaVersion, 10);
  assert.equal(parseWorkspaceBackup(JSON.stringify(backup)).schemaVersion, 10);
  const current = migrateTrashGroups(fullWorkspace());
  const currentBackup = createWorkspaceBackup(current);
  assert.equal(currentBackup.schemaVersion, 11);
  assert.deepEqual(parseWorkspaceBackup(currentBackup), current);
});
