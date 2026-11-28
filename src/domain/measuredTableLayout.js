import { TABLE_OVERSCAN, TABLE_ROW_HEIGHT } from "./tableVirtualization.js";

// Prefix offsets let rows of unknown height coexist with measured, fractional
// CSS heights. Store measurements by row key because sorting and groups move rows.
export function measuredTableLayout(rows, heights) {
  const offsets = [0];
  for (const row of rows) offsets.push(offsets.at(-1) + (heights.get(row.key) || TABLE_ROW_HEIGHT));
  function rowAt(y) {
    let low = 0, high = rows.length;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (offsets[mid + 1] <= y) low = mid + 1;
      else high = mid;
    }
    return Math.min(low, Math.max(rows.length - 1, 0));
  }
  function windowAt(scrollTop, height, overscan = TABLE_OVERSCAN) {
    const start = Math.max(0, rowAt(Math.max(0, scrollTop)) - overscan);
    const end = Math.min(rows.length, rowAt(Math.max(0, scrollTop) + Math.max(0, height)) + 1 + overscan);
    return { start, end, top: offsets[start], bottom: offsets.at(-1) - offsets[end] };
  }
  return { rows, offsets, rowAt, windowAt };
}
