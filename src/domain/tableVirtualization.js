export const TABLE_ROW_HEIGHT = 36;
export const TABLE_OVERSCAN = 10;

export function tableRowWindow({ count, scrollTop = 0, viewportHeight = 600, rowHeight = TABLE_ROW_HEIGHT, overscan = TABLE_OVERSCAN }) {
  const total = Math.max(0, Math.trunc(count) || 0);
  const size = Math.max(1, rowHeight);
  const first = Math.min(total, Math.max(0, Math.floor(Math.max(0, scrollTop) / size) - overscan));
  const last = Math.min(total, Math.max(first, Math.ceil((Math.max(0, scrollTop) + Math.max(0, viewportHeight)) / size) + overscan));
  return { start: first, end: last, top: first * size, bottom: (total - last) * size };
}
