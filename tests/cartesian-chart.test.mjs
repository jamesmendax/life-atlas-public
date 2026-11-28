import assert from "node:assert/strict";
import test from "node:test";
import { cartesianChartLayout } from "../src/domain/cartesianChart.js";

function point(label, group, value, categoryKey = label) {
  return { key: JSON.stringify([categoryKey, group]), label, categoryKey, group, value };
}

test("grouped columns reserve a consistent slot for each series and keep exact signed values", () => {
  const first = point("选题", "设计", -3.125);
  const second = point("选题", "编辑", 6.25);
  const zero = point("制作", "编辑", 0);
  const layout = cartesianChartLayout([first, second, zero], {
    kind: "column", groupProperty: { options: [{ name: "编辑" }, { name: "设计" }] },
  });
  assert.deepEqual(layout.series.map(series => series.label), ["编辑", "设计"]);
  assert.deepEqual(layout.slots.map(slot => slot.marks.map(mark => [mark.point, mark.seriesIndex, mark.start, mark.end])), [
    [[second, 0, 0, 6.25], [first, 1, 0, -3.125]], [[zero, 0, 0, 0]],
  ]);
  assert.ok(layout.scale.position(-3.125) < layout.scale.position(0));
  assert.ok(layout.scale.position(0) < layout.scale.position(6.25));
});

test("stacked columns accumulate positive and negative values separately on the same scale", () => {
  const layout = cartesianChartLayout([
    point("甲", "a", 5), point("甲", "b", -4), point("甲", "c", 7), point("甲", "d", -3),
    point("乙", "a", 0), point("乙", "b", null), point("乙", "c", -1),
  ], { kind: "column", stacked: true });
  assert.equal(layout.combine, true);
  assert.deepEqual(layout.slots.map(slot => slot.marks.map(mark => [mark.start, mark.end])), [
    [[0, 5], [0, -4], [5, 12], [-4, -7]], [[0, 0], [0, -1]],
  ]);
  assert.ok(layout.scale.ticks[0] <= -7);
  assert.ok(layout.scale.ticks.at(-1) >= 12);
  assert.ok(layout.scale.ticks.includes(0));
});

test("lines break on absent and null values, keeping real zero and isolated points", () => {
  const layout = cartesianChartLayout([
    point("一", "a", -2), point("二", "a", 0), point("三", "a", null),
    point("二", "b", 3), point("三", "b", 4), point("四", "b", 6), point("五", "a", 2),
  ], { kind: "line", stacked: true });
  assert.equal(layout.combine, false);
  assert.deepEqual(layout.series.map(series => series.runs.map(run => run.map(mark => [mark.index, mark.end]))), [
    [[[0, -2], [1, 0]], [[4, 2]]], [[[1, 3], [2, 4], [3, 6]]],
  ]);
  assert.equal(layout.slots[4].marks[0].point.label, "五");
});

test("explicit axis order overrides chronological fallback and repeated display labels stay separate", () => {
  const points = [point("2026-11-30", "a", 1), point("2026-10-28", "a", 2), point("未设置", "a", 3)];
  const date = { type: "date" };
  const timeline = cartesianChartLayout(points, { kind: "line", count: true, categoryProperty: date });
  assert.deepEqual(timeline.slots.map(slot => slot.label), ["2026-10-28", "2026-11-30", "未设置"]);
  const custom = cartesianChartLayout(points, { kind: "line", categoryProperty: date, categories: [
    { key: "未设置" }, { key: "2026-11-30" }, { key: "2026-10-28" },
  ] });
  assert.deepEqual(custom.slots.map(slot => slot.label), ["未设置", "2026-11-30", "2026-10-28"]);

  const duplicates = [point("同名记录", "a", 0, "first"), point("同名记录", "b", 1, "second")];
  const legacy = duplicates.map(({ categoryKey, ...mark }) => mark);
  assert.deepEqual(cartesianChartLayout(legacy, { kind: "column" }).slots.map(slot => slot.id), ["first", "second"]);
});

test("empty values produce no marks or phantom zero, and overflowing stacks retain their finite segments", () => {
  const empty = cartesianChartLayout([point("甲", "a", null), point("甲", "b", NaN)], { kind: "line" });
  assert.equal(empty.hasValues, false);
  assert.deepEqual(empty.slots[0].marks, []);
  const overflowing = cartesianChartLayout([
    point("甲", "a", Number.MAX_VALUE), point("甲", "b", Number.MAX_VALUE),
  ], { kind: "column", stacked: true });
  assert.equal(overflowing.overflow, true);
  assert.deepEqual(overflowing.slots[0].marks.map(mark => mark.end), [Number.MAX_VALUE]);
  assert.equal(overflowing.scale.position(Number.MAX_VALUE), 100);
});
