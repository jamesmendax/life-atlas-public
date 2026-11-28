import { writeFileSync } from "node:fs";
import { browserScenario } from "./harness.mjs";
import { coreParityWorkspace } from "../fixtures/core-parity-workspace.mjs";
import { copyJson, stableJson, walkBlocks } from "../../src/domain/blockDocument.js";

const scenarioName = "editor-trusted-composition-v4";
const rootSelector = '.life-editor[data-page-id="editor-page"] > .bn-container .bn-editor';
const workspace = coreParityWorkspace();
workspace.ui.selectedPageId = "editor-page";
workspace.ui.preferences = { theme: "system" };
const fixturePage = workspace.pages.find((entry) => entry.id === "editor-page");
fixturePage.title = "可信组合输入与原生历史";
fixturePage.icon = "";
fixturePage.content = [
  { id: "trusted-leading", type: "paragraph", content: "输入前的相邻正文保持原样" },
  { id: "trusted-root-input", type: "paragraph", content: [
    { type: "text", text: "前缀 ", styles: {} },
    { type: "text", text: "粗体占位正文", styles: { bold: true } },
    { type: "text", text: " / ", styles: {} },
    { type: "link", href: "lifeatlas://page/alpha-page", content: [{ type: "text", text: "相邻链接", styles: { italic: true } }] },
    { type: "text", text: " 尾段", styles: {} },
  ] },
  { id: "trusted-between", type: "paragraph", content: "页根输入与多栏之间的正文" },
  { id: "trusted-columns", type: "columnList", props: { columns: 2 }, children: [
    { id: "trusted-column-left", type: "column", props: { width: 45, index: 0, count: 2 }, children: [
      { id: "trusted-column-input", type: "paragraph", content: [
        { type: "text", text: "列首 ", styles: {} },
        { type: "text", text: "列内占位正文", styles: { italic: true, underline: true } },
        { type: "text", text: " / ", styles: {} },
        { type: "link", href: "lifeatlas://page/beta-page", content: [{ type: "text", text: "列链接", styles: { bold: true } }] },
        { type: "text", text: " 列尾", styles: {} },
      ] },
      { id: "trusted-column-left-tail", type: "paragraph", content: "左栏相邻段落" },
    ] },
    { id: "trusted-column-right", type: "column", props: { width: 55, index: 1, count: 2 }, children: [
      { id: "trusted-column-neighbor", type: "paragraph", content: [{ type: "text", text: "右栏带格式的相邻正文", styles: { bold: true, strike: true } }] },
      { id: "trusted-column-right-tail", type: "paragraph", content: "右栏末段" },
    ] },
  ] },
  { id: "trusted-after-columns", type: "paragraph", content: "多栏后方的相邻正文" },
  { id: "trusted-shortcut-input", type: "paragraph", content: [
    { type: "text", text: "快捷 ", styles: {} },
    { type: "text", text: "组合正文", styles: { bold: true } },
    { type: "text", text: " 保留后缀", styles: {} },
  ] },
  { id: "trusted-cancel-input", type: "paragraph", content: [
    { type: "text", text: "取消 ", styles: {} },
    { type: "text", text: "粗体正文", styles: { bold: true, italic: true } },
    { type: "text", text: " 保留结尾", styles: {} },
  ] },
];

await browserScenario(scenarioName, async ({ page, context, check, screenshot, saved, persisted, assert }) => {
  const editorRoot = page.locator(rootSelector).first();
  const outer = (blockId) => editorRoot.locator(`.bn-block-outer[data-id="${blockId}"]`).first();
  const content = (blockId) => outer(blockId).locator(':scope > .bn-block > .bn-block-content, :scope > .bn-block > .react-renderer > .bn-block-content').first();
  const documentBlocks = (value) => value.pages.find((entry) => entry.id === "editor-page").content;
  const block = (blocks, blockId) => walkBlocks(blocks).find((entry) => entry.id === blockId);
  const inlineText = (entries) => entries.map((entry) => entry.type === "link" ? inlineText(entry.content) : entry.text ?? "").join("");
  const textOf = (entry) => typeof entry.content === "string" ? entry.content : inlineText(entry.content ?? []);
  const trace = { scenario: scenarioName, transport: "Chromium CDP Input.imeSetComposition / Input.insertText", osChineseImeVerified: false, observations: [] };
  const publish = () => writeFileSync(`.qa/${scenarioName}-trace.json`, JSON.stringify(trace, null, 2));
  const record = (label, snapshot) => { trace.observations.push({ label, snapshot }); publish(); };
  let session;

  const installDispatchDiagnostic = () => page.addInitScript(() => {
    const prototype = EventTarget.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "dispatchEvent");
    const original = descriptor.value;
    const calls = [];
    const ids = new WeakMap();
    let phase = "startup";
    let sequence = 0;
    let overflow = false;
    const trackedDispatchEvent = function (event) {
      if (event?.type === "compositionend") {
        sequence += 1;
        ids.set(event, sequence);
        if (calls.length < 16) {
          calls.push({
            id: sequence, phase, isTrusted: event.isTrusted, constructor: event.constructor?.name ?? null, data: event.data ?? null,
            targetTag: this instanceof Element ? this.tagName : null,
            targetIsEditor: this instanceof Element && Boolean(this.closest(".bn-editor")),
            targetIsControl: this instanceof Element && this.hasAttribute("data-editor-composition-control"),
            stack: String(new Error("compositionend dispatchEvent origin").stack ?? "").split("\n").slice(0, 12).join("\n").slice(0, 2400),
          });
        } else overflow = true;
      }
      return Reflect.apply(original, this, arguments);
    };
    Object.defineProperty(prototype, "dispatchEvent", { ...descriptor, value: trackedDispatchEvent });
    window.__editorCompositionDispatchV4 = {
      read: () => ({ phase, currentIsWrapper: prototype.dispatchEvent === trackedDispatchEvent, overflow, calls: calls.map((entry) => ({ ...entry })) }),
      callFor: (event) => ids.get(event) ?? null,
      begin: (next) => { phase = next; calls.length = 0; overflow = false; },
      dispose: () => {
        if (prototype.dispatchEvent === trackedDispatchEvent) Object.defineProperty(prototype, "dispatchEvent", descriptor);
        delete window.__editorCompositionDispatchV4;
      },
    };
  });

  const installProbe = () => page.evaluate((selector) => {
    const root = document.querySelector(selector);
    const editor = root.pmViewDesc.node.type.schema.cached.blockNoteEditor;
    let active = false;
    let overflow = false;
    const events = [];
    const endpoint = (node, offset) => {
      const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
      const inline = element?.closest(".bn-inline-content");
      if (!inline || inline.closest(".bn-editor") !== root || !inline.contains(node)) return null;
      const range = document.createRange();
      range.setStart(inline, 0);
      range.setEnd(node, offset);
      const path = [];
      for (let outer = element.closest(".bn-block-outer[data-id]"); outer && root.contains(outer); outer = outer.parentElement?.closest(".bn-block-outer[data-id]")) path.push(outer.dataset.id);
      return { blockId: path[0] ?? null, textOffset: range.toString().length, position: editor.prosemirrorView.posAtDOM(node, offset), path };
    };
    const selection = () => {
      const current = window.getSelection();
      return current ? { collapsed: current.isCollapsed, text: current.toString(), anchor: endpoint(current.anchorNode, current.anchorOffset), focus: endpoint(current.focusNode, current.focusOffset) } : null;
    };
    const capture = (event) => {
      const target = event.target instanceof Element ? event.target : event.target?.parentElement;
      if (target?.closest(".bn-editor") !== root) return;
      if (event.type === "compositionstart") active = true;
      if (event.type === "compositionend") active = false;
      if (events.length >= 96) { overflow = true; return; }
      const current = window.getSelection();
      const anchorElement = current?.anchorNode?.nodeType === Node.ELEMENT_NODE ? current.anchorNode : current?.anchorNode?.parentElement;
      const entry = {
        type: event.type, isTrusted: event.isTrusted, data: event.data ?? null, inputType: event.inputType ?? null,
        constructor: event.constructor?.name ?? null, dispatchCallId: window.__editorCompositionDispatchV4?.callFor(event) ?? null,
        isComposing: Boolean(event.isComposing), preeditActive: active, viewComposing: editor.prosemirrorView.composing,
        key: event.key ?? null, code: event.code ?? null, ctrlKey: Boolean(event.ctrlKey), altKey: Boolean(event.altKey), shiftKey: Boolean(event.shiftKey),
        defaultPrevented: event.defaultPrevented, targetIsRoot: target === root, selectionBlockId: anchorElement?.closest(".bn-block-outer[data-id]")?.dataset.id ?? null,
      };
      events.push(entry);
      if (event.type === "keydown") queueMicrotask(() => { entry.defaultPrevented = event.defaultPrevented; });
    };
    const types = ["compositionstart", "compositionupdate", "compositionend", "beforeinput", "input", "keydown"];
    for (const type of types) root.addEventListener(type, capture, true);
    window.__editorTrustedCompositionV4 = {
      read: () => ({ active, overflow, events: events.map((entry) => ({ ...entry })), selection: selection() }),
      reset: () => {
        if (active || editor.prosemirrorView.composing) throw new Error("Cannot reset observations during composition");
        events.length = 0;
        overflow = false;
      },
      dispose: () => {
        for (const type of types) root.removeEventListener(type, capture, true);
        delete window.__editorTrustedCompositionV4;
      },
    };
  }, rootSelector);

  const nativeSnapshot = () => page.evaluate((selector) => {
    const root = document.querySelector(selector);
    const editor = root.pmViewDesc.node.type.schema.cached.blockNoteEditor;
    const state = editor.prosemirrorState;
    const history = state.plugins.find((plugin) => plugin.key.startsWith("history$"))?.getState(state);
    if (!history?.done || !history?.undone) throw new Error("Native ProseMirror history is unavailable");
    return {
      document: JSON.parse(JSON.stringify(editor.document)), native: state.doc.toJSON(), selection: state.selection.toJSON(), selectionEmpty: state.selection.empty,
      history: { undo: history.done.eventCount, redo: history.undone.eventCount }, composing: editor.prosemirrorView.composing,
      focused: editor.prosemirrorView.hasFocus(), input: window.__editorTrustedCompositionV4?.read() ?? null,
      dispatch: window.__editorCompositionDispatchV4?.read() ?? null,
    };
  }, rootSelector);
  const resetProbe = () => page.evaluate(() => window.__editorTrustedCompositionV4.reset());
  const waitForDocument = (expected) => {
    const expectedJson = stableJson(expected);
    return persisted((value) => stableJson(documentBlocks(value)) === expectedJson);
  };
  const expectedEdit = (before, blockId, inlineIndex, from, to, text) => {
    const expected = copyJson(before.document);
    const inline = block(expected, blockId).content[inlineIndex];
    assert.equal(inline.type, "text");
    inline.text = inline.text.slice(0, from) + text + inline.text.slice(to);
    return expected;
  };
  const nativeIds = (snapshot) => {
    const ids = [];
    const visit = (node) => {
      if (typeof node.attrs?.id === "string") ids.push(node.attrs.id);
      for (const child of node.content ?? []) visit(child);
    };
    visit(snapshot.native);
    return ids;
  };
  const assertIdentities = (before, after) => {
    const ids = walkBlocks(after.document).map((entry) => entry.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.deepEqual(ids, walkBlocks(before.document).map((entry) => entry.id));
    const afterNative = nativeIds(after);
    assert.equal(new Set(afterNative).size, afterNative.length);
    assert.deepEqual(afterNative, nativeIds(before));
  };
  const selectRange = async (blockId, from, to = from) => {
    await content(blockId).click({ position: { x: 6, y: 6 } });
    const positions = await content(blockId).locator(".bn-inline-content").evaluate((inline, range) => {
      const root = inline.closest(".bn-editor");
      const editor = root.pmViewDesc.node.type.schema.cached.blockNoteEditor;
      const endpoint = (offset) => {
        const walker = document.createTreeWalker(inline, NodeFilter.SHOW_TEXT);
        let remaining = offset;
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if (remaining <= node.data.length) return { node, offset: remaining };
          remaining -= node.data.length;
        }
        throw new Error(`Text offset ${offset} is unavailable`);
      };
      const anchor = endpoint(range.from);
      const head = endpoint(range.to);
      const selection = window.getSelection();
      selection.setBaseAndExtent(anchor.node, anchor.offset, head.node, head.offset);
      return { anchor: editor.prosemirrorView.posAtDOM(anchor.node, anchor.offset), head: editor.prosemirrorView.posAtDOM(head.node, head.offset), text: selection.toString() };
    }, { from, to });
    await page.waitForFunction(({ selector, positions }) => {
      const editor = document.querySelector(selector).pmViewDesc.node.type.schema.cached.blockNoteEditor;
      return editor.prosemirrorView.hasFocus() && editor.prosemirrorState.selection.anchor === positions.anchor && editor.prosemirrorState.selection.head === positions.head;
    }, { selector: rootSelector, positions });
    return positions;
  };
  const waitForText = (blockId, expectedText, composing) => page.waitForFunction(({ selector, blockId, expectedText, composing }) => {
    const root = document.querySelector(selector);
    const editor = root.pmViewDesc.node.type.schema.cached.blockNoteEditor;
    const pending = [...editor.document];
    let block;
    while (pending.length) {
      const entry = pending.shift();
      if (entry.id === blockId) { block = entry; break; }
      pending.push(...(entry.children ?? []));
    }
    const inlineText = (entries) => entries.map((entry) => entry.type === "link" ? inlineText(entry.content) : entry.text ?? "").join("");
    const text = typeof block?.content === "string" ? block.content : inlineText(block?.content ?? []);
    const outer = root.querySelector(`.bn-block-outer[data-id="${blockId}"]`);
    const body = outer?.querySelector(':scope > .bn-block > .bn-block-content, :scope > .bn-block > .react-renderer > .bn-block-content');
    return text === expectedText && body?.querySelector(".bn-inline-content")?.textContent === expectedText && editor.prosemirrorView.composing === composing && window.__editorTrustedCompositionV4.read().active === composing;
  }, { selector: rootSelector, blockId, expectedText, composing });
  const waitForCaret = (blockId, textOffset) => page.waitForFunction(({ selector, blockId, textOffset }) => {
    const editor = document.querySelector(selector).pmViewDesc.node.type.schema.cached.blockNoteEditor;
    const selection = window.__editorTrustedCompositionV4.read().selection;
    return editor.prosemirrorView.hasFocus() && !editor.prosemirrorView.composing && editor.prosemirrorState.selection.empty && selection?.collapsed &&
      selection.anchor?.blockId === blockId && selection.focus?.blockId === blockId && selection.anchor.textOffset === textOffset && selection.focus.textOffset === textOffset &&
      editor.prosemirrorState.selection.anchor === selection.anchor.position && editor.prosemirrorState.selection.head === selection.focus.position;
  }, { selector: rootSelector, blockId, textOffset });
  const preedit = async (label, blockId, text, expected) => {
    await session.send("Input.imeSetComposition", { text, selectionStart: text.length, selectionEnd: text.length });
    await waitForText(blockId, textOf(block(expected, blockId)), true);
    const snapshot = await nativeSnapshot();
    assert.deepEqual(snapshot.document, expected);
    assert.equal(snapshot.input.active, true);
    record(label, snapshot);
  };
  const commit = async (blockId, text, expected, textOffset) => {
    await session.send("Input.insertText", { text });
    await waitForText(blockId, textOf(block(expected, blockId)), false);
    await waitForCaret(blockId, textOffset);
    await waitForDocument(expected);
    const snapshot = await nativeSnapshot();
    assert.deepEqual(snapshot.document, expected);
    return snapshot;
  };
  const assertTrustedPipeline = (snapshot, candidates, blockId) => {
    const input = snapshot.input;
    assert.equal(input.overflow, false);
    assert.equal(input.active, false);
    assert.equal(snapshot.composing, false);
    assert.ok(input.events.length > 0 && input.events.every((entry) => entry.isTrusted === true));
    assert.equal(input.events.filter((entry) => entry.type === "compositionstart").length, 1);
    assert.equal(input.events.filter((entry) => entry.type === "compositionend").length, 1);
    const updates = input.events.filter((entry) => entry.type === "compositionupdate");
    for (const text of candidates) assert.ok(updates.some((entry) => entry.data === text), `Trusted compositionupdate must expose ${text}`);
    assert.ok(input.events.some((entry) => entry.type === "beforeinput" && entry.isComposing));
    assert.ok(input.events.filter((entry) => entry.type === "input").length >= candidates.length);
    assert.ok(input.events.some((entry) => entry.type === "input" && entry.selectionBlockId === blockId));
  };
  const assertCompositionShortcuts = async (label) => {
    for (const shortcut of [{ chord: "Control+Alt+3", code: "Digit3" }, { chord: "Control+d", code: "KeyD" }, { chord: "Shift+F10", code: "F10" }]) {
      const prior = await nativeSnapshot();
      await page.keyboard.press(shortcut.chord);
      const after = await nativeSnapshot();
      assert.equal(after.composing, true, `${shortcut.chord} must preserve ProseMirror composition`);
      assert.equal(after.input.active, true, `${shortcut.chord} must not dispatch compositionend`);
      assert.equal(after.input.events.filter((entry) => entry.type === "compositionend").length, 0);
      assert.deepEqual(after.native, prior.native);
      assert.deepEqual(after.document, prior.document);
      assert.deepEqual(after.history, prior.history);
      assert.deepEqual(after.selection, prior.selection);
      assert.deepEqual(after.input.selection, prior.input.selection);
      const key = after.input.events.findLast((entry) => entry.type === "keydown" && entry.code === shortcut.code);
      assert.ok(key?.isTrusted && key.defaultPrevented, `${shortcut.chord} must be consumed by the shared shortcut capture`);
      assert.equal(await page.locator(".life-block-menu, .life-block-conversion-menu, .bn-suggestion-menu").count(), 0);
      record(`${label}-shortcut-${shortcut.code}`, after);
    }
  };
  const historyRoundTrip = async (label, before, after) => {
    assert.equal(after.history.undo, before.history.undo + 1, "One composition must create one native undo unit");
    assert.equal(after.history.redo, 0);
    await page.keyboard.press("Control+z");
    await waitForDocument(before.document);
    const undone = await nativeSnapshot();
    assert.deepEqual(undone.native, before.native);
    assert.deepEqual(undone.document, before.document);
    assert.deepEqual(undone.selection, before.selection);
    assert.equal(undone.history.undo, before.history.undo);
    assert.equal(undone.history.redo, 1);
    assertIdentities(before, undone);
    record(`${label}-undo`, undone);
    await page.keyboard.press("Control+Shift+z");
    await waitForDocument(after.document);
    const redone = await nativeSnapshot();
    assert.deepEqual(redone.native, after.native);
    assert.deepEqual(redone.document, after.document);
    assert.deepEqual(redone.selection, after.selection);
    assert.deepEqual(redone.history, after.history);
    assertIdentities(after, redone);
    record(`${label}-redo`, redone);
  };
  const plainContenteditableControl = async () => {
    const before = await nativeSnapshot();
    record("plain-control-app-baseline", before);
    await page.evaluate(() => {
      window.__editorCompositionDispatchV4.begin("plain-contenteditable");
      const control = document.createElement("div");
      const seed = "前缀 粗体占位正文 / 对照结尾";
      const node = document.createTextNode(seed);
      control.setAttribute("contenteditable", "true");
      control.setAttribute("data-editor-composition-control", "");
      control.setAttribute("role", "textbox");
      control.setAttribute("aria-label", "组合输入诊断对照");
      control.style.cssText = "position:fixed;top:20px;left:20px;right:20px;min-height:60px;z-index:2147483647;background:Canvas;color:CanvasText";
      control.append(node);
      let active = false;
      let overflow = false;
      const events = [];
      const capture = (event) => {
        if (event.type === "compositionstart") active = true;
        if (event.type === "compositionend") active = false;
        if (events.length >= 32) { overflow = true; return; }
        events.push({
          type: event.type, isTrusted: event.isTrusted, data: event.data ?? null, inputType: event.inputType ?? null,
          isComposing: Boolean(event.isComposing), constructor: event.constructor?.name ?? null,
          dispatchCallId: window.__editorCompositionDispatchV4.callFor(event), targetIsControl: event.target === control,
        });
      };
      const types = ["compositionstart", "compositionupdate", "compositionend", "beforeinput", "input"];
      for (const type of types) control.addEventListener(type, capture, true);
      document.body.append(control);
      control.focus();
      window.getSelection().setBaseAndExtent(node, 5, node, 5);
      const textOffset = (node, offset) => {
        if (!node || !control.contains(node)) return null;
        const range = document.createRange();
        range.setStart(control, 0);
        range.setEnd(node, offset);
        return range.toString().length;
      };
      window.__editorPlainCompositionV4 = {
        read: () => {
          const selection = window.getSelection();
          return {
            seed, text: control.textContent, focused: document.activeElement === control, active, overflow,
            events: events.map((entry) => ({ ...entry })), dispatch: window.__editorCompositionDispatchV4.read(),
            selection: selection ? { collapsed: selection.isCollapsed, anchorOffset: textOffset(selection.anchorNode, selection.anchorOffset), focusOffset: textOffset(selection.focusNode, selection.focusOffset) } : null,
          };
        },
        dispose: () => {
          for (const type of types) control.removeEventListener(type, capture, true);
          control.remove();
          delete window.__editorPlainCompositionV4;
        },
      };
    });
    const initial = await page.evaluate(() => window.__editorPlainCompositionV4.read());
    record("plain-control-before", initial);
    const expected = (text) => initial.seed.slice(0, 5) + text + initial.seed.slice(5);
    for (const text of ["中", "中文"]) {
      await session.send("Input.imeSetComposition", { text, selectionStart: text.length, selectionEnd: text.length });
      await page.waitForFunction((expectedText) => {
        const control = window.__editorPlainCompositionV4.read();
        return control.focused && control.active && control.text === expectedText;
      }, expected(text));
      const snapshot = await page.evaluate(() => window.__editorPlainCompositionV4.read());
      assert.equal(snapshot.overflow, false);
      record(`plain-control-preedit-${text}`, snapshot);
    }
    await session.send("Input.insertText", { text: "中文输入" });
    await page.waitForFunction((expectedText) => {
      const control = window.__editorPlainCompositionV4.read();
      return control.focused && !control.active && control.text === expectedText && control.selection?.collapsed && control.selection.anchorOffset === 9 && control.selection.focusOffset === 9;
    }, expected("中文输入"));
    const committed = await page.evaluate(() => window.__editorPlainCompositionV4.read());
    assert.equal(committed.overflow, false);
    assert.equal(committed.dispatch.overflow, false);
    record("plain-control-committed", committed);
    const after = await nativeSnapshot();
    assert.deepEqual(after.native, before.native);
    assert.deepEqual(after.document, before.document);
    assert.deepEqual(after.history, before.history);
    await page.evaluate(() => {
      window.__editorPlainCompositionV4.dispose();
      window.__editorCompositionDispatchV4.begin("app-editor");
    });
  };

  try {
    await installDispatchDiagnostic();
    await page.reload({ waitUntil: "domcontentloaded" });
    await content("trusted-root-input").waitFor();
    session = await context.newCDPSession(page);
    await installProbe();

    await check("trusted Chromium composition commits Chinese text at a marked page-root caret with one native undo redo", async () => {
      await plainContenteditableControl();
      await selectRange("trusted-root-input", 5);
      await resetProbe();
      const before = await nativeSnapshot();
      assert.equal(block(before.document, "trusted-root-input").content[1].styles.bold, true);
      assert.deepEqual(before.input.selection.anchor.path, ["trusted-root-input"]);
      record("page-root-before", before);
      await preedit("page-root-preedit-1", "trusted-root-input", "中", expectedEdit(before, "trusted-root-input", 1, 2, 2, "中"));
      await preedit("page-root-preedit-2", "trusted-root-input", "中文", expectedEdit(before, "trusted-root-input", 1, 2, 2, "中文"));
      await screenshot("page-root-preedit");
      const expected = expectedEdit(before, "trusted-root-input", 1, 2, 2, "中文输入");
      const after = await commit("trusted-root-input", "中文输入", expected, 9);
      assertTrustedPipeline(after, ["中", "中文"], "trusted-root-input");
      assertIdentities(before, after);
      record("page-root-committed", after);
      await historyRoundTrip("page-root", before, after);
    });

    await check("trusted Chromium composition replaces a marked selection inside columns without changing adjacent blocks or identities", async () => {
      const range = await selectRange("trusted-column-input", 5, 7);
      assert.equal(range.text, "占位");
      await resetProbe();
      const before = await nativeSnapshot();
      assert.deepEqual(block(before.document, "trusted-column-input").content[1].styles, { italic: true, underline: true });
      assert.deepEqual(before.input.selection.anchor.path, ["trusted-column-input", "trusted-column-left", "trusted-columns"]);
      record("columns-before", before);
      await preedit("columns-preedit-1", "trusted-column-input", "候", expectedEdit(before, "trusted-column-input", 1, 2, 4, "候"));
      await preedit("columns-preedit-2", "trusted-column-input", "候选字", expectedEdit(before, "trusted-column-input", 1, 2, 4, "候选字"));
      await assertCompositionShortcuts("columns-preedit");
      await screenshot("columns-preedit");
      const expected = expectedEdit(before, "trusted-column-input", 1, 2, 4, "中文提交");
      const after = await commit("trusted-column-input", "中文提交", expected, 9);
      assertTrustedPipeline(after, ["候", "候选字"], "trusted-column-input");
      assertIdentities(before, after);
      assert.deepEqual(after.input.selection.anchor.path, ["trusted-column-input", "trusted-column-left", "trusted-columns"]);
      record("columns-committed", after);
      await historyRoundTrip("columns", before, after);
    });

    await check("trusted composition consumes block shortcuts without ending preedit and restores conversion after commit", async () => {
      await selectRange("trusted-shortcut-input", 5);
      await resetProbe();
      const before = await nativeSnapshot();
      await preedit("shortcuts-preedit-1", "trusted-shortcut-input", "组", expectedEdit(before, "trusted-shortcut-input", 1, 2, 2, "组"));
      await preedit("shortcuts-preedit-2", "trusted-shortcut-input", "组合", expectedEdit(before, "trusted-shortcut-input", 1, 2, 2, "组合"));
      await assertCompositionShortcuts("page-root-preedit");
      await preedit("shortcuts-preedit-3", "trusted-shortcut-input", "组合续", expectedEdit(before, "trusted-shortcut-input", 1, 2, 2, "组合续"));
      const expected = expectedEdit(before, "trusted-shortcut-input", 1, 2, 2, "组合完成");
      const committed = await commit("trusted-shortcut-input", "组合完成", expected, 9);
      assertTrustedPipeline(committed, ["组", "组合", "组合续"], "trusted-shortcut-input");
      assertIdentities(before, committed);
      record("shortcuts-committed", committed);
      await page.keyboard.press("Control+Alt+3");
      await persisted((value) => {
        const target = block(documentBlocks(value), "trusted-shortcut-input");
        return target.type === "heading" && target.props.level === 3;
      });
      const converted = await nativeSnapshot();
      assert.deepEqual(block(converted.document, "trusted-shortcut-input").content, block(committed.document, "trusted-shortcut-input").content);
      for (const entry of walkBlocks(committed.document)) if (entry.id !== "trusted-shortcut-input") assert.deepEqual(block(converted.document, entry.id), entry);
      assert.equal(converted.history.undo, committed.history.undo + 1);
      assertIdentities(committed, converted);
      record("shortcuts-converted-after-commit", converted);
      await screenshot("conversion-after-commit");
      await page.keyboard.press("Control+z");
      await waitForDocument(committed.document);
      assert.deepEqual((await nativeSnapshot()).native, committed.native);
    });

    await check("trusted Chromium composition cancellation restores the marked caret and committed content survives reload", async () => {
      await selectRange("trusted-cancel-input", 5);
      await resetProbe();
      const before = await nativeSnapshot();
      record("cancel-before", before);
      await preedit("cancel-preedit-1", "trusted-cancel-input", "取消中", expectedEdit(before, "trusted-cancel-input", 1, 2, 2, "取消中"));
      await preedit("cancel-preedit-2", "trusted-cancel-input", "取消候选", expectedEdit(before, "trusted-cancel-input", 1, 2, 2, "取消候选"));
      await session.send("Input.imeSetComposition", { text: "", selectionStart: 0, selectionEnd: 0 });
      await waitForText("trusted-cancel-input", textOf(block(before.document, "trusted-cancel-input")), false);
      await waitForCaret("trusted-cancel-input", 5);
      await waitForDocument(before.document);
      const cancelled = await nativeSnapshot();
      assertTrustedPipeline(cancelled, ["取消中", "取消候选"], "trusted-cancel-input");
      assert.deepEqual(cancelled.document, before.document);
      assert.deepEqual(cancelled.native, before.native);
      assert.deepEqual(cancelled.selection, before.selection);
      assertIdentities(before, cancelled);
      assert.deepEqual(documentBlocks(await saved()), cancelled.document);
      record("cancelled", cancelled);
      await page.evaluate(() => window.__editorTrustedCompositionV4.dispose());
      await page.reload({ waitUntil: "domcontentloaded" });
      await content("trusted-root-input").waitFor();
      await installProbe();
      const reloaded = await nativeSnapshot();
      assert.deepEqual(reloaded.document, cancelled.document);
      assert.deepEqual(documentBlocks(await saved()), cancelled.document);
      assert.deepEqual(walkBlocks(reloaded.document).map((entry) => entry.id), walkBlocks(cancelled.document).map((entry) => entry.id));
      assert.equal(reloaded.composing, false);
      assert.equal(reloaded.input.active, false);
      record("reloaded", reloaded);
      await screenshot("cancel-and-reload");
    });
  } finally {
    const controlSnapshot = await page.evaluate(() => window.__editorPlainCompositionV4?.read() ?? null).catch(() => null);
    if (controlSnapshot) record("plain-control-final", controlSnapshot);
    const finalSnapshot = await nativeSnapshot().catch(() => null);
    if (finalSnapshot) record("final", finalSnapshot);
    await page.evaluate(() => window.__editorPlainCompositionV4?.dispose()).catch(() => {});
    await page.evaluate(() => window.__editorTrustedCompositionV4?.dispose()).catch(() => {});
    await page.evaluate(() => window.__editorCompositionDispatchV4?.dispose()).catch(() => {});
    if (session) await session.detach().catch(() => {});
  }
}, { workspace, viewport: { width: 1440, height: 900 } });
