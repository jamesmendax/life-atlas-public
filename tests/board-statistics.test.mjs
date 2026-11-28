import assert from "node:assert/strict";
import test from "node:test";
import { boardStatisticProperties, computeBoardStatistic, resolveBoardStatistic } from "../src/domain/boardStatistics.js";
import { groupViewItems, projectViewItems, updateDatabaseItemValue } from "../src/domain/database.js";
import { normalizeViewConfig } from "../src/domain/viewRegistry.js";
import { boardStatisticsWorkspace as fixture } from "./fixtures/board-statistics-workspace.mjs";

test("existing and stale board settings fall back to the project count", () => {
  const { workspace, source, rows } = fixture();
  assert.deepEqual(boardStatisticProperties(source).map(property => property.id), ["amount", "formula", "rollup"]);
  const missing = [undefined, { propertyId: "deleted", calculation: "sum" }, { propertyId: "date", calculation: "max" }, { propertyId: "amount", calculation: "invalid" }];
  for (const config of missing) {
    const stat = resolveBoardStatistic(source, config);
    assert.deepEqual(stat, { property: null, calculation: "count_all", label: "项目数" });
    assert.deepEqual(computeBoardStatistic(workspace, source, rows, stat, 1), { value: 5, text: "5" });
    assert.deepEqual(computeBoardStatistic(workspace, source, [], stat), { value: 0, text: "0" });
  }
});

test("board number statistics use table formats and distinguish missing cells from genuine zero", () => {
  const { workspace, source, rows } = fixture();
  for (const [calculation, value, text] of [["sum", 4, "¥4.00"], ["average", 4 / 3, "¥1.33"], ["min", -8, "-¥8.00"], ["max", 12, "¥12.00"]]) {
    const stat = resolveBoardStatistic(source, { propertyId: "amount", calculation });
    assert.deepEqual(computeBoardStatistic(workspace, source, rows, stat), { value, text });
    assert.deepEqual(computeBoardStatistic(workspace, source, [rows[1]], stat), { value: 0, text: "¥0.00" });
    assert.deepEqual(computeBoardStatistic(workspace, source, [rows[2]], stat), { value: null, text: "—" });
    assert.deepEqual(computeBoardStatistic(workspace, source, [], stat), { value: null, text: "—" });
  }
  const sum = resolveBoardStatistic(source, { propertyId: "amount", calculation: "sum" });
  const opposite = updateDatabaseItemValue(rows[0], "amount", -12);
  assert.deepEqual(computeBoardStatistic(workspace, source, [rows[0], opposite], sum), { value: 0, text: "¥0.00" });
});

test("board column totals follow filters and move events, and each lane uses only its own records", () => {
  const { workspace, source, rows, view } = fixture();
  const columnStatistic = { propertyId: "amount", calculation: "sum" };
  const retained = normalizeViewConfig("board", JSON.parse(JSON.stringify({ board: { colorColumns: true, columnStatistic } })));
  assert.deepEqual(retained.board.columnStatistic, columnStatistic);
  assert.equal(retained.board.colorColumns, true);
  const stat = resolveBoardStatistic(source, retained.board.columnStatistic);
  const group = (key, scoped) => groupViewItems(workspace, view, scoped).find(entry => entry.key === key);
  const value = (records) => computeBoardStatistic(workspace, source, records, stat).value;

  const doing = group("doing", projectViewItems(workspace, view));
  assert.equal(value(doing.items), 4);
  assert.deepEqual(doing.secondaryGroups.map(lane => [lane.key, value(lane.items)]), [["design", 12], ["launch", 4]]);

  const altered = { ...view, filter: { propertyId: "amount", operator: "greater_than", value: 1 } };
  assert.equal(value(group("doing", projectViewItems(workspace, altered)).items), 12);
  const moved = rows.map(item => item.id === "alpha" ? updateDatabaseItemValue(item, "status", "todo") : item);
  assert.equal(value(group("doing", moved).items), -8);
  assert.equal(value(group("todo", moved).items), 12);
});
