import assert from "node:assert/strict";
import test from "node:test";
import { createFormulaBudget, evaluateFormula } from "../src/domain/formula/engine.js";
import { FormulaPage } from "../src/domain/formula/values.js";

test("list concat, slice and flat keep element types and preserve ordinary text functions", () => {
  const answers = [
    ["concat([1, 2], [3, 4]).length()", 4],
    ["[1, 2].concat([], [3], [4])", [1, 2, 3, 4]],
    ["slice([1, 2, 3], 1, 2).first()", 2],
    ["[1, 2, 3].slice(-2, -1)", [2]],
    ["[1, 2, 3].slice(3, 1)", []],
    ["flat([1, [2, [3, 4]], [], true])", [1, 2, [3, 4], true]],
    ["[[false], [2]].flat()", [false, 2]],
    ['concat("A", "B")', "AB"],
    ['concat([1, 2], "A")', "1,2A"],
    ['"😀a".slice(0, 1)', "😀"],
    ['"你好世界".slice(-2)', "世界"],
  ];
  for (const [source, expected] of answers) assert.deepEqual(evaluateFormula(source), expected, source);

  const styles = { preserveStyles: true };
  const rich = evaluateFormula('concat("A".style("green"), "B".style("b"))', undefined, styles);
  assert.deepEqual(rich.runs, [{ text: "A", styles: ["green"] }, { text: "B", styles: ["b"] }]);
  const styledListEntry = evaluateFormula('["A".style("green")].concat(["B"]).slice(0, 1).at(0)', undefined, styles);
  assert.deepEqual(styledListEntry.runs, [{ text: "A", styles: ["green"] }]);
});

test("list predicates short-circuit, share callback scope and validate arguments", () => {
  const answers = [
    ["some([1, 0], 1 / current > 0)", true],
    ["[2, 0].every(1 / current > 1)", false],
    ["lets(limit, 2, [1, 2].some(current + index > limit))", true],
    ["[].some(1 / 0)", false],
    ["every([], 1 / 0)", true],
    ["[1, 0].findIndex(1 / current > 0)", 0],
    ["let(limit, 2, findIndex([1, 2, 2], current == limit and index > 0))", 1],
    ['[4, 6].map(let(outerIndex, index, [6, 4].findIndex(current == 4 and outerIndex == 0)))', [1, -1]],
    ["[].findIndex(1 / 0)", -1],
    ["findIndex([1], current == 2)", -1],
    ["[1, false].last()", false],
    ["last([])", null],
    ["[1, 2, 3].at(-1)", 3],
    ["at([false], 0)", false],
    ["at([1], 3)", null],
    ['includes([1, "1"].unique(), "1")', true],
    ['[1].includes("1")', false],
    ['unique(["B", "A", "B", false, 0, false])', ["B", "A", false, 0]],
  ];
  for (const [source, expected] of answers) assert.deepEqual(evaluateFormula(source), expected, source);
  for (const source of ['"list".flat()', "unique([1], [2])", "[1].includes()", "[].at()", "[1].some()", "1.every(current)", "last(1)", "[1].last(1)", "[1].findIndex()", "1.findIndex(current)", 'id("page")', "id(null)", "id(1, 2)"]) {
    assert.equal(evaluateFormula(source).error?.code, "TYPE", source);
  }
  assert.equal(evaluateFormula("[1].some(1 / 0)").error?.code, "TYPE");
});

test("list membership and uniqueness preserve related records by ID", () => {
  const makePage = (id, amount) => new FormulaPage(id, "相同标题", name => ({ Title: "相同标题", Amount: amount })[name]);
  const first = makePage("a", 7);
  const duplicate = makePage("a", 999);
  const other = makePage("b", 5);
  const lookup = id => ({ first, duplicate, other })[id];
  const read = source => evaluateFormula(source, lookup, { pageId: "current" });

  assert.equal(read("id()"), "current");
  assert.equal(read("id({{other}})"), "b");
  assert.equal(read("{{first}}.id()"), "a");
  assert.equal(read("equal({{first}}, {{duplicate}})"), true);
  assert.equal(read("unequal({{first}}, {{other}})"), true);
  assert.equal(read("[[{{first}}, {{other}}]].format()"), "相同标题, 相同标题");
  assert.equal(read("[{{first}}].includes({{duplicate}})"), true);
  assert.equal(read("[{{first}}].includes({{other}})"), false);
  assert.equal(read('[{{first}}].includes("a")'), false);
  assert.equal(read('[{{first}}].contains("a")'), false);
  assert.equal(read('[{{first}}].contains({{duplicate}})'), true);
  assert.deepEqual(read('[{{first}}, {{duplicate}}, {{other}}].unique().map(current.prop("Amount"))'), [7, 5]);
  assert.deepEqual(read("[[{{first}}], [{{duplicate}}, {{other}}]].flat().unique().map(current.id())"), ["a", "b"]);
  assert.equal(read('[{{first}}].concat([{{other}}]).slice(1).at(0).prop("Title")'), "相同标题");
  assert.equal(read('last([{{first}}, {{other}}]).prop("Amount")'), 5);
  assert.equal(read('[{{first}}, {{other}}].findIndex(current.prop("Amount") == 5)'), 1);
});

test("split uses a literal separator and composes with typed list operations", () => {
  assert.deepEqual(evaluateFormula('"|Japan||Korea|".split("|")'), ["", "Japan", "", "Korea", ""]);
  assert.deepEqual(evaluateFormula('split("a.b.+c", ".+")'), ["a.b", "c"]);
  assert.equal(evaluateFormula('"Japan|Korea|Japan".split("|").unique().last()'), "Korea");
  assert.deepEqual(evaluateFormula('"😀海".split("")'), ["\ud83d", "\ude00", "海"]);
  assert.deepEqual(evaluateFormula('"".split("/")'), []);
  assert.deepEqual(evaluateFormula('"".split("")'), []);
  for (const source of ['split(1, "|")', 'split("a", 1)', '"a".split()', 'split("a", "|", "b")']) {
    assert.equal(evaluateFormula(source).error?.code, "TYPE", source);
  }
});

test("list and text operations use the evaluated input types", () => {
  const lookup = id => ({ items: [1, 2], useList: true })[id];
  const answers = [
    ['length({{items}}.slice(0, 1))', 1],
    ['lets(items, [1, 2], items.concat(items))', [1, 2, 1, 2]],
    ['[{{items}}].map(current.slice(0))', [[1, 2]]],
    ['slice(if({{useList}}, [1, 2], "text"), 1)', [2]],
    ['slice(if(false, [1, 2], "text"), 1)', "ext"],
  ];
  for (const [source, expected] of answers) assert.deepEqual(evaluateFormula(source, lookup), expected, source);
});

test("a shared budget charges list work and allows short-circuiting on wide inputs", () => {
  const list = Array.from({ length: 10000 }, (_, index) => index % 4);
  const lookup = () => list;
  assert.equal(evaluateFormula("{{list}}.unique().length()", lookup), 4);
  assert.equal(evaluateFormula("concat({{list}}, {{list}}).length()", lookup), 20000);
  assert.equal(evaluateFormula("{{list}}.at(9999)", lookup, { maxSteps: 3 }), 3);
  assert.equal(evaluateFormula("includes({{list}}, 0)", lookup, { maxSteps: 4 }), true);
  assert.equal(evaluateFormula("contains({{list}}, 0)", lookup, { maxSteps: 4 }), true);
  assert.equal(evaluateFormula("{{list}}.some(current == 0)", lookup, { maxSteps: 5 }), true);
  assert.equal(evaluateFormula("{{list}}.last()", lookup, { maxSteps: 2 }), 3);
  assert.equal(evaluateFormula("{{list}}.findIndex(current == 0)", lookup, { maxSteps: 5 }), 0);
  for (const source of ["unique({{list}})", "flat({{list}})", "slice({{list}}, 0)", "concat({{list}}, {{list}})", "{{list}}.includes(4)", "{{list}}.contains(4)", "{{list}}.findIndex(current == 4)", '"a,a,a,a".split(",")', '"abcdefg".split("")']) {
    assert.deepEqual(evaluateFormula(source, lookup, { maxSteps: 6 }).error, { code: "EVAL", message: "公式计算步骤过多" }, source);
  }

  const consumeSteps = createFormulaBudget(5);
  assert.equal(evaluateFormula("1 + 2", undefined, { consumeSteps }), 3);
  assert.equal(evaluateFormula("3 + 4", undefined, { consumeSteps }).error?.code, "EVAL");
});

test("repeated membership checks reuse prior results after the first shared project is detached", () => {
  const linkedProjects = Array.from({ length: 49 }, (_, index) => index + 2);
  const sharedPaths = Array.from({ length: 1000 }, () => [1, 2]);
  const lookup = id => id === "projects" ? linkedProjects : sharedPaths;
  const expression = "let(projects, {{projects}}, {{paths}}.map(current.find(projects.contains(current))).sum())";
  assert.equal(evaluateFormula(expression, lookup, { maxSteps: 13000 }), 2000);
});
