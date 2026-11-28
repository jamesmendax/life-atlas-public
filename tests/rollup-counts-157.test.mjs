import test from "node:test";
import assert from "node:assert/strict";
import { createProperty, projectViewItems, resolveFormulaPropertyValue, resolvePropertyValue } from "../src/domain/database.js";
import { isNumberFilterProperty } from "../src/domain/databaseFilters.js";
import { formatPropertyValue } from "../src/domain/databaseProperties.js";
import { updatePropertyDefinition } from "../src/domain/propertyChanges.js";
import { resolveTypedPropertyValue } from "../src/domain/databasePropertyValues.js";
import { upgradeWorkspace } from "../src/persistence/migrations.js";
import { normalizeLoadedWorkspace } from "../src/persistence/normalize.js";
import { fullWorkspace } from "./fixtures/full-workspace.mjs";

function fixture() {
  const workspace = upgradeWorkspace(fullWorkspace());
  const source = workspace.dataSources.find(entry => entry.id === "ds-full");
  const target = workspace.dataSources.find(entry => entry.id === "ds-inline");
  const record = workspace.databaseItems.find(entry => entry.id === "i-3");
  const related = id => workspace.databaseItems.find(entry => entry.id === id);
  const definitions = new Map();
  const rollup = (aggregation, targetPropertyId) => {
    const id = aggregation + "-" + targetPropertyId;
    if (!definitions.has(id)) {
      const field = createProperty({
        id, name: id, type: "rollup", config: { relationPropertyId: "rel-back", targetPropertyId, aggregation },
      });
      definitions.set(id, field);
      source.properties.push(field);
    }
    return definitions.get(id);
  };
  return { workspace, source, target, record, related, rollup,
    resolve: (aggregation, property) => resolvePropertyValue(workspace, source, record, rollup(aggregation, property)) };
}

test("rollups distinguish linked rows, distinct values, populated cells and total values", () => {
  const { workspace, source, target, record, related, rollup, resolve } = fixture();
  target.properties.push(createProperty({ id: "tags", type: "multi_select", options: [
    { id: "x", name: "科幻" }, { id: "y", name: "历史" }, { id: "z", name: "艺术" },
  ] }));
  related("i-1").values.tags = ["y", "x"];
  related("i-2").values.tags = ["x", "z", "y"];
  workspace.databaseItems.push({ ...related("i-1"), id: "i-5", pageId: "unmaterialized", values: { tags: [] } });
  record.values["rel-back"] = ["i-1", "i-2", "i-5", "missing", "i-4", "i-1"];
  for (const [aggregation, expected] of [
    ["count_all", 3], ["count_values", 5], ["not_empty", 2], ["empty", 1], ["unique", 3],
    ["percent_empty", 1 / 3], ["percent_not_empty", 2 / 3],
  ]) {
    assert.equal(isNumberFilterProperty(rollup(aggregation, "tags")), true, aggregation);
    assert.equal(resolve(aggregation, "tags"), expected, aggregation);
  }
  const shown = rollup("show_unique", "tags");
  const value = resolve("show_unique", "tags");
  assert.equal(isNumberFilterProperty(shown), false);
  assert.deepEqual(value, ["y", "x", "z"]);
  assert.equal(formatPropertyValue(workspace, shown, value, { source }), "历史, 科幻, 艺术");
  const percent = rollup("percent_not_empty", "tags");
  assert.equal(formatPropertyValue(workspace, percent, resolve("percent_not_empty", "tags")), "67%");
  const view = { sourceId: source.id, filter: { propertyId: percent.id, operator: "less_than", value: "0.7" } };
  assert.deepEqual(projectViewItems(workspace, view).map(row => row.id), ["i-3"]);
});

test("empty rollup percentages stay blank while zero and false values count as present", () => {
  const { workspace, target, record, related, rollup, resolve } = fixture();
  target.properties.push(createProperty({ id: "quality", type: "number" }));
  related("i-1").values.quality = 0;
  delete related("i-2").values.quality;
  assert.equal(resolve("not_empty", "quality"), 1);
  assert.equal(resolve("count_values", "quality"), 1);
  assert.equal(resolve("empty", "quality"), 1);
  assert.deepEqual(resolve("show_unique", "quality"), [0]);
  assert.equal(resolve("not_empty", "done"), 2);
  assert.deepEqual(resolve("show_unique", "done"), [true, false]);
  record.values["rel-back"] = ["i-2"];
  assert.equal(resolve("percent_not_empty", "quality"), 0);
  assert.equal(formatPropertyValue(workspace, rollup("percent_not_empty", "quality"), 0), "0%");
  record.values["rel-back"] = [];
  for (const aggregation of ["count_all", "count_values", "not_empty", "empty", "unique"]) {
    assert.equal(resolve(aggregation, "quality"), 0);
  }
  for (const aggregation of ["percent_not_empty", "percent_empty"]) {
    assert.equal(resolve(aggregation, "quality"), null);
    assert.equal(formatPropertyValue(workspace, rollup(aggregation, "quality"), null), "");
  }
});

test("relation rollups discard stale links and distinguish pages sharing a title", () => {
  const { workspace, source, related, rollup, resolve } = fixture();
  related("i-3").values.title = "同名项目";
  related("i-4").values.title = "同名项目";
  related("i-2").values["rel-to-full"].push("i-1", "missing");
  const field = rollup("show_unique", "rel-to-full");
  assert.deepEqual(resolve("show_unique", "rel-to-full"), ["i-3", "i-4"]);
  assert.equal(resolve("unique", "rel-to-full"), 2);
  assert.equal(resolve("count_values", "rel-to-full"), 3);
  assert.equal(formatPropertyValue(workspace, field, ["i-3", "i-4"], { source }), "同名项目, 同名项目");
  workspace.pages.find(page => page.id === "p-rec-4").trashedAt = "2026-11-26";
  assert.deepEqual(resolve("show_unique", "rel-to-full"), ["i-3"]);
});

test("show-original relation rollups display live titles in link order, retaining repeats between records", () => {
  const { workspace, source, related, rollup, resolve } = fixture();
  related("i-1").values["rel-to-full"] = ["i-4", "i-3"];
  related("i-2").values["rel-to-full"] = ["i-4"];
  const field = rollup("show", "rel-to-full");
  const values = resolve("show", "rel-to-full");
  assert.deepEqual(values, [["i-4", "i-3"], ["i-4"]]);
  assert.equal(formatPropertyValue(workspace, field, values, { source }), "项目乙, 项目甲, 项目乙");
  related("i-4").values.title = "改名";
  assert.equal(formatPropertyValue(workspace, field, values, { source }), "改名, 项目甲, 改名");
  workspace.pages.find(page => page.id === "p-rec-4").trashedAt = "2026-11-26";
  assert.equal(formatPropertyValue(workspace, field, values, { source }), "项目甲");
  assert.equal(formatPropertyValue(workspace, field, [[], []], { source }), "");
});

test("raw and typed original relation rollups ignore empty, missing, stale and foreign nested links", () => {
  const { workspace, source, record, related, rollup } = fixture();
  const original = rollup("show", "rel-to-full");
  const linked = related("i-1");
  const other = related("i-2");
  linked.values["rel-to-full"] = ["i-4", "i-3", "i-1", "missing"];
  other.values["rel-to-full"] = [];
  const readRaw = () => resolvePropertyValue(workspace, source, record, original);
  const readTyped = () => resolveTypedPropertyValue(workspace, source, record, original).map(cell => cell.map(page => page.id));
  const readLength = () => resolvePropertyValue(workspace, source, record, createProperty({
    id: "original-length", type: "formula", config: { expression: `prop("${original.name}").length()` },
  }));
  for (const empty of [[], undefined, ["missing", "i-2"]]) {
    other.values["rel-to-full"] = empty;
    assert.deepEqual(readRaw(), [["i-4", "i-3"]]);
    assert.deepEqual(readTyped(), [["i-4", "i-3"]]);
    assert.equal(readLength(), 1);
    assert.equal(formatPropertyValue(workspace, original, readRaw(), { source }), "项目乙, 项目甲");
  }
  const removed = workspace.pages.find(page => page.id === related("i-4").pageId);
  removed.trashedAt = "2026-11-26";
  assert.deepEqual(readRaw(), [["i-3"]]);
  assert.deepEqual(readTyped(), [["i-3"]]);
});

test("the unique page list keeps typed page identity and survives related property rename", () => {
  const { workspace, source, record, rollup } = fixture();
  const unique = rollup("show_unique", "rel-to-full");
  const score = createProperty({ id: "unique-score", type: "formula", config: {
    expression: `prop("${unique.name}").map(current.prop("评分")).sum()`,
  } });
  source.properties.push(score);
  const typed = resolveFormulaPropertyValue(workspace, source, record, unique, undefined, true);
  assert.deepEqual(typed.map(page => [page.id, page.title]), [["i-3", "项目甲"], ["i-4", "项目乙"]]);
  assert.equal(resolvePropertyValue(workspace, source, record, score), 8);
  const updated = updatePropertyDefinition(workspace, { sourceId: source.id, propertyId: "score", definition: { name: "更新评分" } });
  const nextSource = updated.dataSources.find(entry => entry.id === source.id);
  const nextFormula = nextSource.properties.find(entry => entry.id === score.id);
  assert.match(nextFormula.config.expression, /"评分", "ds-full", "score"/);
  assert.equal(resolvePropertyValue(updated, nextSource, record, nextFormula), 8);
});

test("stored count IDs migrate once and new IDs round-trip with their own meanings", () => {
  const { workspace, source, target, rollup, related } = fixture();
  target.properties.push(createProperty({ id: "quality", type: "number" }));
  related("i-1").values.quality = 0;
  const priorCount = rollup("not_empty", "quality");
  const priorUnique = rollup("unique", "quality");
  const countAll = rollup("count_all", "quality");
  priorCount.config.aggregation = "count";
  priorUnique.config.aggregation = "count_unique";
  const loaded = normalizeLoadedWorkspace(JSON.parse(JSON.stringify(workspace)), { idFactory: prefix => prefix });
  const actual = loaded.dataSources.find(entry => entry.id === source.id);
  const record = loaded.databaseItems.find(entry => entry.id === "i-3");
  for (const [origin, aggregation, value] of [
    [priorCount, "not_empty", 1], [priorUnique, "unique", 1], [countAll, "count_all", 2],
  ]) {
    const field = actual.properties.find(entry => entry.id === origin.id);
    assert.equal(field.config.aggregation, aggregation);
    assert.equal(resolvePropertyValue(loaded, actual, record, field), value);
  }
  const reopened = normalizeLoadedWorkspace(JSON.parse(JSON.stringify(loaded)), { idFactory: prefix => prefix });
  assert.deepEqual(reopened.dataSources, loaded.dataSources);
});
