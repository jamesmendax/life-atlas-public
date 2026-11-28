import { PluginKey } from "@tiptap/pm/state";
import {
  captureEditorSelection,
  findNativeBlock,
  runEditorTransaction,
} from "./editorTransactions.js";

export const columnWidthsPluginKey = new PluginKey("life-atlas-column-widths");
export const COLUMN_MINIMUM_PIXELS = 80;
export const COLUMN_KEYBOARD_PIXELS = 16;
export const COLUMN_KEYBOARD_FINE_PIXELS = 4;

const activeResizes = new WeakMap();
let owningResize = null;

function failure(reason, message = reason) {
  return { ok: false, changed: false, reason, message };
}

function sameNumber(left, right) {
  return Math.abs(left - right) <= Number.EPSILON * Math.max(1, Math.abs(left), Math.abs(right)) * 8;
}

export function positiveColumnWeight(value) {
  const width = Number(value);
  return Number.isFinite(width) && width > 0 ? width : 50;
}

export function availableColumnWidth({ width, columnCount, gap = 0, paddingLeft = 0, paddingRight = 0, borderLeft = 0, borderRight = 0 }) {
  if (!Number.isInteger(columnCount) || columnCount < 2 || !Number.isFinite(width)) return 0;
  const deductions = [gap, paddingLeft, paddingRight, borderLeft, borderRight];
  if (deductions.some((value) => !Number.isFinite(value) || value < 0)) return 0;
  return Math.max(0, width - paddingLeft - paddingRight - borderLeft - borderRight - gap * (columnCount - 1));
}

function nativeDocument(editor) {
  return editor?.prosemirrorState?.doc ?? editor?.prosemirrorView?.state?.doc ?? null;
}

export function getColumnListContext(documentNode, parentId) {
  if (!documentNode || !parentId) return null;
  const parent = findNativeBlock(documentNode, parentId);
  if (parent?.node.firstChild?.type.name !== "columnList" || parent.node.childCount !== 2) return null;
  const group = parent.node.child(1);
  if (group.type.name !== "blockGroup" || group.childCount < 2) return null;
  const columns = [];
  group.forEach((column, offset) => {
    if (column.type.name !== "blockContainer" || column.firstChild?.type.name !== "column" || !column.attrs.id) return;
    columns.push({
      id: column.attrs.id,
      node: column,
      position: parent.position + parent.node.firstChild.nodeSize + 2 + offset,
      width: Number(column.firstChild.attrs.width),
    });
  });
  if (columns.length !== group.childCount || new Set(columns.map((column) => column.id)).size !== columns.length) return null;
  return { parentId, parent, columns };
}

export function getColumnResizeContext(documentNode, columnId) {
  if (!documentNode || !columnId) return null;
  const column = findNativeBlock(documentNode, columnId);
  if (column?.node.firstChild?.type.name !== "column") return null;
  const resolved = documentNode.resolve(column.position);
  for (let depth = resolved.depth; depth > 0; depth -= 1) {
    const ancestor = resolved.node(depth);
    if (ancestor.type.name !== "blockContainer") continue;
    if (ancestor.firstChild?.type.name !== "columnList") return null;
    const context = getColumnListContext(documentNode, ancestor.attrs.id);
    if (!context) return null;
    const index = context.columns.findIndex((candidate) => candidate.id === columnId);
    return index >= 0 ? { ...context, index } : null;
  }
  return null;
}

export function calculateAdjacentColumnResize({ weights, leftIndex, availableWidth, minimumPixels = COLUMN_MINIMUM_PIXELS }, deltaPixels = 0) {
  if (!Array.isArray(weights) || weights.length < 2 || weights.some((width) => !Number.isFinite(width) || width <= 0)) return failure("invalid-column-weights");
  if (!Number.isInteger(leftIndex) || leftIndex < 0 || leftIndex >= weights.length - 1) return failure("nonadjacent-columns");
  if (!Number.isFinite(availableWidth) || availableWidth <= 0 || !Number.isFinite(deltaPixels) || !Number.isFinite(minimumPixels) || minimumPixels < 0) return failure("invalid-column-size");
  const totalWeight = weights.reduce((total, width) => total + width, 0);
  const left = weights[leftIndex];
  const right = weights[leftIndex + 1];
  const pairTotal = left + right;
  if (!Number.isFinite(totalWeight) || !Number.isFinite(pairTotal)) return failure("invalid-column-weights");
  const minimumWeight = Math.min(minimumPixels * totalWeight / availableWidth, pairTotal / 3);
  const minimumLeft = Math.min(minimumWeight, left);
  const maximumLeft = pairTotal - Math.min(minimumWeight, right);
  const nextLeft = deltaPixels === 0
    ? left
    : Math.max(minimumLeft, Math.min(maximumLeft, left + deltaPixels * totalWeight / availableWidth));
  const nextRight = sameNumber(nextLeft, left) ? right : pairTotal - nextLeft;
  const changed = !sameNumber(nextLeft, left) || !sameNumber(nextRight, right);
  return {
    ok: true,
    changed,
    left: changed ? nextLeft : left,
    right: changed ? nextRight : right,
    pairTotal,
    totalWeight,
    minimumWeight,
    minimumPixels: minimumWeight * availableWidth / totalWeight,
  };
}

function pixelValue(value) {
  const pixels = Number.parseFloat(value);
  return Number.isFinite(pixels) ? pixels : 0;
}

export function measureColumnResize(editor, marker, columnId) {
  const view = editor?.prosemirrorView;
  const context = getColumnResizeContext(nativeDocument(editor), columnId);
  if (!view || !marker?.isConnected || !context || context.index >= context.columns.length - 1) return null;
  const outer = marker.closest(".bn-block-outer[data-id]");
  const group = outer?.parentElement;
  const windowObject = marker.ownerDocument?.defaultView;
  if (!outer || outer.dataset.id !== columnId || !group || !windowObject || !view.dom.contains(group)) return null;
  const siblings = Array.from(group.children).filter((element) => element.matches(".bn-block-outer[data-id]"));
  if (siblings.length !== context.columns.length || siblings.some((element, index) => element.dataset.id !== context.columns[index].id)) return null;
  const computed = windowObject.getComputedStyle(group);
  if (computed.display !== "flex" || computed.flexDirection === "column" || computed.flexDirection === "column-reverse") return null;
  const rect = group.getBoundingClientRect();
  const gap = pixelValue(computed.columnGap);
  const availableWidth = availableColumnWidth({
    width: rect.width,
    columnCount: context.columns.length,
    gap,
    paddingLeft: pixelValue(computed.paddingLeft),
    paddingRight: pixelValue(computed.paddingRight),
    borderLeft: pixelValue(computed.borderLeftWidth),
    borderRight: pixelValue(computed.borderRightWidth),
  });
  if (availableWidth <= 0 || gap <= 0) return null;
  return { availableWidth, gap, hitWidth: Math.min(12, gap), group };
}

export function createColumnResizePlan(editor, leftId, geometry, options = {}) {
  if (!editor?.isEditable || options.locked) return failure("locked");
  if (editor.prosemirrorView?.composing) return failure("composing");
  const bookmark = options.bookmark ?? captureEditorSelection(editor);
  if (!bookmark) return failure("stale-selection");
  const documentNode = nativeDocument(editor);
  const context = getColumnResizeContext(documentNode, leftId);
  if (!context || context.index >= context.columns.length - 1) return failure("nonadjacent-columns");
  const weights = context.columns.map((column) => column.width);
  const pair = calculateAdjacentColumnResize({ weights, leftIndex: context.index, availableWidth: geometry?.availableWidth });
  if (!pair.ok) return pair;
  return {
    ok: true,
    changed: false,
    documentNode,
    bookmark,
    parentId: context.parentId,
    leftId,
    rightId: context.columns[context.index + 1].id,
    columnIds: context.columns.map((column) => column.id),
    weights,
    leftIndex: context.index,
    availableWidth: geometry.availableWidth,
    gap: geometry.gap,
    ...pair,
  };
}

export function preflightColumnResize(editor, plan, options = {}) {
  if (!editor?.isEditable || options.locked) return failure("locked");
  if (editor.prosemirrorView?.composing) return failure("composing");
  if (!plan?.ok || nativeDocument(editor) !== plan.documentNode) return failure("stale-column-document");
  const context = getColumnResizeContext(plan.documentNode, plan.leftId);
  if (!context || context.parentId !== plan.parentId || context.columns[context.index + 1]?.id !== plan.rightId) return failure("nonadjacent-columns");
  if (context.columns.length !== plan.columnIds.length || context.columns.some((column, index) => column.id !== plan.columnIds[index] || column.width !== plan.weights[index])) return failure("stale-column-order");
  return { ok: true, changed: false, context };
}

function validPair(plan, pair) {
  return pair?.ok && Number.isFinite(pair.left) && pair.left > 0 && Number.isFinite(pair.right) && pair.right > 0
    && sameNumber(pair.left + pair.right, plan.pairTotal);
}

export function setColumnResizePreview(editor, plan, pair) {
  const preflight = preflightColumnResize(editor, plan);
  if (!preflight.ok) return preflight;
  if (!validPair(plan, pair)) return failure("invalid-column-pair");
  const state = columnWidthsPluginKey.getState(editor.prosemirrorState);
  if (!state) return failure("column-width-extension-missing");
  if (state.preview?.documentNode === plan.documentNode && state.preview.leftId === plan.leftId && state.preview.left === pair.left && state.preview.right === pair.right) return { ok: true, changed: false };
  if (!pair.changed && !state.preview) return { ok: true, changed: false };
  try {
    editor.transact((transaction) => {
      transaction.setMeta("addToHistory", false);
      transaction.setMeta(columnWidthsPluginKey, {
        type: "preview",
        preview: { documentNode: plan.documentNode, parentId: plan.parentId, leftId: plan.leftId, rightId: plan.rightId, left: pair.left, right: pair.right },
      });
    });
    return { ok: true, changed: true };
  } catch (error) {
    return failure("column-preview-failed", error.message);
  }
}

export function clearColumnResizePreview(editor, plan = null) {
  try {
    if (editor?.prosemirrorView?.isDestroyed) return { ok: true, changed: false };
    const preview = editor?.prosemirrorState && columnWidthsPluginKey.getState(editor.prosemirrorState)?.preview;
    if (!preview || (plan && (preview.documentNode !== plan.documentNode || preview.leftId !== plan.leftId))) return { ok: true, changed: false };
    editor.transact((transaction) => {
      transaction.setMeta("addToHistory", false);
      transaction.setMeta(columnWidthsPluginKey, { type: "clear" });
    });
    return { ok: true, changed: true };
  } catch (error) {
    return failure("column-preview-failed", error.message);
  }
}

export function commitColumnResize(editor, plan, pair, options = {}) {
  const preflight = preflightColumnResize(editor, plan, options);
  if (!preflight.ok) return preflight;
  if (!validPair(plan, pair)) return failure("invalid-column-pair");
  if (sameNumber(pair.left, plan.weights[plan.leftIndex]) && sameNumber(pair.right, plan.weights[plan.leftIndex + 1])) {
    clearColumnResizePreview(editor, plan);
    return { ok: true, changed: false };
  }
  return runEditorTransaction(editor, "column-resize", (transaction) => {
    for (const [columnId, width] of [[plan.leftId, pair.left], [plan.rightId, pair.right]]) {
      const column = findNativeBlock(transaction.doc, columnId);
      if (column?.node.firstChild?.type.name !== "column") throw new Error("stale resize target");
      transaction.setNodeMarkup(column.position + 1, undefined, { ...column.node.firstChild.attrs, width });
    }
    transaction.setMeta(columnWidthsPluginKey, { type: "clear" });
  }, { expectedDocument: plan.documentNode, bookmark: plan.bookmark, focus: false });
}

export function getActiveColumnResize(editor) {
  return activeResizes.get(editor) ?? null;
}

export function abortColumnResize(editor, reason = "canceled", options = {}) {
  const session = activeResizes.get(editor);
  if (!session || (options.leftId && session.plan.leftId !== options.leftId)) return false;
  session.cancel(reason, options.clearPreview !== false);
  return true;
}

export function beginColumnResize(editor, event, options = {}) {
  if (owningResize || event.button !== 0 || event.isPrimary === false) return failure("pointer-unavailable");
  if (!Number.isFinite(event.pointerId) || event.isComposing || editor.prosemirrorView?.composing) return failure("composing");
  const element = options.element;
  const documentObject = element?.ownerDocument;
  const windowObject = documentObject?.defaultView;
  if (!element || !windowObject) return failure("resize-target-missing");
  const geometry = options.readGeometry?.() ?? options.geometry;
  const plan = createColumnResizePlan(editor, options.leftId, geometry, { locked: options.isLocked?.() });
  if (!plan.ok) return plan;
  if (!columnWidthsPluginKey.getState(editor.prosemirrorState)) return failure("column-width-extension-missing");
  const startX = event.clientX;
  const pageId = options.getPageId?.();
  let pair = calculateAdjacentColumnResize(plan);
  let ended = false;
  const removals = [];
  const session = {
    plan,
    pointerId: event.pointerId,
    cancel(reason, clearPreview = true) {
      if (ended) return;
      cleanup();
      if (clearPreview) clearColumnResizePreview(editor, plan);
      options.onEnd?.(failure(reason));
    },
  };
  const listen = (target, type, listener) => {
    target.addEventListener(type, listener, true);
    removals.push(() => target.removeEventListener(type, listener, true));
  };
  const cleanup = () => {
    ended = true;
    activeResizes.delete(editor);
    if (owningResize === session) owningResize = null;
    for (const remove of removals) remove();
    try {
      if (element.hasPointerCapture?.(session.pointerId)) element.releasePointerCapture(session.pointerId);
    } catch {}
    options.onActiveChange?.(false);
  };
  const usable = () => {
    if (options.getPageId?.() !== pageId) return failure("page-changed");
    if (!element.isConnected) return failure("unmount");
    const preflight = preflightColumnResize(editor, plan, { locked: options.isLocked?.() });
    if (!preflight.ok) return preflight;
    const currentGeometry = options.readGeometry?.();
    if (options.readGeometry && (!currentGeometry || !sameNumber(currentGeometry.availableWidth, plan.availableWidth) || !sameNumber(currentGeometry.gap, plan.gap))) return failure("column-layout-changed");
    return preflight;
  };
  const move = (moveEvent) => {
    if (moveEvent.pointerId !== session.pointerId || ended) return;
    const preflight = usable();
    if (!preflight.ok) return session.cancel(preflight.reason);
    pair = calculateAdjacentColumnResize(plan, moveEvent.clientX - startX);
    const result = setColumnResizePreview(editor, plan, pair);
    if (!result.ok) return session.cancel(result.reason);
    moveEvent.preventDefault();
    options.onPreview?.(pair);
  };
  const finish = (upEvent) => {
    if (upEvent.pointerId !== session.pointerId || ended) return;
    const preflight = usable();
    if (!preflight.ok) return session.cancel(preflight.reason);
    upEvent.preventDefault();
    pair = calculateAdjacentColumnResize(plan, upEvent.clientX - startX);
    cleanup();
    const result = commitColumnResize(editor, plan, pair);
    if (!result.ok) clearColumnResizePreview(editor, plan);
    options.onEnd?.(result);
  };
  const cancelPointer = (cancelEvent) => {
    if (cancelEvent.pointerId === session.pointerId) session.cancel(cancelEvent.type);
  };
  const key = (keyEvent) => {
    if (keyEvent.key !== "Escape") return;
    keyEvent.preventDefault();
    keyEvent.stopPropagation();
    session.cancel("escape");
  };
  activeResizes.set(editor, session);
  owningResize = session;
  event.preventDefault();
  event.stopPropagation();
  listen(windowObject, "pointermove", move);
  listen(windowObject, "pointerup", finish);
  listen(windowObject, "pointercancel", cancelPointer);
  listen(element, "lostpointercapture", cancelPointer);
  listen(documentObject, "keydown", key);
  listen(documentObject, "compositionstart", () => session.cancel("composing"));
  listen(documentObject, "dragstart", () => session.cancel("another-gesture"));
  listen(documentObject, "visibilitychange", () => { if (documentObject.hidden) session.cancel("hidden"); });
  listen(windowObject, "blur", () => session.cancel("blur"));
  listen(windowObject, "pagehide", () => session.cancel("page-changed"));
  listen(windowObject, "resize", () => session.cancel("column-layout-changed"));
  try {
    element.setPointerCapture?.(session.pointerId);
  } catch {}
  options.onActiveChange?.(true);
  return { ok: true, changed: false, session };
}

export function resizeColumnWithKeyboard(editor, leftId, geometry, event, options = {}) {
  if (!["ArrowLeft", "ArrowRight"].includes(event.key) || event.altKey || event.ctrlKey || event.metaKey) return failure("unsupported-resize-key");
  if (owningResize) return failure("pointer-unavailable");
  if (event.isComposing) return failure("composing");
  const plan = createColumnResizePlan(editor, leftId, geometry, options);
  if (!plan.ok) return plan;
  event.preventDefault();
  event.stopPropagation();
  const pixels = event.shiftKey ? COLUMN_KEYBOARD_FINE_PIXELS : COLUMN_KEYBOARD_PIXELS;
  const pair = calculateAdjacentColumnResize(plan, event.key === "ArrowLeft" ? -pixels : pixels);
  return commitColumnResize(editor, plan, pair, options);
}
