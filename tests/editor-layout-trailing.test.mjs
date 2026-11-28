import test from "node:test";
import assert from "node:assert/strict";
import { BlockNoteEditor, BlockNoteSchema, createBlockSpec, defaultBlockSpecs } from "@blocknote/core";
import { LayoutTrailingExtension, layoutTrailingTargets } from "../src/editor/LayoutTrailingExtension.js";
import { findNativeBlock } from "../src/editor/editorTransactions.js";

function unusedRender() { throw new Error("Headless structural tests do not render DOM"); }

const schema = BlockNoteSchema.create({ blockSpecs: {
  ...defaultBlockSpecs,
  columnList: createBlockSpec({ type: "columnList", content: "none", propSchema: { columns: { default: 2 } } }, { render: unusedRender })(),
  column: createBlockSpec({ type: "column", content: "none", propSchema: { width: { default: 50 } } }, { render: unusedRender })(),
} });

function createEditor() {
  return BlockNoteEditor.create({
    schema,
    disableExtensions: ["trailingNode"],
    extensions: [LayoutTrailingExtension()],
    initialContent: [{ id: "layout", type: "columnList", children: [
      { id: "left", type: "column", children: [{ id: "heading", type: "heading", props: { level: 1 }, content: "" }, { id: "left-text", type: "paragraph", content: "左栏" }] },
      { id: "right", type: "column", children: [{ id: "right-text", type: "paragraph", content: "" }] },
    ] }, { id: "root-tail", type: "paragraph", content: "正文末尾" }],
  });
}

test("trailing targets use real root and column child groups rather than leaf layout content", () => {
  const editor = createEditor();
  const documentNode = editor.prosemirrorState.doc;
  const targets = layoutTrailingTargets(documentNode);
  assert.deepEqual(targets.map((target) => target.ownerId), ["root", "left"]);
  for (const target of targets) {
    const resolved = documentNode.resolve(target.position);
    assert.equal(resolved.parent.type.name, "blockGroup");
    assert.equal(resolved.nodeBefore.attrs.id, target.lastBlockId);
    assert.notEqual(target.position, findNativeBlock(documentNode, "left").contentPosition);
    assert.notEqual(target.position, findNativeBlock(documentNode, "right").contentPosition);
  }
});

test("real empty paragraphs and headings remain unchanged when trailing decorations are computed", () => {
  const editor = createEditor();
  const before = structuredClone(editor.document);
  const nativeBefore = editor.prosemirrorState.doc;
  const plugin = editor.getExtension(LayoutTrailingExtension).prosemirrorPlugins[0];
  const decorations = plugin.props.decorations(editor.prosemirrorState);
  assert.equal(decorations.find().length, 2);
  assert.deepEqual(editor.document, before);
  assert.equal(editor.prosemirrorState.doc === nativeBefore, true);
  assert.equal(editor.getBlock("right-text").type, "paragraph");
  assert.equal(editor.getBlock("heading").type, "heading");
  assert.equal(editor.getBlock("heading").content.length, 0);
});

test("trailing decorations follow changed last blocks and disappear when read-only", () => {
  const editor = createEditor();
  editor.insertBlocks([{ id: "left-empty", type: "paragraph", content: "" }], "left-text", "after");
  assert.deepEqual(layoutTrailingTargets(editor.prosemirrorState.doc).map((target) => target.ownerId), ["root"]);
  editor.updateBlock("right-text", { content: "可编辑正文" });
  assert.deepEqual(layoutTrailingTargets(editor.prosemirrorState.doc).map((target) => target.ownerId), ["root", "right"]);
  editor.isEditable = false;
  const plugin = editor.getExtension(LayoutTrailingExtension).prosemirrorPlugins[0];
  assert.equal(plugin.props.decorations(editor.prosemirrorState).find().length, 0);
});
