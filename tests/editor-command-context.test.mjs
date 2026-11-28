import test from "node:test";
import assert from "node:assert/strict";
import { BlockNoteEditor, BlockNoteSchema, createBlockSpec, defaultBlockSpecs } from "@blocknote/core";
import { Fragment, Slice } from "@tiptap/pm/model";
import { AllSelection, NodeSelection, Selection, TextSelection } from "@tiptap/pm/state";
import { selectedEditorBlocks, ownsEditorKeyboardTarget, topLevelEditorBlocks } from "../src/editor/editorCommandContext.js";
import { convertEditorBlocks, getBlockConversionOptions } from "../src/editor/blockCommands.js";
import { findNativeBlock, runEditorTransaction } from "../src/editor/editorTransactions.js";
import { cloneBlockDocument, walkBlocks } from "../src/domain/blockDocument.js";

function unusedRender() {
  throw new Error("Headless selection tests do not render DOM");
}

const schema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    columnList: createBlockSpec({ type: "columnList", content: "none", propSchema: { columns: { default: 2, values: [2, 3, 4, 5] } } }, { render: unusedRender })(),
    column: createBlockSpec({ type: "column", content: "none", propSchema: { width: { default: 50 }, index: { default: 0 }, count: { default: 2 } } }, { render: unusedRender })(),
    tabs: createBlockSpec({ type: "tabs", content: "none", propSchema: { activeTabId: { default: "" } } }, { render: unusedRender })(),
    tabPanel: createBlockSpec({ type: "tabPanel", content: "none", propSchema: { tabId: { default: "" }, label: { default: "标签" }, icon: { default: "" } } }, { render: unusedRender })(),
    databaseView: createBlockSpec({ type: "databaseView", content: "none", propSchema: { sourceId: { default: "" }, viewId: { default: "" } } }, { render: unusedRender })(),
    equation: createBlockSpec({ type: "equation", content: "plain", propSchema: { display: { default: true } } }, { render: unusedRender })(),
  },
});

function realEditor(blocks = columnFixture()) {
  return BlockNoteEditor.create({ schema, initialContent: blocks });
}

function columnFixture() {
  return [
    { id: "root-before", type: "paragraph", content: "前文" },
    { id: "layout", type: "columnList", props: { columns: 3 }, children: [
      { id: "column-left", type: "column", props: { width: 40, index: 0, count: 3 }, children: [
        { id: "left-parent", type: "heading", props: { level: 2 }, content: "父级标题", children: [{ id: "left-child", type: "bulletListItem", content: "嵌套子级" }] },
        { id: "left-tail", type: "paragraph", content: "左栏末尾" },
      ] },
      { id: "column-middle", type: "column", props: { width: 30, index: 1, count: 3 }, children: [
        { id: "middle-text", type: "paragraph", content: "中栏正文", children: [{ id: "middle-child", type: "paragraph", content: "终点之后子级" }] },
        { id: "middle-after", type: "paragraph", content: "终点之后同级" },
      ] },
      { id: "column-right", type: "column", props: { width: 30, index: 2, count: 3 }, children: [{ id: "right-text", type: "paragraph", content: "右栏正文" }] },
    ] },
    { id: "root-after", type: "paragraph", content: "后文" },
  ];
}

function setTextSelection(editor, startId, startOffset, endId = startId, endOffset = startOffset) {
  editor.transact((transaction) => {
    const start = findNativeBlock(transaction.doc, startId).textStart + startOffset;
    const end = findNativeBlock(transaction.doc, endId).textStart + endOffset;
    transaction.setSelection(TextSelection.create(transaction.doc, start, end));
  });
}

function ids(blocks) {
  return blocks.map((block) => block.id);
}

function legacySelectedEditorBlocks(editor, block) {
  const selection = editor.getSelection()?.blocks;
  if (selection?.length && (!block || selection.some((entry) => entry.id === block.id))) return selection;
  return block ? [editor.getBlock(block.id) ?? block] : [];
}

test("cross-column native selections resolve identical exact content IDs in both directions", () => {
  const editor = realEditor();
  const resolve = process.env.LIFE_ATLAS_CONTEXT_TEST_LEGACY === "1" ? legacySelectedEditorBlocks : selectedEditorBlocks;
  for (const backward of [true, false]) {
    if (backward) setTextSelection(editor, "middle-text", 2, "left-tail", 1);
    else setTextSelection(editor, "left-tail", 1, "middle-text", 2);
    const anchor = editor.getTextCursorPosition().block;
    assert.deepEqual(ids(resolve(editor, anchor)), ["left-tail", "middle-text"], backward ? "backward native selection" : "forward native selection");
    assert.deepEqual(ids(selectedEditorBlocks(editor)), ["left-tail", "middle-text"]);
  }
});

test("legacy top-level membership demonstrates backward anchor narrowing without flattening endpoint descendants", () => {
  const editor = realEditor();
  setTextSelection(editor, "middle-text", 2, "left-tail", 1);
  assert.deepEqual(ids(editor.getSelection().blocks), ["left-tail", "column-middle"]);
  assert.deepEqual(ids(legacySelectedEditorBlocks(editor, editor.getTextCursorPosition().block)), ["middle-text"]);
  assert.deepEqual(ids(selectedEditorBlocks(editor)), ["left-tail", "middle-text"]);
});

test("native range endpoints exclude later descendants and untouched endpoint text", () => {
  const editor = realEditor();
  setTextSelection(editor, "left-tail", 1, "middle-text", 2);
  assert.deepEqual(ids(selectedEditorBlocks(editor)), ["left-tail", "middle-text"]);
  setTextSelection(editor, "left-tail", 1, "middle-text", 0);
  assert.deepEqual(ids(selectedEditorBlocks(editor)), ["left-tail"]);
  setTextSelection(editor, "middle-text", 0, "left-tail", 1);
  assert.deepEqual(ids(selectedEditorBlocks(editor)), ["left-tail"]);
  setTextSelection(editor, "left-tail", 4, "middle-text", 2);
  assert.deepEqual(ids(selectedEditorBlocks(editor)), ["middle-text"]);
});

test("hover inside the native selection uses all current blocks while outside hover targets alone", () => {
  const editor = realEditor();
  setTextSelection(editor, "middle-text", 2, "left-tail", 1);
  assert.deepEqual(ids(selectedEditorBlocks(editor, editor.getBlock("middle-text"))), ["left-tail", "middle-text"]);
  assert.deepEqual(ids(selectedEditorBlocks(editor, editor.getBlock("left-tail"))), ["left-tail", "middle-text"]);
  assert.deepEqual(ids(selectedEditorBlocks(editor, editor.getBlock("middle-child"))), ["middle-child"]);
  assert.deepEqual(ids(selectedEditorBlocks(editor, editor.getBlock("root-after"))), ["root-after"]);
  const old = editor.getBlock("root-after");
  editor.updateBlock("root-after", { content: "更新后的正文" });
  const current = selectedEditorBlocks(editor, old)[0];
  assert.equal(current === editor.getBlock("root-after"), true);
  assert.equal(current === old, false);
  assert.deepEqual(ids(selectedEditorBlocks(editor, { id: "missing", type: "paragraph" })), []);
});

test("collapsed and parent-only text selections resolve their own block without expanding children", () => {
  const editor = realEditor();
  setTextSelection(editor, "left-child", 2);
  assert.deepEqual(ids(selectedEditorBlocks(editor)), ["left-child"]);
  setTextSelection(editor, "left-parent", 0, "left-parent", 4);
  assert.deepEqual(ids(selectedEditorBlocks(editor)), ["left-parent"]);
  setTextSelection(editor, "left-parent", 4, "left-parent", 0);
  assert.deepEqual(ids(selectedEditorBlocks(editor)), ["left-parent"]);
  setTextSelection(editor, "left-child", 1, "middle-text", 2);
  assert.deepEqual(ids(selectedEditorBlocks(editor)), ["left-child", "left-tail", "middle-text"]);
});

test("ordinary nested ranges include touched content only and empty blocks when crossed", () => {
  const editor = realEditor([
    { id: "parent", type: "heading", props: { level: 1 }, content: "标题", children: [
      { id: "child-first", type: "paragraph", content: "第一子级" },
      { id: "child-empty", type: "paragraph", content: "" },
      { id: "child-last", type: "paragraph", content: "第二子级" },
    ] },
    { id: "after", type: "paragraph", content: "根级后文" },
  ]);
  setTextSelection(editor, "child-first", 1, "child-last", 2);
  assert.deepEqual(ids(selectedEditorBlocks(editor)), ["child-first", "child-empty", "child-last"]);
  setTextSelection(editor, "child-last", 1, "after", 2);
  assert.deepEqual(ids(selectedEditorBlocks(editor)), ["child-last", "after"]);
  setTextSelection(editor, "parent", 1, "child-first", 2);
  assert.deepEqual(ids(selectedEditorBlocks(editor)), ["parent", "child-first"]);
  setTextSelection(editor, "child-empty", 0);
  assert.deepEqual(ids(selectedEditorBlocks(editor)), ["child-empty"]);
});

test("selected mixed column media and special text stay in whole-command preflight in either direction", () => {
  const blocks = columnFixture();
  blocks[1].children[0].children.push(
    { id: "image", type: "image", props: { url: "lifeatlas://attachment/test-image" } },
    { id: "database", type: "databaseView", props: { sourceId: "fixture-source", viewId: "fixture-view" } },
    { id: "equation", type: "equation", content: "x+y" },
  );
  const editor = realEditor(blocks);
  for (const backward of [false, true]) {
    if (backward) setTextSelection(editor, "middle-text", 1, "left-tail", 1);
    else setTextSelection(editor, "left-tail", 1, "middle-text", 1);
    const selected = selectedEditorBlocks(editor, editor.getTextCursorPosition().block);
    assert.deepEqual(ids(selected), ["left-tail", "image", "database", "equation", "middle-text"]);
    if (backward) assert.deepEqual(ids(legacySelectedEditorBlocks(editor, editor.getTextCursorPosition().block)), ["middle-text"]);
    assert.equal(getBlockConversionOptions(editor, ids(selected)).every((target) => target.disabled), true);
    const documentNode = editor.prosemirrorState.doc;
    assert.equal(convertEditorBlocks(editor, ids(selected), "heading-2").reason, "incompatible-selection");
    assert.equal(editor.prosemirrorState.doc === documentNode, true);
  }
});

test("crossed tabs and panels resolve their text children without structural owner IDs", () => {
  const editor = realEditor([
    { id: "before", type: "paragraph", content: "前文" },
    { id: "tabs", type: "tabs", props: { activeTabId: "tab-one" }, children: [
      { id: "panel-one", type: "tabPanel", props: { tabId: "tab-one" }, children: [{ id: "panel-text", type: "paragraph", content: "正文" }] },
    ] },
    { id: "after", type: "paragraph", content: "后文" },
  ]);
  setTextSelection(editor, "before", 1, "panel-text", 1);
  assert.deepEqual(ids(selectedEditorBlocks(editor)), ["before", "panel-text"]);
  editor.transact((transaction) => transaction.setSelection(new AllSelection(transaction.doc)));
  assert.deepEqual(ids(selectedEditorBlocks(editor)), ["before", "panel-text", "after"]);
});

test("native node selections preserve the explicit block or content owner without subtree expansion", () => {
  const editor = realEditor();
  for (const blockId of ["left-parent", "layout", "column-middle"]) {
    for (const selectedPart of ["position", "contentPosition"]) {
      editor.transact((transaction) => transaction.setSelection(NodeSelection.create(transaction.doc, findNativeBlock(transaction.doc, blockId)[selectedPart])));
      assert.deepEqual(ids(selectedEditorBlocks(editor)), [blockId]);
      if (blockId !== "left-parent") assert.equal(getBlockConversionOptions(editor, [blockId]).every((target) => target.disabled), true);
    }
  }
  const media = realEditor([{ id: "image", type: "image", props: { url: "lifeatlas://attachment/test-image" } }]);
  media.transact((transaction) => transaction.setSelection(NodeSelection.create(transaction.doc, findNativeBlock(transaction.doc, "image").contentPosition)));
  assert.deepEqual(ids(selectedEditorBlocks(media)), ["image"]);
  assert.equal(getBlockConversionOptions(media, ids(selectedEditorBlocks(media))).every((target) => target.disabled), true);
});

class NativeBlockRangeSelection extends Selection {
  constructor(anchor, head) {
    super(anchor, head);
    this.nodes = [];
    anchor.doc.nodesBetween(this.from, this.to, (node, position, parent) => {
      if (parent === anchor.parent) {
        this.nodes.push(node);
        return false;
      }
      return undefined;
    });
  }
  static create(documentNode, anchor, head) {
    return new NativeBlockRangeSelection(documentNode.resolve(anchor), documentNode.resolve(head));
  }
  eq(other) {
    return other instanceof NativeBlockRangeSelection && other.anchor === this.anchor && other.head === this.head;
  }
  map(documentNode, mapping) {
    return NativeBlockRangeSelection.create(documentNode, mapping.map(this.anchor, 1), mapping.map(this.head, -1));
  }
  content() {
    return new Slice(Fragment.from(this.nodes), 0, 0);
  }
  toJSON() {
    return { type: "test-command-context-block-range", anchor: this.anchor, head: this.head };
  }
}

test("native block range selections preserve explicit ordered parents and structural owners", () => {
  const editor = realEditor();
  for (const backward of [false, true]) {
    editor.transact((transaction) => {
      const first = findNativeBlock(transaction.doc, "root-before").position;
      const last = findNativeBlock(transaction.doc, "layout").endPosition;
      transaction.setSelection(NativeBlockRangeSelection.create(transaction.doc, backward ? last : first, backward ? first : last));
    });
    assert.deepEqual(ids(selectedEditorBlocks(editor)), ["root-before", "layout"]);
    assert.equal(getBlockConversionOptions(editor, ids(selectedEditorBlocks(editor))).every((target) => target.disabled), true);
  }
  editor.transact((transaction) => transaction.setSelection(NativeBlockRangeSelection.create(transaction.doc, findNativeBlock(transaction.doc, "left-parent").position, findNativeBlock(transaction.doc, "left-tail").endPosition)));
  assert.deepEqual(ids(selectedEditorBlocks(editor)), ["left-parent", "left-tail"]);
});

test("all-document native selection includes all current content and preserves incompatible media", () => {
  const blocks = columnFixture();
  blocks.push({ id: "image", type: "image", props: { url: "lifeatlas://attachment/test-image" } });
  const editor = realEditor(blocks);
  editor.transact((transaction) => transaction.setSelection(new AllSelection(transaction.doc)));
  assert.deepEqual(ids(selectedEditorBlocks(editor)), ["root-before", "left-parent", "left-child", "left-tail", "middle-text", "middle-child", "middle-after", "right-text", "root-after", "image"]);
  assert.equal(getBlockConversionOptions(editor, ids(selectedEditorBlocks(editor))).every((target) => target.disabled), true);
});

function element(tagName = "div", attributes = {}, parentElement = null) {
  const classes = new Set((attributes.class ?? "").split(/\s+/).filter(Boolean));
  return {
    nodeType: 1,
    tagName: tagName.toUpperCase(),
    parentElement,
    classList: { contains: (name) => classes.has(name) },
    getAttribute(name) { return Object.hasOwn(attributes, name) ? attributes[name] : null; },
  };
}

function keyboardEditor(root = element("div", { class: "bn-editor ProseMirror", contenteditable: "true" })) {
  return { isEditable: true, prosemirrorView: { dom: root, state: { selection: { empty: true } }, editable: true, isDestroyed: false } };
}

test("keyboard ownership accepts real editable text, inline links, text nodes and the native view root", () => {
  const editor = keyboardEditor();
  const root = editor.prosemirrorView.dom;
  const paragraph = element("p", { class: "bn-inline-content" }, root);
  const link = element("a", { href: "lifeatlas://page/fixture" }, paragraph);
  assert.equal(ownsEditorKeyboardTarget(editor, root), true);
  assert.equal(ownsEditorKeyboardTarget(editor, paragraph), true);
  assert.equal(ownsEditorKeyboardTarget(editor, link), true);
  assert.equal(ownsEditorKeyboardTarget(editor, { nodeType: 3, parentElement: link }), true);
  const island = element("div", { contenteditable: "false" }, root);
  const editableText = element("div", { contenteditable: "true", role: "textbox" }, island);
  assert.equal(ownsEditorKeyboardTarget(editor, editableText), true);
  assert.equal(ownsEditorKeyboardTarget(editor, element("span", {}, editableText)), true);
  assert.equal(ownsEditorKeyboardTarget(editor, element("span", {}, island)), false);
});

test("keyboard ownership excludes form fields, separator and tab controls before editor capture", () => {
  const editor = keyboardEditor();
  const root = editor.prosemirrorView.dom;
  for (const tagName of ["button", "input", "textarea", "select", "summary"]) {
    const control = element(tagName, {}, root);
    assert.equal(ownsEditorKeyboardTarget(editor, control), false, tagName);
    assert.equal(ownsEditorKeyboardTarget(editor, element("span", {}, control)), false, `${tagName} descendant`);
  }
  for (const role of ["separator", "tab", "tablist", "toolbar", "menuitem", "combobox"]) {
    const control = element("div", { role, contenteditable: "true" }, root);
    assert.equal(ownsEditorKeyboardTarget(editor, control), false, role);
  }
  assert.equal(ownsEditorKeyboardTarget(editor, element("span", {}, element("div", { contenteditable: "false", class: "life-tabs-header" }, root))), false);
});

test("keyboard ownership excludes action and menu portals even when nested under an outer editable view", () => {
  const editor = keyboardEditor();
  const root = editor.prosemirrorView.dom;
  for (const className of ["life-block-actions", "bn-menu-dropdown", "life-block-menu", "life-block-conversion-menu", "life-block-colors-menu", "bn-formatting-toolbar"]) {
    const menu = element("div", { class: className, contenteditable: "true" }, root);
    assert.equal(ownsEditorKeyboardTarget(editor, element("span", {}, menu)), false, className);
  }
  const host = element("div", { class: "life-synced-source", contenteditable: "false" }, root);
  const nestedRoot = element("div", { class: "bn-editor ProseMirror", contenteditable: "true" }, host);
  const nested = keyboardEditor(nestedRoot);
  const nestedText = element("p", { class: "bn-inline-content" }, nestedRoot);
  assert.equal(ownsEditorKeyboardTarget(editor, nestedText), false);
  assert.equal(ownsEditorKeyboardTarget(nested, nestedText), true);
  const nestedPortal = element("div", { class: "life-block-actions", role: "toolbar" }, host);
  const dropdown = element("div", { class: "bn-menu-dropdown", contenteditable: "true" }, nestedPortal);
  assert.equal(ownsEditorKeyboardTarget(editor, dropdown), false);
  assert.equal(ownsEditorKeyboardTarget(nested, dropdown), false);
  const otherView = element("div", { class: "ProseMirror", contenteditable: "true" }, root);
  assert.equal(ownsEditorKeyboardTarget(editor, element("p", {}, otherView)), false);
});

test("unavailable editors and foreign or locked keyboard targets do not claim commands", () => {
  const editor = keyboardEditor();
  assert.equal(ownsEditorKeyboardTarget(editor, element()), false);
  assert.equal(ownsEditorKeyboardTarget(editor, null), false);
  editor.prosemirrorView.isDestroyed = true;
  assert.equal(ownsEditorKeyboardTarget(editor, editor.prosemirrorView.dom), false);
  assert.deepEqual(selectedEditorBlocks(editor), []);
  editor.prosemirrorView.isDestroyed = false;
  editor.isEditable = false;
  assert.equal(ownsEditorKeyboardTarget(editor, editor.prosemirrorView.dom), false);
  assert.deepEqual(selectedEditorBlocks(null), []);
  assert.equal(ownsEditorKeyboardTarget(null, element()), false);
});

test("subtree action targets collapse selected descendants without changing conversion selection", () => {
  const editor = realEditor();
  setTextSelection(editor, "left-parent", 1, "left-tail", 2);
  const selectedIds = ids(selectedEditorBlocks(editor));
  assert.deepEqual(selectedIds, ["left-parent", "left-child", "left-tail"]);
  const before = editor.prosemirrorState.doc;
  const targets = topLevelEditorBlocks(editor, selectedIds);
  assert.deepEqual(ids(targets), ["left-parent", "left-tail"]);
  assert.equal(targets.every((block) => block === editor.getBlock(block.id)), true);
  assert.deepEqual(ids(topLevelEditorBlocks(editor, ["left-parent", "left-child", "root-after"])), ["left-parent", "root-after"]);
  assert.deepEqual(ids(selectedEditorBlocks(editor)), selectedIds);
  assert.equal(editor.prosemirrorState.doc === before, true);
});

test("subtree action targets retain child-only requests and return current blocks in document order", () => {
  const editor = realEditor();
  const requestedIds = ["root-after", "left-tail", "left-child"];
  assert.deepEqual(ids(topLevelEditorBlocks(editor, requestedIds)), ["left-child", "left-tail", "root-after"]);
  assert.deepEqual(requestedIds, ["root-after", "left-tail", "left-child"]);
  assert.deepEqual(ids(topLevelEditorBlocks(editor, ["left-child"])), ["left-child"]);
  const old = editor.getBlock("left-child");
  editor.updateBlock("left-child", { content: "更新后的子级" });
  const current = topLevelEditorBlocks(editor, ["left-child"])[0];
  assert.equal(current === editor.getBlock("left-child"), true);
  assert.equal(current === old, false);
  assert.deepEqual(ids(topLevelEditorBlocks(editor, [])), []);
});

test("subtree action targets preserve explicit native structural owners and their complete subtree", () => {
  const editor = realEditor();
  editor.transact((transaction) => transaction.setSelection(NodeSelection.create(transaction.doc, findNativeBlock(transaction.doc, "layout").position)));
  const selectedIds = ids(selectedEditorBlocks(editor));
  assert.deepEqual(selectedIds, ["layout"]);
  const targets = topLevelEditorBlocks(editor, ["root-after", "middle-child", "column-middle", "middle-text", ...selectedIds]);
  assert.deepEqual(ids(targets), ["layout", "root-after"]);
  assert.equal(targets[0] === editor.getBlock("layout"), true);
  assert.deepEqual(ids(targets[0].children), ["column-left", "column-middle", "column-right"]);
  assert.deepEqual(ids(topLevelEditorBlocks(editor, ["middle-child", "middle-text", "column-middle"])), ["column-middle"]);
  assert.deepEqual(ids(topLevelEditorBlocks(editor, ["middle-child", "middle-text"])), ["middle-text"]);
});

test("subtree action targets reject invalid duplicate and missing requested IDs before any mutation", () => {
  const editor = realEditor();
  const before = editor.prosemirrorState.doc;
  for (const requestedIds of [null, "left-parent", [null], [7], [""], ["left-parent", "left-parent"], ["missing"], ["left-parent", "left-child", "missing"]]) {
    assert.throws(() => topLevelEditorBlocks(editor, requestedIds), /失效|重复/);
    assert.equal(editor.prosemirrorState.doc === before, true);
  }
  let mutationAttempts = 0;
  const result = runEditorTransaction(editor, "subtree:stale-preflight", () => {
    topLevelEditorBlocks(editor, ["left-parent", "left-child", "missing"]);
    mutationAttempts += 1;
    editor.insertBlocks([{ id: "must-not-insert", type: "paragraph", content: "不可插入" }], "left-parent", "after");
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "stale");
  assert.equal(mutationAttempts, 0);
  assert.equal(editor.prosemirrorState.doc === before, true);
});

test("subtree action targets reject ambiguous native IDs and stale canonical lookups even for suppressed descendants", () => {
  const editor = realEditor();
  const missingCanonical = {
    prosemirrorView: editor.prosemirrorView,
    getBlock(blockId) { return blockId === "left-child" ? null : editor.getBlock(blockId); },
  };
  assert.throws(() => topLevelEditorBlocks(missingCanonical, ["left-parent", "left-child"]), /失效/);
  assert.throws(() => topLevelEditorBlocks(null, ["left-parent"]), /关闭|准备/);
  assert.throws(() => topLevelEditorBlocks({ prosemirrorView: { isDestroyed: true } }, ["left-parent"]), /关闭|准备/);
  const view = editor.prosemirrorView;
  view.updateState(view.state.reconfigure({ plugins: [] }));
  editor.transact((transaction) => {
    const block = findNativeBlock(transaction.doc, "left-tail");
    transaction.setNodeMarkup(block.position, block.node.type, { ...block.node.attrs, id: "left-parent" });
  });
  assert.throws(() => topLevelEditorBlocks(editor, ["left-parent"]), /失效|重复/);
});

test("subtree action duplication inserts one copy of each carried child in a real native editor", () => {
  const editor = realEditor();
  setTextSelection(editor, "left-parent", 1, "left-tail", 2);
  const selectedIds = ids(selectedEditorBlocks(editor));
  assert.deepEqual(selectedIds, ["left-parent", "left-child", "left-tail"]);
  let sequence = 0;
  const idFactory = (prefix) => `subtree-copy-${prefix}-${sequence += 1}`;
  const result = runEditorTransaction(editor, "subtree:duplicate", () => {
    const targets = topLevelEditorBlocks(editor, selectedIds);
    editor.insertBlocks(cloneBlockDocument(targets, idFactory), targets.at(-1), "after");
  });
  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  const copies = walkBlocks(editor.document).filter((block) => block.id.startsWith("subtree-copy-"));
  assert.equal(copies.length, 3);
  assert.equal(copies.filter((block) => block.type === "heading").length, 1);
  assert.equal(copies.filter((block) => block.type === "bulletListItem").length, 1);
  assert.equal(copies.filter((block) => block.type === "paragraph").length, 1);
  assert.equal(walkBlocks(editor.document).filter((block) => block.type === "bulletListItem").length, 2);
  assert.deepEqual(ids(editor.getBlock("left-parent").children), ["left-child"]);
});
