import { Fragment } from "@tiptap/pm/model";
import { findNativeBlock, runEditorTransaction } from "./editorTransactions.js";

export const BLOCK_CONVERSION_TARGETS = Object.freeze([
  { id: "paragraph", label: "正文", type: "paragraph", props: {}, shortcut: "Ctrl+Alt+0" },
  { id: "heading-1", label: "标题 1", type: "heading", props: { level: 1 }, shortcut: "Ctrl+Alt+1" },
  { id: "heading-2", label: "标题 2", type: "heading", props: { level: 2 }, shortcut: "Ctrl+Alt+2" },
  { id: "heading-3", label: "标题 3", type: "heading", props: { level: 3 }, shortcut: "Ctrl+Alt+3" },
  { id: "bulletListItem", label: "无序列表", type: "bulletListItem", props: {}, shortcut: "Ctrl+Alt+5" },
  { id: "numberedListItem", label: "有序列表", type: "numberedListItem", props: {}, shortcut: "Ctrl+Alt+6" },
  { id: "checkListItem", label: "待办事项", type: "checkListItem", props: {}, shortcut: "Ctrl+Alt+4" },
  { id: "toggleListItem", label: "折叠列表", type: "toggleListItem", props: {}, shortcut: "Ctrl+Alt+7" },
  { id: "quote", label: "引用", type: "quote", props: {}, shortcut: "Ctrl+Alt+9" },
  { id: "callout", label: "提示框", type: "callout", props: {} },
  { id: "codeBlock", label: "代码", type: "codeBlock", props: {}, shortcut: "Ctrl+Alt+8" },
].map((target) => Object.freeze({ ...target, props: Object.freeze(target.props) })));

const convertibleTypes = new Set(BLOCK_CONVERSION_TARGETS.map((target) => target.type));
const commonProps = ["textColor", "backgroundColor", "textAlignment"];
const commonPropLabels = { textColor: "文字颜色", backgroundColor: "背景颜色", textAlignment: "对齐方式" };

function rejected(reason, message) {
  return { ok: false, changed: false, reason, message };
}

function collectSelection(documentNode, blockSchema, blockIds) {
  if (!Array.isArray(blockIds) || blockIds.length === 0) return rejected("empty-selection", "请先选择要转换的区块。");
  if (blockIds.some((blockId) => typeof blockId !== "string" || !blockId)) return rejected("stale", "所选区块已失效，请重新选择。");
  const selectedIds = new Set(blockIds);
  const selected = [];
  const duplicates = new Set();
  const seen = new Set();
  documentNode.descendants((node, position) => {
    if (node.type.name !== "blockContainer" || !selectedIds.has(node.attrs.id)) return undefined;
    if (seen.has(node.attrs.id)) duplicates.add(node.attrs.id);
    seen.add(node.attrs.id);
    selected.push({ id: node.attrs.id, node, position, contentNode: node.firstChild });
    return undefined;
  });
  if (selected.length === 0 || seen.size !== selectedIds.size || duplicates.size > 0) return rejected("stale", "所选区块已失效或标识重复，请重新选择。");
  if (selected.some((entry) => !convertibleTypes.has(entry.contentNode?.type.name) || !["inline", "plain"].includes(blockSchema?.[entry.contentNode?.type.name]?.content))) {
    return rejected("incompatible-selection", "所选区块包含布局、媒体、数据库或其他专用内容，无法整体转换。");
  }
  return { ok: true, selected };
}

function isAllowedProp(specification, value) {
  if (value === undefined) return specification.default === undefined;
  if (specification.values && !specification.values.includes(value)) return false;
  const expectedType = specification.type || typeof specification.default;
  return expectedType === "undefined" || typeof value === expectedType;
}

function compatibleContent(contentNode, targetNodeType) {
  if (targetNodeType.validContent(contentNode.content)) return contentNode.content;
  if (targetNodeType.name !== "codeBlock") return null;
  const nodes = [];
  let compatible = true;
  contentNode.content.forEach((node) => {
    if (!targetNodeType.allowsMarks(node.marks)) compatible = false;
    if (node.isText) nodes.push(node);
    else if (node.type === targetNodeType.schema.linebreakReplacement) nodes.push(targetNodeType.schema.text("\n", node.marks));
    else compatible = false;
  });
  if (!compatible) return null;
  const content = Fragment.fromArray(nodes);
  return targetNodeType.validContent(content) ? content : null;
}

function conversionPlan(documentNode, blockSchema, selected, target) {
  const targetConfig = blockSchema?.[target.type];
  const targetNodeType = documentNode.type.schema.nodes[target.type];
  if (!targetConfig || !targetNodeType || !["inline", "plain"].includes(targetConfig.content)) return rejected("unsupported-target", "当前编辑器不支持这种区块类型。");
  for (const [name, value] of Object.entries(target.props)) {
    if (!targetConfig.propSchema[name] || !isAllowedProp(targetConfig.propSchema[name], value)) return rejected("unsupported-target", "当前编辑器不支持这种区块类型。");
  }
  const changes = [];
  for (const entry of selected) {
    const sourceType = entry.contentNode.type.name;
    const sourceConfig = blockSchema[sourceType];
    const content = compatibleContent(entry.contentNode, targetNodeType);
    if (!content) {
      return target.type === "codeBlock"
        ? rejected("lossy-conversion", "代码区块无法保留当前文字格式、链接或提及内容。请先将内容整理为纯文本后再转换。")
        : rejected("lossy-conversion", "目标区块无法完整保留当前行内内容，操作已取消。");
    }
    const sourceProps = { ...entry.node.attrs, ...entry.contentNode.attrs };
    const props = Object.fromEntries(Object.entries(targetConfig.propSchema).map(([name, specification]) => [name, specification.default]));
    if (sourceType === target.type) {
      for (const [name, specification] of Object.entries(targetConfig.propSchema)) {
        if (Object.hasOwn(sourceProps, name) && isAllowedProp(specification, sourceProps[name])) props[name] = sourceProps[name];
      }
    }
    for (const name of commonProps) {
      const sourceSpecification = sourceConfig.propSchema[name];
      if (!sourceSpecification || !Object.hasOwn(sourceProps, name)) continue;
      const value = sourceProps[name];
      const targetSpecification = targetConfig.propSchema[name];
      if (!targetSpecification || !isAllowedProp(targetSpecification, value)) {
        if (value !== sourceSpecification.default) return rejected("lossy-conversion", `目标区块无法保留当前${commonPropLabels[name]}，请先恢复默认样式后再转换。`);
      } else props[name] = value;
    }
    Object.assign(props, target.props);
    const current = sourceType === target.type && Object.entries(target.props).every(([name, value]) => sourceProps[name] === value);
    if (!current) changes.push({ ...entry, props, content });
  }
  return { ok: true, changes, current: changes.length === 0 };
}

export function getBlockConversionOptions(editor, blockIds) {
  try {
    const view = editor.prosemirrorView;
    const documentNode = view?.state?.doc;
    let selection;
    if (!documentNode || view.isDestroyed) selection = rejected("unavailable", "编辑器已关闭或尚未准备好。");
    else if (editor.isEditable === false || view.editable === false) selection = rejected("locked", "页面已锁定，无法修改区块。");
    else if (view.composing) selection = rejected("composing", "请完成当前文字输入后再转换区块。");
    else selection = collectSelection(documentNode, editor.schema?.blockSchema, blockIds);
    return BLOCK_CONVERSION_TARGETS.map((target) => {
      const plan = selection.ok ? conversionPlan(documentNode, editor.schema?.blockSchema, selection.selected, target) : selection;
      return { ...target, disabled: !plan.ok, reason: plan.message || null, current: plan.current === true };
    });
  } catch {
    return BLOCK_CONVERSION_TARGETS.map((target) => ({ ...target, disabled: true, reason: "编辑器已关闭或尚未准备好。", current: false }));
  }
}

export function convertEditorBlocks(editor, blockIds, targetId) {
  const target = BLOCK_CONVERSION_TARGETS.find((candidate) => candidate.id === targetId);
  if (!target) return rejected("unsupported-target", "无法识别目标区块类型。");
  return runEditorTransaction(editor, `convert:${target.id}`, (transaction) => {
    const selection = collectSelection(transaction.doc, editor.schema?.blockSchema, blockIds);
    if (!selection.ok) throw Object.assign(new Error(selection.message), { reason: selection.reason });
    const plan = conversionPlan(transaction.doc, editor.schema?.blockSchema, selection.selected, target);
    if (!plan.ok) throw Object.assign(new Error(plan.message), { reason: plan.reason });
    for (const entry of plan.changes) {
      if (entry.content !== entry.contentNode.content) {
        const current = findNativeBlock(transaction.doc, entry.id);
        transaction.replaceWith(current.textStart, current.textStart + current.contentNode.content.size, entry.content);
      }
      if (target.type === "heading" && entry.contentNode.type.name === target.type) {
        const current = findNativeBlock(transaction.doc, entry.id);
        transaction.setNodeMarkup(current.contentPosition, current.contentNode.type, { ...current.contentNode.attrs, ...entry.props });
      } else editor.updateBlock(entry.id, { type: target.type, props: entry.props });
      const updated = findNativeBlock(transaction.doc, entry.id);
      if (!updated || updated.contentNode.type.name !== target.type || !updated.contentNode.content.eq(entry.content) || updated.node.childCount !== entry.node.childCount) {
        throw Object.assign(new Error("区块转换无法完整保留原内容，操作已取消。"), { reason: "lossy-conversion" });
      }
    }
  }, { focus: true });
}
