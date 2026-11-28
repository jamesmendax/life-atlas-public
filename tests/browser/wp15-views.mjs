import fs from "node:fs";
import { chooseSavedView } from "./database-navigation.mjs";
import { browserScenario, shootBothModes } from "./harness.mjs";
import { fullWorkspace } from "../fixtures/full-workspace.mjs";

const sample = JSON.parse(fs.readFileSync("docs/blueprint/design/mobai/sample-database.json", "utf8"));
function viewsWorkspace() {
  const workspace = fullWorkspace();
  for (const key of ["dataSources", "databaseViews", "databaseItems", "pages"]) workspace[key].push(...structuredClone(sample[key]));
  workspace.ui.preferences = { theme: "system", style: "mobai" };
  return workspace;
}
const VIEWS = ["list", "gallery", "calendar", "timeline", "chart", "form", "dashboard", "map"];
const viewSection = 'section.database-view[data-source-id="ds-teach"]';
async function chooseView(page, key) {
  await chooseSavedView(page.locator(viewSection), `v-teach-${key}`);
  await page.waitForFunction(([selector, type]) => document.querySelector(selector)?.getAttribute("data-view-type") === type, [viewSection, key]);
  await page.waitForTimeout(800);
}

async function assertInViewport(page, locator, assert) {
  const bounds = await locator.boundingBox();
  const viewport = page.viewportSize();
  assert.ok(bounds && bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= viewport.width && bounds.y + bounds.height <= viewport.height);
}

await browserScenario("wp15-views", async ({ page, check, screenshot, assert }) => {
  await check("The sample database opens", async () => {
    await page.clock.setFixedTime(new Date("2026-11-06T10:00:00+08:00"));
    await page.locator(".workspace-tree-row", { hasText: "教学安排" }).first().click();
    await page.locator(viewSection).waitFor({ state: "visible" });
    await page.waitForTimeout(800);
    await page.waitForTimeout(800);
    assert.equal(await page.locator(viewSection).getAttribute("data-source-id"), "ds-teach");
  });
  for (const key of VIEWS) {
    await check(`View ${key} is captured`, async () => {
      await chooseView(page, key);
      await page.evaluate(() => {
        const header = document.querySelector(".db-view-header");
        const scroller = document.querySelector(".workspace-scroll");
        scroller.scrollTop += header.getBoundingClientRect().top - 70;
      });
      await page.waitForTimeout(400);
      assert.equal(await page.locator(viewSection).getAttribute("data-view-type"), key);
      await shootBothModes(page, screenshot, `view-${key}`);
    });
  }
  await check("Gallery shows covers and the calendar marks today", async () => {
    await chooseView(page, "gallery");
    assert.match(await page.locator(`${viewSection} .db-gallery-cover`).first().evaluate((element) => getComputedStyle(element).backgroundImage), /\/covers\//);
    await chooseView(page, "calendar");
    const weekdays = page.locator(`${viewSection} .db-calendar-weekdays span`);
    assert.equal(await weekdays.count(), 7);
    assert.equal(await weekdays.first().innerText(), "周一");
    const today = page.locator(`${viewSection} .db-calendar-cell[data-date="2026-11-06"]`);
    assert.match(await today.getAttribute("class"), /\bis-today\b/);
    assert.equal(await today.getAttribute("aria-current"), "date");
    assert.equal(await page.locator(`${viewSection} .db-calendar-cell.is-today`).count(), 1);
    assert.equal(await page.locator(`${viewSection} .db-calendar-toolbar strong`).innerText(), "2026年11月");
  });
  await check("The lower form fields and submit action are captured", async () => {
    await chooseView(page, "form");
    const form = page.locator(`${viewSection} .db-form-surface`);
    const submit = form.getByRole("button", { name: "提交记录", exact: true });
    await submit.scrollIntoViewIfNeeded();
    await assertInViewport(page, submit, assert);
    assert.equal(await form.getByLabel("课时", { exact: true }).inputValue(), "");
    assert.match(await form.innerText(), /本地匿名提交/);
    await shootBothModes(page, screenshot, "form-lower", { keepVisible: `${viewSection} .db-form-surface button[type="submit"]` });
  });
  await check("Empty form options show hover keyboard focus and an open picker", async () => {
    const form = page.locator(`${viewSection} .db-form-surface`);
    const option = form.locator('summary[aria-label="类型"]');
    assert.equal(await option.innerText(), "—");
    await option.hover();
    await assertInViewport(page, option, assert);
    assert.equal(await option.evaluate((element) => element.matches(":hover")), true);
    await shootBothModes(page, screenshot, "form-option-empty-hover");
    await form.getByLabel("名称", { exact: true }).focus();
    await page.keyboard.press("Tab");
    assert.equal(await option.evaluate((element) => element === document.activeElement && element.matches(":focus-visible")), true);
    await shootBothModes(page, screenshot, "form-option-empty-focus");
    await page.keyboard.press("Enter");
    const panel = form.locator(".db-option-panel");
    await panel.waitFor({ state: "visible" });
    await assertInViewport(page, panel, assert);
    assert.equal(await panel.getByRole("option").count(), 5);
    assert.equal(await panel.getByLabel("类型 搜索", { exact: true }).inputValue(), "");
    await shootBothModes(page, screenshot, "form-option-empty-open", { keepVisible: `${viewSection} .db-form-surface .db-option-panel` });
    await page.keyboard.press("Escape");
    await panel.waitFor({ state: "hidden" });
    assert.equal(await option.innerText(), "—");
  });
  await check("The empty form date shows hover keyboard focus and its calendar", async () => {
    const form = page.locator(`${viewSection} .db-form-surface`);
    const date = form.locator('summary[aria-label="日期 日期"]');
    assert.equal(await date.innerText(), "—");
    await date.hover();
    await assertInViewport(page, date, assert);
    assert.equal(await date.evaluate((element) => element.matches(":hover")), true);
    await shootBothModes(page, screenshot, "form-date-empty-hover");
    await form.locator('summary[aria-label="年级"]').focus();
    await page.keyboard.press("Tab");
    assert.equal(await date.evaluate((element) => element === document.activeElement && element.matches(":focus-visible")), true);
    await shootBothModes(page, screenshot, "form-date-empty-focus");
    await page.keyboard.press("Enter");
    const panel = form.locator(".db-date-panel");
    await panel.waitFor({ state: "visible" });
    await assertInViewport(page, panel, assert);
    assert.equal(await panel.getByLabel("日期 开始", { exact: true }).inputValue(), "");
    await shootBothModes(page, screenshot, "form-date-empty-open", { keepVisible: `${viewSection} .db-form-surface .db-date-panel` });
    await page.keyboard.press("Escape");
    await panel.waitFor({ state: "hidden" });
    assert.equal(await date.innerText(), "—");
  });
}, { workspace: viewsWorkspace(), viewport: { width: 1440, height: 900 } });
