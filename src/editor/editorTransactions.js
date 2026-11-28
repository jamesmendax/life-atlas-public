import { AllSelection, NodeSelection, TextSelection } from "@tiptap/pm/state";
import { closeHistory } from "@tiptap/pm/history";

const activeEditors = new WeakSet();
const unchangedTransaction = Symbol("unchanged-editor-transaction");

function isNativeBlock(node) {
  return node?.type.name === "blockContainer" || node?.type.isInGroup?.("bnBlock") === true;
}

function describeNativeBlock(node, position) {
  const wrapped = node.type.name === "blockContainer";
  const contentNode = wrapped ? node.firstChild : node;
  const contentPosition = position + (wrapped ? 1 : 0);
  return { node, position, contentNode, contentPosition, textStart: contentPosition + 1, endPosition: position + node.nodeSize };
}

export function findNativeBlock(documentNode, blockId) {
  if (!documentNode?.descendants || typeof blockId !== "string" || !blockId) return null;
  let found = null;
  documentNode.descendants((node, position) => {
    if (found) return false;
    if (isNativeBlock(node) && node.attrs.id === blockId) {
      found = describeNativeBlock(node, position);
      return false;
    }
    return undefined;
  });
  return found;
}

function enclosingEndpoint(documentNode, position) {
  const resolved = documentNode.resolve(position);
  for (let depth = resolved.depth; depth > 0; depth -= 1) {
    const node = resolved.node(depth);
    if (isNativeBlock(node) && typeof node.attrs.id === "string") {
      return { blockId: node.attrs.id, offset: position - resolved.before(depth) };
    }
  }
  return null;
}

function boundaryEndpoint(documentNode, position, edge) {
  const resolved = documentNode.resolve(position);
  const node = edge === "before" ? resolved.nodeAfter : resolved.nodeBefore;
  if (isNativeBlock(node) && typeof node.attrs.id === "string") return { blockId: node.attrs.id, edge };
  return enclosingEndpoint(documentNode, position);
}

function hasEditorFocus(editor, view) {
  if (editor.headless) return false;
  try { return view.hasFocus?.() === true; }
  catch { return false; }
}

export function captureEditorSelection(editor) {
  try {
    const view = editor.prosemirrorView;
    if (!view || view.isDestroyed) return null;
    const { doc, selection, storedMarks } = view.state;
    const bookmark = {
      kind: "native",
      documentNode: doc,
      nativeSelection: selection,
      nativeBookmark: selection.getBookmark(),
      storedMarks,
      wasFocused: hasEditorFocus(editor, view),
    };
    if (selection instanceof AllSelection) return { ...bookmark, kind: "all" };
    if (selection instanceof TextSelection) {
      return { ...bookmark, kind: "text", anchor: enclosingEndpoint(doc, selection.anchor), head: enclosingEndpoint(doc, selection.head) };
    }
    if (selection instanceof NodeSelection) {
      const anchor = isNativeBlock(selection.node)
        ? { blockId: selection.node.attrs.id, offset: 0 }
        : enclosingEndpoint(doc, selection.anchor);
      return { ...bookmark, kind: "node", anchor };
    }
    if (Array.isArray(selection.nodes) && selection.nodes.every(isNativeBlock)) {
      const forward = selection.anchor <= selection.head;
      return {
        ...bookmark,
        kind: "blocks",
        anchor: boundaryEndpoint(doc, selection.anchor, forward ? "before" : "after"),
        head: boundaryEndpoint(doc, selection.head, forward ? "after" : "before"),
        blockIds: selection.nodes.map((node) => node.attrs.id),
      };
    }
    return bookmark;
  } catch {
    return null;
  }
}

function resolveEndpoint(documentNode, endpoint) {
  if (!endpoint) return null;
  const block = findNativeBlock(documentNode, endpoint.blockId);
  if (!block) return null;
  if (endpoint.edge === "before") return block.position;
  if (endpoint.edge === "after") return block.endPosition;
  if (!Number.isInteger(endpoint.offset) || endpoint.offset < 0 || endpoint.offset >= block.node.nodeSize) return null;
  return block.position + endpoint.offset;
}

export function restoreEditorSelection(transaction, bookmark) {
  if (!transaction?.doc || !bookmark) return false;
  try {
    let selection;
    if (bookmark.kind === "all") selection = new AllSelection(transaction.doc);
    else if (bookmark.kind === "text") {
      const anchor = resolveEndpoint(transaction.doc, bookmark.anchor);
      const head = resolveEndpoint(transaction.doc, bookmark.head);
      if (anchor === null || head === null || !transaction.doc.resolve(anchor).parent.inlineContent || !transaction.doc.resolve(head).parent.inlineContent) return false;
      selection = TextSelection.create(transaction.doc, anchor, head);
    } else if (bookmark.kind === "node") {
      const anchor = resolveEndpoint(transaction.doc, bookmark.anchor);
      if (anchor === null || !NodeSelection.isSelectable(transaction.doc.nodeAt(anchor))) return false;
      selection = NodeSelection.create(transaction.doc, anchor);
    } else if (bookmark.kind === "blocks") {
      const anchor = resolveEndpoint(transaction.doc, bookmark.anchor);
      const head = resolveEndpoint(transaction.doc, bookmark.head);
      if (anchor === null || head === null || transaction.doc.resolve(anchor).parent !== transaction.doc.resolve(head).parent) return false;
      const SelectionType = bookmark.nativeSelection.constructor;
      selection = typeof SelectionType.create === "function"
        ? SelectionType.create(transaction.doc, anchor, head)
        : new SelectionType(transaction.doc.resolve(anchor), transaction.doc.resolve(head));
      const restoredIds = selection.nodes?.map((node) => node.attrs.id);
      if (!restoredIds || restoredIds.length !== bookmark.blockIds.length || restoredIds.some((blockId, index) => blockId !== bookmark.blockIds[index])) return false;
    } else {
      selection = bookmark.nativeSelection.map(transaction.doc, transaction.mapping);
      if (selection.constructor !== bookmark.nativeSelection.constructor) return false;
    }
    if (!transaction.selection.eq(selection)) transaction.setSelection(selection);
    if (selection instanceof TextSelection && selection.empty && bookmark.storedMarks !== null) {
      const allowedMarks = selection.$head.parent.type.allowedMarks(bookmark.storedMarks);
      if (allowedMarks.length === bookmark.storedMarks.length) transaction.setStoredMarks(bookmark.storedMarks);
    }
    return true;
  } catch {
    return false;
  }
}

function failure(reason, message) {
  return { ok: false, changed: false, reason, message };
}

function requireAvailableEditor(editor, view) {
  if (!view || view.isDestroyed || !view.state?.doc || typeof editor.transact !== "function") {
    throw Object.assign(new Error("编辑器已关闭或尚未准备好。"), { reason: "unavailable" });
  }
  if (editor.isEditable === false || view.editable === false) {
    throw Object.assign(new Error("页面已锁定，无法修改区块。"), { reason: "locked" });
  }
  if (view.composing) {
    throw Object.assign(new Error("正在输入中文或其他组合文字，请完成输入后再操作。"), { reason: "composing" });
  }
}

function flushPendingDOM(editor, view) {
  if (!editor.headless) view.domObserver?.flush?.();
}

export function runEditorTransaction(editor, actionName, callback, options = {}) {
  if (!editor || typeof callback !== "function") return failure("unavailable", "编辑器操作不可用。");
  if (activeEditors.has(editor)) return failure("busy", "编辑器正在处理另一个操作，请稍后重试。");
  let view;
  let changed = false;
  try {
    view = editor.prosemirrorView;
    requireAvailableEditor(editor, view);
    if (options.flushDOM !== false) flushPendingDOM(editor, view);
    requireAvailableEditor(editor, view);
    const initialState = view.state;
    if (options.expectedDocument && options.expectedDocument !== initialState.doc) return failure("stale", "区块内容已变化，请重新选择后再操作。");
    const bookmark = options.bookmark ?? captureEditorSelection(editor);
    if (options.preserveSelection !== false && !bookmark) return failure("stale-selection", "无法保留当前光标或选区，请重新选择后再操作。");
    activeEditors.add(editor);
    editor.transact((transaction) => {
      if (transaction.doc !== initialState.doc) throw Object.assign(new Error("区块内容已变化，请重新操作。"), { reason: "stale" });
      const callbackResult = callback(transaction);
      if (callbackResult && typeof callbackResult.then === "function") throw Object.assign(new Error("区块修改必须同步完成。"), { reason: "async-action" });
      if (!transaction.docChanged || transaction.doc.eq(initialState.doc)) throw unchangedTransaction;
      requireAvailableEditor(editor, view);
      if (view.state !== initialState) throw Object.assign(new Error("区块内容已变化，请重新操作。"), { reason: "stale" });
      transaction.doc.check();
      if (options.preserveSelection !== false && !restoreEditorSelection(transaction, bookmark)) {
        throw Object.assign(new Error("当前选区已失效，操作已取消。"), { reason: "stale-selection" });
      }
      if (options.addToHistory === false) transaction.setMeta("addToHistory", false);
      else closeHistory(transaction.setMeta("addToHistory", true));
      transaction.setMeta("lifeAtlasAction", actionName);
      changed = true;
    });
    if (view.state.doc.eq(initialState.doc)) return failure("transaction-rejected", "编辑器拒绝了这次修改，内容保持原样。");
    if (options.addToHistory !== false && !view.isDestroyed) {
      view.dispatch(closeHistory(view.state.tr).setMeta("addToHistory", false));
    }
    const shouldFocus = options.focus ?? bookmark?.wasFocused;
    if (shouldFocus && !editor.headless && !view.isDestroyed && editor.isEditable !== false && !view.composing) {
      try { editor.focus(); } catch { return { ok: true, changed }; }
    }
    return { ok: true, changed };
  } catch (error) {
    if (error === unchangedTransaction) return { ok: true, changed: false };
    return { ok: false, changed: false, reason: error?.reason || "transaction-failed", message: error?.message || "区块操作失败，内容保持原样。" };
  } finally {
    activeEditors.delete(editor);
  }
}
