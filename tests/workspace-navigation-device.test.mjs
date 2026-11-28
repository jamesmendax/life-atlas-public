import test from "node:test";
import assert from "node:assert/strict";
import { createWorkspaceNavigation, restoreWorkspacePageTabs } from "../src/domain/workspaceNavigation.js";
import { DEVICE_PREFERENCES_KEY, readDevicePreferences, updateDevicePreferences } from "../src/ui/devicePreferences.js";
import { applyContrast, applyTheme } from "../src/ui/theme.js";
import { favoritePages } from "../src/domain/favorites.js";
import { recentGroups } from "../src/domain/recents.js";

const now = "2026-11-27T07:00:00.000Z";
function navigationWorkspace() {
  const folders = [
    { id: "a", parentId: null, name: "主题 A" },
    { id: "b", parentId: null, name: "主题 B" },
    { id: "trash-folder", parentId: "a", name: "已删除", trashedAt: now },
  ];
  const page = (id, props) => ({ id, folderId: "a", title: "同名", ...props });
  const pages = [
    page("parent"), page("other-parent", { folderId: "b" }),
    page("child", { parentPageId: "parent" }), page("other-child", { parentPageId: "parent" }),
    page("grandchild", { parentPageId: "child" }), page("other-grandchild", { parentPageId: "other-child" }),
    page("child-hidden", { parentPageId: "child", trashedAt: now }),
    page("under-trash-folder", { folderId: "trash-folder" }),
    page("owner", { title: "数据库", pageType: "database", databaseSourceId: "source-a" }),
    page("record-a1"), page("record-a2"), page("record-b1"), page("record-b2"),
    page("record-b-trashed-item"),
    ...Array.from({ length: 12 }, (_, index) => page(`page-${index}`, { folderId: "b" })),
  ];
  const favorites = pages.slice(-12).map(({ id }) => id);
  return {
    folders, pages,
    databaseItems: [
      { pageId: "record-a1", sourceId: "source-a" }, { pageId: "record-a2", sourceId: "source-a" },
      { pageId: "record-b1", sourceId: "source-b" }, { pageId: "record-b2", sourceId: "source-b" },
      { pageId: "record-b-trashed-item", sourceId: "source-b", trashedAt: now },
    ],
    dataSources: [
      { id: "source-a", ownerPageId: "owner", title: "来源一" },
      { id: "source-b", ownerPageId: "owner", title: "来源二" },
    ],
    ui: { favoritePageIds: [...favorites, favorites[0]], recentVisits: [...favorites, "child-hidden"].map((pageId) => ({ pageId, visitedAt: now })) },
  };
}

test("the library uses original page IDs and all stored favorites and recents", () => {
  const workspace = navigationWorkspace();
  const [privatePages, favorites, recentPages] = createWorkspaceNavigation(workspace).libraryGroups(new Date(now).getTime());
  const ids = privatePages.entries.map(({ id }) => id);
  assert.equal(ids.length, workspace.pages.length - 3);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(favorites.entries.length, 12);
  assert.deepEqual(favorites.entries.map(({ id }) => id), recentPages.entries.map(({ id }) => id));
  assert.equal(privatePages.entries.find(({ id }) => id === "grandchild").path, "Private / 主题 A / 同名 / 同名");
});

test("breadcrumb siblings follow folder, page ownership and actual database item sources", () => {
  const navigation = createWorkspaceNavigation(navigationWorkspace());
  const trail = (id) => navigation.breadcrumbs(id, null);
  const idsAt = (path, index) => path[index].alternatives.map(({ id }) => id);
  const ordinary = trail("grandchild");
  assert.deepEqual(ordinary.map(({ id }) => id), ["a", "parent", "child", "grandchild"]);
  assert.deepEqual(idsAt(ordinary, 0), ["a", "b"]);
  assert.deepEqual(idsAt(ordinary, 2), ["child", "other-child"]);
  assert.deepEqual(idsAt(ordinary, 3), ["grandchild"]);
  const record = trail("record-b2");
  assert.deepEqual(record.map(({ id }) => id), ["a", "owner", "source-b", "record-b2"]);
  assert.deepEqual(idsAt(record, 3), ["record-b1", "record-b2"]);
  assert.deepEqual(idsAt(trail("record-a1"), 3), ["record-a1", "record-a2"]);
});

test("archives stay out of ordinary navigation and remain accessible by their original IDs", () => {
  const workspace = navigationWorkspace();
  workspace.pages.find(({ id }) => id === "child").archivedAt = now;
  const navigation = createWorkspaceNavigation(workspace);
  assert.equal(navigation.canOpenPage("grandchild"), true);
  assert.equal(navigation.isVisiblePage("grandchild"), false);
  assert.deepEqual(navigation.libraryGroups(Date.parse(now), "archived")[0].entries.map(({ id }) => id), ["child", "grandchild"]);
  const path = navigation.breadcrumbs("other-child", null);
  assert.deepEqual(path.at(-1).alternatives.map(({ id }) => id), ["other-child"]);
});

test("library archive filters retain favorite and recent IDs while the sidebar hides archived pages", () => {
  const workspace = navigationWorkspace();
  for (const id of ["child", "owner"]) workspace.pages.find((page) => page.id === id).archivedAt = now;
  const archived = ["child", "grandchild", "record-a1"];
  const visible = ["other-child"];
  const ids = [...archived, ...visible, "child-hidden", "under-trash-folder", "missing", "grandchild"];
  workspace.ui.favoritePageIds = ids;
  workspace.ui.recentVisits = ids.map((pageId) => ({ pageId, visitedAt: now }));
  const time = Date.parse(now);
  const navigation = createWorkspaceNavigation(workspace);
  for (const [status, expected] of [["active", visible], ["archived", archived], ["all", [...archived, ...visible]]]) {
    const [, favorites, recents] = navigation.libraryGroups(time, status);
    assert.deepEqual(favorites.entries.map(({ id }) => id), expected, `${status} favorites`);
    assert.deepEqual(recents.entries.map(({ id }) => id), expected, `${status} recents`);
    assert.ok(recents.entries.every(({ visitedAt }) => visitedAt === now));
  }
  assert.deepEqual(favoritePages(workspace).map(({ id }) => id), visible);
  assert.deepEqual(recentGroups(workspace, time).flatMap(({ entries }) => entries).map(({ pageId }) => pageId), visible);
});

test("device preferences keep workspace tab sessions separate and recover valid IDs", () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value) };
  assert.equal(readDevicePreferences(storage).reopenPageTabs, false);
  updateDevicePreferences({ contrast: "high", sidebarSections: { private: false }, databaseViewTabDisplay: "icon" }, storage);
  updateDevicePreferences({ reopenPageTabs: true, pageTabs: { first: { ids: ["parent", "missing", "child-hidden", "parent"], activeId: "missing" } } }, storage);
  updateDevicePreferences({ pageTabs: { second: { ids: ["other-parent"], activeId: "other-parent" } }, sidebarSections: { favorites: false } }, storage);
  const settings = readDevicePreferences(storage);
  assert.equal(settings.contrast, "high");
  assert.equal(settings.databaseViewTabDisplay, "icon");
  assert.deepEqual(settings.sidebarSections, { private: false, favorites: false, recents: true });
  const navigation = createWorkspaceNavigation(navigationWorkspace());
  assert.deepEqual(restoreWorkspacePageTabs(settings, "first", navigation), { ids: ["parent"], activeId: "parent" });
  assert.deepEqual(restoreWorkspacePageTabs(settings, "second", navigation), { ids: ["other-parent"], activeId: "other-parent" });
  values.set(DEVICE_PREFERENCES_KEY, "invalid");
  assert.equal(readDevicePreferences(storage).contrast, "system");
  const denied = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
  assert.equal(updateDevicePreferences({ contrast: "high" }, denied).contrast, "high");
});

test("contrast updates leave the light or dark preference independent", () => {
  const root = { dataset: {} };
  applyTheme("dark", root);
  applyContrast("high", root);
  assert.deepEqual(root.dataset, { style: "mobai", theme: "dark", contrast: "high", resolvedContrast: "high" });
  applyTheme("light", root);
  assert.equal(root.dataset.resolvedContrast, "high");
  applyContrast("standard", root);
  assert.equal(root.dataset.theme, "light");
  assert.equal(root.dataset.resolvedContrast, "standard");
});
