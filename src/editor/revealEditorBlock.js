export function revealEditorBlock(root, blockId, onVisible) {
  const find = (id) => [...root.querySelectorAll(`.bn-block-outer[data-id="${CSS.escape(id)}"]`)]
    .find((element) => element.closest(".bn-editor") === root);
  const target = find(blockId);
  if (!target) return undefined;

  // Opening a tab may replace its child nodes. Resolve each ancestor again by ID.
  const ancestors = [];
  for (let el = target.parentElement?.closest(".bn-block-outer"); el && root.contains(el); el = el.parentElement?.closest(".bn-block-outer")) {
    ancestors.unshift(el.dataset.id);
  }
  for (const id of ancestors) {
    const parent = find(id);
    if (!parent) continue;
    if (parent.matches('[role="tabpanel"][aria-hidden="true"]')) {
      const tabs = parent.parentElement?.closest(".bn-block-outer");
      tabs?.querySelector(`[role="tab"][aria-controls="${CSS.escape(parent.id)}"]`)?.click();
    }
    const toggle = [...parent.querySelectorAll('.bn-toggle-wrapper[data-show-children="false"]')]
      .find((wrapper) => wrapper.closest(".bn-block-outer") === parent);
    toggle?.querySelector(":scope > .bn-toggle-button")?.click();
  }
  return requestAnimationFrame(() => {
    const visible = root.isConnected && find(blockId);
    if (!visible) return;
    onVisible?.();
    visible.scrollIntoView({ block: "center", inline: "nearest" });
  });
}
