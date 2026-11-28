import { browserScenario } from "./harness.mjs";
import { coreParityWorkspace } from "../fixtures/core-parity-workspace.mjs";
import { existsSync, mkdirSync } from "node:fs";

const run = process.env.V10_EMPTY_NUMBER35_RUN || "prepared01";
if (!/^[a-z0-9-]+$/.test(run)) throw new Error("Invalid run label");
mkdirSync(".qa/LOCAL-NOTION-001/v10-formula-empty-number35", { recursive: true });
if (existsSync(`.qa/LOCAL-NOTION-001/v10-formula-empty-number35/${run}.json`)) throw new Error("Preserve previous run evidence");
const workspace = coreParityWorkspace();
const source = workspace.dataSources.find((entry) => entry.id === "projects");
source.properties.find((entry) => entry.id === "formula").config.expression = 'prop("金额") + 1';
delete workspace.databaseItems.find((entry) => entry.id === "alpha").values.amount;
workspace.databaseItems.find((entry) => entry.id === "beta").values.amount = 15;
workspace.databaseItems.find((entry) => entry.id === "gamma").values.amount = 0;
workspace.pages.find((entry) => entry.id === "editor-page").content = [{ id: "empty-number35", type: "databaseView", props: { sourceId: "projects", viewId: "view-table" } }];
workspace.ui.selectedPageId = "editor-page";
workspace.ui.preferences = { style: "mobai", theme: "light" };

await browserScenario(`LOCAL-NOTION-001/v10-formula-empty-number35/${run}`, async ({ page, check, saved, persisted, assert, screenshot }) => {
  const db = page.locator('[data-id="empty-number35"] .database-view');
  await db.waitFor();
  const row = (id) => db.locator(`tr[data-item-id="${id}"]`);
  const formulaText = async (id) => (await row(id).locator('[data-property-id="formula"]').innerText()).trim();
  const definition = (state) => state.dataSources.find((entry) => entry.id === "projects").properties.find((entry) => entry.id === "formula");
  const dialog = page.getByRole("dialog", { name: "编辑公式属性" });
  const preview = dialog.locator(".db-formula-preview");
  const expression = dialog.getByLabel("公式表达式");
  const openFormula = async () => {
    await db.getByRole("button", { name: "编辑 双倍金额 属性", exact: true }).click();
    await page.getByRole("menu", { name: "双倍金额 属性菜单", exact: true }).getByRole("menuitem", { name: "编辑属性…", exact: true }).click();
    await dialog.waitFor();
  };
  await check("Table results keep missing amount empty while numeric addition returns 1", async () => {
    const state = await saved();
    assert.equal(await formulaText("alpha"), "1");
    assert.equal(await formulaText("beta"), "16");
    assert.equal(await formulaText("gamma"), "1");
    await row("alpha").getByRole("button", { name: "金额 · Alpha 项目", exact: true }).click();
    const input = page.getByRole("dialog", { name: "编辑数字 金额 · Alpha 项目", exact: true }).getByLabel("金额 · Alpha 项目", { exact: true });
    assert.equal(await input.inputValue(), "");
    assert.deepEqual((await saved()).databaseItems, state.databaseItems);
    await input.press("Escape");
    assert.equal(Object.hasOwn(state.databaseItems.find((entry) => entry.id === "alpha").values, "amount"), false);
    assert.deepEqual(state.databaseItems, workspace.databaseItems);
  });
  await check("Formula previews match left right and double empty addition without saving drafts", async () => {
    const before = await saved();
    await openFormula();
    assert.equal((await preview.innerText()).trim(), "预览（Alpha 项目）：1");
    for (const [text, expected] of [['1 + prop("金额")', "1"], ['prop("金额") + prop("金额")', "0"], ['prop("金额")', ""]]) {
      await expression.fill(text);
      assert.equal((await preview.innerText()).trim(), `预览（Alpha 项目）：${expected}`);
    }
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    assert.deepEqual((await saved()).dataSources, before.dataSources);
    assert.deepEqual((await saved()).databaseItems, before.databaseItems);
  });
  await check("Saving and reloading a reverse addition preserves identities and raw empty values", async () => {
    const before = await saved();
    await openFormula();
    await expression.fill('1 + prop("金额")');
    assert.equal((await preview.innerText()).trim(), "预览（Alpha 项目）：1");
    await dialog.getByRole("button", { name: "保存属性", exact: true }).click();
    await persisted((state) => definition(state).config.expression === '1 + prop("金额")');
    await page.reload({ waitUntil: "domcontentloaded" });
    await db.waitFor();
    assert.equal(await formulaText("alpha"), "1");
    assert.equal(await formulaText("beta"), "16");
    const after = await saved();
    assert.equal(definition(after).id, "formula");
    assert.deepEqual(after.databaseItems, before.databaseItems);
    assert.deepEqual(after.databaseViews, before.databaseViews);
    assert.deepEqual(after.pages, before.pages);
  });
  await check("Explicit zero populated number and clearing a number update the same formula", async () => {
    const amount = row("alpha").getByRole("button", { name: "金额 · Alpha 项目", exact: true });
    const input = page.getByRole("dialog", { name: "编辑数字 金额 · Alpha 项目", exact: true }).getByLabel("金额 · Alpha 项目", { exact: true });
    for (const [text, raw, expected] of [["0", 0, "1"], ["15", 15, "16"], ["", null, "1"]]) {
      await amount.click();
      await input.fill(text);
      await input.press("Enter");
      await persisted((state) => state.databaseItems.find((entry) => entry.id === "alpha").values.amount === raw);
      assert.equal(await formulaText("alpha"), expected);
    }
    await amount.click();
    assert.equal(await input.inputValue(), "");
    await input.press("Escape");
    await screenshot("numeric-addition");
  });
}, { workspace });
