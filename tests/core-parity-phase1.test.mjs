import test from "node:test";
import assert from "node:assert/strict";
import { legacyWorkspace } from "./fixtures/workspace-v6-parity.mjs";
import { migratePhase1 } from "../src/persistence/migrations.js";
import { walkBlocks, cloneBlockDocument, createTabsDocument, changeTab } from "../src/domain/blockDocument.js";
import { normalizePropertyValue, formatPropertyValue, mentionLabel } from "../src/domain/databaseProperties.js";
import { createSyncedContentStore } from "../src/domain/syncedContent.js";
import { DATABASE_VIEW_TYPES, DATABASE_PROPERTY_TYPES, createDatabaseView, createLinkedView, projectViewItems } from "../src/domain/database.js";
import { createBrowserWorkspaceRepository, workspaceStorageKey } from "../src/persistence/workspaceRepository.js";

const find = (blocks, id) => walkBlocks(blocks).find((block) => block.id === id);

test("v6 migration is deterministic, idempotent, non-mutating and preserves unknown fields and Columns", () => {
  const input = legacyWorkspace();
  const snapshot = structuredClone(input);
  const migrated = migratePhase1(input);
  assert.deepEqual(input, snapshot);
  assert.deepEqual(migratePhase1(input), migrated);
  assert.deepEqual(migratePhase1(migrated), migrated);
  assert.equal(migrated.schemaVersion, 7);
  assert.deepEqual(migrated.customWorkspaceMetadata, { preserve: true });
  assert.equal(migrated.pages[0].customPageMetadata, "keep");
  assert.equal(migrated.ui.customUi, "keep");
  const columns = find(migrated.pages[0].content, "columns");
  assert.deepEqual(columns.children.map((column) => column.props.width), [60, 40]);
  assert.equal(migrated.databaseItems.length, input.databaseItems.length);
  assert.equal(migrated.databaseItems[0].pageId, "record-page");
  assert.deepEqual(migrated.databaseItems[0].values.futureProperty, { preserve: true });
  assert.equal(migrated.pages[0].iconColor, "#aabbcc");
});

test("legacy Tabs become stable nested panels and active index maps to real panel", () => {
  const tabs = find(migratePhase1(legacyWorkspace()).pages[0].content, "tabs");
  assert.equal(tabs.children.length, 3);
  assert.deepEqual(tabs.children.map((panel) => panel.props.label), ["Overview", "Notes", "Files"]);
  assert.equal(tabs.props.activeTabId, tabs.children[1].props.tabId);
  assert.equal(tabs.children[0].children[0].type, "paragraph");
  assert.ok(!("tabs" in tabs.props));
});

test("Tabs domain supports add rename reorder delete and fresh-ID deep copy without losing mixed children", () => {
  let tabs = createTabsDocument(["A", "B", "C"]);
  tabs.children[1].children = [{ id: "check", type: "checkListItem", props: { checked: true }, content: "task" }];
  const active = tabs.children[1].props.tabId;
  tabs = changeTab(tabs, { type: "activate", tabId: active });
  tabs = changeTab(tabs, { type: "rename", tabId: active, label: "Renamed" });
  tabs = changeTab(tabs, { type: "move", tabId: active, offset: -1 });
  assert.equal(tabs.children[0].props.label, "Renamed");
  assert.equal(tabs.children[0].children[0].content, "task");
  const copy = cloneBlockDocument([tabs])[0];
  assert.notEqual(copy.id, tabs.id);
  assert.notEqual(copy.props.activeTabId, tabs.props.activeTabId);
  assert.equal(copy.children[0].children[0].props.checked, true);
  const beforeIds = new Set(walkBlocks([tabs]).map((block) => block.id));
  assert.ok(walkBlocks([copy]).every((block) => !beforeIds.has(block.id)));
  tabs = changeTab(tabs, { type: "delete", tabId: active });
  assert.ok(tabs.children.some((panel) => panel.props.tabId === tabs.props.activeTabId));
  while (tabs.children.length > 1) tabs = changeTab(tabs, { type: "delete", tabId: tabs.children[0].props.tabId });
  tabs = changeTab(tabs, { type: "delete", tabId: tabs.children[0].props.tabId });
  assert.equal(tabs.children.length, 1);
});

test("migration shares identical legacy sync payloads but preserves divergent payloads", () => {
  const result = migratePhase1(legacyWorkspace());
  const blocks = result.pages[0].content;
  const a = find(blocks, "sync-a"), b = find(blocks, "sync-b"), conflict = find(blocks, "sync-conflict");
  assert.equal(a.props.sourceId, b.props.sourceId);
  assert.notEqual(a.props.sourceId, conflict.props.sourceId);
  assert.equal(result.syncedSources.length, 2);
  assert.ok(!("content" in a));
  assert.ok(JSON.stringify(result.syncedSources).includes("Do not discard this version"));
});

test("canonical synced store supports subscriptions, no echo writes, optimistic revision and cycle/orphan handling", () => {
  const persisted = [];
  const store = createSyncedContentStore([], (sources) => persisted.push(sources));
  const source = store.createSource([{ id: "p", type: "paragraph", content: "A" }]);
  let observations = 0;
  const unsubscribe = store.subscribe(source.id, () => observations++);
  store.updateSource(source.id, [{ id: "p", type: "paragraph", content: "B" }], source.revision);
  assert.equal(store.getSource(source.id).blocks[0].content, "B");
  assert.equal(observations, 1);
  const current = store.getSource(source.id);
  store.updateSource(source.id, current.blocks, current.revision);
  assert.equal(observations, 1);
  assert.throws(() => store.updateSource(source.id, [{ type: "paragraph", content: "stale" }], 0), /revision/i);
  assert.throws(() => store.updateSource(source.id, [{ type: "syncedBlock", props: { sourceId: source.id } }], current.revision), /cycle/i);
  const other = store.createSource([{ type: "syncedBlock", props: { sourceId: source.id } }]);
  assert.throws(() => store.updateSource(source.id, [{ type: "syncedBlock", props: { sourceId: other.id } }], current.revision), /cycle/i);
  store.deleteSource(source.id);
  assert.ok(store.getSource(source.id).deletedAt);
  assert.equal(store.getSource(other.id).blocks[0].props.sourceId, source.id);
  unsubscribe();
  assert.ok(persisted.length >= 3);
});

test("presentation migration creates independent views over one source without changing old consumers", () => {
  const input = legacyWorkspace();
  const result = migratePhase1(input);
  const table = find(result.pages[0].content, "table");
  assert.equal(table.props.viewId, "view");
  assert.deepEqual(result.databaseViews.find((view) => view.id === "view").config.custom, 42);
  for (const type of ["chart", "form", "dashboard"]) {
    const block = find(result.pages[0].content, type);
    const view = result.databaseViews.find((candidate) => candidate.id === block.props.viewId);
    assert.equal(view.type, type);
    assert.equal(view.sourceId, "source");
    assert.notEqual(view.id, "view");
    assert.ok(!("presentation" in block.props));
  }
  assert.equal(result.dataSources.length, 1);
  assert.equal(result.databaseItems.length, 1);
  assert.equal(result.databaseViews.length, 4);
});

test("all ten view types and all six added property families are first-class registry entries", () => {
  for (const type of ["table", "board", "list", "gallery", "calendar", "timeline", "chart", "form", "dashboard", "map"]) {
    assert.ok(DATABASE_VIEW_TYPES.includes(type));
    assert.equal(createDatabaseView({ sourceId: "source", type }).type, type);
  }
  for (const type of ["people", "url", "email", "phone", "files", "place"]) assert.ok(DATABASE_PROPERTY_TYPES.includes(type));
  const workspace = migratePhase1(legacyWorkspace());
  const linked = createLinkedView("source", { type: "map", config: { map: { placePropertyId: "place" } } });
  assert.equal(projectViewItems(workspace, linked)[0].id, "record");
  assert.equal(workspace.databaseItems.length, 1);
});

test("property values normalize without corrupting empty, zero-coordinate or date-range semantics", () => {
  assert.deepEqual(normalizePropertyValue("date", "2026-09-19"), { start: "2026-09-19", end: null, includeTime: false, timeZone: null });
  assert.equal(normalizePropertyValue("date", ""), null);
  assert.deepEqual(normalizePropertyValue("people", ["person", "person", ""]), ["person"]);
  assert.deepEqual(normalizePropertyValue("files", "file"), ["file"]);
  assert.equal(normalizePropertyValue("url", " https://example.com "), "https://example.com");
  assert.equal(normalizePropertyValue("place", { name: "Origin", latitude: 0, longitude: 0 }).latitude, 0);
  assert.equal(normalizePropertyValue("place", null), null);
  const range = { start: "2026-09-19T09:00", end: "2026-09-20T10:00", includeTime: true, timeZone: "Europe/Berlin" };
  assert.deepEqual(normalizePropertyValue("date", range), range);
});

test("human property and mention labels resolve against the current workspace, not raw IDs", () => {
  const workspace = { pages: [{ id: "p", title: "Renamed page" }], people: [{ id: "u", displayName: "Renamed user" }], attachments: [{ id: "f", name: "proposal.pdf" }] };
  assert.equal(formatPropertyValue(workspace, { type: "people" }, ["u"]), "Renamed user");
  assert.equal(formatPropertyValue(workspace, { type: "files" }, ["f"]), "proposal.pdf");
  assert.equal(mentionLabel({ type: "pageMention", props: { pageId: "p", labelSnapshot: "Old" } }, workspace), "Renamed page");
  assert.equal(mentionLabel({ type: "userMention", props: { personId: "u", labelSnapshot: "Old" } }, workspace), "@Renamed user");
  assert.equal(mentionLabel({ type: "dateMention", props: { value: "2026-09-19" } }, workspace), "2026-09-19");
});

test("repository retains the original v6 key after a successful migrated save and reloads new collections", () => {
  const original = JSON.stringify(legacyWorkspace());
  const map = new Map([["life-atlas.workspace.v6", original]]);
  const storage = { getItem: (key) => map.get(key) ?? null, setItem: (key, value) => map.set(key, value), removeItem: (key) => map.delete(key) };
  const repository = createBrowserWorkspaceRepository(storage);
  const result = repository.load(legacyWorkspace());
  repository.save(result);
  assert.notEqual(workspaceStorageKey, "life-atlas.workspace.v6");
  assert.equal(map.get("life-atlas.workspace.v6"), original);
  assert.deepEqual(repository.load(legacyWorkspace()).syncedSources, result.syncedSources);
});
