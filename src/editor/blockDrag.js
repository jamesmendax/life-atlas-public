import { Fragment, Slice } from "@tiptap/pm/model";
import { Selection } from "@tiptap/pm/state";
import { Transform } from "@tiptap/pm/transform";
import { captureEditorSelection, findNativeBlock, runEditorTransaction } from "./editorTransactions.js";

export const BLOCK_DRAG_MIME = "application/x-life-atlas-block-drag";
export const MAX_EDITOR_COLUMNS = 5;

const EDGE_SIZE = 14;
const editorInteractions = new WeakMap();
let activeDrag = null;
let identitySequence = 0;

class BlockDragError extends Error {
  constructor(reason, message) {
    super(message);
    this.reason = reason;
  }
}

function refuse(reason, message) {
  throw new BlockDragError(reason, message);
}

function rejection(error) {
  return { ok: false, changed: false, reason: error.reason ?? "invalid-drop", message: error.message };
}

function nativeView(editor) {
  try {
    return editor.prosemirrorView ?? null;
  } catch {
    return null;
  }
}

function interactionState(editor) {
  let state = editorInteractions.get(editor);
  if (!state) {
    state = { session: null, preview: null, hoveredBlockId: null, lastResult: null, listeners: new Set() };
    editorInteractions.set(editor, state);
  }
  return state;
}

export function getEditorBlockInteractionState(editor) {
  const state = interactionState(editor);
  return { dragging: Boolean(state.session), blockIds: state.session?.blockIds ?? [], dropTarget: state.preview, hoveredBlockId: state.hoveredBlockId, lastResult: state.lastResult };
}

function publish(editor) {
  const snapshot = getEditorBlockInteractionState(editor);
  for (const listener of interactionState(editor).listeners) listener(snapshot);
}

export function subscribeEditorBlockInteractions(editor, listener) {
  const state = interactionState(editor);
  state.listeners.add(listener);
  return () => state.listeners.delete(listener);
}

export function setEditorHoveredBlock(editor, blockId) {
  const state = interactionState(editor);
  state.hoveredBlockId = typeof blockId === "string" ? blockId : null;
  publish(editor);
}

function generatedIdentity() {
  return globalThis.crypto?.randomUUID?.() ?? `life-atlas-block:${Date.now().toString(36)}:${identitySequence += 1}`;
}

function allocateIdentity(used, idFactory = generatedIdentity) {
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const id = idFactory();
    if (typeof id === "string" && id && !used.has(id)) {
      used.add(id);
      return id;
    }
  }
  refuse("identity-collision", "无法创建唯一的区块标识");
}

function nativeIndex(documentNode) {
  const entries = new Map();
  const visit = (node, position, parentId = null) => {
    let childParent = parentId;
    if (node.type.name === "blockContainer") {
      const id = node.attrs.id;
      if (typeof id !== "string" || !id || entries.has(id)) refuse("invalid-identity", "区块标识缺失或重复");
      const contentNode = node.firstChild;
      if (!contentNode) refuse("invalid-structure", "区块正文缺失");
      const group = node.childCount > 1 ? node.child(1) : null;
      if (group && group.type.name !== "blockGroup") refuse("invalid-structure", "区块子级结构无效");
      entries.set(id, { id, node, position, type: contentNode.type.name, parentId, children: group ? Array.from(group.content.content, (child) => child.attrs.id) : [] });
      childParent = id;
    }
    node.forEach((child, offset) => visit(child, position + offset + (node.type.name === "doc" ? 0 : 1), childParent));
  };
  visit(documentNode, 0);
  return entries;
}

function isDescendant(entries, blockId, ancestorId) {
  let parentId = entries.get(blockId)?.parentId;
  while (parentId) {
    if (parentId === ancestorId) return true;
    parentId = entries.get(parentId)?.parentId;
  }
  return false;
}

function sourceEntries(entries, blockIds, moving = true) {
  if (!Array.isArray(blockIds) || !blockIds.length) refuse("empty-source", "请选择要操作的区块");
  if (new Set(blockIds).size !== blockIds.length) refuse("duplicate-source", "拖动源中含有重复区块");
  const selected = blockIds.map((id) => {
    const entry = entries.get(id);
    if (!entry) refuse("stale-source", "区块已删除或已发生变化");
    if (moving && entry.type === "column") refuse("structural-source", "请拖动栏中的正文区块");
    return entry;
  });
  return selected.filter((entry) => !selected.some((ancestor) => isDescendant(entries, entry.id, ancestor.id))).sort((left, right) => left.position - right.position);
}

function isRemoved(entries, blockId, sources) {
  return sources.some((source) => source.id === blockId || isDescendant(entries, blockId, source.id));
}

function columnWillBeEmpty(entries, column, sources) {
  return column.children.every((id) => isRemoved(entries, id, sources));
}

export function resolveNativeBlockDrop(documentNode, blockIds, target, suppliedIndex) {
  const entries = suppliedIndex ?? nativeIndex(documentNode);
  const sources = sourceEntries(entries, blockIds);
  const destination = entries.get(target?.targetId);
  if (!destination) refuse("stale-target", "放置目标已删除或已发生变化");
  if (isRemoved(entries, destination.id, sources)) refuse("self-target", "不能将区块放入自身或其子级");
  if (!["before", "after"].includes(target.placement)) refuse("invalid-placement", "放置位置无效");
  if (!["content", "column-content", "edge-column", "wrap-columns"].includes(target.kind)) refuse("invalid-target", "放置目标无效");
  const parent = entries.get(destination.parentId);
  if (target.kind === "edge-column") {
    if (destination.type !== "column" || parent?.type !== "columnList") refuse("invalid-column-target", "新增栏需要有效的栏布局");
    if (parent.children.some((id) => entries.get(id)?.type !== "column")) refuse("invalid-column-target", "栏布局含有无效子级");
    if (columnWillBeEmpty(entries, destination, sources)) refuse("self-target", "不能在拖动源的空栏边缘放置");
    const remaining = parent.children.filter((id) => !columnWillBeEmpty(entries, entries.get(id), sources)).length;
    if (remaining + 1 > MAX_EDITOR_COLUMNS) refuse("maximum-columns", "一个布局最多支持五栏");
  } else if (target.kind === "column-content") {
    if (destination.type !== "column" || parent?.type !== "columnList") refuse("invalid-column-target", "放置目标不是正文栏");
  } else if (target.kind === "wrap-columns") {
    if (["column", "columnList", "tabPanel"].includes(destination.type) || parent?.type === "columnList" || parent?.type === "column") refuse("invalid-column-target", "请选择正文区块的外侧建立栏布局");
    if (sources.some((entry) => entry.type === "columnList")) refuse("nested-layout", "请先移动整个栏布局，再调整栏中内容");
  } else if (destination.type === "column" || parent?.type === "columnList") {
    refuse("structural-target", "正文不能直接放置在栏布局下面");
  }
  if (sources.some((entry) => entry.type === "columnList") && closestColumn(entries, destination)) refuse("nested-layout", "不能将整个栏布局放入栏中");
  return { kind: target.kind, targetId: destination.id, parentId: destination.parentId, placement: target.placement, blockIds: sources.map((entry) => entry.id) };
}

function layoutIdBase(type, outerId) {
  let encoded;
  try {
    encoded = encodeURIComponent(outerId);
  } catch {
    encoded = Array.from(outerId, (character) => character.codePointAt(0).toString(16)).join("-");
  }
  return `life-atlas-layout:${type}:${encoded}`;
}

export function normalizeNativeLayoutIds(transaction) {
  const layouts = [];
  const used = new Set();
  transaction.doc.descendants((node, position) => {
    if (node.type.name === "blockContainer" && ["column", "columnList"].includes(node.firstChild?.type.name) && Object.hasOwn(node.firstChild.type.attrs, "id")) {
      layouts.push({ position: position + 1, content: node.firstChild, outerId: node.attrs.id });
    }
    if (node.attrs.id && !["column", "columnList"].includes(node.type.name)) used.add(node.attrs.id);
  });
  let changed = 0;
  for (const layout of layouts) {
    if (typeof layout.outerId !== "string" || !layout.outerId) continue;
    const base = layoutIdBase(layout.content.type.name, layout.outerId);
    let id = base;
    let suffix = 0;
    while (used.has(id)) id = `${base}:${suffix += 1}`;
    used.add(id);
    if (layout.content.attrs.id === id) continue;
    transaction.setNodeMarkup(layout.position, undefined, { ...layout.content.attrs, id }, layout.content.marks);
    changed += 1;
  }
  return changed;
}

function normalizeDocumentLayoutIds(documentNode) {
  const transform = new Transform(documentNode);
  normalizeNativeLayoutIds(transform);
  return transform.doc;
}

function blockModels(documentNode) {
  if (documentNode.childCount !== 1 || documentNode.firstChild?.type.name !== "blockGroup") refuse("invalid-document", "编辑器正文结构无效");
  const readBlock = (node) => {
    if (node.type.name !== "blockContainer") refuse("invalid-structure", "正文含有无效区块");
    const group = node.childCount > 1 ? node.child(1) : null;
    return { id: node.attrs.id, type: node.firstChild.type.name, node, content: node.firstChild, group, children: group ? Array.from(group.content.content, readBlock) : [] };
  };
  return Array.from(documentNode.firstChild.content.content, readBlock);
}

function modelContext(models, blockId, parent = null) {
  for (const block of models) {
    if (block.id === blockId) return { block, parent, siblings: models, index: models.indexOf(block) };
    const nested = modelContext(block.children, blockId, block);
    if (nested) return nested;
  }
  return null;
}

function removeModels(models, ids) {
  return models.filter((block) => {
    if (ids.has(block.id)) return false;
    block.children = removeModels(block.children, ids);
    return true;
  });
}

function newBlockModel(schema, type, attrs, children, used, idFactory) {
  const id = allocateIdentity(used, idFactory);
  const content = schema.nodes[type]?.createChecked(attrs);
  if (!content) refuse("unsupported-layout", "编辑器不支持栏布局");
  const group = children.length ? schema.nodes.blockGroup.createChecked(null, Fragment.fromArray(children.map((block) => materializeBlock(block)))) : null;
  const node = schema.nodes.blockContainer.createChecked({ id }, Fragment.fromArray(group ? [content, group] : [content]));
  return { id, type, node, content, group, children };
}

function positiveWeight(value) {
  const width = Number(value);
  return Number.isFinite(width) && width > 0 ? width : 50;
}

function normalizeModels(models, parentType = null) {
  const normalized = [];
  for (const block of models) {
    block.children = normalizeModels(block.children, block.type);
    if (block.type === "column") {
      if (parentType !== "columnList") refuse("orphan-column", "正文栏必须属于栏布局");
      if (!block.children.length) continue;
    }
    if (block.type === "columnList") {
      if (block.children.some((child) => child.type !== "column")) refuse("invalid-column-children", "栏布局下面只能放置正文栏");
      if (block.children.length > MAX_EDITOR_COLUMNS) refuse("maximum-columns", "一个布局最多支持五栏");
      if (block.children.length === 0) continue;
      if (block.children.length === 1) {
        normalized.push(...block.children[0].children);
        continue;
      }
      const count = block.children.length;
      block.content = block.content.type.createChecked({ ...block.content.attrs, columns: count }, block.content.content, block.content.marks);
      block.children.forEach((column, index) => {
        column.content = column.content.type.createChecked({ ...column.content.attrs, width: positiveWeight(column.content.attrs.width), index, count }, column.content.content, column.content.marks);
      });
    }
    normalized.push(block);
  }
  return normalized;
}

function materializeBlock(block) {
  const children = block.children.map(materializeBlock);
  const group = children.length ? (block.group ?? block.node.type.schema.nodes.blockGroup.create()).copy(Fragment.fromArray(children)) : null;
  const content = Fragment.fromArray(group ? [block.content, group] : [block.content]);
  return block.node.content.eq(content) ? block.node : block.node.copy(content);
}

function finalDocument(documentNode, models, used, idFactory) {
  let normalized = normalizeModels(models);
  if (!normalized.length) normalized = [newBlockModel(documentNode.type.schema, "paragraph", {}, [], used, idFactory)];
  const group = documentNode.firstChild.copy(Fragment.fromArray(normalized.map(materializeBlock)));
  const result = normalizeDocumentLayoutIds(documentNode.copy(Fragment.from(group)));
  assertNativeBlockLayout(result);
  return result;
}

export function assertNativeBlockLayout(documentNode) {
  documentNode.check();
  const entries = nativeIndex(documentNode);
  for (const block of entries.values()) {
    if (block.type === "column") {
      if (entries.get(block.parentId)?.type !== "columnList" || !block.children.length) refuse("invalid-column", "栏布局含有空栏或独立栏");
    }
    if (block.type === "columnList") {
      if (block.children.length < 2 || block.children.length > MAX_EDITOR_COLUMNS || block.children.some((id) => entries.get(id)?.type !== "column")) refuse("invalid-column-list", "栏布局必须包含二至五栏");
      if (Number(block.node.firstChild.attrs.columns) !== block.children.length) refuse("invalid-column-count", "栏布局数量不匹配");
      block.children.forEach((id, index) => {
        const column = entries.get(id).node.firstChild;
        if (Number(column.attrs.index) !== index || Number(column.attrs.count) !== block.children.length || !(Number(column.attrs.width) > 0)) refuse("invalid-column-props", "正文栏的顺序或栏宽无效");
      });
    }
  }
  return entries;
}

export function planNativeBlockDrop(documentNode, blockIds, target, options = {}) {
  const entries = nativeIndex(documentNode);
  const resolved = resolveNativeBlockDrop(documentNode, blockIds, target, entries);
  let models = blockModels(documentNode);
  const sources = resolved.blockIds.map((id) => modelContext(models, id).block);
  const used = new Set();
  documentNode.descendants((node) => { if (node.attrs.id) used.add(node.attrs.id); });
  models = removeModels(models, new Set(resolved.blockIds));
  const destination = modelContext(models, resolved.targetId);
  if (!destination) refuse("stale-target", "放置目标已发生变化");
  const schema = documentNode.type.schema;
  if (resolved.kind === "column-content") {
    const index = resolved.placement === "before" ? 0 : destination.block.children.length;
    destination.block.children.splice(index, 0, ...sources);
  } else if (resolved.kind === "edge-column") {
    const width = positiveWeight(destination.block.content.attrs.width) / 2;
    destination.block.content = destination.block.content.type.createChecked({ ...destination.block.content.attrs, width }, destination.block.content.content, destination.block.content.marks);
    const column = newBlockModel(schema, "column", { width, index: 0, count: 2 }, sources, used, options.idFactory);
    destination.siblings.splice(destination.index + (resolved.placement === "after" ? 1 : 0), 0, column);
  } else if (resolved.kind === "wrap-columns") {
    const targetColumn = newBlockModel(schema, "column", { width: 50, index: 0, count: 2 }, [destination.block], used, options.idFactory);
    const sourceColumn = newBlockModel(schema, "column", { width: 50, index: 1, count: 2 }, sources, used, options.idFactory);
    const children = resolved.placement === "before" ? [sourceColumn, targetColumn] : [targetColumn, sourceColumn];
    const layout = newBlockModel(schema, "columnList", { columns: 2 }, children, used, options.idFactory);
    destination.siblings.splice(destination.index, 1, layout);
  } else {
    destination.siblings.splice(destination.index + (resolved.placement === "after" ? 1 : 0), 0, ...sources);
  }
  const doc = finalDocument(documentNode, models, used, options.idFactory);
  return { doc, target: resolved, blockIds: resolved.blockIds, changed: !documentNode.eq(doc) };
}

export function planNativeBlockRemoval(documentNode, blockIds, options = {}) {
  const entries = nativeIndex(documentNode);
  const sources = sourceEntries(entries, blockIds, false);
  const models = removeModels(blockModels(documentNode), new Set(sources.map((entry) => entry.id)));
  const used = new Set(entries.keys());
  const doc = finalDocument(documentNode, models, used, options.idFactory);
  return { doc, blockIds: sources.map((entry) => entry.id), selectionPosition: sources[0].position, changed: !documentNode.eq(doc) };
}

export function findEnclosingColumnContext(documentNode, blockId) {
  if (!documentNode || typeof blockId !== "string" || !blockId) return null;
  try {
    const entries = nativeIndex(documentNode);
    const entry = entries.get(blockId);
    if (!entry) return null;
    const column = closestColumn(entries, entry);
    if (!column) return null;
    const list = entries.get(column.parentId);
    if (!list || list.type !== "columnList") return null;
    const siblings = list.parentId
      ? (entries.get(list.parentId)?.children ?? [])
      : Array.from(documentNode.firstChild?.content?.content ?? [], (node) => node.attrs.id);
    const siblingIndex = siblings.indexOf(list.id);
    return {
      columnId: column.id,
      columnIndex: list.children.indexOf(column.id),
      columnCount: list.children.length,
      columnListId: list.id,
      siblingIndex,
      siblingCount: siblings.length,
    };
  } catch {
    return null;
  }
}

export function planNativeColumnUnwrap(documentNode, blockId, options = {}) {
  const entries = nativeIndex(documentNode);
  const context = findEnclosingColumnContext(documentNode, blockId);
  if (!context) refuse("not-in-column", "当前区块不在分栏布局中");
  const models = blockModels(documentNode);
  const target = modelContext(models, context.columnListId);
  if (!target || target.block.type !== "columnList") refuse("stale-target", "分栏布局已发生变化");
  const flattened = target.block.children.flatMap((column) => column.children);
  target.siblings.splice(target.index, 1, ...flattened);
  const used = new Set(entries.keys());
  const doc = finalDocument(documentNode, models, used, options.idFactory);
  return { doc, blockIds: [context.columnListId], selectionPosition: entries.get(context.columnListId).position, changed: !documentNode.eq(doc) };
}

export function planNativeColumnLayoutMove(documentNode, blockId, direction, options = {}) {
  if (direction !== "up" && direction !== "down") refuse("invalid-direction", "移动方向无效");
  const entries = nativeIndex(documentNode);
  const context = findEnclosingColumnContext(documentNode, blockId);
  if (!context) refuse("not-in-column", "当前区块不在分栏布局中");
  const models = blockModels(documentNode);
  const target = modelContext(models, context.columnListId);
  if (!target || target.block.type !== "columnList") refuse("stale-target", "分栏布局已发生变化");
  const nextIndex = direction === "up" ? target.index - 1 : target.index + 1;
  if (nextIndex < 0 || nextIndex >= target.siblings.length) refuse("boundary-limit", direction === "up" ? "整个分栏已在最上方" : "整个分栏已在最下方");
  const [moved] = target.siblings.splice(target.index, 1);
  target.siblings.splice(nextIndex, 0, moved);
  const used = new Set(entries.keys());
  const doc = finalDocument(documentNode, models, used, options.idFactory);
  return { doc, blockIds: [context.columnListId], selectionPosition: entries.get(context.columnListId).position, changed: !documentNode.eq(doc) };
}

export function applyNativeBlockPlan(transaction, plan) {
  const applyChange = (before, after, position) => {
    if (before.eq(after)) return;
    if (!before.sameMarkup(after) || before.isLeaf || after.isLeaf) {
      transaction.replaceWith(position, position + before.nodeSize, after);
      return;
    }
    const previous = Array.from(before.content.content);
    const next = Array.from(after.content.content);
    let first = 0;
    while (first < previous.length && first < next.length && previous[first].eq(next[first])) first += 1;
    let lastBefore = previous.length;
    let lastAfter = next.length;
    while (lastBefore > first && lastAfter > first && previous[lastBefore - 1].eq(next[lastAfter - 1])) { lastBefore -= 1; lastAfter -= 1; }
    const offset = previous.slice(0, first).reduce((total, child) => total + child.nodeSize, 0);
    const start = position + 1 + offset;
    if (lastBefore - first === 1 && lastAfter - first === 1 && previous[first].sameMarkup(next[first]) && !previous[first].isLeaf) {
      applyChange(previous[first], next[first], start);
      return;
    }
    const end = start + previous.slice(first, lastBefore).reduce((total, child) => total + child.nodeSize, 0);
    transaction.replaceWith(start, end, Fragment.fromArray(next.slice(first, lastAfter)));
  };
  applyChange(transaction.doc, plan.doc, -1);
  if (!transaction.doc.eq(plan.doc)) refuse("transaction-mismatch", "区块移动未能完整保留正文");
  assertNativeBlockLayout(transaction.doc);
  return transaction;
}

export function removeEditorBlocks(editor, blockIds, options = {}) {
  try {
    const view = nativeView(editor);
    if (!view || view.isDestroyed) refuse("unmounted", "编辑器已关闭");
    if (!editor.isEditable) refuse("locked", "页面已锁定");
    const documentNode = view.state.doc;
    const bookmark = options.bookmark ?? captureEditorSelection(editor);
    const plan = planNativeBlockRemoval(documentNode, blockIds, options);
    const selectionIds = [bookmark?.anchor?.blockId, bookmark?.head?.blockId, ...(bookmark?.blockIds ?? [])].filter(Boolean);
    const preserveSelection = options.preserveSelection ?? (selectionIds.length > 0 && selectionIds.every((id) => findNativeBlock(plan.doc, id)));
    const result = runEditorTransaction(editor, "remove-blocks", (transaction) => {
      applyNativeBlockPlan(transaction, plan);
      if (!preserveSelection) transaction.setSelection(Selection.near(transaction.doc.resolve(Math.min(plan.selectionPosition, transaction.doc.content.size))));
    }, { ...options, expectedDocument: documentNode, bookmark, preserveSelection });
    interactionState(editor).lastResult = result;
    publish(editor);
    return result;
  } catch (error) {
    return rejection(error);
  }
}

export function unwrapEditorColumnLayout(editor, blockId, options = {}) {
  try {
    const view = nativeView(editor);
    if (!view || view.isDestroyed) refuse("unmounted", "编辑器已关闭");
    if (!editor.isEditable) refuse("locked", "页面已锁定");
    const documentNode = view.state.doc;
    const bookmark = options.bookmark ?? captureEditorSelection(editor);
    const plan = planNativeColumnUnwrap(documentNode, blockId, options);
    const result = runEditorTransaction(editor, "unwrap-column-layout", (transaction) => {
      applyNativeBlockPlan(transaction, plan);
    }, { ...options, expectedDocument: documentNode, bookmark, preserveSelection: true });
    interactionState(editor).lastResult = result;
    publish(editor);
    return result;
  } catch (error) {
    return rejection(error);
  }
}

export function moveEditorColumnLayout(editor, blockId, direction, options = {}) {
  try {
    const view = nativeView(editor);
    if (!view || view.isDestroyed) refuse("unmounted", "编辑器已关闭");
    if (!editor.isEditable) refuse("locked", "页面已锁定");
    const documentNode = view.state.doc;
    const bookmark = options.bookmark ?? captureEditorSelection(editor);
    const plan = planNativeColumnLayoutMove(documentNode, blockId, direction, options);
    const result = runEditorTransaction(editor, `move-column-layout:${direction}`, (transaction) => {
      applyNativeBlockPlan(transaction, plan);
    }, { ...options, expectedDocument: documentNode, bookmark, preserveSelection: true });
    interactionState(editor).lastResult = result;
    publish(editor);
    return result;
  } catch (error) {
    return rejection(error);
  }
}

export function removeEditorColumn(editor, blockId, options = {}) {
  const view = nativeView(editor);
  const context = findEnclosingColumnContext(view?.state?.doc, blockId);
  if (!context) return rejection(new BlockDragError("not-in-column", "当前区块不在分栏布局中"));
  return removeEditorBlocks(editor, [context.columnId], options);
}

export function removeEditorColumnLayout(editor, blockId, options = {}) {
  const view = nativeView(editor);
  const context = findEnclosingColumnContext(view?.state?.doc, blockId);
  if (!context) return rejection(new BlockDragError("not-in-column", "当前区块不在分栏布局中"));
  return removeEditorBlocks(editor, [context.columnListId], options);
}

function ownedElement(view, element) {
  const target = element?.nodeType === 1 ? element : element?.parentElement;
  return Boolean(target && (target === view.dom || target.closest?.(".bn-editor") === view.dom));
}

function ownsEvent(view, event) {
  return ownedElement(view, event.target);
}

export function hasPrivateBlockDrag(event) {
  return Array.from(event.dataTransfer?.types ?? []).includes(BLOCK_DRAG_MIME);
}

function ensureSession(editor) {
  const view = nativeView(editor);
  const session = interactionState(editor).session;
  if (!view || view.isDestroyed) refuse("unmounted", "编辑器已关闭");
  if (!editor.isEditable || view.editable === false) refuse("locked", "页面已锁定");
  if (view.composing) refuse("composing", "请先完成当前文字输入");
  if (!session || activeDrag !== session || session.editor !== editor) refuse("foreign-editor", "只能在原编辑器中移动区块");
  if (view.state.doc !== session.documentNode) refuse("stale-source", "拖动期间正文已发生变化");
  return { view, session };
}

function outerElement(view, entry) {
  const native = view.nodeDOM?.(entry.position);
  const outer = native?.classList?.contains("bn-block-outer") ? native : native?.closest?.(".bn-block-outer[data-id]");
  if (outer?.dataset.id === entry.id && ownedElement(view, outer)) return outer;
  for (const candidate of view.dom.querySelectorAll?.(".bn-block-outer[data-id]") ?? []) {
    if (candidate.dataset.id === entry.id && ownedElement(view, candidate)) return candidate;
  }
  return null;
}

function contentElement(outer) {
  return outer?.querySelector?.(":scope > .bn-block > .bn-block-content, :scope > .bn-block > .react-renderer > .bn-block-content") ?? outer;
}

function rectOf(element) {
  const rect = element?.getBoundingClientRect?.();
  return rect ? { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height } : null;
}

function closestColumn(entries, entry) {
  let candidate = entry;
  while (candidate) {
    if (candidate.type === "column") return candidate;
    candidate = entries.get(candidate.parentId);
  }
  return null;
}

function nearestEntry(view, entries, ids, point) {
  let nearest = null;
  let distance = Infinity;
  for (const id of ids) {
    const candidate = entries.get(id);
    if (!candidate) continue;
    const rect = rectOf(outerElement(view, candidate));
    if (!rect || !rect.width || !rect.height) continue;
    const horizontal = Math.max(rect.left - point.x, point.x - rect.right, 0);
    const vertical = Math.max(rect.top - point.y, point.y - rect.bottom, 0);
    const candidateDistance = horizontal * horizontal + vertical * vertical;
    if (candidateDistance < distance) { nearest = candidate; distance = candidateDistance; }
  }
  return nearest;
}

export function resolveEditorBlockDrop(editor, point) {
  try {
    if (![point?.x, point?.y].every(Number.isFinite)) refuse("invalid-point", "放置坐标无效");
    const { view, session } = ensureSession(editor);
    const root = view.root ?? view.dom.ownerDocument;
    const elements = root.elementsFromPoint?.(point.x, point.y) ?? [root.elementFromPoint?.(point.x, point.y)];
    const hit = elements.find((element) => ownedElement(view, element));
    const frontEditor = elements.find((element) => element?.closest?.(".bn-editor"))?.closest?.(".bn-editor");
    if (!hit || (frontEditor && frontEditor !== view.dom)) refuse("foreign-target", "放置目标不属于原编辑器");
    const entries = session.entries;
    let destination = entries.get(hit.closest?.(".bn-block-outer[data-id]")?.dataset.id);
    if (!destination) destination = nearestEntry(view, entries, Array.from(entries.values()).filter((entry) => entry.parentId === null).map((entry) => entry.id), point);
    if (!destination) refuse("invalid-target", "没有可用的放置目标");
    let target;
    let preview;
    const hitColumn = closestColumn(entries, destination);
    const enclosingList = destination.type === "columnList"
      ? destination
      : hitColumn ? entries.get(hitColumn.parentId) : null;
    if (enclosingList && enclosingList.type === "columnList" && !isRemoved(entries, enclosingList.id, session.sources ?? [])) {
      const listRect = rectOf(outerElement(view, enclosingList));
      const outerSeam = 6;
      if (listRect && point.x >= listRect.left && point.x <= listRect.right) {
        if (point.y >= listRect.top - outerSeam && point.y <= listRect.top + outerSeam) {
          target = { kind: "content", targetId: enclosingList.id, placement: "before" };
          preview = { x: listRect.left, y: listRect.top, width: listRect.width, height: 2 };
        } else if (point.y >= listRect.bottom - outerSeam && point.y <= listRect.bottom + outerSeam) {
          target = { kind: "content", targetId: enclosingList.id, placement: "after" };
          preview = { x: listRect.left, y: listRect.bottom, width: listRect.width, height: 2 };
        }
      }
    }
    if (!target && destination.type === "columnList") destination = nearestEntry(view, entries, destination.children, point) ?? destination;
    const column = target ? null : closestColumn(entries, destination);
    if (!target && column) {
      const columnRect = rectOf(outerElement(view, column));
      if (!columnRect) refuse("stale-target", "放置目标已发生变化");
      const edge = point.x <= columnRect.left + EDGE_SIZE ? "before" : point.x >= columnRect.right - EDGE_SIZE ? "after" : null;
      if (edge) {
        target = { kind: "edge-column", targetId: column.id, placement: edge };
        preview = { x: edge === "before" ? columnRect.left : columnRect.right, y: columnRect.top, width: 2, height: Math.max(columnRect.height, 24) };
      } else if (destination.type === "column") {
        destination = nearestEntry(view, entries, column.children, point) ?? destination;
        if (destination.type === "column") {
          target = { kind: "column-content", targetId: column.id, placement: "after" };
          preview = { x: columnRect.left, y: columnRect.top + 8, width: columnRect.width, height: 2 };
        }
      }
    }
    if (!target) {
      const outer = outerElement(view, destination);
      const rect = rectOf(outer);
      const contentRect = rectOf(contentElement(outer));
      if (!rect || !contentRect) refuse("stale-target", "放置目标已发生变化");
      const placement = point.y < contentRect.top + contentRect.height / 2 ? "before" : "after";
      const verticalBand = Math.min(10, Math.max(4, Math.round(contentRect.height * 0.3)));
      const inVerticalMiddle = point.y > contentRect.top + verticalBand && point.y < contentRect.bottom - verticalBand;
      let edge = null;
      if (!column && destination.type !== "columnList" && inVerticalMiddle) {
        if (point.x >= rect.right - EDGE_SIZE && point.x <= rect.right + EDGE_SIZE) {
          edge = "after";
        } else if (point.x >= rect.left && point.x <= rect.left + EDGE_SIZE) {
          const startedFromHandle = Boolean(session.startPoint && session.sourceRect && session.startPoint.x <= session.sourceRect.left + EDGE_SIZE);
          const alignedLeft = Boolean(session.sourceRect && Math.abs(session.sourceRect.left - rect.left) <= 24);
          const deltaX = session.startPoint ? Math.abs(point.x - session.startPoint.x) : Infinity;
          const deltaY = session.startPoint ? Math.abs(point.y - session.startPoint.y) : 0;
          const accidentalLeftCorridor = startedFromHandle && alignedLeft && deltaX < Math.max(28, deltaY * 0.45);
          if (!accidentalLeftCorridor) edge = "before";
        }
      }
      target = { kind: edge ? "wrap-columns" : "content", targetId: destination.id, placement: edge ?? placement };
      preview = edge
        ? { x: edge === "before" ? rect.left : rect.right, y: rect.top, width: 2, height: Math.max(rect.height, 24) }
        : { x: rect.left, y: placement === "before" ? rect.top : rect.bottom, width: rect.width, height: 2 };
    }
    return { ok: true, ...resolveNativeBlockDrop(session.documentNode, session.blockIds, target, entries), rect: preview };
  } catch (error) {
    return rejection(error);
  }
}

export function beginEditorBlockDrag(editor, inputEvent, blockIds) {
  const event = inputEvent.nativeEvent ?? inputEvent;
  try {
    const view = nativeView(editor);
    if (!view || view.isDestroyed) refuse("unmounted", "编辑器已关闭");
    if (!editor.isEditable || view.editable === false) refuse("locked", "页面已锁定");
    if (view.composing) refuse("composing", "请先完成当前文字输入");
    if (!event.dataTransfer) refuse("missing-transfer", "拖动数据不可用");
    if (event.target?.closest?.(".life-column-resizer")) refuse("invalid-source", "栏宽调整控件不能作为拖动源");
    const closestEditor = event.target?.closest?.(".bn-editor");
    if (closestEditor && closestEditor !== view.dom) refuse("foreign-editor", "拖动源不属于此编辑器");
    const documentNode = view.state.doc;
    const entries = nativeIndex(documentNode);
    const sources = sourceEntries(entries, blockIds);
    if (activeDrag) cancelEditorBlockDrag(activeDrag.editor);
    const outer = outerElement(view, sources[0]);
    const startPoint = Number.isFinite(event.clientX) && Number.isFinite(event.clientY) ? { x: event.clientX, y: event.clientY } : null;
    const session = { editor, token: generatedIdentity(), documentNode, entries, sources, blockIds: sources.map((entry) => entry.id), bookmark: captureEditorSelection(editor), sourceElement: event.target, startPoint, sourceRect: rectOf(outer) };
    const payload = { version: 1, token: session.token, blockIds: session.blockIds };
    event.dataTransfer.setData(BLOCK_DRAG_MIME, JSON.stringify(payload));
    event.dataTransfer.setData("text/plain", sources.map((entry) => entry.node.textContent).join("\n"));
    event.dataTransfer.effectAllowed = "move";
    if (outer && event.dataTransfer.setDragImage) event.dataTransfer.setDragImage(outer, 8, 8);
    view.dragging = { slice: new Slice(Fragment.fromArray(sources.map((entry) => entry.node)), 0, 0), move: true };
    activeDrag = session;
    const state = interactionState(editor);
    state.session = session;
    state.preview = null;
    state.lastResult = { ok: true, changed: false };
    event.stopPropagation?.();
    publish(editor);
    return state.lastResult;
  } catch (error) {
    event.preventDefault?.();
    const result = rejection(error);
    interactionState(editor).lastResult = result;
    publish(editor);
    return result;
  }
}

export function cancelEditorBlockDrag(editor) {
  const state = interactionState(editor);
  const existed = Boolean(state.session || state.preview);
  const ownedDrag = Boolean(state.session || activeDrag?.editor === editor);
  if (activeDrag?.editor === editor) activeDrag = null;
  state.session = null;
  state.preview = null;
  const view = nativeView(editor);
  if (ownedDrag && view && !view.isDestroyed) view.dragging = null;
  if (existed) publish(editor);
  return existed;
}

export function handleEditorBlockDrop(editor, event) {
  if (!hasPrivateBlockDrag(event)) return false;
  const view = nativeView(editor);
  if (view && event.target && !ownsEvent(view, event)) return false;
  event.preventDefault?.();
  let result;
  try {
    const { session } = ensureSession(editor);
    let payload;
    try { payload = JSON.parse(event.dataTransfer.getData(BLOCK_DRAG_MIME)); } catch { refuse("invalid-payload", "拖动数据无效"); }
    if (payload?.version !== 1 || payload.token !== session.token || !Array.isArray(payload.blockIds) || payload.blockIds.length !== session.blockIds.length || payload.blockIds.some((id, index) => id !== session.blockIds[index])) refuse("foreign-editor", "拖动数据不属于原编辑器");
    const resolved = resolveEditorBlockDrop(editor, { x: event.clientX, y: event.clientY });
    if (!resolved.ok) refuse(resolved.reason, resolved.message);
    const plan = planNativeBlockDrop(session.documentNode, session.blockIds, resolved);
    result = runEditorTransaction(editor, "move-blocks", (transaction) => applyNativeBlockPlan(transaction, plan), { expectedDocument: session.documentNode, bookmark: session.bookmark, focus: true });
  } catch (error) {
    result = rejection(error);
  }
  interactionState(editor).lastResult = result;
  const sourceEditor = activeDrag?.editor;
  cancelEditorBlockDrag(editor);
  if (sourceEditor && sourceEditor !== editor) cancelEditorBlockDrag(sourceEditor);
  publish(editor);
  return true;
}

export function updateEditorBlockDrag(editor) {
  const state = interactionState(editor);
  const view = nativeView(editor);
  if (state.session && (!view || view.isDestroyed || !editor.isEditable || view.editable === false || view.composing || view.state.doc !== state.session.documentNode)) cancelEditorBlockDrag(editor);
}

export function mountEditorBlockDrag(editor, { dom, root, signal }) {
  const view = nativeView(editor);
  let previewElement = null;
  const clearPreview = () => {
    previewElement?.remove();
    previewElement = null;
  };
  const renderPreview = (snapshot) => {
    const rect = snapshot.dropTarget?.rect;
    if (!snapshot.dragging || !rect) {
      clearPreview();
      return;
    }
    const ownerDocument = dom.ownerDocument;
    const previewRoot = ownerDocument?.body ?? root;
    if (!ownerDocument?.createElement || !previewRoot?.appendChild) return;
    if (!previewElement) {
      previewElement = ownerDocument.createElement("div");
      previewElement.className = "life-block-drop-preview";
      previewElement.setAttribute("aria-hidden", "true");
      previewElement.style.position = "fixed";
      previewElement.style.pointerEvents = "none";
      previewRoot.appendChild(previewElement);
    }
    previewElement.dataset.dropKind = snapshot.dropTarget.kind;
    Object.assign(previewElement.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px` });
  };
  const unsubscribePreview = subscribeEditorBlockInteractions(editor, renderPreview);
  renderPreview(getEditorBlockInteractionState(editor));
  const listeners = [];
  const listen = (target, type, listener, capture = false) => {
    if (!target) return;
    target.addEventListener(type, listener, capture);
    listeners.push(() => target.removeEventListener(type, listener, capture));
  };
  listen(dom, "dragover", (event) => {
    if (!hasPrivateBlockDrag(event) || !ownsEvent(view, event)) return;
    event.preventDefault();
    event.stopPropagation();
    const resolved = resolveEditorBlockDrop(editor, { x: event.clientX, y: event.clientY });
    interactionState(editor).preview = resolved.ok ? resolved : null;
    event.dataTransfer.dropEffect = resolved.ok ? "move" : "none";
    publish(editor);
  }, true);
  listen(dom, "dragleave", (event) => {
    if (!interactionState(editor).session || ownedElement(view, event.relatedTarget)) return;
    interactionState(editor).preview = null;
    publish(editor);
  });
  listen(dom, "drop", (event) => {
    if (!hasPrivateBlockDrag(event) || !ownsEvent(view, event)) return;
    const handled = view.someProp("handleDrop", (handler) => handler(view, event, Slice.empty, false));
    event.preventDefault();
    event.stopPropagation();
    if (!handled) {
      cancelEditorBlockDrag(editor);
      if (activeDrag) cancelEditorBlockDrag(activeDrag.editor);
    }
  }, true);
  listen(root, "dragend", (event) => {
    const session = interactionState(editor).session;
    if (session && (ownsEvent(view, event) || event.target === session.sourceElement)) cancelEditorBlockDrag(editor);
  }, true);
  listen(root, "keydown", (event) => {
    if (event.key === "Escape" && interactionState(editor).session) {
      event.preventDefault();
      cancelEditorBlockDrag(editor);
    }
  }, true);
  const windowObject = dom.ownerDocument?.defaultView;
  listen(windowObject, "blur", () => cancelEditorBlockDrag(editor));
  listen(windowObject, "pagehide", () => cancelEditorBlockDrag(editor));
  const cleanup = () => {
    for (const remove of listeners.splice(0)) remove();
    signal?.removeEventListener("abort", cleanup);
    cancelEditorBlockDrag(editor);
    unsubscribePreview();
    clearPreview();
  };
  signal?.addEventListener("abort", cleanup, { once: true });
  return cleanup;
}
