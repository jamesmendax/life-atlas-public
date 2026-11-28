import test from "node:test";
import assert from "node:assert/strict";
import { fullWorkspace } from "./fixtures/full-workspace.mjs";
import { upgradeWorkspace } from "../src/persistence/migrations.js";
import { childFolders, topLevelPages } from "../src/domain/navigation.js";
import { buildSearchDocuments, querySearch } from "../src/search/searchIndex.js";
import { formatPropertyValue, mentionLabel } from "../src/domain/databaseProperties.js";
import { projectViewItems, resolvePropertyValue } from "../src/domain/database.js";
import { restoreTrashGroup, trashFolder, trashPage } from "../src/domain/trash.js";

const NOW = "2026-10-02T08:00:00.000Z";
const workspace = () => upgradeWorkspace(fullWorkspace());

test("trashed folders and pages disappear from navigation helpers", () => {
  const trashed = trashFolder(workspace(), "f-a", NOW);
  assert.deepEqual(childFolders(trashed.folders, null).map((folder) => folder.id), ["f-z", "f-empty"]);
  assert.deepEqual(childFolders(trashed.folders, "f-a"), []);
  for (const id of ["f-a", "f-b", "f-c"]) assert.deepEqual(topLevelPages(trashed.pages, id), []);
  const restored = restoreTrashGroup(trashed, { kind: "folder", id: "f-a" }, { now: NOW }).workspace;
  assert.deepEqual(childFolders(restored.folders, "f-a").map((folder) => folder.id), ["f-b"]);
  assert.deepEqual(topLevelPages(restored.pages, "f-b").map((page) => page.id), ["p-b1"]);
});

test("search hides trashed folders, pages, records and their comments", () => {
  const trashed = trashFolder(workspace(), "f-a", NOW);
  const documents = buildSearchDocuments(trashed.folders, trashed.pages, trashed);
  for (const query of ["深层", "任务一", "记录上的评论", "B 资料"]) assert.deepEqual(querySearch(documents, query), [], query);
  for (const id of ["folder:f-a", "folder:f-b", "folder:f-c", "page:p-c1", "database_item:i-1", "comment:cm-1", "comment:cm-2", "comment:cm-3"]) assert.equal(documents.some((document) => document.id === id), false, id);
  const attachment = documents.find((document) => document.id === "attachment:att-file");
  assert.equal(attachment.pageId, null);
  assert.equal(attachment.path, "工作区附件");
});

test("rollups and relation labels ignore records in trash", () => {
  const input = workspace();
  const trashed = trashPage(input, "p-b1", NOW);
  const source = trashed.dataSources.find((entry) => entry.id === "ds-full");
  const count = source.properties.find((property) => property.id === "task-count");
  const relation = source.properties.find((property) => property.id === "rel-back");
  for (const id of ["i-3", "i-4"]) {
    const item = trashed.databaseItems.find((entry) => entry.id === id);
    assert.equal(resolvePropertyValue(trashed, source, item, count), 0);
    assert.equal(formatPropertyValue(trashed, relation, item.values[relation.id]), "");
  }
  assert.deepEqual(trashed.databaseItems.find((item) => item.id === "i-3").values["rel-back"], ["i-1", "i-2"]);
  const restored = restoreTrashGroup(trashed, { kind: "page", id: "p-b1" }, { now: NOW }).workspace;
  assert.equal(resolvePropertyValue(restored, source, restored.databaseItems.find((item) => item.id === "i-3"), count), 2);
  assert.equal(resolvePropertyValue(restored, source, restored.databaseItems.find((item) => item.id === "i-4"), count), 1);
  assert.equal(formatPropertyValue(restored, relation, restored.databaseItems.find((item) => item.id === "i-3").values[relation.id]), "任务一, 任务二");
});

test("views hide records whose page is in trash", () => {
  const trashed = trashPage(workspace(), "p-b1", NOW);
  const view = trashed.databaseViews.find((entry) => entry.id === "v-inline-table");
  assert.deepEqual(projectViewItems(trashed, view), []);
  const restored = restoreTrashGroup(trashed, { kind: "page", id: "p-b1" }, { now: NOW }).workspace;
  assert.deepEqual(projectViewItems(restored, view).map((item) => item.id), ["i-1", "i-2"]);
});

test("mentions show trashed and deleted states", () => {
  const trashed = trashPage(workspace(), "p-b1", NOW);
  assert.equal(mentionLabel({ type: "pageMention", props: { pageId: "p-b1", labelSnapshot: "old" } }, trashed), "B 笔记（在回收站）");
  assert.equal(mentionLabel({ type: "pageMention", props: { pageId: "missing", labelSnapshot: "old" } }, trashed), "已删除的页面");
});

test("search excludes records and comments whose pages or discussions are missing", () => {
  const input = workspace();
  input.pages = input.pages.filter((page) => !["p-c1", "p-rec-1"].includes(page.id));
  input.comments.push({ ...input.comments[0], id: "cm-orphan", discussionId: "missing" });
  const documents = buildSearchDocuments(input.folders, input.pages, input);
  for (const id of ["database_item:i-1", "comment:cm-1", "comment:cm-2", "comment:cm-3", "comment:cm-orphan"]) assert.equal(documents.some((document) => document.id === id), false, id);
});
