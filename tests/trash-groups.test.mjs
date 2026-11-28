import test from "node:test";
import assert from "node:assert/strict";
import { fullWorkspace, FIXTURE_TIME, SOLO_TRASHED_AT } from "./fixtures/full-workspace.mjs";
import { expectedV20BlockDeclarations } from "./fixtures/schema-v20-expectations.mjs";
import { migrateTrashGroups, upgradeWorkspace } from "../src/persistence/migrations.js";
import {
  attachmentReferences, deleteTrashGroupPermanently, emptyTrash, listTrashGroups, ownedDescendantPageIds,
  pageAvailability, permanentlyDelete, purgeExpiredTrashGroups, restoreTrashGroup, syncedSourceReferences,
  trashFolder, trashGroupMembers, trashPage,
} from "../src/domain/trash.js";

const NOW = "2026-10-02T08:00:00.000Z";
const DAY = 86400000;
const workspace = () => migrateTrashGroups(fullWorkspace());
const restoreOptions = { now: "2026-10-03T08:00:00.000Z", idFactory: (prefix) => `${prefix}-new` };
const entityIds = (input, collection) => input[collection].map((entity) => entity.id);

function comparableEntities(input) {
  return Object.fromEntries(Object.entries(input).filter(([, entities]) => Array.isArray(entities)).map(([key, entities]) => [key, entities.map((entity) => {
    const comparable = structuredClone(entity);
    for (const field of ["trashedAt", "trashedByFolderId", "trashedByPageId", "updatedAt"]) delete comparable[field];
    return comparable;
  })]));
}

test("trashFolder marks the whole subtree and keeps the solo page as its own root", () => {
  const input = workspace();
  const before = structuredClone(input);
  const trashed = trashFolder(input, "f-a", NOW);
  assert.equal(trashed.folders.find((folder) => folder.id === "f-a").trashedByFolderId, null);
  for (const id of ["f-b", "f-c"]) assert.equal(trashed.folders.find((folder) => folder.id === id).trashedByFolderId, "f-a");
  for (const id of ["p-a1", "p-a1-child", "p-b1", "p-c1", "p-rec-1", "p-rec-2"]) {
    const page = trashed.pages.find((entry) => entry.id === id);
    assert.equal(page.trashedAt, NOW);
    assert.equal(page.updatedAt, NOW);
    assert.equal(page.trashedByFolderId, "f-a");
    assert.equal(page.trashedByPageId, null);
  }
  const solo = trashed.pages.find((page) => page.id === "p-b-solo");
  assert.equal(solo.trashedAt, SOLO_TRASHED_AT);
  assert.equal(solo.trashedByFolderId, null);
  assert.equal(solo.trashedByPageId, null);
  for (const id of ["p-z1", "p-db", "p-rec-3", "p-rec-4"]) assert.equal(trashed.pages.find((page) => page.id === id).trashedAt, null);
  assert.equal(trashed.folders.find((folder) => folder.id === "f-a").lastOpenedPageId, null);
  assert.equal(trashed.ui.selectedPageId, null);
  assert.equal(trashed.ui.selectedFolderId, null);
  assert.deepEqual(input, before);
});

test("listTrashGroups shows one row per group with counts", () => {
  const trashed = trashFolder(workspace(), "f-a", NOW);
  const fields = ["kind", "id", "name", "path", "folderCount", "pageCount", "daysRemaining"];
  const groups = listTrashGroups(trashed, NOW).map((group) => Object.fromEntries(fields.map((field) => [field, group[field]])));
  assert.deepEqual(groups, [
    { kind: "folder", id: "f-a", name: "A 项目", path: "Private", folderCount: 3, pageCount: 6, daysRemaining: 30 },
    { kind: "page", id: "p-b-solo", name: "B 单独删除的页", path: "Private / A 项目 / B 资料", folderCount: 0, pageCount: 1, daysRemaining: 27 },
  ]);
  assert.deepEqual(trashGroupMembers(trashed, { kind: "folder", id: "f-a" }), { folderIds: ["f-a", "f-b", "f-c"], pageIds: ["p-a1", "p-a1-child", "p-b1", "p-c1", "p-rec-1", "p-rec-2"] });
});

test("restoring the folder group returns every member unchanged", () => {
  const input = workspace();
  const trashed = trashFolder(input, "f-a", NOW);
  const before = structuredClone(trashed);
  const restored = restoreTrashGroup(trashed, { kind: "folder", id: "f-a" }, restoreOptions);
  assert.deepEqual(comparableEntities(restored.workspace), comparableEntities(input));
  assert.equal(restored.workspace.pages.find((page) => page.id === "p-b-solo").trashedAt, SOLO_TRASHED_AT);
  assert.deepEqual(restored.restored, { kind: "folder", id: "f-a", folderId: "f-a" });
  assert.equal(restored.workspace.ui.selectedFolderId, "f-a");
  assert.equal(restored.workspace.ui.selectedPageId, null);
  assert.equal(restored.workspace.ui.trashRestoreState, undefined);
  assert.deepEqual(trashed, before);
});

test("trashPage takes owned record pages along", () => {
  const input = workspace();
  const trashed = trashPage(input, "p-b1", NOW);
  for (const id of ["p-rec-1", "p-rec-2"]) assert.equal(trashed.pages.find((page) => page.id === id).trashedByPageId, "p-b1");
  const restored = restoreTrashGroup(trashed, { kind: "page", id: "p-b1" }, restoreOptions);
  assert.deepEqual(comparableEntities(restored.workspace), comparableEntities(input));
  assert.deepEqual(restored.restored, { kind: "page", id: "p-b1", folderId: "f-b" });
  assert.equal(restored.workspace.ui.selectedPageId, "p-b1");
});

test("trashPage takes child pages along", () => {
  const trashed = trashPage(workspace(), "p-a1", NOW);
  assert.equal(trashed.pages.find((page) => page.id === "p-a1-child").trashedByPageId, "p-a1");
  assert.deepEqual(trashGroupMembers(trashed, { kind: "page", id: "p-a1" }).pageIds, ["p-a1", "p-a1-child"]);
});

test("restoring a page whose folder is gone falls back to the first top-level folder", () => {
  const deleted = deleteTrashGroupPermanently(trashFolder(workspace(), "f-a", NOW), { kind: "folder", id: "f-a" });
  const restored = restoreTrashGroup(deleted, { kind: "page", id: "p-b-solo" }, restoreOptions);
  assert.equal(restored.workspace.pages.find((page) => page.id === "p-b-solo").folderId, "f-z");
  assert.deepEqual(restored.restored, { kind: "page", id: "p-b-solo", folderId: "f-z" });
});

test("restoring creates a folder when no top-level folder is left", () => {
  const input = workspace();
  input.folders = [input.folders[0]];
  input.pages = [{ ...input.pages[0], content: [] }];
  for (const collection of ["dataSources", "databaseItems", "databaseViews", "relations", "syncedSources", "attachments", "pageTemplates", "databaseTemplates", "discussions", "comments"]) input[collection] = [];
  const pageInTrash = trashPage(input, "p-a1", NOW);
  const deleted = deleteTrashGroupPermanently(trashFolder(pageInTrash, "f-a", NOW), { kind: "folder", id: "f-a" });
  assert.equal(deleted.folders.length, 0);
  assert.equal(deleted.pages.length, 1);
  const calls = [];
  const restored = restoreTrashGroup(deleted, { kind: "page", id: "p-a1" }, { now: NOW, idFactory: (prefix) => { calls.push(prefix); return `${prefix}-new`; } });
  assert.deepEqual(calls, ["folder"]);
  assert.equal(restored.workspace.folders[0].name, "我的空间");
  assert.equal(restored.workspace.folders[0].id, "folder-new");
  assert.equal(restored.workspace.pages[0].folderId, "folder-new");
  assert.equal(restored.workspace.pages[0].trashedAt, null);
});

test("restoring a child page whose parent is still in trash makes it a top-level page", () => {
  const childInTrash = trashPage(workspace(), "p-a1-child", NOW);
  const parentInTrash = trashPage(childInTrash, "p-a1", NOW);
  const restored = restoreTrashGroup(parentInTrash, { kind: "page", id: "p-a1-child" }, restoreOptions);
  const child = restored.workspace.pages.find((page) => page.id === "p-a1-child");
  assert.equal(child.parentPageId, null);
  assert.equal(child.folderId, "f-a");
  assert.equal(restored.workspace.pages.find((page) => page.id === "p-a1").trashedAt, NOW);
});

test("permanent delete of the folder group cleans every dependent record", () => {
  const input = workspace();
  const trashed = trashFolder(input, "f-a", NOW);
  const before = structuredClone(trashed);
  const deleted = deleteTrashGroupPermanently(trashed, { kind: "folder", id: "f-a" });
  const expected = {
    folders: ["f-z", "f-empty"], pages: ["p-b-solo", "p-z1", "p-db", "p-rec-3", "p-rec-4"], dataSources: ["ds-full"],
    databaseItems: ["i-3", "i-4"], databaseViews: ["v-full-table"], relations: [], syncedSources: ["sync-shared"],
    attachments: ["att-orphan"], pageTemplates: ["tpl-1"], databaseTemplates: [], discussions: [], comments: [],
  };
  for (const [collection, ids] of Object.entries(expected)) assert.deepEqual(entityIds(deleted, collection), ids, collection);
  assert.equal(deleted.dataSources[0].properties.find((property) => property.id === "rel-back").config.targetSourceId, null);
  for (const item of deleted.databaseItems) assert.deepEqual(item.values["rel-back"], []);
  assert.equal(deleted.ui.selectedPageId, null);
  assert.equal(deleted.ui.selectedFolderId, null);
  assert.deepEqual(deleted.ui.expandedFolderIds, []);
  assert.equal(deleted.ui.trashRestoreState, undefined);
  assert.equal(deleted.pages.find((page) => page.id === "p-b-solo").folderId, "f-b");
  assert.deepEqual(deleted.pages.find((page) => page.id === "p-z1").content, input.pages.find((page) => page.id === "p-z1").content);
  assert.deepEqual(trashed, before);
});

test("permanently deleting one page group removes nested owned data and preserves unrelated records", () => {
  const input = workspace();
  const parent = input.pages.find((page) => page.id === "p-b1");
  input.pages.push(
    { ...structuredClone(parent), id: "p-child", parentPageId: parent.id, content: [{ id: "child-text", type: "paragraph", content: "子页正文" }] },
    { ...structuredClone(parent), id: "p-nested-record", folderId: "f-z", databaseSourceId: "ds-nested", content: [] },
    { ...structuredClone(parent), id: "p-nested-child", folderId: "f-z", parentPageId: "p-nested-record", content: [] },
  );
  input.dataSources.push({ ...structuredClone(input.dataSources[0]), id: "ds-nested", ownerPageId: "p-rec-1" });
  input.databaseItems.push({ ...structuredClone(input.databaseItems[0]), id: "i-nested", sourceId: "ds-nested", pageId: "p-nested-record" });
  input.databaseViews.push({ ...structuredClone(input.databaseViews[0]), id: "v-nested", sourceId: "ds-nested" });

  const trashed = trashPage(input, parent.id, NOW);
  const before = structuredClone(trashed);
  const deleted = deleteTrashGroupPermanently(trashed, { kind: "page", id: parent.id });
  for (const id of ["p-b1", "p-child", "p-rec-1", "p-rec-2", "p-nested-record", "p-nested-child"]) {
    assert.equal(deleted.pages.some((page) => page.id === id), false, id);
  }
  for (const [collection, removed] of Object.entries({
    dataSources: ["ds-inline", "ds-nested"],
    databaseItems: ["i-1", "i-2", "i-nested"],
    databaseViews: ["v-inline-table", "v-inline-board", "v-inline-linked", "v-nested"],
    databaseTemplates: ["dbt-1"], relations: ["r-inline-full", "r-full-inline"],
    discussions: ["disc-rec1"], comments: ["cm-3"],
  })) {
    for (const id of removed) assert.equal(deleted[collection].some((entity) => entity.id === id), false, `${collection}:${id}`);
  }
  for (const [collection, ids] of Object.entries({
    folders: ["f-a", "f-b", "f-c", "f-z", "f-empty"],
    pages: ["p-a1", "p-a1-child", "p-b-solo", "p-c1", "p-z1", "p-db", "p-rec-3", "p-rec-4"],
    dataSources: ["ds-full"], databaseItems: ["i-3", "i-4"], databaseViews: ["v-full-table"],
    discussions: ["disc-c1"], comments: ["cm-1", "cm-2"],
  })) assert.deepEqual(entityIds(deleted, collection), ids, collection);
  assert.deepEqual(deleted.pages.find((page) => page.id === "p-z1"), before.pages.find((page) => page.id === "p-z1"));
  assert.equal(deleted.dataSources.find((source) => source.id === "ds-full").properties.find((property) => property.id === "rel-back").config.targetSourceId, null);
  for (const item of deleted.databaseItems) {
    assert.deepEqual(item.values["rel-back"], []);
    assert.equal(item.values.score, before.databaseItems.find((entry) => entry.id === item.id).values.score);
  }
  assert.deepEqual(entityIds(deleted, "syncedSources"), ["sync-shared"]);
  assert.deepEqual(entityIds(deleted, "attachments"), ["att-orphan"]);
  assert.deepEqual(trashed, before);
});

test("permanent delete keeps pre-existing orphans", () => {
  const input = workspace();
  input.syncedSources.push({ id: "sync-orphan", blocks: [], revision: 0, createdAt: FIXTURE_TIME, updatedAt: FIXTURE_TIME });
  const deleted = deleteTrashGroupPermanently(trashFolder(input, "f-a", NOW), { kind: "folder", id: "f-a" });
  assert.ok(entityIds(deleted, "attachments").includes("att-orphan"));
  assert.ok(entityIds(deleted, "syncedSources").includes("sync-orphan"));
  const anotherDeletion = permanentlyDelete(deleted, { pageIds: ["p-rec-3"] });
  assert.ok(entityIds(anotherDeletion, "syncedSources").includes("sync-orphan"));
});

test("purge removes groups after 30 days and keeps younger ones", () => {
  const trashed = trashFolder(workspace(), "f-a", NOW);
  const day29 = purgeExpiredTrashGroups(trashed, Date.parse(NOW) + 29 * DAY);
  assert.deepEqual(listTrashGroups(day29, Date.parse(NOW) + 29 * DAY).map((group) => group.id), ["f-a"]);
  assert.equal(day29.pages.some((page) => page.id === "p-b-solo"), false);
  assert.equal(day29.folders.find((folder) => folder.id === "f-a").trashedAt, NOW);
  const day31 = purgeExpiredTrashGroups(trashed, Date.parse(NOW) + 31 * DAY);
  assert.deepEqual(listTrashGroups(day31, Date.parse(NOW) + 31 * DAY), []);
  for (const id of ["p-a1", "p-a1-child", "p-b1", "p-b-solo", "p-c1", "p-rec-1", "p-rec-2"]) assert.equal(day31.pages.some((page) => page.id === id), false);
  assert.deepEqual(entityIds(day31, "folders"), ["f-z", "f-empty"]);
  assert.equal(purgeExpiredTrashGroups(trashed, "invalid-time"), trashed);
});

test("emptyTrash deletes every group", () => {
  const deleted = emptyTrash(trashFolder(workspace(), "f-a", NOW));
  assert.deepEqual(listTrashGroups(deleted, NOW), []);
  assert.deepEqual(entityIds(deleted, "pages"), ["p-z1", "p-db", "p-rec-3", "p-rec-4"]);
  assert.deepEqual(entityIds(deleted, "folders"), ["f-z", "f-empty"]);
  assert.equal(deleted.ui.trashRestoreState, undefined);
});

test("pageAvailability reports ok, trashed and missing", () => {
  const input = workspace();
  assert.equal(pageAvailability(input, "p-a1"), "ok");
  assert.equal(pageAvailability(input, "p-b-solo"), "trashed");
  assert.equal(pageAvailability(input, "missing"), "missing");
});

test("ownership closure spans nested pages and databases but not relation targets", () => {
  const input = workspace();
  input.pages.find((page) => page.id === "p-rec-1").folderId = "f-z";
  input.dataSources.push({ ...input.dataSources[0], id: "ds-nested", ownerPageId: "p-rec-1" });
  input.databaseItems.push({ ...input.databaseItems[0], id: "i-nested", sourceId: "ds-nested", pageId: "p-nested" });
  input.pages.push({ ...input.pages[0], id: "p-nested", folderId: "f-z", databaseSourceId: "ds-nested" }, { ...input.pages[0], id: "p-nested-child", folderId: "f-z", parentPageId: "p-nested" });
  assert.deepEqual([...ownedDescendantPageIds(input, ["p-b1"])].sort(), ["p-nested", "p-nested-child", "p-rec-1", "p-rec-2"]);
  const trashed = trashFolder(input, "f-a", NOW);
  for (const id of ["p-nested", "p-nested-child", "p-rec-1"]) assert.equal(trashed.pages.find((page) => page.id === id).trashedByFolderId, "f-a");
  assert.equal(trashed.pages.find((page) => page.id === "p-rec-3").trashedAt, null);
});

test("folder restore navigation pointers survive a JSON reload roundtrip", () => {
  const input = workspace();
  const persisted = JSON.parse(JSON.stringify(trashFolder(input, "f-a", NOW)));
  assert.deepEqual(persisted.ui.trashRestoreState, { "folder:f-a": { "f-a": "p-a1" } });
  const restored = restoreTrashGroup(persisted, { kind: "folder", id: "f-a" }, restoreOptions).workspace;
  assert.deepEqual(comparableEntities(restored), comparableEntities(input));
  assert.equal(restored.ui.trashRestoreState, undefined);
});

test("restore never replaces an intervening live folder selection", () => {
  const input = workspace();
  input.folders.find((folder) => folder.id === "f-z").lastOpenedPageId = "p-b1";
  const trashed = trashPage(input, "p-b1", NOW);
  const intervening = { ...trashed, folders: trashed.folders.map((folder) => folder.id === "f-z" ? { ...folder, lastOpenedPageId: "p-z1" } : folder) };
  const restored = restoreTrashGroup(intervening, { kind: "page", id: "p-b1" }, restoreOptions).workspace;
  assert.equal(restored.folders.find((folder) => folder.id === "f-z").lastOpenedPageId, "p-z1");
  assert.equal(restored.ui.trashRestoreState, undefined);
});

test("restore only reinstates pointers to valid live children and cleans deleted descendant metadata", () => {
  const input = workspace();
  input.folders.find((folder) => folder.id === "f-b").lastOpenedPageId = "p-b1";
  const trashed = trashFolder(input, "f-a", NOW);
  const partial = permanentlyDelete(trashed, { pageIds: ["p-b1", "p-rec-1", "p-rec-2"] });
  assert.deepEqual(partial.ui.trashRestoreState, { "folder:f-a": { "f-a": "p-a1" } });
  const restored = restoreTrashGroup(partial, { kind: "folder", id: "f-a" }, restoreOptions).workspace;
  assert.equal(restored.folders.find((folder) => folder.id === "f-a").lastOpenedPageId, "p-a1");
  assert.equal(restored.folders.find((folder) => folder.id === "f-b").lastOpenedPageId, null);
  assert.equal(restored.ui.trashRestoreState, undefined);
});

test("templates and other synced sources retain shared references during permanent delete", () => {
  const input = workspace();
  input.pageTemplates[0].content.push({ id: "keep-sync", type: "syncedBlock", props: { sourceId: "sync-only-b1" } }, { id: "keep-image", type: "image", props: { url: "blob:test#life-attachment=att-img" } });
  input.syncedSources.push({ id: "sync-orphan", blocks: [{ id: "keep-file", type: "file", props: { attachmentId: "att-file" } }], revision: 0 });
  assert.deepEqual([...syncedSourceReferences(input)].sort(), ["sync-only-b1", "sync-shared"]);
  assert.deepEqual([...attachmentReferences(input)].sort(), ["att-file", "att-img"]);
  const deleted = deleteTrashGroupPermanently(trashFolder(input, "f-a", NOW), { kind: "folder", id: "f-a" });
  assert.deepEqual(entityIds(deleted, "syncedSources"), ["sync-shared", "sync-only-b1", "sync-orphan"]);
  assert.deepEqual(entityIds(deleted, "attachments"), ["att-img", "att-file", "att-orphan"]);
});

test("restoring a folder whose parent is unavailable moves it to top level", () => {
  const trashed = trashFolder(workspace(), "f-b", NOW);
  const withoutParent = { ...trashed, folders: trashed.folders.filter((folder) => folder.id !== "f-a") };
  const restored = restoreTrashGroup(withoutParent, { kind: "folder", id: "f-b" }, restoreOptions).workspace;
  assert.equal(restored.folders.find((folder) => folder.id === "f-b").parentId, null);
  assert.equal(restored.folders.find((folder) => folder.id === "f-c").parentId, "f-b");
});

test("current schema restore skips the system inbox when the original folder is missing", () => {
  const upgraded = upgradeWorkspace(fullWorkspace());
  const input = {
    schemaVersion: upgraded.schemaVersion,
    folders: upgraded.folders.filter((folder) => folder.id === "f-z" || folder.system === "inbox"),
    pages: upgraded.pages.filter((page) => page.id === "p-b-solo"),
  };
  const before = structuredClone(input);
  const restored = restoreTrashGroup(input, { kind: "page", id: "p-b-solo" }, restoreOptions);
  assert.deepEqual(restored.restored, { kind: "page", id: "p-b-solo", folderId: "f-z" });
  assert.equal(restored.workspace.pages[0].folderId, "f-z");
  assert.deepEqual(restored.workspace.pages[0].content, before.pages[0].content);
  assert.deepEqual(restored.workspace.folders, before.folders);
  assert.deepEqual(input, before);
});

test("current schema orphan restore after permanent folder deletion chooses an ordinary folder", () => {
  const input = upgradeWorkspace(fullWorkspace());
  const deleted = deleteTrashGroupPermanently(trashFolder(input, "f-a", NOW), { kind: "folder", id: "f-a" });
  const before = structuredClone(deleted);
  const restored = restoreTrashGroup(deleted, { kind: "page", id: "p-b-solo" }, restoreOptions);
  assert.deepEqual(restored.restored, { kind: "page", id: "p-b-solo", folderId: "f-z" });
  const page = restored.workspace.pages.find((entry) => entry.id === "p-b-solo");
  assert.equal(page.folderId, "f-z");
  assert.deepEqual(page.content, before.pages.find((entry) => entry.id === page.id).content);
  assert.deepEqual(restored.workspace.folders, before.folders);
  assert.deepEqual(deleted, before);
});

test("current schema restore creates an ordinary folder when only the system inbox remains", () => {
  const upgraded = upgradeWorkspace(fullWorkspace());
  const input = {
    schemaVersion: upgraded.schemaVersion,
    folders: upgraded.folders.filter((folder) => folder.system === "inbox"),
    pages: upgraded.pages.filter((page) => page.id === "p-b-solo"),
  };
  const before = structuredClone(input);
  const calls = [];
  const restored = restoreTrashGroup(input, { kind: "page", id: "p-b-solo" }, {
    now: NOW,
    idFactory: (prefix) => { calls.push(prefix); return `${prefix}-new`; },
  });
  assert.deepEqual(calls, ["folder"]);
  assert.deepEqual(restored.restored, { kind: "page", id: "p-b-solo", folderId: "folder-new" });
  assert.deepEqual(entityIds(restored.workspace, "folders"), ["system-inbox", "folder-new"]);
  assert.deepEqual(restored.workspace.folders[0], before.folders[0]);
  assert.equal(restored.workspace.folders[1].name, "我的空间");
  assert.equal(restored.workspace.folders[1].system, undefined);
  assert.equal(restored.workspace.pages[0].folderId, "folder-new");
  assert.equal(restored.workspace.pages[0].trashedAt, null);
  assert.deepEqual(restored.workspace.pages[0].content, before.pages[0].content);
  assert.deepEqual(input, before);
});

test("current schema restore keeps a page in its original live inbox", () => {
  const input = upgradeWorkspace(fullWorkspace());
  const page = input.pages.find((entry) => entry.id === "p-z1");
  page.folderId = "system-inbox";
  page.inboxedAt = NOW;
  const trashed = trashPage(input, page.id, NOW);
  const before = structuredClone(trashed);
  const restored = restoreTrashGroup(trashed, { kind: "page", id: page.id }, restoreOptions);
  assert.deepEqual(restored.restored, { kind: "page", id: page.id, folderId: "system-inbox" });
  assert.equal(restored.workspace.pages.find((entry) => entry.id === page.id).inboxedAt, NOW);
  assert.deepEqual(comparableEntities(restored.workspace), comparableEntities(input));
  assert.deepEqual(restored.workspace.folders.find((folder) => folder.system === "inbox"), input.folders.find((folder) => folder.system === "inbox"));
  assert.deepEqual(trashed, before);
});

for (const [name, operation] of [
  ["permanent deletion", (input) => deleteTrashGroupPermanently(input, { kind: "folder", id: "f-a" })],
  ["expiry purge", (input) => purgeExpiredTrashGroups(input, Date.parse(NOW) + 31 * DAY)],
  ["empty trash", emptyTrash],
]) {
  test(`current schema ${name} preserves the system inbox and legacy survivor identities`, () => {
    const input = upgradeWorkspace(fullWorkspace());
    const trashed = trashFolder(input, "f-a", NOW);
    const before = structuredClone(trashed);
    const legacy = operation(trashFolder(migrateTrashGroups(fullWorkspace()), "f-a", NOW));
    const result = operation(trashed);
    assert.deepEqual(result.folders.filter((folder) => folder.system), input.folders.filter((folder) => folder.system));
    for (const [collection, entities] of Object.entries(legacy)) {
      if (!Array.isArray(entities)) continue;
      const survivors = collection === "folders" ? result.folders.filter((folder) => !folder.system) : result[collection];
      assert.deepEqual(survivors.map((entity) => entity.id), entityIds(legacy, collection), collection);
    }
    for (const page of result.pages) {
      const legacyPage = legacy.pages.find((entry) => entry.id === page.id);
      assert.deepEqual(page.content, expectedV20BlockDeclarations(legacyPage.content), page.id);
    }
    assert.deepEqual(trashed, before);
  });
}
