import test from "node:test";
import assert from "node:assert/strict";
import { mapNotionSourceViewConfiguration } from "../../src/import/notionSourceViewConfig.js";
import { createDatabaseView } from "../../src/domain/database.js";
import { workspace156, source156, deepFreeze, inspected156, configurationTargetIndex156 } from "../../.qa/LOCAL-NOTION-001/v14-wiki-real133/import156/fixture156.mjs";
import { W2Board } from "../../.qa/LOCAL-NOTION-001/v14-wiki-real133/import156/source-configurations156.mjs";

// Actual W2/W4 settings from the retained native133/source147 observations.
// No HTML live settings are inferred, and no real Wiki state is written.
const W4List = {
  name: "书架 · 在读", type: "list",
  filter: { propertyId: "状态", operator: "equals", value: "Reading" },
  sorts: [{ propertyId: "开始日期", direction: "desc" }],
  groupBy: null, grouping: null, visiblePropertyIds: ["书名", "作者", "核心收获"],
};
const scenarios = [
  ["W2", W2Board.views[0], source156("札记")],
  ["W4", W4List, source156("书架")],
];

function mapRetained(view, source) {
  const input = deepFreeze(structuredClone(view));
  const before = structuredClone({ input, source, workspace: workspace156 });
  const result = mapNotionSourceViewConfiguration(input, source);
  assert.deepEqual({ input, source, workspace: workspace156 }, before);
  return result;
}

test("fidelity164 retains the complete85/58/122 workspace and every62 actual archive member", () => {
  assert.equal(workspace156.pages.length, 85);
  assert.equal(workspace156.databaseItems.length, 58);
  assert.equal(workspace156.pageVersions.length, 122);
  assert.equal(inspected156.entries.size, 62);
  assert.deepEqual(inspected156.problems, []);
  assert.equal(configurationTargetIndex156.retainedMemberPaths.length, 62);
  assert.equal(configurationTargetIndex156.databases.length, 6);
  assert.equal(configurationTargetIndex156.databases.reduce((total, source) => total + source.records.length, 0), 38);
});

for (const [label, view, source] of scenarios) {
  for (const mode of ["Side peek"]) test(`${label} explicit ${mode} is rejected before the actual constructor can change it to peek`, () => {
    const result = mapRetained({ ...view, config: { openRecordsIn: mode } }, source);
    if (result.valid) {
      const persisted = createDatabaseView({ ...result.view, id: "fidelity164-view", sourceId: source.id });
      assert.equal(persisted.config.openRecordsIn, mode, "accepted input must retain its explicitly provided opening semantics");
    }
    assert.equal(result.valid, false, "unsupported Side peek must reject the entire supplied view");
    assert.match(result.reason, /openRecordsIn/);
    assert.equal(Object.hasOwn(result, "view"), false);
  });

  for (const mode of ["peek", "page", "side"]) test(`${label} supported ${mode} survives mapper and actual final view normalization`, () => {
    const result = mapRetained({ ...view, config: { openRecordsIn: mode } }, source);
    assert.equal(result.valid, true, result.reason);
    const persisted = createDatabaseView({ ...result.view, id: "fidelity164-view", sourceId: source.id });
    assert.equal(persisted.config.openRecordsIn, mode);
    assert.equal(result.missingFields.includes("config.openRecordsIn"), false);
  });
}

for (const mode of [null, true, 1, ""]) test(`explicit unsupported openRecordsIn ${String(mode)} cannot become peek`, () => {
  const result = mapRetained({ ...W2Board.views[0], config: { openRecordsIn: mode } }, source156("札记"));
  assert.equal(result.valid, false);
  assert.match(result.reason, /openRecordsIn/);
});

test("absent config and valid partial settings remain valid with truthful missing-field disclosures", () => {
  const source = source156("札记");
  const absent = mapRetained(W2Board.views[0], source);
  assert.equal(absent.valid, true);
  assert.deepEqual(absent.missingFields, ["config"]);
  assert.equal(Object.hasOwn(absent.view, "config"), false);
  const partial = mapRetained({ ...W2Board.views[0], config: {} }, source);
  assert.equal(partial.valid, true);
  assert.deepEqual(partial.missingFields, ["config.openRecordsIn"]);
  assert.deepEqual(createDatabaseView({ ...partial.view, sourceId: source.id }).config, {});
});

test("forward-compatible ordinary metadata remains unchanged through final normalization", () => {
  const config = { ordinaryMetadata: { note: "标题", futureFlag: true, nested: { mode: "future" } } };
  const source = source156("札记");
  const result = mapRetained({ ...W2Board.views[0], config }, source);
  assert.equal(result.valid, true, result.reason);
  assert.deepEqual(result.missingFields, ["config.openRecordsIn"]);
  const persisted = createDatabaseView({ ...result.view, sourceId: source.id });
  assert.deepEqual(persisted.config, config);
});

test("explicit undefined opening mode is missing known input rather than an unsupported mode", () => {
  const result = mapRetained({ ...W2Board.views[0], config: { openRecordsIn: undefined } }, source156("札记"));
  assert.equal(result.valid, true, result.reason);
  assert.deepEqual(result.missingFields, ["config.openRecordsIn"]);
});
