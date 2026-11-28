import { writeFileSync } from "node:fs";
import { browserScenario } from "./harness.mjs";
import { coreParityWorkspace } from "../fixtures/core-parity-workspace.mjs";

const run = process.env.V7_BLOCK_MENU_RUN || "local";
if (!/^[a-z0-9-]+$/.test(run)) throw new Error("Invalid V7_BLOCK_MENU_RUN");
const base = `LOCAL-NOTION-001/v7-block-menu-${run}`;
const reports = [];
const selector = '.life-editor[data-page-id="editor-page"] .bn-editor';
const source = { id: "source", type: "bulletListItem", content: [
  { type: "text", text: "新增项 ", styles: { bold: true } },
  { type: "link", href: "https://example.com", content: [{ type: "text", text: "V7", styles: { italic: true } }] },
], children: [{ id: "child", type: "paragraph", content: "保留子内容" }] };
const workspace = (column, locked = false) => {
  const w = coreParityWorkspace();
  w.ui.selectedPageId = "editor-page";
  const page = w.pages.find((p) => p.id === "editor-page");
  page.settings = { ...page.settings, locked };
  page.content = column ? [{ id: "columns", type: "columnList", props: { columns: 2 }, children: [
    { id: "column", type: "column", props: { width: 50, index: 0, count: 2 }, children: [source] },
    { id: "other-column", type: "column", props: { width: 50, index: 1, count: 2 }, children: [{ id: "other", type: "paragraph", content: "other" }] },
  ] }] : [source, { id: "tail", type: "paragraph", content: "tail" }];
  return w;
};
const snap = (page) => page.evaluate((sel) => {
  const editor = document.querySelector(sel).pmViewDesc.node.type.schema.cached.blockNoteEditor;
  return { document: editor.document, selection: editor.prosemirrorState.selection.toJSON(), focused: editor.prosemirrorView.hasFocus() };
}, selector);
const blocks = (state, column) => column ? state.document[0].children[0].children : state.document;
const open = async (page) => {
  const body = page.locator(`${selector} .bn-block-outer[data-id="source"] > .bn-block > .bn-block-content`).first();
  await body.click();
  await page.keyboard.press("End");
  await body.hover();
  await page.locator('.life-block-actions[data-block-id="source"] [aria-label="区块菜单"]').click();
};

for (const column of [false, true]) {
  reports.push(await browserScenario(`${base}-${column ? "column" : "root"}`, async ({ page, check, screenshot, assert }) => {
    await check("search autofocus, filtering, composition and Escape preserve editor selection", async () => {
      const body = page.locator(`${selector} .bn-block-outer[data-id="source"] > .bn-block > .bn-block-content`).first();
      await body.click();
      await page.keyboard.press("End");
      const before = await snap(page);
      await page.keyboard.press("Shift+F10");
      const search = page.getByRole("searchbox", { name: "搜索区块操作" });
      await search.waitFor({ timeout: 3000 });
      assert.equal(await search.evaluate((el) => document.activeElement === el), true);
      await screenshot("open");
      const searchStyle = await search.evaluate((el) => ({ html: el.parentElement.outerHTML, outline: getComputedStyle(el).outline, border: getComputedStyle(el).border, boxShadow: getComputedStyle(el).boxShadow, focused: el === document.activeElement }));
      assert.notEqual(searchStyle.boxShadow, "none");
      writeFileSync(`.qa/${base}-${column ? "column" : "root"}-search-style.json`, JSON.stringify(searchStyle, null, 2));
      await page.emulateMedia({ colorScheme: "dark" });
      await page.waitForFunction(() => document.documentElement.dataset.theme === "dark");
      await screenshot("open-dark");
      await page.emulateMedia({ colorScheme: "light" });
      await page.waitForFunction(() => document.documentElement.dataset.theme === "light");
      const duplicate = page.getByRole("menuitem", { name: /复制/ }).filter({ hasText: "Ctrl+D" });
      assert.equal(await duplicate.count(), 1);
      assert.deepEqual(await page.locator('.life-block-menu > [role="menuitem"] kbd').allTextContents(), ["Ctrl+D"]);
      await page.keyboard.insertText("不存在的操作xyz");
      assert.equal(await page.getByText("没有匹配的操作").isVisible(), true);
      await page.keyboard.press("Enter");
      await search.evaluate((el) => {
        el.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "中" }));
        el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, isComposing: true }));
        el.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "中" }));
      });
      assert.deepEqual((await snap(page)).document, before.document);
      await search.fill("duplicate");
      await page.keyboard.press("ArrowDown");
      await search.evaluate((el) => {
        el.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "中" }));
        el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, isComposing: true }));
        el.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, isComposing: true }));
        el.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "中" }));
      });
      assert.equal(await search.isVisible(), true);
      assert.deepEqual((await snap(page)).document, before.document);
      await page.keyboard.press("Control+d");
      assert.deepEqual((await snap(page)).document, before.document);
      await page.keyboard.press("Escape");
      await page.waitForFunction((sel) => document.querySelector(sel)?.pmViewDesc.node.type.schema.cached.blockNoteEditor.prosemirrorView.hasFocus(), selector);
      const after = await snap(page);
      assert.deepEqual(after.selection, before.selection);
      assert.deepEqual(after.document, before.document);
    });
    await check("filtered conversion and color retain their existing submenus", async () => {
      await open(page);
      const search = page.getByRole("searchbox", { name: "搜索区块操作" });
      await search.fill("转换");
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("Enter");
      await page.locator('.life-block-conversion-menu').getByRole("menuitem", { name: "标题 2", exact: true }).waitFor();
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      await open(page);
      await search.fill("颜色");
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("Enter");
      await page.locator('.life-block-colors-menu [role="menuitem"]').filter({ hasText: "蓝色" }).first().waitFor();
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
    });
    await check("filtered duplicate retains rich content and children through one undo and redo", async () => {
      await open(page);
      const search = page.getByRole("searchbox", { name: "搜索区块操作" });
      assert.equal(await search.inputValue(), "");
      const before = await snap(page);
      await search.fill("duplicate");
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("Enter");
      await page.waitForFunction(({ sel, column }) => {
        const doc = document.querySelector(sel).pmViewDesc.node.type.schema.cached.blockNoteEditor.document;
        return (column ? doc[0].children[0].children : doc).length === (column ? 2 : 3);
      }, { sel: selector, column });
      const duplicated = await snap(page);
      const list = blocks(duplicated, column);
      assert.deepEqual(list[0], blocks(before, column)[0]);
      assert.notEqual(list[1].id, list[0].id);
      assert.notEqual(list[1].children[0].id, list[0].children[0].id);
      assert.deepEqual(list[1].content, list[0].content);
      assert.deepEqual({ ...list[1].children[0], id: list[0].children[0].id }, list[0].children[0]);
      await page.keyboard.press("Control+z");
      await page.waitForTimeout(250);
      assert.deepEqual((await snap(page)).document, before.document);
      await page.keyboard.press("Control+Shift+z");
      await page.waitForTimeout(250);
      assert.deepEqual((await snap(page)).document, duplicated.document);
      await page.keyboard.press("Control+d");
      await page.waitForFunction(({ sel, column }) => {
        const doc = document.querySelector(sel).pmViewDesc.node.type.schema.cached.blockNoteEditor.document;
        return (column ? doc[0].children[0].children : doc).length === (column ? 3 : 4);
      }, { sel: selector, column });
      await page.keyboard.press("Control+z");
      await page.waitForTimeout(250);
      assert.deepEqual((await snap(page)).document, duplicated.document);
    });
  }, { workspace: workspace(column), viewport: { width: 1440, height: 900 } }));
}
reports.push(await browserScenario(`${base}-selection`, async ({ page, check, assert }) => {
  await check("selected multiple blocks remain selected for filtered duplicate and undo", async () => {
    await page.locator(`${selector} [data-id="source"] .bn-inline-content`).first().click();
    await page.evaluate(() => {
      const first = document.querySelector('[data-id="source"] .bn-inline-content').firstChild.firstChild;
      const last = document.querySelector('[data-id="tail"] .bn-inline-content').firstChild;
      window.getSelection().setBaseAndExtent(first, 0, last, last.textContent.length);
    });
    await page.waitForFunction((sel) => !document.querySelector(sel).pmViewDesc.node.type.schema.cached.blockNoteEditor.prosemirrorState.selection.empty, selector);
    const before = await snap(page);
    await page.keyboard.press("Shift+F10");
    const search = page.getByRole("searchbox", { name: "搜索区块操作" });
    await search.fill("duplicate");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await page.waitForFunction((sel) => document.querySelector(sel).pmViewDesc.node.type.schema.cached.blockNoteEditor.document.length === 4, selector);
    const after = await snap(page);
    assert.deepEqual(after.document.slice(0, 2), before.document);
    assert.deepEqual(after.document[2].content, before.document[0].content);
    assert.deepEqual(after.document[3].content, before.document[1].content);
    assert.notEqual(after.document[2].id, "source");
    assert.notEqual(after.document[3].id, "tail");
    await page.keyboard.press("Control+z");
    await page.waitForTimeout(250);
    assert.deepEqual((await snap(page)).document, before.document);
  });
}, { workspace: workspace(false) }));
reports.push(await browserScenario(`${base}-locked`, async ({ page, check, assert }) => {
  await check("locked page exposes no actionable block menu", async () => {
    await page.locator(`${selector} .bn-block-outer[data-id="source"]`).hover();
    assert.equal(await page.locator('.life-block-actions [aria-label="区块菜单"]').count(), 0);
  });
}, { workspace: workspace(false, true) }));
reports.push(await browserScenario(`${base}-table`, async ({ page, check, assert }) => {
  await check("table header actions remain searchable and usable", async () => {
    await page.locator(`${selector} [data-id="source"] .bn-inline-content`).first().click();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("/table");
    await page.locator('[role="option"]:visible').filter({ hasText: "表格" }).first().waitFor();
    await page.keyboard.press("Enter");
    await page.locator(`${selector} .bn-block-content[data-content-type="table"]`).waitFor();
    const tableId = await page.locator(`${selector} .bn-block-content[data-content-type="table"]`).first().evaluate((el) => el.closest('.bn-block-outer').dataset.id);
    await page.locator(`${selector} .bn-block-outer[data-id="${tableId}"]`).hover();
    await page.locator(`.life-block-actions[data-block-id="${tableId}"] [aria-label="区块菜单"]`).click();
    await page.getByRole("searchbox", { name: "搜索区块操作" }).fill("行标题");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await page.waitForFunction(({ sel, id }) => document.querySelector(sel).pmViewDesc.node.type.schema.cached.blockNoteEditor.getBlock(id).content.headerRows === 1, { sel: selector, id: tableId });
    assert.equal((await snap(page)).document.find((block) => block.id === tableId).content.headerRows, 1);
  });
}, { workspace: workspace(false) }));
const checks = reports.flatMap((r) => r.checks.map((c) => ({ ...c, scenario: r.name })));
const errors = reports.flatMap((r) => r.errors.map ( (e) => ({ ...e, scenario: r.name })));
const aggregate = { name: "block-menu-v7", passed: reports.length === 5 && reports.every((r) => r.passed), checks, errors, storageKey: reports[0]?.storageKey, sourceFingerprint: reports[0]?.sourceFingerprint, subreports: reports };
writeFileSync(process.env.V7_BLOCK_MENU_AGGREGATE_PATH || ".qa/block-menu-v7.json", JSON.stringify(aggregate, null, 2));
if (!aggregate.passed) process.exitCode = 1;
console.log(`BLOCK MENU V7: ${reports.length} scenarios / ${checks.length} checks, passed=${aggregate.passed}, errors=${errors.length}`);
