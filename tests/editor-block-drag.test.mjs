import test from "node:test";
import assert from "node:assert/strict";
import { BlockNoteEditor, BlockNoteSchema, createBlockSpec, defaultBlockSpecs, nodeToBlock, UniqueID } from "@blocknote/core";
import { Slice } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { history, redo, redoDepth, undo, undoDepth } from "@tiptap/pm/history";
import { BlockInteractionsExtension, createBlockInteractionsPlugin } from "../src/editor/BlockInteractionsExtension.js";
import {
  BLOCK_DRAG_MIME,
  applyNativeBlockPlan,
  assertNativeBlockLayout,
  beginEditorBlockDrag,
  cancelEditorBlockDrag,
  findEnclosingColumnContext,
  getEditorBlockInteractionState,
  handleEditorBlockDrop,
  mountEditorBlockDrag,
  moveEditorColumnLayout,
  normalizeNativeLayoutIds,
  planNativeBlockDrop,
  removeEditorBlocks,
  removeEditorColumn,
  removeEditorColumnLayout,
  resolveEditorBlockDrop,
  unwrapEditorColumnLayout,
  updateEditorBlockDrag,
} from "../src/editor/blockDrag.js";
import { captureEditorSelection, findNativeBlock, runEditorTransaction } from "../src/editor/editorTransactions.js";

const headlessRender = () => { throw new Error("This native schema test never renders a DOM node"); };
const schema = BlockNoteSchema.create({ blockSpecs: {
  ...defaultBlockSpecs,
  column: createBlockSpec({ type: "column", content: "none", propSchema: { width: { default: 50 }, index: { default: 0 }, count: { default: 2 } } }, { render: headlessRender })(),
  columnList: createBlockSpec({ type: "columnList", content: "none", propSchema: { columns: { default: 2, values: [2, 3, 4, 5] } } }, { render: headlessRender })(),
} });

function paragraph(id, text = id, children = []) {
  return { id, type: "paragraph", content: text, children };
}

function column(id, children, index = 0, count = 2, width = 50) {
  return { id, type: "column", props: { width, index, count }, children };
}

function layout(id, columns) {
  return { id, type: "columnList", props: { columns: columns.length }, children: columns.map((entry, index) => ({ ...entry, props: { ...entry.props, index, count: columns.length } })) };
}

function richBlock() {
  return paragraph("rich", [
    { type: "text", text: "Bold text ", styles: { bold: true } },
    { type: "link", href: "lifeatlas://page/example#block-child", content: [{ type: "text", text: "italic link", styles: { italic: true } }] },
  ], [paragraph("rich-child", "nested child")]);
}

function documentFixture() {
  return [paragraph("root-before"), layout("layout", [
    column("left", [richBlock(), paragraph("left-tail")], 0, 3, 33.333333),
    column("middle", [paragraph("middle-first"), paragraph("middle-last")], 1, 3, 44.444444),
    column("right", [paragraph("right-only")], 2, 3, 22.222223),
  ]), paragraph("root-after")];
}

function canonical(doc, engine) {
  return Array.from(doc.firstChild.content.content, (node) => nodeToBlock(node, engine.schema.blockSchema, engine.schema.inlineContentSchema, engine.schema.styleSchema));
}

function element(rect = {}, parentElement = null, id = null, editorRoot = false) {
  const callbacks = new Map();
  const result = {
    nodeType: 1,
    parentElement,
    dataset: id ? { id } : {},
    style: {},
    children: [],
    editorRoot,
    callbacks,
    appendChild(child) { child.parentElement = this; this.children.push(child); return child; },
    remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((child) => child !== this); this.parentElement = null; },
    setAttribute(name, value) { this[name] = value; },
    classList: { contains: (name) => name === "bn-block-outer" && Boolean(id) },
    getBoundingClientRect: () => ({ left: 100, right: 500, top: 100, bottom: 140, width: 400, height: 40, ...rect }),
    closest(selector) {
      if (selector === ".bn-editor") return this.editorRoot ? this : this.parentElement?.closest(selector) ?? null;
      if (selector === ".bn-block-outer[data-id]") return this.dataset.id ? this : this.parentElement?.closest(selector) ?? null;
      return null;
    },
    querySelector() { return this; },
    querySelectorAll() { return this.blocks ?? []; },
    addEventListener(type, callback) {
      if (!callbacks.has(type)) callbacks.set(type, new Set());
      callbacks.get(type).add(callback);
    },
    removeEventListener(type, callback) { callbacks.get(type)?.delete(callback); },
    emit(type, event) { for (const callback of Array.from(callbacks.get(type) ?? [])) callback(event); },
  };
  return result;
}

function fixture(blocks = documentFixture()) {
  const engine = BlockNoteEditor.create({ schema, initialContent: blocks });
  const rawDocument = engine.prosemirrorState.doc;
  const initialState = EditorState.create({ doc: rawDocument });
  const setup = initialState.tr;
  normalizeNativeLayoutIds(setup);
  const dom = element({ left: 80, right: 740, width: 660, top: 40, bottom: 800, height: 760 }, null, null, true);
  const root = element();
  const windowObject = element();
  dom.ownerDocument = root;
  root.defaultView = windowObject;
  root.body = element();
  root.createElement = () => element();
  let hit = dom;
  root.elementsFromPoint = () => [hit];
  const view = {
    dom, root, isDestroyed: false, composing: false, dragging: null,
    state: EditorState.create({ doc: setup.doc, plugins: [history()] }),
    transactions: [],
    focused: true,
    hasFocus() { return this.focused; },
    focus() { this.focused = true; },
    domObserver: { flush() {} },
    dispatch(transaction) {
      const applied = this.state.applyTransaction(transaction);
      this.state = applied.state;
      this.transactions.push(...applied.transactions);
    },
    nodeDOM(position) { return dom.blocks?.find((block) => findNativeBlock(this.state.doc, block.dataset.id)?.position === position) ?? null; },
    someProp(name, callback) {
      for (const plugin of this.state.plugins) {
        if (plugin.props[name]) {
          const result = callback(plugin.props[name]);
          if (result) return result;
        }
      }
      return undefined;
    },
  };
  const editor = {
    isEditable: true,
    prosemirrorView: view,
    get prosemirrorState() { return view.state; },
    focus: () => view.focus(),
    transact(callback) {
      const transaction = view.state.tr;
      const result = callback(transaction);
      view.dispatch(transaction);
      return result;
    },
  };
  const plugin = createBlockInteractionsPlugin(editor);
  const uniqueExtension = UniqueID.configure({ types: ["blockContainer", "column", "columnList"] });
  const uniqueID = uniqueExtension.config.addProseMirrorPlugins.call(uniqueExtension)[0];
  view.state = view.state.reconfigure({ plugins: [uniqueID, plugin, history()] });
  const rebuildGeometry = () => {
    const ancestors = new Map();
    dom.blocks = [];
    view.state.doc.descendants((node) => {
      if (node.type.name !== "blockContainer") return;
      const id = node.attrs.id;
      const geometry = {
        left: { left: 100, right: 280, width: 180, top: 160, bottom: 400, height: 240 },
        middle: { left: 300, right: 500, width: 200, top: 160, bottom: 400, height: 240 },
        right: { left: 520, right: 720, width: 200, top: 160, bottom: 400, height: 240 },
        layout: { left: 100, right: 720, width: 620, top: 150, bottom: 410, height: 260 },
        rich: { left: 116, right: 264, width: 148, top: 170, bottom: 250, height: 80 },
        "rich-child": { left: 130, right: 264, width: 134, top: 210, bottom: 245, height: 35 },
        "middle-first": { left: 316, right: 484, width: 168, top: 170, bottom: 210, height: 40 },
        "middle-last": { left: 316, right: 484, width: 168, top: 230, bottom: 270, height: 40 },
      }[id] ?? {};
      const found = findNativeBlock(view.state.doc, id);
      let parent = dom;
      const resolved = view.state.doc.resolve(found.position);
      for (let depth = resolved.depth; depth > 0; depth -= 1) {
        if (resolved.node(depth).type.name === "blockContainer") { parent = ancestors.get(resolved.node(depth).attrs.id) ?? dom; break; }
      }
      const outer = element(geometry, parent, id);
      ancestors.set(id, outer);
      dom.blocks.push(outer);
    });
  };
  rebuildGeometry();
  return { editor, engine, view, plugin, dom, root, windowObject, setHit: (id) => { hit = typeof id === "string" ? dom.blocks.find((block) => block.dataset.id === id) : id; }, rebuildGeometry };
}

function transfer() {
  const data = new Map();
  return { types: [], effectAllowed: "none", dropEffect: "none", setData(type, value) { data.set(type, value); this.types = Array.from(data.keys()); }, getData: (type) => data.get(type) ?? "", setDragImage() {} };
}

function dragEvent(target, dataTransfer = transfer(), point = { x: 400, y: 175 }) {
  return { target, dataTransfer, clientX: point.x, clientY: point.y, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; } };
}

function select(editor, id, offset = 1, headOffset = offset) {
  const block = findNativeBlock(editor.prosemirrorState.doc, id);
  editor.prosemirrorView.dispatch(editor.prosemirrorState.tr.setSelection(TextSelection.create(editor.prosemirrorState.doc, block.textStart + offset, block.textStart + headOffset)));
}

function commitPlan(editor, plan) {
  return runEditorTransaction(editor, "test-block-move", (transaction) => applyNativeBlockPlan(transaction, plan), { expectedDocument: editor.prosemirrorState.doc, focus: false });
}

function nativeUndo(view) {
  assert.equal(undo(view.state, (transaction) => view.dispatch(transaction)), true);
}

function nativeRedo(view) {
  assert.equal(redo(view.state, (transaction) => view.dispatch(transaction)), true);
}

test("native rich subtree cross-column move preserves canonical content and one undo redo", () => {
  const { editor, engine, view } = fixture();
  select(editor, "rich", 2, 12);
  const originalSelection = captureEditorSelection(editor);
  const before = view.state.doc.toJSON();
  const canonicalBefore = canonical(view.state.doc, engine);
  const rich = findNativeBlock(view.state.doc, "rich").node;
  const plan = planNativeBlockDrop(view.state.doc, ["rich"], { kind: "content", targetId: "middle-last", placement: "before" });
  const start = view.transactions.length;
  assert.deepEqual(commitPlan(editor, plan), { ok: true, changed: true });
  const after = view.state.doc.toJSON();
  const canonicalAfter = canonical(view.state.doc, engine);
  assert.ok(findNativeBlock(view.state.doc, "rich").node.eq(rich));
  assert.deepEqual(canonicalAfter[1].children[1].children.map((entry) => entry.id), ["middle-first", "rich", "middle-last"]);
  const selection = captureEditorSelection(editor);
  assert.deepEqual(selection.anchor, originalSelection.anchor);
  assert.deepEqual(selection.head, originalSelection.head);
  assert.equal(view.transactions.slice(start).filter((entry) => entry.docChanged).length, 1);
  assert.equal(undoDepth(view.state), 1);
  nativeUndo(view);
  assert.deepEqual(view.state.doc.toJSON(), before);
  assert.deepEqual(canonical(view.state.doc, engine), canonicalBefore);
  nativeRedo(view);
  assert.deepEqual(view.state.doc.toJSON(), after);
  assert.deepEqual(canonical(view.state.doc, engine), canonicalAfter);
});

test("same-column and root reorder keep complete native nodes and original identities", () => {
  const { editor, view } = fixture();
  select(editor, "rich", 3);
  const rich = findNativeBlock(view.state.doc, "rich").node;
  assert.equal(commitPlan(editor, planNativeBlockDrop(view.state.doc, ["rich"], { kind: "content", targetId: "left-tail", placement: "after" })).ok, true);
  assert.ok(findNativeBlock(view.state.doc, "rich").node.eq(rich));
  assert.equal(commitPlan(editor, planNativeBlockDrop(view.state.doc, ["rich"], { kind: "content", targetId: "root-after", placement: "after" })).ok, true);
  assert.equal(view.state.doc.firstChild.lastChild.attrs.id, "rich");
  assert.ok(findNativeBlock(view.state.doc, "rich").node.eq(rich));
  assert.equal(undoDepth(view.state), 2);
  const noop = planNativeBlockDrop(view.state.doc, ["rich"], { kind: "content", targetId: "root-after", placement: "after" });
  const dispatchCount = view.transactions.length;
  assert.equal(commitPlan(editor, noop).changed, false);
  assert.equal(view.transactions.length, dispatchCount);
});

test("moving the final child removes empty column and dissolves one-column layout atomically", () => {
  const blocks = [layout("two", [column("source-column", [richBlock()]), column("target-column", [paragraph("target"), paragraph("empty", "")])]), paragraph("tail")];
  const { editor, engine, view } = fixture(blocks);
  select(editor, "rich", 2);
  const before = view.state.doc.toJSON();
  const rich = findNativeBlock(view.state.doc, "rich").node;
  const plan = planNativeBlockDrop(view.state.doc, ["rich"], { kind: "content", targetId: "target", placement: "after" });
  assert.equal(commitPlan(editor, plan).ok, true);
  assert.deepEqual(canonical(view.state.doc, engine).map((entry) => entry.id), ["target", "rich", "empty", "tail"]);
  assert.ok(findNativeBlock(view.state.doc, "rich").node.eq(rich));
  assert.equal(findNativeBlock(view.state.doc, "two") === null, true);
  assert.equal(undoDepth(view.state), 1);
  const after = view.state.doc.toJSON();
  nativeUndo(view);
  assert.deepEqual(view.state.doc.toJSON(), before);
  nativeRedo(view);
  assert.deepEqual(view.state.doc.toJSON(), after);
});

test("edge column splits weight and repairs indexes with collision safe identities", () => {
  const { editor, engine, view } = fixture();
  select(editor, "rich", 2);
  const before = view.state.doc.toJSON();
  let sequence = 0;
  const plan = planNativeBlockDrop(view.state.doc, ["rich"], { kind: "edge-column", targetId: "middle", placement: "before" }, { idFactory: () => sequence++ === 0 ? "rich" : `new-column-${sequence}` });
  assert.equal(commitPlan(editor, plan).ok, true);
  const columns = canonical(view.state.doc, engine)[1].children;
  assert.equal(columns.length, 4);
  assert.equal(columns[1].children[0].id, "rich");
  assert.equal(columns[1].props.width, 22.222222);
  assert.equal(columns[2].props.width, 22.222222);
  assert.deepEqual(columns.map((entry) => entry.props.index), [0, 1, 2, 3]);
  assert.ok(columns.every((entry) => entry.props.count === 4));
  const nativeIds = [];
  view.state.doc.descendants((node) => { if (node.attrs.id) nativeIds.push(node.attrs.id); });
  assert.equal(new Set(nativeIds).size, nativeIds.length);
  const after = view.state.doc.toJSON();
  nativeUndo(view);
  assert.deepEqual(view.state.doc.toJSON(), before);
  nativeRedo(view);
  assert.deepEqual(view.state.doc.toJSON(), after);
});

test("five-column layout rejects sixth column but permits final-child edge relocation", () => {
  const blocks = [layout("five", Array.from({ length: 5 }, (_, index) => column(`column-${index}`, [paragraph(`text-${index}`)], index, 5))), paragraph("outside")];
  const { view } = fixture(blocks);
  assert.throws(() => planNativeBlockDrop(view.state.doc, ["outside"], { kind: "edge-column", targetId: "column-1", placement: "after" }), (error) => error.reason === "maximum-columns");
  const plan = planNativeBlockDrop(view.state.doc, ["text-0"], { kind: "edge-column", targetId: "column-1", placement: "after" }, { idFactory: () => "relocated-column" });
  assertNativeBlockLayout(plan.doc);
  assert.equal(findNativeBlock(plan.doc, "five").node.child(1).childCount, 5);
  assert.equal(findNativeBlock(plan.doc, "column-0") === null, true);
  assert.equal(findNativeBlock(plan.doc, "relocated-column").node.child(1).firstChild.attrs.id, "text-0");
});

test("root edge creates two real columns and never places content directly under layout", () => {
  const { editor, engine, view } = fixture([richBlock(), paragraph("target"), paragraph("tail")]);
  select(editor, "rich", 1);
  let sequence = 0;
  const plan = planNativeBlockDrop(view.state.doc, ["rich"], { kind: "wrap-columns", targetId: "target", placement: "after" }, { idFactory: () => `created-${sequence += 1}` });
  assert.equal(commitPlan(editor, plan).ok, true);
  const blocks = canonical(view.state.doc, engine);
  assert.equal(blocks[0].type, "columnList");
  assert.deepEqual(blocks[0].children.map((entry) => entry.type), ["column", "column"]);
  assert.deepEqual(blocks[0].children.flatMap((entry) => entry.children.map((child) => child.id)), ["target", "rich"]);
  assert.equal(undoDepth(view.state), 1);
});

test("non-text image table and code subtree moves preserve every native attribute and mark", () => {
  const blocks = [
    { id: "image", type: "image", props: { url: "life-asset://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", name: "local.png", caption: "caption", previewWidth: 123 } },
    { id: "table", type: "table", content: { type: "tableContent", columnWidths: [130, 190], headerRows: 1, rows: [{ cells: ["first", "second"] }, { cells: ["third", "fourth"] }] } },
    { id: "code", type: "codeBlock", props: { language: "javascript" }, content: "const preserved = 1;\n" },
    paragraph("target"),
  ];
  const { editor, view } = fixture(blocks);
  select(editor, "target", 1);
  const preserved = ["image", "table", "code"].map((id) => findNativeBlock(view.state.doc, id).node.toJSON());
  const plan = planNativeBlockDrop(view.state.doc, ["code", "image", "table"], { kind: "content", targetId: "target", placement: "after" });
  assert.equal(commitPlan(editor, plan).ok, true);
  assert.deepEqual(view.state.doc.firstChild.content.content.map((node) => node.attrs.id), ["target", "image", "table", "code"]);
  assert.deepEqual(["image", "table", "code"].map((id) => findNativeBlock(view.state.doc, id).node.toJSON()), preserved);
  assert.equal(undoDepth(view.state), 1);
});

test("self descendant duplicate and stale native sources reject before mutation", () => {
  const { view } = fixture();
  const before = view.state.doc.toJSON();
  const cases = [
    [["rich"], { kind: "content", targetId: "rich", placement: "after" }, "self-target"],
    [["rich"], { kind: "content", targetId: "rich-child", placement: "after" }, "self-target"],
    [["rich", "rich"], { kind: "content", targetId: "middle-first", placement: "after" }, "duplicate-source"],
    [["missing"], { kind: "content", targetId: "middle-first", placement: "after" }, "stale-source"],
    [["rich"], { kind: "content", targetId: "missing", placement: "after" }, "stale-target"],
    [["rich"], { kind: "content", targetId: "middle", placement: "after" }, "structural-target"],
    [["left"], { kind: "content", targetId: "root-before", placement: "after" }, "structural-source"],
  ];
  for (const [ids, target, reason] of cases) assert.throws(() => planNativeBlockDrop(view.state.doc, ids, target), (error) => error.reason === reason);
  assert.deepEqual(view.state.doc.toJSON(), before);
  assert.equal(undoDepth(view.state), 0);
});

test("native layout ID initialization is canonical-neutral deterministic and stable across undo", () => {
  const blocks = [paragraph("life-atlas-layout:column:left"), layout("layout", [column("left", [paragraph("first")]), column("right", [paragraph("second")])])];
  const engine = BlockNoteEditor.create({ schema, initialContent: blocks });
  const rawDocument = engine.prosemirrorState.doc;
  const original = canonical(rawDocument, engine);
  let state = EditorState.create({ doc: rawDocument, plugins: [history()] });
  const setup = state.tr.setMeta("addToHistory", false);
  assert.equal(normalizeNativeLayoutIds(setup), 3);
  state = state.apply(setup);
  assert.deepEqual(canonical(state.doc, engine), original);
  assert.equal(undoDepth(state), 0);
  assert.equal(findNativeBlock(state.doc, "left").node.firstChild.attrs.id, "life-atlas-layout:column:left:1");
  assert.equal(normalizeNativeLayoutIds(state.tr), 0);
  const second = EditorState.create({ doc: rawDocument });
  const secondSetup = second.tr;
  normalizeNativeLayoutIds(secondSetup);
  assert.deepEqual(secondSetup.doc.toJSON(), state.doc.toJSON());
});

test("new column defaults normalize in incoming transaction before real UniqueID append", () => {
  const { editor, engine, view } = fixture([paragraph("before"), paragraph("after")]);
  select(editor, "before", 1);
  const initial = view.state.doc.toJSON();
  const freshEngine = BlockNoteEditor.create({ schema, initialContent: [layout("fresh-list", [column("fresh-left", [paragraph("fresh-first")]), column("fresh-right", [paragraph("fresh-second")])])] });
  const nativeLayout = view.state.schema.nodeFromJSON(freshEngine.prosemirrorState.doc.firstChild.firstChild.toJSON());
  assert.equal(nativeLayout.type === view.state.schema.nodes.blockContainer, true, "Incoming layout must use the owning editor schema");
  const result = runEditorTransaction(editor, "insert-layout", (transaction) => { transaction.insert(findNativeBlock(transaction.doc, "after").position, nativeLayout); }, { focus: false });
  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.equal(Boolean(findNativeBlock(view.state.doc, "fresh-list")), true, "Fresh layout must remain after insertion");
  assert.equal(findNativeBlock(view.state.doc, "fresh-list").node.firstChild.attrs.id, "life-atlas-layout:columnList:fresh-list");
  const after = view.state.doc.toJSON();
  assert.equal(undoDepth(view.state), 1);
  nativeUndo(view);
  assert.deepEqual(view.state.doc.toJSON(), initial);
  nativeRedo(view);
  assert.deepEqual(view.state.doc.toJSON(), after);
  assert.equal(canonical(view.state.doc, engine).find((block) => block.id === "fresh-list").children.length, 2);
});

test("atomic delete shares last-child cleanup and preserves surviving caret", () => {
  const { editor, engine, view } = fixture([layout("two", [column("left", [richBlock()]), column("right", [paragraph("target"), paragraph("empty", "")])]), paragraph("tail")]);
  select(editor, "target", 2);
  const bookmark = captureEditorSelection(editor);
  const before = view.state.doc.toJSON();
  assert.deepEqual(removeEditorBlocks(editor, ["rich"]), { ok: true, changed: true });
  assert.deepEqual(canonical(view.state.doc, engine).map((block) => block.id), ["target", "empty", "tail"]);
  assert.deepEqual(captureEditorSelection(editor).anchor, bookmark.anchor);
  assert.equal(undoDepth(view.state), 1);
  nativeUndo(view);
  assert.deepEqual(view.state.doc.toJSON(), before);
});

test("deleting selection retains one valid native empty paragraph and one history event", () => {
  const { editor, engine, view } = fixture([richBlock()]);
  select(editor, "rich", 2);
  const before = view.state.doc.toJSON();
  assert.equal(removeEditorBlocks(editor, ["rich"], { idFactory: () => "remaining-empty" }).ok, true);
  assert.deepEqual(canonical(view.state.doc, engine).map((block) => [block.id, block.type, block.content.length]), [["remaining-empty", "paragraph", 0]]);
  assert.equal(view.state.selection.$head.parent.inlineContent, true);
  assert.equal(undoDepth(view.state), 1);
  nativeUndo(view);
  assert.deepEqual(view.state.doc.toJSON(), before);
});

test("private native drop uses same preview resolver and consumes browser insertion", () => {
  const context = fixture();
  const { editor, view, dom } = context;
  select(editor, "rich", 2, 10);
  const event = dragEvent(dom);
  assert.equal(beginEditorBlockDrag(editor, event, ["rich"]).ok, true);
  assert.equal(event.dataTransfer.effectAllowed, "move");
  context.setHit("middle-first");
  const preview = resolveEditorBlockDrop(editor, { x: 400, y: 175 });
  assert.equal(preview.ok, true);
  const before = view.state.doc.toJSON();
  const drop = dragEvent(dom.blocks.find((block) => block.dataset.id === "middle-first"), event.dataTransfer);
  assert.equal(context.plugin.props.handleDrop(view, drop, Slice.empty, false), true);
  assert.equal(drop.defaultPrevented, true);
  assert.equal(findNativeBlock(view.state.doc, "middle").node.child(1).firstChild.attrs.id, "rich");
  assert.equal(undoDepth(view.state), 1);
  assert.equal(getEditorBlockInteractionState(editor).dragging, false);
  nativeUndo(view);
  assert.deepEqual(view.state.doc.toJSON(), before);
});

test("native dragstart pointercancel dragover drop preserves the move and one undo redo", () => {
  const context = fixture();
  const { editor, engine, view, dom, root } = context;
  select(editor, "rich", 2, 10);
  const originalDocument = view.state.doc;
  const originalRich = findNativeBlock(originalDocument, "rich").node.toJSON();
  const originalCanonical = canonical(originalDocument, engine);
  const sourceBlock = dom.blocks.find((block) => block.dataset.id === "rich");
  const handle = element({}, sourceBlock);
  const sourceContent = element({}, sourceBlock);
  const start = { ...dragEvent(handle), type: "dragstart" };
  const cleanup = mountEditorBlockDrag(editor, { dom, root });
  try {
    assert.equal(beginEditorBlockDrag(editor, start, ["rich"]).ok, true);
    const nativeDrag = view.dragging;
    root.emit("pointercancel", { type: "pointercancel", target: sourceContent, pointerId: 1, pointerType: "mouse" });
    assert.equal(getEditorBlockInteractionState(editor).dragging, true);
    assert.equal(view.dragging === nativeDrag, true);
    assert.equal(view.state.doc === originalDocument, true);
    context.setHit("middle-first");
    const target = dom.blocks.find((block) => block.dataset.id === "middle-first");
    const over = { ...dragEvent(target, start.dataTransfer), type: "dragover" };
    dom.emit("dragover", over);
    assert.equal(over.defaultPrevented, true);
    assert.equal(over.dataTransfer.dropEffect, "move");
    assert.equal(getEditorBlockInteractionState(editor).dropTarget.targetId, "middle-first");
    const drop = { ...dragEvent(target, start.dataTransfer), type: "drop" };
    dom.emit("drop", drop);
    assert.equal(drop.defaultPrevented, true);
    assert.equal(getEditorBlockInteractionState(editor).lastResult.ok, true);
    assert.equal(getEditorBlockInteractionState(editor).lastResult.changed, true);
    assert.equal(getEditorBlockInteractionState(editor).dragging, false);
    assert.equal(view.dragging === null, true);
    assert.equal(root.body.children.length, 0);
    assert.equal(findNativeBlock(view.state.doc, "middle").node.child(1).firstChild.attrs.id, "rich");
    assert.deepEqual(findNativeBlock(view.state.doc, "rich").node.toJSON(), originalRich);
    assert.equal(undoDepth(view.state), 1);
    const movedDocument = view.state.doc.toJSON();
    root.emit("dragend", { type: "dragend", target: handle });
    assert.deepEqual(view.state.doc.toJSON(), movedDocument);
    assert.equal(undoDepth(view.state), 1);
    nativeUndo(view);
    assert.deepEqual(view.state.doc.toJSON(), originalDocument.toJSON());
    assert.deepEqual(canonical(view.state.doc, engine), originalCanonical);
    assert.equal(undoDepth(view.state), 0);
    assert.equal(redoDepth(view.state), 1);
    nativeRedo(view);
    assert.deepEqual(view.state.doc.toJSON(), movedDocument);
    assert.deepEqual(findNativeBlock(view.state.doc, "rich").node.toJSON(), originalRich);
    assert.equal(undoDepth(view.state), 1);
    assert.equal(redoDepth(view.state), 0);
  } finally {
    cleanup();
  }
});

test("foreign editor private drop never deletes source or inserts destination data", () => {
  const source = fixture();
  const destination = fixture([paragraph("foreign")]);
  const event = dragEvent(source.dom);
  assert.equal(beginEditorBlockDrag(source.editor, event, ["rich"]).ok, true);
  const originalSource = source.view.state.doc.toJSON();
  const originalDestination = destination.view.state.doc.toJSON();
  destination.setHit("foreign");
  const drop = dragEvent(destination.dom, event.dataTransfer);
  assert.equal(handleEditorBlockDrop(destination.editor, drop), true);
  assert.equal(drop.defaultPrevented, true);
  assert.deepEqual(source.view.state.doc.toJSON(), originalSource);
  assert.deepEqual(destination.view.state.doc.toJSON(), originalDestination);
  assert.equal(undoDepth(source.view.state), 0);
  assert.equal(undoDepth(destination.view.state), 0);
  assert.equal(getEditorBlockInteractionState(source.editor).dragging, false);
});

test("selection metadata preserves drag while stale document lock and composition reject", () => {
  const context = fixture();
  const { editor, view, dom } = context;
  const event = dragEvent(dom);
  assert.equal(beginEditorBlockDrag(editor, event, ["rich"]).ok, true);
  view.dispatch(view.state.tr.setMeta("preview-only", true).setMeta("addToHistory", false));
  context.setHit("middle-first");
  assert.equal(resolveEditorBlockDrop(editor, { x: 400, y: 175 }).ok, true);
  view.dispatch(view.state.tr.insertText("edit", findNativeBlock(view.state.doc, "root-before").textStart));
  assert.equal(resolveEditorBlockDrop(editor, { x: 400, y: 175 }).reason, "stale-source");
  updateEditorBlockDrag(editor);
  assert.equal(getEditorBlockInteractionState(editor).dragging, false);
  editor.isEditable = false;
  assert.equal(beginEditorBlockDrag(editor, dragEvent(dom), ["rich"]).reason, "locked");
  editor.isEditable = true;
  view.composing = true;
  assert.equal(beginEditorBlockDrag(editor, dragEvent(dom), ["rich"]).reason, "composing");
  view.composing = false;
  assert.equal(beginEditorBlockDrag(editor, dragEvent(dom), ["rich"]).ok, true);
  view.composing = true;
  assert.equal(resolveEditorBlockDrop(editor, { x: 400, y: 175 }).reason, "composing");
  updateEditorBlockDrag(editor);
  assert.equal(getEditorBlockInteractionState(editor).dragging, false);
  assert.equal(redoDepth(view.state), 0);
});

test("owning DOM routes private drop and cleans Escape dragend blur pagehide lock and unmount", () => {
  const context = fixture();
  const { editor, view, dom, root, windowObject } = context;
  select(editor, "rich", 2);
  const cleanup = mountEditorBlockDrag(editor, { dom, root });
  const original = view.state.doc.toJSON();
  let start = dragEvent(dom);
  beginEditorBlockDrag(editor, start, ["rich"]);
  root.emit("keydown", { key: "Escape", preventDefault() {} });
  assert.equal(getEditorBlockInteractionState(editor).dragging, false);
  start = dragEvent(dom);
  beginEditorBlockDrag(editor, start, ["rich"]);
  root.emit("dragend", { target: dom });
  assert.equal(getEditorBlockInteractionState(editor).dragging, false);
  start = dragEvent(dom);
  beginEditorBlockDrag(editor, start, ["rich"]);
  windowObject.emit("blur", {});
  assert.equal(getEditorBlockInteractionState(editor).dragging, false);
  start = dragEvent(dom);
  beginEditorBlockDrag(editor, start, ["rich"]);
  windowObject.emit("pagehide", {});
  assert.equal(getEditorBlockInteractionState(editor).dragging, false);
  start = dragEvent(dom);
  beginEditorBlockDrag(editor, start, ["rich"]);
  editor.isEditable = false;
  updateEditorBlockDrag(editor);
  assert.equal(getEditorBlockInteractionState(editor).dragging, false);
  editor.isEditable = true;
  beginEditorBlockDrag(editor, dragEvent(dom), ["rich"]);
  cleanup();
  assert.equal(getEditorBlockInteractionState(editor).dragging, false);
  assert.equal(Array.from(dom.callbacks.values()).reduce((total, callbacks) => total + callbacks.size, 0), 0);
  assert.equal(Array.from(root.callbacks.values()).reduce((total, callbacks) => total + callbacks.size, 0), 0);
  assert.equal(Array.from(windowObject.callbacks.values()).reduce((total, callbacks) => total + callbacks.size, 0), 0);
  assert.deepEqual(view.state.doc.toJSON(), original);
  assert.equal(undoDepth(view.state), 0);
});

test("native preview uses one owned viewport overlay and clears rejected targets", () => {
  const context = fixture();
  const { editor, view, dom, root } = context;
  const cleanup = mountEditorBlockDrag(editor, { dom, root });
  const original = view.state.doc.toJSON();
  const start = dragEvent(dom);
  assert.equal(beginEditorBlockDrag(editor, start, ["rich"]).ok, true);
  context.setHit("middle-first");
  dom.emit("dragover", dragEvent(dom, start.dataTransfer));
  assert.deepEqual(getEditorBlockInteractionState(editor).dropTarget.rect, { x: 316, y: 170, width: 168, height: 2 });
  assert.equal(root.body.children.length, 1);
  const overlay = root.body.children[0];
  assert.equal(overlay.className, "life-block-drop-preview");
  assert.equal(overlay.dataset.dropKind, "content");
  assert.equal(overlay.style.position, "fixed");
  assert.equal(overlay.style.pointerEvents, "none");
  assert.deepEqual([overlay.style.left, overlay.style.top, overlay.style.width, overlay.style.height], ["316px", "170px", "168px", "2px"]);
  context.setHit("middle");
  dom.emit("dragover", dragEvent(dom, start.dataTransfer, { x: 301, y: 210 }));
  assert.equal(root.body.children.length, 1);
  assert.equal(root.body.children[0] === overlay, true);
  assert.equal(overlay.dataset.dropKind, "edge-column");
  assert.deepEqual([overlay.style.left, overlay.style.top, overlay.style.width, overlay.style.height], ["300px", "160px", "2px", "240px"]);
  context.setHit("root-after");
  dom.emit("dragover", dragEvent(dom, start.dataTransfer, { x: 101, y: 120 }));
  assert.equal(overlay.dataset.dropKind, "wrap-columns");
  context.setHit("rich-child");
  dom.emit("dragover", dragEvent(dom, start.dataTransfer, { x: 200, y: 225 }));
  assert.equal(getEditorBlockInteractionState(editor).dropTarget, null);
  assert.equal(root.body.children.length, 0);
  assert.deepEqual(view.state.doc.toJSON(), original);
  assert.equal(undoDepth(view.state), 0);
  cleanup();
  assert.equal(root.body.children.length, 0);
});

test("nested editor events stay isolated and ordinary image file and text drops pass through", () => {
  const context = fixture();
  const { editor, dom, root, view } = context;
  const cleanup = mountEditorBlockDrag(editor, { dom, root });
  const event = dragEvent(dom);
  beginEditorBlockDrag(editor, event, ["rich"]);
  const nested = element({}, dom, null, true);
  const nestedDrop = dragEvent(nested, event.dataTransfer);
  dom.emit("drop", nestedDrop);
  assert.equal(nestedDrop.defaultPrevented, false);
  assert.equal(context.plugin.props.handleDrop(view, nestedDrop, Slice.empty, false), false);
  assert.equal(getEditorBlockInteractionState(editor).dragging, true);
  cancelEditorBlockDrag(editor);
  for (const mime of ["Files", "text/plain", "text/html", "image/png"]) {
    const data = transfer();
    data.setData(mime, "external");
    const externalDrop = dragEvent(dom, data);
    assert.equal(handleEditorBlockDrop(editor, externalDrop), false);
    assert.equal(externalDrop.defaultPrevented, false);
  }
  const nativeExternalDrag = { slice: Slice.empty, move: false };
  view.dragging = nativeExternalDrag;
  cancelEditorBlockDrag(editor);
  assert.equal(view.dragging === nativeExternalDrag, true);
  cleanup();
});

test("extension factory is registered by invocation and exposes live drag methods", () => {
  const { editor } = fixture();
  const instance = BlockInteractionsExtension()({ editor });
  assert.equal(instance.key, "life-atlas-block-interactions");
  assert.equal(typeof instance.beginBlockDrag, "function");
  assert.equal(typeof instance.cancelBlockDrag, "function");
  assert.equal(typeof instance.resolveBlockDrop, "function");
  assert.equal(instance.prosemirrorPlugins.length, 1);
  assert.equal(instance.store.state.dragging, false);
});

test("vertical drag from left handle corridor reorders vertically instead of accidentally creating columns", () => {
  const blocks = [paragraph("top-text", "11"), paragraph("widget-block", "Pomodoro")];
  const context = fixture(blocks);
  const { editor, dom } = context;
  const topEl = dom.blocks.find((b) => b.dataset.id === "top-text");
  const widgetEl = dom.blocks.find((b) => b.dataset.id === "widget-block");
  topEl.getBoundingClientRect = () => ({ left: 200, right: 900, width: 700, top: 100, bottom: 136, height: 36 });
  widgetEl.getBoundingClientRect = () => ({ left: 200, right: 900, width: 700, top: 150, bottom: 380, height: 230 });
  // Dragging straight up from the left ⋮⋮ handle (x = 186, inside gutter left of block.left = 200)
  const start = dragEvent(dom, transfer(), { x: 186, y: 170 });
  assert.equal(beginEditorBlockDrag(editor, start, ["widget-block"]).ok, true);
  context.setHit("top-text");
  const inGutter = resolveEditorBlockDrop(editor, { x: 192, y: 116 });
  assert.equal(inGutter.ok, true);
  assert.equal(inGutter.kind, "content");
  assert.equal(inGutter.placement, "before");
  // Even drifting slightly onto the left edge while moving vertically up stays vertical reorder
  const nearLeftEdge = resolveEditorBlockDrop(editor, { x: 206, y: 116 });
  assert.equal(nearLeftEdge.ok, true);
  assert.equal(nearLeftEdge.kind, "content");
  // Deliberately pulling horizontally to the right edge creates a 2-column split
  const rightSplit = resolveEditorBlockDrop(editor, { x: 896, y: 118 });
  assert.equal(rightSplit.ok, true);
  assert.equal(rightSplit.kind, "wrap-columns");
  assert.equal(rightSplit.placement, "after");
  cancelEditorBlockDrag(editor);
});

test("columnList outer top and bottom seams place outside blocks above or below the whole multi-column row", () => {
  const context = fixture();
  const { editor, dom } = context;
  const start = dragEvent(dom, transfer(), { x: 300, y: 120 });
  assert.equal(beginEditorBlockDrag(editor, start, ["root-after"]).ok, true);
  context.setHit("layout");
  const aboveLayout = resolveEditorBlockDrop(editor, { x: 320, y: 153 });
  assert.equal(aboveLayout.ok, true);
  assert.equal(aboveLayout.kind, "content");
  assert.equal(aboveLayout.targetId, "layout");
  assert.equal(aboveLayout.placement, "before");
  assert.deepEqual(aboveLayout.rect, { x: 100, y: 150, width: 620, height: 2 });
  const belowLayout = resolveEditorBlockDrop(editor, { x: 320, y: 407 });
  assert.equal(belowLayout.ok, true);
  assert.equal(belowLayout.kind, "content");
  assert.equal(belowLayout.targetId, "layout");
  assert.equal(belowLayout.placement, "after");
  assert.deepEqual(belowLayout.rect, { x: 100, y: 410, width: 620, height: 2 });
  cancelEditorBlockDrag(editor);
});

test("column layout menu actions unwrap, swap whole layout up/down, remove column, and remove layout atomically", () => {
  const { editor, engine, view } = fixture();
  select(editor, "middle-first", 2);
  const ctx = findEnclosingColumnContext(view.state.doc, "middle-first");
  assert.deepEqual(ctx, { columnId: "middle", columnIndex: 1, columnCount: 3, columnListId: "layout", siblingIndex: 1, siblingCount: 3 });

  // Move whole columnList down (swaps past root-after)
  const beforeMove = view.state.doc.toJSON();
  assert.deepEqual(moveEditorColumnLayout(editor, "middle-first", "down"), { ok: true, changed: true });
  assert.deepEqual(canonical(view.state.doc, engine).map((b) => b.id), ["root-before", "root-after", "layout"]);
  assert.equal(undoDepth(view.state), 1);
  nativeUndo(view);
  assert.deepEqual(view.state.doc.toJSON(), beforeMove);

  // Move whole columnList up (swaps before root-before)
  assert.deepEqual(moveEditorColumnLayout(editor, "middle-first", "up"), { ok: true, changed: true });
  assert.deepEqual(canonical(view.state.doc, engine).map((b) => b.id), ["layout", "root-before", "root-after"]);
  nativeUndo(view);

  // Remove just the middle column (leaves 2 columns: left + right)
  assert.deepEqual(removeEditorColumn(editor, "middle-first"), { ok: true, changed: true });
  assert.deepEqual(canonical(view.state.doc, engine)[1].children.map((c) => c.id), ["left", "right"]);
  nativeUndo(view);

  // Unwrap whole columnList into sequential top-level blocks preserving rich content
  const richBefore = findNativeBlock(view.state.doc, "rich").node.toJSON();
  assert.deepEqual(unwrapEditorColumnLayout(editor, "middle-first"), { ok: true, changed: true });
  assert.deepEqual(canonical(view.state.doc, engine).map((b) => b.id), ["root-before", "rich", "left-tail", "middle-first", "middle-last", "right-only", "root-after"]);
  assert.deepEqual(findNativeBlock(view.state.doc, "rich").node.toJSON(), richBefore);
  nativeUndo(view);

  // Remove whole columnList
  assert.deepEqual(removeEditorColumnLayout(editor, "middle-first"), { ok: true, changed: true });
  assert.deepEqual(canonical(view.state.doc, engine).map((b) => b.id), ["root-before", "root-after"]);
});
