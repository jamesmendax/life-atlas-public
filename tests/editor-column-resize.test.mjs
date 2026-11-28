import test from "node:test";
import assert from "node:assert/strict";
import { Schema } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { history, redo, redoDepth, undo, undoDepth } from "@tiptap/pm/history";
import { createColumnWidthsPlugin, ColumnWidthsExtension } from "../src/editor/ColumnWidthsExtension.js";
import { findNativeBlock } from "../src/editor/editorTransactions.js";
import {
  abortColumnResize,
  availableColumnWidth,
  beginColumnResize,
  calculateAdjacentColumnResize,
  clearColumnResizePreview,
  columnWidthsPluginKey,
  commitColumnResize,
  createColumnResizePlan,
  getActiveColumnResize,
  getColumnResizeContext,
  preflightColumnResize,
  resizeColumnWithKeyboard,
  setColumnResizePreview,
} from "../src/editor/columnResize.js";

const schema = new Schema({
  nodes: {
    doc: { content: "blockGroup" },
    blockGroup: { content: "blockContainer+" },
    blockContainer: { content: "(paragraph|columnList|column) blockGroup?", attrs: { id: { default: null } } },
    columnList: { attrs: { id: { default: null }, columns: { default: 2 } } },
    column: { attrs: { id: { default: null }, width: { default: 50 }, index: { default: 0 }, count: { default: 2 } } },
    paragraph: { content: "text*" },
    text: { group: "inline" },
  },
  marks: { bold: {}, link: { attrs: { href: {} } } },
});

function paragraph(blockId, text) {
  return schema.nodes.blockContainer.create({ id: blockId }, schema.nodes.paragraph.create(null, [
    schema.text(text),
    schema.text(" kept", [schema.marks.bold.create(), schema.marks.link.create({ href: "lifeatlas://page/test" })]),
  ]));
}

function createEditor(weights = [50, 50, 50]) {
  const columnIds = weights.length === 2 ? ["left", "right"] : ["left", "middle", "right"];
  const columns = weights.map((width, index) => schema.nodes.blockContainer.create({ id: columnIds[index] }, [
    schema.nodes.column.create({ id: `native-${columnIds[index]}`, width, index: 0, count: 2 }),
    schema.nodes.blockGroup.create(null, [paragraph(`text-${columnIds[index]}`, `Text ${index}`)]),
  ]));
  const documentNode = schema.nodes.doc.create(null, schema.nodes.blockGroup.create(null, [
    paragraph("root-before", "Root before"),
    schema.nodes.blockContainer.create({ id: "layout" }, [
      schema.nodes.columnList.create({ id: "native-layout", columns: 2 }),
      schema.nodes.blockGroup.create(null, columns),
    ]),
    paragraph("root-after", "Root after"),
  ]));
  let state;
  let pluginView;
  let editable = true;
  const transactions = [];
  const view = {
    get state() { return state; },
    get editable() { return editable; },
    composing: false,
    isDestroyed: false,
    hasFocus: () => false,
    dispatch(transaction) {
      const applied = state.applyTransaction(transaction);
      state = applied.state;
      transactions.push(...applied.transactions);
      pluginView?.update(view);
    },
  };
  const editor = {
    headless: true,
    get prosemirrorState() { return state; },
    prosemirrorView: view,
    get isEditable() { return editable; },
    set isEditable(value) { editable = value; },
    transact(callback) {
      const transaction = state.tr;
      callback(transaction);
      view.dispatch(transaction);
    },
  };
  const plugin = createColumnWidthsPlugin(editor);
  state = EditorState.create({ schema, doc: documentNode, plugins: [history(), plugin] });
  const leftText = findNativeBlock(state.doc, "text-left");
  const nextText = findNativeBlock(state.doc, `text-${columnIds[1]}`);
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, nextText.textStart + 4, leftText.textStart + 2)).setMeta("addToHistory", false));
  pluginView = plugin.spec.view(view);
  return {
    editor,
    transactions,
    updateView: () => pluginView.update(view),
    widths: () => columnIds.map((columnId) => findNativeBlock(state.doc, columnId).node.firstChild.attrs.width),
    documentChanges: () => transactions.filter((transaction) => transaction.docChanged),
  };
}

function near(actual, expected) {
  assert.ok(Math.abs(actual - expected) <= 1e-9, `${actual} differs from ${expected}`);
}

function previewWidths(editor) {
  return columnWidthsPluginKey.getState(editor.prosemirrorState).decorations.find().map((decoration) => ({
    id: decoration.type.attrs["data-life-column-id"],
    width: Number(decoration.type.attrs["data-life-column-width"]),
    preview: decoration.type.attrs["data-life-column-preview"] === "true",
  }));
}

function event(type, values = {}) {
  const result = new Event(type, { cancelable: true });
  for (const [name, value] of Object.entries({ button: 0, pointerId: 7, isPrimary: true, clientX: 100, ...values })) {
    Object.defineProperty(result, name, { value });
  }
  return result;
}

class TrackedTarget extends EventTarget {
  listeners = new Map();
  addEventListener(type, callback, options) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(callback);
    super.addEventListener(type, callback, options);
  }
  removeEventListener(type, callback, options) {
    this.listeners.get(type)?.delete(callback);
    super.removeEventListener(type, callback, options);
  }
  count() { return Array.from(this.listeners.values()).reduce((total, listeners) => total + listeners.size, 0); }
}

function gestureEnvironment(fixture) {
  const windowObject = new TrackedTarget();
  const documentObject = new TrackedTarget();
  documentObject.defaultView = windowObject;
  documentObject.hidden = false;
  const element = new TrackedTarget();
  element.ownerDocument = documentObject;
  element.isConnected = true;
  const captured = new Set();
  element.setPointerCapture = (pointerId) => captured.add(pointerId);
  element.hasPointerCapture = (pointerId) => captured.has(pointerId);
  element.releasePointerCapture = (pointerId) => captured.delete(pointerId);
  const results = [];
  let pageId = "page-one";
  let locked = false;
  const options = {
    element,
    leftId: "left",
    geometry: { availableWidth: 624, gap: 42 },
    isLocked: () => locked,
    getPageId: () => pageId,
    onEnd: (result) => results.push(result),
  };
  return {
    windowObject,
    documentObject,
    element,
    results,
    options,
    start: (startEvent = event("pointerdown")) => beginColumnResize(fixture.editor, startEvent, options),
    lock: () => { locked = true; fixture.editor.isEditable = false; fixture.updateView(); },
    changePage: () => { pageId = "page-two"; },
    listenerCount: () => windowObject.count() + documentObject.count() + element.count(),
    captureCount: () => captured.size,
  };
}

test("column resize derives pixel deltas from the complete two-column weight total", () => {
  const result = calculateAdjacentColumnResize({ weights: [50, 50], leftIndex: 0, availableWidth: 666 }, 66.6);
  assert.equal(result.ok, true);
  near(result.left, 60);
  near(result.right, 40);
  assert.equal(result.pairTotal, 100);
});

test("three 50-weight columns resize one adjacent pair using total 150", () => {
  const result = calculateAdjacentColumnResize({ weights: [50, 50, 50], leftIndex: 0, availableWidth: 624 }, 41.6);
  near(result.left, 60);
  near(result.right, 40);
  assert.equal(result.totalWeight, 150);
  assert.equal(result.pairTotal, 100);
});

test("unequal decimal weights preserve the pair total and unselected column", () => {
  const weights = [17.125, 46.875, 79.25];
  const result = calculateAdjacentColumnResize({ weights, leftIndex: 1, availableWidth: 700 }, -31);
  near(result.left, 46.875 - 31 * 143.25 / 700);
  assert.equal(result.left + result.right, 126.125);
  assert.deepEqual(weights, [17.125, 46.875, 79.25]);
});

test("column available pixels subtract every gutter padding and border", () => {
  assert.equal(availableColumnWidth({ width: 708, columnCount: 3, gap: 42 }), 624);
  assert.equal(availableColumnWidth({ width: 708, columnCount: 2, gap: 42, paddingLeft: 12, paddingRight: 18, borderLeft: 1, borderRight: 2 }), 633);
  assert.equal(availableColumnWidth({ width: 80, columnCount: 3, gap: 42 }), 0);
  assert.equal(availableColumnWidth({ width: 708, columnCount: 3, gap: Number.NaN }), 0);
});

test("column minimum pixels adapt to narrow pairs without rewriting an existing narrow ratio", () => {
  const narrow = calculateAdjacentColumnResize({ weights: [50, 50, 50], leftIndex: 0, availableWidth: 120 }, -1000);
  near(narrow.minimumPixels, 80 / 3);
  near(narrow.left, 100 / 3);
  near(narrow.right, 200 / 3);
  const existing = calculateAdjacentColumnResize({ weights: [5, 95], leftIndex: 0, availableWidth: 200 }, 1);
  assert.equal(existing.left, 5.5);
  assert.equal(existing.right, 94.5);
  const untouched = calculateAdjacentColumnResize({ weights: [5, 95], leftIndex: 0, availableWidth: 200 }, 0);
  assert.equal(untouched.changed, false);
  assert.equal(untouched.left, 5);
});

test("column resize rejects invalid weights sizes and nonadjacent indices", () => {
  assert.equal(calculateAdjacentColumnResize({ weights: [50, 0], leftIndex: 0, availableWidth: 600 }).reason, "invalid-column-weights");
  assert.equal(calculateAdjacentColumnResize({ weights: [50, Number.NaN], leftIndex: 0, availableWidth: 600 }).ok, false);
  assert.equal(calculateAdjacentColumnResize({ weights: [50, 50], leftIndex: 1, availableWidth: 600 }).reason, "nonadjacent-columns");
  assert.equal(calculateAdjacentColumnResize({ weights: [50, 50], leftIndex: 0, availableWidth: 0 }).reason, "invalid-column-size");
});

test("native column context uses the real parent order rather than saved count and index props", () => {
  const { editor } = createEditor();
  const context = getColumnResizeContext(editor.prosemirrorState.doc, "middle");
  assert.equal(context.index, 1);
  assert.equal(context.columns.length, 3);
  assert.deepEqual(context.columns.map((column) => column.id), ["left", "middle", "right"]);
  assert.equal(context.columns[1].node.firstChild.attrs.index, 0);
  const plan = createColumnResizePlan(editor, "middle", { availableWidth: 624, gap: 42 });
  assert.equal(plan.rightId, "right");
  assert.equal(plan.totalWeight, 150);
});

test("column preview changes only plugin metadata and decorations with no document or history writes", () => {
  const fixture = createEditor();
  const before = fixture.editor.prosemirrorState.doc;
  const selection = fixture.editor.prosemirrorState.selection.toJSON();
  const plan = createColumnResizePlan(fixture.editor, "left", { availableWidth: 624, gap: 42 });
  const pair = calculateAdjacentColumnResize(plan, 47.3);
  assert.equal(setColumnResizePreview(fixture.editor, plan, pair).ok, true);
  assert.equal(fixture.editor.prosemirrorState.doc, before);
  assert.deepEqual(fixture.editor.prosemirrorState.selection.toJSON(), selection);
  assert.deepEqual(fixture.widths(), [50, 50, 50]);
  assert.equal(fixture.documentChanges().length, 0);
  assert.equal(fixture.transactions.length, 1);
  assert.equal(fixture.transactions[0].steps.length, 0);
  assert.equal(fixture.transactions[0].getMeta("addToHistory"), false);
  assert.equal(undoDepth(fixture.editor.prosemirrorState), 0);
  assert.deepEqual(previewWidths(fixture.editor), [
    { id: "left", width: pair.left, preview: true },
    { id: "middle", width: pair.right, preview: true },
    { id: "right", width: 50, preview: false },
  ]);
  assert.equal(preflightColumnResize(fixture.editor, plan).ok, true);
  clearColumnResizePreview(fixture.editor, plan);
  assert.equal(fixture.editor.prosemirrorState.doc, before);
  assert.deepEqual(previewWidths(fixture.editor).map((column) => column.width), [50, 50, 50]);
  assert.equal(undoDepth(fixture.editor.prosemirrorState), 0);
});

test("column resize commits decimal pair widths in one native transaction and one exact undo redo", () => {
  const fixture = createEditor([50.125, 49.875, 73.25]);
  const before = fixture.editor.prosemirrorState.doc.toJSON();
  const selection = fixture.editor.prosemirrorState.selection.toJSON();
  const third = findNativeBlock(fixture.editor.prosemirrorState.doc, "right").node;
  const plan = createColumnResizePlan(fixture.editor, "left", { availableWidth: 624, gap: 42 });
  const pair = calculateAdjacentColumnResize(plan, 37.123);
  setColumnResizePreview(fixture.editor, plan, pair);
  assert.deepEqual(commitColumnResize(fixture.editor, plan, pair), { ok: true, changed: true });
  assert.equal(fixture.documentChanges().length, 1);
  assert.equal(fixture.documentChanges()[0].getMeta("lifeAtlasAction"), "column-resize");
  assert.equal(fixture.documentChanges()[0].steps.length, 2);
  assert.deepEqual(fixture.widths(), [pair.left, pair.right, 73.25]);
  assert.equal(findNativeBlock(fixture.editor.prosemirrorState.doc, "right").node, third);
  assert.deepEqual(fixture.editor.prosemirrorState.selection.toJSON(), selection);
  assert.equal(columnWidthsPluginKey.getState(fixture.editor.prosemirrorState).preview, null);
  assert.equal(undoDepth(fixture.editor.prosemirrorState), 1);
  const committed = fixture.editor.prosemirrorState.doc.toJSON();
  assert.equal(undo(fixture.editor.prosemirrorState, fixture.editor.prosemirrorView.dispatch), true);
  assert.deepEqual(fixture.editor.prosemirrorState.doc.toJSON(), before);
  assert.deepEqual(fixture.editor.prosemirrorState.selection.toJSON(), selection);
  assert.equal(undoDepth(fixture.editor.prosemirrorState), 0);
  assert.equal(redoDepth(fixture.editor.prosemirrorState), 1);
  assert.equal(redo(fixture.editor.prosemirrorState, fixture.editor.prosemirrorView.dispatch), true);
  assert.deepEqual(fixture.editor.prosemirrorState.doc.toJSON(), committed);
  assert.deepEqual(fixture.editor.prosemirrorState.selection.toJSON(), selection);
});

test("column no-op preview and commit create no dispatch or undo entry", () => {
  const fixture = createEditor();
  const plan = createColumnResizePlan(fixture.editor, "left", { availableWidth: 624, gap: 42 });
  const pair = calculateAdjacentColumnResize(plan, 0);
  assert.deepEqual(setColumnResizePreview(fixture.editor, plan, pair), { ok: true, changed: false });
  assert.deepEqual(commitColumnResize(fixture.editor, plan, pair), { ok: true, changed: false });
  assert.equal(fixture.transactions.length, 0);
  assert.equal(undoDepth(fixture.editor.prosemirrorState), 0);
});

test("column commit rejects locks stale documents changed pair totals and nonadjacent targets atomically", () => {
  const fixture = createEditor();
  const before = fixture.editor.prosemirrorState.doc;
  const plan = createColumnResizePlan(fixture.editor, "left", { availableWidth: 624, gap: 42 });
  const pair = calculateAdjacentColumnResize(plan, 20);
  assert.equal(commitColumnResize(fixture.editor, { ...plan, rightId: "right" }, pair).reason, "nonadjacent-columns");
  assert.equal(commitColumnResize(fixture.editor, plan, { ...pair, right: pair.right + 1 }).reason, "invalid-column-pair");
  fixture.editor.isEditable = false;
  assert.equal(commitColumnResize(fixture.editor, plan, pair).reason, "locked");
  fixture.editor.isEditable = true;
  assert.equal(fixture.transactions.length, 0);
  assert.equal(fixture.editor.prosemirrorState.doc, before);
  fixture.editor.prosemirrorView.dispatch(fixture.editor.prosemirrorState.tr.insertText(" change", findNativeBlock(before, "root-before").textStart));
  assert.equal(commitColumnResize(fixture.editor, plan, pair).reason, "stale-column-document");
  assert.deepEqual(fixture.widths(), [50, 50, 50]);
  assert.equal(fixture.documentChanges().length, 1);
});

test("rejected native column transactions never persist a partially updated pair", () => {
  const fixture = createEditor();
  const before = fixture.editor.prosemirrorState.doc;
  const plan = createColumnResizePlan(fixture.editor, "left", { availableWidth: 624, gap: 42 });
  const transact = fixture.editor.transact;
  fixture.editor.transact = (callback) => transact((transaction) => { callback(transaction); throw new Error("atomic rejection"); });
  const result = commitColumnResize(fixture.editor, plan, calculateAdjacentColumnResize(plan, 20));
  assert.equal(result.ok, false);
  assert.equal(fixture.editor.prosemirrorState.doc, before);
  assert.equal(fixture.documentChanges().length, 0);
  assert.equal(undoDepth(fixture.editor.prosemirrorState), 0);
});

test("column pointer ownership ignores another pointer and concurrent gestures", (context) => {
  const fixture = createEditor();
  const environment = gestureEnvironment(fixture);
  context.after(() => abortColumnResize(fixture.editor));
  assert.equal(environment.start().ok, true);
  assert.equal(environment.start(event("pointerdown", { pointerId: 8 })).reason, "pointer-unavailable");
  environment.windowObject.dispatchEvent(event("pointermove", { pointerId: 8, clientX: 170 }));
  environment.windowObject.dispatchEvent(event("pointerup", { pointerId: 8 }));
  assert.equal(fixture.transactions.length, 0);
  assert.ok(getActiveColumnResize(fixture.editor));
  environment.windowObject.dispatchEvent(event("pointermove", { clientX: 150 }));
  assert.equal(fixture.documentChanges().length, 0);
  environment.windowObject.dispatchEvent(event("pointerup", { clientX: 150 }));
  assert.equal(fixture.documentChanges().length, 1);
  assert.equal(environment.results[0].ok, true);
  assert.equal(environment.listenerCount(), 0);
  assert.equal(environment.captureCount(), 0);
});

test("column pointer release commits the final coordinate rather than the cached move", (context) => {
  const fixture = createEditor();
  const before = fixture.editor.prosemirrorState.doc.toJSON();
  const selection = fixture.editor.prosemirrorState.selection.toJSON();
  const environment = gestureEnvironment(fixture);
  context.after(() => abortColumnResize(fixture.editor));
  assert.equal(environment.start().ok, true);
  environment.windowObject.dispatchEvent(event("pointermove", { clientX: 150 }));
  assert.equal(fixture.documentChanges().length, 0);
  environment.windowObject.dispatchEvent(event("pointerup", { clientX: 182.625 }));
  const left = 50 + 82.625 * 150 / 624;
  near(fixture.widths()[0], left);
  near(fixture.widths()[1], 100 - left);
  assert.equal(fixture.widths()[2], 50);
  assert.equal(fixture.documentChanges().length, 1);
  assert.deepEqual(fixture.editor.prosemirrorState.selection.toJSON(), selection);
  assert.equal(undoDepth(fixture.editor.prosemirrorState), 1);
  assert.equal(columnWidthsPluginKey.getState(fixture.editor.prosemirrorState).preview, null);
  assert.equal(getActiveColumnResize(fixture.editor), null);
  assert.equal(environment.listenerCount(), 0);
  assert.equal(environment.captureCount(), 0);
  const committed = fixture.editor.prosemirrorState.doc.toJSON();
  assert.equal(undo(fixture.editor.prosemirrorState, fixture.editor.prosemirrorView.dispatch), true);
  assert.deepEqual(fixture.editor.prosemirrorState.doc.toJSON(), before);
  assert.equal(redo(fixture.editor.prosemirrorState, fixture.editor.prosemirrorView.dispatch), true);
  assert.deepEqual(fixture.editor.prosemirrorState.doc.toJSON(), committed);
});

test("column pointer release at the starting coordinate clears preview without saving", (context) => {
  const fixture = createEditor();
  const before = fixture.editor.prosemirrorState.doc;
  const selection = fixture.editor.prosemirrorState.selection.toJSON();
  const environment = gestureEnvironment(fixture);
  context.after(() => abortColumnResize(fixture.editor));
  assert.equal(environment.start().ok, true);
  environment.windowObject.dispatchEvent(event("pointermove", { clientX: 165 }));
  assert.ok(columnWidthsPluginKey.getState(fixture.editor.prosemirrorState).preview);
  environment.windowObject.dispatchEvent(event("pointerup", { clientX: 100 }));
  assert.ok(fixture.editor.prosemirrorState.doc === before);
  assert.deepEqual(fixture.editor.prosemirrorState.selection.toJSON(), selection);
  assert.deepEqual(fixture.widths(), [50, 50, 50]);
  assert.equal(fixture.documentChanges().length, 0);
  assert.equal(undoDepth(fixture.editor.prosemirrorState), 0);
  assert.equal(environment.results[0].ok, true);
  assert.equal(environment.results[0].changed, false);
  assert.equal(columnWidthsPluginKey.getState(fixture.editor.prosemirrorState).preview, null);
  assert.equal(getActiveColumnResize(fixture.editor), null);
  assert.equal(environment.listenerCount(), 0);
  assert.equal(environment.captureCount(), 0);
});

test("column pointer cancellation clears previews listeners and capture without saving", async (context) => {
  const cancellations = [
    ["Escape", (environment) => environment.documentObject.dispatchEvent(event("keydown", { key: "Escape" }))],
    ["pointercancel", (environment) => environment.windowObject.dispatchEvent(event("pointercancel"))],
    ["lostpointercapture", (environment) => environment.element.dispatchEvent(event("lostpointercapture"))],
    ["lock", (environment) => environment.lock()],
    ["unmount", (environment, fixture) => abortColumnResize(fixture.editor, "unmount")],
    ["page change", (environment) => { environment.changePage(); environment.windowObject.dispatchEvent(event("pointermove", { clientX: 180 })); }],
    ["composition", (environment) => environment.documentObject.dispatchEvent(event("compositionstart"))],
    ["window blur", (environment) => environment.windowObject.dispatchEvent(event("blur"))],
    ["window resize", (environment) => environment.windowObject.dispatchEvent(event("resize"))],
  ];
  for (const [name, cancel] of cancellations) await context.test(name, (subtest) => {
    const fixture = createEditor();
    const before = fixture.editor.prosemirrorState.doc;
    const selection = fixture.editor.prosemirrorState.selection.toJSON();
    const environment = gestureEnvironment(fixture);
    subtest.after(() => abortColumnResize(fixture.editor));
    assert.equal(environment.start().ok, true);
    environment.windowObject.dispatchEvent(event("pointermove", { clientX: 165 }));
    assert.ok(columnWidthsPluginKey.getState(fixture.editor.prosemirrorState).preview);
    cancel(environment, fixture);
    assert.equal(getActiveColumnResize(fixture.editor), null);
    assert.equal(columnWidthsPluginKey.getState(fixture.editor.prosemirrorState).preview, null);
    assert.equal(fixture.editor.prosemirrorState.doc, before);
    assert.deepEqual(fixture.editor.prosemirrorState.selection.toJSON(), selection);
    assert.deepEqual(fixture.widths(), [50, 50, 50]);
    assert.equal(fixture.documentChanges().length, 0);
    assert.equal(undoDepth(fixture.editor.prosemirrorState), 0);
    assert.equal(environment.results[0].ok, false);
    assert.equal(environment.listenerCount(), 0);
    assert.equal(environment.captureCount(), 0);
    environment.windowObject.dispatchEvent(event("pointerup", { clientX: 165 }));
    assert.equal(fixture.documentChanges().length, 0);
  });
});

test("column document edits invalidate an active preview before release", (context) => {
  const fixture = createEditor();
  const environment = gestureEnvironment(fixture);
  context.after(() => abortColumnResize(fixture.editor));
  environment.start();
  environment.windowObject.dispatchEvent(event("pointermove", { clientX: 160 }));
  const position = findNativeBlock(fixture.editor.prosemirrorState.doc, "root-after").textStart;
  fixture.editor.prosemirrorView.dispatch(fixture.editor.prosemirrorState.tr.insertText("New", position));
  assert.equal(columnWidthsPluginKey.getState(fixture.editor.prosemirrorState).preview, null);
  assert.equal(getActiveColumnResize(fixture.editor), null);
  assert.equal(environment.listenerCount(), 0);
  environment.windowObject.dispatchEvent(event("pointerup", { clientX: 160 }));
  assert.deepEqual(fixture.widths(), [50, 50, 50]);
  assert.equal(fixture.documentChanges().length, 1);
});

test("right mouse buttons secondary pointers composition and locks cannot start column resizing", () => {
  const fixture = createEditor();
  const environment = gestureEnvironment(fixture);
  assert.equal(environment.start(event("pointerdown", { button: 2 })).ok, false);
  assert.equal(environment.start(event("pointerdown", { isPrimary: false })).ok, false);
  fixture.editor.prosemirrorView.composing = true;
  assert.equal(environment.start().reason, "composing");
  fixture.editor.prosemirrorView.composing = false;
  environment.lock();
  assert.equal(environment.start().reason, "locked");
  assert.equal(fixture.transactions.length, 0);
  assert.equal(environment.listenerCount(), 0);
});

test("column keyboard arrows use 16 pixels and Shift uses 4 with separate native undo", () => {
  const fixture = createEditor();
  const geometry = { availableWidth: 624, gap: 42 };
  const selection = fixture.editor.prosemirrorState.selection.toJSON();
  const normal = resizeColumnWithKeyboard(fixture.editor, "left", geometry, event("keydown", { key: "ArrowRight" }));
  assert.equal(normal.ok, true);
  near(fixture.widths()[0], 50 + 16 * 150 / 624);
  const fine = resizeColumnWithKeyboard(fixture.editor, "left", geometry, event("keydown", { key: "ArrowLeft", shiftKey: true }));
  assert.equal(fine.ok, true);
  near(fixture.widths()[0], 50 + 12 * 150 / 624);
  assert.equal(fixture.widths()[2], 50);
  assert.deepEqual(fixture.editor.prosemirrorState.selection.toJSON(), selection);
  assert.equal(undoDepth(fixture.editor.prosemirrorState), 2);
  undo(fixture.editor.prosemirrorState, fixture.editor.prosemirrorView.dispatch);
  near(fixture.widths()[0], 50 + 16 * 150 / 624);
  undo(fixture.editor.prosemirrorState, fixture.editor.prosemirrorView.dispatch);
  assert.deepEqual(fixture.widths(), [50, 50, 50]);
});

test("column keyboard minimum no-op and locked actions do not create history", () => {
  const fixture = createEditor([100 / 3, 200 / 3]);
  const geometry = { availableWidth: 200, gap: 42 };
  assert.deepEqual(resizeColumnWithKeyboard(fixture.editor, "left", geometry, event("keydown", { key: "ArrowLeft" })), { ok: true, changed: false });
  fixture.editor.isEditable = false;
  assert.equal(resizeColumnWithKeyboard(fixture.editor, "left", geometry, event("keydown", { key: "ArrowRight" })).reason, "locked");
  assert.equal(fixture.transactions.length, 0);
  assert.equal(undoDepth(fixture.editor.prosemirrorState), 0);
});

test("column extension uses an invoked public function factory", () => {
  const fixture = createEditor();
  const extension = ColumnWidthsExtension({ editor: fixture.editor });
  assert.equal(extension.key, "life-atlas-column-widths");
  assert.equal(extension.prosemirrorPlugins.length, 1);
  assert.equal(extension.prosemirrorPlugins[0].key, columnWidthsPluginKey.key);
});
