import { browserScenario } from "./harness.mjs";
import { coreParityWorkspace } from "../fixtures/core-parity-workspace.mjs";
import { walkBlocks } from "../../src/domain/blockDocument.js";

const workspace = coreParityWorkspace();
workspace.ui.selectedPageId = "editor-page";
workspace.ui.preferences = { theme: "system" };
const fixturePage = workspace.pages.find((entry) => entry.id === "editor-page");
fixturePage.title = "编辑器选择与锁定安全";
fixturePage.icon = "";
fixturePage.content = [
  { id: "history-probe", type: "paragraph", content: "原生历史归一化" },
  { id: "rich", type: "paragraph", content: [
    { type: "text", text: "保留粗体", styles: { bold: true } },
    { type: "text", text: " 和 ", styles: {} },
    { type: "link", href: "lifeatlas://page/alpha-page", content: [{ type: "text", text: "原有链接", styles: { italic: true } }] },
  ] },
  { id: "rich-tail", type: "paragraph", content: "选择中的纯文本区块" },
  { id: "mixed-before", type: "paragraph", content: "混合选择起点" },
  { id: "mixed-image", type: "image", props: { url: "", name: "混合选择中的本地图片" } },
  { id: "mixed-after", type: "paragraph", content: "混合选择终点" },
  { id: "columns", type: "columnList", props: { columns: 2 }, children: [
    { id: "column-left", type: "column", props: { width: 50, index: 0, count: 2 }, children: [
      { id: "escape-text", type: "paragraph", content: "ESCAPE selection must return here" },
      { id: "drag-source", type: "paragraph", content: "解锁后可以移动的区块" },
    ] },
    { id: "column-right", type: "column", props: { width: 50, index: 1, count: 2 }, children: [
      { id: "lock-text", type: "paragraph", content: "锁定与解锁的正文" },
      { id: "drop-target", type: "paragraph", content: "解锁后的拖动目标" },
    ] },
  ] },
  { id: "composition-text", type: "paragraph", content: "组合事件边界测试" },
];

await browserScenario("editor-selection-safety-v4", async ({ page, check, screenshot, saved, persisted, assert }) => {
  const editorRoot = page.locator('.life-editor[data-page-id="editor-page"] .bn-editor').first();
  const documentBlocks = (value) => value.pages.find((entry) => entry.id === "editor-page").content;
  const block = (documentValue, blockId) => walkBlocks(documentValue).find((entry) => entry.id === blockId);
  const savedBlock = (value, blockId) => block(documentBlocks(value), blockId);
  const textOf = (entry) => typeof entry?.content === "string" ? entry.content : (entry?.content ?? []).map((inline) => inline.text ?? "").join("");
  const outer = (blockId) => editorRoot.locator(`.bn-block-outer[data-id="${blockId}"]`).first();
  const content = (blockId) => outer(blockId).locator(':scope > .bn-block > .bn-block-content, :scope > .bn-block > .react-renderer > .bn-block-content').first();
  const toolbar = (blockId) => page.locator(`.life-block-actions[data-block-id="${blockId}"]`);
  const conversionMenu = page.locator(".life-block-conversion-menu");
  const nativeSnapshot = () => page.evaluate(() => {
    const root = document.querySelector('.life-editor[data-page-id="editor-page"] .bn-editor');
    const editor = root.pmViewDesc.node.type.schema.cached.blockNoteEditor;
    const state = editor.prosemirrorState;
    const history = state.plugins.find((plugin) => plugin.key.startsWith("history$"))?.getState(state);
    if (!history?.done || !history?.undone) throw new Error("Native ProseMirror history is unavailable");
    return {
      document: JSON.parse(JSON.stringify(editor.document)),
      native: state.doc.toJSON(),
      selection: state.selection.toJSON(),
      history: { undo: history.done.eventCount, redo: history.undone.eventCount },
      editable: editor.isEditable,
      viewEditable: editor.prosemirrorView.editable,
      composing: editor.prosemirrorView.composing,
    };
  });
  const assertUnchanged = async (before) => {
    const after = await nativeSnapshot();
    assert.deepEqual(after.native, before.native);
    assert.deepEqual(after.document, before.document);
    assert.deepEqual(after.history, before.history);
    return after;
  };
  const selectText = async (anchorBlockId, anchorOffset, headBlockId, headOffset) => {
    await content(anchorBlockId).click();
    const positions = await page.evaluate((range) => {
      const root = document.querySelector('.life-editor[data-page-id="editor-page"] .bn-editor');
      const editor = root.pmViewDesc.node.type.schema.cached.blockNoteEditor;
      const endpoint = (blockId, offset) => {
        const outer = root.querySelector(`.bn-block-outer[data-id="${blockId}"]`);
        const body = outer.querySelector(':scope > .bn-block > .bn-block-content, :scope > .bn-block > .react-renderer > .bn-block-content');
        const inline = body.querySelector(".bn-inline-content");
        const walker = document.createTreeWalker(inline, NodeFilter.SHOW_TEXT);
        let remaining = offset;
        for (let textNode = walker.nextNode(); textNode; textNode = walker.nextNode()) {
          if (remaining <= textNode.data.length) return { node: textNode, offset: remaining };
          remaining -= textNode.data.length;
        }
        throw new Error(`Text offset ${offset} is unavailable in ${blockId}`);
      };
      const anchor = endpoint(range.anchorBlockId, range.anchorOffset);
      const head = endpoint(range.headBlockId, range.headOffset);
      const selection = window.getSelection();
      selection.setBaseAndExtent(anchor.node, anchor.offset, head.node, head.offset);
      return {
        anchor: editor.prosemirrorView.posAtDOM(anchor.node, anchor.offset),
        head: editor.prosemirrorView.posAtDOM(head.node, head.offset),
        text: selection.toString(),
      };
    }, { anchorBlockId, anchorOffset, headBlockId, headOffset });
    await page.waitForFunction(({ anchor, head }) => {
      const root = document.querySelector('.life-editor[data-page-id="editor-page"] .bn-editor');
      const editor = root.pmViewDesc.node.type.schema.cached.blockNoteEditor;
      const selection = editor.prosemirrorState.selection;
      return !selection.empty && selection.anchor === anchor && selection.head === head && editor.prosemirrorView.hasFocus();
    }, positions);
    return positions;
  };
  const openMenu = async (blockId) => {
    await content(blockId).hover();
    await toolbar(blockId).getByRole("button", { name: "区块菜单", exact: true }).click();
    await page.getByRole("menuitem", { name: "转换为", exact: true }).waitFor();
    await page.getByRole("menuitem", { name: "转换为", exact: true }).hover();
    await conversionMenu.waitFor();
  };
  const dismissMenus = async () => {
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await page.locator(".life-block-menu").waitFor({ state: "hidden" });
  };
  const lockPage = async (locked) => {
    await page.getByRole("button", { name: "页面操作", exact: true }).click();
    await page.getByRole("menuitem", { name: locked ? "锁定页面" : "解锁页面", exact: true }).click();
    await page.keyboard.press("Escape");
    await page.getByRole("menu", { name: "页面操作", exact: true }).waitFor({ state: "hidden" });
    assert.equal(await page.getByRole("button", { name: "页面操作", exact: true }).evaluate((element) => element === document.activeElement), true);
    await persisted((value, expected) => value.pages.find((entry) => entry.id === "editor-page").settings.locked === expected, locked);
    await page.waitForFunction((expected) => {
      const root = document.querySelector('.life-editor[data-page-id="editor-page"] .bn-editor');
      const editor = root.pmViewDesc.node.type.schema.cached.blockNoteEditor;
      return editor.isEditable === !expected && editor.prosemirrorView.editable === !expected;
    }, locked);
  };
  const point = (bounds) => ({ x: bounds.x + bounds.width / 2, y: bounds.y + Math.min(bounds.height / 2, 18) });
  const dragBetween = async (start, finish) => {
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(finish.x, finish.y, { steps: 12 });
    await page.mouse.move(finish.x + 1, finish.y);
  };
  let lockedBaseline;

  await check("selected rich blocks disable code conversion with an explanation and preserve native history", async () => {
    await content("history-probe").waitFor();
    await content("history-probe").click();
    await page.keyboard.press("End");
    const initial = await nativeSnapshot();
    await page.keyboard.insertText(" · 保存探针");
    await persisted((value) => textOf(savedBlock(value, "history-probe")).endsWith(" · 保存探针"));
    await page.keyboard.press("Control+z");
    await persisted((value) => textOf(savedBlock(value, "history-probe")) === "原生历史归一化");
    assert.deepEqual((await nativeSnapshot()).native, initial.native);
    assert.deepEqual(documentBlocks(await saved()), (await nativeSnapshot()).document);

    const selection = await selectText("rich", 0, "rich-tail", 2);
    assert.match(selection.text, /保留粗体/);
    assert.match(selection.text, /原有链接/);
    const before = await nativeSnapshot();
    assert.equal(before.history.redo, 1);
    await openMenu("rich");
    const code = conversionMenu.getByRole("menuitem", { name: "代码", exact: true });
    assert.equal(await code.isDisabled(), true);
    assert.equal(await code.getAttribute("title"), "代码区块无法保留当前文字格式、链接或提及内容。请先将内容整理为纯文本后再转换。");
    assert.equal(await conversionMenu.getByRole("menuitem", { name: "标题 2", exact: true }).isDisabled(), false);
    await screenshot("selected-rich-code-disabled");
    await dismissMenus();
    await page.keyboard.press("Control+Alt+8");
    await page.getByRole("status").filter({ hasText: "代码区块无法保留当前文字格式、链接或提及内容" }).waitFor();
    const after = await assertUnchanged(before);
    assert.deepEqual(after.selection, before.selection);
    assert.deepEqual(documentBlocks(await saved()), before.document);
  });

  await check("mixed text and media selections reject wholesale instead of converting only the anchor", async () => {
    await selectText("mixed-before", 1, "mixed-after", 3);
    const before = await nativeSnapshot();
    assert.equal(block(before.document, "mixed-image").type, "image");
    await openMenu("mixed-before");
    const options = await conversionMenu.getByRole("menuitem").evaluateAll((elements) => elements.map((element) => ({ disabled: element.disabled, reason: element.title })));
    assert.equal(options.length, 11);
    assert.ok(options.every((option) => option.disabled === true));
    assert.ok(options.every((option) => option.reason === "所选区块包含布局、媒体、数据库或其他专用内容，无法整体转换。"));
    assert.equal(await conversionMenu.locator(".life-block-menu-reason").innerText(), "所选区块包含布局、媒体、数据库或其他专用内容，无法整体转换。");
    await screenshot("mixed-selection-disabled");
    await dismissMenus();
    await page.keyboard.press("Control+Alt+2");
    await page.getByRole("status").filter({ hasText: "所选区块包含布局、媒体、数据库或其他专用内容，无法整体转换" }).waitFor();
    const after = await assertUnchanged(before);
    assert.deepEqual(after.selection, before.selection);
    assert.deepEqual(documentBlocks(await saved()), before.document);
  });

  await check("Escape returns the original backward text selection for typing and one native undo", async () => {
    const selection = await selectText("escape-text", 16, "escape-text", 7);
    assert.equal(selection.text, "selection");
    const before = await nativeSnapshot();
    assert.ok(before.selection.anchor > before.selection.head);
    await openMenu("escape-text");
    await dismissMenus();
    await page.waitForFunction((expected) => {
      const root = document.querySelector('.life-editor[data-page-id="editor-page"] .bn-editor');
      const editor = root.pmViewDesc.node.type.schema.cached.blockNoteEditor;
      const selection = editor.prosemirrorState.selection;
      return editor.prosemirrorView.hasFocus() && selection.anchor === expected.anchor && selection.head === expected.head && window.getSelection().toString() === "selection";
    }, before.selection);
    const returned = await assertUnchanged(before);
    assert.deepEqual(returned.selection, before.selection);
    await page.keyboard.insertText("替换正文");
    await persisted((value) => textOf(savedBlock(value, "escape-text")) === "ESCAPE 替换正文 must return here");
    const typed = await nativeSnapshot();
    assert.equal(typed.history.undo, before.history.undo + 1);
    assert.equal(textOf(block(typed.document, "lock-text")), textOf(block(before.document, "lock-text")));
    await page.keyboard.press("Control+z");
    await persisted((value) => textOf(savedBlock(value, "escape-text")) === "ESCAPE selection must return here");
    const undone = await nativeSnapshot();
    assert.deepEqual(undone.native, before.native);
    assert.deepEqual(undone.selection, before.selection);
    assert.equal(undone.history.undo, before.history.undo);
  });

  await check("page lock disables conversion drag add resize typing and native history shortcuts", async () => {
    await content("lock-text").hover();
    const addBounds = await toolbar("lock-text").getByRole("button", { name: "添加区块", exact: true }).boundingBox();
    const handleBounds = await toolbar("lock-text").getByRole("button", { name: "区块菜单", exact: true }).boundingBox();
    const resizeBounds = await outer("column-left").getByRole("separator").boundingBox();
    const targetBounds = await content("drop-target").boundingBox();
    assert.ok(addBounds && handleBounds && resizeBounds && targetBounds);
    const before = await nativeSnapshot();
    await lockPage(true);
    const locked = await assertUnchanged(before);
    assert.equal(locked.editable, false);
    assert.equal(locked.viewEditable, false);
    assert.equal(await editorRoot.getAttribute("contenteditable"), "false");
    await content("lock-text").hover();
    assert.equal(await page.locator(".life-block-actions").count(), 0);
    assert.equal(await page.getByRole("button", { name: "添加区块", exact: true }).count(), 0);
    assert.equal(await page.getByRole("button", { name: "区块菜单", exact: true }).count(), 0);
    assert.equal(await editorRoot.getByRole("separator").count(), 0);
    assert.equal(await editorRoot.locator(".life-layout-trailing").count(), 0);
    await page.getByRole("button", { name: "页面操作", exact: true }).click();
    const pageMenu = page.getByRole("menu", { name: "页面操作", exact: true });
    assert.equal(await pageMenu.getByRole("menuitem", { name: "撤回", exact: true }).isDisabled(), true);
    assert.equal(await pageMenu.getByRole("menuitem", { name: "重做", exact: true }).isDisabled(), true);
    await page.keyboard.press("Escape");
    await dragBetween(point(resizeBounds), { x: point(resizeBounds).x + 24, y: point(resizeBounds).y });
    await page.mouse.up();
    await dragBetween(point(handleBounds), { x: targetBounds.x + targetBounds.width / 2, y: targetBounds.y + targetBounds.height - 2 });
    await page.mouse.up();
    await page.mouse.click(point(addBounds).x, point(addBounds).y);
    await content("lock-text").click();
    for (const key of ["Control+Alt+3", "Control+d", "Shift+F10", "Control+z", "Control+Shift+z", "Enter", "Backspace"]) await page.keyboard.press(key);
    await page.keyboard.insertText("锁定时不应写入");
    assert.equal(await page.locator(".life-block-menu, .life-block-drop-preview, [data-life-column-preview], .bn-suggestion-menu").count(), 0);
    lockedBaseline = await assertUnchanged(before);
    assert.deepEqual(documentBlocks(await saved()), before.document);
    await screenshot("locked-editor");
  });

  await check("unlock restores actual conversion add resize and trusted block drag with native undo", async () => {
    await lockPage(false);
    const before = await assertUnchanged(lockedBaseline);
    assert.equal(before.editable, true);
    assert.equal(before.viewEditable, true);
    await selectText("lock-text", 0, "lock-text", 4);
    await openMenu("lock-text");
    const heading = conversionMenu.getByRole("menuitem", { name: "标题 2", exact: true });
    assert.equal(await heading.isDisabled(), false);
    await heading.click();
    await persisted((value) => savedBlock(value, "lock-text").type === "heading" && savedBlock(value, "lock-text").props.level === 2);
    assert.deepEqual(block((await nativeSnapshot()).document, "lock-text").content, block(before.document, "lock-text").content);
    assert.equal((await nativeSnapshot()).history.undo, before.history.undo + 1);
    await page.keyboard.press("Control+z");
    await persisted((value) => savedBlock(value, "lock-text").type === "paragraph");
    assert.deepEqual((await nativeSnapshot()).native, before.native);

    await content("lock-text").hover();
    const addBefore = await nativeSnapshot();
    await toolbar("lock-text").getByRole("button", { name: "添加区块", exact: true }).click();
    await page.locator(".bn-suggestion-menu").waitFor();
    await page.keyboard.press("Escape");
    await page.locator(".bn-suggestion-menu").waitFor({ state: "hidden" });
    await persisted((value) => savedBlock(value, "column-right").children.length === block(addBefore.document, "column-right").children.length + 1);
    const added = await nativeSnapshot();
    const rightChildren = block(added.document, "column-right").children;
    const lockIndex = rightChildren.findIndex((entry) => entry.id === "lock-text");
    assert.equal(rightChildren[lockIndex + 1].type, "paragraph");
    assert.equal(textOf(rightChildren[lockIndex + 1]), "");
    assert.equal(added.history.undo, addBefore.history.undo + 1);
    await page.keyboard.press("Control+z");
    await persisted((value) => savedBlock(value, "column-right").children.length === block(addBefore.document, "column-right").children.length);
    assert.deepEqual((await nativeSnapshot()).native, addBefore.native);

    const resizeBefore = await nativeSnapshot();
    const resizer = outer("column-left").getByRole("separator");
    await resizer.focus();
    await resizer.press("ArrowRight");
    await persisted((value) => savedBlock(value, "column-left").props.width !== block(resizeBefore.document, "column-left").props.width);
    const resized = await nativeSnapshot();
    const widths = block(resized.document, "columns").children.map((entry) => entry.props.width);
    assert.ok(Math.abs(widths[0] + widths[1] - 100) < 1e-8);
    assert.equal(resized.history.undo, resizeBefore.history.undo + 1);
    await content("lock-text").click();
    await page.keyboard.press("Control+z");
    await persisted((value) => savedBlock(value, "column-left").props.width === block(resizeBefore.document, "column-left").props.width);
    assert.deepEqual((await nativeSnapshot()).native, resizeBefore.native);

    await content("drag-source").hover();
    const sourceBounds = await toolbar("drag-source").getByRole("button", { name: "区块菜单", exact: true }).boundingBox();
    const targetBounds = await content("drop-target").boundingBox();
    assert.ok(sourceBounds && targetBounds);
    const dragBefore = await nativeSnapshot();
    await dragBetween(point(sourceBounds), { x: targetBounds.x + targetBounds.width / 2, y: targetBounds.y + targetBounds.height - 2 });
    await page.locator('.life-block-drop-preview[data-drop-kind="content"]').waitFor();
    await page.mouse.up();
    await persisted((value) => savedBlock(value, "column-right").children.some((entry) => entry.id === "drag-source"));
    const dragged = await nativeSnapshot();
    assert.deepEqual(block(dragged.document, "drag-source"), block(dragBefore.document, "drag-source"));
    assert.equal(dragged.history.undo, dragBefore.history.undo + 1);
    assert.equal(await page.locator(".life-block-drop-preview").count(), 0);
    await content("lock-text").click();
    await page.keyboard.press("Control+z");
    await persisted((value) => savedBlock(value, "column-left").children.some((entry) => entry.id === "drag-source"));
    assert.deepEqual((await nativeSnapshot()).native, dragBefore.native);
    await screenshot("unlocked-editor");
  });

  await check("synthetic composition events gate shortcuts until native ProseMirror composition ends", async () => {
    await content("composition-text").click();
    await page.keyboard.press("End");
    const before = await nativeSnapshot();
    assert.equal(before.selection.anchor, before.selection.head);
    const startTrusted = await content("composition-text").locator(".bn-inline-content").evaluate((element) => {
      const event = new CompositionEvent("compositionstart", { data: "中", bubbles: true, cancelable: true });
      element.dispatchEvent(event);
      return event.isTrusted;
    });
    assert.equal(startTrusted, false);
    await page.waitForFunction(() => document.querySelector('.life-editor[data-page-id="editor-page"] .bn-editor').pmViewDesc.node.type.schema.cached.blockNoteEditor.prosemirrorView.composing === true);
    for (const key of ["Control+Alt+3", "Control+d", "Shift+F10"]) {
      await page.keyboard.press(key);
      assert.equal((await nativeSnapshot()).composing, true, `${key} must not terminate the active native composition`);
    }
    assert.equal((await nativeSnapshot()).composing, true);
    await assertUnchanged(before);
    assert.equal(await page.locator(".life-block-menu").count(), 0);
    const endTrusted = await content("composition-text").locator(".bn-inline-content").evaluate((element) => {
      const event = new CompositionEvent("compositionend", { data: "中", bubbles: true, cancelable: true });
      element.dispatchEvent(event);
      return event.isTrusted;
    });
    assert.equal(endTrusted, false);
    await page.waitForFunction(() => document.querySelector('.life-editor[data-page-id="editor-page"] .bn-editor').pmViewDesc.node.type.schema.cached.blockNoteEditor.prosemirrorView.composing === false);
    await assertUnchanged(before);
    await page.keyboard.press("Control+Alt+3");
    await persisted((value) => savedBlock(value, "composition-text").type === "heading" && savedBlock(value, "composition-text").props.level === 3);
    const converted = await nativeSnapshot();
    assert.deepEqual(block(converted.document, "composition-text").content, block(before.document, "composition-text").content);
    assert.equal(converted.history.undo, before.history.undo + 1);
    await page.keyboard.press("Control+z");
    await persisted((value) => savedBlock(value, "composition-text").type === "paragraph");
    assert.deepEqual((await nativeSnapshot()).native, before.native);
  });

  await check("synthetic native-only composition and AltGraph events leave editor content and global navigation unchanged", async () => {
    await content("composition-text").click();
    await page.keyboard.press("End");
    const before = await nativeSnapshot();
    assert.equal(before.composing, false);
    const savedBefore = await saved();
    const result = await editorRoot.evaluate((element) => {
      const composing = new KeyboardEvent("keydown", { key: "d", code: "KeyD", ctrlKey: true, isComposing: true, bubbles: true, cancelable: true });
      element.dispatchEvent(composing);
      const characters = [];
      for (const [key, code] of [["{", "Digit7"], ["[", "Digit8"], ["]", "Digit9"], ["\\", "Backslash"]]) {
        const event = new KeyboardEvent("keydown", { key, code, ctrlKey: true, altKey: true, modifierAltGraph: true, bubbles: true, cancelable: true });
        element.dispatchEvent(event);
        characters.push({ key, isTrusted: event.isTrusted, altGraph: event.getModifierState("AltGraph"), defaultPrevented: event.defaultPrevented });
      }
      return { composing: { isTrusted: composing.isTrusted, isComposing: composing.isComposing, defaultPrevented: composing.defaultPrevented }, characters };
    });
    assert.equal(result.composing.isTrusted, false);
    assert.equal(result.composing.isComposing, true);
    assert.equal(result.composing.defaultPrevented, true);
    assert.ok(result.characters.every((entry) => !entry.isTrusted && entry.altGraph && !entry.defaultPrevented));
    const after = await assertUnchanged(before);
    assert.deepEqual(after.selection, before.selection);
    assert.equal(await page.locator(".life-block-menu, .life-block-conversion-menu, .bn-suggestion-menu").count(), 0);
    const savedAfter = await saved();
    assert.equal(savedAfter.ui.selectedPageId, savedBefore.ui.selectedPageId);
    assert.equal(savedAfter.ui.sidebarCollapsed, savedBefore.ui.sidebarCollapsed);
    assert.deepEqual(documentBlocks(savedAfter), before.document);
  });
}, { workspace, viewport: { width: 1440, height: 900 } });
