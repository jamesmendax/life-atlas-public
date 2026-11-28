import test from "node:test";
import assert from "node:assert/strict";
import { normalizeAttachment } from "../src/domain/attachments.js";
import { migrateAssetProvider, migrateTrashGroups } from "../src/persistence/migrations.js";
import { fullWorkspace } from "./fixtures/full-workspace.mjs";

test("v12 keeps asset providers intact", () => assert.equal(normalizeAttachment({ provider: "asset", storageKey: "a".repeat(64) }).provider, "asset"));
test("v12 only bumps the schema version", () => {
  const previous = migrateTrashGroups(fullWorkspace());
  assert.deepEqual(migrateAssetProvider(fullWorkspace()), { ...previous, schemaVersion: 12 });
});
test("v12 is idempotent", () => {
  const workspace = migrateAssetProvider(fullWorkspace());
  assert.deepEqual(migrateAssetProvider(workspace), workspace);
});
