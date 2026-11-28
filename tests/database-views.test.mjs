import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CHART_KINDS } from "../src/domain/viewRegistry.js";

import {
  DATABASE_VIEW_TYPES,
  createDataSource,
  createDatabaseItem,
  createDatabaseView,
  createLinkedView,
  ensureMapPlaceProperty,
  groupViewItems,
  projectViewItems,
  updateDatabaseView,
} from "../src/domain/database.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const sourceCode = fs.readFileSync(path.join(root, "src", "components", "DatabaseView.jsx"), "utf8");

test("new map views add one usable place field, preserve existing text and respect source locks", () => {
  const source = createDataSource({ id: "projects", ownerPageId: "owner", properties: [
    { id: "title", name: "名称", type: "title" }, { id: "place", name: "地点", type: "text" },
  ] });
  const table = createDatabaseView({ sourceId: source.id, type: "table", visiblePropertyIds: ["title", "place"] });
  const map = createDatabaseView({ sourceId: source.id, type: "map" });
  const original = { pages: [{ id: "owner" }], dataSources: [source], databaseViews: [table, map], databaseItems: [{ values: { place: "保留的地址文字" } }] };
  const prepared = ensureMapPlaceProperty(original, map, "2026-11-25T08:30:00Z", () => "new-place");
  assert.deepEqual(prepared.dataSources[0].properties.map(p => [p.name, p.type]), [["名称","title"],["地点","text"],["地图地点","place"]]);
  assert.deepEqual(prepared.databaseViews[0].visiblePropertyIds, ["title","place","new-place"]);
  assert.equal(prepared.databaseItems, original.databaseItems);
  assert.equal(ensureMapPlaceProperty(prepared, map), prepared);
  assert.equal(ensureMapPlaceProperty(original, table), original);
  const locked = { ...original, pages: [{ id: "owner", settings: { locked: true } }] };
  assert.equal(ensureMapPlaceProperty(locked, map), locked);
});

test("all registered database views are represented by the shared DatabaseView component", () => {
  for (const type of DATABASE_VIEW_TYPES) {
    assert.match(sourceCode, new RegExp(type));
  }
  assert.match(sourceCode, /DatabaseTable/);
  assert.match(sourceCode, /DatabaseBoard/);
  assert.match(sourceCode, /DatabaseList/);
  assert.match(sourceCode, /DatabaseGallery/);
  assert.match(sourceCode, /DatabaseCalendar/);
  assert.match(sourceCode, /DatabaseTimeline/);
});

test("changing a view type never copies DataSource items", () => {
  const source = createDataSource({ id:"source", title:"Source" });
  const item = createDatabaseItem({ id:"item", sourceId:source.id, pageId:"page", values:{ title:"One" } });
  const workspace = { dataSources:[source], databaseItems:[item], databaseViews:[], pages:[], relations:[] };
  let view = createDatabaseView({ id:"view", sourceId:source.id, type:"table" });
  const itemIdentity = workspace.databaseItems[0];
  for (const type of DATABASE_VIEW_TYPES) {
    view = updateDatabaseView(view, { type });
    assert.equal(view.sourceId, source.id);
    assert.equal(projectViewItems(workspace, view)[0], itemIdentity);
    assert.equal(workspace.databaseItems.length, 1);
  }
});

test("linked views reference the same source while keeping independent filter/sort/group config", () => {
  const source = createDataSource({ id:"source", title:"Source" });
  const table = createDatabaseView({ sourceId:source.id, type:"table", filter:{propertyId:"status",operator:"equals",value:"todo"} });
  const linked = createLinkedView(source.id, { type:"board", groupBy:"status", sorts:[{propertyId:"date",direction:"asc"}] });
  assert.equal(linked.sourceId, table.sourceId);
  assert.equal(linked.linked, true);
  assert.equal(linked.type, "board");
  assert.equal(linked.groupBy, "status");
  assert.notDeepEqual(linked.filter, table.filter);
  assert.deepEqual(linked.sorts, [{propertyId:"date",direction:"asc"}]);
});

test("promoted chart, form, dashboard and map views retain real component paths", () => {
  const implementations = fs.readFileSync(path.join(root, "src", "components", "DatabasePresentations.jsx"), "utf8");
  for (const type of ["chart", "form", "dashboard", "map"]) {
    assert.match(sourceCode, new RegExp(`case "${type}"`));
    assert.equal(createDatabaseView({ sourceId: "source", type }).type, type);
  }
  for (const chart of ["bar", "line", "donut", "number"]) {
    assert.ok(CHART_KINDS.includes(chart));
    assert.match(implementations, new RegExp(`"${chart}"`));
  }
  assert.match(sourceCode, /onCreateItem/);
  assert.match(sourceCode, /DatabaseDashboard/);
  assert.match(implementations, /validateFormValues/);
  assert.match(implementations, /import\("\.\/DatabaseMap\.jsx"\)/);
  const map = fs.readFileSync(path.join(root, "src", "components", "DatabaseMap.jsx"), "utf8");
  assert.match(map, /attachDatabaseTiles\(map,/);
  assert.match(map, /L\.geoJSON\(land,/);
});

test("array-valued grouping keeps empty and null values under ungrouped without changing populated groups", () => {
  const source = createDataSource({ id: "source", properties: [
    { id: "title", name: "名称", type: "title" },
    { id: "labels", name: "标签", type: "multi_select", options: [{ id: "a", name: "A" }, { id: "b", name: "B" }] },
    { id: "people", name: "人员", type: "people" },
  ] });
  for (const propertyId of ["labels", "people"]) {
    const items = [
      createDatabaseItem({ id: "empty", sourceId: source.id, pageId: "p-empty", values: { [propertyId]: [] } }),
      createDatabaseItem({ id: "missing", sourceId: source.id, pageId: "p-missing", values: {} }),
      createDatabaseItem({ id: "filled", sourceId: source.id, pageId: "p-filled", values: { [propertyId]: ["a", "b"] } }),
    ];
    const view = createDatabaseView({ sourceId: source.id, type: "board", groupBy: propertyId });
    const workspace = { dataSources: [source], databaseItems: items, pages: [], relations: [] };
    const groups = groupViewItems(workspace, view, items);
    assert.deepEqual(groups.find(group => group.key === "未分组")?.items.map(item => item.id), ["empty", "missing"]);
    assert.deepEqual(groups.find(group => group.key === "a")?.items.map(item => item.id), ["filled"]);
    assert.deepEqual(groups.find(group => group.key === "b")?.items.map(item => item.id), ["filled"]);
  }
});

test("choice groups use current options without rewriting historic values in either grouping dimension", () => {
  const source = createDataSource({ id: "choice-groups", properties: [
    { id: "labels", name: "标签", type: "multi_select", options: [{ id: "active", name: "使用中" }] },
    { id: "category", name: "分类", type: "select", options: [{ id: "current", name: "现用分类" }] },
    { id: "status", name: "状态", type: "status", config: { defaultOptionId: "todo" }, options: [
      { id: "done", name: "完成", group: "complete" }, { id: "todo", name: "待办", group: "todo" },
    ] },
  ] });
  const items = [
    { id: "mixed", sourceId: source.id, values: { labels: ["active", "old-label", "active"], category: "current", status: "old-status" } },
    { id: "retired", sourceId: source.id, values: { labels: ["old-label"], category: "old-category", status: "done" } },
    { id: "default", sourceId: source.id, values: { labels: ["active"], category: "current" } },
  ];
  const previous = structuredClone(items);
  const workspace = { dataSources: [source], databaseItems: items };
  const groupsFor = (primaryPropertyId, secondaryPropertyId, order = []) => groupViewItems(workspace, createDatabaseView({
    sourceId: source.id, type: "board", grouping: { primaryPropertyId, secondaryPropertyId, order, showEmpty: false },
  }), items);
  const summary = groups => groups.map(group => [group.key, group.items.map(item => item.id)]);

  const combined = groupsFor("labels", "status", ["old-label", "active", "未分组"]);
  assert.deepEqual(summary(combined), [["active", ["mixed", "default"]], ["未分组", ["retired"]]]);
  assert.deepEqual(summary(combined[0].secondaryGroups), [["未分组", ["mixed"]], ["todo", ["default"]]]);
  assert.deepEqual(summary(combined[1].secondaryGroups), [["done", ["retired"]]]);
  assert.deepEqual(summary(groupsFor("category", "labels", ["current", "未分组"])), [["current", ["mixed", "default"]], ["未分组", ["retired"]]]);
  const statuses = groupsFor("status", "category", ["old-status"]);
  assert.deepEqual(summary(statuses), [["todo", ["default"]], ["done", ["retired"]], ["未分组", ["mixed"]]]);
  assert.deepEqual(summary(statuses[1].secondaryGroups), [["未分组", ["retired"]]]);
  assert.deepEqual(items, previous);
});

test("a saved empty unassigned group follows explicit position, empty-group setting and visibility", () => {
  const source = createDataSource({ id: "gallery-choices", properties: [
    { id: "choice", name: "分类", type: "select", options: [{ id: "a", name: "A" }, { id: "b", name: "B" }] },
  ] });
  const items = [{ id: "a", sourceId: source.id, values: { choice: "a" } }];
  const workspace = { dataSources: [source], databaseItems: items };
  const result = (grouping) => groupViewItems(workspace, createDatabaseView({ sourceId: source.id, type: "gallery", grouping: {
    primaryPropertyId: "choice", order: ["b", "未分组", "a"], showEmpty: true, ...grouping,
  } }), items).map(group => [group.key, group.items.length]);
  assert.deepEqual(result({}), [["b", 0], ["未分组", 0], ["a", 1]]);
  assert.deepEqual(result({ hiddenGroupKeys: ["未分组"] }), [["b", 0], ["a", 1]]);
  assert.deepEqual(result({ showEmpty: false }), [["a", 1]]);
  assert.deepEqual(result({ order: ["b", "a"] }), [["b", 0], ["a", 1]]);
});
