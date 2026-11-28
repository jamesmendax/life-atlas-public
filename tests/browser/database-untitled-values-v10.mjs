import { browserScenario } from "./harness.mjs";
import { coreParityWorkspace } from "../fixtures/core-parity-workspace.mjs";

// The record exists before the scenario and both persisted title fields are
// empty. This isolates editing from whichever New handler created the record.
function untitledWorkspace() {
  const workspace = coreParityWorkspace();
  workspace.databaseItems.find((item) => item.id === "alpha").values.title = "";
  workspace.pages.find((page) => page.id === "alpha-page").title = "";
  workspace.pages.find((page) => page.id === "editor-page").content = [
    { id: "untitled-before", type: "paragraph", content: "Before table" },
    { id: "untitled-table", type: "databaseView", props: { sourceId: "projects", viewId: "view-table" } },
    { id: "untitled-after", type: "paragraph", content: "After table" },
  ];
  workspace.ui.selectedPageId = "editor-page";
  workspace.ui.preferences = { theme: "light", style: "mobai" };
  return workspace;
}

const tableSelector = '[data-id="untitled-table"] .database-view';
const identity = (state) => ({
  itemId: state.databaseItems.find((item) => item.id === "alpha")?.id,
  pageId: state.databaseItems.find((item) => item.id === "alpha")?.pageId,
  sourceId: state.databaseItems.find((item) => item.id === "alpha")?.sourceId,
  itemTitle: state.databaseItems.find((item) => item.id === "alpha")?.values.title,
  pageTitle: state.pages.find((entry) => entry.id === "alpha-page")?.title,
  itemCount: state.databaseItems.length,
  pageCount: state.pages.length,
});
const expected = { itemId: "alpha", pageId: "alpha-page", sourceId: "projects", itemTitle: "", pageTitle: "" };

await browserScenario("database-untitled-values-v10", async ({ page, check, saved, assert }) => {
  const table = page.locator(tableSelector);
  const cell = table.locator('tr[data-item-id="alpha"] td[data-property-id="title"]');
  const button = cell.locator(".db-title-cell");
  const editor = cell.locator(".db-title-editor");
  await table.waitFor();
  const before = identity(await saved());
  assert.deepEqual({ ...before, itemCount: undefined, pageCount: undefined }, { ...expected, itemCount: undefined, pageCount: undefined });

  await check("table edits the empty value and Escape cancels without writing the display label", async () => {
    assert.equal(await button.locator(".db-title-label").innerText(), "无标题");
    assert.equal(await button.getAttribute("aria-label"), "编辑标题 无标题");
    await button.click();
    const observed = { value: await editor.inputValue(), placeholder: await editor.getAttribute("placeholder"), stored: identity(await saved()) };
    console.log("UNTITLED_TABLE_INITIAL", JSON.stringify(observed));
    assert.equal(observed.value, "");
    assert.equal(observed.placeholder, "无标题");
    await editor.fill("取消的名称");
    await editor.press("Escape");
    assert.equal(await cell.evaluate((element) => document.activeElement === element), true);
    assert.deepEqual(identity(await saved()), before);
    assert.equal(await button.locator(".db-title-label").innerText(), "无标题");
  });

  await check("table Enter with no input leaves both values empty across reload", async () => {
    await button.click();
    assert.equal(await editor.inputValue(), "");
    await editor.press("Enter");
    assert.equal(await cell.evaluate((element) => document.activeElement === element), true);
    assert.deepEqual(identity(await saved()), before);
    await page.reload({ waitUntil: "domcontentloaded" });
    await button.waitFor();
    assert.deepEqual(identity(await saved()), before);
    assert.equal(await button.locator(".db-title-label").innerText(), "无标题");
  });
}, { workspace: untitledWorkspace() });

// A separate scenario retains independent red evidence for Peek if the table
// assertion fails first; each scenario gets the same fresh empty fixture.
await browserScenario("database-untitled-values-v10-peek", async ({ page, check, saved, persisted, assert }) => {
  const table = page.locator(tableSelector);
  const cell = table.locator('tr[data-item-id="alpha"] td[data-property-id="title"]');
  const opener = cell.locator(".db-title-open");
  const peek = page.getByRole("dialog", { name: "记录预览", exact: true });
  const input = peek.getByRole("textbox", { name: "记录标题", exact: true });
  const settle = () => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await table.waitFor();
  const before = identity(await saved());
  assert.deepEqual({ ...before, itemCount: undefined, pageCount: undefined }, { ...expected, itemCount: undefined, pageCount: undefined });

  await check("Peek displays a placeholder but edits the empty value and restores the opener", async () => {
    await cell.hover();
    assert.equal(await opener.getAttribute("aria-label"), "打开 无标题");
    await opener.click();
    await peek.waitFor();
    const observed = { value: await input.inputValue(), placeholder: await input.getAttribute("placeholder"), header: await peek.locator(".record-peek-header").innerText(), stored: identity(await saved()) };
    console.log("UNTITLED_PEEK_INITIAL", JSON.stringify(observed));
    assert.equal(observed.value, "");
    assert.equal(observed.placeholder, "无标题");
    assert.ok(observed.header.includes("无标题"));
    await peek.getByRole("button", { name: "关闭预览", exact: true }).click();
    await settle();
    assert.equal(await opener.evaluate((element) => document.activeElement === element), true);
    assert.deepEqual(identity(await saved()), before);
  });

  await check("Peek names the same item and page and keeps the name after reload", async () => {
    await cell.hover();
    await opener.click();
    await peek.waitFor();
    assert.equal(await input.inputValue(), "");
    await input.fill("空标题后命名");
    const named = identity(await persisted((state) => state.databaseItems.find((item) => item.id === "alpha")?.values.title === "空标题后命名" && state.pages.find((entry) => entry.id === "alpha-page")?.title === "空标题后命名"));
    assert.deepEqual(named, { ...before, itemTitle: "空标题后命名", pageTitle: "空标题后命名" });
    await peek.getByRole("button", { name: "关闭预览", exact: true }).click();
    await settle();
    assert.equal(await opener.evaluate((element) => document.activeElement === element), true);
    await page.reload({ waitUntil: "domcontentloaded" });
    await table.waitFor();
    assert.deepEqual(identity(await saved()), named);
    assert.equal(await cell.locator(".db-title-label").innerText(), "空标题后命名");
  });
}, { workspace: untitledWorkspace() });
