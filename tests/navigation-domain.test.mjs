import test from "node:test";
import assert from "node:assert/strict";
import { recordVisit, recentGroups } from "../src/domain/recents.js";
import { toggleFavorite, moveFavorite, favoritePages } from "../src/domain/favorites.js";
import { greeting, upcomingRecords } from "../src/domain/home.js";
import { createHistory, pushLocation, goBack, goForward } from "../src/domain/navigationHistory.js";
import { canDropSidebarNode, moveSidebarNode } from "../src/domain/sidebarDrag.js";
import { fullWorkspace } from "./fixtures/full-workspace.mjs";

test("recordVisit keeps the newest visit per page and at most one hundred", () => {
  let ui = { untouched: "kept" };
  const start = new Date(2026, 10, 7, 12).getTime();
  for (let index = 0; index < 105; index += 1) ui = recordVisit(ui, `page-${index}`, new Date(start + index * 1000).toISOString());
  const original = structuredClone(ui);
  const next = recordVisit(ui, "page-50", new Date(start + 106000).toISOString());
  assert.equal(next.recentVisits.length, 100);
  assert.equal(next.recentVisits[0].pageId, "page-50");
  assert.equal(next.recentVisits.filter((entry) => entry.pageId === "page-50").length, 1);
  assert.equal(next.untouched, "kept");
  assert.deepEqual(ui, original);
  assert.deepEqual(recordVisit(next, "page-50", new Date(start).toISOString()), next);
  assert.equal(next.pageOpenCounts["page-50"], 2);
  assert.equal(recordVisit(next, "page-50", next.recentVisits[0].visitedAt), next);
  const tied = recordVisit(recordVisit({}, "first", new Date(start).toISOString()), "second", new Date(start).toISOString());
  assert.deepEqual(tied.recentVisits.map((entry) => entry.pageId), ["second", "first"]);
});

test("recentGroups splits today yesterday last week and earlier and skips trashed pages", () => {
  const workspace = fullWorkspace();
  const visible = workspace.pages.filter((page) => !page.trashedAt).slice(0, 5);
  const now = new Date(2026, 10, 7, 12).getTime();
  const dates = [new Date(2026, 10, 7, 8), new Date(2026, 10, 6, 8), new Date(2026, 10, 3, 8), new Date(2026, 9, 20, 8), new Date(2026, 10, 7, 9)];
  workspace.ui.recentVisits = visible.map((page, index) => ({ pageId: page.id, visitedAt: dates[index].toISOString() }));
  visible[4].trashedAt = dates[4].toISOString();
  workspace.ui.recentVisits.push({ pageId: "missing", visitedAt: dates[0].toISOString() });
  const groups = recentGroups(workspace, now);
  assert.deepEqual(groups.map((group) => group.label), ["今天", "昨天", "过去 7 天", "更早"]);
  assert.deepEqual(groups.map((group) => group.entries.length), [1, 1, 1, 1]);
  assert.match(groups[0].entries[0].path, /^Private \/ /);
});

test("favorites toggle and reorder", () => {
  let ui = toggleFavorite({}, "p-a");
  ui = toggleFavorite(ui, "p-b");
  ui = toggleFavorite(ui, "p-z");
  assert.deepEqual(moveFavorite(ui, "p-z", 0).favoritePageIds, ["p-z", "p-a", "p-b"]);
  assert.deepEqual(toggleFavorite(ui, "p-b").favoritePageIds, ["p-a", "p-z"]);
  const workspace = fullWorkspace();
  workspace.ui = { ...workspace.ui, favoritePageIds: ["p-b1", "missing", "p-a1", "p-z1"] };
  workspace.pages.find((page) => page.id === "p-a1").trashedAt = "2026-11-07T12:00:00.000Z";
  assert.deepEqual(favoritePages(workspace).map((page) => page.id), ["p-b1", "p-z1"]);
});

test("greeting follows the local hour", () => {
  for (const [hour, minute, expected] of [[5, 0, "早上好"], [10, 59, "早上好"], [11, 0, "下午好"], [17, 59, "下午好"], [18, 0, "晚上好"], [4, 59, "晚上好"]]) assert.equal(greeting(new Date(2026, 10, 7, hour, minute).getTime()), expected);
});

test("upcoming records include the next seven days only", () => {
  const workspace = fullWorkspace();
  workspace.databaseItems.find((item) => item.id === "i-1").values.due = { start: "2026-11-10", end: null };
  workspace.databaseItems.find((item) => item.id === "i-2").values.due = { start: "2026-11-17", end: null };
  workspace.databaseItems.find((item) => item.id === "i-3").values.due = { start: "2026-11-14", end: null };
  assert.deepEqual(upcomingRecords(workspace, "2026-11-07").map((entry) => entry.pageId), ["p-rec-1"]);
  workspace.pages.find((page) => page.id === "p-rec-1").trashedAt = "2026-11-07T12:00:00.000Z";
  assert.deepEqual(upcomingRecords(workspace, "2026-11-07"), []);
});

test("history push back and forward skip invalid locations", () => {
  let history = createHistory();
  const home = { section: "home" };
  const first = { section: "private", pageId: "p-a", folderId: "f-a" };
  const removed = { section: "private", pageId: "p-b", folderId: "f-b" };
  const last = { section: "recents" };
  for (const location of [home, first, removed, last]) history = pushLocation(history, location);
  assert.equal(pushLocation(history, last), history);
  const valid = (location) => location.pageId !== "p-b";
  const back = goBack(history, valid);
  assert.deepEqual(back.location, first);
  assert.deepEqual(goForward(back.history, valid).location, last);
  const branch = pushLocation(back.history, { section: "trash" });
  assert.equal(goForward(branch, valid).location, null);
  assert.equal(branch.entries.length, 3);
  for (let index = 0; index < 60; index += 1) history = pushLocation(history, { section: "private", pageId: `page-${index}` });
  assert.equal(history.entries.length, 50);
  assert.equal(history.index, 49);
});

test("marketplace history distinguishes discovery and individual listings", () => {
  const page = { section: "private", pageId: "p-a", folderId: "f-a" };
  const discovery = { section: "market" };
  const template = { section: "market", marketItemKey: "builtin:software-roadmap" };
  const widget = { section: "market", marketItemKey: "official:world-clock" };
  const history = [page, discovery, template, widget].reduce(pushLocation, createHistory());
  assert.deepEqual(history.entries, [page, discovery, template, widget]);
  assert.equal(pushLocation(history, { ...widget }), history);

  const valid = () => true;
  const backToTemplate = goBack(history, valid);
  const backToDiscovery = goBack(backToTemplate.history, valid);
  assert.deepEqual(backToTemplate.location, template);
  assert.deepEqual(backToDiscovery.location, discovery);
  assert.equal(pushLocation(backToDiscovery.history, { ...discovery, marketItemKey: null }), backToDiscovery.history);
  assert.deepEqual(goBack(backToDiscovery.history, valid).location, page);
  assert.deepEqual(goForward(backToDiscovery.history, valid).location, template);
});

test("sidebar drops preserve sibling order and reject folder cycles", () => {
  const input = fullWorkspace();
  const before = structuredClone(input);
  assert.equal(canDropSidebarNode(input, { kind: "folder", id: "f-a" }, { kind: "folder", id: "f-c" }, "inside"), false);
  assert.equal(moveSidebarNode(input, { kind: "folder", id: "f-a" }, { kind: "folder", id: "f-c" }, "inside", "2026-11-07"), input);
  const moved = moveSidebarNode(input, { kind: "page", id: "p-a1" }, { kind: "folder", id: "f-z" }, "inside", "2026-11-07");
  assert.equal(moved.pages.find((page) => page.id === "p-a1").folderId, "f-z");
  const sorted = moveSidebarNode(moved, { kind: "page", id: "p-a1" }, { kind: "page", id: "p-z1" }, "before", "2026-11-07");
  assert.equal(sorted.pages.find((page) => page.id === "p-a1").sortIndex, 10);
  assert.equal(sorted.pages.find((page) => page.id === "p-z1").sortIndex, 20);
  assert.deepEqual(input, before);
});

test("sidebar drag promotes nested folders to root via root drop zones or root sibling gaps and blocks ancestor cycles", () => {
  const input = fullWorkspace();
  // f-b is a child of f-a, f-c is a child of f-b; f-a and f-z are root folders.
  assert.equal(canDropSidebarNode(input, { kind: "folder", id: "f-b" }, { kind: "folder", id: "f-z" }, "after"), true);
  assert.equal(canDropSidebarNode(input, { kind: "folder", id: "f-b" }, { kind: "folder", id: "f-a" }, "before"), true);
  assert.equal(canDropSidebarNode(input, { kind: "folder", id: "f-b" }, { kind: "root", id: null }, "after"), true);
  assert.equal(canDropSidebarNode(input, { kind: "folder", id: "f-b" }, { kind: "root", id: null }, "before"), true);
  // Cycle prevention: f-a cannot be dropped before/after its own child f-b or grandchild f-c.
  assert.equal(canDropSidebarNode(input, { kind: "folder", id: "f-a" }, { kind: "folder", id: "f-b" }, "before"), false);
  assert.equal(canDropSidebarNode(input, { kind: "folder", id: "f-a" }, { kind: "folder", id: "f-c" }, "after"), false);

  const promotedAfterZ = moveSidebarNode(input, { kind: "folder", id: "f-b" }, { kind: "folder", id: "f-z" }, "after", "2026-11-07");
  assert.equal(promotedAfterZ.folders.find((f) => f.id === "f-b").parentId, null);
  assert.ok(promotedAfterZ.folders.find((f) => f.id === "f-b").sortIndex > promotedAfterZ.folders.find((f) => f.id === "f-z").sortIndex);
  assert.equal(promotedAfterZ.folders.find((f) => f.id === "f-c").parentId, "f-b");

  const promotedToTop = moveSidebarNode(input, { kind: "folder", id: "f-b" }, { kind: "root", id: null }, "before", "2026-11-07");
  assert.equal(promotedToTop.folders.find((f) => f.id === "f-b").parentId, null);
  assert.equal(promotedToTop.folders.find((f) => f.id === "f-b").sortIndex, 10);

  const promotedToTail = moveSidebarNode(input, { kind: "folder", id: "f-b" }, { kind: "root", id: null }, "after", "2026-11-07");
  assert.equal(promotedToTail.folders.find((f) => f.id === "f-b").parentId, null);
  const maxRootSort = Math.max(...promotedToTail.folders.filter((f) => !f.trashedAt && f.parentId === null).map((f) => f.sortIndex));
  assert.equal(promotedToTail.folders.find((f) => f.id === "f-b").sortIndex, maxRootSort);
});
