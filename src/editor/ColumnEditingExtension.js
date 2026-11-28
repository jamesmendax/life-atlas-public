import { createExtension } from "@blocknote/core";
import { Fragment } from "@tiptap/pm/model";
import { Plugin, PluginKey, Selection, TextSelection } from "@tiptap/pm/state";
import { isComposingKeyboardEvent } from "../ui/keyboard.js";
import { findNativeBlock, runEditorTransaction } from "./editorTransactions.js";

function directColumnParagraph(state) {
  const { selection } = state;
  if (!(selection instanceof TextSelection) || !selection.empty) return null;
  const point = selection.$from;
  if (point.parent.type.name !== "paragraph" || point.depth < 4) return null;
  const blockDepth = point.depth - 1;
  const groupDepth = blockDepth - 1;
  const columnDepth = groupDepth - 1;
  const block = point.node(blockDepth);
  const group = point.node(groupDepth);
  const column = point.node(columnDepth);
  if (block.type.name !== "blockContainer" || group.type.name !== "blockGroup" || column.firstChild?.type.name !== "column") return null;
  return { block, group, column, point, index: point.index(groupDepth), position: point.before(blockDepth), groupDepth, columnDepth };
}

function firstColumnText(documentNode, columnId) {
  const column = findNativeBlock(documentNode, columnId);
  const children = column?.node.lastChild;
  if (children?.type.name !== "blockGroup") return null;
  let position = null;
  children.forEach((node, offset) => {
    if (position === null && node.firstChild?.inlineContent) {
      position = column.position + column.node.firstChild.nodeSize + offset + 4;
    }
  });
  return position;
}

function dissolveEmptyColumn(state, context) {
  const { point, columnDepth } = context;
  const listGroupDepth = columnDepth - 1;
  const listDepth = listGroupDepth - 1;
  if (listDepth < 1) return null;
  const listGroup = point.node(listGroupDepth);
  const listNode = point.node(listDepth);
  if (listGroup.type.name !== "blockGroup" || listNode.type.name !== "blockContainer" || listNode.firstChild?.type.name !== "columnList") return null;
  const columnIndex = point.index(listGroupDepth);
  const columns = Array.from(listGroup.content.content);
  const remaining = columns.filter((_, idx) => idx !== columnIndex);
  if (!remaining.length) return null;
  const listStart = point.before(listDepth);
  const listEnd = point.after(listDepth);
  const transaction = state.tr;
  if (remaining.length === 1) {
    const survivorChildren = remaining[0].lastChild?.type.name === "blockGroup" ? remaining[0].lastChild.content : Fragment.empty;
    if (!survivorChildren.size) return null;
    transaction.replaceWith(listStart, listEnd, survivorChildren);
    const caretPos = Math.min(listStart + 2, transaction.doc.content.size);
    transaction.setSelection(Selection.near(transaction.doc.resolve(caretPos))).scrollIntoView();
    return transaction;
  }
  const nextCount = remaining.length;
  const listContent = listNode.firstChild;
  const updatedListContent = Object.hasOwn(listContent.type.attrs, "columns")
    ? listContent.type.createChecked({ ...listContent.attrs, columns: nextCount }, listContent.content, listContent.marks)
    : listContent;
  const updatedColumns = remaining.map((col, idx) => {
    const colContent = col.firstChild;
    const nextAttrs = { ...colContent.attrs };
    if (Object.hasOwn(colContent.type.attrs, "index")) nextAttrs.index = idx;
    if (Object.hasOwn(colContent.type.attrs, "count")) nextAttrs.count = nextCount;
    const rebuiltContent = colContent.type.createChecked(nextAttrs, colContent.content, colContent.marks);
    const colChildren = col.childCount > 1 ? [rebuiltContent, col.child(1)] : [rebuiltContent];
    return col.copy(Fragment.fromArray(colChildren));
  });
  const rebuiltGroup = listGroup.copy(Fragment.fromArray(updatedColumns));
  const rebuiltList = listNode.copy(Fragment.fromArray([updatedListContent, rebuiltGroup]));
  transaction.replaceWith(listStart, listEnd, rebuiltList);
  const targetColumn = updatedColumns[Math.max(0, columnIndex - 1)];
  const textPos = targetColumn?.attrs?.id ? firstColumnText(transaction.doc, targetColumn.attrs.id) : null;
  const nextSelection = textPos !== null
    ? TextSelection.create(transaction.doc, textPos)
    : Selection.near(transaction.doc.resolve(Math.min(listStart + 2, transaction.doc.content.size)));
  transaction.setSelection(nextSelection).scrollIntoView();
  return transaction;
}

export function columnBoundaryEdit(state, key) {
  const context = directColumnParagraph(state);
  if (!context) return { handled: false };
  const { point, block, group, index, position, groupDepth, column } = context;
  if (key === "Delete") return { handled: point.parentOffset === point.parent.content.size && block.childCount === 1 && index === group.childCount - 1 };
  if (key !== "Backspace" || point.parentOffset !== 0) return { handled: false };
  if (index === 0) {
    if (point.parent.content.size || block.childCount !== 1) return { handled: true };
    if (group.childCount === 1) {
      const dissolved = dissolveEmptyColumn(state, context);
      return dissolved ? { handled: true, transaction: dissolved } : { handled: true };
    }
    const transaction = state.tr.delete(position, position + block.nodeSize);
    const textPosition = firstColumnText(transaction.doc, column.attrs.id);
    if (textPosition === null) return { handled: true };
    transaction.setSelection(TextSelection.create(transaction.doc, textPosition)).scrollIntoView();
    return { handled: true, transaction };
  }
  let previous = group.child(index - 1);
  let previousPosition = point.posAtIndex(index - 1, groupDepth);
  while (previous.firstChild?.inlineContent && previous.lastChild?.type.name === "blockGroup") {
    const children = previous.lastChild;
    let lastOffset = 0;
    children.forEach((node, offset) => { lastOffset = offset; });
    previousPosition += previous.firstChild.nodeSize + 2 + lastOffset;
    previous = children.lastChild;
  }
  if (!previous.firstChild?.inlineContent) return { handled: true };
  const joinPosition = previousPosition + previous.firstChild.nodeSize;
  const transaction = state.tr.delete(joinPosition, position + 2);
  transaction.setSelection(TextSelection.create(transaction.doc, joinPosition)).scrollIntoView();
  return { handled: true, transaction };
}

export function createColumnEditingPlugin(editor) {
  return new Plugin({
    key: new PluginKey("life-atlas-column-editing"),
    props: {
      handleKeyDown(view, event) {
        if (!["Backspace", "Delete"].includes(event.key) || isComposingKeyboardEvent(event) || view.composing || !editor.isEditable || !view.editable) return false;
        const plan = columnBoundaryEdit(view.state, event.key);
        if (!plan.handled) return false;
        if (!plan.transaction) return true;
        const result = runEditorTransaction(editor, `column-boundary:${event.key}`, (transaction) => {
          for (const step of plan.transaction.steps) transaction.step(step);
          transaction.setSelection(TextSelection.create(transaction.doc, plan.transaction.selection.anchor, plan.transaction.selection.head)).scrollIntoView();
        }, { expectedDocument: view.state.doc, preserveSelection: false, focus: false, flushDOM: false });
        return result.ok;
      },
    },
  });
}

export const ColumnEditingExtension = createExtension(({ editor }) => ({
  key: "life-atlas-column-editing",
  prosemirrorPlugins: [createColumnEditingPlugin(editor)],
}));
