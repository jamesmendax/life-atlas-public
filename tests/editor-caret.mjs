export function waitForNativeCaretAtBlockEnd(page, selector, blockId) {
  return page.waitForFunction(({ selector, blockId }) => {
    const root = document.querySelector(selector);
    const editor = root?.pmViewDesc?.node?.type?.schema?.cached?.blockNoteEditor;
    const block = root?.querySelector(`.bn-block-outer[data-id="${blockId}"]`);
    const inline = block?.querySelector(".bn-inline-content");
    const selection = editor?.prosemirrorState?.selection;
    const domSelection = window.getSelection();
    const focus = domSelection?.focusNode;
    const owner = (focus?.nodeType === Node.ELEMENT_NODE ? focus : focus?.parentElement)?.closest(".bn-block-outer[data-id]");
    if (!editor || !selection?.empty || !domSelection?.isCollapsed || owner !== block || !inline?.contains(focus) || !editor.prosemirrorView.hasFocus()) return false;
    return selection.$head.parent.isTextblock
      && selection.$head.parentOffset === selection.$head.parent.content.size
      && editor.getTextCursorPosition().block.id === blockId
      && editor.prosemirrorView.posAtDOM(focus, domSelection.focusOffset) === selection.head;
  }, { selector, blockId });
}
