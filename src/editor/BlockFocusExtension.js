import { createExtension } from "@blocknote/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export const blockFocusKey = new PluginKey("life-atlas-block-focus");

export function createBlockFocusPlugin() {
  return new Plugin({
    key: blockFocusKey,
    state: {
      init: () => null,
      apply(transaction, previous) {
        const target = transaction.getMeta(blockFocusKey);
        return target === undefined ? previous : typeof target === "string" ? target : null;
      },
    },
    props: {
      decorations(state) {
        const blockId = blockFocusKey.getState(state);
        if (!blockId) return DecorationSet.empty;
        const decorations = [];
        state.doc.descendants((node, position) => {
          if (node.type.name !== "blockContainer" || node.attrs.id !== blockId) return;
          decorations.push(Decoration.node(position, position + node.nodeSize, { class: "is-link-target" }));
          return false;
        });
        return DecorationSet.create(state.doc, decorations);
      },
    },
  });
}

export function setEditorBlockFocus(editor, blockId) {
  const view = editor.prosemirrorView;
  if (!view || view.isDestroyed) return false;
  const target = typeof blockId === "string" ? blockId : null;
  if (blockFocusKey.getState(view.state) === target) return false;
  view.dispatch(view.state.tr.setMeta(blockFocusKey, target));
  return true;
}

export const BlockFocusExtension = createExtension({
  key: "life-atlas-block-focus",
  prosemirrorPlugins: [createBlockFocusPlugin()],
});
