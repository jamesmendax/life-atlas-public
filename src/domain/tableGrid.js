export const MAX_TABLE_SPAN = 1000;
export const MAX_PROJECTED_TABLE_CELLS = 250000;

export function cellSpan(value, limit = MAX_TABLE_SPAN) {
  return Number.isSafeInteger(value) && value > 0 ? Math.min(value, limit) : 1;
}

export function tableRows(content) {
  const rows = Array.isArray(content?.rows) ? content.rows : Array.isArray(content) ? content : [];
  return rows.map((row) => Array.isArray(row?.cells) ? row.cells : Array.isArray(row) ? row : []);
}

// Keep only anchors and the end-row of each active column. Physical cell
// indexes skip columns reserved by earlier rowspans or colspans.
export function layoutTable(rows, { colspanOf = (cell) => cell?.props?.colspan, rowspanOf = (cell) => cell?.props?.rowspan, maxCells = Infinity } = {}) {
  const occupiedUntil = [];
  let width = 0, hasSpans = false, displaced = false;
  const placed = [];
  for (const [rowIndex, cells] of rows.entries()) {
    const row = [];
    let column = 0;
    for (const cell of cells) {
      const colspan = cellSpan(colspanOf(cell, rowIndex));
      const rowspan = cellSpan(rowspanOf(cell, rowIndex), Math.min(65534, rows.length - rowIndex));
      while (occupiedUntil[column] > rowIndex) column += 1;
      for (let x = column + 1; x < column + colspan; x += 1) {
        if (!(occupiedUntil[x] > rowIndex)) continue;
        // Overlapping source markup has no rectangular backing cell here.
        // Keep the anchor in the next free run rather than overwriting data.
        displaced = true;
        column = x + 1;
        while (occupiedUntil[column] > rowIndex) column += 1;
        x = column;
      }
      const end = column + colspan;
      if (end * rows.length > maxCells) throw new RangeError("表格展开后的格数过多");
      for (let x = column; x < end; x += 1) occupiedUntil[x] = rowIndex + rowspan;
      row.push({ cell, column, colspan, rowspan });
      width = Math.max(width, end);
      hasSpans ||= colspan > 1 || rowspan > 1;
      column = end;
    }
    placed.push(row);
  }
  return { placed, width, hasSpans, displaced };
}

export function fillTableGaps({ placed, width }, { padRows = false } = {}) {
  const occupiedUntil = [];
  return placed.map((anchors, rowIndex) => {
    const row = [];
    const last = anchors.at(-1);
    const rowWidth = padRows ? width : last ? last.column + last.colspan : 0;
    let next = 0;
    for (let column = 0; column < rowWidth;) {
      if (occupiedUntil[column] > rowIndex) {
        column += 1;
        continue;
      }
      const anchor = anchors[next];
      if (anchor?.column === column) {
        row.push(anchor);
        for (let offset = 0; offset < anchor.colspan; offset += 1) {
          occupiedUntil[column + offset] = rowIndex + anchor.rowspan;
        }
        column += anchor.colspan;
        next += 1;
      } else {
        row.push({ cell: null, column, colspan: 1, rowspan: 1 });
        column += 1;
      }
    }
    return row;
  });
}

export function flattenTable({ placed, width, hasSpans }, render, blank) {
  if (hasSpans && placed.length * width > MAX_PROJECTED_TABLE_CELLS) throw new RangeError("表格展开后的格数过多");
  return placed.map((row) => {
    const cells = Array(width).fill(blank);
    for (const anchor of row) cells[anchor.column] = render(anchor.cell);
    return cells;
  });
}
