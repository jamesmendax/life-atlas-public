import { browserScenario } from "./harness.mjs";
import { coreParityWorkspace } from "../fixtures/core-parity-workspace.mjs";

const workspace = coreParityWorkspace();
workspace.ui = { ...(workspace.ui || {}), selectedPageId: "database-page", selectedFolderId: workspace.pages.find((p) => p.id === "database-page")?.folderId || "parenting" };

await browserScenario("notion-replica-presentation", async ({ page, check, persisted, assert }) => {
  await check("full-width mode is selectable and persists", async () => {
    await page.getByRole("button", { name: "页面操作" }).click({ force: true });
    await page.getByRole("menuitem", { name: "全宽", exact: true }).click({ force: true });
    const saved = await persisted((w) => w.pages.find((p) => p.id === "database-page")?.settings?.presentationMode === "full");
    assert.equal(saved.pages.find((p) => p.id === "database-page").settings.fullWidth, true);
    const width = await page.locator(".page-document-header").evaluate((el) => el.getBoundingClientRect().width);
    assert.ok(width > 900 && width <= 1122, `expected full width, got ${width}`);
  });

  await check("focus reading hides workspace chrome and survives reload", async () => {
    const focusItem = page.getByRole("menuitem", { name: "专注阅读", exact: true });
    if (!(await focusItem.isVisible().catch(() => false))) {
      await page.getByRole("button", { name: "页面操作" }).click({ force: true });
    }
    await focusItem.click({ force: true });
    await page.waitForSelector(".app-shell.is-focus-reading");
    assert.equal(await page.locator(".sidebar").isVisible(), false);
    assert.equal(await page.locator(".workspace-header").isVisible(), false);
    assert.equal(await page.getByRole("button", { name: "退出专注阅读" }).isVisible(), true);
    await persisted((w) => w.pages.find((p) => p.id === "database-page")?.settings?.presentationMode === "focus");
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector(".app-shell.is-focus-reading");
    assert.equal(await page.locator(".sidebar").isVisible(), false);
  });

  await check("focus exit returns to full reading surface", async () => {
    await page.getByRole("button", { name: "退出专注阅读" }).click();
    await page.waitForSelector(".app-shell:not(.is-focus-reading)");
    await persisted((w) => w.pages.find((p) => p.id === "database-page")?.settings?.presentationMode === "full");
  });
}, { workspace });
