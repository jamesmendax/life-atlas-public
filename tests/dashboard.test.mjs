import test from "node:test";
import assert from "node:assert/strict";
import { availableViews, dashboardProjection, dashboardRowHeight, dashboardRows, duplicateWidget, insertWidget, moveWidget, moveWidgetToRow, removeWidget, resizeWidget, widgetResizeBounds, widthOf } from "../src/domain/dashboard.js";
import { coreParityWorkspace } from "./fixtures/core-parity-workspace.mjs";
import { initialViewConfig, normalizeViewConfig, suggestedChart } from "../src/domain/viewRegistry.js";

function fixture() {
  const workspace = coreParityWorkspace();
  const primary = workspace.dataSources[0];
  const dashboard = workspace.databaseViews.find(v => v.type==="dashboard");
  const view = {id:"partner-watch",sourceId:"partners",type:"table",name:"供应方评分表",filter:{propertyId:"rating",operator:"greater_than",value:1},sorts:[{propertyId:"rating",direction:"desc"}],groupBy:"other"};
  workspace.databaseViews.push(view);
  workspace.databaseItems.push({id:"p2",sourceId:"partners",pageId:"p2-page",values:{title:"二号",rating:2}});
  const widget = {type:"view",sourceId:"partners",viewId:view.id};
  return {workspace,primary,dashboard,view,widget};
}

test("a device filter referencing a removed primary field does not hide all records", () => {
  const f = fixture();
  const input = { ...f, widget: {type:"metric", sourceId:f.primary.id} };
  const original = dashboardProjection({...input,globalFilters:[]});
  const stale = dashboardProjection({...input,globalFilters:[{propertyId:"removed-number",operator:"greater_than",value:10}]});
  assert.deepEqual(stale.items.map(item=>item.id),original.items.map(item=>item.id));
  assert.equal(stale.unmapped,1);
});

test("new charts count meaningful categories; ungrouped sources show one total", () => {
  const text = { id: "title", name: "选题", type: "title" };
  const choice = { id: "genre", name: "类型", type: "select" };
  const stage = { id: "stage", name: "制作阶段", type: "status" };
  const source = { properties: [text, choice, stage] };
  assert.deepEqual(initialViewConfig("chart", source).chart, { kind: "donut", aggregation: "count", xPropertyId: "stage" });
  assert.equal(suggestedChart({ properties: [text, choice] }).xPropertyId, "genre");
  assert.deepEqual(suggestedChart({ properties: [text] }), { kind: "number", aggregation: "count" });
  assert.deepEqual(initialViewConfig("dashboard", source).dashboard.widgets, []);
  assert.deepEqual(initialViewConfig("dashboard", { properties: [text] }).dashboard.widgets, []);
  const saved = { chart: { kind: "bar", xPropertyId: null, aggregation: "count" } };
  assert.equal(initialViewConfig("chart", source, saved), saved);
  assert.equal(normalizeViewConfig("chart", saved).chart.xPropertyId, null);
  const empty = { dashboard: { widgets: [], globalFilters: [] } };
  assert.equal(initialViewConfig("dashboard", source, empty), empty);
});
test("explicit cross-source mapping intersects saved filters and retains source grouping and order",()=>{
  const f=fixture();
  const filter={propertyId:"amount",operator:"greater_than",value:3,mappings:{partners:"rating"}};
  const a=dashboardProjection({...f,globalFilters:[filter]});
  assert.equal(a.view,f.view); assert.deepEqual(a.items.map(i=>i.id),["partner-one"]); assert.equal(a.unmapped,0);
  assert.equal(f.view.filter.value,1); assert.equal(f.view.groupBy,"other");
  assert.deepEqual(dashboardProjection({...f,globalFilters:[{...filter,mappings:{}}]}).items.map(i=>i.id),["partner-one","p2"]);
  assert.equal(dashboardProjection({...f,globalFilters:[{...filter,mappings:{partners:"title"}}]}).unmapped,1);
  assert.equal(dashboardProjection({...f,query:"二号"}).items[0].id,"p2");
});
test("legacy current-source metrics honor parent filters and search without mutating saved records",()=>{
  const f=fixture();
  const result=dashboardProjection({...f,widget:{type:"metric"},items:f.workspace.databaseItems.filter(i=>i.id==="alpha" || i.id==="gamma"),globalFilters:[{propertyId:"amount",operator:"greater_than",value:0}]});
  assert.deepEqual(result.items.map(i=>i.id),["alpha"]);
  assert.equal(result.source.id,f.primary.id);
});
test("saved views cannot recurse, cross-bind or fall back to a different source after deletion",()=>{
  const f=fixture();
  for(const viewId of ["view-dashboard","view-form","view-list","lost"]) assert.ok(dashboardProjection({...f,widget:{...f.widget,viewId}}).error);
  f.view.trashedAt="2026-01-01";assert.ok(dashboardProjection(f).error);assert.deepEqual(availableViews(f.workspace,"partners"),[]);
  f.workspace.dataSources[1].ownerPageId="discarded";assert.ok(dashboardProjection(f).error);
});
test("select fields translate option IDs by label and never match unrelated empty values",()=>{
  const f=fixture();
  f.workspace.dataSources[1].properties.push({id:"phase",type:"status",options:[{id:"open-2",name:"进行中"}]});
  f.workspace.databaseItems.find(i=>i.id==="partner-one").values.phase="open-2";
  const rule={propertyId:"status",operator:"equals",value:"doing",mappings:{partners:"phase"}};
  assert.deepEqual(dashboardProjection({...f,globalFilters:[rule]}).items.map(i=>i.id),["partner-one"]);
  assert.deepEqual(dashboardProjection({...f,globalFilters:[{...rule,value:"done"}]}).items,[]);
});
test("layout restores order, four-column spans and shared row heights after serialization",()=>{
  const widgets=[{id:"a",size:"small",rowHeight:300},{id:"b",span:2,rowHeight:300},{id:"c",size:"wide",rowHeight:400}];
  const moved=JSON.parse(JSON.stringify(moveWidget(widgets,"c",0)));
  assert.deepEqual(dashboardRows(moved).map(row=>row.map(w=>[w.id,widthOf(w),w.rowHeight])),[[["c",4,400]],[["a",2,300],["b",2,300]]]);
  assert.equal(moveWidget(widgets,"missing",0),widgets);
});

const tile = (id, span, fields = {}) => ({ id, span, type: "metric", ...fields });
const layout = widgets => dashboardRows(widgets).map(row => row.map(widget => [widget.id, widthOf(widget)]));

test("adding dedicated rows survives JSON and keeps historic auto-packed widths and heights", () => {
  const original = [tile("a", 2, { rowHeight: 215 }), tile("b", 1), tile("c", 4, { rowHeight: 360 })];
  const historic = { dashboard: { widgets: original, globalFilters: [] } };
  assert.deepEqual(normalizeViewConfig("dashboard", historic).dashboard.widgets, original);
  assert.deepEqual(layout(original), [[['a', 2], ['b', 1]], [['c', 4]]]);

  const first = insertWidget([], tile("d", 2));
  const both = insertWidget(first, tile("e", 1, { rowHeight: 304 }));
  const saved = normalizeViewConfig("dashboard", JSON.parse(JSON.stringify({ dashboard: { widgets: both } }))).dashboard.widgets;
  assert.equal(saved[1].startRow, true);
  assert.deepEqual(layout(saved), [[['d', 2]], [['e', 1]]]);
  assert.deepEqual(dashboardRows(saved).map(dashboardRowHeight), [150, 304]);
  assert.equal(insertWidget(both, tile("e", 3)), both);
  assert.equal(insertWidget(both, tile("f", 3), "absent"), both);
});

test("an inline add splits a wide row and reclaims slots from adjacent cards when needed", () => {
  const original = [tile("a", 4, { rowHeight: 320 }), tile("untouched", 4, { custom: "preserved" })];
  const split = insertWidget(original, tile("b", 4, { rowHeight: 160 }), "a");
  assert.deepEqual(layout(split), [[['a', 2], ['b', 2]], [['untouched', 4]]]);
  assert.deepEqual(dashboardRows(split)[0].map(widget => widget.rowHeight), [320, 320]);
  assert.equal(split[2], original[1]);
  assert.deepEqual(original.map(widthOf), [4, 4]);

  const three = insertWidget(split, tile("c", 2), "b", "before");
  const four = insertWidget(three, tile("d", 4), "b");
  assert.deepEqual(layout(three)[0], [['a', 1], ['c', 1], ['b', 2]]);
  assert.deepEqual(layout(four)[0], [['a', 1], ['c', 1], ['b', 1], ['d', 1]]);
  const overflow = insertWidget(four, tile("e", 2), "b");
  assert.deepEqual(layout(overflow).map(row => row.map(([id]) => id)), [["a", "c", "b", "d"], ["e"], ["untouched"]]);
});

test("moving the first tile within its row transfers the boundary and keeps the height and widths", () => {
  const original = [tile("lead", 1), tile("a", 1, { startRow: true, rowHeight: 300 }), tile("b", 2), tile("tail", 4)];
  assert.equal(moveWidgetToRow(original, "a", "b", "before"), original);
  assert.equal(moveWidgetToRow(original, "missing", "b"), original);
  const moved = moveWidgetToRow(original, "a", "b", "after");
  assert.deepEqual(layout(moved), [[['lead', 1]], [['b', 2], ['a', 1]], [['tail', 4]]]);
  assert.equal(moved[1].startRow, true);
  assert.equal(moved[2].startRow, undefined);
  assert.deepEqual(dashboardRows(moved)[1].map(widget => widget.rowHeight), [300, 300]);
  assert.equal(moved[0], original[0]);
  assert.equal(moved.at(-1), original.at(-1));
});

test("cross-row moves can reflow the destination and a dedicated bottom row retains its height", () => {
  const original = [tile("a", 4, { rowHeight: 300 }), tile("b", 2, { rowHeight: 400 }), tile("c", 2), tile("tail", 4)];
  const moved = moveWidgetToRow(original, "c", "a", "before");
  assert.deepEqual(layout(moved), [[['c', 2], ['a', 2]], [['b', 2]], [['tail', 4]]]);
  assert.deepEqual(dashboardRows(moved).map(dashboardRowHeight), [300, 400, 150]);
  assert.equal(moved.at(-1), original.at(-1));

  const bottom = moveWidgetToRow(moved, "c");
  assert.deepEqual(layout(bottom), [[['a', 2]], [['b', 2]], [['tail', 4]], [['c', 2]]]);
  assert.equal(bottom[1].startRow, true);
  assert.equal(bottom.at(-1).startRow, true);
  assert.deepEqual(dashboardRows(bottom).map(dashboardRowHeight), [300, 400, 150, 300]);
  assert.equal(moveWidgetToRow(bottom, "c"), bottom);
});

test("one-column cards swap into four-card rows while wider cards keep their span in an adjacent row", () => {
  const original = [tile("wide", 3), tile("tiny", 1), ...["a", "b", "c", "d"].map(id => tile(id, 1)), tile("tail", 4)];
  const swapped = moveWidgetToRow(original, "tiny", "b");
  assert.deepEqual(layout(swapped), [[['wide', 3], ['b', 1]], [['a', 1], ['tiny', 1], ['c', 1], ['d', 1]], [['tail', 4]]]);
  assert.equal(swapped.at(-1), original.at(-1));
  const adjacentRow = moveWidgetToRow(swapped, "wide", "a", "before");
  assert.deepEqual(layout(adjacentRow), [[['b', 1]], [['wide', 3]], [['a', 1], ['tiny', 1], ['c', 1], ['d', 1]], [['tail', 4]]]);
  assert.equal(adjacentRow[1].startRow, true);
});

test("duplicating and deleting cards preserves settings, row boundaries and persisted row height", () => {
  const original = [tile("lead", 1), tile("a", 4, { type: "chart", chart: { kind: "bar" }, startRow: true, rowHeight: 350 }), tile("tail", 2)];
  const duplicated = duplicateWidget(original, "a", "copy");
  assert.deepEqual(layout(duplicated), [[['lead', 1]], [['a', 2], ['copy', 2]], [['tail', 2]]]);
  const copy = duplicated.find(widget => widget.id === "copy");
  assert.deepEqual(copy.chart, original[1].chart);
  assert.notEqual(copy.chart, original[1].chart);
  const remaining = removeWidget(duplicated, "a");
  assert.deepEqual(layout(remaining), [[['lead', 1]], [['copy', 2]], [['tail', 2]]]);
  assert.equal(remaining[1].startRow, true);
  assert.equal(remaining[2].startRow, true);
  assert.equal(dashboardRowHeight(dashboardRows(remaining)[1]), 350);
  assert.equal(removeWidget(remaining, "missing"), remaining);
});

test("resizing transfers quarters to adjacent cards, retains height, and cannot reflow other rows", () => {
  const original = [tile("a", 2, { rowHeight: 306 }), tile("b", 2), tile("solo", 4, { rowHeight: 420 }), tile("last", 2)];
  assert.deepEqual(widgetResizeBounds(original, "a"), { min: 1, max: 3 });
  const wider = resizeWidget(original, "a", 4);
  assert.deepEqual(layout(wider)[0], [['a', 3], ['b', 1]]);
  const narrower = resizeWidget(wider, "a", 1);
  assert.deepEqual(layout(narrower)[0], [['a', 1], ['b', 3]]);
  assert.equal(dashboardRowHeight(dashboardRows(narrower)[0]), 306);
  assert.deepEqual(widgetResizeBounds(narrower, "solo"), { min: 1, max: 4 });
  const soloShrunk = resizeWidget(narrower, "solo", 1);
  assert.deepEqual(layout(soloShrunk), [[['a', 1], ['b', 3]], [['solo', 1]], [['last', 2]]]);
  assert.equal(soloShrunk.at(-1).startRow, true);
  assert.equal(dashboardRowHeight(dashboardRows(soloShrunk)[1]), 420);
  const three = [tile("left", 2), tile("middle", 1), tile("right", 1)];
  assert.equal(widgetResizeBounds(three, "right").max, 1);
  assert.deepEqual(layout(resizeWidget(three, "middle", 2)), [[['left', 1], ['middle', 2], ['right', 1]]]);
});

test("本周和本月按本机日历取重叠范围、跨周/年，支持浮动时间、带偏移时间与全天",()=>{
  const f=fixture(), source=f.workspace.dataSources[1];
  source.properties.push({id:"deadline",name:"交稿时间",type:"date"});
  const now=new Date(2027,0,1,12);  // Friday; Monday is in the preceding calendar year.
  const defs={cross:{start:"2026-12-27T08:00",end:"2026-12-28T00:00"},prev:"2026-12-27",dec:"2026-12-31",sun:"2027-01-03T23:59",next:"2027-01-04T00:00",utc:new Date(2027,0,3,23,59).toISOString(),far:"2027-02-01",bad:null};
  f.workspace.databaseItems=Object.entries(defs).map(([id,date])=>({id,sourceId:source.id,pageId:id,values:{rating:4,deadline:date}}));
  const run=operator=>dashboardProjection({...f,now,globalFilters:[{propertyId:"date",operator,mappings:{partners:"deadline"}}]}).items.map(i=>i.id);
  assert.deepEqual(run("this_week"),["cross","dec","sun","utc"]);
  assert.deepEqual(run("this_month"),["sun","next","utc"]);
});
