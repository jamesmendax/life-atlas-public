import test from "node:test";
import assert from "node:assert/strict";
import { bigWorkspace } from "./fixtures/big-workspace.mjs";
import { checkWorkspaceIntegrity } from "../src/domain/integrity.js";

test("big fixture has the requested sizes and is deterministic", () => {
  const first = bigWorkspace();
  assert.equal(first.pages.length, 25001);
  assert.equal(first.databaseItems.length, 20000);
  assert.equal(first.folders.length, 510);
  assert.equal(first.databaseViews[0].id, "big-view");
  assert.equal(JSON.stringify(first), JSON.stringify(bigWorkspace()));
  assert.equal(first.pages.find((page) => page.id === "big-p-499").folderId, "big-f-9-49");
  assert.equal(first.pages.find((page) => page.id === "big-p-500").folderId, "big-f-0-0");
  assert.equal(first.pages[0].content.length, 5);
  assert.equal(first.pages[0].content[0].content.length, 40);
});

test("big fixture record links and the full page view are complete", () => {
  const workspace = bigWorkspace({ pages: 5, records: 11 });
  assert.equal(workspace.pages.length, 17);
  assert.equal(checkWorkspaceIntegrity(workspace).ok, true);
  const page = workspace.pages.find((entry) => entry.id === "big-db-page");
  assert.equal(page.databaseViewId, "big-view");
  assert.deepEqual(workspace.dataSources[0].properties.map((property) => property.id), ["title", "status", "amount", "due"]);
  assert.equal(new Set(workspace.pages.map((entry) => entry.id)).size, workspace.pages.length);
});
