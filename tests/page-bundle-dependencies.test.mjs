import assert from "node:assert/strict";
import test from "node:test";
import { createPageBundle, duplicatePageIndependently, importPageBundle } from "../src/domain/pageBundle.js";
import { createPageExport, duplicatePage, parsePageImport } from "../src/domain/pageActions.js";
import { dashboardProjection } from "../src/domain/dashboard.js";
import { checkWorkspaceIntegrity } from "../src/domain/integrity.js";
import { deleteProperty } from "../src/domain/propertyChanges.js";
import { CURRENT_SCHEMA_VERSION } from "../src/persistence/migrations.js";

const page = (id, extra = {}) => ({ id, title: id, folderId: "source-folder", content: [], ...extra });
const prop = (id, type) => ({ id, name: id, type });
const link = (id, pageId) => ({ id, type: "pageLink", props: { pageId } });
const hash = "b".repeat(64);
const fresh = () => { let serial = 0; return prefix => `${prefix}-fresh-${++serial}`; };

function fixture() {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION, folders: [{ id: "source-folder", parentId: null }],
    pages: [
      page("index", { parentPageId: "outside", content: [link("jump", "hub")] }),
      page("outside"), page("unrelated"),
      page("hub", { content: [link("back", "index"), { id: "cols", type: "column", children: [
        { id: "database", type: "databaseView", props: { sourceId: "primary", viewId: "dash", viewIdsJson: '["dash"]' } },
        { id: "anchor", type: "paragraph", content: [{ type: "link", href: "lifeatlas://page/hidden-child#block-anchor" }] },
      ] }] }),
      page("hidden-child", { parentPageId: "hub", cover: { type: "image", value: `life-asset://${hash}` },
        content: [{ id: "anchor", type: "syncedBlock", props: { sourceId: "sync" } }] }),
      page("record"), page("template-destination", { parentPageId: "outside" }),
    ],
    dataSources: [
      { id: "primary", title: "Overview", ownerPageId: "hub", properties: [prop("name", "title"), prop("kind", "text")] },
      { id: "expenses", title: "Expenses", properties: [prop("label", "title"), prop("category", "text"), prop("files", "files"), prop("people", "people")] },
      { id: "other", properties: [] },
    ],
    databaseViews: [
      { id: "dash", name: "Dashboard", type: "dashboard", sourceId: "primary", config: { dashboard: {
        widgets: [{ type: "view", sourceId: "expenses", viewId: "table" }],
        globalFilters: [{ propertyId: "kind", operator: "equals", value: "travel", mappings: { expenses: "category" } }],
      } } },
      { id: "table", type: "table", sourceId: "expenses", config: { table: { manualOrder: ["expense"] } } },
      { id: "other-view", type: "table", sourceId: "other" },
    ],
    databaseItems: [{ id: "expense", sourceId: "expenses", pageId: "record", values: { label: "Train", category: "travel", files: ["doc"], people: ["person"] } }],
    databaseTemplates: [
      { id: "expense-template", name: "Ticket", sourceId: "expenses", defaultValues: { category: "travel", people: "person", files: ["doc"] },
        pageContent: [{ id: "container", type: "column", children: [link("tpl-link", "template-destination")] }], pageAppearance: { icon: "blob:icon#life-attachment=doc" } },
      { id: "unused-tpl", sourceId: "other", defaultValues: {}, pageContent: [] },
    ],
    people: [{ id: "person", displayName: "Traveler" }],
    attachments: [{ id: "doc", name: "Ticket", provider: "local-ref", storageKey: "original-blob" }, { id: "cover", provider: "asset", storageKey: hash }],
    syncedSources: [{ id: "sync", blocks: [link("in-sync", "index"), { id: "media", type: "file", props: { url: "blob:file#life-attachment=doc" } }] }],
    relations: [],
  };
}

test("navigation links, ownership, dashboard widgets, templates and sync yield a bounded transitive page bundle", () => {
  const workspace = fixture(), before = structuredClone(workspace);
  const bundle = createPageBundle(workspace.pages[0], workspace);
  assert.deepEqual(new Set(bundle.related.pages.map(p => p.id)), new Set(["hub", "hidden-child", "record", "template-destination"]));
  assert.deepEqual(bundle.related.dataSources.map(row => row.id), ["primary", "expenses"]);
  assert.deepEqual(bundle.related.databaseTemplates.map(row => row.id), ["expense-template"]);
  assert.deepEqual(bundle.related.attachments.map(row => row.id).sort(), ["cover", "doc"]);
  assert.deepEqual(bundle.related.syncedSources.map(row => row.id), ["sync"]);
  assert.deepEqual(workspace, before);
  assert.deepEqual(bundle.page, workspace.pages[0]);
});

test("native page JSON imported into an empty destination reconnects dashboard, templates, links, media and scoped block anchors", () => {
  const source = fixture();
  const json = JSON.stringify(createPageBundle(source.pages[0], source));
  const { bundle } = parsePageImport(json, "index.json");
  const target = { id: "new-index", folderId: "dest-folder", content: [] };
  const current = { pages: [target], folders: [{ id: "dest-folder", parentId: null }] };
  const { workspace, page: root } = importPageBundle(current, bundle, target.id, fresh());
  assert.deepEqual(current.pages, [target]);
  assert.equal(root.parentPageId, null);
  assert.ok(workspace.pages.every(p => p.folderId === "dest-folder"));
  const hub = workspace.pages.find(p => p.id === root.content[0].props.pageId);
  assert.equal(hub.content[0].props.pageId, root.id);
  const child = workspace.pages.find(p => p.parentPageId === hub.id);
  const [db, anchor] = hub.content[1].children;
  assert.equal(anchor.content[0].href, `lifeatlas://page/${child.id}#block-${child.content[0].id}`);
  assert.notEqual(anchor.id, child.content[0].id);
  const sync = workspace.syncedSources.find(row => row.id === child.content[0].props.sourceId);
  assert.equal(sync.blocks[0].props.pageId, root.id);
  const primary = workspace.dataSources.find(s => s.id === db.props.sourceId);
  assert.equal(primary.ownerPageId, hub.id);
  const dashboard = workspace.databaseViews.find(v => v.id === db.props.viewId);
  assert.deepEqual(JSON.parse(db.props.viewIdsJson), [dashboard.id]);
  const { widgets: [widget], globalFilters } = dashboard.config.dashboard;
  const item = workspace.databaseItems[0];
  assert.equal(widget.sourceId, item.sourceId);
  assert.deepEqual(globalFilters[0].mappings, { [item.sourceId]: "category" });
  const projection = dashboardProjection({ workspace, primary, dashboard, widget, globalFilters });
  assert.deepEqual(projection.items.map(i => i.id), [item.id]);
  assert.deepEqual(projection.view.config.table.manualOrder, [item.id]);
  const template = workspace.databaseTemplates[0], doc = workspace.attachments.find(a => a.name === "Ticket");
  assert.equal(doc.storageKey, "original-blob");
  assert.equal(template.sourceId, item.sourceId);
  assert.deepEqual(template.defaultValues.files, [doc.id]);
  assert.deepEqual(item.values.files, [doc.id]);
  assert.equal(template.defaultValues.people, workspace.people[0].id);
  assert.equal(template.pageAppearance.icon, `blob:icon#life-attachment=${doc.id}`);
  assert.equal(sync.blocks[1].props.url, `blob:file#life-attachment=${doc.id}`);
  assert.equal(child.cover.value, `life-asset://${hash}`);
  const tplLink = template.pageContent[0].children[0];
  assert.notEqual(tplLink.id, "tpl-link");
  assert.equal(workspace.pages.find(p => p.id === tplLink.props.pageId).parentPageId, null);
  assert.deepEqual(checkWorkspaceIntegrity(workspace).problems, []);
});

test("ordinary duplicate keeps shared data while independent duplication isolates edits and preserves root placement", () => {
  const workspace = fixture(), before = structuredClone(workspace), source = workspace.pages[0];
  const shared = duplicatePage(workspace.pages[3], { id: "linked", sortIndex: 18 });
  assert.equal(shared.content[1].children[0].props.sourceId, "primary");
  const copy = duplicatePageIndependently(workspace, source.id, { id: "new-year", sortIndex: 19, now: "2026-01-01T00:00:00Z" }, fresh());
  assert.equal(copy.page.title, "index 独立副本");
  assert.equal(copy.page.parentPageId, "outside");
  assert.equal(copy.page.sortIndex, 19);
  assert.equal(copy.page.createdAt, "2026-01-01T00:00:00Z");
  const addedItem = copy.workspace.databaseItems.at(-1);
  addedItem.values.label = "Ferry";
  copy.workspace.databaseTemplates.at(-1).pageContent[0].children = [];
  copy.workspace.dataSources.at(-1).properties[0].name = "Different";
  assert.deepEqual(workspace, before);
  for (const [key, count] of Object.entries(copy.importedCounts)) {
    assert.equal(copy.workspace[key].length, workspace[key].length + count);
    assert.equal(new Set(copy.workspace[key].map(row => row.id)).size, copy.workspace[key].length);
  }
  assert.throws(() => duplicatePageIndependently(workspace, source.id, { id: source.id }), /冲突/);
});

test("old v2 packages without templates and v1 page-only exports still import", () => {
  const current = { pages: [page("target")] };
  const plain = page("old", { content: [{ id: "old-id", type: "paragraph", content: "remember" }] });
  const v1 = createPageExport(plain);
  assert.equal(parsePageImport(JSON.stringify(v1), "old.json").content[0].content, "remember");
  for (const bundle of [v1, { kind: "life-atlas-page", version: 2, schemaVersion: 8, page: plain, related: {} }]) {
    const result = importPageBundle(current, bundle, "target", fresh());
    assert.equal(result.page.content[0].content, "remember");
    assert.notEqual(result.page.content[0].id, "old-id");
    assert.deepEqual(result.workspace.databaseTemplates, []);
  }
});

test("cross-source relations, record templates, equality filters and map references resolve within each independent graph", () => {
  const original = fixture();
  const [primary, expenses] = original.dataSources;
  primary.properties.push({ ...prop("spend", "relation"), config: { targetSourceId: expenses.id } }, prop("place", "place"));
  expenses.properties.push({ ...prop("project", "relation"), config: { targetSourceId: primary.id } });
  original.relations = [
    { id: "out", sourceId: primary.id, targetSourceId: expenses.id, propertyId: "spend", reciprocalPropertyId: "project" },
    { id: "back", sourceId: expenses.id, targetSourceId: primary.id, propertyId: "project", reciprocalPropertyId: "spend" },
  ];
  original.databaseTemplates.push({ id: "tpl-main", sourceId: primary.id, pageContent: [], defaultValues: { spend: ["expense"] } });
  original.pages.push(page("child-record", { databaseSourceId: expenses.id, parentDatabaseItemId: "expense" }));
  original.databaseItems.push({ id: "subitem", sourceId: expenses.id, pageId: "child-record", parentItemId: "expense", values: { label: "Child" } });
  original.databaseViews.push({ id: "map", sourceId: expenses.id, type: "map", config: { map: { relationPropertyId: "project", relatedPlacePropertyId: "place" } } });
  original.databaseViews[0].filter = { and: [
    { propertyId: "spend", operator: "equals", value: "expense" },
    { propertyId: "spend", operator: "contains", value: "expense" },
  ] };
  const { workspace } = duplicatePageIndependently(original, "index", { id: "copy" }, fresh());
  const reverse = workspace.relations.at(-1), target = workspace.dataSources.find(s => s.id === reverse.targetSourceId);
  assert.notEqual(reverse.sourceId, expenses.id);
  assert.notEqual(reverse.targetSourceId, primary.id);
  assert.equal(target.properties.find(p => p.id === "spend").config.targetSourceId, reverse.sourceId);
  const savedMap = workspace.databaseViews.find(v => v.type === "map" && v.sourceId === reverse.sourceId);
  assert.equal(savedMap.config.map.relationPropertyId, reverse.propertyId);
  assert.ok(target.properties.some(p => p.id === savedMap.config.map.relatedPlacePropertyId));
  const copiedItems = workspace.databaseItems.filter(item => item.sourceId === reverse.sourceId);
  const rowId = copiedItems.find(item => item.values.label === "Train").id;
  const subitem = copiedItems.find(item => item.values.label === "Child");
  assert.equal(subitem.parentItemId, rowId);
  assert.equal(workspace.pages.find(page => page.id === subitem.pageId).parentDatabaseItemId, rowId);
  const template = workspace.databaseTemplates.find(t => t.sourceId === target.id);
  assert.deepEqual(template.defaultValues.spend, [rowId]);
  const copiedDashboard = workspace.databaseViews.find(v => v.sourceId === target.id);
  assert.deepEqual(copiedDashboard.filter.and.map(rule => rule.value), [rowId, "expense"]);
  const afterDelete = deleteProperty(workspace, { sourceId: target.id, propertyId: "spend" });
  assert.deepEqual(afterDelete.relations.slice(0, 2), original.relations);
  assert.equal(afterDelete.relations.find(r => r.id === reverse.id).reciprocalPropertyId, null);
});

test("inline mentions and editorial and subpage navigation stay linked without importing a foreign occurrence view", () => {
  const ws = fixture(), index = ws.pages[0];
  index.content = [
    { type: "paragraph", content: [{ type: "pageMention", props: { pageId: "hub" } }] },
    { type: "subPage", props: { pageId: "hidden-child" } },
    { type: "editorialCard", props: { pageId: "hub" } },
    { type: "editorialSection", props: { sourceId: "primary", fallbackJson: '[{"pageId":"template-destination","itemId":"expense"}]' } },
  ];
  const db = ws.pages.find(p => p.id === "hub").content[1].children[0];
  db.props.viewIdsJson = '["dash","other-view"]';
  const { workspace, page } = duplicatePageIndependently(ws, index.id, { id: "copy" }, fresh());
  const [mention, sub, card, gallery] = page.content;
  assert.notEqual(mention.content[0].props.pageId, "hub");
  assert.equal(mention.content[0].props.pageId, card.props.pageId);
  const copiedHub = workspace.pages.find(p => p.id === card.props.pageId);
  assert.equal(workspace.pages.find(p => p.id === sub.props.pageId).parentPageId, copiedHub.id);
  const copiedDb = copiedHub.content[1].children[0];
  assert.equal(gallery.props.sourceId, copiedDb.props.sourceId);
  assert.deepEqual(JSON.parse(copiedDb.props.viewIdsJson), [copiedDb.props.viewId, "other-view"]);
  assert.deepEqual(JSON.parse(gallery.props.fallbackJson), [{ pageId: workspace.pages.find(p => p.title === "template-destination" && p.id !== "template-destination").id, itemId: workspace.databaseItems.at(-1).id }]);
  assert.equal(workspace.databaseViews.filter(v => v.sourceId === "other").length, 1);
});
