import { browserScenario } from "./harness.mjs";
import { coreParityWorkspace } from "../fixtures/core-parity-workspace.mjs";
import { walkBlocks } from "../../src/domain/blockDocument.js";

const workspace = coreParityWorkspace();
workspace.ui.selectedPageId = "editor-page";
const editorPage = workspace.pages.find((page) => page.id === "editor-page");
const listIndex = editorPage.content.findIndex((block) => block.id === "column-check");
editorPage.content[listIndex] = {
  id: "column-check",
  type: "columnList",
  props: { columns: 3 },
  children: [
    { id: "column-check-a", type: "column", props: { width: 34, index: 0, count: 3 }, children: [{ id: "column-check-a-text", type: "paragraph", content: "" }] },
    { id: "column-check-b", type: "column", props: { width: 33, index: 1, count: 3 }, children: [{ id: "column-check-b-text", type: "paragraph", content: "" }] },
    { id: "column-check-c", type: "column", props: { width: 33, index: 2, count: 3 }, children: [
      { id: "column-check-c-text", type: "paragraph", content: "" },
      { id: "column-check-c-db", type: "databaseView", props: { sourceId: "projects", viewId: "view-table" } },
    ] },
  ],
};

await browserScenario("columns-transform", async ({ page, check, saved, persisted, screenshot, assert }) => {
  const current = (value) => value.pages.find((entry) => entry.id === "editor-page");
  const columnList = (value) => walkBlocks(current(value).content).find((entry) => entry.id === "column-check");
  const directColumnOuters = () => page.locator('[data-id="column-check"] > .bn-block > .bn-block-group > .bn-block-outer');
  const chooseFromSlash = async (blockId, pattern) => {
    const target = page.locator(`[data-id="${blockId}"] .bn-block-content`).first();
    await target.click();
    await page.waitForFunction((id) => {
      const root = document.querySelector('.life-editor[data-page-id="editor-page"] .bn-editor');
      const editor = root?.pmViewDesc?.node.type.schema.cached.blockNoteEditor;
      return editor?.getTextCursorPosition().block.id === id;
    }, blockId);
    await page.keyboard.type("/");
    const options = page.locator('[role="option"]:visible');
    await options.first().waitFor();
    const labels = await options.allInnerTexts();
    const option = options.filter({ hasText: pattern }).first();
    assert.ok(await option.count(), `Missing Slash Menu option ${pattern} in ${labels.join(" | ")}`);
    await option.click();
  };

  await check("three-column fixture renders exactly three direct column children", async () => {
    await page.locator('.bn-block-outer[data-id="column-check"]').waitFor();
    assert.equal(await directColumnOuters().count(), 3);
    const state = await saved();
    const list = columnList(state);
    assert.equal(list.children.length, 3);
    assert.deepEqual(list.children.map((entry) => entry.type), ["column", "column", "column"]);
  });

  await check("structural column wrapper never exposes BlockNote add-block controls", async () => {
    const outer = page.locator('.bn-block-outer[data-id="column-check-a"]');
    const box = await outer.boundingBox();
    assert.ok(box && box.height > 40);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height - 8);
    await page.waitForTimeout(120);
    const active = await page.locator('.life-editor[data-page-id="editor-page"] > .bn-container > .bn-root > .life-block-actions').first().getAttribute("data-block-id").catch(() => null);
    if (active === "column-check-a") {
      assert.equal(await page.locator('[data-test="dragHandleAdd"]').count(), 0);
      assert.equal(await page.locator('[data-test="dragHandle"]').count(), 0);
    }

    const content = page.locator('[data-id="column-check-a-text"] .bn-block-content').first();
    await content.hover();
    await page.waitForFunction(() => Boolean(document.querySelector('[data-test="dragHandleAdd"]')));
    assert.equal(await page.locator('[data-test="dragHandleAdd"]').first().isVisible(), true);
  });

  await check("text choice on the first-column content block never creates a fourth direct child", async () => {
    await chooseFromSlash("column-check-a-text", /文本|段落|Paragraph|Text/i);
    await page.waitForTimeout(250);
    const state = await saved();
    const list = columnList(state);
    assert.equal(list.children.length, 3);
    assert.deepEqual(list.children.map((entry) => entry.type), ["column", "column", "column"]);
    assert.equal(list.children[0].children[0].type, "paragraph");
    assert.equal(await directColumnOuters().count(), 3);
    await screenshot("after-text");
  });

  await check("heading file and database choices stay inside existing column wrappers", async () => {
    await chooseFromSlash("column-check-b-text", /标题 4/);
    await persisted((value) => columnList(value)?.children?.[1]?.children?.[0]?.type === "heading");

    await chooseFromSlash("column-check-b-text", /数据库 - 行内/);
    await persisted((value) => columnList(value)?.children?.[1]?.children?.[0]?.type === "databaseView");

    await chooseFromSlash("column-check-c-text", /^PDF|PDF 文件/);
    const state = await persisted((value) => {
      const list = columnList(value);
      return list?.children?.length === 3 && list.children[2]?.children?.[0]?.type === "file";
    });
    const list = columnList(state);
    assert.deepEqual(list.children.map((entry) => entry.type), ["column", "column", "column"]);
    assert.equal(await directColumnOuters().count(), 3);
  });

  await check("three columns remain structural columns after reload", async () => {
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator('.bn-block-outer[data-id="column-check"]').waitFor();
    assert.equal(await directColumnOuters().count(), 3);
    const state = await saved();
    const list = columnList(state);
    assert.equal(list.children.length, 3);
    assert.deepEqual(list.children.map((entry) => entry.type), ["column", "column", "column"]);
  });
}, { workspace });
