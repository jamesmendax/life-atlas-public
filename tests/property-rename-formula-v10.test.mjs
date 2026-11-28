import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import * as propertyChanges from "../src/domain/propertyChanges.js";
import { canEditDatabaseSource } from "../src/domain/databaseWriteAccess.js";
import { createProperty, resolvePropertyValue } from "../src/domain/database.js";
import { formulaDependencies, renameFormulaPropertyReference } from "../src/domain/formula/engine.js";
import { coreParityWorkspace } from "./fixtures/core-parity-workspace.mjs";

// Execute the actual App updater with an in-memory setWorkspace, without a UI runtime.
function updateViaApp(workspace, sourceId, propertyId, definition) {
  const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  const start = app.indexOf("  function updateDatabaseProperty(sourceId, propertyId, definition) {");
  const end = app.indexOf("\n  function changePropertyType(", start);
  assert.ok(start >= 0 && end > start, "App property updater must exist");
  let result;
  const update = runInNewContext(`(${app.slice(start, end).trim()})`, {
    setWorkspace: (fn) => { result = fn(workspace); },
    canEditDatabaseSource,
    updatePropertyDefinition: propertyChanges.updatePropertyDefinition,
  });
  update(sourceId, propertyId, definition);
  return result;
}

test("renaming an amount property preserves formulas for populated and empty records", () => {
  const workspace = coreParityWorkspace();
  const source = workspace.dataSources.find((entry) => entry.id === "projects");
  source.properties.find((entry) => entry.id === "formula").config.expression = 'prop("金额") + 1';
  workspace.databaseItems.find((entry) => entry.id === "alpha").values.amount = 15;
  delete workspace.databaseItems.find((entry) => entry.id === "beta").values.amount;
  const renamed = updateViaApp(workspace, "projects", "amount", { name: "金额41" });
  const nextSource = renamed.dataSources.find((entry) => entry.id === "projects");
  const formula = nextSource.properties.find((entry) => entry.id === "formula");
  const result = (id) => resolvePropertyValue(renamed, nextSource, renamed.databaseItems.find((item) => item.id === id), formula);
  assert.strictEqual(result("alpha"), 16);
  assert.strictEqual(result("beta"), 1);
});

const property = (source, id) => source.properties.find((entry) => entry.id === id);
const sourceFor = (workspace, id = "projects") => workspace.dataSources.find((entry) => entry.id === id);
const update = (workspace, propertyId, definition, sourceId = "projects") => propertyChanges.updatePropertyDefinition(workspace, {
  sourceId, propertyId, definition, now: "2026-11-12T00:00:00.000Z",
});

test("only actual name references change; string literals, ID references and spacing stay intact", () => {
  const original = `concat("金额", "prop(\\\"金额\\\")", format(prop ( '金额' )), format(PROp(("金额"))), format({{amount}}), format(prop("金额2")))`;
  const expected = `concat("金额", "prop(\\\"金额\\\")", format(prop ( "新金额" )), format(PROp(("新金额"))), format({{amount}}), format(prop("金额2")))`;
  assert.strictEqual(renameFormulaPropertyReference(original, "金额", "新金额"), expected);
  const workspace = coreParityWorkspace(), source = sourceFor(workspace);
  property(source, "formula").config.expression = original;
  const result = update(workspace, "amount", { name: "新金额" });
  assert.strictEqual(property(sourceFor(result), "formula").config.expression, expected);
  assert.deepEqual(formulaDependencies(expected, { resolveName: (name) => name === "新金额" ? "amount" : null }), ["amount"]);
});

test("Unicode, quotes, backslashes and empty property names round-trip through actual evaluation", () => {
  const workspace = coreParityWorkspace(), source = sourceFor(workspace);
  const oldName = '旧"\\金额\n';
  const newName = '数"\\值\n😀';
  property(source, "amount").name = oldName;
  property(source, "formula").config.expression = `prop(${JSON.stringify(oldName)}) + 1`;
  workspace.databaseItems.find((item) => item.id === "alpha").values.amount = 15;
  const renamed = update(workspace, "amount", { name: newName });
  const nextSource = sourceFor(renamed), nextFormula = property(nextSource, "formula");
  assert.strictEqual(nextFormula.config.expression, `prop(${JSON.stringify(newName)}) + 1`);
  assert.strictEqual(resolvePropertyValue(renamed, nextSource, renamed.databaseItems[0], nextFormula), 16);
  const emptied = update(renamed, "amount", { name: "" });
  assert.strictEqual(property(sourceFor(emptied), "formula").config.expression, 'prop("") + 1');
  assert.strictEqual(resolvePropertyValue(emptied, sourceFor(emptied), emptied.databaseItems[0], property(sourceFor(emptied), "formula")), 16);
  const named = update(emptied, "amount", { name: "恢复" });
  assert.strictEqual(property(sourceFor(named), "formula").config.expression, 'prop("恢复") + 1');
});

test("successive live name edits keep the original numeric property binding", () => {
  let workspace = coreParityWorkspace();
  property(sourceFor(workspace), "formula").config.expression = 'prop("金额") + 1';
  workspace.databaseItems[0].values.amount = 15;
  const items = structuredClone(workspace.databaseItems);
  for (const name of ["", "新", "新\"", "新\"额😀"]) {
    workspace = update(workspace, "amount", { name });
    const source = sourceFor(workspace);
    assert.strictEqual(resolvePropertyValue(workspace, source, workspace.databaseItems[0], property(source, "formula")), 16, name);
  }
  assert.deepEqual(workspace.databaseItems, items);
});

test("control characters that the formula lexer does not decode from JSON still preserve the reference", () => {
  const workspace = coreParityWorkspace(), source = sourceFor(workspace);
  const newName = '控制\b\f\u0001"\\';
  property(source, "formula").config.expression = 'prop("金额") + 1';
  workspace.databaseItems[0].values.amount = 15;
  const result = update(workspace, "amount", { name: newName });
  const nextSource = sourceFor(result);
  assert.strictEqual(resolvePropertyValue(result, nextSource, result.databaseItems[0], property(nextSource, "formula")), 16);
});

test("formula chains and references to a renamed formula retain their property IDs", () => {
  const workspace = coreParityWorkspace(), source = sourceFor(workspace);
  workspace.databaseItems[0].values.amount = 15;
  property(source, "formula").config.expression = 'prop("金额") + 1';
  source.properties.push(createProperty({ id: "chain", name: "链", type: "formula", config: { expression: 'prop("双倍金额") * 2' } }));
  const amountRenamed = update(workspace, "amount", { name: "新金额" });
  const formulaRenamed = update(amountRenamed, "formula", { name: "新公式", config: { display: "keep" } });
  const nextSource = sourceFor(formulaRenamed);
  assert.strictEqual(property(nextSource, "formula").config.expression, 'prop("新金额") + 1');
  assert.strictEqual(property(nextSource, "formula").config.display, "keep");
  assert.strictEqual(property(nextSource, "chain").config.expression, 'prop("新公式") * 2');
  assert.strictEqual(resolvePropertyValue(formulaRenamed, nextSource, formulaRenamed.databaseItems[0], property(nextSource, "chain")), 32);
});

test("a formula definition edited together with its own name is rewritten atomically", () => {
  const workspace = coreParityWorkspace(), source = sourceFor(workspace);
  source.properties.push(createProperty({ id: "chain", name: "链", type: "formula", config: { expression: 'prop("双倍金额") + 1' } }));
  const result = update(workspace, "formula", { name: "新公式", config: { expression: 'if(false, prop("双倍金额"), 7)', custom: "keep" } });
  const nextSource = sourceFor(result);
  assert.strictEqual(property(nextSource, "formula").config.expression, 'if(false, prop("新公式"), 7)');
  assert.strictEqual(property(nextSource, "formula").config.custom, "keep");
  assert.strictEqual(property(nextSource, "chain").config.expression, 'prop("新公式") + 1');
  assert.strictEqual(resolvePropertyValue(result, nextSource, result.databaseItems[0], property(nextSource, "chain")), 8);
});

test("historical duplicate names rewrite only when the old reference resolved to the renamed ID", () => {
  const workspace = coreParityWorkspace(), source = sourceFor(workspace);
  source.properties.unshift(createProperty({ id: "earlier", name: "金额", type: "number" }));
  workspace.databaseItems[0].values.earlier = 7;
  property(source, "formula").config.expression = 'prop("金额") + 1';
  const laterRenamed = update(workspace, "amount", { name: "后金额" });
  assert.strictEqual(property(sourceFor(laterRenamed), "formula").config.expression, 'prop("金额") + 1');
  assert.strictEqual(resolvePropertyValue(laterRenamed, sourceFor(laterRenamed), laterRenamed.databaseItems[0], property(sourceFor(laterRenamed), "formula")), 8);
  const firstRenamed = update(workspace, "earlier", { name: "先金额" });
  assert.strictEqual(property(sourceFor(firstRenamed), "formula").config.expression, 'prop("先金额") + 1');
  assert.strictEqual(resolvePropertyValue(firstRenamed, sourceFor(firstRenamed), firstRenamed.databaseItems[0], property(sourceFor(firstRenamed), "formula")), 8);
});

test("renaming to an earlier existing name preserves the renamed property's formula binding", () => {
  const workspace = coreParityWorkspace(), source = sourceFor(workspace);
  source.properties.unshift(createProperty({ id: "earlier", name: "重复名", type: "number" }));
  workspace.databaseItems[0].values.earlier = 7;
  workspace.databaseItems[0].values.amount = 15;
  property(source, "formula").config.expression = 'prop("金额") + prop("重复名") + {{amount}}';
  const result = update(workspace, "amount", { name: "重复名" });
  const nextSource = sourceFor(result);
  assert.strictEqual(resolvePropertyValue(result, nextSource, result.databaseItems[0], property(nextSource, "formula")), 37);
  assert.strictEqual(property(nextSource, "formula").config.expression, '{{amount}} + prop("重复名") + {{amount}}');
  const later = update(result, "amount", { name: "不同名称" });
  assert.strictEqual(property(sourceFor(later), "formula").config.expression, '{{amount}} + prop("重复名") + {{amount}}');
  assert.strictEqual(resolvePropertyValue(later, sourceFor(later), later.databaseItems[0], property(sourceFor(later), "formula")), 37);
});

test("renaming an earlier property preserves formulas already bound to the destination name", () => {
  const workspace = coreParityWorkspace(), source = sourceFor(workspace);
  source.properties.push(createProperty({ id: "later", name: "已有名", type: "number" }));
  workspace.databaseItems[0].values.amount = 15;
  workspace.databaseItems[0].values.later = 7;
  property(source, "formula").config.expression = 'prop("金额") + prop("已有名")';
  const result = update(workspace, "amount", { name: "已有名" });
  const nextSource = sourceFor(result);
  assert.strictEqual(resolvePropertyValue(result, nextSource, result.databaseItems[0], property(nextSource, "formula")), 22);
  assert.strictEqual(property(nextSource, "formula").config.expression, 'prop("已有名") + {{later}}');
  assert.deepEqual(result.databaseItems, workspace.databaseItems);
});

test("destination binding survives even when the renamed property's old name was shadowed", () => {
  const workspace = coreParityWorkspace(), source = sourceFor(workspace);
  source.properties.unshift(createProperty({ id: "first", name: "金额", type: "number" }));
  source.properties.push(createProperty({ id: "later", name: "已有名", type: "number" }));
  workspace.databaseItems[0].values.first = 99;
  workspace.databaseItems[0].values.amount = 15;
  workspace.databaseItems[0].values.later = 7;
  property(source, "formula").config.expression = 'prop("金额") + prop("已有名")';
  const result = update(workspace, "amount", { name: "已有名" });
  const nextSource = sourceFor(result);
  assert.strictEqual(resolvePropertyValue(result, nextSource, result.databaseItems[0], property(nextSource, "formula")), 106);
  assert.strictEqual(property(nextSource, "formula").config.expression, 'prop("金额") + {{later}}');
});

test("invalid syntax and reference-looking text remain unchanged", () => {
  for (const expression of ['prop("金额") +', 'prop("金额", 1)', 'prop("金额") + "unterminated', 'concat("金额", prop("金额")']) {
    assert.strictEqual(renameFormulaPropertyReference(expression, "金额", "新金额"), expression);
  }
  const workspace = coreParityWorkspace(), source = sourceFor(workspace);
  property(source, "formula").config.expression = 'prop("金额") +';
  const result = update(workspace, "amount", { name: "新金额" });
  assert.strictEqual(property(sourceFor(result), "formula").config.expression, 'prop("金额") +');
});

test("only the target source and affected formula expressions change", () => {
  const workspace = coreParityWorkspace(), source = sourceFor(workspace), other = sourceFor(workspace, "partners");
  property(source, "formula").config = { expression: 'prop("金额") + {{amount}}', numberFormat: { format: "cny" }, extra: { keep: true } };
  other.properties.push(createProperty({ id: "other-formula", type: "formula", config: { expression: 'prop("金额") + 1' } }));
  const before = structuredClone(workspace);
  const result = update(workspace, "amount", { name: "金额41", options: [], config: { numberFormat: { format: "percent" } } });
  const next = sourceFor(result);
  assert.deepEqual(workspace, before);
  assert.strictEqual(sourceFor(result, "partners"), other);
  assert.deepEqual(result.databaseItems, before.databaseItems);
  assert.deepEqual(result.pages, before.pages);
  assert.deepEqual(result.databaseViews, before.databaseViews);
  assert.deepEqual(property(next, "formula").config, { expression: 'prop("金额41") + {{amount}}', numberFormat: { format: "cny" }, extra: { keep: true } });
  assert.deepEqual(property(next, "amount").config.numberFormat, { format: "percent" });
  assert.deepEqual(property(next, "amount").options, []);
  for (const entry of source.properties.filter((entry) => !["amount", "formula"].includes(entry.id))) assert.strictEqual(property(next, entry.id), entry);
});

test("same-name and non-name updates retain formulas and existing relation update behavior", () => {
  const workspace = coreParityWorkspace(), source = sourceFor(workspace);
  property(source, "formula").config.expression = "prop('金额') + 1";
  const same = update(workspace, "amount", { name: "金额", config: { custom: true } });
  assert.strictEqual(property(sourceFor(same), "formula").config.expression, "prop('金额') + 1");
  assert.strictEqual(property(sourceFor(same), "amount").config.custom, true);
  const relation = update(workspace, "relation", { name: null, options: [], config: { targetSourceId: "new-partner", custom: 4 } });
  assert.strictEqual(property(sourceFor(relation), "relation").name, property(source, "relation").name);
  assert.strictEqual(property(sourceFor(relation), "relation").config.custom, 4);
  assert.strictEqual(relation.relations[0].targetSourceId, "new-partner");
  assert.strictEqual(property(sourceFor(relation), "formula").config.expression, "prop('金额') + 1");
});
