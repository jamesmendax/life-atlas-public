import { createExtension, createStore } from "@blocknote/core";
import { AllSelection, NodeSelection, Plugin, PluginKey, Selection, TextSelection } from "@tiptap/pm/state";
import { GapCursor } from "@tiptap/pm/gapcursor";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import {
  beginEditorBlockDrag,
  cancelEditorBlockDrag,
  getEditorBlockInteractionState,
  hasPrivateBlockDrag,
  handleEditorBlockDrop,
  mountEditorBlockDrag,
  normalizeNativeLayoutIds,
  resolveEditorBlockDrop,
  setEditorHoveredBlock,
  subscribeEditorBlockInteractions,
  updateEditorBlockDrag,
} from "./blockDrag.js";
import { runEditorTransaction } from "./editorTransactions.js";

export const blockInteractionsKey = new PluginKey("life-atlas-block-interactions");

export function placePassiveEditorCaret(editor) {
  const { doc, selection } = editor.prosemirrorState;
  if (!(selection instanceof NodeSelection) || editor.prosemirrorView.hasFocus()) return;
  // A freshly opened or refreshed document hasn't been selected by its reader.
  // A textless document still has a valid gap just before its first atom.
  const caret = Selection.findFrom(doc.resolve(0), 1, true)
    ?? (GapCursor.valid(selection.$from) ? new GapCursor(selection.$from) : null);
  if (caret) editor.transact((tr) => tr.setSelection(caret).setMeta("addToHistory", false));
}

function selectedBlockMarkers({ doc, selection }) {
  if (selection.empty) return DecorationSet.empty;
  const { $from, $to } = selection;
  const marker = (node, at, className) => Decoration.node(at, at + node.nodeSize, { class: className });
  if (selection instanceof NodeSelection) {
    if (selection.node.isInline) return DecorationSet.empty;
    if (selection.node.type.name === "blockContainer") {
      return DecorationSet.create(doc, [marker(selection.node, selection.from, "life-selected-atom")]);
    }
    for (let depth = $from.depth; depth > 0; depth--) {
      const block = $from.node(depth);
      if (block.type.name === "blockContainer") {
        return DecorationSet.create(doc, [marker(block, $from.before(depth), "life-selected-atom")]);
      }
    }
    return DecorationSet.empty;
  }
  if (selection instanceof TextSelection && $from.sameParent($to)) return DecorationSet.empty;
  if (!(selection instanceof TextSelection || selection instanceof AllSelection) && selection.toJSON().type !== "multiple-node") return DecorationSet.empty;
  const marked = [];
  doc.nodesBetween(selection.from, selection.to, (node, at) => {
    if (node.type.name !== "blockContainer" || !node.firstChild) return;
    const child = node.firstChild;
    const textBoundary = child.inlineContent ? 1 : 0;
    // A range ending at the beginning of a paragraph contains none of that
    // paragraph's text. Account for its ProseMirror opening and closing tokens.
    const start = at + 1 + textBoundary, end = at + 1 + child.nodeSize - textBoundary;
    if (selection.from < end && selection.to > start) {
      marked.push(marker(node, at, "life-selected-range"));
    }
  });
  return marked.length > 1 ? DecorationSet.create(doc, marked) : DecorationSet.empty;
}

function databaseDrag(view, event) {
  // A database is a NodeView with its own HTML drag targets. ProseMirror's
  // default drop inserts transfer text in the surrounding block document.
  // Actual editor block moves are claimed separately by the block drag plugin.
  if (hasPrivateBlockDrag(event)) return false;
  const target = event.target.nodeType === 1 ? event.target : event.target.parentElement;
  if (target?.closest(".bn-editor") !== view.dom) return false;
  const database = target.closest(".database-view");
  const inDatabase = database?.closest(".bn-editor") === view.dom;
  const record = event.dataTransfer?.types.includes("text/life-atlas-item");
  if (!inDatabase && !record) return false;
  const field = target.closest("input, textarea, [contenteditable]");
  const nativeField = inDatabase && field && database.contains(field)
    && (field.matches("input, textarea") || field.isContentEditable);
  // The React block wrapper cancels every dragover. Chromium then sends a
  // drop but skips the field's native insertFromDrop editing action.
  if (event.type === "dragover" && nativeField && !record && event.dataTransfer?.types.includes("text/plain")) event.stopPropagation();
  if (event.type === "drop" && (!nativeField || record)) event.preventDefault();
  return true;
}

export function createBlockInteractionsPlugin(editor) {
  return new Plugin({
    key: blockInteractionsKey,
    filterTransaction(transaction) {
      normalizeNativeLayoutIds(transaction);
      return true;
    },
    props: {
      decorations: selectedBlockMarkers,
      handleDOMEvents: { dragstart: databaseDrag, dragenter: databaseDrag, dragover: databaseDrag, drop: databaseDrag },
      handleDrop(view, event) {
        return handleEditorBlockDrop(editor, event);
      },
    },
    view(view) {
      const input = (event) => {
        if (event.target.closest?.(".bn-editor") !== view.dom) return;
        if (event.type === "focus" && view.dom.dataset.selectionInput) return;
        view.dom.dataset.selectionInput = event.type === "pointerdown" ? "pointer" : "keyboard";
      };
      const events = ["pointerdown", "keydown", "focus"];
      for (const name of events) view.dom.addEventListener(name, input, true);
      const nativeFieldDragOver = event => databaseDrag(view, event);
      view.dom.addEventListener("dragover", nativeFieldDragOver, true);
      const settleKeyboardSelection = (event) => {
        if (event.shiftKey && event.key.startsWith("Arrow") && !view.composing && view.hasFocus()) view.domObserver.flush();
      };
      view.dom.addEventListener("keyup", settleKeyboardSelection);
      const toolbarPointer = (event) => {
        if (event.button !== 0 || !view.hasFocus() || !event.target.closest?.('.bn-formatting-toolbar button[aria-pressed]:not([aria-haspopup])')) return;
        // Momentary style buttons operate on the text selection. Let dropdowns
        // and keyboard navigation enter the toolbar's own focus trap normally.
        if (!view.composing) view.domObserver.flush();
        event.preventDefault();
      };
      const portal = editor.portalElement;
      portal?.addEventListener("mousedown", toolbarPointer, true);
      return {
        update: () => updateEditorBlockDrag(editor),
        destroy() {
          for (const name of events) view.dom.removeEventListener(name, input, true);
          view.dom.removeEventListener("dragover", nativeFieldDragOver, true);
          view.dom.removeEventListener("keyup", settleKeyboardSelection);
          portal?.removeEventListener("mousedown", toolbarPointer, true);
          cancelEditorBlockDrag(editor);
        },
      };
    },
  });
}

export const BlockInteractionsExtension = createExtension(({ editor }) => {
  const store = createStore(getEditorBlockInteractionState(editor));
  return {
    key: "life-atlas-block-interactions",
    store,
    prosemirrorPlugins: [createBlockInteractionsPlugin(editor)],
    beginBlockDrag: (event, blockIds) => beginEditorBlockDrag(editor, event, blockIds),
    cancelBlockDrag: () => cancelEditorBlockDrag(editor),
    resolveBlockDrop: (point) => resolveEditorBlockDrop(editor, point),
    setHoveredBlock: (blockId) => setEditorHoveredBlock(editor, blockId),
    getHoveredBlock: () => getEditorBlockInteractionState(editor).hoveredBlockId,
    mount(context) {
      const unsubscribe = subscribeEditorBlockInteractions(editor, (state) => store.setState(state));
      runEditorTransaction(editor, "initialize-layout-node-ids", (transaction) => normalizeNativeLayoutIds(transaction), { addToHistory: false, focus: false, flushDOM: false });
      const unmount = mountEditorBlockDrag(editor, context);
      store.setState(getEditorBlockInteractionState(editor));
      return () => { unmount(); unsubscribe(); };
    },
  };
});
