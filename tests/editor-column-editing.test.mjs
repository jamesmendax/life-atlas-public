import test from "node:test";
import assert from "node:assert/strict";
import { Schema } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { columnBoundaryEdit } from "../src/editor/ColumnEditingExtension.js";
import { findNativeBlock } from "../src/editor/editorTransactions.js";

const schema = new Schema({ nodes: {
  doc: { content: "blockGroup" },
  blockGroup: { content: "blockContainer+" },
  blockContainer: { content: "(paragraph|columnList|column|image|tabs|tabPanel) blockGroup?", attrs: { id: { default: null } } },
  paragraph: { content: "inline*" },
  columnList: {},
  column: { attrs: { width: { default: 50 } } },
  image: { attrs: { url: {} } },
  tabs: { attrs: { activeTabId: { default: "a" } } },
  tabPanel: { attrs: { tabId: { default: "a" } } },
  text: { group: "inline" },
}, marks: { bold: {}, link: { attrs: { href: {} } } } });
const container = (id, content, children = []) => schema.nodes.blockContainer.create({ id }, [content, ...(children.length ? [schema.nodes.blockGroup.create(null, children)] : [])]);
const paragraph = (id, text, children = []) => container(id, schema.nodes.paragraph.create(null, text ? schema.text(text, [schema.marks.bold.create(), schema.marks.link.create({ href: "lifeatlas://page/example" })]) : null), children);
function fixture(left, target, offset = 0) {
  const documentNode = schema.nodes.doc.create(null, schema.nodes.blockGroup.create(null, [
    paragraph("outside", "Root"),
    container("layout", schema.nodes.columnList.create(), [
      container("left", schema.nodes.column.create({ width: 56 }), left),
      container("right", schema.nodes.column.create({ width: 44 }), [container("picture", schema.nodes.image.create({ url: "life-asset://" + "a".repeat(64) })), paragraph("caption", "Caption")]),
    ]),
  ]));
  const block = findNativeBlock(documentNode, target);
  return EditorState.create({ schema, doc: documentNode, selection: TextSelection.create(documentNode, block.textStart + offset) });
}
const ids = (documentNode) => { const result = []; documentNode.descendants((node) => { if (node.type.name === "blockContainer") result.push(node.attrs.id); }); return result; };
const assertLayout = (before, after) => {
  assert.deepEqual([findNativeBlock(after, "left").node.firstChild.attrs.width, findNativeBlock(after, "right").node.firstChild.attrs.width], [56, 44]);
  assert.ok(findNativeBlock(before, "right").node.eq(findNativeBlock(after, "right").node));
  assert.deepEqual([...findNativeBlock(after, "layout").node.lastChild.content.content].map((node) => node.attrs.id), ["left", "right"]);
  after.check();
};

test("leading empty paragraph deletion preserves column identity and the complete media subtree", () => {
  const state = fixture([paragraph("blank", ""), paragraph("body", "Body")], "blank");
  const before = state.doc;
  const plan = columnBoundaryEdit(state, "Backspace");
  assert.equal(plan.handled, true);
  assert.ok(plan.transaction.docChanged);
  assert.ok(state.doc.eq(before));
  assert.equal(findNativeBlock(plan.transaction.doc, "blank"), null);
  assert.equal(plan.transaction.selection.$from.parent.textContent, "Body");
  assert.equal(plan.transaction.selection.$from.parentOffset, 0);
  assertLayout(before, plan.transaction.doc);
});

test("paragraph merge retains inline marks and nested children within the same column", () => {
  const state = fixture([paragraph("previous", "A", [paragraph("nested", "Z")]), paragraph("current", "B", [paragraph("child", "Y")]), paragraph("tail", "C")], "current");
  const plan = columnBoundaryEdit(state, "Backspace");
  assert.equal(plan.handled, true);
  assertLayout(state.doc, plan.transaction.doc);
  assert.equal(plan.transaction.doc.textContent, "RootAZBYCCaption");
  for (const id of ["previous", "nested", "child", "tail", "picture", "caption"]) assert.ok(ids(plan.transaction.doc).includes(id));
  const marks = [];
  plan.transaction.doc.descendants((node) => { if (node.isText && node.text.includes("B")) marks.push(node.marks.map((mark) => mark.type.name)); });
  assert.deepEqual(marks, [["bold", "link"]]);
});

test("ordinary text editing and nested list editing continue to their existing handlers", () => {
  const direct = fixture([paragraph("body", "Text")], "body", 2);
  assert.equal(columnBoundaryEdit(direct, "Backspace").handled, false);
  const outside = fixture([paragraph("body", "Text")], "outside");
  assert.equal(columnBoundaryEdit(outside, "Backspace").handled, false);
  const nested = fixture([paragraph("body", "Text", [paragraph("nested", "Indented")])], "nested");
  assert.equal(columnBoundaryEdit(nested, "Backspace").handled, false);
  const last = fixture([paragraph("body", "Text")], "body", 4);
  assert.equal(columnBoundaryEdit(last, "Delete").handled, true);
  assert.equal(columnBoundaryEdit(last, "Delete").transaction, undefined);
});

const panels = (activeTabId) => container("tabs", schema.nodes.tabs.create({ activeTabId }), [
  container("panel-a", schema.nodes.tabPanel.create({ tabId: "a" }), [paragraph("a-text", "AAA")]),
  container("panel-b", schema.nodes.tabPanel.create({ tabId: "b" }), [paragraph("b-text", "BBB")]),
]);

test("deleting a leading column blank restores the cursor to direct visible text without entering tab panels", () => {
  const state = fixture([paragraph("blank", ""), panels("b"), paragraph("tail", "TAIL")], "blank");
  const plan = columnBoundaryEdit(state, "Backspace");
  assert.equal(plan.handled, true);
  assert.equal(plan.transaction.selection.$from.parent.textContent, "TAIL");
  assert.ok(findNativeBlock(plan.transaction.doc, "tabs").node.eq(findNativeBlock(state.doc, "tabs").node));
  assertLayout(state.doc, plan.transaction.doc);
  const onlyPanels = fixture([paragraph("blank", ""), panels("b")], "blank");
  const kept = columnBoundaryEdit(onlyPanels, "Backspace");
  assert.equal(kept.handled, true);
  assert.ok(kept.transaction === undefined);
});

test("paragraph backspace after tab panels keeps visible text and its children together outside the container", () => {
  const state = fixture([panels("a"), paragraph("current", "CURRENT", [paragraph("child", "CHILD")]), paragraph("tail", "TAIL")], "current");
  const before = state.doc;
  const plan = columnBoundaryEdit(state, "Backspace");
  assert.equal(plan.handled, true);
  assert.ok(plan.transaction === undefined);
  assert.ok(state.doc.eq(before));
  assert.equal(findNativeBlock(state.doc, "current").node.textContent, "CURRENTCHILD");
});

test("backspace on sole empty paragraph in a 2-column layout dissolves the column layout cleanly", () => {
  const state = fixture([paragraph("sole-empty", "")], "sole-empty");
  const plan = columnBoundaryEdit(state, "Backspace");
  assert.equal(plan.handled, true);
  assert.ok(plan.transaction?.docChanged);
  assert.equal(findNativeBlock(plan.transaction.doc, "layout"), null);
  assert.equal(findNativeBlock(plan.transaction.doc, "left"), null);
  assert.equal(findNativeBlock(plan.transaction.doc, "right"), null);
  assert.ok(findNativeBlock(plan.transaction.doc, "picture"));
  assert.ok(findNativeBlock(plan.transaction.doc, "caption"));
  plan.transaction.doc.check();
});
