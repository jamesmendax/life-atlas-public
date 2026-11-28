import test from "node:test";
import assert from "node:assert/strict";
import { createDatabaseView, projectViewItems } from "../src/domain/database.js";
import { cartesianChartLayout, chartAreaPath, chartLinePath } from "../src/domain/cartesianChart.js";
import { buildChartSvg } from "../src/domain/chartImageExport.js";
import { chartProjection } from "../src/domain/viewProjections.js";

const typeProperty = { id: "category", name: "阶段", type: "select", options: [
  { id: "a", name: "同名", color: "orange" }, { id: "b", name: "同名", color: "green" }, { id: "c", name: "未使用", color: "blue" },
] };
const groupProperty = { id: "team", name: "部门", type: "select", options: [
  { id: "x", name: "编辑", color: "purple" }, { id: "y", name: "设计", color: "green" }, { id: "z", name: "其他", color: "gray" },
] };
const categoryProperty = { id: "date", name: "日期", type: "date" };
const source = { id: "source", properties: [typeProperty, groupProperty, categoryProperty, { id: "amount", name: "金额", type: "number" }] };
const row = (id, category, team, date, amount) => ({ id, sourceId: "source", pageId: id, values: { category, team, date, amount } });
const items = [row("a1", "a", "x", "2026-01-02", 10), row("b1", "b", "y", "2026-01-12", 5),
  row("a2", "a", "x", "2026-02-01", -14), row("a3", "a", "x", "2026-02-15", null),
  row("b2", "b", "y", "2026-03-01", 7), row("missing", "b", "x", null, 13)];
const buildWorkspace = () => ({ dataSources: [structuredClone(source)], databaseItems: structuredClone(items), pages: [] });
const sumTime = { kind: "line", xPropertyId: "date", groupPropertyId: "team", valuePropertyId: "amount", aggregation: "sum", dateInterval: "month", sort: "category_asc", cumulative: true };
const viewProjection = (workspace, config) => chartProjection(workspace, workspace.dataSources[0], workspace.databaseItems, config);

test("visibility follows typed option fingerprints through rename without mixing equal labels or date intervals", () => {
  const workspace = buildWorkspace();
  const config = { kind: "column", aggregation: "count", xPropertyId: "category", groupPropertyId: "team" };
  const before = viewProjection(workspace, config);
  const [first, second] = before.categoryOptions;
  assert.equal(first.label, second.label);
  assert.notEqual(first.key, second.key);
  workspace.dataSources[0].properties[0].options[0].name = "已修改";
  const saved = JSON.parse(JSON.stringify({ ...config, hiddenCategories: [first.key] }));
  const after = viewProjection(workspace, saved);
  assert.deepEqual(after.categories.map(entry => entry.label), ["同名"]);
  assert.equal(after.categoryOptions[0].label, "已修改");
  assert.equal(after.categoryOptions[0].hidden, true);
  assert.equal(after.total, 3);
  assert.equal(workspace.databaseItems.length, 6);

  const month = viewProjection(workspace, sumTime);
  const january = month.categories[0].key;
  assert.equal(viewProjection(workspace, { ...sumTime, hiddenCategories: [january] }).categories.some(entry => entry.key === january), false);
  assert.equal(viewProjection(workspace, { ...sumTime, dateInterval: "day", hiddenCategories: [january] }).categories.length, 6);
});

test("zero count categories and series are drawn without synthetic records while sum stays missing", () => {
  const workspace = buildWorkspace();
  const config = { kind: "column", aggregation: "count", xPropertyId: "category", groupPropertyId: "team", showEmptyCategories: true, showEmptySeries: true };
  const count = viewProjection(workspace, config);
  const zero = count.points.find(point => point.label === "未使用" && point.group === "其他");
  assert.equal(zero.value, 0);
  assert.deepEqual(zero.itemIds, []);
  assert.equal(count.total, 6);
  const sum = viewProjection(workspace, { ...config, aggregation: "sum", valuePropertyId: "amount" });
  assert.equal(sum.points.find(point => point.key === zero.key).value, null);
});

test("ascending signed accumulation is per series, carries known totals through gaps and saves correct raw drilldowns", () => {
  const workspace = buildWorkspace();
  const projection = viewProjection(workspace, sumTime);
  const selection = (date, team) => projection.points.find(point => point.label === date && point.group === team);
  assert.equal(selection("2026年1月", "编辑").value, 10);
  assert.equal(selection("2026年2月", "编辑").value, -4);
  assert.deepEqual(selection("2026年3月", "编辑").itemIds, ["a1", "a2"]);
  assert.equal(selection("2026年2月", "设计").value, 5);
  assert.equal(selection("2026年3月", "设计").value, 12);
  assert.equal(selection("未设置", "编辑").value, 13);
  assert.equal(selection("未设置", "编辑").breakBefore, true);
  assert.equal(selection("未设置", "编辑").cumulative, undefined);
  const point = selection("2026年3月", "编辑");
  const slice = createDatabaseView({ sourceId: source.id, type: "table", config: { chartSlice: { ...sumTime, bucketKeys: point.sliceBucketKeys } } });
  assert.deepEqual(projectViewItems(workspace, slice).map(item => item.id), ["a1", "a2"]);
  workspace.databaseItems.push(row("later", "b", "x", "2026-03-30", 2), row("too-late", "b", "x", "2026-04-01", 30));
  assert.deepEqual(projectViewItems(workspace, slice).map(item => item.id), ["a1", "a2", "later"]);
  assert.equal(viewProjection(workspace, { ...sumTime, sort: "category_desc" }).cumulative, false);
  assert.equal(viewProjection(workspace, { ...sumTime, aggregation: "average" }).cumulative, false);
  const count = viewProjection(workspace, { ...sumTime, aggregation: "count" });
  assert.equal(count.points.find(point => point.label === "2026年3月" && point.group === "编辑").value, 4);
});

test("smooth lines interpolate the original coordinates and each gradient closes at zero", () => {
  const line = [[0, 7], [12, 2], [24, 9]];
  assert.equal(chartLinePath(line, false), "M0,7 L12,2 L24,9");
  assert.equal(chartLinePath(line, true), "M0,7 C6,7 6,2 12,2 C18,2 18,9 24,9");
  assert.match(chartAreaPath(line, true, 10), /L24,10 L0,10 Z$/);
  const projection = viewProjection(buildWorkspace(), sumTime);
  const plot = cartesianChartLayout(projection.points, { kind: "line", categories: projection.categories });
  const editor = plot.series.find(series => series.label === "编辑");
  assert.deepEqual(editor.runs.map(run => run.map(mark => mark.point.label)), [["2026年1月", "2026年2月", "2026年3月"], ["未设置"]]);
});

test("five export renderers produce standalone SVG and embed the actual configured geometry", () => {
  const name = '编辑部 <测试> & "原稿"';
  const workspace = buildWorkspace();
  for (const [kind, pattern] of [["bar", /<rect/], ["column", /<rect/], ["line", /<linearGradient/], ["donut", /<path/], ["number", /条记录/]]) {
    const config = { ...sumTime, kind, aggregation: kind === "donut" ? "count" : "sum", showValues: true, showLegend: false, gradientArea: true, smoothLine: true };
    const projection = viewProjection(workspace, config);
    const { svg, width, height } = buildChartSvg({ title: name, projection, config, categoryProperty, groupProperty, background: false });
    assert.match(svg, new RegExp(`^<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"`));
    assert.match(svg, /编辑部 &lt;测试&gt; &amp; &quot;原稿&quot;/);
    assert.match(svg, pattern);
    assert.doesNotMatch(svg, /<foreignObject|<script|<image|href=|NaN|Infinity/);
    assert.doesNotMatch(svg, /<rect x="0" y="0"/);
    if (kind === "line") assert.match(svg, / C[\d.]+,/);
  }
});
