import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import * as keyboardInput from "../src/ui/keyboard.js";

function sourceHandler(file, startMarker, endMarker) {
  const source = readFileSync(new URL(file, import.meta.url), "utf8").replaceAll("\r\n", "\n");
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `Actual keyboard callsite must be available in ${file}`);
  return `(event) => {${source.slice(start + startMarker.length, end)}}`;
}

const pageCapture = sourceHandler("../src/editor/PageEditor.jsx", "onKeyDownCapture={(event) => {", "}} onClickCapture");
const nestedCapture = sourceHandler("../src/editor/EditorContainers.jsx", "onKeyDownCapture={(event) => {", "}} onDoubleClick");
const blockCapture = sourceHandler("../src/editor/LifeAtlasSideMenuController.jsx", "const onKeyDown = (event) => {", "\n    };\n    documentNode.addEventListener");
const navigationKeyboard = sourceHandler("../src/App.jsx", "const keyboard = (event) => {", "\n    };\n    window.addEventListener(\"keydown\", keyboard)");
const applicationKeyboard = sourceHandler("../src/App.jsx", "const onKeyDown = (event) => {", "\n    };\n    window.addEventListener(\"keydown\", onKeyDown)");

function keyboardEvent(properties = {}) {
  const event = {
    key: "d", code: "KeyD", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false,
    defaultPrevented: false, propagationStopped: false, target: {},
    getModifierState: () => false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this.propagationStopped = true; },
    ...properties,
  };
  return event;
}

function handlerProbe(source, { composing = false, locked = false, ownsTarget = true, modalOpen = false } = {}) {
  const effects = [];
  const view = { composing, hasFocus: () => true, domObserver: { flush: () => effects.push("flush") } };
  const editor = { prosemirrorView: view };
  const handler = runInNewContext(`(${source})`, {
    ...keyboardInput,
    hasOpenModal: () => modalOpen,
    editor, view, locked, runtime: { locked }, stateRef: { current: { runtime: { locked } } },
    ownsEditorKeyboardTarget: () => ownsTarget,
    currentEditorBlock: () => ({ id: "current", type: "paragraph" }),
    structuralTypes: new Set(["column", "columnList"]),
    selectedEditorBlocks: () => [{ id: "current" }],
    conversionKeys: ["paragraph", "heading-1", "heading-2", "heading-3", "checkListItem", "bulletListItem", "numberedListItem", "toggleListItem", "codeBlock", "quote"],
    convertEditorBlocks: (editorValue, ids, target) => { effects.push(`convert:${target}`); return { ok: true }; },
    duplicateEditorBlocks: () => effects.push("duplicate"),
    positionBlock: () => effects.push("position"),
    setSelectionIds: () => effects.push("selection"),
    setOpened: () => effects.push("menu"),
    setWorkspace: () => effects.push("workspace"),
    navigationRef: { current: (direction) => effects.push(direction) },
    tabCommands: { current: null },
    pageDocumentRef: { current: {} },
    setSettingsOpen: () => effects.push("settings"),
    setShortcutsOpen: () => effects.push("shortcuts"),
    setFindOpen: () => effects.push("find"),
    setFindFocusKey: () => effects.push("find-focus"),
    setCaptureOpen: () => effects.push("capture"),
    setSearchOpen: () => effects.push("search"),
  });
  return { handler, effects };
}

test("keyboard input guards read native and React composition flags without depending on a copied field", () => {
  for (const event of [{ isComposing: true }, { nativeEvent: { isComposing: true } }, { keyCode: 229 }, { nativeEvent: { keyCode: 229 } }]) assert.equal(keyboardInput.isComposingKeyboardEvent(event), true);
  for (const event of [undefined, {}, { isComposing: false }, { nativeEvent: { isComposing: false }, keyCode: 68 }]) assert.equal(keyboardInput.isComposingKeyboardEvent(event), false);
  assert.equal(keyboardInput.isAltGraphKeyboardEvent({ nativeEvent: { getModifierState: (name) => name === "AltGraph" } }), true);
  assert.equal(keyboardInput.isAltGraphKeyboardEvent(keyboardEvent()), false);
});

for (const [label, source] of [["page", pageCapture], ["nested", nestedCapture]]) {
  test(`${label} React capture cannot flush or duplicate from native-only composing keydown`, () => {
    const { handler, effects } = handlerProbe(source);
    handler(keyboardEvent({ ctrlKey: true, nativeEvent: { isComposing: true } }));
    assert.deepEqual(effects, []);
  });

  test(`${label} React capture preserves the ordinary duplicate shortcut and foreign target isolation`, () => {
    const normal = handlerProbe(source);
    const event = keyboardEvent({ ctrlKey: true });
    normal.handler(event);
    assert.deepEqual(normal.effects, label === "page" ? ["flush", "duplicate"] : ["duplicate"]);
    assert.equal(event.defaultPrevented, true);
    const foreign = handlerProbe(source, { ownsTarget: false });
    foreign.handler(keyboardEvent({ ctrlKey: true }));
    assert.deepEqual(foreign.effects, []);
  });
}

test("AltGraph digit characters remain input instead of block conversion in and outside composition", () => {
  for (const composing of [false, true]) {
    for (const [code, key] of [["Digit7", "{"], ["Digit8", "["], ["Digit9", "]"]]) {
      const { handler, effects } = handlerProbe(blockCapture, { composing });
      const event = keyboardEvent({ code, key, ctrlKey: true, altKey: true, getModifierState: (modifier) => modifier === "AltGraph" });
      handler(event);
      assert.deepEqual(effects, [], `${key} must not issue a block action`);
      assert.equal(event.defaultPrevented, false, `${key} must not be cancelled`);
      assert.equal(event.propagationStopped, false);
    }
  }
});

test("block conversion distinguishes numeric shortcut keys from printable layout characters", () => {
  const normal = handlerProbe(blockCapture);
  const shortcut = keyboardEvent({ key: "2", code: "Digit2", ctrlKey: true, altKey: true });
  normal.handler(shortcut);
  assert.deepEqual(normal.effects, ["convert:heading-2", "position"]);
  assert.equal(shortcut.defaultPrevented, true);
  const printable = handlerProbe(blockCapture);
  const character = keyboardEvent({ key: "{", code: "Digit7", ctrlKey: true, altKey: true });
  printable.handler(character);
  assert.deepEqual(printable.effects, []);
  assert.equal(character.defaultPrevented, false);
});

test("owned structural shortcuts are consumed during composition while ordinary input is left alone", () => {
  for (const properties of [{ key: "F10", code: "F10", shiftKey: true }, { key: "ContextMenu", code: "ContextMenu" }, { key: "3", code: "Digit3", ctrlKey: true, altKey: true }, { key: "d", ctrlKey: true }]) {
    const { handler, effects } = handlerProbe(blockCapture, { composing: true });
    const event = keyboardEvent(properties);
    handler(event);
    assert.deepEqual(effects, []);
    assert.equal(event.defaultPrevented, true);
    assert.equal(event.propagationStopped, true);
  }
  const normal = handlerProbe(blockCapture, { composing: true });
  const letter = keyboardEvent({ key: "a", code: "KeyA" });
  normal.handler(letter);
  assert.deepEqual(normal.effects, []);
  assert.equal(letter.defaultPrevented, false);
});

test("AltGraph brackets and backslash cannot trigger workspace navigation after editor propagation", () => {
  for (const key of ["[", "]", "\\"]) {
    const { handler, effects } = handlerProbe(navigationKeyboard);
    const event = keyboardEvent({ key, ctrlKey: true, altKey: true, getModifierState: (modifier) => modifier === "AltGraph" });
    handler(event);
    assert.deepEqual(effects, []);
    assert.equal(event.defaultPrevented, false);
  }
});

test("global navigation keeps intentional shortcuts but ignores composing and Ctrl Alt character input", () => {
  for (const properties of [{ key: "[", ctrlKey: true, isComposing: true }, { key: "]", ctrlKey: true, altKey: true }, { key: "\\", ctrlKey: true, altKey: true }]) {
    const { handler, effects } = handlerProbe(navigationKeyboard);
    const event = keyboardEvent(properties);
    handler(event);
    assert.deepEqual(effects, []);
    assert.equal(event.defaultPrevented, false);
  }
  for (const [properties, expected] of [[{ key: "[", ctrlKey: true }, "back"], [{ key: "]", ctrlKey: true }, "forward"], [{ key: "ArrowLeft", altKey: true }, "back"], [{ key: "\\", ctrlKey: true }, "workspace"]]) {
    const { handler, effects } = handlerProbe(navigationKeyboard);
    handler(keyboardEvent(properties));
    assert.deepEqual(effects, [expected]);
  }
});

test("an open modal keeps both workspace shortcuts and history navigation in the dialog", () => {
  for (const [source, properties] of [
    [applicationKeyboard, { key: "k", ctrlKey: true }],
    [navigationKeyboard, { key: "ArrowLeft", altKey: true }],
  ]) {
    const { handler, effects } = handlerProbe(source, { modalOpen: true });
    const event = keyboardEvent(properties);
    handler(event);
    assert.deepEqual(effects, []);
    assert.equal(event.defaultPrevented, false);
  }
});

test("global panels do not open from AltGraph or composing input and keep ordinary Ctrl commands", () => {
  for (const key of [",", "/", "f", "n", "k"]) {
    for (const flags of [{ altKey: true, getModifierState: (modifier) => modifier === "AltGraph" }, { isComposing: true }, { nativeEvent: { isComposing: true } }]) {
      const { handler, effects } = handlerProbe(applicationKeyboard);
      const event = keyboardEvent({ key, ctrlKey: true, shiftKey: key === "n", ...flags });
      handler(event);
      assert.deepEqual(effects, []);
      assert.equal(event.defaultPrevented, false);
    }
  }
  const normal = handlerProbe(applicationKeyboard);
  normal.handler(keyboardEvent({ key: "k", ctrlKey: true }));
  assert.deepEqual(normal.effects, ["search"]);
});
