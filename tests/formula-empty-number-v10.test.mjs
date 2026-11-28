import test from "node:test";
import assert from "node:assert/strict";
import { coreParityWorkspace } from "./fixtures/core-parity-workspace.mjs";
import { resolvePropertyValue } from "../src/domain/database.js";
import { formatPropertyValue, isEmptyProperty } from "../src/domain/databaseProperties.js";
import { formatNumber } from "../src/domain/numberFormat.js";
import { evaluateFormula } from "../src/domain/formula/engine.js";

function fixture(value, present = true) {
  const workspace = coreParityWorkspace();
  const source = workspace.dataSources.find((entry) => entry.id === "projects");
  const item = workspace.databaseItems.find((entry) => entry.id === "alpha");
  if (present) item.values.amount = value;
  else delete item.values.amount;
  const property = source.properties.find((entry) => entry.id === "formula");
  const read = (expression) => {
    property.config.expression = expression;
    return resolvePropertyValue(workspace, source, item, property);
  };
  return { workspace, source, item, read };
}

test("unfilled numeric properties add as zero on either side and together", () => {
  for (const [value, present] of [[undefined, false], [null, true]]) {
    const { item, read } = fixture(value, present);
    const before = structuredClone(item);
    assert.strictEqual(read('prop("金额") + 1'), 1);
    assert.strictEqual(read('1 + prop("金额")'), 1);
    assert.strictEqual(read('prop("金额") + prop("金额")'), 0);
    assert.strictEqual(read('{{amount}} + 1'), 1);
    assert.deepEqual(item, before);
  }
});

test("direct empty numeric reads and number display remain empty", () => {
  const { workspace, source, item, read } = fixture(undefined, false);
  const amount = source.properties.find((entry) => entry.id === "amount");
  assert.strictEqual(read('prop("金额")'), null);
  assert.strictEqual(resolvePropertyValue(workspace, source, item, amount), null);
  assert.strictEqual(isEmptyProperty(null), true);
  assert.strictEqual(formatPropertyValue(workspace, amount, null), "");
  assert.strictEqual(formatNumber(null, { format: "cny" }), "");
  assert.strictEqual(formatNumber(0, { format: "cny" }), "¥0.00");
  assert.strictEqual(Object.hasOwn(item.values, "amount"), false);
});

test("zero and populated numeric properties retain numeric results", () => {
  for (const value of [0, 15]) {
    const { read } = fixture(value);
    assert.strictEqual(read('prop("金额") + 1'), value + 1);
    assert.strictEqual(read('1 + prop("金额")'), value + 1);
    assert.strictEqual(read('prop("金额") + prop("金额")'), value * 2);
  }
});

test("empty text, literal null and numeric functions keep their existing semantics", () => {
  const { item, read } = fixture(undefined, false);
  item.values.notes = "";
  assert.strictEqual(read('prop("说明") + 1'), "1");
  delete item.values.notes;
  assert.strictEqual(read('prop("说明") + 1').error.code, "TYPE");
  assert.strictEqual(read('null + 1').error.code, "TYPE");
  assert.strictEqual(read('1 + null').error.code, "TYPE");
  assert.strictEqual(read('abs(prop("金额"))').error.code, "TYPE");
  assert.strictEqual(read('toNumber("")'), null);
  assert.strictEqual(read('"x" + prop("金额")'), "x");
});

test("typed property context works for preview-style evaluation without changing untyped callers", () => {
  const lookup = () => null;
  const options = { resolveName: () => "amount", resolvePropertyType: () => "number" };
  assert.strictEqual(evaluateFormula('prop("金额") + 1', lookup, options), 1);
  assert.strictEqual(evaluateFormula('1 + prop("金额")', lookup, options), 1);
  assert.strictEqual(evaluateFormula('prop("金额")', lookup, options), null);
  assert.strictEqual(evaluateFormula('prop("金额") + 1', lookup, { resolveName: options.resolveName }).error.code, "TYPE");
});
