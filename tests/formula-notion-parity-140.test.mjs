import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { resolveDisplayPropertyValue, resolvePropertyValue } from "../src/domain/database.js";
import { evaluateFormula, formulaDependencies, renameFormulaPropertyReference } from "../src/domain/formula/engine.js";
import { renderFormulaResult } from "../src/components/formulaResult.js";

const benchmark = 'lets(nums, [3, 1, 2, 4], label, "QA-124", nums.map(current * 2).filter(current > 4).sort().join(" / ") + " | " + label.match("[0-9]+").first().style("green", "b"))';
const completedCount = 'prop("任务").filter(current.prop("状态") == "已完成").length()';

function fixture() {
  const formula = { id: "result", type: "formula", name: "结果", config: {} };
  const source = { id: "projects", properties: [
    formula, { id: "tasks", name: "任务", type: "relation", config: { targetSourceId: "tasks" } },
  ] };
  const target = { id: "tasks", properties: [
    { id: "status", name: "状态", type: "status", options: [{ id: "done", name: "已完成" }] },
    { id: "done", name: "Done", type: "checkbox" },
    { id: "project", name: "Project", type: "relation", config: { targetSourceId: source.id } },
  ] };
  const project = { id: "p", pageId: "pp", sourceId: source.id, values: { tasks: ["t1", "t2", "t3", "missing", "wrongSource"] } };
  const task = id => ({ id, pageId: id + "page", sourceId: target.id, values: { status: id === "t2" ? "open" : "done", done: id !== "t2", project: ["p"] } });
  const items = [project, task("t1"), task("t2"), task("t3"), { ...project, id: "wrongSource" }];
  const workspace = { dataSources: [source, target], databaseItems: items, pages: items.map(item => ({ id: item.pageId, trashedAt: item.id === "t3" ? "2026-11-01" : null })) };
  const read = (expression, display = false) => {
    formula.config.expression = expression;
    return (display ? resolveDisplayPropertyValue : resolvePropertyValue)(workspace, source, project, formula);
  };
  return { workspace, source, target, formula, read };
}

test("the benchmark formula returns the plain value and styles only the extracted number", () => {
  const { read, workspace, formula } = fixture();
  assert.equal(read(benchmark), "6 / 8 | 124");
  const rich = read(benchmark, true);
  assert.deepEqual(rich.runs, [{ text: "6 / 8 | ", styles: [] }, { text: "124", styles: ["green", "b"] }]);
  assert.match(renderToStaticMarkup(renderFormulaResult(workspace, formula, rich)), /^6 \/ 8 \| <span style="[^"]*--mb-u-green[^"]*font-weight:700[^"]*">124<\/span>$/);
  const markup = renderToStaticMarkup(renderFormulaResult(workspace, formula, read('"<img>".style("red")', true)));
  assert.match(markup, /&lt;img&gt;/);
  assert.doesNotMatch(markup, /<img>/);
});

test("local bindings and callbacks keep lexical scope, short-circuit find and retain value types", () => {
  for (const [expression, expected] of [
    ["let(x, 3, x * 2)", 6], ["lets(x, 1, y, x + 1, let(x, 10, x + y) + x)", 13],
    ["[2, 3].map(let(outer, current, [10, 20].map(outer + current + index)))", [[12, 23], [13, 24]]],
    ["map([2, 3], current * 2)", [4, 6]], ["[3, 2, 11].sort()", [2, 3, 11]],
    ["[3, 2, 11].sort(-current)", [11, 3, 2]], ["[].first()", null],
    ["[1, 0].find(1 / current > 0)", 1], ["[1].find(false)", null],
    [String.raw`"ab12c34".match("\\d+")`, ["12", "34"]], ['"ab".match("z")', []],
    ['"123".style("b").length()', 3], ['"123".style("green") == "123"', true],
    ['["red".style("red"), "plain"].join("/").upper()', "RED/PLAIN"],
  ]) assert.deepEqual(evaluateFormula(expression), expected, expression);
  for (const expression of ['[1].map(1 / 0)', 'let(1, 2, 3)', '[1].map()', '"a".match("[")', '"a".style("bad")', '["t1"].first().prop("Done")']) {
    assert.equal(evaluateFormula(expression).error?.code, "TYPE", expression);
  }
  assert.equal(evaluateFormula("let(a, 1, a) + a").error?.code, "REF");
  assert.equal(evaluateFormula("[1,2,3].map(current + index)", undefined, { maxSteps: 6 }).error?.code, "EVAL");
});

test("related record reads support status labels, checkboxes, nested relations and cycles", () => {
  const { read, workspace, source, target } = fixture();
  assert.equal(read(completedCount), 1);
  assert.deepEqual(read('prop("任务").filter(current.prop("Done"))'), ["t1"]);
  assert.equal(read('prop("任务").first().prop("Project").first().prop("任务").length()'), 2);
  assert.equal(read('prop("任务").first().prop("不存在")').error?.code, "REF");
  assert.equal(read('prop("任务").first().prop("Project").first().prop("结果")').error?.code, "CYCLE");
  const direct = { id: "linked", type: "formula", name: "关联公式", config: { expression: 'prop("任务")' } };
  source.properties.push(direct);
  assert.equal(read('prop("关联公式").first().prop("Done")'), true);
  const styled = { id: "badge", type: "formula", name: "徽章", config: { expression: '"<Done>".style("b")' } };
  target.properties.push(styled);
  const rich = read('prop("任务").map(current.prop("徽章")).join("/")', true);
  assert.equal(String(rich), "<Done>/<Done>");
  assert.deepEqual(rich.runs.map(run => run.styles), [["b"], [], ["b"]]);
  workspace.databaseItems[2].values.status = "done";
  assert.equal(read(completedCount), 2);
});

test("rename and dependency tracking distinguish source properties from related names", () => {
  const expression = 'lets(x, [prop("状态")], x.map(current) + prop("任务").filter(current.prop("状态")))';
  assert.deepEqual(formulaDependencies(expression, { resolveName: x => x }), ["状态", "任务"]);
  assert.equal(renameFormulaPropertyReference(expression, "状态", "阶段"), expression.replace('prop("状态")', 'prop("阶段")'));
});
