import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { layoutRoadmap, splitTickLabel } from "../src/domain/roadmapLayout.js";

const DAY = 86400000;
const date = (value) => Date.parse(`${value}T00:00:00Z`);
const entry = (id, start, end = null, extra = {}) => ({ id, title: id, start: start === null ? null : date(start), end: end ? date(end) : null, color: "default", marker: "diamond", subtitle: "", progress: null, statusLabel: "", ...extra });
const layout = (entries, options = {}) => layoutRoadmap({ entries, width: 1200, now: date("2026-03-10"), config: { density: "comfortable", zoom: 1 }, ...options });

test("L1 distant milestones alternate levels and flip at the right edge", () => {
  const result = layout([entry("m1", "2026-01-01"), entry("m2", "2026-06-01"), entry("m3", "2026-12-01")]);
  assert.deepEqual(result.milestones.map((milestone) => milestone.level), [1, 0, 1]);
  assert.deepEqual(result.milestones.map((milestone) => milestone.align), ["start", "start", "end"]);
  assert.equal(result.levels, 2);
});

test("L2 same day milestones fill both sides then stack upward", () => {
  const result = layout(Array.from({ length: 6 }, (_, index) => entry(`m${index + 1}`, "2026-03-10")));
  assert.deepEqual(result.milestones.map((milestone) => `${milestone.level}/${milestone.align}`), ["1/start", "0/start", "1/end", "0/end", "2/start", "2/end"]);
  assert.equal(result.levels, 3);
  assert.equal(result.milestones[4].card.y, result.milestones[0].card.y - 76);
});

test("L3 overlapping phases use separate lanes and touching phases share one", () => {
  const result = layout([entry("p1", "2026-01-01", "2026-02-01"), entry("p2", "2026-01-15", "2026-03-01"), entry("p3", "2026-03-01", "2026-04-01"), entry("p4", "2026-04-01", "2026-05-01")]);
  assert.deepEqual(result.phases.map((phase) => phase.lane), [0, 1, 0, 0]);
});

test("L4 tick units match the reference table", () => {
  const cases = [
    ["2026-03-02", "2026-03-12", 600, "week", 1, 2, "3月2日", "3月9日"],
    ["2026-03-02", "2026-03-12", 1200, "day", 2, 8, "2月28日", "3月14日"],
    ["2026-03-02", "2026-03-12", 2400, "day", 1, 17, "2月27日", "3月15日"],
    ["2026-01-15", "2026-07-15", 600, "month", 2, 3, "2026年3月", "7月"],
    ["2026-01-15", "2026-07-15", 1200, "month", 1, 6, "2026年2月", "7月"],
    ["2026-01-15", "2026-07-15", 2400, "week", 2, 14, "1月19日", "7月20日"],
    ["2025-01-01", "2028-01-01", 600, "year", 1, 4, "2025年", "2028年"],
    ["2025-01-01", "2028-01-01", 1200, "month", 6, 7, "2025年1月", "2028年1月"],
    ["2025-01-01", "2028-01-01", 2400, "month", 2, 19, "2025年1月", "2028年1月"],
  ];
  for (const [start, end, width, unit, step, count, first, last] of cases) {
    const result = layout([entry("phase", start, end)], { width });
    assert.deepEqual([result.unit, result.step, result.ticks.length, result.ticks[0]?.label, result.ticks.at(-1)?.label], [unit, step, count, first, last], `${start} → ${end} at ${width}px`);
  }
});

test("L5 today appears only inside the domain", () => {
  const entries = [entry("phase", "2026-03-01", "2026-03-20")];
  assert.ok(layout(entries).today);
  assert.equal(layout(entries, { now: date("2026-01-01") }).today, null);
  assert.equal(layout(entries, { now: date("2027-01-01") }).today, null);
  assert.equal(layout(entries, { config: { showToday: false } }).today, null);
  const result = layout(entries);
  assert.ok(layout(entries, { now: result.domain.start }).today);
  assert.ok(layout(entries, { now: result.domain.end }).today);
});

test("L6 entries without dates go to unscheduled", () => {
  const result = layout([entry("missing-2", null), entry("m1", "2026-03-10"), entry("missing-1", null)]);
  assert.deepEqual(result.unscheduled, ["missing-1", "missing-2"]);
  assert.equal(result.milestones.length, 1);
  assert.equal(result.phases.length, 0);
});

test("L7 zero and one entry do not throw", () => {
  const empty = layout([]);
  assert.deepEqual([empty.ticks, empty.phases, empty.milestones], [[], [], []]);
  assert.equal(empty.levels, 2);
  assert.equal(empty.lanes, 1);
  const single = layout([entry("m1", "2026-03-10")]);
  assert.deepEqual(single.domain, { start: date("2026-03-10") - 7 * DAY, end: date("2026-03-10") + 7 * DAY });
  assert.equal(single.milestones.length, 1);
});

test("L8 layout is deterministic and order independent", () => {
  const entries = [entry("p1", "2026-03-01", "2026-03-20"), entry("m2", "2026-03-10"), entry("m1", "2026-03-10"), entry("u1", null)];
  const original = structuredClone(entries);
  const result = layout(entries);
  assert.deepEqual(layout(entries), result);
  assert.deepEqual(layout([entries[3], entries[1], entries[0], entries[2]]), result);
  assert.deepEqual(entries, original);
});

test("L9 five hundred entries lay out within fifty milliseconds", () => {
  const entries = Array.from({ length: 500 }, (_, index) => ({ ...entry(`entry-${String(index).padStart(3, "0")}`, "2026-01-01"), start: date("2026-01-01") + index * DAY, end: index % 3 === 0 ? date("2026-01-01") + (index + 15) * DAY : null }));
  const started = performance.now();
  const result = layout(entries);
  const elapsed = performance.now() - started;
  console.log(`WP09_LAYOUT_MS=${elapsed.toFixed(3)}`);
  assert.equal(result.phases.length + result.milestones.length, 500);
  assert.ok(elapsed < 50, `500 entries took ${elapsed.toFixed(3)}ms`);
});

test("cards stay inside the axis bounds and connectors still hit the node", () => {
  const result = layout([entry("m1", "2026-01-01"), entry("m2", "2026-01-31")], { width: 400 });
  assert.deepEqual(result.milestones.map((milestone) => `${milestone.level}/${milestone.align}`), ["1/start", "0/end"]);
  for (const milestone of result.milestones) {
    assert.ok(milestone.card.x >= result.axis.x0);
    assert.ok(milestone.card.x + milestone.card.width <= result.axis.x1);
    if (milestone.align === "start") assert.equal(milestone.card.x, milestone.x + 10);
    else assert.equal(milestone.card.x + milestone.card.width, milestone.x - 10);
  }
});

test("L10 phase fill and past milestones follow now", () => {
  const entries = [entry("phase", "2026-01-01", "2026-01-11"), entry("past", "2026-01-03"), entry("future", "2026-01-09")];
  const result = layout(entries, { now: date("2026-01-06") });
  assert.equal(result.phases[0].fill, 0.5);
  assert.equal(result.milestones[0].past, true);
  assert.equal(result.milestones[1].past, false);
  assert.equal(layout([{ ...entries[0], progress: 0.2 }], { now: date("2026-01-06") }).phases[0].fill, 0.2);
  assert.equal(layout([entries[0]], { now: date("2025-01-01") }).phases[0].fill, 0);
  assert.equal(layout([entries[0]], { now: date("2027-01-01") }).phases[0].fill, 1);
});

test("L11 vertical positions follow the density", () => {
  const entries = [entry("phase", "2026-01-01", "2026-01-20"), entry("m1", "2026-01-05"), entry("m2", "2026-01-15")];
  const result = layout(entries);
  assert.equal(result.axis.y, 256);
  assert.equal(result.milestones.find((milestone) => milestone.level === 0).card.y, 174);
  assert.equal(result.milestones.find((milestone) => milestone.level === 1).card.y, 98);
  assert.equal(result.phases[0].y, 292);
  assert.equal(result.height, 384);
  const compact = layout(entries, { config: { density: "compact" } });
  assert.equal(compact.axis.y, 224);
  assert.equal(compact.milestones.find((milestone) => milestone.level === 0).card.y, 158);
  assert.equal(compact.milestones.find((milestone) => milestone.level === 1).card.y, 98);
});

test("tick labels split into numeral unit and note", () => {
  assert.deepEqual(splitTickLabel("3月9日"), { numeral: "9", unit: "日", note: "3月", small: false });
  assert.deepEqual(splitTickLabel("7月"), { numeral: "7", unit: "月", note: "", small: false });
  assert.deepEqual(splitTickLabel("2026年3月"), { numeral: "3", unit: "月", note: "2026", small: false });
  assert.deepEqual(splitTickLabel("2026 Q3"), { numeral: "3", unit: "季度", note: "2026", small: false });
  assert.deepEqual(splitTickLabel("2028年"), { numeral: "2028", unit: "年", note: "", small: true });
});

test("centered cards in narrow containers terminate without leaving the axis", () => {
  const result = layout([entry("m1", "2026-03-10")], { width: 400 });
  assert.equal(result.milestones.length, 1);
  assert.ok(result.milestones[0].card.x >= result.axis.x0);
  assert.ok(result.milestones[0].card.x + result.milestones[0].card.width <= result.axis.x1);
});

test("fixed scales and very narrow containers retain their contracts", () => {
  const entries = [entry("m1", "2026-01-01"), entry("m2", "2027-01-01")];
  for (const scale of ["week", "month", "quarter", "year"]) assert.equal(layout(entries, { config: { scale } }).unit, scale);
  const narrow = layout([entry("m1", "2026-03-10")], { width: 120 });
  assert.equal(narrow.milestones[0].card.x, narrow.axis.x0);
  assert.equal(narrow.milestones[0].align, "start");
  assert.equal(layout(entries, { config: { zoom: 2 } }).axis.x1, 2376);
});
