import test from "node:test";
import assert from "node:assert/strict";
import { archivePage, archivedPageIds, isPageArchived, visibleArchivePages } from "../src/domain/archive.js";
import { ownedDescendantPageIds, trashPage, restoreTrashGroup } from "../src/domain/trash.js";

const time = "2026-11-27T11:00:00.000Z";
function sample() {
  return {
    folders: [{ id: "folder", parentId: null }],
    pages: [
      { id: "owner", folderId: "folder", content: [{ type: "pageLink", props: { pageId: "linked" } }] },
      { id: "child", folderId: "folder", parentPageId: "owner", content: [{ type: "paragraph", content: "body" }] },
      { id: "record", folderId: "folder", content: [] },
      { id: "linked", folderId: "folder", content: [] },
      { id: "foreign-owner", folderId: "folder", content: [] },
      { id: "foreign-record", folderId: "folder", content: [] },
    ],
    dataSources: [{ id: "a", ownerPageId: "owner" }, { id: "b", ownerPageId: "foreign-owner" }],
    databaseItems: [{ id: "row", sourceId: "a", pageId: "record", values: { relation: ["foreign-row"] } }, { id: "foreign-row", sourceId: "b", pageId: "foreign-record", values: {} }],
    databaseViews: [{ id: "view", sourceId: "a" }], relations: [], ui: {},
  };
}

test("archive follows real ownership, preserves IDs, contents and explicit relations", () => {
  const input = sample(), before = structuredClone(input);
  const result = archivePage(input, "owner", true, time);
  assert.deepEqual(input, before);
  assert.deepEqual([...archivedPageIds(result)].sort(), ["child", "owner", "record"]);
  assert.equal(result.pages[0].archivedAt, time);
  assert.equal(result.pages[1], input.pages[1]);
  assert.equal(result.databaseItems, input.databaseItems);
  assert.equal(result.databaseViews, input.databaseViews);
  assert.equal(isPageArchived(result, "linked"), false);
  assert.equal(isPageArchived(result, "foreign-record"), false);
  assert.deepEqual([...ownedDescendantPageIds(result, ["owner"])].sort(), ["child", "record"]);
});

test("unarchive clears only the selected explicit root and keeps independent child archives", () => {
  let workspace = archivePage(sample(), "child", true, time);
  workspace = archivePage(workspace, "owner", true, time);
  workspace = archivePage(workspace, "owner", false, time);
  assert.equal(isPageArchived(workspace, "owner"), false);
  assert.equal(isPageArchived(workspace, "record"), false);
  assert.equal(isPageArchived(workspace, "child"), true);
  assert.equal(workspace.pages.find((page) => page.id === "child").archivedAt, time);
});

test("direct lookup and explicit all/archive lists retain the same original page objects", () => {
  const workspace = archivePage(sample(), "owner", true, time);
  assert.deepEqual(visibleArchivePages(workspace).map((page) => page.id), ["linked", "foreign-owner", "foreign-record"]);
  assert.equal(visibleArchivePages(workspace, { status: "all" }).length, 6);
  assert.deepEqual(visibleArchivePages(workspace, { status: "archived" }).map((page) => page.id), ["owner", "child", "record"]);
  assert.equal(visibleArchivePages(workspace, { status: "archived" })[0], workspace.pages[0]);
});

test("trash round-trip retains an explicit archive and unarchiving never restores trash", () => {
  const archived = archivePage(sample(), "child", true, time);
  const trashed = trashPage(archived, "owner", time);
  assert.equal(archivePage(trashed, "owner", false, time), trashed);
  assert.equal(visibleArchivePages(trashed, { status: "all" }).some((page) => page.id === "child"), false);
  const { workspace: restored } = restoreTrashGroup(trashed, { kind: "page", id: "owner" }, { now: time });
  assert.equal(isPageArchived(restored, "child"), true);
  assert.equal(restored.pages.find((page) => page.id === "child").content[0].content, "body");
});
