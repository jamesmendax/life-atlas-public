import { writeFileSync } from "node:fs";
import { browserScenario, shootBothModes } from "./harness.mjs";
import { coreParityWorkspace } from "../fixtures/core-parity-workspace.mjs";
import { walkBlocks } from "../../src/domain/blockDocument.js";

const workspace = coreParityWorkspace();
workspace.ui.selectedPageId = "editor-page";
workspace.ui.preferences = { theme: "system" };
const fixturePage = workspace.pages.find((entry) => entry.id === "editor-page");
fixturePage.title = "分栏与区块转换";
fixturePage.icon = "";
fixturePage.content = [
  { id: "two", type: "columnList", props: { columns: 2 }, children: [
    { id: "two-left", type: "column", props: { width: 50, index: 0, count: 2 }, children: [
      { id: "empty-heading", type: "heading", props: { level: 1 }, content: "" },
      { id: "empty-heading-two", type: "heading", props: { level: 2 }, content: "" },
    ] },
    { id: "two-right", type: "column", props: { width: 50, index: 1, count: 2 }, children: [{ id: "callout", type: "callout", content: "提示", props: { icon: "💡", tone: "neutral" } }] },
  ] },
  { id: "root-text", type: "paragraph", content: "已有正文可以随时转换，内容与链接不会消失。" },
  { id: "three", type: "columnList", props: { columns: 3 }, children: [
    { id: "three-left", type: "column", props: { width: 50, index: 0, count: 3 }, children: [
      { id: "rich", type: "paragraph", content: [{ type: "text", text: "保留粗体", styles: { bold: true } }, { type: "text", text: " 和 ", styles: {} }, { type: "link", href: "lifeatlas://page/alpha-page", content: [{ type: "text", text: "原有链接", styles: { italic: true } }] }], children: [{ id: "rich-child", type: "bulletListItem", content: "子区块保持不变" }] },
      { id: "left-tail", type: "paragraph", content: "左栏正文" },
    ] },
    { id: "three-middle", type: "column", props: { width: 50, index: 1, count: 3 }, children: [{ id: "middle-text", type: "checkListItem", content: "中栏待办", props: { checked: true } }, { id: "middle-tail", type: "paragraph", content: "中栏正文" }] },
    { id: "three-right", type: "column", props: { width: 50, index: 2, count: 3 }, children: [{ id: "right-text", type: "paragraph", content: "右栏正文" }] },
  ] },
  { id: "root-tail", type: "paragraph", content: "页面末尾" },
  { id: "sync-reference", type: "syncedBlock", props: { sourceId: "shared-source" } },
];

await browserScenario("editor-interactions-v4", async ({ page, check, screenshot, saved, persisted, assert }) => {
  const documentBlocks = (value) => value.pages.find((entry) => entry.id === "editor-page").content;
  const block = (value, blockId) => walkBlocks(documentBlocks(value)).find((entry) => entry.id === blockId);
  const outer = (blockId) => page.locator(`.life-editor > .bn-container .bn-editor .bn-block-outer[data-id="${blockId}"]`).first();
  const content = (blockId) => outer(blockId).locator(':scope > .bn-block > .bn-block-content, :scope > .bn-block > .react-renderer > .bn-block-content').first();
  const openMenu = async (blockId) => {
    await content(blockId).hover();
    const toolbar = page.locator(`.life-block-actions[data-block-id="${blockId}"]`);
    await toolbar.getByRole("button", { name: "区块菜单", exact: true }).click();
    await page.getByRole("menuitem", { name: "转换为", exact: true }).waitFor();
  };
  const menuConvert = async (blockId, target) => {
    await openMenu(blockId);
    await page.getByRole("menuitem", { name: "转换为", exact: true }).hover();
    await page.locator(".life-block-conversion-menu").getByRole("menuitem", { name: target, exact: true }).click();
  };
  const nativeSnapshot = () => page.evaluate(() => {
    const editor = document.querySelector('.life-editor[data-page-id="editor-page"] .bn-editor').pmViewDesc.node.type.schema.cached.blockNoteEditor;
    return { document: editor.document, native: editor.prosemirrorState.doc.toJSON(), selection: editor.prosemirrorState.selection.toJSON(), editable: editor.isEditable };
  });
  const geometry = async () => page.evaluate(() => {
    const root = document.querySelector('.life-editor[data-page-id="editor-page"] .bn-editor');
    const rows = {};
    const titleRect = document.querySelector(".page-title-input").getBoundingClientRect();
    const firstBlockRect = root.querySelector('.bn-block-outer[data-id="two"]').getBoundingClientRect();
    rows.header = { titleBottom: titleRect.bottom, firstBlockTop: firstBlockRect.top, gap: firstBlockRect.top - titleRect.bottom };
    for (const blockId of ["two", "two-left", "two-right", "empty-heading", "empty-heading-two", "callout", "three", "three-left", "three-middle", "three-right", "rich", "rich-child"]) {
      const element = root.querySelector(`.bn-block-outer[data-id="${blockId}"]`);
      const body = element.querySelector(':scope > .bn-block > .bn-block-content, :scope > .bn-block > .react-renderer > .bn-block-content');
      const inline = body.querySelector(".bn-inline-content");
      const style = getComputedStyle(body);
      const placeholder = getComputedStyle(body, "::after");
      const rail = getComputedStyle(element, "::before");
      const rect = (target) => { const value = target.getBoundingClientRect(); return { left: value.left, top: value.top, width: value.width, height: value.height, right: value.right, bottom: value.bottom }; };
      rows[blockId] = { outer: rect(element), content: rect(body), inline: inline ? rect(inline) : null, size: style.fontSize, weight: style.fontWeight, lineHeight: style.lineHeight, dataLevel: body.getAttribute("data-level"), placeholderStyle: placeholder.fontStyle, placeholderSize: placeholder.fontSize, rail: { content: rail.content, width: rail.borderLeftWidth }, leadingChildren: [...element.querySelector(":scope > .bn-block").children].map((entry) => ({ className: entry.className, height: entry.getBoundingClientRect().height })) };
    }
    return rows;
  });

  await check("real production columns have aligned first blocks without artificial leading widgets", async () => {
    await content("empty-heading").waitFor();
    await page.evaluate(() => document.fonts.ready);
    const measured = await geometry();
    writeFileSync(".qa/LOCAL-NOTION-001/editor-refactor-initial-state01.json", JSON.stringify(await nativeSnapshot(), null, 2));
    writeFileSync(".qa/LOCAL-NOTION-001/editor-refactor-geometry-initial01.json", JSON.stringify(measured, null, 2));
    assert.equal(measured["empty-heading"].dataLevel, null);
    assert.equal(measured["empty-heading"].size, "30px");
    assert.equal(measured["empty-heading"].weight, "600");
    assert.equal(measured["empty-heading"].placeholderStyle, "normal");
    assert.equal(measured["empty-heading"].placeholderSize, "30px");
    assert.equal(measured["empty-heading-two"].size, "24px");
    assert.ok(measured.header.gap <= 64, `Page title to first block gap: ${measured.header.gap}`);
    assert.ok(Math.abs(measured["empty-heading"].content.top - measured.callout.content.top) <= 1);
    assert.ok(Math.abs(measured["empty-heading"].outer.top - measured["two-left"].outer.top) <= 1);
    for (const blockId of ["two-left", "two-right", "empty-heading", "empty-heading-two", "callout", "three-left", "three-middle", "three-right", "rich"]) assert.ok(measured[blockId].rail.content === "none" || measured[blockId].rail.width === "0px", blockId);
    assert.ok(measured["rich-child"].content.left > measured.rich.content.left + 20);
    await shootBothModes(page, screenshot, "columns-initial");
  });

  await check("hover exposes reachable add and conversion controls without moving content", async () => {
    const before = await geometry();
    await openMenu("rich");
    const after = await geometry();
    assert.deepEqual(after.rich.outer, before.rich.outer);
    await page.getByRole("menuitem", { name: "转换为", exact: true }).hover();
    await page.locator(".life-block-conversion-menu").getByRole("menuitem", { name: "标题 2", exact: true }).waitFor();
    assert.equal(await page.locator(".life-block-conversion-menu").getByRole("menuitem", { name: "标题 2", exact: true }).isDisabled(), false);
    assert.equal(await page.locator(".life-block-conversion-menu").getByRole("menuitem", { name: "代码", exact: true }).isDisabled(), true);
    await screenshot("existing-rich-turn-into");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
  });

  await check("existing rich in-column conversion preserves children links and one native undo redo", async () => {
    const before = walkBlocks((await nativeSnapshot()).document).find((entry) => entry.id === "rich");
    await menuConvert("rich", "标题 2");
    const converted = block(await persisted((value) => block(value, "rich")?.type === "heading"), "rich");
    assert.deepEqual(converted.content, before.content);
    assert.deepEqual(converted.children, before.children);
    assert.equal(block(await saved(), "three-left").children[0].id, "rich");
    await page.keyboard.press("Control+z");
    await persisted((value) => block(value, "rich")?.type === "paragraph");
    await page.keyboard.press("Control+Shift+z");
    await persisted((value) => block(value, "rich")?.type === "heading");
    await page.keyboard.press("Control+Alt+0");
    await persisted((value) => block(value, "rich")?.type === "paragraph");
  });

  await check("root keyboard conversion and context-menu path use the same populated block command", async () => {
    await content("root-text").click();
    await page.keyboard.press("Control+Alt+3");
    await persisted((value) => block(value, "root-text")?.type === "heading" && block(value, "root-text").props.level === 3);
    await page.keyboard.press("Shift+F10");
    await page.getByRole("menuitem", { name: "转换为", exact: true }).waitFor();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Control+Alt+0");
    await persisted((value) => block(value, "root-text")?.type === "paragraph");
  });

  await check("layout controls never transform or duplicate a retained text cursor", async () => {
    await content("root-text").click();
    const before = await nativeSnapshot();
    await outer("three-left").getByRole("separator").focus();
    await page.keyboard.press("Control+Alt+3");
    await page.keyboard.press("Control+d");
    await page.keyboard.press("Shift+F10");
    assert.deepEqual((await nativeSnapshot()).native, before.native);
    assert.equal(await page.getByRole("menuitem", { name: "转换为", exact: true }).count(), 0);
    await page.keyboard.press("Escape");
  });

  await check("forward and backward text selections convert exactly the same crossed-column blocks", async () => {
    const selectAcrossColumns = async (backward) => {
      await content("left-tail").click();
      await page.evaluate((reverse) => {
        const leftText = document.querySelector('[data-id="left-tail"] .bn-inline-content').firstChild;
        const middleText = document.querySelector('[data-id="middle-text"] .bn-inline-content').firstChild;
        const selection = window.getSelection();
        selection.setBaseAndExtent(reverse ? middleText : leftText, reverse ? 2 : 0, reverse ? leftText : middleText, reverse ? 0 : 2);
      }, backward);
      await page.waitForFunction((reverse) => {
        const editor = document.querySelector('.life-editor[data-page-id="editor-page"] .bn-editor').pmViewDesc.node.type.schema.cached.blockNoteEditor;
        const selection = editor.prosemirrorState.selection;
        return !selection.empty && (reverse ? selection.anchor > selection.head : selection.anchor < selection.head);
      }, backward);
    };
    for (const backward of [false, true]) {
      await selectAcrossColumns(backward);
      const before = await nativeSnapshot();
      await page.keyboard.press("Control+Alt+2");
      const after = await persisted((value) => block(value, "left-tail")?.type === "heading" && block(value, "middle-text")?.type === "heading");
      assert.equal(block(after, "middle-tail").type, "paragraph");
      assert.equal(block(after, "rich").type, "paragraph");
      assert.equal(block(after, "left-tail").props.level, 2);
      assert.equal(block(after, "middle-text").props.level, 2);
      await page.keyboard.press("Control+z");
      await persisted((value) => block(value, "left-tail")?.type === "paragraph" && block(value, "middle-text")?.type === "checkListItem");
      assert.deepEqual((await nativeSnapshot()).native, before.native);
      assert.deepEqual((await nativeSnapshot()).selection, before.selection);
    }
  });

  await check("paired resize previews without persisting and commits once while the third column stays unchanged", async () => {
    await outer("three").scrollIntoViewIfNeeded();
    const resizer = outer("three-left").getByRole("separator");
    const bounds = await resizer.boundingBox();
    assert.ok(bounds);
    const before = await nativeSnapshot();
    const thirdWidth = (await outer("three-right").boundingBox()).width;
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + Math.min(bounds.height / 2, 18));
    const resizeHit = await page.evaluate(({ x, y }) => { const target = document.elementFromPoint(x, y); return { html: target?.outerHTML.slice(0, 500), separator: Boolean(target?.closest(".life-column-resizer")) }; }, { x: bounds.x + bounds.width / 2, y: bounds.y + Math.min(bounds.height / 2, 18) });
    writeFileSync(".qa/LOCAL-NOTION-001/editor-refactor-resize-hit01.json", JSON.stringify({ bounds, hit: resizeHit }, null, 2));
    assert.equal(resizeHit.separator, true);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width / 2 + 24, bounds.y + Math.min(bounds.height / 2, 18), { steps: 8 });
    assert.deepEqual((await nativeSnapshot()).document, before.document);
    assert.deepEqual(block(await saved(), "three").children.map((entry) => entry.props.width), [50, 50, 50]);
    await page.mouse.up();
    const resized = block(await persisted((value) => block(value, "three-left")?.props.width !== 50), "three");
    assert.ok(Math.abs(resized.children[0].props.width + resized.children[1].props.width - 100) < 1e-8);
    assert.equal(resized.children[2].props.width, 50);
    assert.ok(Math.abs((await outer("three-right").boundingBox()).width - thirdWidth) <= 1);
    await content("root-tail").click();
    await page.keyboard.press("Control+z");
    await persisted((value) => block(value, "three-left")?.props.width === 50);
    assert.deepEqual((await nativeSnapshot()).native, before.native);
    await page.keyboard.press("Control+Shift+z");
    await persisted((value) => block(value, "three-left")?.props.width !== 50);
  });

  await check("Escape cancels a live resize without a document or history mutation", async () => {
    const before = await nativeSnapshot();
    const bounds = await outer("three-left").getByRole("separator").boundingBox();
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 8);
    await page.mouse.down();
    await page.mouse.move(bounds.x + 35, bounds.y + 8, { steps: 6 });
    await page.keyboard.press("Escape");
    await page.mouse.up();
    assert.deepEqual((await nativeSnapshot()).native, before.native);
    assert.equal(await page.locator("[data-life-column-preview]").count(), 0);
  });

  await check("trusted handle dragging moves the original rich subtree between columns", async () => {
    await content("rich").hover();
    const handle = page.locator('.life-block-actions[data-block-id="rich"] .life-block-handle');
    const target = content("middle-tail");
    const targetBounds = await target.boundingBox();
    const before = await nativeSnapshot();
    const original = walkBlocks(before.document).find((entry) => entry.id === "rich");
    const handleBounds = await handle.boundingBox();
    await page.mouse.move(handleBounds.x + handleBounds.width / 2, handleBounds.y + handleBounds.height / 2);
    await page.mouse.down();
    await page.mouse.move(targetBounds.x + targetBounds.width / 2, targetBounds.y + targetBounds.height - 2, { steps: 12 });
    await page.mouse.move(targetBounds.x + targetBounds.width / 2 + 1, targetBounds.y + targetBounds.height - 2);
    const preview = page.locator('.life-block-drop-preview[data-drop-kind="content"]');
    await preview.waitFor();
    const previewBounds = await preview.boundingBox();
    assert.ok(Math.abs(previewBounds.y - targetBounds.y - targetBounds.height) <= 1);
    assert.ok(Math.abs(previewBounds.width - targetBounds.width) <= 1);
    await screenshot("cross-column-drag-preview");
    await page.mouse.up();
    await persisted((value) => block(value, "three-middle")?.children.some((entry) => entry.id === "rich"));
    assert.equal(await page.locator(".life-block-drop-preview").count(), 0);
    assert.deepEqual(block(await saved(), "rich"), original);
    await page.keyboard.press("Control+z");
    await persisted((value) => block(value, "three-left")?.children.some((entry) => entry.id === "rich"));
    assert.deepEqual((await nativeSnapshot()).native, before.native);
  });

  await check("real empty headings and column end areas remain editable", async () => {
    await content("empty-heading").click();
    await page.keyboard.insertText("可以输入标题");
    await persisted((value) => JSON.stringify(block(value, "empty-heading")?.content).includes("可以输入标题"));
    const trailing = outer("two-right").locator('.life-layout-trailing[data-layout-owner="two-right"]');
    await trailing.click();
    await page.keyboard.insertText("新增列内正文");
    await persisted((value) => block(value, "two-right").children.some((entry) => JSON.stringify(entry.content).includes("新增列内正文")));
  });

  await check("synced editor exposes the same conversion menu without changing the root document", async () => {
    const nested = page.locator('.life-synced-editor .bn-block-outer[data-id="shared-p"] .bn-inline-content').first();
    await nested.click();
    await page.keyboard.press("Control+Alt+2");
    await persisted((value) => value.syncedSources.find((entry) => entry.id === "shared-source").blocks[0].type === "heading");
    assert.equal(block(await saved(), "sync-reference").type, "syncedBlock");
    await nested.hover();
    await page.locator('.life-block-actions[data-block-id="shared-p"]').getByRole("button", { name: "区块菜单", exact: true }).click();
    await page.getByRole("menuitem", { name: "转换为", exact: true }).waitFor();
    const rootBefore = (await nativeSnapshot()).native;
    await page.getByRole("menuitem", { name: "转换为", exact: true }).focus();
    await page.keyboard.press("Control+Alt+3");
    await page.keyboard.press("Control+d");
    assert.deepEqual((await nativeSnapshot()).native, rootBefore);
    await page.keyboard.press("Escape");
  });

  await check("edited columns and synced conversions survive reload", async () => {
    const before = await saved();
    await page.reload({ waitUntil: "domcontentloaded" });
    await content("empty-heading").waitFor();
    const after = await saved();
    assert.deepEqual(documentBlocks(after), documentBlocks(before));
    assert.deepEqual(after.syncedSources, before.syncedSources);
    await shootBothModes(page, screenshot, "columns-persisted");
  });
}, { workspace, viewport: { width: 1440, height: 900 } });
