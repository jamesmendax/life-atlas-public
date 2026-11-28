import test from "node:test";
import assert from "node:assert/strict";
import {
  createPageNavigationIndex,
  pageNavigationEntries,
  databaseNavigationEntries,
  isDuplicateCompanionPage,
} from "../src/domain/navigation.js";

test("databaseNavigationEntries returns ordered views declared in viewIdsJson with canonical metadata", () => {
  const source = { id: "source-books", title: "书架", ownerPageId: "page-books" };
  const view1 = { id: "view-default", name: "Default view", sourceId: "source-books" };
  const view2 = { id: "view-reading", name: "阅读书架", sourceId: "source-books" };
  const view3 = { id: "view-all", name: "完整书库", sourceId: "source-books" };
  const view4 = { id: "view-active", name: "正在读", sourceId: "source-books" };

  const dbPage = {
    id: "page-books",
    title: "书架",
    pageType: "database",
    databaseSourceId: "source-books",
    content: [
      {
        id: "block-db-view",
        type: "databaseView",
        props: {
          sourceId: "source-books",
          viewId: "view-active",
          viewIdsJson: JSON.stringify(["view-default", "view-reading", "view-all", "view-active"]),
        },
      },
    ],
  };

  const workspace = {
    pages: [dbPage],
    dataSources: [source],
    databaseViews: [view1, view2, view3, view4],
  };

  const index = createPageNavigationIndex(workspace);
  const entries = databaseNavigationEntries(workspace, dbPage.id, index);

  assert.equal(entries.length, 4);
  assert.deepEqual(entries.map((e) => e.label), ["Default view", "阅读书架", "完整书库", "正在读"]);
  assert.deepEqual(entries.map((e) => e.viewId), ["view-default", "view-reading", "view-all", "view-active"]);
  assert.ok(entries.every((e) => e.isCanonicalView === true));
  assert.ok(entries.every((e) => e.blockId === "block-db-view"));
  assert.ok(entries.every((e) => e.pageId === "page-books"));
});

test("pageNavigationEntries with includeDatabaseViews prepends canonical views to child pages", () => {
  const source = { id: "source-books", title: "书架", ownerPageId: "page-books" };
  const view1 = { id: "view-default", name: "Default view", sourceId: "source-books" };
  const view2 = { id: "view-active", name: "正在读", sourceId: "source-books" };

  const dbPage = {
    id: "page-books",
    title: "书架",
    pageType: "database",
    databaseSourceId: "source-books",
    content: [
      {
        id: "block-db",
        type: "databaseView",
        props: {
          sourceId: "source-books",
          viewId: "view-default",
          viewIdsJson: JSON.stringify(["view-default", "view-active"]),
        },
      },
    ],
  };
  const subPage = {
    id: "page-subnote",
    title: "读书指南",
    parentPageId: "page-books",
    content: [],
  };

  const workspace = {
    pages: [dbPage, subPage],
    dataSources: [source],
    databaseViews: [view1, view2],
  };

  const index = createPageNavigationIndex(workspace);
  const entries = pageNavigationEntries(workspace, dbPage.id, index, { includeDatabaseViews: true });

  assert.equal(entries.length, 3);
  assert.equal(entries[0].label, "Default view");
  assert.equal(entries[0].kind, "databaseView");
  assert.equal(entries[1].label, "正在读");
  assert.equal(entries[1].kind, "databaseView");
  assert.equal(entries[2].label, "读书指南");
  assert.equal(entries[2].kind, "page");
});

test("isDuplicateCompanionPage identifies export wrapper companion pages and filters them from navigation", () => {
  const source = { id: "source-books", title: "书架", ownerPageId: "page-books" };
  const canonicalDbPage = {
    id: "page-books",
    title: "书架",
    pageType: "database",
    databaseSourceId: "source-books",
    parentPageId: "root",
    content: [],
  };
  const companionHtmlPage = {
    id: "page-books-companion",
    title: "书架",
    parentPageId: "root",
    content: [
      { id: "b1", type: "paragraph", content: [{ type: "text", text: "Reading queue" }] },
      { id: "b2", type: "databaseView", props: { sourceId: "source-books", viewId: "v1" } },
    ],
  };
  const normalPage = {
    id: "page-about",
    title: "关于",
    parentPageId: "root",
    content: [{ id: "b3", type: "paragraph", content: [{ type: "text", text: "About" }] }],
  };
  const root = {
    id: "root",
    content: [
      { type: "pageLink", props: { pageId: "page-books" } },
      { type: "pageLink", props: { pageId: "page-books-companion" } },
      { type: "pageLink", props: { pageId: "page-about" } },
    ],
  };

  const workspace = {
    pages: [root, canonicalDbPage, companionHtmlPage, normalPage],
    dataSources: [source],
    databaseViews: [],
  };

  const index = createPageNavigationIndex(workspace);
  assert.equal(isDuplicateCompanionPage(companionHtmlPage, [canonicalDbPage, companionHtmlPage, normalPage], index.sourcesById), true);
  assert.equal(isDuplicateCompanionPage(canonicalDbPage, [canonicalDbPage, companionHtmlPage, normalPage], index.sourcesById), false);
  assert.equal(isDuplicateCompanionPage(normalPage, [canonicalDbPage, companionHtmlPage, normalPage], index.sourcesById), false);

  const rootEntries = pageNavigationEntries(workspace, "root", index);
  assert.deepEqual(rootEntries.map((e) => e.pageId), ["page-books", "page-about"]);
});
