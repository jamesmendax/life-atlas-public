import test from "node:test";
import assert from "node:assert/strict";
import { tableRowWindow } from "../src/domain/tableVirtualization.js";

test("virtual table windows include exactly the visible range and ten-row overscan", () => {
  assert.deepEqual(tableRowWindow({ count: 20000, scrollTop: 3600, viewportHeight: 360 }), { start: 90, end: 120, top: 3240, bottom: 715680 });
  assert.deepEqual(tableRowWindow({ count: 20000, scrollTop: 0, viewportHeight: 360 }), { start: 0, end: 20, top: 0, bottom: 719280 });
});

test("virtual table windows clamp at either boundary and retain the complete scroll height", () => {
  for (const scrollTop of [-10, 0, 7200, 720000]) {
    const range = tableRowWindow({ count: 20000, scrollTop, viewportHeight: 630 });
    assert.ok(range.start >= 0 && range.end <= 20000 && range.start <= range.end);
    assert.equal(range.top + (range.end - range.start) * 36 + range.bottom, 720000);
  }
  assert.deepEqual(tableRowWindow({ count: 0 }), { start: 0, end: 0, top: 0, bottom: 0 });
});
