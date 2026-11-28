import test from "node:test";
import assert from "node:assert/strict";
import { createDatabaseView, projectViewItems } from "../src/domain/database.js";
import { chartProjection } from "../src/domain/viewProjections.js";

const source = {
  id: "editorial", title: "内容选题",
  properties: [
    { id: "title", name: "选题名称", type: "title" },
    { id: "date", name: "发布日期", type: "date" },
    { id: "category", name: "栏目", type: "text" },
    { id: "series", name: "团队", type: "text" },
    { id: "value", name: "数值", type: "number" },
    { id: "active", name: "已确认", type: "checkbox" },
  ],
};

function item(id, values) {
  return { id, sourceId: source.id, pageId: "page-" + id, values: { title: id, active: true, ...values } };
}

const workspaceFor = databaseItems => ({ dataSources: [source], databaseItems, pages: [] });
const date = (start, timeZone = null, end = null) => ({ start, timeZone, end, includeTime: start.includes("T") });
const categories = projection => projection.categories.map(entry => entry.label);

test("chart sums distinguish pending data from a measured zero and retain the source rows", () => {
  const items = [item("unreported", { category: "尚未回传" }), item("zero", { category: "已核对", value: 0 })];
  const config = { xPropertyId: "category", aggregation: "sum", valuePropertyId: "value", sort: "value_asc" };
  const project = rows => chartProjection(workspaceFor(rows), source, rows, config);
  assert.deepEqual(project(items).points.map(({ value, itemIds }) => [value, itemIds]), [[0, ["zero"]], [null, ["unreported"]]]);
  assert.equal(project(items).total, 0);
  assert.equal(project(items.slice(0, 1)).total, null);
  assert.equal(chartProjection(workspaceFor([]), source, [], { aggregation: "count" }).total, 0);
});

test("date charts use chronological periods across years, including Monday weeks and blank dates", () => {
  const items = [
    item("october", { date: "2026-10-02" }), item("invalid", { date: "2026-02-30" }),
    item("monday", { date: "2026-01-05" }), item("sunday", { date: "2026-01-04" }),
    item("december-range", { date: date("2025-12-31", null, "2026-01-12") }), item("unset", {}),
  ];
  const workspace = workspaceFor(items);
  const project = (dateInterval, sort) => chartProjection(workspace, source, items, { xPropertyId: "date", dateInterval, sort });
  assert.deepEqual(categories(project("day")), ["2025-12-31", "2026-01-04", "2026-01-05", "2026-10-02", "未设置"]);
  assert.deepEqual(categories(project("week")), ["2025-12-29 周起", "2026-01-05 周起", "2026-09-28 周起", "未设置"]);
  assert.deepEqual(project("week").points[0].itemIds, ["sunday", "december-range"]);
  assert.deepEqual(project("week").points.at(-1).itemIds, ["invalid", "unset"]);
  assert.deepEqual(categories(project("month", "source")), ["2025年12月", "2026年1月", "2026年10月", "未设置"]);
  assert.deepEqual(categories(project("month", "category_desc")), ["2026年10月", "2026年1月", "2025年12月", "未设置"]);
  assert.deepEqual(categories(project("quarter")), ["2025年第4季度", "2026年第1季度", "2026年第4季度", "未设置"]);
  assert.deepEqual(categories(project("year")), ["2025年", "2026年", "未设置"]);
  assert.equal(project("day").total, items.length);
});

test("date chart buckets use the chosen timezone for instants and keep floating calendar dates", () => {
  const items = [
    item("floating", { date: date("2026-01-01T00:20", "America/Los_Angeles") }),
    item("west", { date: date("2026-01-01T01:00:00Z", "America/Los_Angeles") }),
    item("east", { date: date("2025-12-31T23:15:00-0800", "Asia/Shanghai") }),
    item("date-only", { date: date("2026-01-01", "America/Los_Angeles") }),
    item("invalid-zone", { date: date("2026-01-01T01:00:00Z", "Not/AZone") }),
  ];
  const projection = chartProjection(workspaceFor(items), source, items, { xPropertyId: "date", dateInterval: "day" });
  assert.deepEqual(projection.points.map(({ label, itemIds }) => [label, itemIds]), [
    ["2025-12-31", ["west"]], ["2026-01-01", ["floating", "east", "date-only"]], ["未设置", ["invalid-zone"]],
  ]);
});

test("an instant without a named zone uses the device calendar day", () => {
  const stamp = "2026-01-01T01:00:00Z";
  const instant = new Date(stamp);
  const expected = [instant.getFullYear(), instant.getMonth() + 1, instant.getDate()]
    .map((part, index) => String(part).padStart(index ? 2 : 4, "0")).join("-");
  const items = [item("device", { date: date(stamp) })];
  const projection = chartProjection(workspaceFor(items), source, items, { xPropertyId: "date", dateInterval: "day" });
  assert.deepEqual(projection.points.map(point => point.label), [expected]);
});

test("chart value sort compares the raw category aggregate, keeps series together, and distinguishes zero from null", () => {
  const items = [
    item("b2", { category: "B", series: "二", value: 10 }),
    item("a1", { category: "A", series: "一", value: 30.12345 }),
    item("b1", { category: "B", series: "一", value: 10 }),
    item("a2", { category: "A", series: "二", value: 0 }),
    item("a3", { category: "A", series: "二", value: 0 }),
    item("a4", { category: "A", series: "二", value: 0 }),
    item("c", { category: "C", series: "一", value: null }),
    item("d", { category: "D", series: "二", value: 0 }),
  ];
  const workspace = workspaceFor(items);
  const before = structuredClone(workspace);
  const project = sort => chartProjection(workspace, source, items, {
    xPropertyId: "category", groupPropertyId: "series", valuePropertyId: "value", aggregation: "average", sort,
  });
  assert.deepEqual(categories(project("source")), ["B", "A", "C", "D"]);
  assert.deepEqual(categories(project("category_asc")), ["A", "B", "C", "D"]);
  assert.deepEqual(categories(project("category_desc")), ["D", "C", "B", "A"]);
  assert.deepEqual(categories(project("value_desc")), ["B", "A", "D", "C"]);

  const ascending = project("value_asc");
  assert.deepEqual(categories(ascending), ["D", "A", "B", "C"]);
  assert.deepEqual(ascending.series, ["二", "一"]);
  assert.deepEqual(ascending.points.map(({ label, group, value, itemIds }) => [label, group, value, itemIds]), [
    ["D", "二", 0, ["d"]],
    ["A", "二", 0, ["a2", "a3", "a4"]], ["A", "一", 30.12345, ["a1"]],
    ["B", "二", 10, ["b2"]], ["B", "一", 10, ["b1"]],
    ["C", "一", null, ["c"]],
  ]);
  assert.equal(ascending.points[1].categoryKey, ascending.points[2].categoryKey);
  assert.equal(ascending.total, (10 + 30.12345 + 10) / 7);
  assert.deepEqual(workspace, before);
});

test("legacy exact drilldown preserves published key format, and the date interval only applies to a date property", () => {
  const items = [
    item("range", { date: date("2026-05-03", null, "2026-05-05"), category: "长文", series: "编辑" }),
    item("day", { date: "2026-05-03", category: "长文", series: "编辑" }),
  ];
  const workspace = workspaceFor(items);
  const basic = { xPropertyId: "date", groupPropertyId: "series" };
  const oldPointKey = JSON.stringify(["2026-05-03 → 2026-05-05", "编辑"]);
  const implicit = chartProjection(workspace, source, items, basic);
  const exact = chartProjection(workspace, source, items, { ...basic, dateInterval: "exact" });
  assert.deepEqual(implicit, exact);
  assert.equal(exact.points[0].key, oldPointKey);
  assert.deepEqual(projectViewItems(workspace, createDatabaseView({
    id: "old-slice", sourceId: source.id, type: "table", config: { chartSlice: { ...basic, key: oldPointKey } },
  })).map(entry => entry.id), ["range"]);
  const text = chartProjection(workspace, source, items, { xPropertyId: "category", dateInterval: "month" });
  assert.equal(text.dateInterval, "exact");
  assert.equal(text.points[0].key, JSON.stringify(["长文", ""]));
  assert.deepEqual(text.points[0].itemIds, ["range", "day"]);
});

test("saved month and series drilldown follows current records, view filters, search and trash", () => {
  const old = item("old", { title: "城市访谈", date: "2026-05-03", series: "编辑" });
  const moving = item("moving", { title: "城市新闻", date: "2026-05-04", series: "编辑" });
  const other = item("other", { title: "城市插画", date: "2026-05-03", series: "设计" });
  const items = [old, moving, other];
  const workspace = workspaceFor(items);
  const chart = { xPropertyId: "date", groupPropertyId: "series", dateInterval: "month" };
  const point = chartProjection(workspace, source, items, chart).points.find(entry => entry.group === "编辑");
  const saved = createDatabaseView({
    id: "date-slice", sourceId: source.id, type: "table",
    filter: { propertyId: "active", operator: "checked" },
    config: { chartSlice: { ...chart, key: point.key, query: "城市" } },
  });
  const selected = data => projectViewItems(data, saved).map(entry => entry.id);
  assert.deepEqual(selected(workspace), point.itemIds);
  const added = item("added", { title: "城市书单", date: "2026-05-17", series: "编辑" });
  const disabled = item("disabled", { title: "城市讨论", date: "2026-05-17", series: "编辑", active: false });
  const unrelated = item("unrelated", { title: "港口新闻", date: "2026-05-17", series: "编辑" });
  const moved = { ...moving, values: { ...moving.values, date: "2026-06-01" } };
  const latest = workspaceFor([moved, other, added, disabled, unrelated]);
  assert.deepEqual(selected(latest), ["added"]);
  assert.deepEqual(selected({ ...latest, pages: [{ id: added.pageId, trashedAt: "2026-06-01T00:00:00Z" }] }), []);
});
