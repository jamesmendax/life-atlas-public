import assert from "node:assert/strict";
import test from "node:test";
import { evaluateFormula, formulaDependencies, parseFormula, renameFormulaPropertyReference } from "../src/domain/formula/engine.js";

test("conditional operators bind after logical operators and associate from the right", () => {
  assert.equal(evaluateFormula("true or false and false ? 1 + 2 : 0"), 3);
  assert.equal(evaluateFormula('"a" == "b" ? true : false'), false);
  assert.equal(evaluateFormula("true ? false : true ? 1 : 2"), false);
  assert.equal(evaluateFormula("true ? false ? 1 : 2 : 3"), 2);
  assert.equal(evaluateFormula("(true ? false : true) ? 1 : 2"), 2);
  assert.deepEqual(evaluateFormula("[1, 2].map(current > 1 ? current * 2 : 0)"), [0, 4]);
});

test("only the selected conditional branch runs and a condition error propagates", () => {
  const accesses = [];
  const read = id => { accesses.push(id); return 42; };
  assert.equal(evaluateFormula("true ? {{used}} : {{skipped}}", read), 42);
  assert.equal(evaluateFormula("false ? {{skipped}} : {{used}}", read), 42);
  assert.deepEqual(accesses, ["used", "used"]);
  assert.equal(evaluateFormula('true ? "success" : 1 / 0'), "success");
  assert.equal(evaluateFormula("false ? 0 : 1 / 0").error.code, "TYPE");
  assert.equal(evaluateFormula("missing ? 1 : 0").error.code, "REF");
});

test("conditional branches keep direct and related references visible to parser consumers", () => {
  const source = 'prop("Flag") ? prop("Old") : {{records}}.first().prop("Label", "target", "label") + prop("Old")';
  const names = new Map([["Flag", "flag"], ["Old", "old"]]);
  assert.deepEqual(formulaDependencies(source, { resolveName: name => names.get(name) }), ["flag", "old", "records"]);
  assert.equal(renameFormulaPropertyReference(source, "Old", "Latest"),
    'prop("Flag") ? prop("Latest") : {{records}}.first().prop("Label", "target", "label") + prop("Latest")');
  const related = [];
  parseFormula(source, { onRelatedProperty: expression => related.push(expression) });
  assert.equal(related[0].propertyName, "Label");
  assert.deepEqual(related[0].bindings, [{ sourceId: "target", propertyId: "label" }]);
});

test("incomplete and excessively nested conditional operators return a parse error", () => {
  for (const expression of ["true ? : 0", "true ? 1", "true ? 1 :", "false : 0", "false ? 0 : ".repeat(80) + "1"]) {
    assert.equal(evaluateFormula(expression).error.code, "PARSE", expression);
  }
});

test("the original Portland anniversary formula evaluates both sides of the date boundary", () => {
  const expression = 'if(formatDate(prop("Date"), "D/M") == formatDate(now(), "D/M") and formatDate(prop("Date"), "L") != formatDate(now(), "L"), (dateBetween(now(), prop("Date"), "years") > 0) ? (format(dateBetween(now(), prop("Date"), "years")) + " years ago") : "empty", "empty")';
  const now = new Date(2026, 10, 26, 14, 12, 3);
  const resolveName = name => name === "Date" ? "date" : undefined;
  for (const [start, expected] of [
    ["1891-11-26", "135 years ago"], ["1906-11-26", "120 years ago"], ["1933-11-26", "93 years ago"],
    ["1888-11-25", "empty"], ["1889-11-27", "empty"], ["2026-11-26", "empty"],
  ]) {
    assert.equal(evaluateFormula(expression, () => ({ start }), { now, resolveName }), expected, start);
  }
});
