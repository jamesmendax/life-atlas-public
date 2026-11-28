import test from "node:test";
import assert from "node:assert/strict";
import { fullWorkspace } from "./fixtures/full-workspace.mjs";
import { upgradeWorkspace } from "../src/persistence/migrations.js";
import { checkWorkspaceIntegrity } from "../src/domain/integrity.js";
import { deleteTrashGroupPermanently, trashFolder } from "../src/domain/trash.js";

const workspace = () => upgradeWorkspace(fullWorkspace());

test("fixture baseline is ok with one unreferenced attachment", () => {
  const input = workspace();
  const before = structuredClone(input);
  const result = checkWorkspaceIntegrity(input);
  assert.equal(result.ok, true);
  assert.equal(result.problems.length, 1);
  assert.deepEqual(result.problems.map(({ severity, code, collection, id }) => ({ severity, code, collection, id })), [{ severity: "info", code: "ATTACHMENT_UNREFERENCED", collection: "attachments", id: "att-orphan" }]);
  assert.deepEqual(input, before);
});

test("every error code is detected", () => {
  const mutations = {
    FOLDER_PARENT_MISSING: (input) => { input.folders[0].parentId = "missing"; },
    FOLDER_CYCLE: (input) => { input.folders[0].parentId = "f-c"; },
    PAGE_FOLDER_MISSING: (input) => { input.pages[0].folderId = "missing"; },
    PAGE_PARENT_MISSING: (input) => { input.pages[0].parentPageId = "missing"; },
    SOURCE_OWNER_MISSING: (input) => { input.dataSources[0].ownerPageId = "missing"; },
    ITEM_SOURCE_MISSING: (input) => { input.databaseItems[0].sourceId = "missing"; },
    ITEM_PAGE_MISSING: (input) => { input.databaseItems[0].pageId = "missing"; },
    VIEW_SOURCE_MISSING: (input) => { input.databaseViews[0].sourceId = "missing"; },
    RELATION_SOURCE_MISSING: (input) => { input.relations[0].targetSourceId = "missing"; },
    RELATION_PROPERTY_TARGET_MISSING: (input) => { input.dataSources[0].properties.find((property) => property.id === "rel-to-full").config.targetSourceId = "missing"; },
    RELATION_VALUE_MISSING: (input) => { input.databaseItems[0].values["rel-to-full"] = ["missing"]; },
    FILES_VALUE_MISSING: (input) => { input.databaseItems[0].values.files = ["missing"]; },
    PEOPLE_VALUE_MISSING: (input) => { input.databaseItems[0].values.owner = ["missing"]; },
    DISCUSSION_PAGE_MISSING: (input) => { input.discussions[0].pageId = "missing"; },
    COMMENT_DISCUSSION_MISSING: (input) => { input.comments[0].discussionId = "missing"; },
    SYNCED_SOURCE_MISSING: (input) => { input.pages.find((page) => page.id === "p-b1").content.push({ id: "bad-sync", type: "syncedBlock", props: { sourceId: "missing" } }); },
    DATABASE_TEMPLATE_SOURCE_MISSING: (input) => { input.databaseTemplates[0].sourceId = "missing"; },
    TRASH_GROUP_ROOT_MISSING: (input) => { input.pages[0].trashedByFolderId = "missing"; },
  };
  assert.equal(Object.keys(mutations).length, 18);
  for (const [code, mutate] of Object.entries(mutations)) {
    const input = workspace();
    mutate(input);
    const before = structuredClone(input);
    const result = checkWorkspaceIntegrity(input);
    assert.equal(result.ok, false, code);
    const problem = result.problems.find((entry) => entry.code === code && entry.severity === "error");
    assert.ok(problem, code);
    assert.equal(typeof problem.collection, "string");
    assert.equal(typeof problem.id, "string");
    assert.ok(problem.detail.length > 0);
    assert.deepEqual(input, before, code);
  }
});

test("after permanent delete only info problems remain", () => {
  const deleted = deleteTrashGroupPermanently(trashFolder(workspace(), "f-a", "2026-10-02T08:00:00.000Z"), { kind: "folder", id: "f-a" });
  const result = checkWorkspaceIntegrity(deleted);
  assert.equal(result.ok, true);
  assert.ok(result.problems.every((problem) => problem.severity === "info"));
  for (const [code, id] of [["TRASHED_PAGE_FOLDER_MISSING", "p-b-solo"], ["DATABASE_BLOCK_TARGET_MISSING", "p-z1"], ["PAGE_MENTION_TARGET_MISSING", "p-z1"]]) assert.ok(result.problems.some((problem) => problem.code === code && problem.id === id), code);
});

test("integrity visits nested blocks and inline references in pages, templates and synced sources", () => {
  const input = workspace();
  input.pageTemplates[0].content.push({ id: "container", type: "column", children: [{ id: "nested-link", type: "subPage", props: { pageId: "missing" } }, { id: "nested-sync", type: "syncedBlock", props: { sourceId: "missing" } }] });
  input.databaseTemplates[0].pageContent.push({ id: "table", type: "table", content: { type: "tableContent", rows: [{ cells: [[{ type: "pageMention", props: { pageId: "missing" } }]] }] } });
  input.syncedSources[0].blocks.push({ id: "synced-link", type: "pageLink", props: { pageId: "missing" } });
  const result = checkWorkspaceIntegrity(input);
  assert.equal(result.ok, false);
  for (const [code, collection] of [["PAGE_LINK_TARGET_MISSING", "pageTemplates"], ["SYNCED_SOURCE_MISSING", "pageTemplates"], ["PAGE_MENTION_TARGET_MISSING", "databaseTemplates"], ["PAGE_LINK_TARGET_MISSING", "syncedSources"]]) assert.ok(result.problems.some((problem) => problem.code === code && problem.collection === collection), `${code}/${collection}`);
});
