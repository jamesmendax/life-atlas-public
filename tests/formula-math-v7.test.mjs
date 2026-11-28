import test from "node:test";
import assert from "node:assert/strict";
import { evaluateFormula } from "../src/domain/formula/engine.js";

const values = { numbers: [1, 9, 3, null, ""], empty: [], bad: [1, "bad"] };
const evaluate = (source) => evaluateFormula(source, (id) => values[id]);

for (const [expression, expected] of [
  ["exp(1)", 2.718281828459045], ["ln(2)", 0.6931471805599453],
  ["log10(100)", 2], ["log2(8)", 3], ["sign(-2)", -1],
  ["cbrt(8)", 2], ["mean(1,2,3)", 2], ["median(1,9,3)", 3],
  ["pi()", 3.141592653589793], ["e()", 2.718281828459045],
]) {
  test(`observed numeric expression ${expression}`, () => {
    assert.equal(evaluate(expression), expected);
    assert.equal(typeof evaluate(expression), "number");
  });
}

test("observed extended numeric batch formats the expected values", () => {
  const expression = '"exp=" + format(exp(1)) + "; ln=" + format(ln(2)) + "; log10=" + format(log10(100)) + "; log2=" + format(log2(8)) + "; sign=" + format(sign(-2)) + "; cbrt=" + format(cbrt(8)) + "; mean=" + format(mean(1,2,3)) + "; median=" + format(median(1,9,3)) + "; pi=" + format(pi()) + "; e=" + format(e()) + "; toNumber=" + format(toNumber("42"))';
  assert.equal(evaluate(expression), "exp=2.718281828459045; ln=0.6931471805599453; log10=2; log2=3; sign=-1; cbrt=2; mean=2; median=3; pi=3.141592653589793; e=2.718281828459045; toNumber=42");
});

test("numeric functions follow existing conversion and aggregation conventions", () => {
  for (const [expression, expected] of [
    ['exp("0")', 1], ["LN(1)", 0], ["sign(0)", 0], ["sign(5)", 1],
    ["cbrt(-8)", -2], ["mean(2,4)", 3], ["median(9,1,4,2)", 3],
    ["mean({{numbers}})", 13 / 3], ["median({{numbers}})", 3],
    ["mean({{empty}})", null], ["median(null, \"\")", null],
  ]) assert.equal(evaluate(expression), expected, expression);
  assert.deepEqual(values.numbers, [1, 9, 3, null, ""]);
});

test("numeric errors and property errors retain existing formula conventions", () => {
  for (const [expression, message] of [
    ['exp("bad")', "需要数字"], ["ln(0)", "结果超出范围"],
    ["log10(-1)", "结果超出范围"], ["log2(0)", "结果超出范围"],
    ["exp(1000)", "结果超出范围"], ["sign(null)", "需要数字"],
    ["cbrt()", "需要数字"], ["mean({{bad}})", "需要数字"],
    ["median({{bad}})", "需要数字"],
  ]) assert.deepEqual(evaluate(expression).error, { code: "TYPE", message }, expression);
  assert.equal(evaluate('mean(prop("missing"), 1)').error.code, "REF");
  assert.equal(evaluate("mean([1,2])"), 1.5);
  assert.equal(evaluate("mean([1,2)").error.code, "PARSE");
  assert.equal(evaluate("if(false, exp(1000), 7)"), 7);
});
