import test from "node:test";
import assert from "node:assert/strict";
import { measuredTableLayout } from "../src/domain/measuredTableLayout.js";

test("measured rows preserve precise CSS offsets and unknown rows use the fixed-height estimate", () => {
  const rows = Array.from({ length: 650 }, (_, index) => ({ key: "r" + index }));
  const heights = new Map([["r0", 99.5], ["r100", 77.25], ["r649", 104]]);
  const model = measuredTableLayout(rows, heights);
  assert.equal(model.offsets[1], 99.5);
  assert.equal(model.rowAt(99.49), 0);
  assert.equal(model.rowAt(99.5), 1);
  assert.equal(model.rowAt(1e6), 649);
  const next = measuredTableLayout([...rows].reverse(), heights);
  assert.equal(next.offsets[1], 104);
  for (const y of [-100, 0, 99.5, 10000, 40000]) {
    const range = model.windowAt(y, 640);
    assert.equal(range.top + model.offsets[range.end] - model.offsets[range.start] + range.bottom, model.offsets.at(-1));
    assert.ok(range.end - range.start < 42);
  }
  assert.deepEqual(model.windowAt(1e6, 640), { start: 639, end: 650, top: model.offsets[639], bottom: 0 });
  assert.deepEqual(measuredTableLayout([], new Map()).windowAt(0, 640), { start: 0, end: 0, top: 0, bottom: 0 });
});
