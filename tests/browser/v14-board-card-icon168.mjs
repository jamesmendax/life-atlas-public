import { mkdirSync } from "node:fs";
import { browserScenario, shootBothModes } from "./harness.mjs";
import { coreParityWorkspace } from "../fixtures/core-parity-workspace.mjs";

const run = process.env.BOARD_ICON168_RUN || "manual";
if (!/^[a-z0-9-]+$/.test(run)) throw new Error("Invalid Board icon168 run label");
mkdirSync(`.qa/LOCAL-NOTION-001/v14-wiki-real133/board-icon168/${run}`, { recursive: true });
const workspace = coreParityWorkspace();
workspace.ui.selectedPageId = "database-page";
workspace.ui.preferences = { style: "mobai", theme: "system" };
workspace.pages.find((page) => page.id === "database-page").databaseViewId = "view-board";
const board = workspace.databaseViews.find((view) => view.id === "view-board");
board.visiblePropertyIds = ["notes"];
board.config = { ...board.config, openRecordsIn: "peek" };
const vectorPage = workspace.pages.find((page) => page.id === "alpha-page");
vectorPage.icon = "icon:rocket";
vectorPage.iconColor = "#2383e2";
workspace.pages.find((page) => page.id === "beta-page").icon = "🧭";
const fallbackPage = workspace.pages.find((page) => page.id === "gamma-page");
fallbackPage.icon = "icon:file-description";
fallbackPage.settings.locked = true;
const imagePage = structuredClone(vectorPage);
imagePage.id = "icon168-image-page";
imagePage.title = "Image icon168";
imagePage.icon = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" rx="3" fill="#e2f2ff"/><circle cx="8" cy="8" r="5" fill="#2383e2"/></svg>')}`;
imagePage.content = [{ id: "icon168-image-body", type: "paragraph", content: "Image icon168 body" }];
workspace.pages.push(imagePage);
const imageItem = structuredClone(workspace.databaseItems.find((item) => item.id === "alpha"));
imageItem.id = "icon168-image";
imageItem.pageId = imagePage.id;
imageItem.values.title = imagePage.title;
imageItem.values.notes = "Image icon168 property";
workspace.databaseItems.push(imageItem);

await browserScenario(`LOCAL-NOTION-001/v14-wiki-real133/board-icon168/${run}/browser-report`, async ({ page, check, assert, saved, persisted, screenshot }) => {
  await page.getByRole("complementary", { name: "主导航" }).locator('[data-node-id="database-page"]').click();
  const database = page.locator('section.database-view[data-source-id="projects"]');
  await database.locator(".db-board-view").waitFor();
  const card = (title) => database.locator(".db-board-card").filter({ has: page.getByRole("button", { name: title, exact: true }) });
  const vectorCard = card("Alpha 项目");
  const emojiCard = card("Beta 项目");
  const fallbackCard = card("Gamma 项目");
  const imageCard = card(imagePage.title);
  const initial = await persisted((state) => state.folders.find((folder) => folder.id === "work").lastOpenedPageId === "database-page");

  await check("Board vector emoji image and default icons match shared record rendering in both modes", async () => {
    for (const mode of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme: mode });
      await page.waitForFunction((theme) => document.documentElement.dataset.theme === theme, mode);
      const glyph = vectorCard.locator(".db-board-card-open .db-gallery-title-icon");
      assert.equal(await glyph.getAttribute("aria-hidden"), "true");
      assert.equal(await glyph.locator("use").getAttribute("href"), "/icons/tabler-picker-sprite.svg#ti-rocket");
      assert.equal(await glyph.locator("svg").evaluate((element) => getComputedStyle(element).color), "rgb(35, 131, 226)");
      assert.deepEqual(await glyph.locator("svg").evaluate((element) => ({ width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height })), { width: 16, height: 16 });
      assert.equal(await emojiCard.locator(".db-board-card-open .db-gallery-title-icon").innerText(), "🧭");
      const image = imageCard.locator(".db-board-card-open img");
      await image.waitFor();
      await page.waitForFunction((address) => [...document.querySelectorAll(".db-board-card-open img")].some((element) => element.src === address && element.complete && element.naturalWidth > 0), imagePage.icon);
      assert.equal(await image.getAttribute("src"), imagePage.icon);
      assert.deepEqual(await image.evaluate((element) => ({ width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height })), { width: 16, height: 16 });
      assert.equal(await fallbackCard.locator(".db-board-card-open use").getAttribute("href"), "/icons/tabler-picker-sprite.svg#ti-file-description");
      assert.equal(await fallbackCard.getByRole("button", { name: "Gamma 项目", exact: true }).count(), 1);
    }
    await shootBothModes(page, screenshot, "board-icons");
    const after = await saved();
    for (const key of Object.keys(initial).filter((key) => Array.isArray(initial[key]))) assert.deepEqual(after[key], initial[key], `Rendering does not mutate ${key}`);
  });

  await check("Clicking the icon opens the existing record preview and keeps its properties", async () => {
    assert.equal(await vectorCard.locator(".db-board-properties").innerText(), "项目正文摘要 alpha");
    await vectorCard.locator(".db-board-card-open .db-gallery-title-icon").click();
    const preview = page.getByRole("dialog", { name: "记录预览", exact: true });
    await preview.waitFor();
    assert.equal(await preview.getByRole("textbox", { name: "记录标题", exact: true }).inputValue(), "Alpha 项目");
    assert.ok((await preview.innerText()).includes("Alpha 项目的文档正文和交付说明。"));
    await preview.getByRole("button", { name: "关闭预览", exact: true }).click();
    const after = await saved();
    assert.deepEqual(after.databaseItems, initial.databaseItems);
    assert.deepEqual(after.pages, initial.pages);
  });

  await check("Board card dragging still moves the same record and preserves icon metadata", async () => {
    assert.equal(await vectorCard.getAttribute("draggable"), "true");
    await page.evaluate(() => {
      document.addEventListener("dragstart", (event) => {
        window.__boardIcon168Drag = { effectAllowed: event.dataTransfer.effectAllowed, itemId: event.dataTransfer.getData("text/life-atlas-item"), text: event.dataTransfer.getData("text/plain") };
      }, { once: true });
    });
    const destination = database.locator('.db-board-column[data-group-key="todo"]');
    await vectorCard.dragTo(destination);
    assert.deepEqual(await page.evaluate(() => window.__boardIcon168Drag), { effectAllowed: "move", itemId: "alpha", text: "alpha" });
    const moved = await persisted((state) => state.databaseItems.find((item) => item.id === "alpha").values.status === "todo");
    assert.deepEqual(moved.pages, initial.pages);
    assert.equal(moved.databaseItems.length, initial.databaseItems.length);
    assert.equal(await destination.getByRole("button", { name: "Alpha 项目", exact: true }).count(), 1);
    assert.equal(await vectorCard.locator(".db-board-card-open use").getAttribute("href"), "/icons/tabler-picker-sprite.svg#ti-rocket");
  });

  await check("Locked default-icon cards retain title access and disable movement", async () => {
    assert.equal(await fallbackCard.getAttribute("draggable"), "false");
    assert.equal(await fallbackCard.locator(".db-drag-handle").isDisabled(), true);
    assert.equal(await fallbackCard.locator(".db-board-move-menu").count(), 0);
    assert.equal(await fallbackCard.locator(".db-board-properties").innerText(), "项目正文摘要 gamma");
    await fallbackCard.getByRole("button", { name: "Gamma 项目", exact: true }).click();
    const preview = page.getByRole("dialog", { name: "记录预览", exact: true });
    await preview.waitFor();
    await preview.getByRole("button", { name: "关闭预览", exact: true }).click();
  });
}, { workspace, viewport: { width: 1440, height: 900 } });
