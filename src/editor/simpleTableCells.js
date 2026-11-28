import { createExtension, createTableBlockSpec } from "@blocknote/core";
import { CellSelection, mergeCells, selectedRect, splitCell, TableMap } from "prosemirror-tables";
import { Selection } from "@tiptap/pm/state";
import { findNativeBlock, runEditorTransaction } from "./editorTransactions.js";

export const simpleTableOptions = { headers: true, cellBackgroundColor: true, cellTextColor: true, splitCells: true };

function tableHeaders(table, { map, width, height }) {
  const isHeader = (row, col) => table.nodeAt(map[row * width + col])?.type.spec.tableRole === "header_cell";
  let headerRows = 0;
  while (headerRows < height && Array.from({ length: width }, (_, col) => isHeader(headerRows, col)).every(Boolean)) headerRows++;
  let headerCols = 0;
  while (headerRows < height && headerCols < width &&
    Array.from({ length: height - headerRows }, (_, row) => isHeader(row + headerRows, headerCols)).every(Boolean)) headerCols++;
  return { headerRows: headerRows || undefined, headerCols: headerCols || undefined };
}

function spansCells(table) {
  return table.content.content.some((row) => row.content.content.some((cell) => cell.attrs.rowspan > 1 || cell.attrs.colspan > 1));
}

class TableBlockCache extends WeakMap {
  set(node, block) {
    const table = block.type === "table" ? node.firstChild : null;
    // BlockNote 0.54 counts headers by the stored cell index, which diverges
    // from the logical column when a cell above it spans this row.
    if (table?.type.name === "table" && spansCells(table)) {
      Object.assign(block.content, tableHeaders(table, TableMap.get(table)));
    }
    return super.set(node, block);
  }
}

export function createLifeAtlasTableSpec() {
  const native = createTableBlockSpec();
  return {
    ...native,
    extensions: native.extensions.map((factory) => createExtension((context) => {
      const extension = factory(context);
      if (extension.key !== "table-extensions") return extension;
      context.editor.blockCache = new TableBlockCache();
      return {
        ...extension,
        tiptapExtensions: extension.tiptapExtensions.map((node) => node.name === "tableRow"
          // A full-width rowspan leaves a real row with no physical cell.
          ? node.extend({ content: "(tableCell | tableHeader)*" })
          : node),
      };
    })()),
  };
}

export function restoreTableHeaders(editor, blocks) {
  if (!Array.isArray(blocks)) return;
  editor.transact((tr) => {
    const { tableHeader, tableCell } = tr.doc.type.schema.nodes;
    const visit = (entries) => {
      for (const block of entries || []) {
        if (block.type === "table" && block.content?.headerCols) {
          const native = findNativeBlock(tr.doc, block.id);
          const table = native?.contentNode;
          if (table && spansCells(table)) {
            const map = TableMap.get(table);
            for (const offset of new Set(map.map)) {
              if (!offset) continue;
              const { top, left } = map.findCell(offset);
              const position = native.contentPosition + 1 + offset;
              const cell = tr.doc.nodeAt(position);
              const type = top < block.content.headerRows || left < block.content.headerCols ? tableHeader : tableCell;
              if (cell.type !== type) tr.setNodeMarkup(position, type, cell.attrs, cell.marks);
            }
          }
        }
        visit(block.children);
      }
    };
    visit(blocks);
    if (tr.docChanged) tr.setMeta("addToHistory", false).setMeta("preventUpdate", true);
  });
}

export function tableMergeSelection(state) {
  if (!(state.selection instanceof CellSelection) || !mergeCells(state)) return null;
  const rect = selectedRect(state);
  const { map, table, tableStart, top, bottom, left, right } = rect;
  const { headerRows = 0, headerCols = 0 } = tableHeaders(table, map);
  const offsets = [];
  for (let row = top; row < bottom; row++) {
    offsets.push(...map.map.slice(row * map.width + left, row * map.width + right));
  }
  const [first, ...rest] = new Set(offsets);
  if (!first || rest.some((offset) => !offset)) return null;
  const anchor = table.nodeAt(first);
  const covered = rest.map((offset) => ({ offset, cell: table.nodeAt(offset) }));
  const crossesHeader = (top < headerRows && bottom > headerRows) || (left < headerCols && right > headerCols)
    || covered.some(({ cell }) => cell.type !== anchor.type);
  return {
    rect,
    first,
    anchor,
    covered,
    crossesHeader,
    hasContent: covered.some(({ cell }) => cell.content.content.some((paragraph) => paragraph.content.size > 0)),
    tableStart,
  };
}

export function mergeSelectedTableCells(editor, selection, expectedDocument) {
  const { rect: { map, table, top, bottom, left, right }, tableStart, first, anchor, covered, crossesHeader } = selection;
  if (crossesHeader) return null;
  const position = tableStart + first;
  const colwidth = map.map.slice(left, right).map((offset, index) => table.nodeAt(offset).attrs.colwidth?.[left + index - map.colCount(offset)] || 0);
  return runEditorTransaction(editor, "merge-table-cells", (tr) => {
    for (const { offset, cell } of [...covered].sort((a, b) => b.offset - a.offset)) {
      tr.delete(tableStart + offset, tableStart + offset + cell.nodeSize);
    }
    tr.setNodeMarkup(position, undefined, {
      ...anchor.attrs,
      rowspan: bottom - top,
      colspan: right - left,
      colwidth: colwidth.some(Boolean) ? colwidth : null,
    });
    tr.setSelection(CellSelection.create(tr.doc, position));
  }, { expectedDocument, preserveSelection: false, focus: true });
}

export function tableCellForHandle(state, blockId, rowIndex, colIndex) {
  const block = findNativeBlock(state.doc, blockId);
  const table = block?.contentNode;
  if (table?.type.name !== "table" || rowIndex >= table.childCount) return null;
  const row = table.child(rowIndex);
  if (colIndex >= row.childCount) return null;
  let position = block.contentPosition + 2;
  for (let index = 0; index < rowIndex; index++) position += table.child(index).nodeSize;
  for (let index = 0; index < colIndex; index++) position += row.child(index).nodeSize;
  return { position, cell: row.child(colIndex) };
}

export function splitTableCell(editor, position, expectedDocument) {
  const { prosemirrorState: state } = editor;
  if (state.doc !== expectedDocument) return null;
  const selected = state.apply(state.tr.setSelection(CellSelection.create(state.doc, position)));
  return runEditorTransaction(editor, "split-table-cell", (tr) => {
    splitCell(selected, (split) => {
      for (const step of split.steps) tr.step(step);
      tr.setSelection(Selection.fromJSON(tr.doc, split.selection.toJSON()));
    });
  }, { expectedDocument, preserveSelection: false, focus: true });
}
