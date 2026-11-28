import fs from "node:fs";
import { browserScenario } from "./harness.mjs";
import { fullWorkspace } from "../fixtures/full-workspace.mjs";

const sample = JSON.parse(fs.readFileSync("docs/blueprint/design/mobai/sample-page.json", "utf8"));
function mobaiWorkspace() {
  const workspace = fullWorkspace();
  const base = workspace.pages.find((page) => page.id === "p-a1");
  workspace.pages.push({ ...structuredClone(base), id: "p-mobai-sample", title: sample.title, icon: sample.icon, cover: null, sortIndex: 5, content: sample.blocks });
  return workspace;
}
const computed = (page, selector, property) => page.evaluate(([selector, property]) => getComputedStyle(document.querySelector(selector))[property], [selector, property]);

await browserScenario("wp20-mobai", async ({ page, check, screenshot, saved, persisted, assert }) => {
  const requests = [];
  page.on("request", (request) => requests.push(request.url()));
  const mode = async (theme) => { await page.emulateMedia({ colorScheme: theme }); await page.waitForFunction((value) => document.documentElement.dataset.theme === value, theme); };
  const openPage = async (title) => { await page.locator(".workspace-sidebar .page-tree-row").filter({ hasText: title }).click(); await page.locator(".life-editor .bn-editor").first().waitFor(); await page.evaluate(() => document.fonts.ready); };

  await check("Mobai is applied before the first render", async () => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator('html[data-la-ready="1"]').waitFor();
    assert.equal(await page.locator("html").getAttribute("data-style"), "mobai");
    assert.equal(await page.locator("html").getAttribute("data-theme"), "light");
    assert.equal((await saved()).ui.preferences?.theme || "system", "system");
  });
  await check("Fonts come from the bundled packages", async () => {
    await openPage("电化学复习提纲");
    assert.ok((await computed(page, ".page-title-input", "fontFamily")).startsWith('"Segoe UI Variable Text"'));
    assert.equal(await computed(page, ".page-title-input", "fontSize"), "40px");
    assert.equal(await computed(page, ".page-title-input", "fontWeight"), "700");
    assert.ok((await computed(page, ".life-editor .bn-editor", "fontFamily")).startsWith('"Segoe UI Variable Text"'));
    assert.equal(await computed(page, ".life-editor .bn-editor", "fontSize"), "16px");
    assert.equal(await computed(page, ".life-editor .bn-editor", "lineHeight"), "24px");
    assert.equal(await page.evaluate(() => document.fonts.check('700 40px "Noto Sans SC Variable"', "电化学")), true);
    assert.equal(requests.some((url) => /fonts\.(googleapis|gstatic)\.com/.test(url)), false);
  });
  await check("Light colors match the palette", async () => {
    assert.equal(await computed(page, ".workspace-sidebar", "backgroundColor"), "rgb(247, 247, 245)");
    assert.equal(await computed(page, ".workspace-scroll", "backgroundColor"), "rgb(255, 255, 255)");
    assert.equal(await computed(page, ".page-title-input", "color"), "rgb(55, 53, 47)");
    assert.equal(await page.locator(".life-editor .bn-container").first().getAttribute("data-color-scheme"), "light");
  });
  await check("Dark colors match the palette", async () => {
    await mode("dark");
    assert.equal(await computed(page, ".workspace-sidebar", "backgroundColor"), "rgb(32, 32, 32)");
    assert.equal(await computed(page, ".workspace-scroll", "backgroundColor"), "rgb(25, 25, 25)");
    assert.equal(await computed(page, ".page-title-input", "color"), "rgb(212, 212, 212)");
    await page.locator('.life-editor .bn-container[data-color-scheme="dark"]').first().waitFor();
  });
  await check("The theme toggle cycles and persists", async () => {
    await mode("light");
    const toggle = page.getByRole("button", { name: "切换白天/夜间", exact: true });
    await toggle.click();
    assert.equal(await toggle.getAttribute("title"), "外观：白天");
    assert.equal(await page.locator("html").getAttribute("data-theme"), "light");
    await toggle.click();
    assert.equal(await toggle.getAttribute("title"), "外观：夜间");
    await persisted((workspace) => workspace.ui?.preferences?.theme === "dark");
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator('html[data-la-ready="1"]').waitFor();
    assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
    assert.equal((await saved()).ui.preferences.theme, "dark");
    await toggle.click();
    assert.equal(await toggle.getAttribute("title"), "外观：跟随系统");
  });
  await check("System mode follows the computer", async () => { await mode("dark"); await mode("light"); });
  for (const theme of ["light", "dark"]) {
    await mode(theme);
    await openPage("电化学复习提纲");
    await screenshot(`sample-page-${theme}`);
    await page.locator(".workspace-scroll").evaluate((element) => element.scrollTo(0, 620));
    await screenshot(`sample-page-lower-${theme}`);
    await page.locator(".workspace-scroll").evaluate((element) => element.scrollTo(0, 0));
    await page.getByRole("button", { name: "页面操作", exact: true }).click();
    await screenshot(`page-menu-${theme}`);
    await page.keyboard.press("Escape");
    await openPage("B 笔记");
    await screenshot(`inline-db-${theme}`);
    await page.locator(".workspace-sidebar .tree-folder-main").filter({ hasText: "A 项目" }).click();
    await screenshot(`folder-${theme}`);
    await page.keyboard.press("Control+k");
    await page.getByRole("dialog", { name: "全局搜索", exact: true }).locator("input").fill("电化学");
    await page.getByRole("dialog", { name: "全局搜索", exact: true }).getByRole("option").first().waitFor();
    await screenshot(`search-${theme}`);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Home", exact: true }).click();
    await screenshot(`home-${theme}`);
    await page.getByRole("complementary", { name: "主导航" }).getByRole("button", { name: /回收站/ }).click();
    await screenshot(`trash-${theme}`);
    await openPage("电化学复习提纲");
    await page.locator(".life-callout-icon").first().click();
    await page.locator('[data-la-dialog="prompt"]').waitFor();
    await screenshot(`prompt-${theme}`);
    await page.keyboard.press("Escape");
  }
}, { workspace: mobaiWorkspace(), now: "2026-10-02T08:00:00.000Z", viewport: { width: 1440, height: 900 } });
