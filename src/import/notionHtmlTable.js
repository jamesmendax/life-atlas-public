import { fillTableGaps, flattenTable, layoutTable, MAX_TABLE_SPAN } from "../domain/tableGrid.js";

const MAX_SPANNED_GRID = 8000;

export function convertNotionHtmlTable(table, inline) {
  const domRows = [...table.rows];
  const input = domRows.map((row) => [...row.cells]);
  if (!input.some((row) => row.length)) return { content: null, warnings: [] };

  const warnings = [];
  const groupEnd = Array(input.length);
  for (let row = input.length - 1; row >= 0; row -= 1) {
    groupEnd[row] = domRows[row].parentElement === domRows[row + 1]?.parentElement ? groupEnd[row + 1] : row + 1;
  }
  const isSpanned = input.some((cells) => cells.some((cell) => cell.rowSpan !== 1 || cell.colSpan !== 1));
  let clipped = false;
  let layout;
  try {
    layout = layoutTable(input, {
      maxCells: isSpanned ? MAX_SPANNED_GRID : Infinity,
      colspanOf: (cell) => {
        if (Number(cell.getAttribute("colspan")) > MAX_TABLE_SPAN) clipped = true;
        return cell.colSpan;
      },
      rowspanOf: (cell, row) => {
        const remaining = groupEnd[row] - row;
        if (cell.rowSpan > remaining) clipped = true;
        return cell.rowSpan === 0 ? remaining : Math.min(cell.rowSpan, remaining);
      },
    });
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    // Keep the source values and span hints without allocating a huge grid.
    const fallbackRows = input.map((cells, row) => cells.flatMap((cell, index) => [
      { type: "text", text: `${index ? " ｜ " : `第 ${row + 1} 行：`}［${index + 1}：横跨 ${cell.colSpan}，纵跨 ${cell.rowSpan || groupEnd[row] - row}］`, styles: {} },
      ...inline(cell),
    ]));
    return { content: null, fallbackRows, warnings: ["展开后的表格过大，已按源行保留文字和跨度标记。"] };
  }

  const rows = fillTableGaps(layout, { padRows: true });
  // BlockNote represents row/column headers as leading counts, and requires
  // at least one physical cell per row. Avoid emitting shapes it cannot load.
  const flatten = layout.displaced || rows.some((row) => !row.length);
  const header = (entry) => entry.cell?.tagName === "TH";
  const editable = flatten
    ? flattenTable(layout, (cell) => cell, null).map((row) => row.map((cell, column) => ({ cell, column, rowspan: 1, colspan: 1 })))
    : rows;
  let headerRows = 0, headerCols = 0;
  while (headerRows < editable.length && editable[headerRows].every(header)) headerRows += 1;
  const body = editable.slice(headerRows);
  if (body.length) {
    // Using more leading physical cells than a body row contains would turn
    // that entire row into a header after an editor save and reload.
    while (headerCols < editable[0].length && body.every((row) => row.length > headerCols + 1 && header(row[headerCols]) && row[headerCols].column === headerCols)) headerCols += 1;
  }
  if (flatten) warnings.push("跨度重叠或完全覆盖某行，已按原网格展开；被覆盖的位置留空。");
  if (clipped) warnings.push("部分跨度超出可表示的范围，已裁到所在行组或列宽上限。");
  if (editable.some((row, y) => row.some((entry) => entry.cell && header(entry) !== (y < headerRows || entry.column < headerCols)))) {
    warnings.push("部分表头超出编辑器支持的连续行列范围，单元格内容已保留。");
  }
  if (table.querySelector("table")) warnings.push("嵌套表格仅保留在所在单元格的文字中。");

  return {
    content: { type: "tableContent", headerRows, ...(headerCols ? { headerCols } : {}), rows: editable.map((row) => ({ cells: row.map(({ cell, rowspan, colspan }) => {
      if (!cell) return [];
      const content = inline(cell);
      return rowspan === 1 && colspan === 1 ? content : { type: "tableCell", props: { rowspan, colspan }, content };
    }) })) },
    warnings,
  };
}
