import test from "node:test";
import assert from "node:assert/strict";
import { fullWorkspace, FIXTURE_TIME } from "./fixtures/full-workspace.mjs";
import { migrateTrashGroups } from "../src/persistence/migrations.js";
import { moveOwnedPage } from "../src/domain/pageMoves.js";
import { moveSidebarNode } from "../src/domain/sidebarDrag.js";
import { trashFolder } from "../src/domain/trash.js";

const NOW = "2026-11-09T05:00:00.000Z";
const MOVED = ["p-b1", "p-child", "p-grandchild", "p-rec-1", "p-rec-2", "p-nested-record", "p-nested-child", "p-trashed-child"];

function fixture() {
  const workspace = migrateTrashGroups(fullWorkspace());
  const root = workspace.pages.find((page) => page.id === "p-b1");
  workspace.pages.find((page) => page.id === "p-rec-3").folderId = "f-a";
  root.content.unshift({ id: "rich", type: "paragraph", content: [
    { type: "text", text: "important", styles: { bold: true } },
    { type: "link", href: "lifeatlas://page/p-c1", content: [{ type: "text", text: "external page", styles: { italic: true } }] },
  ] });
  workspace.pages.push(
    { ...structuredClone(root), id: "p-child", parentPageId: root.id, content: [{ id: "child", type: "paragraph", content: "child content" }] },
    { ...structuredClone(root), id: "p-grandchild", parentPageId: "p-child", folderId: "f-c", content: [] },
    { ...structuredClone(root), id: "p-nested-record", folderId: "f-a", databaseSourceId: "ds-nested", content: [] },
    { ...structuredClone(root), id: "p-nested-child", folderId: "f-a", parentPageId: "p-nested-record", content: [] },
    { ...structuredClone(root), id: "p-trashed-child", parentPageId: root.id, trashedAt: FIXTURE_TIME, trashedByPageId: null, trashedByFolderId: null, content: [] },
  );
  workspace.dataSources.push({ ...structuredClone(workspace.dataSources[0]), id: "ds-nested", ownerPageId: "p-rec-1" });
  workspace.databaseItems.push({ ...structuredClone(workspace.databaseItems[0]), id: "i-nested", sourceId: "ds-nested", pageId: "p-nested-record" });
  return workspace;
}

test("workspace move preserves an owned page tree without moving linked or related external pages", () => {
  const input = fixture();
  const before = structuredClone(input);
  const moved = moveOwnedPage(input, "p-b1", { folderId: "f-z", sortIndex: 50, now: NOW });
  for (const id of MOVED) {
    const original = before.pages.find((page) => page.id === id);
    const actual = moved.pages.find((page) => page.id === id);
    assert.equal(actual.folderId, "f-z", id);
    const { folderId: ignoredFolder, sortIndex: ignoredSort, updatedAt: ignoredTime, ...rootRest } = actual;
    const { folderId: oldFolder, sortIndex: oldSort, updatedAt: oldTime, ...originalRest } = original;
    assert.deepEqual(rootRest, originalRest, id);
    if (id !== "p-b1") {
      assert.equal(actual.sortIndex, original.sortIndex, id);
      assert.equal(actual.updatedAt, original.updatedAt, id);
    }
  }
  assert.equal(moved.pages.find((page) => page.id === "p-b1").sortIndex, 50);
  for (const id of ["p-c1", "p-z1", "p-db", "p-rec-3", "p-rec-4"]) assert.deepEqual(moved.pages.find((page) => page.id === id), before.pages.find((page) => page.id === id));
  for (const name of ["dataSources", "databaseItems", "databaseViews", "relations", "syncedSources", "attachments", "folders", "ui"]) assert.deepEqual(moved[name], before[name], name);
  assert.deepEqual(input, before, "source workspace must not be mutated");

  const oldFolderTrashed = trashFolder(moved, "f-b", NOW);
  for (const id of MOVED.filter((id) => id !== "p-trashed-child")) assert.equal(oldFolderTrashed.pages.find((page) => page.id === id).trashedAt, null, id);
  const oldTrash = oldFolderTrashed.pages.find((page) => page.id === "p-trashed-child");
  assert.equal(oldTrash.trashedAt, FIXTURE_TIME);
  assert.equal(oldTrash.trashedByPageId, null);
  assert.equal(oldTrash.trashedByFolderId, null);
});

test("sidebar cross-folder move carries the same owned tree and leaves reorder behavior separate", () => {
  const input = fixture();
  const moved = moveSidebarNode(input, { kind: "page", id: "p-b1" }, { kind: "folder", id: "f-z" }, "inside", NOW);
  for (const id of MOVED) assert.equal(moved.pages.find((page) => page.id === id).folderId, "f-z", id);
  assert.deepEqual(moved.databaseItems, input.databaseItems);
  assert.equal(moved.pages.find((page) => page.id === "p-trashed-child").trashedAt, FIXTURE_TIME);
});
