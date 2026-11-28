import test from "node:test";
import assert from "node:assert/strict";
import { FIXTURE_TIME, fullWorkspace } from "./fixtures/full-workspace.mjs";
import { expectedV20BlockDeclarations } from "./fixtures/schema-v20-expectations.mjs";
import { parseWorkspaceBackup } from "../src/domain/workspaceBackup.js";
import { CURRENT_SCHEMA_VERSION, normalizeLoadedWorkspace } from "../src/persistence/normalize.js";

test("v10 preserves an edited legacy replica and its references", () => {
  const input = fullWorkspace();
  input.schemaVersion = 9;
  input.workspaceId = "legacy-replica-workspace";
  const replica = input.pages.find((page) => page.id === "p-b1");
  replica.replicaKey = "notion-mendax-vibe-wiki-v1";
  replica.contentRevision = 2;
  replica.content.push({ id: "b-user-edit", type: "paragraph", content: "Edited after import" });
  const child = input.pages.find((page) => page.id === "p-a1-child");
  child.parentPageId = replica.id;
  child.folderId = replica.folderId;
  input.folders.find((folder) => folder.id === replica.folderId).lastOpenedPageId = replica.id;
  input.ui.selectedPageId = replica.id;
  const before = structuredClone(input);

  const backup = { kind: "life-atlas-workspace", version: 1, schemaVersion: 9, workspace: input };
  assert.deepEqual(parseWorkspaceBackup(backup), { ...before, schemaVersion: 10 });

  const loaded = normalizeLoadedWorkspace(input, { now: FIXTURE_TIME });
  assert.equal(loaded.schemaVersion, CURRENT_SCHEMA_VERSION);
  assert.equal(loaded.ui.selectedPageId, replica.id);
  assert.deepEqual(loaded.pages.find((page) => page.id === replica.id).content, expectedV20BlockDeclarations(replica.content));
  assert.deepEqual(loaded.pages.find((page) => page.id === "p-z1").content, expectedV20BlockDeclarations(input.pages.find((page) => page.id === "p-z1").content));
  assert.equal(loaded.pages.find((page) => page.id === child.id).parentPageId, replica.id);
  assert.equal(loaded.dataSources.find((source) => source.id === "ds-inline").ownerPageId, replica.id);
  assert.deepEqual(loaded.attachments, input.attachments);
  assert.deepEqual(input, before);
});
