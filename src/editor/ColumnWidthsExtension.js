import { createExtension } from "@blocknote/core";
import { Plugin } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import {
  abortColumnResize,
  clearColumnResizePreview,
  columnWidthsPluginKey,
  getActiveColumnResize,
  getColumnResizeContext,
  positiveColumnWeight,
} from "./columnResize.js";

function validPreview(documentNode, preview) {
  if (!preview || preview.documentNode !== documentNode || !Number.isFinite(preview.left) || preview.left <= 0 || !Number.isFinite(preview.right) || preview.right <= 0) return null;
  const context = getColumnResizeContext(documentNode, preview.leftId);
  if (!context || context.parentId !== preview.parentId || context.columns[context.index + 1]?.id !== preview.rightId) return null;
  const total = context.columns[context.index].width + context.columns[context.index + 1].width;
  return Math.abs(preview.left + preview.right - total) <= Number.EPSILON * Math.max(1, total) * 8 ? preview : null;
}

function columnDecorations(documentNode, preview) {
  const decorations = [];
  documentNode.descendants((node, position) => {
    if (node.type.name !== "blockContainer" || node.firstChild?.type.name !== "column") return;
    const isPreview = preview && (node.attrs.id === preview.leftId || node.attrs.id === preview.rightId);
    const width = node.attrs.id === preview?.leftId ? preview.left : node.attrs.id === preview?.rightId ? preview.right : positiveColumnWeight(node.firstChild.attrs.width);
    decorations.push(Decoration.node(position, position + node.nodeSize, {
      class: isPreview ? "life-column-native life-column-preview" : "life-column-native",
      "data-life-column-id": node.attrs.id,
      "data-life-column-width": String(width),
      ...(isPreview ? { "data-life-column-preview": "true" } : {}),
      style: `flex-grow:${width};flex-basis:0px;`,
    }));
  });
  return DecorationSet.create(documentNode, decorations);
}

export function createColumnWidthsPlugin(editor) {
  return new Plugin({
    key: columnWidthsPluginKey,
    state: {
      init: (_, state) => ({ preview: null, decorations: columnDecorations(state.doc, null) }),
      apply(transaction, previous) {
        const metadata = transaction.getMeta(columnWidthsPluginKey);
        if (!transaction.docChanged && !metadata) return previous;
        const preview = transaction.docChanged || metadata?.type === "clear" ? null : validPreview(transaction.doc, metadata?.preview);
        return { preview, decorations: columnDecorations(transaction.doc, preview) };
      },
    },
    props: {
      decorations: (state) => columnWidthsPluginKey.getState(state).decorations,
      handleDOMEvents: {
        compositionstart() {
          abortColumnResize(editor, "composing");
          return false;
        },
      },
    },
    view() {
      return {
        update(view) {
          const active = getActiveColumnResize(editor);
          if (!active) return;
          if (!editor.isEditable || !view.editable) abortColumnResize(editor, "locked");
          else if (view.state.doc !== active.plan.documentNode) abortColumnResize(editor, "stale-column-document", { clearPreview: false });
        },
        destroy() { abortColumnResize(editor, "unmount", { clearPreview: false }); },
      };
    },
  });
}

export const ColumnWidthsExtension = createExtension(({ editor }) => ({
  key: "life-atlas-column-widths",
  prosemirrorPlugins: [createColumnWidthsPlugin(editor)],
  mount() {
    clearColumnResizePreview(editor);
    return () => { abortColumnResize(editor, "unmount"); };
  },
}))();
