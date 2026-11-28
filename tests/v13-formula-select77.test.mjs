import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { transformSync } from "esbuild";
import * as database from "../src/domain/database.js";

// Recorded article58 expression: preserve the source Published logic verbatim.
const ARTICLE58 = 'if(prop("状态") == "Published" and not empty(prop("发布日期")) and dateBetween(now(), prop("发布日期"), "days") <= 21, "SHOW", "HIDE")';
const NOW = new Date(2026, 10, 13, 12, 34).getTime();

// Render the actual public component in memory; no DOM, browser or app build.
const componentUrl = new URL("../src/components/FormulaEditor.jsx", import.meta.url);
const componentModule = { exports: {} };
runInNewContext(transformSync(readFileSync(componentUrl, "utf8"), {
  loader: "jsx", jsx: "automatic", format: "cjs",
}).code, {
  module: componentModule, exports: componentModule.exports, require: createRequire(componentUrl),
});
const { FormulaEditor } = componentModule.exports;

function fixture(type = "select") {
  const status = { id: "status77", name: "状态", type, config: {}, options: [
    { id: "published77", name: "Published", color: "green", group: "complete" },
    { id: "archived77", name: "Archived", color: "brown", group: "todo" },
  ] };
  const date = { id: "date77", name: "发布日期", type: "date", config: {} };
  const formula = { id: "formula77", name: "首页近期", type: "formula", config: { expression: ARTICLE58 } };
  const source = { id: "articles77", title: "文章", properties: [
    { id: "title77", name: "标题", type: "title" }, status, date, formula,
  ] };
  const item = { id: "article77", sourceId: source.id, pageId: "article-page77", values: {
    title77: "Article77", status77: "published77",
    date77: { start: "2026-11-12", end: null, includeTime: false, timeZone: null },
  } };
  const workspace = { dataSources: [source], databaseItems: [item],
    pages: [{ id: item.pageId, title: "Article77", trashedAt: null }], relations: [] };
  const read = () => database.resolvePropertyValue(workspace, source, item, formula);
  const preview = () => {
    const markup = renderToStaticMarkup(React.createElement(FormulaEditor, {
      workspace, source, property: formula, expression: formula.config.expression, onChange: () => {},
    }));
    const result = markup.match(/role="status">([^<]*)<\/div>/);
    assert.ok(result, "FormulaEditor exposes its preview status");
    return result[1];
  };
  return { workspace, source, item, status, date, formula, read, preview };
}

test("article58 original Published formula matches cells and preview", (t) => {
  t.mock.method(Date, "now", () => NOW);
  const f = fixture();
  const before = structuredClone(f.workspace);
  assert.deepEqual({ cell: f.read(), preview: f.preview() }, {
    cell: "SHOW", preview: "预览（Article77）：SHOW",
  });
  assert.equal(f.formula.config.expression, ARTICLE58);
  assert.deepEqual(f.workspace, before);
});


for (const type of ["select", "status"]) {
  test(type + " formulas use active labels and read unavailable choices as empty", (t) => {
    t.mock.method(Date, "now", () => NOW);
    const f = fixture(type);
    for (const [value, expected, effective] of [
      ["published77", "SHOW", "published77"], ["archived77", "HIDE", "archived77"],
      [null, "HIDE", null], ["", "HIDE", null], ["deleted-option77", "HIDE", null],
    ]) {
      f.item.values.status77 = value;
      assert.equal(f.read(), expected);
      assert.equal(f.preview(), "预览（Article77）：" + expected);
      assert.equal(database.resolvePropertyValue(f.workspace, f.source, f.item, f.status), effective);
      assert.equal(f.item.values.status77, value);
    }
    delete f.item.values.status77;
    assert.equal(f.read(), "HIDE");
    assert.equal(database.resolveFormulaPropertyValue(f.workspace, f.source, f.item, f.status), null);
    f.item.values.status77 = "deleted-option77";
    assert.equal(database.resolveFormulaPropertyValue(f.workspace, f.source, f.item, f.status), null);
    f.item.values.status77 = "published77";
    f.status.options[0].name = "";
    assert.equal(database.resolveFormulaPropertyValue(f.workspace, f.source, f.item, f.status), "");
  });

  test(type + " label renames update cells and actual preview without changing IDs or expressions", (t) => {
    t.mock.method(Date, "now", () => NOW);
    const f = fixture(type);
    const rawItem = structuredClone(f.item);
    assert.equal(f.read(), "SHOW");
    f.status.options[0].name = "Published renamed";
    assert.equal(f.read(), "HIDE");
    assert.equal(f.preview(), "预览（Article77）：HIDE");
    assert.equal(database.resolveFormulaPropertyValue(f.workspace, f.source, f.item, f.status), "Published renamed");
    f.status.options[0].name = "Published";
    assert.equal(f.read(), "SHOW");
    assert.equal(f.preview(), "预览（Article77）：SHOW");
    assert.deepEqual(f.item, rawItem);
    assert.equal(f.formula.config.expression, ARTICLE58);
  });
}

test("identical labels do not merge raw IDs used by filters, grouping or stable sorting", (t) => {
  t.mock.method(Date, "now", () => NOW);
  const f = fixture();
  f.status.options.push({ id: "published-second77", name: "Published", color: "blue" });
  const second = { ...structuredClone(f.item), id: "article-second77", pageId: "article-second-page77",
    values: { ...f.item.values, status77: "published-second77" } };
  f.workspace.databaseItems.push(second);
  f.workspace.pages.push({ id: second.pageId, title: "Article second" });
  const before = structuredClone(f.workspace);
  assert.equal(f.read(), "SHOW");
  assert.equal(database.resolvePropertyValue(f.workspace, f.source, second, f.formula), "SHOW");
  assert.equal(database.resolvePropertyValue(f.workspace, f.source, second, f.status), "published-second77");
  const view = database.createDatabaseView({ sourceId: f.source.id, type: "table",
    filter: { propertyId: f.status.id, operator: "equals", value: "published77" },
    sorts: [{ propertyId: f.status.id, direction: "asc" }], groupBy: f.status.id,
    grouping: { primaryPropertyId: f.status.id, order: ["published77", "published-second77"], showEmpty: false } });
  assert.deepEqual(database.projectViewItems(f.workspace, view).map(item => item.id), ["article77"]);
  const unfiltered = { ...view, filter: null };
  assert.deepEqual(database.projectViewItems(f.workspace, unfiltered).map(item => item.id), ["article77", "article-second77"]);
  const populated = database.groupViewItems(f.workspace, unfiltered).filter(group => group.items.length);
  assert.deepEqual(populated.map(group => [group.key, group.items.map(item => item.id)]), [
    ["published77", ["article77"]], ["published-second77", ["article-second77"]],
  ]);
  assert.deepEqual(f.workspace, before);
});

test("article58 keeps its empty-date guard and original future-date SHOW behavior", (t) => {
  t.mock.method(Date, "now", () => NOW);
  const f = fixture();
  for (const [value, expected] of [
    [null, "HIDE"], ["", "HIDE"], [{ start: "" }, "HIDE"],
    [{ start: "2026-10-01" }, "HIDE"], [{ start: "2026-11-14" }, "SHOW"],
  ]) {
    f.item.values.date77 = value;
    assert.equal(f.read(), expected);
    assert.equal(f.preview(), "预览（Article77）：" + expected);
  }
  delete f.item.values.date77;
  assert.equal(f.read(), "HIDE");
  assert.equal(f.formula.config.expression, ARTICLE58);
});

test("the formula getter reads multi-select labels and keeps date and scalar values typed", (t) => {
  t.mock.method(Date, "now", () => NOW);
  const f = fixture();
  const properties = [
    { id: "tags77", name: "标签", type: "multi_select", options: [{ id: "tag-ai77", name: "AI" }] },
    { id: "number77", name: "金额", type: "number" }, { id: "text77", name: "说明", type: "text" },
    { id: "check77", name: "确认", type: "checkbox" },
    { id: "relation77", name: "关联", type: "relation" },
    { id: "rollup77", name: "汇总", type: "rollup", config: {} },
  ];
  f.source.properties.push(...properties);
  Object.assign(f.item.values, { tags77: ["tag-ai77"], number77: 0, text77: "raw", check77: false, relation77: ["other77"] });
  for (const property of [properties[1], properties[2], properties[3], properties[5], f.date]) {
    assert.deepEqual(database.resolveFormulaPropertyValue(f.workspace, f.source, f.item, property),
      database.resolvePropertyValue(f.workspace, f.source, f.item, property));
  }
  assert.deepEqual(database.resolveFormulaPropertyValue(f.workspace, f.source, f.item, properties[0]), ["AI"]);
  assert.deepEqual(database.resolvePropertyValue(f.workspace, f.source, f.item, properties[0]), ["tag-ai77"]);
  assert.deepEqual(database.resolveFormulaPropertyValue(f.workspace, f.source, f.item, properties[4]), []);
  assert.equal(database.resolveFormulaPropertyValue(f.workspace, f.source, f.item, undefined), null);
  const before = structuredClone(f.workspace);
  for (const [expression, expected] of [
    ['contains(prop("标签"), "AI")', true], ['contains(prop("标签"), "tag-ai77")', false],
    ['length(prop("标签"))', 1], ['format(prop("标签"))', "AI"],
  ]) {
    f.formula.config.expression = expression;
    assert.equal(f.read(), expected);
  }
  f.formula.config.expression = ARTICLE58;
  assert.deepEqual(f.workspace, before);
});

test("formula chains retain labels, missing-reference errors and cycle detection", (t) => {
  t.mock.method(Date, "now", () => NOW);
  const f = fixture();
  f.source.properties.push({ id: "label77", name: "标签公式", type: "formula", config: { expression: 'prop("状态")' } });
  f.formula.config.expression = 'prop("标签公式") == "Published"';
  assert.equal(f.read(), true);
  assert.equal(f.preview(), "预览（Article77）：true");
  f.formula.config.expression = 'prop("不存在")';
  assert.equal(f.read().error.code, "REF");
  assert.match(f.preview(), /^错误：/);
  f.formula.config.expression = 'prop("首页近期")';
  assert.equal(f.read().error.code, "CYCLE");
  assert.match(f.preview(), /^错误：公式循环引用/);
  f.formula.config.expression = 'prop("标签公式")';
  f.source.properties.find(property => property.id === "label77").config.expression = 'prop("首页近期")';
  assert.equal(f.read().error.code, "CYCLE");
});

test("each source resolves its own labels without changing legacy ID reference binding", (t) => {
  t.mock.method(Date, "now", () => NOW);
  const first = fixture(), second = fixture();
  second.source.id = "other-source77";
  second.item.sourceId = second.source.id;
  second.status.options[0].name = "Other source label";
  for (const f of [first, second]) f.formula.config.expression = "{{status77}}";
  assert.equal(first.read(), "Published");
  assert.equal(second.read(), "Other source label");
  assert.equal(database.resolvePropertyValue(first.workspace, first.source, first.item, first.status), "published77");
  assert.equal(database.resolvePropertyValue(second.workspace, second.source, second.item, second.status), "published77");
});
