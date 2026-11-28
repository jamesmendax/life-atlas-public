import { mkdirSync } from "node:fs";
import { browserScenario } from "./harness.mjs";
import { coreParityWorkspace } from "../fixtures/core-parity-workspace.mjs";

const run = process.env.V10_TEXT_HEADER_RUN || "local";
if (!/^[a-z0-9-]+$/.test(run)) throw new Error("invalid run label");
const dir = "LOCAL-NOTION-001/v10-status-option-default-create/text-header";
mkdirSync(`.qa/${dir}`, { recursive: true });

// The fixture already contains the Text property and non-empty record values.
// Put that existing column next to the title so its anchor is visible.
function fixture(locked = false) {
  const workspace = coreParityWorkspace();
  workspace.ui.preferences = { style: "mobai", theme: "system" };
  const view = workspace.databaseViews.find((entry) => entry.id === "view-table");
  view.visiblePropertyIds = ["title", "notes", ...view.visiblePropertyIds.filter((id) => !["title", "notes"].includes(id))];
  workspace.pages.find((entry) => entry.id === "database-page").settings.locked = locked;
  return workspace;
}
const source = (state) => state.dataSources.find((entry) => entry.id === "projects");
const property = (state) => source(state).properties.find((entry) => entry.id === "notes");
const ids = (state) => source(state).properties.map((entry) => entry.id);
const frames = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

await browserScenario(`${dir}/${run}`, async ({ page, check, saved, persisted, assert, screenshot }) => {
  const db = page.locator('.database-view[data-source-id="projects"]');
  const panel = page.locator('.db-new-property-config[role="dialog"][aria-label="编辑文本属性"]');
  const input = panel.getByLabel("属性名称", { exact: true });
  const open = async (name) => {
    const header = db.getByRole("button", { name: `编辑 ${name} 属性`, exact: true });
    await header.click();
    await page.getByRole("menu", { name: `${name} 属性菜单`, exact: true }).getByRole("menuitem", { name: "编辑属性…", exact: true }).click();
    await panel.waitFor({ state: "visible" });
    return header;
  };
  await db.waitFor();
  const before = await saved();
  assert.equal(property(before).type, "text");
  assert.equal(property(before).name, "说明");
  assert.ok(before.databaseItems.some((item) => item.sourceId === "projects" && item.values.notes));

  await check("existing Text header opens the nearby anchored editor", async () => {
    const header = await open("说明");
    assert.equal(await input.inputValue(), "说明");
    const anchor = await header.boundingBox();
    const bounds = await panel.boundingBox();
    const viewport = page.viewportSize();
    assert.ok(anchor && bounds && viewport);
    assert.ok(Math.abs(bounds.width - 286) <= 3, JSON.stringify(bounds));
    assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= viewport.width && bounds.y + bounds.height <= viewport.height, JSON.stringify(bounds));
    const verticalGap = Math.min(Math.abs(bounds.y - (anchor.y + anchor.height)), Math.abs(bounds.y + bounds.height - anchor.y));
    assert.ok(verticalGap <= 12 && Math.abs(bounds.x - anchor.x) <= 12, JSON.stringify({ anchor, bounds }));
    await screenshot("existing-text-anchored");
  });

  await check("existing property name saves immediately and Escape does not revert", async () => {
    await input.fill("已有属性更名");
    await input.press("Enter");
    assert.equal(await panel.isVisible(), true);
    const renamed = await persisted((value) => property(value)?.name === "已有属性更名");
    assert.equal(property(renamed).id, "notes");
    await page.keyboard.press("Escape");
    await panel.waitFor({ state: "detached" });
    await frames(page);
    assert.equal(property(await saved()).name, "已有属性更名");
    assert.deepEqual(ids(await saved()), ids(before));
    assert.deepEqual((await saved()).databaseItems, before.databaseItems);
  });

  await check("empty name survives Enter, outside click, reload and reopen", async () => {
    await open("已有属性更名");
    await input.fill("");
    await input.press("Enter");
    assert.equal(await input.inputValue(), "");
    assert.equal(await input.getAttribute("placeholder"), "属性名称");
    assert.equal(await panel.isVisible(), true);
    await persisted((value) => property(value)?.name === "");
    await db.getByRole("button", { name: "搜索此视图", exact: true }).click();
    await panel.waitFor({ state: "detached" });
    await page.reload(); await db.waitFor();
    const after = await saved();
    assert.equal(property(after).name, "");
    assert.equal(property(after).id, "notes");
    assert.deepEqual(ids(after), ids(before));
    assert.deepEqual(after.databaseItems, before.databaseItems);
    await open("");
    assert.equal(await input.inputValue(), "");
    assert.equal(await input.getAttribute("placeholder"), "属性名称");
    await page.keyboard.press("Escape");
    await panel.waitFor({ state: "detached" });
    assert.equal(property(await saved()).name, "");
  });

  await check("advanced settings opens the existing form and Cancel discards its draft", async () => {
    await open("");
    await panel.getByRole("button", { name: "更多设置…", exact: true }).click();
    const advanced = page.locator('[role="dialog"][aria-modal="true"][aria-label="编辑文本属性"]');
    await advanced.waitFor({ state: "visible" });
    assert.equal(await advanced.getByLabel("属性名称", { exact: true }).inputValue(), "");
    await advanced.getByLabel("属性名称", { exact: true }).fill("仅高级草稿");
    await advanced.getByRole("button", { name: "取消", exact: true }).click();
    await advanced.waitFor({ state: "detached" });
    await frames(page);
    const after = await saved();
    assert.equal(property(after).name, "");
    assert.deepEqual(ids(after), ids(before));
    assert.deepEqual(after.databaseItems, before.databaseItems);
  });
}, { workspace: fixture(), viewport: { width: 1200, height: 800 } });

await browserScenario(`${dir}/${run}-locked`, async ({ page, check, saved, assert }) => {
  await check("locked host cannot enter existing Text property editing", async () => {
    const before = await saved();
    const header = page.locator('.database-view[data-source-id="projects"]').getByRole("button", { name: "编辑 说明 属性", exact: true });
    assert.equal(await header.isDisabled(), true);
    assert.equal(await page.getByRole("menu", { name: "说明 属性菜单", exact: true }).count(), 0);
    assert.equal(await page.getByRole("dialog", { name: "编辑文本属性", exact: true }).count(), 0);
    assert.deepEqual(source(await saved()).properties, source(before).properties);
    assert.deepEqual((await saved()).databaseItems, before.databaseItems);
  });
}, { workspace: fixture(true), viewport: { width: 1200, height: 800 } });
