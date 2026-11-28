import test from "node:test";
import assert from "node:assert/strict";
import { evaluateFormula } from "../src/domain/formula/engine.js";
import { resolvePropertyValue } from "../src/domain/database.js";
import { coreParityWorkspace } from "./fixtures/core-parity-workspace.mjs";

test("zero budget ratios and typed blank amounts stay numeric in arithmetic", () => {
  const values = { actual: 0, planned: null };
  const read = expression => evaluateFormula(expression, id => values[id], { resolvePropertyType: () => "number" });
  assert.equal(read("{{actual}} / max({{actual}}, {{planned}}) * 100"), 0);
  assert.equal(read("{{actual}} - {{planned}}"), 0);
  assert.equal(read("{{planned}} - 17"), -17);
  assert.equal(read("let(n, [{{planned}}].first(), n * 3 + 5)"), 5);
  assert.equal(read("+{{planned}}"), 0);
  assert.equal(read("{{planned}}"), null);
  assert.equal(read('format({{planned}})'), "");
  assert.equal(read('"" + {{planned}}'), "");
  for (const expression of ["1 / 0", "0 % 0", "0 / null", '"bad" / 0', "0 / false", '0 / "0"', "null - 3"]) {
    assert.equal(read(expression).error?.code, "TYPE", expression);
  }
});

test("named equal and unequal share the date, text and scalar comparisons of their operators", () => {
  const date = 'parseDate("20250712")';
  for (const [left, right] of [[date, date], [date, '"2025-07-12"'], ['style("x", "b")', '"x"'], ["true", "1"], ["2", "3"]]) {
    for (const [name, operator] of [["equal", "=="], ["unequal", "!="]]) {
      assert.equal(evaluateFormula(`${name}(${left}, ${right})`), evaluateFormula(`${left} ${operator} ${right}`));
    }
  }
  assert.equal(evaluateFormula("equal(1)").error?.code, "TYPE");
  assert.equal(evaluateFormula("unequal(1, 2, 3)").error?.code, "TYPE");
});

test("formatted nested related pages use current titles and raw related pages retain their IDs", () => {
  const workspace = coreParityWorkspace();
  const [projects, accounts] = workspace.dataSources;
  const item = workspace.databaseItems.find(item => item.id === "alpha");
  const account = workspace.databaseItems.find(item => item.id === "partner-one");
  accounts.properties.push({ id: "summary", name: "Summary", type: "relation", config: { targetSourceId: projects.id } });
  account.values.summary = [item.id];
  item.values.relation = [account.id];
  item.values.title = "Spending Accounts";
  const result = projects.properties.find(field => field.id === "formula");
  const read = expression => {
    result.config.expression = expression;
    return resolvePropertyValue(workspace, projects, item, result);
  };
  const nested = '{{relation}}.map(current.prop("Summary"))';
  assert.equal(read(`equal(${nested}.format(), "Spending Accounts")`), true);
  assert.deepEqual(read(nested), [[item.id]]);
  assert.equal(read(`${nested}.flat().first().id()`), item.id);
  assert.equal(read(`equal(${nested}.flat().first(), ${nested}.flat().first())`), true);
  item.values.title = "Renamed";
  assert.equal(read(`${nested}.join(", ")`), "Renamed");
  item.values.title = "";
  assert.equal(read(`${nested}.format()`), "");
  assert.deepEqual(item.values.relation, [account.id]);
});
