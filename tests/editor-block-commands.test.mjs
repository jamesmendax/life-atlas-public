import test from "node:test";
import assert from "node:assert/strict";
import { BlockNoteEditor, BlockNoteSchema, createBlockSpec, createInlineContentSpec, defaultBlockSpecs, defaultInlineContentSpecs, defaultProps } from "@blocknote/core";
import { Fragment, Slice } from "@tiptap/pm/model";
import { AllSelection, NodeSelection, Plugin, Selection, TextSelection } from "@tiptap/pm/state";
import { history, redo, redoDepth, undo, undoDepth } from "@tiptap/pm/history";
import { BLOCK_CONVERSION_TARGETS, convertEditorBlocks, getBlockConversionOptions } from "../src/editor/blockCommands.js";
import { captureEditorSelection, findNativeBlock, restoreEditorSelection, runEditorTransaction } from "../src/editor/editorTransactions.js";
import { lifeAtlasCodeBlockSpec } from "../src/editor/codeBlockSpec.js";

function unusedRender() {
  throw new Error("Headless command tests do not render DOM");
}

function makeSchema({ commonCalloutProps = true } = {}) {
  return BlockNoteSchema.create({
    blockSpecs: {
      ...defaultBlockSpecs,
      codeBlock: lifeAtlasCodeBlockSpec,
      callout: createBlockSpec({
        type: "callout",
        content: "inline",
        propSchema: { ...(commonCalloutProps ? defaultProps : {}), icon: { default: "💡" }, tone: { default: "neutral", values: ["neutral", "gray", "blue"] } },
      }, { render: unusedRender })(),
      columnList: createBlockSpec({ type: "columnList", content: "none", propSchema: { columns: { default: 2, values: [2, 3, 4, 5] } } }, { render: unusedRender })(),
      column: createBlockSpec({ type: "column", content: "none", propSchema: { width: { default: 50 }, index: { default: 0 }, count: { default: 2 } } }, { render: unusedRender })(),
      databaseView: createBlockSpec({ type: "databaseView", content: "none", propSchema: { sourceId: { default: "" }, viewId: { default: "" } } }, { render: unusedRender })(),
      equation: createBlockSpec({ type: "equation", content: "inline", propSchema: {} }, { render: unusedRender })(),
    },
    inlineContentSpecs: {
      ...defaultInlineContentSpecs,
      pageMention: createInlineContentSpec({ type: "pageMention", content: "none", propSchema: { pageId: { default: "" }, label: { default: "" } } }, { render: unusedRender }),
    },
  });
}

const commandSchema = makeSchema();

function realEditor(blocks, schema = commandSchema) {
  const editor = BlockNoteEditor.create({ schema, initialContent: blocks });
  const transactions = [];
  const recorder = new Plugin({
    state: {
      init: () => null,
      apply(transaction) {
        transactions.push(transaction);
        return null;
      },
    },
  });
  const view = editor.prosemirrorView;
  view.updateState(view.state.reconfigure({ plugins: [history(), recorder] }));
  return { editor, transactions };
}

function nestedFixture() {
  return [
    { id: "root-before", type: "paragraph", content: "前文" },
    { id: "layout", type: "columnList", props: { columns: 2 }, children: [
      { id: "column-left", type: "column", props: { width: 35, index: 0, count: 2 }, children: [
        { id: "rich-parent", type: "paragraph", props: { textColor: "blue", backgroundColor: "gray", textAlignment: "center" }, content: [
          { type: "text", text: "粗体", styles: { bold: true, italic: true } },
          { type: "link", href: "lifeatlas://page/link-target", content: [{ type: "text", text: "链接", styles: { underline: true } }] },
          { type: "pageMention", props: { pageId: "mention-target", label: "提及" } },
        ], children: [{ id: "nested-child", type: "bulletListItem", content: "子级原文" }] },
        { id: "left-tail", type: "paragraph", content: "左栏末尾" },
      ] },
      { id: "column-right", type: "column", props: { width: 65, index: 1, count: 2 }, children: [{ id: "right-text", type: "paragraph", content: "右栏原文" }] },
    ] },
    { id: "root-after", type: "paragraph", content: "后文" },
  ];
}

function cursor(editor, blockId, offset = 0) {
  editor.transact((transaction) => {
    transaction.setSelection(TextSelection.create(transaction.doc, findNativeBlock(transaction.doc, blockId).textStart + offset));
  });
}

function logicalEndpoints(editor) {
  const bookmark = captureEditorSelection(editor);
  return { kind: bookmark.kind, anchor: bookmark.anchor, head: bookmark.head };
}

function blockTreeIdentity(documentNode) {
  const result = [];
  documentNode.descendants((node, position) => {
    if (node.type.name === "blockContainer") result.push({ id: node.attrs.id, position, size: node.nodeSize });
  });
  return result;
}

function applyHistory(editor, command) {
  assert.equal(command(editor.prosemirrorState, (transaction) => editor.prosemirrorView.dispatch(transaction)), true);
}

function memoryEditor(state, extra = {}) {
  const transactions = [];
  let activeTransaction = null;
  const view = {
    state,
    editable: true,
    composing: false,
    isDestroyed: false,
    focused: false,
    hasFocus() { return this.focused; },
    dispatch(transaction) {
      transactions.push(transaction);
      this.state = this.state.apply(transaction);
    },
    ...extra,
  };
  const editor = {
    prosemirrorView: view,
    isEditable: true,
    schema: commandSchema,
    transact(callback) {
      if (activeTransaction) return callback(activeTransaction);
      activeTransaction = view.state.tr;
      try {
        const result = callback(activeTransaction);
        const transaction = activeTransaction;
        activeTransaction = null;
        if (transaction.docChanged || transaction.selectionSet || transaction.storedMarksSet || !transaction.isGeneric) view.dispatch(transaction);
        return result;
      } finally {
        activeTransaction = null;
      }
    },
    focus() { view.focused = true; },
  };
  return { editor, view, transactions };
}

test("conversion catalog covers existing text, headings, lists, quote, callout and code", () => {
  assert.deepEqual(BLOCK_CONVERSION_TARGETS.map((target) => target.id), ["paragraph", "heading-1", "heading-2", "heading-3", "bulletListItem", "numberedListItem", "checkListItem", "toggleListItem", "quote", "callout", "codeBlock"]);
  assert.equal(new Set(BLOCK_CONVERSION_TARGETS.map((target) => target.id)).size, 11);
  assert.ok(BLOCK_CONVERSION_TARGETS.every((target) => Object.isFrozen(target) && Object.isFrozen(target.props)));
});

test("real BlockNote converts populated rich blocks inside columns with IDs, marks, links and children intact", () => {
  for (const target of BLOCK_CONVERSION_TARGETS.filter((entry) => entry.type !== "codeBlock")) {
    const fixture = nestedFixture();
    if (target.type === "quote") fixture[1].children[0].children[0].props.textAlignment = "left";
    const { editor, transactions } = realEditor(fixture);
    cursor(editor, "rich-parent", 1);
    const before = editor.prosemirrorState.doc;
    const content = findNativeBlock(before, "rich-parent").contentNode.content;
    const children = findNativeBlock(before, "rich-parent").node.child(1);
    const identity = blockTreeIdentity(before);
    const selection = logicalEndpoints(editor);
    transactions.length = 0;
    const result = convertEditorBlocks(editor, ["rich-parent"], target.id);
    assert.deepEqual(result, { ok: true, changed: target.type !== "paragraph" }, target.id);
    const current = findNativeBlock(editor.prosemirrorState.doc, "rich-parent");
    assert.equal(current.contentNode.type.name, target.type, target.id);
    assert.equal(current.contentNode.content === content, true, target.id);
    assert.equal(current.node.child(1) === children, true, target.id);
    assert.deepEqual(blockTreeIdentity(editor.prosemirrorState.doc), identity, target.id);
    assert.deepEqual(logicalEndpoints(editor), selection, target.id);
    assert.deepEqual(editor.getBlock("rich-parent").props.textColor, "blue", target.id);
    assert.deepEqual(editor.getBlock("rich-parent").props.backgroundColor, "gray", target.id);
    assert.equal(editor.getBlock("rich-parent").props.textAlignment ?? "left", target.type === "quote" ? "left" : "center", target.id);
    assert.equal(transactions.filter((transaction) => transaction.docChanged).length, result.changed ? 1 : 0, target.id);
    assert.equal(undoDepth(editor.prosemirrorState), result.changed ? 1 : 0, target.id);
    if (result.changed) {
      const converted = editor.prosemirrorState.doc;
      applyHistory(editor, undo);
      assert.ok(editor.prosemirrorState.doc.eq(before), target.id);
      assert.deepEqual(logicalEndpoints(editor), selection, target.id);
      applyHistory(editor, redo);
      assert.ok(editor.prosemirrorState.doc.eq(converted), target.id);
      assert.deepEqual(logicalEndpoints(editor), selection, target.id);
    }
  }
});

test("plain populated blocks convert across the full supported source and target matrix", () => {
  const sourceTypes = [...new Set(BLOCK_CONVERSION_TARGETS.map((target) => target.type))];
  for (const sourceType of sourceTypes) {
    for (const target of BLOCK_CONVERSION_TARGETS) {
      const { editor, transactions } = realEditor([{ id: "existing", type: sourceType, content: "现有第一行\n第二行", children: [{ id: "existing-child", type: "paragraph", content: "保留子级" }] }]);
      const before = editor.prosemirrorState.doc;
      const native = findNativeBlock(before, "existing");
      const content = native.contentNode.content;
      const text = native.contentNode.textBetween(0, content.size, "", "\n");
      const child = native.node.child(1);
      const result = convertEditorBlocks(editor, ["existing"], target.id);
      assert.equal(result.ok, true, `${sourceType} -> ${target.id}: ${result.message}`);
      const converted = findNativeBlock(editor.prosemirrorState.doc, "existing");
      assert.equal(converted.contentNode.type.name, target.type, `${sourceType} -> ${target.id}`);
      if (target.type !== "codeBlock" || native.contentNode.type.name === "codeBlock") assert.equal(converted.contentNode.content === content, true, `${sourceType} -> ${target.id}`);
      assert.equal(converted.contentNode.textBetween(0, converted.contentNode.content.size, "", "\n"), text, `${sourceType} -> ${target.id}`);
      if (target.type === "codeBlock") converted.contentNode.forEach((node) => assert.equal(node.isText, true));
      assert.equal(converted.node.child(1) === child, true, `${sourceType} -> ${target.id}`);
      assert.equal(converted.node.attrs.id, "existing", `${sourceType} -> ${target.id}`);
      if (target.props.level) assert.equal(converted.contentNode.attrs.level, target.props.level);
      assert.equal(transactions.filter((transaction) => transaction.docChanged).length, result.changed ? 1 : 0);
      assert.equal(undoDepth(editor.prosemirrorState), result.changed ? 1 : 0);
      if (result.changed) {
        applyHistory(editor, undo);
        assert.ok(editor.prosemirrorState.doc.eq(before), `${sourceType} -> ${target.id}`);
      }
    }
  }
});

test("same heading type level changes retain raw rich fragments, child identity and native history", () => {
  const fixture = nestedFixture();
  const heading = fixture[1].children[0].children[0];
  heading.type = "heading";
  heading.props = { ...heading.props, level: 1, isToggleable: true };
  const { editor, transactions } = realEditor(fixture);
  cursor(editor, "rich-parent", 1);
  const original = findNativeBlock(editor.prosemirrorState.doc, "rich-parent");
  const content = original.contentNode.content;
  const children = original.node.child(1);
  const identity = blockTreeIdentity(editor.prosemirrorState.doc);
  const selection = logicalEndpoints(editor);
  let updateCount = 0;
  const originalUpdate = editor.updateBlock.bind(editor);
  editor.updateBlock = (...parameters) => { updateCount += 1; return originalUpdate(...parameters); };
  let completedChanges = 0;
  for (const level of [2, 3, 1]) {
    const before = editor.prosemirrorState.doc;
    transactions.length = 0;
    assert.deepEqual(convertEditorBlocks(editor, ["rich-parent"], `heading-${level}`), { ok: true, changed: true });
    completedChanges += 1;
    const current = findNativeBlock(editor.prosemirrorState.doc, "rich-parent");
    assert.equal(current.contentNode.content === content, true, `heading-${level} fragment identity`);
    assert.equal(current.node.child(1) === children, true, `heading-${level} child identity`);
    assert.equal(current.contentNode.attrs.level, level);
    const props = editor.getBlock("rich-parent").props;
    assert.equal(props.textColor, "blue");
    assert.equal(props.backgroundColor, "gray");
    assert.equal(props.textAlignment, "center");
    assert.equal(props.isToggleable, true);
    assert.deepEqual(blockTreeIdentity(editor.prosemirrorState.doc), identity);
    assert.deepEqual(logicalEndpoints(editor), selection);
    assert.equal(updateCount, 0);
    assert.equal(transactions.filter((transaction) => transaction.docChanged).length, 1);
    assert.equal(undoDepth(editor.prosemirrorState), completedChanges);
    const converted = editor.prosemirrorState.doc;
    applyHistory(editor, undo);
    assert.equal(editor.prosemirrorState.doc.eq(before), true);
    assert.deepEqual(logicalEndpoints(editor), selection);
    applyHistory(editor, redo);
    assert.equal(editor.prosemirrorState.doc.eq(converted), true);
    assert.deepEqual(logicalEndpoints(editor), selection);
  }
});

test("unequal native identities produce bounded assertion diagnostics without inspecting editor graphs", () => {
  const { editor } = realEditor([{ id: "text", type: "paragraph", content: "原文", children: [{ id: "child", type: "paragraph", content: "子级" }] }]);
  const documentNode = editor.prosemirrorState.doc;
  const native = findNativeBlock(documentNode, "text");
  const selection = editor.prosemirrorState.selection;
  const bold = editor.prosemirrorState.schema.marks.bold.create();
  const identities = [
    { kind: "fragment", original: native.contentNode.content, copy: Fragment.fromArray([...native.contentNode.content.content]) },
    { kind: "node", original: native.node, copy: native.node.type.create(native.node.attrs, native.node.content, native.node.marks) },
    { kind: "selection", original: selection, copy: TextSelection.create(documentNode, selection.anchor, selection.head) },
    { kind: "mark", original: bold, copy: bold.type.create(bold.attrs) },
  ];
  for (const { kind, original, copy } of identities) {
    assert.equal(copy === original, false, `${kind} uses distinct references`);
    assert.equal(copy.eq(original), true, `${kind} remains semantically equal`);
    assert.throws(() => assert.equal(copy === original, true, `intentional ${kind} identity mismatch`), (error) => {
      assert.equal(error.code, "ERR_ASSERTION");
      assert.equal(error.actual, false);
      assert.equal(error.expected, true);
      assert.ok(Buffer.byteLength(error.message, "utf8") < 2048);
      return true;
    });
  }
});

test("mixed selections and stale block IDs reject before any block update", () => {
  for (const incompatible of ["column", "columnList", "databaseView", "image", "file", "equation"]) {
    const { editor, transactions } = realEditor([{ id: "text", type: "paragraph", content: "保留" }, { id: "incompatible", type: incompatible }]);
    const before = editor.prosemirrorState.doc;
    let updateCount = 0;
    const originalUpdate = editor.updateBlock.bind(editor);
    editor.updateBlock = (...parameters) => { updateCount += 1; return originalUpdate(...parameters); };
    const options = getBlockConversionOptions(editor, ["text", "incompatible"]);
    assert.ok(options.every((option) => option.disabled), incompatible);
    const result = convertEditorBlocks(editor, ["text", "incompatible"], "heading-2");
    assert.equal(result.reason, "incompatible-selection", incompatible);
    assert.equal(updateCount, 0, incompatible);
    assert.equal(editor.prosemirrorState.doc === before, true, incompatible);
    assert.equal(transactions.length, 0, incompatible);
    assert.equal(undoDepth(editor.prosemirrorState), 0, incompatible);
  }
  const { editor, transactions } = realEditor([{ id: "text", type: "paragraph", content: "保留" }]);
  assert.equal(convertEditorBlocks(editor, ["text", "missing"], "quote").reason, "stale");
  assert.equal(convertEditorBlocks(editor, [], "quote").reason, "empty-selection");
  assert.equal(convertEditorBlocks(editor, ["text"], "unknown").reason, "unsupported-target");
  assert.equal(transactions.length, 0);
});

test("code conversion explicitly rejects rich marks, links, inline atoms and nondefault block styling", () => {
  const contents = [
    [{ type: "text", text: "格式", styles: { bold: true } }],
    [{ type: "link", href: "lifeatlas://page/target", content: [{ type: "text", text: "链接", styles: {} }] }],
    [{ type: "pageMention", props: { pageId: "target", label: "提及" } }],
  ];
  for (const content of contents) {
    const { editor, transactions } = realEditor([{ id: "first", type: "paragraph", content: "普通文字" }, { id: "rich", type: "paragraph", content }]);
    const before = editor.prosemirrorState.doc;
    const option = getBlockConversionOptions(editor, ["first", "rich"]).find((entry) => entry.id === "codeBlock");
    assert.equal(option.disabled, true);
    assert.match(option.reason, /无法保留/);
    const result = convertEditorBlocks(editor, ["first", "rich"], "codeBlock");
    assert.equal(result.reason, "lossy-conversion");
    assert.equal(editor.prosemirrorState.doc === before, true);
    assert.equal(transactions.length, 0);
    assert.equal(undoDepth(editor.prosemirrorState), 0);
  }
  const { editor, transactions } = realEditor([{ id: "colored", type: "paragraph", props: { textColor: "red" }, content: "纯文字" }]);
  assert.equal(convertEditorBlocks(editor, ["colored"], "codeBlock").reason, "lossy-conversion");
  assert.equal(transactions.length, 0);
});

test("conversion does not carry inappropriate type props and keeps meaningful same-type props", () => {
  const { editor } = realEditor([{ id: "callout", type: "callout", props: { icon: "📚", tone: "blue" }, content: "原文" }, { id: "checked", type: "checkListItem", props: { checked: true }, content: "完成项" }, { id: "code", type: "codeBlock", props: { language: "javascript" }, content: "const value = 1;" }]);
  assert.deepEqual(convertEditorBlocks(editor, ["checked"], "checkListItem"), { ok: true, changed: false });
  assert.equal(editor.getBlock("checked").props.checked, true);
  assert.deepEqual(convertEditorBlocks(editor, ["code"], "codeBlock"), { ok: true, changed: false });
  assert.equal(editor.getBlock("code").props.language, "javascript");
  assert.equal(convertEditorBlocks(editor, ["callout", "checked", "code"], "heading-3").ok, true);
  for (const blockId of ["callout", "checked", "code"]) {
    const props = editor.getBlock(blockId).props;
    assert.equal(props.level, 3);
    assert.ok(!Object.hasOwn(props, "icon"));
    assert.ok(!Object.hasOwn(props, "tone"));
    assert.ok(!Object.hasOwn(props, "checked"));
    assert.ok(!Object.hasOwn(props, "language"));
  }
});

test("overlapping ancestor and child selections are preflighted and converted once in document order", () => {
  const { editor, transactions } = realEditor(nestedFixture());
  const before = editor.prosemirrorState.doc;
  const parentContent = findNativeBlock(before, "rich-parent").contentNode.content;
  const childContent = findNativeBlock(before, "nested-child").contentNode.content;
  const updates = [];
  const originalUpdate = editor.updateBlock.bind(editor);
  editor.updateBlock = (blockId, update) => { updates.push(blockId); return originalUpdate(blockId, update); };
  assert.equal(convertEditorBlocks(editor, ["nested-child", "rich-parent", "nested-child"], "heading-2").ok, true);
  assert.deepEqual(updates, ["rich-parent", "nested-child"]);
  assert.equal(findNativeBlock(editor.prosemirrorState.doc, "rich-parent").contentNode.content === parentContent, true);
  assert.equal(findNativeBlock(editor.prosemirrorState.doc, "nested-child").contentNode.content === childContent, true);
  assert.deepEqual(blockTreeIdentity(editor.prosemirrorState.doc), blockTreeIdentity(before));
  assert.equal(transactions.filter((transaction) => transaction.docChanged).length, 1);
  assert.equal(undoDepth(editor.prosemirrorState), 1);
  applyHistory(editor, undo);
  assert.ok(editor.prosemirrorState.doc.eq(before));
});

test("same target is a no-op without selection dispatches or metadata-only history entries", () => {
  const { editor, transactions } = realEditor([{ id: "existing-heading", type: "heading", props: { level: 2, isToggleable: true }, content: "现有标题", children: [{ id: "child", type: "paragraph", content: "子级" }] }]);
  const before = editor.prosemirrorState.doc;
  const option = getBlockConversionOptions(editor, ["existing-heading"]).find((target) => target.id === "heading-2");
  assert.equal(option.current, true);
  assert.equal(option.disabled, false);
  assert.deepEqual(convertEditorBlocks(editor, ["existing-heading"], "heading-2"), { ok: true, changed: false });
  assert.equal(editor.prosemirrorState.doc === before, true);
  assert.equal(transactions.length, 0);
  assert.equal(undoDepth(editor.prosemirrorState), 0);
});

test("native history isolates conversion from both preceding and immediately following typing", () => {
  const { editor, transactions } = realEditor([{ id: "text", type: "paragraph", content: "原文" }]);
  cursor(editor, "text", 1);
  const original = editor.prosemirrorState.doc;
  editor.transact((transaction) => transaction.insertText("前"));
  const beforeConversion = editor.prosemirrorState.doc;
  const selection = logicalEndpoints(editor);
  transactions.length = 0;
  assert.deepEqual(convertEditorBlocks(editor, ["text"], "heading-2"), { ok: true, changed: true });
  const converted = editor.prosemirrorState.doc;
  assert.equal(undoDepth(editor.prosemirrorState), 2);
  assert.equal(transactions.filter((transaction) => transaction.docChanged).length, 1);
  assert.equal(transactions.filter((transaction) => !transaction.docChanged && transaction.getMeta("addToHistory") === false).length, 1);
  editor.transact((transaction) => transaction.insertText("后"));
  const afterTyping = editor.prosemirrorState.doc;
  assert.equal(undoDepth(editor.prosemirrorState), 3);
  applyHistory(editor, undo);
  assert.ok(editor.prosemirrorState.doc.eq(converted));
  assert.deepEqual(logicalEndpoints(editor), selection);
  applyHistory(editor, undo);
  assert.ok(editor.prosemirrorState.doc.eq(beforeConversion));
  applyHistory(editor, undo);
  assert.ok(editor.prosemirrorState.doc.eq(original));
  assert.equal(redoDepth(editor.prosemirrorState), 3);
  applyHistory(editor, redo);
  applyHistory(editor, redo);
  applyHistory(editor, redo);
  assert.ok(editor.prosemirrorState.doc.eq(afterTyping));
});

test("backward text selections across columns retain endpoints and native undo redo selection", () => {
  const { editor } = realEditor(nestedFixture());
  editor.transact((transaction) => transaction.setSelection(TextSelection.create(transaction.doc, findNativeBlock(transaction.doc, "right-text").textStart + 2, findNativeBlock(transaction.doc, "rich-parent").textStart + 1)));
  const before = editor.prosemirrorState.doc;
  const selection = logicalEndpoints(editor);
  assert.ok(editor.prosemirrorState.selection.anchor > editor.prosemirrorState.selection.head);
  assert.equal(convertEditorBlocks(editor, ["rich-parent", "right-text"], "heading-1").ok, true);
  assert.deepEqual(logicalEndpoints(editor), selection);
  applyHistory(editor, undo);
  assert.ok(editor.prosemirrorState.doc.eq(before));
  assert.deepEqual(logicalEndpoints(editor), selection);
  applyHistory(editor, redo);
  assert.deepEqual(logicalEndpoints(editor), selection);
});

test("native node selections preserve the selected block or its content node", () => {
  for (const selectedPart of ["position", "contentPosition"]) {
    const { editor } = realEditor(nestedFixture());
    editor.transact((transaction) => transaction.setSelection(NodeSelection.create(transaction.doc, findNativeBlock(transaction.doc, "rich-parent")[selectedPart])));
    const selection = logicalEndpoints(editor);
    assert.equal(convertEditorBlocks(editor, ["rich-parent"], "heading-1").ok, true);
    assert.ok(editor.prosemirrorState.selection instanceof NodeSelection);
    assert.deepEqual(logicalEndpoints(editor), selection);
    applyHistory(editor, undo);
    assert.ok(editor.prosemirrorState.selection instanceof NodeSelection);
    assert.deepEqual(logicalEndpoints(editor), selection);
    applyHistory(editor, redo);
    assert.ok(editor.prosemirrorState.selection instanceof NodeSelection);
    assert.deepEqual(logicalEndpoints(editor), selection);
  }
});

test("locked and composing editors reject commands before DOM flush or mutations", () => {
  const { editor: native } = realEditor([{ id: "text", type: "paragraph", content: "原文" }]);
  for (const mode of ["locked", "composing", "destroyed"]) {
    let flushes = 0;
    const { editor, view, transactions } = memoryEditor(native.prosemirrorState, { domObserver: { flush() { flushes += 1; } } });
    if (mode === "locked") editor.isEditable = false;
    if (mode === "composing") view.composing = true;
    if (mode === "destroyed") view.isDestroyed = true;
    let callbacks = 0;
    const result = runEditorTransaction(editor, "guard", () => { callbacks += 1; });
    assert.equal(result.reason, mode === "destroyed" ? "unavailable" : mode);
    assert.equal(callbacks, 0);
    assert.equal(flushes, 0);
    assert.equal(transactions.length, 0);
    assert.ok(getBlockConversionOptions(editor, ["text"]).every((target) => target.disabled));
  }
});

test("safe pending DOM text is flushed before command and stale document plans reject", () => {
  const { editor: native } = realEditor([{ id: "text", type: "paragraph", content: "原文" }]);
  const { editor, view, transactions } = memoryEditor(native.prosemirrorState);
  const initialDocument = view.state.doc;
  view.domObserver = { flush() { view.dispatch(view.state.tr.insertText("待提交", findNativeBlock(view.state.doc, "text").textStart)); } };
  let callbacks = 0;
  const stale = runEditorTransaction(editor, "stale", () => { callbacks += 1; }, { expectedDocument: initialDocument });
  assert.equal(stale.reason, "stale");
  assert.equal(callbacks, 0);
  assert.equal(view.state.doc.textContent, "待提交原文");
  assert.equal(transactions.filter((transaction) => transaction.docChanged).length, 1);
  view.domObserver = { flush() { view.composing = true; } };
  assert.equal(runEditorTransaction(editor, "ime", () => { callbacks += 1; }).reason, "composing");
  assert.equal(callbacks, 0);
});

test("callback failure rolls back native changes and never creates undo or metadata dispatches", () => {
  const { editor, transactions } = realEditor([{ id: "text", type: "paragraph", content: "原文" }]);
  const before = editor.prosemirrorState.doc;
  const result = runEditorTransaction(editor, "rollback", (transaction) => {
    editor.updateBlock("text", { type: "heading", props: { level: 2 } });
    transaction.insertText("不能保存", findNativeBlock(transaction.doc, "text").textStart);
    throw new Error("intentional abort");
  });
  assert.equal(result.ok, false);
  assert.equal(result.changed, false);
  assert.equal(editor.prosemirrorState.doc === before, true);
  assert.equal(undoDepth(editor.prosemirrorState), 0);
  assert.equal(transactions.length, 0);
  assert.equal(convertEditorBlocks(editor, ["text"], "quote").ok, true);
});

test("metadata-only and equivalent-document callbacks are no-ops", () => {
  const { editor, transactions } = realEditor([{ id: "text", type: "paragraph", content: "原文" }]);
  assert.deepEqual(runEditorTransaction(editor, "metadata", (transaction) => transaction.setMeta("transient", true)), { ok: true, changed: false });
  assert.deepEqual(runEditorTransaction(editor, "equivalent", (transaction) => transaction.replaceWith(0, transaction.doc.content.size, transaction.doc.content)), { ok: true, changed: false });
  assert.equal(transactions.length, 0);
  assert.equal(undoDepth(editor.prosemirrorState), 0);
});

test("lossy common properties disable a target whose live schema cannot represent them", () => {
  const { editor, transactions } = realEditor([{ id: "text", type: "paragraph", props: { backgroundColor: "blue" }, content: "原文" }], makeSchema({ commonCalloutProps: false }));
  const options = getBlockConversionOptions(editor, ["text"]);
  const callout = options.find((target) => target.id === "callout");
  assert.equal(callout.disabled, true);
  assert.match(callout.reason, /背景颜色/);
  assert.equal(convertEditorBlocks(editor, ["text"], "callout").reason, "lossy-conversion");
  assert.equal(transactions.length, 0);
  const quoteFixture = realEditor([{ id: "text", type: "paragraph", props: { textAlignment: "center" }, content: "原文" }]);
  const quote = getBlockConversionOptions(quoteFixture.editor, ["text"]).find((target) => target.id === "quote");
  assert.equal(quote.disabled, true);
  assert.match(quote.reason, /对齐方式/);
  assert.equal(convertEditorBlocks(quoteFixture.editor, ["text"], "quote").reason, "lossy-conversion");
  assert.equal(quoteFixture.transactions.length, 0);
});

test("logical selection restoration preserves a moved subtree caret and rejects a deleted endpoint", () => {
  const { editor } = realEditor(nestedFixture());
  cursor(editor, "nested-child", 2);
  const bookmark = captureEditorSelection(editor);
  const transaction = editor.prosemirrorState.tr;
  const moved = findNativeBlock(transaction.doc, "rich-parent");
  transaction.delete(moved.position, moved.endPosition);
  const after = findNativeBlock(transaction.doc, "root-after");
  transaction.insert(after.position, moved.node);
  assert.equal(restoreEditorSelection(transaction, bookmark), true);
  assert.equal(captureEditorSelection({ prosemirrorView: { state: { doc: transaction.doc, selection: transaction.selection, storedMarks: null }, isDestroyed: false }, headless: true }).anchor.blockId, "nested-child");
  const deleted = editor.prosemirrorState.tr;
  const child = findNativeBlock(deleted.doc, "nested-child");
  deleted.delete(child.position, child.endPosition);
  const automatic = deleted.selection;
  assert.equal(restoreEditorSelection(deleted, bookmark), false);
  assert.equal(deleted.selection === automatic, true);
});

class NativeBlockRangeSelection extends Selection {
  constructor(anchor, head) {
    super(anchor, head);
    this.nodes = [];
    anchor.doc.nodesBetween(this.from, this.to, (node, position, parent) => {
      if (parent === anchor.parent) { this.nodes.push(node); return false; }
      return undefined;
    });
  }
  static create(documentNode, anchor, head) {
    return new NativeBlockRangeSelection(documentNode.resolve(anchor), documentNode.resolve(head));
  }
  eq(other) {
    return other instanceof NativeBlockRangeSelection && other.anchor === this.anchor && other.head === this.head && other.nodes.length === this.nodes.length && other.nodes.every((node, index) => node.eq(this.nodes[index]));
  }
  map(documentNode, mapping) {
    return NativeBlockRangeSelection.create(documentNode, mapping.map(this.anchor, 1), mapping.map(this.head, -1));
  }
  content() {
    return new Slice(Fragment.from(this.nodes), 0, 0);
  }
  toJSON() {
    return { type: "test-native-block-range", anchor: this.anchor, head: this.head };
  }
  getBookmark() {
    const rangeBookmark = (anchor, head) => ({
      map(mapping) { return rangeBookmark(mapping.map(anchor, 1), mapping.map(head, -1)); },
      resolve(documentNode) { return NativeBlockRangeSelection.create(documentNode, anchor, head); },
    });
    return rangeBookmark(this.anchor, this.head);
  }
}

test("native block range selections restore the same class and complete selected group", () => {
  const { editor } = realEditor([{ id: "first", type: "paragraph", content: "第一项" }, { id: "second", type: "paragraph", content: "第二项" }]);
  editor.transact((transaction) => transaction.setSelection(NativeBlockRangeSelection.create(transaction.doc, findNativeBlock(transaction.doc, "first").position, findNativeBlock(transaction.doc, "second").endPosition)));
  const bookmark = captureEditorSelection(editor);
  assert.equal(bookmark.kind, "blocks");
  assert.deepEqual(bookmark.blockIds, ["first", "second"]);
  assert.equal(convertEditorBlocks(editor, ["first", "second"], "quote").ok, true);
  assert.ok(editor.prosemirrorState.selection instanceof NativeBlockRangeSelection);
  assert.deepEqual(editor.prosemirrorState.selection.nodes.map((node) => node.attrs.id), ["first", "second"]);
  applyHistory(editor, undo);
  assert.ok(editor.prosemirrorState.selection instanceof NativeBlockRangeSelection);
  applyHistory(editor, redo);
  assert.ok(editor.prosemirrorState.selection instanceof NativeBlockRangeSelection);
});

test("all-document selection and stored caret formatting survive compatible commands", () => {
  const { editor } = realEditor([{ id: "text", type: "paragraph", content: "原文" }]);
  editor.transact((transaction) => transaction.setSelection(new AllSelection(transaction.doc)));
  assert.equal(convertEditorBlocks(editor, ["text"], "quote").ok, true);
  assert.ok(editor.prosemirrorState.selection instanceof AllSelection);
  cursor(editor, "text", 1);
  const bold = editor.prosemirrorState.schema.marks.bold.create();
  editor.transact((transaction) => transaction.setStoredMarks([bold]));
  assert.equal(convertEditorBlocks(editor, ["text"], "heading-1").ok, true);
  assert.equal(editor.prosemirrorState.storedMarks?.length, 1);
  assert.equal(editor.prosemirrorState.storedMarks[0].eq(bold), true);
});

test("maintenance transactions can opt out of history without turning no-ops into events", () => {
  const { editor } = realEditor([{ id: "text", type: "paragraph", content: "原文" }]);
  assert.equal(runEditorTransaction(editor, "maintenance", (transaction) => transaction.insertText("补", findNativeBlock(transaction.doc, "text").textStart), { addToHistory: false }).ok, true);
  assert.equal(undoDepth(editor.prosemirrorState), 0);
  assert.equal(convertEditorBlocks(editor, ["text"], "quote").ok, true);
  assert.equal(undoDepth(editor.prosemirrorState), 1);
});
