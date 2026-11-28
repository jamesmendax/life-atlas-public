import assert from "node:assert/strict";
import test from "node:test";
import { normalizeViewConfig } from "../../src/domain/viewRegistry.js";
import { mapNotionSourceViewConfiguration } from "../../src/import/notionSourceViewConfig.js";
import { createDatabaseView } from "../../src/domain/database.js";
import { source156, workspace156 } from "../../.qa/LOCAL-NOTION-001/v14-wiki-real133/import156/fixture156.mjs";

test("normalizeViewConfig supports side peek and board layout fields", () => {
  // openRecordsIn
  assert.equal(normalizeViewConfig("board", { openRecordsIn: "side" }).openRecordsIn, "side");
  assert.equal(normalizeViewConfig("board", { openRecordsIn: "page" }).openRecordsIn, "page");
  assert.equal(normalizeViewConfig("board", { openRecordsIn: "peek" }).openRecordsIn, "peek");
  assert.equal(normalizeViewConfig("board", { openRecordsIn: "invalid" }).openRecordsIn, "peek");
  assert.equal(Object.hasOwn(normalizeViewConfig("board", {}), "openRecordsIn"), false);

  // showDataSourceTitle & showPageIcon
  assert.equal(normalizeViewConfig("board", { showDataSourceTitle: true }).showDataSourceTitle, true);
  assert.equal(normalizeViewConfig("board", { showDataSourceTitle: false }).showDataSourceTitle, false);
  assert.equal(normalizeViewConfig("board", { showPageIcon: true }).showPageIcon, true);
  assert.equal(normalizeViewConfig("board", { showPageIcon: false }).showPageIcon, false);

  // board specific settings
  const normalized = normalizeViewConfig("board", {
    board: { colorColumns: true, wrapAllContent: true, extraMetadata: "preserved" }
  });
  assert.deepEqual(normalized.board, {
    colorColumns: true,
    wrapAllContent: true,
    extraMetadata: "preserved"
  });

  const neutral = normalizeViewConfig("board", {
    board: { colorColumns: false, wrapAllContent: false }
  });
  assert.deepEqual(neutral.board, {
    colorColumns: false,
    wrapAllContent: false
  });
});

test("Proposal 166 W2 Board input maps with side peek, title, icon and board layout settings", () => {
  const source = source156("札记");
  const input = {
    name: "札记 · 阶段",
    type: "board",
    filter: { propertyId: "公开", operator: "checked" },
    sorts: [{ propertyId: "最近更新", direction: "desc" }],
    groupBy: "阶段",
    grouping: {
      primaryPropertyId: "阶段",
      secondaryPropertyId: null,
      order: ["初记", "成形", "推演"],
      hiddenGroupKeys: ["未分组"],
      showEmpty: false
    },
    visiblePropertyIds: ["标题", "摘要"],
    config: {
      openRecordsIn: "side",
      showDataSourceTitle: true,
      showPageIcon: true,
      board: {
        colorColumns: true,
        wrapAllContent: true
      }
    }
  };

  const result = mapNotionSourceViewConfiguration(input, source);
  assert.equal(result.valid, true, result.reason);
  assert.equal(result.view.config.openRecordsIn, "side");
  assert.equal(result.view.config.showDataSourceTitle, true);
  assert.equal(result.view.config.showPageIcon, true);
  assert.deepEqual(result.view.config.board, { colorColumns: true, wrapAllContent: true });

  const view = createDatabaseView({ ...result.view, id: "proposal166-w2-view", sourceId: source.id });
  assert.equal(view.config.openRecordsIn, "side");
  assert.equal(view.config.showDataSourceTitle, true);
  assert.equal(view.config.showPageIcon, true);
  assert.deepEqual(view.config.board, { colorColumns: true, wrapAllContent: true });
});

test("Proposal 166 W4 List input maps with side peek and common title/icon settings", () => {
  const source = source156("书架");
  const input = {
    name: "书架 · 在读",
    type: "list",
    filter: { propertyId: "状态", operator: "equals", value: "Reading" },
    sorts: [{ propertyId: "开始日期", direction: "desc" }],
    groupBy: null,
    grouping: null,
    visiblePropertyIds: ["书名", "作者", "核心收获"],
    config: {
      openRecordsIn: "side",
      showDataSourceTitle: true,
      showPageIcon: true
    }
  };

  const result = mapNotionSourceViewConfiguration(input, source);
  assert.equal(result.valid, true, result.reason);
  assert.equal(result.view.config.openRecordsIn, "side");
  assert.equal(result.view.config.showDataSourceTitle, true);
  assert.equal(result.view.config.showPageIcon, true);

  const view = createDatabaseView({ ...result.view, id: "proposal166-w4-view", sourceId: source.id });
  assert.equal(view.config.openRecordsIn, "side");
  assert.equal(view.config.showDataSourceTitle, true);
  assert.equal(view.config.showPageIcon, true);
});

test("Proposal 166 rejects non-boolean values and non-object board", () => {
  const source = source156("札记");
  const base = {
    name: "札记 · 阶段",
    type: "board",
    groupBy: "阶段",
    visiblePropertyIds: ["标题"]
  };

  // Invalid openRecordsIn
  assert.equal(mapNotionSourceViewConfiguration({ ...base, config: { openRecordsIn: "invalid-mode" } }, source).valid, false);
  assert.equal(mapNotionSourceViewConfiguration({ ...base, config: { openRecordsIn: 123 } }, source).valid, false);

  // Invalid showDataSourceTitle
  assert.equal(mapNotionSourceViewConfiguration({ ...base, config: { showDataSourceTitle: "true" } }, source).valid, false);
  assert.equal(mapNotionSourceViewConfiguration({ ...base, config: { showDataSourceTitle: 1 } }, source).valid, false);

  // Invalid showPageIcon
  assert.equal(mapNotionSourceViewConfiguration({ ...base, config: { showPageIcon: "false" } }, source).valid, false);

  // Invalid board structure
  assert.equal(mapNotionSourceViewConfiguration({ ...base, config: { board: "invalid" } }, source).valid, false);
  assert.equal(mapNotionSourceViewConfiguration({ ...base, config: { board: { colorColumns: "yes" } } }, source).valid, false);
  assert.equal(mapNotionSourceViewConfiguration({ ...base, config: { board: { wrapAllContent: 0 } } }, source).valid, false);
});
