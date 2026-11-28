import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { databaseItemPage, itemDisplayTitle, projectViewItems } from "../src/domain/database.js";
import { fullWorkspace } from "./fixtures/full-workspace.mjs";
import { bigWorkspace } from "./fixtures/big-workspace.mjs";

test("twenty thousand records use a linear page lookup for projection and titles", () => {
  const workspace = bigWorkspace();
  let pageReads = 0;
  workspace.pages = new Proxy(workspace.pages, { get(target, key, receiver) {
    if (typeof key === "string" && /^\d+$/.test(key)) pageReads += 1;
    return Reflect.get(target, key, receiver);
  } });
  const started = performance.now();
  const projected = projectViewItems(workspace, workspace.databaseViews[0]);
  const projectionMs = performance.now() - started;
  const titleStarted = performance.now();
  const titles = projected.map((item) => itemDisplayTitle(workspace, workspace.dataSources[0], item));
  const titleMs = performance.now() - titleStarted;
  assert.equal(projected.length, 20000);
  assert.deepEqual(projected.map((item) => item.id), Array.from({ length: 20000 }, (_, index) => `big-i-${index}`));
  assert.deepEqual(titles, Array.from({ length: 20000 }, (_, index) => `记录 ${index}`));
  assert.ok(pageReads <= workspace.pages.length * 2, `${pageReads} page element reads for ${workspace.pages.length} pages`);
  console.log(`WP10_PROJECTION_MS=${projectionMs.toFixed(3)} WP10_TITLES_MS=${titleMs.toFixed(3)} WP10_PAGE_READS=${pageReads}`);
});

test("projection preserves trash filtering, stable sorts, missing-page records and title fallback", () => {
  const workspace = fullWorkspace();
  const source = workspace.dataSources[0];
  const view = workspace.databaseViews[0];
  const first = workspace.databaseItems[0];
  const second = workspace.databaseItems[1];
  view.filter = { kind: "condition", propertyId: "status", operator: "equals", value: "doing" };
  assert.deepEqual(projectViewItems(workspace, view).map((item) => item.id), ["i-2"]);
  view.filter = null;
  first.values.title = "";
  assert.equal(itemDisplayTitle(workspace, source, first), "任务一");
  workspace.pages.find((page) => page.id === second.pageId).trashedAt = "2026-11-01T00:00:00.000Z";
  assert.deepEqual(projectViewItems(workspace, view).map((item) => item.id), ["i-1"]);
  workspace.pages = workspace.pages.filter((page) => page.id !== first.pageId && page.id !== second.pageId);
  assert.deepEqual(projectViewItems(workspace, view).map((item) => item.id), ["i-1", "i-2"]);
  assert.equal(itemDisplayTitle(workspace, source, first), "无标题");
  first.values.title = second.values.title = "相同";
  view.sorts = [{ propertyId: "title", direction: "desc" }];
  assert.deepEqual(projectViewItems(workspace, view).map((item) => item.id), ["i-1", "i-2"]);
});

test("page lookup retains the first duplicate and refreshes after immutable replacement", () => {
  const first = { id: "page", title: "first" };
  const workspace = { pages: [first, { id: "page", title: "second" }] };
  assert.equal(databaseItemPage(workspace, { pageId: "page" }), first);
  workspace.pages = [{ id: "page", title: "replacement" }];
  assert.equal(databaseItemPage(workspace, { pageId: "page" }).title, "replacement");
});
