import { browserScenario } from "./harness.mjs";
import { coreParityWorkspace } from "../fixtures/core-parity-workspace.mjs";

const workspace = coreParityWorkspace();
workspace.ui.selectedPageId = "editor-page";
const fixturePage = workspace.pages.find((entry) => entry.id === "editor-page");
fixturePage.content = [
  { id: "focus67-root", type: "paragraph", content: "menu focus seed" },
  { id: "focus67-selection", type: "paragraph", content: "keep WORD tail" },
  { id: "focus67-pointer", type: "paragraph", content: "pointer seed" },
  { id: "focus67-sync", type: "syncedBlock", props: { sourceId: "shared-source" } },
];

await browserScenario("v12-editor-menu-focus67", async ({ page, check, persisted, saved, assert }) => {
  const rootSelector = '.life-editor[data-page-id="editor-page"] > .bn-container .bn-editor';
  const content = (id) => page.locator(`${rootSelector} .bn-block-outer[data-id="${id}"] .bn-inline-content`).first();
  const block = (value, id) => value.pages.find((entry) => entry.id === "editor-page").content.find((entry) => entry.id === id);
  const text = (value) => (value.content || []).map((entry) => entry.text || "").join("");
  const snapshot = () => page.evaluate((selector) => {
    const editor = document.querySelector(selector).pmViewDesc.node.type.schema.cached.blockNoteEditor;
    return { document: editor.document, selection: editor.prosemirrorState.selection.toJSON(), focused: editor.prosemirrorView.hasFocus() };
  }, rootSelector);
  const openKeyboardMenu = async () => {
    await page.keyboard.press("Shift+F10");
    const search = page.getByRole("searchbox", { name: "搜索区块操作" });
    await search.waitFor();
    await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "搜索区块操作");
  };

  await check("Escape followed immediately by the paragraph shortcut acts on the original heading", async () => {
    await content("focus67-root").click();
    await page.keyboard.press("Control+Alt+3");
    await persisted((value) => block(value, "focus67-root")?.type === "heading" && block(value, "focus67-root").props.level === 3);
    await openKeyboardMenu();
    // No focus wait or editor click may separate Escape from the next command.
    await page.keyboard.press("Escape");
    await page.keyboard.press("Control+Alt+0");
    await persisted((value) => block(value, "focus67-root")?.type === "paragraph");
    assert.equal(text(block(await saved(), "focus67-root")), "menu focus seed");
  });

  await check("Escape preserves forward and backward selections for immediate replacement and native undo", async () => {
    for (const backward of [false, true]) {
      await content("focus67-selection").click();
      await page.evaluate((reverse) => {
        const body = document.querySelector('[data-id="focus67-selection"] .bn-inline-content');
        const textNode = body.firstChild;
        if (textNode.nodeType !== Node.TEXT_NODE || textNode.textContent !== "keep WORD tail") throw new Error("Expected selection fixture text");
        window.getSelection().setBaseAndExtent(textNode, reverse ? 9 : 5, textNode, reverse ? 5 : 9);
      }, backward);
      await page.waitForFunction(({ selector, reverse }) => {
        const editor = document.querySelector(selector).pmViewDesc.node.type.schema.cached.blockNoteEditor;
        const selection = editor.prosemirrorState.selection;
        return Math.abs(selection.head - selection.anchor) === 4 && (selection.anchor > selection.head) === reverse;
      }, { selector: rootSelector, reverse: backward });
      const before = await snapshot();
      assert.equal(before.selection.anchor > before.selection.head, backward);
      assert.equal(Math.abs(before.selection.head - before.selection.anchor), 4);
      await openKeyboardMenu();
      await page.keyboard.press("Escape");
      await page.keyboard.type("EDIT");
      await persisted((value) => text(block(value, "focus67-selection")) === "keep EDIT tail");
      await page.keyboard.press("Control+z");
      await persisted((value) => text(block(value, "focus67-selection")) === "keep WORD tail");
      const after = await snapshot();
      assert.deepEqual(after.document, before.document);
      assert.deepEqual(after.selection, before.selection);
      assert.equal(after.focused, true);
    }
  });

  await check("Escape from a pointer-opened block menu resumes typing at the retained caret", async () => {
    await content("focus67-pointer").click();
    await page.keyboard.press("End");
    await content("focus67-pointer").hover();
    await page.locator('.life-block-actions[data-block-id="focus67-pointer"]').getByRole("button", { name: "区块菜单", exact: true }).click();
    await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "搜索区块操作");
    await page.keyboard.press("Escape");
    await page.keyboard.type("!");
    await persisted((value) => text(block(value, "focus67-pointer")) === "pointer seed!");
    await page.keyboard.press("Control+z");
    await persisted((value) => text(block(value, "focus67-pointer")) === "pointer seed");
  });

  await check("Escape returns commands to the owning synced editor without changing its parent document", async () => {
    const rootBefore = (await snapshot()).document;
    const nested = page.locator('.life-synced-editor .bn-block-outer[data-id="shared-p"] .bn-inline-content').first();
    const sourceBlock = (value) => value.syncedSources.find((entry) => entry.id === "shared-source").blocks.find((entry) => entry.id === "shared-p");
    await nested.click();
    await page.keyboard.press("Control+Alt+3");
    await persisted((value) => sourceBlock(value).type === "heading" && sourceBlock(value).props.level === 3);
    await openKeyboardMenu();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Control+Alt+0");
    await persisted((value) => sourceBlock(value).type === "paragraph");
    assert.deepEqual((await snapshot()).document, rootBefore);
  });
}, { workspace });
