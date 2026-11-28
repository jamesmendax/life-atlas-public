import { browserScenario } from "./harness.mjs";
import { coreParityWorkspace } from "../fixtures/core-parity-workspace.mjs";
import { existsSync, mkdirSync } from "node:fs";

const run = process.env.HEADER41_RUN || "local";
if (!/^[a-z0-9-]+$/.test(run)) throw new Error("Invalid run label");
const directory = "LOCAL-NOTION-001/v10-table-property-name41";
mkdirSync(`.qa/${directory}`, { recursive: true });
if (existsSync(`.qa/${directory}/${run}.json`)) throw new Error("Preserve prior evidence");
const workspace = coreParityWorkspace();
const source = workspace.dataSources.find((entry) => entry.id === "projects");
source.properties.find((entry) => entry.id === "formula").config.expression = 'prop("金额") + 1';
source.properties.push({ id: "chain41", name: "公式链41", type: "formula", options: [], config: { expression: 'prop("双倍金额") + 2' } });
const visible41 = ["title", "status", "amount", "date", "checked", "formula", "chain41"];
workspace.databaseViews.find((entry) => entry.id === "view-table").visiblePropertyIds = visible41;
workspace.databaseItems.find((entry) => entry.id === "alpha").values.amount = 15;
delete workspace.databaseItems.find((entry) => entry.id === "beta").values.amount;
workspace.databaseItems.find((entry) => entry.id === "gamma").values.amount = 0;
workspace.pages.find((entry) => entry.id === "editor-page").content = [{ id: "header41", type: "databaseView", props: { sourceId: "projects", viewId: "view-table" } }];
workspace.ui.selectedPageId = "editor-page";
workspace.ui.preferences = { style: "mobai", theme: "light" };

await browserScenario(`${directory}/${run}`, async ({ page, check, assert, saved, persisted, screenshot }) => {
  const db = page.locator('[data-id="header41"] .database-view');
  const header = (id) => db.locator('thead .db-property-header').nth(visible41.indexOf(id));
  const menu = () => page.locator('.db-table-menu');
  const input = () => menu().getByLabel("属性名称", { exact: true });
  const getSource = (state) => state.dataSources.find((entry) => entry.id === "projects");
  const definition = (state, id) => getSource(state).properties.find((entry) => entry.id === id);
  const value = async (item, property) => (await db.locator(`tr[data-item-id="${item}"] td[data-property-id="${property}"]`).innerText()).trim();
  await db.waitFor();
  const before = await persisted((state) => state.pages.every((entry) => Number.isInteger(entry.contentRevision) && Object.hasOwn(entry.settings, "presentationMode")));
  await check("A number name changes in its header without breaking dependent formulas", async () => {
    await header("amount").click();
    await input().waitFor();
    assert.equal(await input().inputValue(), "金额");
    await input().fill("金额41复验");
    const changed = await persisted((state) => definition(state, "amount").name === "金额41复验");
    assert.equal(await value("alpha", "formula"), "16");
    assert.equal(await value("beta", "formula"), "1");
    assert.equal(await value("gamma", "formula"), "1");
    assert.equal(await value("alpha", "chain41"), "18");
    assert.deepEqual(changed.databaseItems, before.databaseItems);
    assert.deepEqual(changed.pages, before.pages);
    assert.deepEqual(changed.databaseViews, before.databaseViews);
    assert.deepEqual(changed.dataSources.filter((entry) => entry.id !== "projects"), before.dataSources.filter((entry) => entry.id !== "projects"));
    await input().press("Escape");
    assert.equal(await menu().count(), 0);
    assert.equal(await header("amount").evaluate((node) => document.activeElement === node), true);
    await page.reload({ waitUntil: "domcontentloaded" });
    await db.waitFor();
    assert.equal(await value("alpha", "formula"), "16");
    assert.equal(definition(await saved(), "amount").name, "金额41复验");
  });
  await check("Formula names retain downstream references and Enter keeps the menu open", async () => {
    await header("formula").click();
    await input().fill("结果41");
    await persisted((state) => definition(state, "formula").name === "结果41");
    assert.equal(await value("alpha", "chain41"), "18");
    await input().press("Enter");
    assert.equal(await input().isVisible(), true);
    await input().press("Escape");
    await page.reload({ waitUntil: "domcontentloaded" });
    await db.waitFor();
    assert.equal(await value("alpha", "chain41"), "18");
    assert.deepEqual((await saved()).databaseItems, before.databaseItems);
  });
  await check("A conflicting name remains a local draft and can be corrected", async () => {
    await header("amount").click();
    const valid = await saved();
    await input().fill("状态");
    assert.equal(await input().getAttribute("aria-invalid"), "true");
    await menu().getByRole("alert").waitFor();
    await input().press("Escape");
    const invalid = await saved();
    assert.deepEqual(invalid.dataSources, valid.dataSources);
    assert.deepEqual(invalid.databaseItems, valid.databaseItems);
    await header("amount").click();
    await input().fill("金额");
    await persisted((state) => definition(state, "amount").name === "金额");
    assert.equal(await value("alpha", "formula"), "16");
    await input().press("Escape");
  });
  await check("Other property menus keep their existing commands and definitions", async () => {
    const initial = await saved();
    for (const id of ["status", "date", "checked"]) {
      await header(id).click();
      assert.equal(await input().inputValue(), definition(initial, id).name);
      assert.equal(await menu().getByRole("menuitem", { name: "编辑属性…", exact: true }).isVisible(), true);
      assert.equal(await menu().getByRole("menuitem", { name: "升序排序", exact: true }).isVisible(), true);
      await input().press("Escape");
    }
    assert.deepEqual((await saved()).dataSources, initial.dataSources);
    assert.deepEqual((await saved()).databaseItems, initial.databaseItems);
    await screenshot("header-renames");
  });
}, { workspace });

const locked = structuredClone(workspace);
locked.pages.find((entry) => entry.id === "editor-page").settings.locked = true;
await browserScenario(`${directory}/${run}-locked`, async ({ page, check, assert, saved }) => {
  await check("Locked non-title headers cannot rename properties", async () => {
    const before = await saved();
    assert.equal(await page.locator('[data-id="header41"] thead .db-property-header').nth(visible41.indexOf("amount")).isDisabled(), true);
    assert.equal(await page.getByLabel("属性名称", { exact: true }).count(), 0);
    assert.deepEqual((await saved()).dataSources, before.dataSources);
  });
}, { workspace: locked });
