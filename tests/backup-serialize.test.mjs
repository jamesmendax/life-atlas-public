import test from "node:test";
import assert from "node:assert/strict";
import { BACKUP_COLLECTIONS, requiredCollections } from "../src/backup/format.js";
import { workspaceToFiles, filesToWorkspace, jsonBytes, parseJsonBytes } from "../src/backup/serialize.js";
import { backupWorkspace } from "./fixtures/backup-helpers.mjs";

test("workspaceToFiles writes meta and one jsonl per collection", () => {
  const workspace = { ...backupWorkspace(), syncedSources: [] };
  const files = workspaceToFiles(workspace);
  assert.equal(files.length, requiredCollections(workspace.schemaVersion).length + 1);
  assert.equal(files[0].path, "workspace/meta.json");
  const { collectionOrder } = parseJsonBytes(files[0].bytes);
  for (const name of requiredCollections(workspace.schemaVersion)) assert.deepEqual(collectionOrder[name], (workspace[name] ?? []).map(({ id }) => id));
  for (const name of requiredCollections(workspace.schemaVersion)) assert.ok(files.some((file) => file.path === `workspace/entities/${name}.jsonl`));
  assert.equal(files.find((file) => file.path.endsWith("/syncedSources.jsonl")).bytes.byteLength, 0);
});
test("jsonl lines are sorted by id and end with a newline", () => {
  for (const file of workspaceToFiles(backupWorkspace()).filter((entry) => entry.path.endsWith(".jsonl") && entry.bytes.length)) {
    const text = new TextDecoder().decode(file.bytes);
    assert.ok(text.endsWith("\n"));
    const ids = text.trimEnd().split("\n").map((line) => JSON.parse(line).id);
    assert.deepEqual(ids, [...ids].sort());
  }
});
test("filesToWorkspace restores every collection deeply equal", () => {
  const workspace = backupWorkspace();
  const files = new Map(workspaceToFiles(workspace).map((file) => [file.path, file.bytes]));
  const restored = filesToWorkspace((filePath) => files.get(filePath));
  for (const collection of BACKUP_COLLECTIONS) assert.deepEqual(restored[collection], workspace[collection] ?? []);
  assert.deepEqual(restored.ui, workspace.ui);
  assert.equal(restored.savedAt, workspace.savedAt);
});
test("a legacy backup without collection order retains its JSONL line order", () => {
  const workspace = backupWorkspace();
  const files = new Map(workspaceToFiles(workspace).map((file) => [file.path, file.bytes]));
  const meta = parseJsonBytes(files.get("workspace/meta.json"));
  delete meta.collectionOrder;
  files.set("workspace/meta.json", jsonBytes(meta));
  const items = [...workspace.databaseItems].reverse();
  files.set("workspace/entities/databaseItems.jsonl", new TextEncoder().encode(items.map((item) => JSON.stringify(item) + "\n").join("")));
  assert.deepEqual(filesToWorkspace((filePath) => files.get(filePath)).databaseItems, items);
});
test("unknown top-level fields round-trip through extras", () => {
  const workspace = { ...backupWorkspace(), futureMetadata: { custom: ["retained", { time: "2020-01-01" }] } };
  const files = new Map(workspaceToFiles(workspace).map((file) => [file.path, file.bytes]));
  assert.deepEqual(filesToWorkspace((filePath) => files.get(filePath)).futureMetadata, workspace.futureMetadata);
});
