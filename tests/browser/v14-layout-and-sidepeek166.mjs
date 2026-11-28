import assert from "node:assert/strict";
import { browserScenario } from "./harness.mjs";
import { coreParityWorkspace } from "../fixtures/core-parity-workspace.mjs";

const run = process.env.LAYOUT166_RUN || "manual";

const workspace = coreParityWorkspace();
workspace.ui.selectedPageId = "database-page";
workspace.ui.preferences = { style: "mobai", theme: "system" };
const page = workspace.pages.find((p) => p.id === "database-page");
page.databaseViewId = "view-board";

const board = workspace.databaseViews.find((v) => v.id === "view-board");
board.visiblePropertyIds = ["notes"];
board.config = {
  ...board.config,
  openRecordsIn: "side",
  showDataSourceTitle: false,
  showPageIcon: true,
  board: {
    colorColumns: true,
    wrapAllContent: true,
  },
};

const vectorPage = workspace.pages.find((p) => p.id === "alpha-page");
vectorPage.icon = "icon:rocket";
vectorPage.iconColor = "#2383e2";

await browserScenario(`LOCAL-NOTION-001/v14-wiki-real133/layout166/${run}/browser-report`, async ({ page, check, assert }) => {
  await page.getByRole("complementary", { name: "主导航" }).locator('[data-node-id="database-page"]').click();
  const database = page.locator('section.database-view[data-source-id="projects"]');
  await database.locator(".db-board-view").waitFor();

  await check("Board layout respects showDataSourceTitle=false, colorColumns, wrapAllContent and showPageIcon", async () => {
    // 1. showDataSourceTitle: false hides .db-view-header
    assert.equal(await database.locator(".db-view-header").count(), 0);

    // 2. colorColumns: columns carry data-color-columns="true"
    const column = database.locator(".db-board-column").first();
    assert.equal(await column.getAttribute("data-color-columns"), "true");

    // 3. wrapAllContent: cards carry is-wrapped class
    const card = database.locator(".db-board-card").first();
    assert.ok((await card.getAttribute("class")).includes("is-wrapped"));

    // 4. showPageIcon: icons are rendered
    assert.ok(await database.locator(".db-board-card-open .db-gallery-title-icon").count() > 0);
  });

  await check("Side peek opens as non-modal right panel without scroll lock, focuses title, and Escape closes to anchor", async () => {
    const cardOpenButton = database.locator(".db-board-card").first().locator(".db-board-card-open");
    await cardOpenButton.click();

    // Verify side peek is present
    const sidePeek = page.locator(".record-peek.is-side");
    await sidePeek.waitFor();
    assert.equal(await sidePeek.getAttribute("role"), "region");

    // Verify backdrop is NOT modal / body scroll is not locked
    const bodyOverflow = await page.evaluate(() => document.body.style.overflow);
    assert.notEqual(bodyOverflow, "hidden");

    // Verify title is focused
    const titleInput = sidePeek.locator(".record-peek-title");
    await page.waitForFunction(() => document.activeElement?.classList?.contains("record-peek-title"));

    // Press Escape to close and verify focus returns to trigger anchor
    await page.keyboard.press("Escape");
    await sidePeek.waitFor({ state: "detached" });

    // Focus restored
    await page.waitForFunction((button) => document.activeElement === button, await cardOpenButton.elementHandle());
  });
}, { workspace, viewport: { width: 1440, height: 900 } });
