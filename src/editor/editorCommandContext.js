import { NodeSelection, TextSelection } from "@tiptap/pm/state";

const layoutTypes = new Set(["columnList", "column", "tabs", "tabPanel"]);
const controlTags = new Set(["BUTTON", "INPUT", "TEXTAREA", "SELECT", "OPTION", "OPTGROUP", "SUMMARY", "FORM"]);
const controlRoles = new Set(["button", "checkbox", "combobox", "dialog", "listbox", "menu", "menubar", "menuitem", "menuitemcheckbox", "menuitemradio", "option", "radio", "separator", "slider", "spinbutton", "switch", "tab", "tablist", "toolbar"]);
const controlClasses = ["life-block-actions", "bn-side-menu", "bn-menu-dropdown", "life-block-menu", "life-block-conversion-menu", "life-block-colors-menu", "bn-toolbar", "bn-formatting-toolbar", "bn-suggestion-menu"];

function isNativeBlock(node) {
  return node?.type.name === "blockContainer" || node?.type.isInGroup?.("bnBlock") === true;
}

function nativeBlocks(documentNode) {
  const blocks = [];
  documentNode.descendants((node, position) => {
    if (!isNativeBlock(node) || typeof node.attrs.id !== "string" || !node.attrs.id) return undefined;
    const wrapped = node.type.name === "blockContainer";
    const contentNode = wrapped ? node.firstChild : null;
    const contentPosition = position + 1;
    blocks.push({
      id: node.attrs.id,
      node,
      position,
      contentNode,
      contentPosition,
      layout: layoutTypes.has(contentNode?.type.name ?? node.type.name) || (!wrapped && node.type.isInGroup?.("childContainer") === true),
    });
    return undefined;
  });
  return blocks;
}

function enclosingBlockId(resolvedPosition) {
  for (let depth = resolvedPosition.depth; depth > 0; depth -= 1) {
    const node = resolvedPosition.node(depth);
    if (isNativeBlock(node) && typeof node.attrs.id === "string") return node.attrs.id;
  }
  return null;
}

function touchesOwnContent(block, from, to) {
  if (block.layout || !block.contentNode || from >= to) return false;
  if (block.contentNode.inlineContent) {
    const start = block.contentPosition + 1;
    const end = start + block.contentNode.content.size;
    return start === end ? from < start && to > start : from < end && to > start;
  }
  return from < block.contentPosition + block.contentNode.nodeSize && to > block.contentPosition;
}

function nativeSelectedBlocks(selection, blocks) {
  if (selection instanceof NodeSelection) {
    const id = isNativeBlock(selection.node) ? selection.node.attrs.id : enclosingBlockId(selection.$from);
    return blocks.filter((block) => block.id === id);
  }
  if (Array.isArray(selection.nodes) && selection.nodes.every(isNativeBlock)) {
    const selectedIds = new Set(selection.nodes.map((node) => node.attrs.id));
    return blocks.filter((block) => selectedIds.has(block.id));
  }
  if (selection instanceof TextSelection && selection.empty) {
    const id = enclosingBlockId(selection.$head);
    return blocks.filter((block) => block.id === id);
  }
  const ranges = selection.ranges?.map((range) => ({ from: range.$from.pos, to: range.$to.pos })) ?? [{ from: selection.from, to: selection.to }];
  return blocks.filter((block) => ranges.some((range) => touchesOwnContent(block, range.from, range.to)));
}

export function selectedEditorBlocks(editor, block) {
  try {
    const view = editor?.prosemirrorView;
    if (!view || view.isDestroyed || !view.state?.doc || !view.state.selection) return [];
    const selected = nativeSelectedBlocks(view.state.selection, nativeBlocks(view.state.doc));
    if (block && !selected.some((entry) => entry.id === block.id)) {
      const current = editor.getBlock(block.id);
      return current ? [current] : [];
    }
    return selected.map((entry) => editor.getBlock(entry.id)).filter(Boolean);
  } catch {
    return [];
  }
}

export function topLevelEditorBlocks(editor, blockIds) {
  const staleSelection = () => Object.assign(new Error("所选区块已失效或标识重复，请重新选择。"), { reason: "stale" });
  if (!Array.isArray(blockIds) || blockIds.some((blockId) => typeof blockId !== "string" || !blockId) || new Set(blockIds).size !== blockIds.length) throw staleSelection();
  const view = editor?.prosemirrorView;
  if (!view || view.isDestroyed || !view.state?.doc || typeof editor.getBlock !== "function") {
    throw Object.assign(new Error("编辑器已关闭或尚未准备好。"), { reason: "unavailable" });
  }
  const requestedIds = new Set(blockIds);
  const selected = nativeBlocks(view.state.doc).filter((entry) => requestedIds.has(entry.id));
  if (selected.length !== requestedIds.size || new Set(selected.map((entry) => entry.id)).size !== requestedIds.size) throw staleSelection();
  const current = selected.map((entry) => editor.getBlock(entry.id));
  if (current.some((block, index) => !block || block.id !== selected[index].id)) throw staleSelection();
  let ancestorEnd = -1;
  return selected.flatMap((entry, index) => {
    if (entry.position < ancestorEnd) return [];
    ancestorEnd = entry.position + entry.node.nodeSize;
    return [current[index]];
  });
}

function editableAttribute(element) {
  const value = element.getAttribute?.("contenteditable") ?? element.contentEditable;
  if (value === "false") return false;
  if (value === "" || value === "true" || value === "plaintext-only") return true;
  return null;
}

export function ownsEditorKeyboardTarget(editor, target) {
  try {
    const view = editor?.prosemirrorView;
    const root = view?.dom;
    if (!root || view.isDestroyed || !view.state?.selection || editor.isEditable === false || view.editable === false) return false;
    const element = target?.nodeType === 3 ? target.parentElement : target;
    if (!element || element.nodeType !== 1) return false;
    let editable = null;
    for (let current = element; current; current = current.parentElement) {
      if (current !== root && (current.classList?.contains("bn-editor") || current.classList?.contains("ProseMirror"))) return false;
      if (controlTags.has(current.tagName?.toUpperCase())) return false;
      const roles = (current.getAttribute?.("role") ?? "").toLowerCase().split(/\s+/);
      if (roles.some((role) => controlRoles.has(role)) || controlClasses.some((name) => current.classList?.contains(name))) return false;
      editable ??= editableAttribute(current);
      if (current === root) return editable ?? element.isContentEditable ?? root.isContentEditable ?? false;
    }
    return false;
  } catch {
    return false;
  }
}
