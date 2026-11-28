import { browserScenario, shootBothModes } from "./harness.mjs";
import { coreParityWorkspace } from "../fixtures/core-parity-workspace.mjs";
import { existsSync, mkdirSync } from "node:fs";

const run = process.env.V10_NUMBER39_RUN || "local";
if (!/^[a-z0-9-]+$/.test(run)) throw new Error("Invalid run label");
const dir = "LOCAL-NOTION-001/v10-table-number39";
mkdirSync(`.qa/${dir}`, { recursive: true });
if (existsSync(`.qa/${dir}/${run}.json`)) throw new Error("Preserve previous run evidence");
const workspace = coreParityWorkspace();
const source = workspace.dataSources.find((entry) => entry.id === "projects");
source.properties.find((property) => property.id === "formula").config.expression = 'prop("金额") + 1';
source.properties.push({ id: "formatted39", name: "格式数字", type: "number", config: { numberFormat: { format: "cny" } }, options: [] });
workspace.databaseViews.find((view) => view.id === "view-table").visiblePropertyIds = ["title", "amount", "formatted39", "formula"];
workspace.databaseItems.find((item) => item.id === "alpha").values.amount = 15;
workspace.databaseItems.find((item) => item.id === "alpha").values.formatted39 = 1234.5;
workspace.databaseItems.find((item) => item.id === "beta").values.amount = 0;
workspace.databaseItems.find((item) => item.id === "beta").values.formatted39 = 0;
delete workspace.databaseItems.find((item) => item.id === "gamma").values.amount;
workspace.pages.find((page) => page.id === "editor-page").content = [{ id: "number39-table", type: "databaseView", props: { sourceId: "projects", viewId: "view-table" } }];
workspace.ui.selectedPageId = "editor-page";
workspace.ui.preferences = { style: "mobai", theme: "system" };

await browserScenario(`${dir}/${run}`, async ({ page, check, saved, persisted, assert, screenshot }) => {
  const db = page.locator('[data-id="number39-table"] .database-view');
  await db.waitFor();
  const cell = (id, prop = "amount") => db.locator(`tr[data-item-id="${id}"] td[data-property-id="${prop}"]`);
  const read = (id, prop = "amount") => cell(id, prop).getByRole("button");
  const dialog = () => page.getByRole("dialog", { name: /编辑数字/ });
  const input = () => dialog().getByRole("textbox");
  const item = (state, id) => state.databaseItems.find((entry) => entry.id === id);
  const formula = async (id) => (await cell(id, "formula").innerText()).trim();

  await check("Numbers read as formatted buttons including zero and empty", async () => {
    assert.equal((await read("alpha").innerText()).trim(), "15");
    assert.equal((await read("beta").innerText()).trim(), "0");
    assert.equal((await read("gamma").innerText()).trim(), "");
    assert.equal((await read("alpha", "formatted39").innerText()).trim(), "¥1,234.50");
    assert.equal((await read("beta", "formatted39").innerText()).trim(), "¥0.00");
    assert.equal(await db.locator('tbody input[inputmode="decimal"]').count(), 0);
    assert.equal(await formula("alpha"), "16");
  });
  await check("Click opens near the cell and valid edits update formula before Escape", async () => {
    const before = await saved();
    await read("alpha").click();
    await input().waitFor();
    assert.equal(await input().inputValue(), "15");
    const a = await cell("alpha").boundingBox(), b = await dialog().boundingBox();
    assert.ok(b.width >= 220 && b.width <= 260);
    assert.ok(Math.abs(a.y - b.y) <= a.height + 8);
    await shootBothModes(page, screenshot, "number-popup", { keepVisible: ".db-table-number-popover" });
    await input().fill("23");
    assert.equal(await formula("alpha"), "24");
    await persisted((state) => item(state, "alpha").values.amount === 23);
    await input().press("Escape");
    assert.equal(await dialog().count(), 0);
    assert.equal(await cell("alpha").evaluate((node) => document.activeElement === node), true);
    assert.equal((await read("alpha").innerText()).trim(), "23");
    assert.deepEqual((await saved()).databaseItems.filter((entry) => entry.id !== "alpha"), before.databaseItems.filter((entry) => entry.id !== "alpha"));
    await page.reload({ waitUntil: "domcontentloaded" });
    await db.waitFor();
    assert.equal((await read("alpha").innerText()).trim(), "23");
    assert.equal(await formula("alpha"), "24");
  });
  await check("Grid Enter opens raw input and Enter selects next existing row", async () => {
    const before = await saved();
    await cell("alpha").focus();
    await cell("alpha").press("Enter");
    assert.equal(await input().inputValue(), "23");
    await input().fill("15");
    await input().press("Enter");
    await page.waitForFunction(() => document.activeElement?.matches('tr[data-item-id="beta"] td[data-property-id="amount"]'));
    assert.equal(await dialog().count(), 0);
    assert.equal((await read("alpha").innerText()).trim(), "15");
    const after = await persisted((state) => item(state, "alpha").values.amount === 15);
    assert.equal(after.databaseItems.length, before.databaseItems.length);
    assert.equal(after.pages.length, before.pages.length);
  });
  await check("Formatted value opens as raw and outside click leaves focus at its target", async () => {
    await read("alpha", "formatted39").click();
    assert.equal(await input().inputValue(), "1234.5");
    const target = db.getByRole("button", { name: "编辑 名称 属性", exact: true });
    await target.click();
    assert.equal(await dialog().count(), 0);
    assert.equal(await cell("alpha", "formatted39").evaluate((node) => document.activeElement === node), false);
    assert.equal(await page.getByRole("menu", { name: "名称 属性菜单" }).isVisible(), true);
    await page.keyboard.press("Escape");
  });
  await check("Invalid and partial input preserve the last valid value and can be corrected", async () => {
    await read("alpha").click();
    await input().fill("-2");
    await persisted((state) => item(state, "alpha").values.amount === -2);
    await input().fill("-");
    await page.waitForTimeout(600);
    assert.equal(item(await saved(), "alpha").values.amount, -2);
    assert.equal(await input().inputValue(), "-");
    await input().fill("-2.");
    await page.waitForTimeout(100);
    assert.equal(await input().inputValue(), "-2.");
    await input().fill("-2.5");
    await persisted((state) => item(state, "alpha").values.amount === -2.5);
    assert.equal(await input().inputValue(), "-2.5");
    await input().fill("not numeric");
    await page.waitForTimeout(600);
    assert.equal(item(await saved(), "alpha").values.amount, -2.5);
    await input().fill("");
    await persisted((state) => item(state, "alpha").values.amount === null);
    assert.equal(await formula("alpha"), "1");
    await input().press("Escape");
  });
  await check("Composition keys do not close or advance and outside click keeps its focus", async () => {
    await read("alpha").click();
    await input().evaluate((node) => {
      node.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, isComposing: true }));
      node.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, keyCode: 229 }));
    });
    assert.equal(await input().isVisible(), true);
    await read("beta").click();
    assert.equal(await dialog().count(), 1);
    assert.equal(await input().inputValue(), "0");
    await input().press("Escape");
    assert.equal(await cell("beta").evaluate((node) => document.activeElement === node), true);
  });
  await check("Enter on last row does not create a record", async () => {
    const before = await saved();
    await read("gamma").click();
    await input().fill("4");
    await input().press("Enter");
    await page.waitForFunction(() => document.activeElement?.matches('tr[data-item-id="gamma"] td[data-property-id="amount"]'));
    const after = await persisted((state) => item(state, "gamma").values.amount === 4);
    assert.equal(after.databaseItems.length, before.databaseItems.length);
    assert.equal(after.pages.length, before.pages.length);
    assert.equal(await dialog().count(), 0);
    await screenshot("reading");
  });
}, { workspace });

const lockedWorkspace = structuredClone(workspace);
lockedWorkspace.pages.find((page) => page.id === "beta-page").settings.locked = true;
await browserScenario(`${dir}/${run}-locked`, async ({ page, check, assert }) => {
  await check("A locked record number remains read-only", async () => {
    const cell = page.locator('[data-id="number39-table"] tr[data-item-id="beta"] td[data-property-id="amount"]');
    assert.equal((await cell.innerText()).trim(), "0");
    assert.equal(await cell.getByRole("button").count(), 0);
    await cell.click();
    assert.equal(await page.getByRole("dialog", { name: /编辑数字/ }).count(), 0);
  });
}, { workspace: lockedWorkspace });

const lockedHost = structuredClone(workspace);
lockedHost.pages.find((page) => page.id === "editor-page").settings.locked = true;
await browserScenario(`${dir}/${run}-locked-host`, async ({ page, check, assert }) => {
  await check("A locked host keeps its number read-only", async () => {
    const cell = page.locator('[data-id="number39-table"] tr[data-item-id="alpha"] td[data-property-id="amount"]');
    assert.equal((await cell.innerText()).trim(), "15");
    assert.equal(await cell.getByRole("button").count(), 0);
  });
}, { workspace: lockedHost });

const filteredWorkspace = structuredClone(workspace);
filteredWorkspace.databaseViews.find((view) => view.id === "view-table").filter = { kind: "condition", propertyId: "amount", operator: "equals", value: 15 };
await browserScenario(`${dir}/${run}-filtered`, async ({ page, check, persisted, assert }) => {
  await check("A row removed by its live edit unmounts its number popover", async () => {
    const cell = page.locator('[data-id="number39-table"] tr[data-item-id="alpha"] td[data-property-id="amount"]');
    await cell.getByRole("button").click();
    const popup = page.getByRole("dialog", { name: /编辑数字/ });
    await popup.getByRole("textbox").fill("23");
    await persisted((state) => state.databaseItems.find((entry) => entry.id === "alpha").values.amount === 23);
    assert.equal(await cell.count(), 0);
    assert.equal(await popup.count(), 0);
  });
}, { workspace: filteredWorkspace });

const switchWorkspace = structuredClone(workspace);
const secondTable = structuredClone(switchWorkspace.databaseViews.find((view) => view.id === "view-table"));
secondTable.id = "view-table-39-second";
secondTable.name = "第二表格";
switchWorkspace.databaseViews.splice(1, 0, secondTable);
await browserScenario(`${dir}/${run}-switch`, async ({ page, check, assert }) => {
  await check("Changing table view unmounts the open number popover", async () => {
    const db = page.locator('[data-id="number39-table"] .database-view');
    const cell = db.locator('tr[data-item-id="alpha"] td[data-property-id="amount"]');
    await cell.getByRole("button").click();
    const popup = page.getByRole("dialog", { name: /编辑数字/ });
    await popup.waitFor();
    await db.locator('[role="tab"][data-view-id="view-table-39-second"]').evaluate((node) => node.click());
    await page.waitForFunction(() => document.querySelector('[data-id="number39-table"] .database-view')?.dataset.viewId === "view-table-39-second");
    assert.equal(await popup.count(), 0);
  });
}, { workspace: switchWorkspace });
