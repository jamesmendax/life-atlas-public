import { createExtension } from "@blocknote/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { runEditorTransaction } from "./editorTransactions.js";

export const CalloutEnterExtension = createExtension(({ editor }) => ({
  key: "life-atlas-callout-enter",
  prosemirrorPlugins: [new Plugin({
    key: new PluginKey("life-atlas-callout-enter"),
    props: {
      handleKeyDown(view, event) {
        if (event.key !== "Enter" || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey || event.isComposing || view.composing || !editor.isEditable || !view.editable) return false;
        const { selection } = view.state;
        if (!(selection instanceof TextSelection) || !selection.empty || selection.$from.parent.type.name !== "callout" || selection.$from.parentOffset !== selection.$from.parent.content.size) return false;
        const block = editor.getTextCursorPosition().block;
        if (block.type !== "callout") return false;
        const result = runEditorTransaction(editor, "insert:callout-child", () => {
          const first = block.children[0];
          const inserted = first
            ? editor.insertBlocks([{ type: "paragraph" }], first.id, "before")[0]
            : editor.updateBlock(block.id, { children: [{ type: "paragraph" }] }).children[0];
          editor.setTextCursorPosition(inserted.id, "start");
        }, { preserveSelection: false, focus: true });
        return result.ok && result.changed;
      },
    },
  })],
}));
