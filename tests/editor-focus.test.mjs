import test from "node:test";
import assert from "node:assert/strict";
import { Schema } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { blockFocusKey, createBlockFocusPlugin, setEditorBlockFocus } from "../src/editor/BlockFocusExtension.js";

const schema = new Schema({ nodes: {
  doc: { content: "blockContainer+" },
  blockContainer: { content: "paragraph", attrs: { id: { default: null } } },
  paragraph: { content: "text*" },
  text: {},
} });

function fixture() {
  const plugin = createBlockFocusPlugin();
  const document = schema.node("doc", null, [
    schema.node("blockContainer", { id: "block-first" }, schema.node("paragraph", null, schema.text("原文"))),
    schema.node("blockContainer", { id: "block-second" }, schema.node("paragraph", null, schema.text("目标"))),
  ]);
  return { plugin, state: EditorState.create({ schema, doc: document, plugins: [plugin] }) };
}

function decorations(plugin, state) {
  return plugin.props.decorations(state).find().map((decoration) => ({ from: decoration.from, to: decoration.to, className: decoration.type.attrs.class }));
}

test("block focus is a native decoration without document edits", () => {
  const { plugin, state } = fixture();
  const transaction = state.tr.setMeta(blockFocusKey, "block-first");
  assert.equal(transaction.docChanged, false);
  const focused = state.apply(transaction);
  assert.equal(focused.doc, state.doc);
  assert.deepEqual(focused.doc.toJSON(), state.doc.toJSON());
  assert.deepEqual(decorations(plugin, focused), [{ from: 0, to: state.doc.firstChild.nodeSize, className: "is-link-target" }]);
});

test("block focus survives selection and document transactions", () => {
  const fixtureState = fixture();
  let state = fixtureState.state.apply(fixtureState.state.tr.setMeta(blockFocusKey, "block-first"));
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 3)));
  assert.deepEqual(decorations(fixtureState.plugin, state), [{ from: 0, to: state.doc.firstChild.nodeSize, className: "is-link-target" }]);
  state = state.apply(state.tr.insertText("新增", 2));
  assert.equal(state.doc.firstChild.attrs.id, "block-first");
  assert.deepEqual(decorations(fixtureState.plugin, state), [{ from: 0, to: state.doc.firstChild.nodeSize, className: "is-link-target" }]);
});

test("changing block focus replaces only the transient target", () => {
  const { plugin, state } = fixture();
  const first = state.apply(state.tr.setMeta(blockFocusKey, "block-first"));
  const second = first.apply(first.tr.setMeta(blockFocusKey, "block-second"));
  assert.equal(second.doc, state.doc);
  assert.deepEqual(decorations(plugin, second), [{ from: state.doc.firstChild.nodeSize, to: state.doc.content.size, className: "is-link-target" }]);
  const cleared = second.apply(second.tr.setMeta(blockFocusKey, null));
  assert.equal(cleared.doc, state.doc);
  assert.deepEqual(decorations(plugin, cleared), []);
});

test("missing or deleted focus targets have no decoration", () => {
  const { plugin, state } = fixture();
  const missing = state.apply(state.tr.setMeta(blockFocusKey, "missing"));
  assert.deepEqual(decorations(plugin, missing), []);
  const focused = state.apply(state.tr.setMeta(blockFocusKey, "block-first"));
  const removed = focused.apply(focused.tr.delete(0, focused.doc.firstChild.nodeSize));
  assert.deepEqual(decorations(plugin, removed), []);
});

test("editor focus dispatch is idempotent and ignores destroyed views", () => {
  const { state } = fixture();
  const view = { state, isDestroyed: false, dispatchCount: 0, dispatch(transaction) { this.dispatchCount += 1; this.state = this.state.apply(transaction); } };
  const editor = { prosemirrorView: view };
  assert.equal(setEditorBlockFocus(editor, "block-first"), true);
  assert.equal(setEditorBlockFocus(editor, "block-first"), false);
  assert.equal(setEditorBlockFocus(editor, null), true);
  assert.equal(setEditorBlockFocus(editor, null), false);
  assert.equal(view.dispatchCount, 2);
  assert.equal(view.state.doc, state.doc);
  view.isDestroyed = true;
  assert.equal(setEditorBlockFocus(editor, "block-first"), false);
  assert.equal(view.dispatchCount, 2);
  assert.equal(setEditorBlockFocus({ prosemirrorView: null }, "block-first"), false);
});
