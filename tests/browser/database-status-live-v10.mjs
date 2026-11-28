import { mkdirSync } from "node:fs";
import { browserScenario } from "./harness.mjs";
import { coreParityWorkspace } from "../fixtures/core-parity-workspace.mjs";

const run = process.env.V10_STATUS_RUN || "local";
if (!/^[a-z0-9-]+$/.test(run)) throw new Error("invalid run label");
const dir = "LOCAL-NOTION-001/v10-status-option-default-create/status-ui";
mkdirSync(`.qa/${dir}`, { recursive: true });

function fixture() {
  const workspace = coreParityWorkspace();
  const host = workspace.pages.find((entry) => entry.id === "editor-page");
  host.content = [{ id: "status-live-db", type: "databaseView", props: { sourceId: "projects", viewId: "view-table" } }];
  workspace.ui.selectedPageId = host.id;
  workspace.ui.preferences = { style: "mobai", theme: "system" };
  workspace.dataSources.find((entry) => entry.id === "projects").properties.find((entry) => entry.id === "status").options = [
    { id: "todo", name: "待办", color: "gray", group: "todo" },
    { id: "doing", name: "进行中", color: "blue", group: "inProgress" },
    { id: "done", name: "完成", color: "green", group: "complete" },
  ];
  return workspace;
}

const property = (state) => state.dataSources.find((entry) => entry.id === "projects").properties.find((entry) => entry.id === "status");
const rowValues = (state) => state.databaseItems.map((item) => [item.id, item.pageId, item.sourceId, item.values.status]);
const settle = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const dbLocator = (page) => page.locator('[data-id="status-live-db"] .database-view');
const headerLocator = (page) => dbLocator(page).locator('.db-property-header[data-type="status"]');
const panelLocator = (page) => page.getByRole("dialog", { name: "编辑状态属性", exact: true });
async function openPanel(page) {
  const header = headerLocator(page);
  await header.click();
  const menu = page.getByRole("menu").filter({ has: page.getByRole("menuitem", { name: "编辑属性…", exact: true }) });
  await menu.getByRole("menuitem", { name: "编辑属性…", exact: true }).click();
  await panelLocator(page).waitFor();
}

const defaultStatusWorkspace = fixture();
delete defaultStatusWorkspace.databaseItems.find(item => item.id === "alpha").values.status;

await browserScenario(`${dir}/${run}-inline`, async ({ page, check, assert, saved, persisted }) => {
  await check("group plus opens an inline empty input without creating an option", async () => {
    const before = await saved();
    await openPanel(page);
    const panel = panelLocator(page);
    await panel.getByRole("button", { name: "在完成添加选项", exact: true }).click();
    const group = panel.getByRole("region", { name: "完成选项", exact: true });
    const input = group.getByRole("textbox", { name: "完成新选项名称", exact: true });
    console.log("STATUS_INLINE_RED", JSON.stringify({ inputCount: await input.count(), wholePanelText: await panel.innerText(), optionIds: property(await saved()).options.map((option) => option.id) }));
    assert.equal(await input.count(), 1, "the empty input belongs inside the selected group");
    assert.equal(await input.inputValue(), "");
    assert.equal(await panel.getByRole("button", { name: "保存属性", exact: true }).count(), 0);
    assert.deepEqual(property(await saved()).options, property(before).options);
    await input.press("Enter");
    await settle(page);
    assert.deepEqual(property(await saved()).options, property(before).options);
    await page.getByRole("complementary", { name: "主导航" }).locator('[data-node-id="editor-page"]').click();
    await settle(page);
    assert.deepEqual(property(await saved()).options, property(before).options);
    await page.reload(); await dbLocator(page).waitFor();
    assert.deepEqual(property(await saved()).options, property(before).options);
  });
  await check("the default status setting persists and supplies the omitted table cell", async () => {
    await openPanel(page);
    const panel = panelLocator(page);
    const setting = panel.getByRole("combobox", { name: "默认状态", exact: true });
    assert.equal(await setting.inputValue(), "");
    await setting.selectOption("doing");
    const configured = await persisted(state => property(state).config?.defaultOptionId === "doing");
    assert.equal(Object.hasOwn(configured.databaseItems.find(item => item.id === "alpha").values, "status"), false);
    await page.keyboard.press("Escape");
    const cell = dbLocator(page).locator('tr[data-item-id="alpha"] td[data-property-id="status"]');
    assert.equal(await cell.innerText(), "进行中");
    await page.reload(); await dbLocator(page).waitFor();
    assert.equal(await cell.innerText(), "进行中");
    await cell.locator("summary").click();
    await cell.getByRole("button", { name: "清除", exact: true }).click();
    await persisted(state => state.databaseItems.find(item => item.id === "alpha").values.status === null);
    assert.equal(await cell.innerText(), "—");
  });
}, { workspace: defaultStatusWorkspace });

await browserScenario(`${dir}/${run}-name`, async ({ page, check, assert, saved, persisted }) => {
  await check("status name is a raw live value retained after Escape and reload", async () => {
    const before = await saved(); await openPanel(page);
    const input = panelLocator(page).getByRole("textbox", { name: "属性名称", exact: true });
    await input.fill("V10 状态自动保存12");
    await page.keyboard.press("Escape"); await settle(page);
    const state = await saved();
    console.log("STATUS_NAME_AFTER_ESCAPE", JSON.stringify({ property: property(state), rows: rowValues(state) }));
    const renamed = await persisted((value) => property(value).name === "V10 状态自动保存12");
    assert.equal(property(renamed).id, property(before).id);
    assert.deepEqual(property(renamed).options, property(before).options);
    assert.deepEqual(rowValues(renamed), rowValues(before));
    assert.equal(await headerLocator(page).evaluate((node) => document.activeElement === node), true);
    await page.reload(); await dbLocator(page).waitFor();
    assert.equal(property(await saved()).name, "V10 状态自动保存12");
    await openPanel(page);
    const reopened = panelLocator(page).getByRole("textbox", { name: "属性名称", exact: true });
    await reopened.fill("");
    await persisted((value) => property(value).name === "");
    await page.keyboard.press("Escape");
    await page.reload(); await dbLocator(page).waitFor();
    assert.equal(property(await saved()).name, "");
    assert.equal(property(await saved()).id, property(before).id);
  });
}, { workspace: fixture() });

await browserScenario(`${dir}/${run}-create`, async ({ page, check, assert, saved, persisted }) => {
  await check("one named Enter creates one option in the requested group, preserving IDs and values", async () => {
    const before = await saved(); await openPanel(page);
    const panel = panelLocator(page);
    await panel.getByRole("button", { name: "在完成添加选项", exact: true }).click();
    const input = panel.getByRole("region", { name: "完成选项", exact: true }).getByRole("textbox", { name: "完成新选项名称", exact: true });
    await input.fill("V10 已归档12");
    await input.evaluate((node) => {
      node.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, isComposing: true }));
      node.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, keyCode: 229 }));
    });
    await settle(page);
    assert.deepEqual(property(await saved()).options, property(before).options, "composing Enter must not create");
    await input.press("Enter");
    const after = await persisted((value) => property(value).options.some((option) => option.name === "V10 已归档12"));
    const added = property(after).options.filter((option) => !property(before).options.some((old) => old.id === option.id));
    console.log("STATUS_CREATE_EVIDENCE", JSON.stringify({ added, beforeRows: rowValues(before), afterRows: rowValues(after) }));
    assert.equal(added.length, 1);
    assert.equal(added[0].name, "V10 已归档12");
    assert.equal(added[0].group, "complete");
    assert.equal(added[0].color, "green");
    assert.deepEqual(property(after).options.filter((option) => option.id !== added[0].id), property(before).options);
    assert.deepEqual(rowValues(after), rowValues(before));
    assert.equal(property(after).id, property(before).id);
    assert.equal(await panel.getByRole("button", { name: "保存属性", exact: true }).count(), 0);
    await page.keyboard.press("Escape");
    await page.reload(); await dbLocator(page).waitFor();
    const reloaded = await saved();
    assert.equal(property(reloaded).options.filter((option) => option.id === added[0].id).length, 1);
    assert.deepEqual(property(reloaded).options.find((option) => option.id === added[0].id), added[0]);
    assert.deepEqual(rowValues(reloaded), rowValues(before));
    await openPanel(page);
    assert.equal(await panelLocator(page).getByRole("button", { name: "编辑选项 V10 已归档12", exact: true }).count(), 1);
  });
}, { workspace: fixture() });

await browserScenario(`${dir}/${run}-keyboard`, async ({ page, check, assert, saved, screenshot }) => {
  await check("blank blur and Escape do not create and Back returns to its option", async () => {
    const before = await saved(); await openPanel(page);
    const panel = panelLocator(page);
    await panel.getByRole("button", { name: "在待办添加选项" }).click();
    const input = panel.getByRole("region", { name: "待办选项" }).getByRole("textbox", { name: "待办新选项名称" });
    await input.fill("   ");
    await panel.getByRole("textbox", { name: "属性名称" }).focus();
    await settle(page);
    assert.deepEqual(property(await saved()).options, property(before).options);
    await panel.getByRole("button", { name: "在进行中添加选项" }).click();
    await panel.getByRole("region", { name: "进行中选项" }).getByRole("textbox", { name: "进行中新选项名称" }).press("Escape");
    await settle(page);
    assert.deepEqual(property(await saved()).options, property(before).options);
    if (!(await panel.isVisible())) await openPanel(page);
    await panel.getByRole("button", { name: "编辑选项 待办" }).click();
    await panel.getByRole("button", { name: "返回选项" }).click();
    assert.equal(await panel.getByRole("button", { name: "编辑选项 待办" }).evaluate((node) => document.activeElement === node), true);
    await page.setViewportSize({ width: 760, height: 700 });
    for (const mode of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme: mode });
      await page.waitForFunction((expected) => document.documentElement.dataset.theme === expected, mode);
      await screenshot(`inline-${mode}`);
      const rect = await panel.evaluate((node) => { const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: innerWidth, height: innerHeight }; });
      assert.ok(rect.left >= 0 && rect.top >= 0 && rect.right <= rect.width && rect.bottom <= rect.height, JSON.stringify(rect));
    }
  });
}, { workspace: fixture(), viewport: { width: 1200, height: 800 } });

const locked = fixture();
locked.pages.find((entry) => entry.id === "editor-page").settings.locked = true;
await browserScenario(`${dir}/${run}-locked`, async ({ page, check, assert, saved }) => {
  await check("locked host cannot open status settings", async () => {
    const before = await saved();
    assert.equal(await headerLocator(page).isDisabled(), true);
    assert.deepEqual(property(await saved()), property(before));
  });
}, { workspace: locked });
