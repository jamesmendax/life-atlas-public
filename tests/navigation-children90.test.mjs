import test from "node:test";
import assert from "node:assert/strict";
import * as navigation from "../src/domain/navigation.js";

test("owned page children follow nested structural links before sorted remaining owners", () => {
  const second = { id: "second", title: "Same title", parentPageId: "root", sortIndex: 1 };
  const first = { id: "first", title: "Same title", parentPageId: "root", sortIndex: 50, icon: "book" };
  const blank = { id: "blank", title: "", parentPageId: "root", sortIndex: 4 };
  const alpha = { id: "alpha", title: "Alpha", parentPageId: "root", sortIndex: 10 };
  const beta = { id: "beta", title: "Beta", parentPageId: "root", sortIndex: 10 };
  const root = { id: "root", content: [
    { id: "container", type: "callout", children: [
      { type: "pageLink", props: { pageId: "first", label: "Stale label" } },
      { type: "pageLink", props: { pageId: "elsewhere" } },
    ] },
    { type: "pageLink", props: { pageId: "second" } },
    { type: "pageLink", props: { pageId: "first" } },
    { type: "pageLink", props: { pageId: "deleted" } },
    { type: "pageLink", props: { pageId: "record" } },
    { type: "pageLink", props: { pageId: "grandchild" } },
    { type: "paragraph", content: [{ type: "pageMention", props: { pageId: "beta" } }] },
  ] };
  const workspace = { pages: [root, second, beta, alpha, first, blank,
    { id: "elsewhere", title: "Elsewhere", parentPageId: "other" },
    { id: "orphan", parentPageId: "missing" },
    { id: "grandchild", parentPageId: "first" },
    { id: "deleted", parentPageId: "root", trashedAt: "2026-11-13" },
    { id: "record", parentPageId: "root", databaseSourceId: "source" },
  ] };
  const before = structuredClone(workspace);
  const rows = navigation.pageNavigationEntries(workspace, "root");
  assert.deepEqual(rows.map((row) => row.pageId), ["first", "second", "blank", "alpha", "beta"]);
  assert.deepEqual(rows[0], { key: "page:first", kind: "page", pageId: "first", label: "Same title", page: first });
  assert.equal(rows[0].page, first);
  assert.equal(rows[1].page, second);
  assert.equal(rows[2].label, "无标题页面");
  assert.equal(new Set(rows.map((row) => row.key)).size, rows.length);
  assert.deepEqual(navigation.pageNavigationEntries(workspace, "missing"), []);
  assert.deepEqual(workspace, before);
});

test("embedded views retain each block identity and interleave with owned pages", () => {
  const source = { id: "source", title: "Articles", ownerPageId: "database" };
  const view = { id: "view", sourceId: "source" };
  const database = { id: "database", title: "Articles", parentPageId: "root", pageType: "database", databaseSourceId: "source", content: [
    { id: "canonical", type: "databaseView", props: { sourceId: "source", viewId: "view" } },
    { id: "foreign", type: "databaseView", props: { sourceId: "other-source", viewId: "other-view" } },
  ] };
  const root = { id: "root", content: [
    { id: "alias-one", type: "databaseView", props: { sourceId: "source", viewId: "view" } },
    { type: "callout", children: [
      { type: "pageLink", props: { pageId: "database" } },
      { id: "alias-two", type: "databaseView", props: { sourceId: "source", viewId: "view" } },
    ] },
    { id: "alias-three", type: "databaseView", props: { sourceId: "source", viewId: "view" } },
    { id: "no-source", type: "databaseView", props: { sourceId: "missing", viewId: "view" } },
    { id: "no-view", type: "databaseView", props: { sourceId: "source", viewId: "missing" } },
    { id: "mismatch", type: "databaseView", props: { sourceId: "source", viewId: "other-view" } },
    { type: "databaseView", props: { sourceId: "source", viewId: "view" } },
    { id: "fallback", type: "databaseView", props: { sourceId: "other-source", viewId: "other-view" } },
  ] };
  const workspace = { pages: [root, database], dataSources: [source, { id: "other-source", title: "", ownerPageId: "other" }],
    databaseViews: [view, { id: "other-view", sourceId: "other-source" }] };
  const before = structuredClone(workspace);
  const rows = navigation.pageNavigationEntries(workspace, "root");
  assert.deepEqual(rows.map((row) => row.blockId || row.pageId), ["alias-one", "database", "alias-two", "alias-three", "fallback"]);
  assert.deepEqual(rows[0], { key: "databaseView:root:alias-one", kind: "databaseView", pageId: "root", label: "View of Articles", sourceId: "source", viewId: "view", blockId: "alias-one" });
  assert.equal(rows[1].page, database);
  assert.equal(rows.at(-1).label, "View of 新数据库");
  assert.equal(new Set(rows.map((row) => row.key)).size, rows.length);
  assert.deepEqual(navigation.pageNavigationEntries(workspace, "database").map((row) => row.blockId), ["foreign"]);
  assert.deepEqual(workspace, before);
});

test("page ancestors exclude the page, preserve original objects, and stop at trash or missing parents", () => {
  const root = { id: "root", parentPageId: null };
  const parent = { id: "parent", parentPageId: "root" };
  const child = { id: "child", parentPageId: "parent" };
  const orphan = { id: "orphan", parentPageId: "missing" };
  const pages = [root, parent, child, orphan];
  const before = structuredClone(pages);
  const ancestors = navigation.pageAncestors(pages, "child");
  assert.deepEqual(ancestors, [root, parent]);
  assert.equal(ancestors[0], root);
  assert.equal(ancestors[1], parent);
  assert.deepEqual(navigation.pageAncestors(pages, "root"), []);
  assert.deepEqual(navigation.pageAncestors(pages, "orphan"), []);
  assert.deepEqual(navigation.pageAncestors(pages, "missing"), []);
  assert.deepEqual(navigation.pageAncestors(undefined, "child"), []);
  assert.deepEqual(navigation.pageAncestors([{ ...root, trashedAt: "today" }, parent, child], "child"), [parent]);
  assert.deepEqual(navigation.pageAncestors([root, { ...parent, trashedAt: "today" }, child], "child"), []);
  assert.deepEqual(navigation.pageAncestors([root, parent, { ...child, trashedAt: "today" }], "child"), []);
  assert.deepEqual(pages, before);
});

test("page ancestor cycles terminate without adding the selected page or duplicate ancestors", () => {
  const a = { id: "a", parentPageId: "b" };
  const b = { id: "b", parentPageId: "c" };
  const c = { id: "c", parentPageId: "a" };
  assert.deepEqual(navigation.pageAncestors([a, b, c], "a"), [c, b]);
  assert.deepEqual(navigation.pageAncestors([{ id: "self", parentPageId: "self" }], "self"), []);
  assert.deepEqual(navigation.pageAncestors([{ id: "leaf", parentPageId: "b" }, { ...b, parentPageId: "b" }], "leaf"), [{ ...b, parentPageId: "b" }]);
});

test("navigation handles empty or trashed owners and cyclic containers without inventing children", () => {
  assert.deepEqual(navigation.pageNavigationEntries(undefined, "root"), []);
  assert.deepEqual(navigation.pageNavigationEntries({}, "root"), []);
  const container = { id: "container", type: "callout", children: [] };
  const child = { id: "child", title: "Child", parentPageId: "root" };
  container.children.push(container, { type: "pageLink", props: { pageId: "child" } });
  const root = { id: "root", parentPageId: "root", content: [container] };
  const workspace = { pages: [root, child] };
  assert.deepEqual(navigation.pageNavigationEntries(workspace, "root").map((row) => row.pageId), ["child"]);
  assert.deepEqual(navigation.pageNavigationEntries({ pages: [{ ...root, trashedAt: "today" }, child] }, "root"), []);
  assert.equal(container.children[0], container);
  assert.equal(workspace.pages[0], root);
});

test("view rows omit trashed sources or views and keep valid embedded references to missing source owners", () => {
  const root = { id: "root", content: [
    { id: "source-trash", type: "databaseView", props: { sourceId: "deleted", viewId: "deleted-source-view" } },
    { id: "view-trash", type: "databaseView", props: { sourceId: "live", viewId: "deleted-view" } },
    { id: "valid", type: "databaseView", props: { sourceId: "live", viewId: "live-view" } },
  ] };
  const workspace = { pages: [root], dataSources: [
    { id: "deleted", title: "Deleted", trashedAt: "today" },
    { id: "live", title: "Live", ownerPageId: "missing-owner" },
  ], databaseViews: [
    { id: "deleted-source-view", sourceId: "deleted" },
    { id: "deleted-view", sourceId: "live", trashedAt: "today" },
    { id: "live-view", sourceId: "live" },
  ] };
  const before = structuredClone(workspace);
  assert.deepEqual(navigation.pageNavigationEntries(workspace, "root").map((row) => row.blockId), ["valid"]);
  assert.deepEqual(workspace, before);
});

test("single-view wrapper pages expose linked database metadata without a duplicate child row", () => {
  const alias = { id: "alias", title: "Articles", parentPageId: "root", content: [
    { id: "alias-block", type: "databaseView", props: { sourceId: "articles", viewId: "table" } },
  ] };
  const custom = { id: "custom", title: "My reading desk", parentPageId: "root", content: [
    { id: "custom-block", type: "databaseView", props: { sourceId: "articles", viewId: "table" } },
  ] };
  const untitled = { id: "untitled", title: "Untitled", parentPageId: "root", content: [
    { id: "untitled-block", type: "databaseView", props: { sourceId: "articles", viewId: "table" } },
  ] };
  const canonical = { id: "canonical", title: "Articles", pageType: "database", databaseSourceId: "articles", parentPageId: "root", content: [
    { id: "canonical-block", type: "databaseView", props: { sourceId: "articles", viewId: "table" } },
  ] };
  const root = { id: "root", content: [
    { type: "pageLink", props: { pageId: "canonical" } },
    { type: "pageLink", props: { pageId: "alias" } },
  ] };
  const workspace = { pages: [root, alias, custom, untitled, canonical,
    { id: "alias-child", title: "Owned note", parentPageId: "alias" },
  ], dataSources: [{ id: "articles", title: "Articles", ownerPageId: "canonical" }], databaseViews: [{ id: "table", sourceId: "articles" }] };
  const before = structuredClone(workspace);
  const rows = navigation.pageNavigationEntries(workspace, "root");
  assert.deepEqual(rows.map((row) => row.pageId), ["canonical", "alias", "custom", "untitled"]);
  assert.equal(rows[0].label, "Articles");
  assert.equal(rows[0].linkedDatabaseView, undefined);
  assert.deepEqual(rows[1], { key: "page:alias", kind: "page", pageId: "alias", label: "View of Articles", page: alias,
    linkedDatabaseView: { sourceId: "articles", viewId: "table", blockId: "alias-block" } });
  assert.equal(rows[1].page, alias);
  assert.equal(rows[2].label, "My reading desk");
  assert.equal(rows[2].linkedDatabaseView.blockId, "custom-block");
  assert.equal(rows[3].label, "View of Articles");
  assert.deepEqual(navigation.pageNavigationEntries(workspace, "alias").map((row) => row.pageId), ["alias-child"]);
  assert.deepEqual(navigation.pageNavigationEntries(workspace, "custom"), []);
  assert.deepEqual(navigation.pageNavigationEntries(workspace, "untitled"), []);
  assert.deepEqual(workspace, before);
});

test("a shared navigation index resolves many leaves without rescanning workspace collections", () => {
  let parentReads = 0;
  let sourceIdReads = 0;
  let viewIdReads = 0;
  const root = { id: "root", content: [] };
  const leaves = Array.from({ length: 80 }, (_, index) => ({
    id: `leaf-${index}`, title: `Leaf ${index}`, sortIndex: index,
    get parentPageId() { parentReads += 1; return "root"; },
  }));
  const workspace = { pages: [root, ...leaves],
    dataSources: [{ get id() { sourceIdReads += 1; return "source"; } }],
    databaseViews: [{ get id() { viewIdReads += 1; return "view"; }, sourceId: "source" }],
  };
  const index = navigation.createPageNavigationIndex(workspace);
  assert.equal(index.pagesById.get("leaf-17"), leaves[17]);
  assert.deepEqual(index.childrenByParent.get("root"), leaves);
  assert.equal(index.sourcesById.get("source"), workspace.dataSources[0]);
  assert.equal(index.viewsById.get("view"), workspace.databaseViews[0]);
  const countsAfterIndex = [parentReads, sourceIdReads, viewIdReads];
  assert.ok(countsAfterIndex.every((count) => count > 0));
  for (const leaf of leaves) assert.deepEqual(navigation.pageNavigationEntries(workspace, leaf.id, index), []);
  assert.deepEqual([parentReads, sourceIdReads, viewIdReads], countsAfterIndex);
  const rows = navigation.pageNavigationEntries(workspace, "root", index);
  assert.deepEqual(rows.map((row) => row.pageId), leaves.map((leaf) => leaf.id));
  assert.equal(rows[17].page, leaves[17]);
  assert.deepEqual([parentReads, sourceIdReads, viewIdReads], countsAfterIndex);
  assert.deepEqual(navigation.pageNavigationEntries(workspace, "root"), rows);
  assert.deepEqual(navigation.pageNavigationEntries(undefined, "root", navigation.createPageNavigationIndex()), []);
});
