import { createExtension } from "@blocknote/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { runEditorTransaction } from "./editorTransactions.js";

const trailingKey = new PluginKey("life-atlas-layout-trailing");

export function layoutTrailingTargets(documentNode) {
  const targets = [];
  documentNode.descendants((node, position, parent) => {
    if (node.isTextblock) return false;
    if (node.type.name !== "blockGroup") return undefined;
    const isRoot = parent?.type.name === "doc";
    const isColumnGroup = parent?.type.name === "blockContainer" && parent.firstChild?.type.name === "column";
    if (!isRoot && !isColumnGroup) return undefined;
    const last = node.lastChild;
    if (!last || (last.firstChild?.type.name === "paragraph" && last.firstChild.content.size === 0)) return undefined;
    targets.push({ position: position + node.nodeSize - 1, lastBlockId: last.attrs.id, ownerId: isRoot ? "root" : parent.attrs.id });
    return undefined;
  });
  return targets;
}

export const LayoutTrailingExtension = createExtension(({ editor }) => ({
  key: "life-atlas-layout-trailing",
  prosemirrorPlugins: [new Plugin({
    key: trailingKey,
    state: {
      init: () => 0,
      apply: (transaction, revision) => transaction.docChanged || transaction.getMeta(trailingKey) ? revision + 1 : revision,
    },
    props: {
      decorations(state) {
        if (!editor.isEditable) return DecorationSet.empty;
        return DecorationSet.create(state.doc, layoutTrailingTargets(state.doc).map((target) => Decoration.widget(target.position, () => {
          const element = document.createElement("div");
          element.className = "bn-trailing-block life-layout-trailing";
          element.contentEditable = "false";
          element.dataset.layoutOwner = target.ownerId;
          element.addEventListener("mousedown", (event) => {
            event.preventDefault();
            event.stopPropagation();
            const currentTarget = layoutTrailingTargets(editor.prosemirrorState.doc).find((entry) => entry.ownerId === target.ownerId);
            if (!currentTarget) return;
            runEditorTransaction(editor, "insert:trailing-paragraph", (transaction) => {
              const inserted = editor.insertBlocks([{ type: "paragraph" }], currentTarget.lastBlockId, "after")[0];
              editor.setTextCursorPosition(inserted.id, "start");
              transaction.scrollIntoView();
            }, { preserveSelection: false, focus: true });
          });
          return element;
        }, { key: `life-trailing:${target.ownerId}`, side: 1, ignoreSelection: true })));
      },
    },
    view(view) {
      let editable = view.editable;
      return { update(nextView) {
        if (editable === nextView.editable) return;
        editable = nextView.editable;
        nextView.dispatch(nextView.state.tr.setMeta(trailingKey, true).setMeta("addToHistory", false));
      } };
    },
  })],
}));
