import test from "node:test";
import assert from "node:assert/strict";
import { chartBarScale, chartDonutLayout } from "../src/domain/chartLayout.js";

test("count bars use one integer scale for equal and unequal groups", () => {
  const equal = chartBarScale([1, 1, 1], { count: true });
  assert.deepEqual(equal.ticks, [0, 1, 2]);
  assert.equal(equal.position(1), 50);

  const unequal = chartBarScale([1, 2, 4], { count: true });
  assert.deepEqual(unequal.ticks, [0, 1, 2, 3, 4]);
  assert.deepEqual([0, 1, 2, 4].map(unequal.position), [0, 25, 50, 100]);
});

test("signed bars share zero and scale tiny, extreme and absent values", () => {
  const mixed = chartBarScale([-2, 0, 3, null]);
  assert.deepEqual(mixed.ticks, [-2, 0, 2, 4]);
  assert.equal(mixed.position(-2), 0);
  assert.ok(mixed.position(0) < mixed.position(3));
  const negative = chartBarScale([-5, -1]);
  assert.equal(negative.position(0), 100);
  assert.ok(negative.position(-5) < negative.position(-1));
  const empty = chartBarScale([0, null]);
  assert.equal(empty.position(0), 0);
  const fractional = chartBarScale([0.00000001, 0.00000002]);
  assert.ok(fractional.position(0.00000001) < fractional.position(0.00000002));
  const large = chartBarScale([-Number.MAX_VALUE, Number.MAX_VALUE]);
  assert.ok(large.ticks.every(Number.isFinite));
  assert.equal(large.position(0), 50);
});

test("count donuts preserve exact shares, total and corresponding records", () => {
  const points = [
    { value: 3, itemIds: ["article-1", "article-2", "article-3"] },
    { value: 2, itemIds: ["article-4", "article-5"] },
    { value: 1, itemIds: ["article-6"] },
  ];
  const layout = chartDonutLayout(points);
  assert.equal(layout.total, 6);
  assert.ok(Math.abs(layout.parts[0].share - 1 / 2) < Number.EPSILON);
  assert.ok(Math.abs(layout.parts[1].share - 1 / 3) < Number.EPSILON);
  assert.equal(layout.parts[1].end, layout.parts[2].offset);
  assert.equal(layout.parts[2].end, 1);
  assert.deepEqual(layout.parts.map(part => part.point), points);
  assert.equal(chartDonutLayout([{ value: 1 }]).parts[0].share, 1);
});

test("sum donuts identify negative values and other aggregations have no share", () => {
  const points = [{ value: 6 }, { value: 3 }, { value: -8 }, { value: 0 }, { value: null }];
  const sum = chartDonutLayout(points, "sum");
  assert.equal(sum.total, 9);
  assert.equal(sum.hasNegative, true);
  assert.deepEqual(sum.parts.map(part => part.share), [2 / 3, 1 / 3, 0, 0, 0]);
  assert.equal(chartDonutLayout([{ value: -2 }, { value: null }], "sum").total, 0);
  for (const aggregation of ["average", "min", "max"]) {
    const layout = chartDonutLayout(points, aggregation);
    assert.equal(layout.distributable, false);
    assert.ok(layout.parts.every(part => part.share === 0));
  }
});
