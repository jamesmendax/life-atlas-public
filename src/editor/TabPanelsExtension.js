import { createExtension } from "@blocknote/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

// ProseMirror owns its block-container DOM. Decorating the native container is
// essential: imperative React-effect attribute changes cause its DOM observer
// to reconstruct node views indefinitely, including while the page is mounting.
export const TabPanelsExtension = createExtension({
  key: "life-atlas-tab-panels",
  prosemirrorPlugins: [new Plugin({
    key: new PluginKey("life-atlas-tab-panels"),
    props: {
      decorations(state) {
        const decorations = [];
        const visit = (node, position, parentActiveId = null) => {
          let activeId = parentActiveId;
          if (node.type.name === "blockContainer") {
            const content = node.firstChild;
            if (content?.type.name === "tabs") activeId = content.attrs.activeTabId;
            if (content?.type.name === "tabPanel") {
              const tabId = content.attrs.tabId;
              const active = !parentActiveId || tabId === parentActiveId;
              decorations.push(Decoration.node(position, position + node.nodeSize, {
                role: "tabpanel", id: `panel-${tabId}`, "aria-labelledby": `tab-${tabId}`,
                "aria-hidden": active ? "false" : "true",
                class: active ? "life-tab-panel-native" : "life-tab-panel-native life-tab-inactive",
              }));
            }
          }
          node.forEach((child, offset) => visit(child, position + offset + (node.type.name === "doc" ? 0 : 1), activeId));
        };
        visit(state.doc, 0);
        return DecorationSet.create(state.doc, decorations);
      },
    },
  })],
});