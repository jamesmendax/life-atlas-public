import { browserScenario, shootBothModes } from "./harness.mjs";
import { coreParityWorkspace } from "../fixtures/core-parity-workspace.mjs";

const workspace = coreParityWorkspace();
workspace.pages.find((page) => page.id === "editor-page").content = [
  { id: "v10-title-before", type: "paragraph", content: "Before table" },
  { id: "v10-title-table", type: "databaseView", props: { sourceId: "projects", viewId: "view-table" } },
  { id: "v10-title-after", type: "paragraph", content: "After table" },
];
workspace.pages.find((page) => page.id === "beta-page").settings.locked = true;
workspace.ui.selectedPageId = "editor-page";
workspace.ui.preferences = { theme: "system", style: "mobai" };

await browserScenario("database-table-title-v10", async ({ page, check, screenshot, saved, persisted, assert }) => {
  const table = page.locator('[data-id="v10-title-table"] .database-view');
  const cell = (id) => table.locator(`tr[data-item-id="${id}"] td[data-property-id="title"]`);
  const editor = (id) => cell(id).locator(".db-title-editor");
  const title = (id) => cell(id).locator(".db-title-cell");
  const open = (id) => cell(id).locator(".db-title-open");
  const dialog = page.getByRole("dialog", { name: "记录预览" });
  const pageTitle = (state, id) => state.pages.find((entry) => entry.id === `${id}-page`).title;
  const itemTitle = (state, id) => state.databaseItems.find((entry) => entry.id === id).values.title;
  const identities = (state) => Object.fromEntries(["pages", "dataSources", "databaseViews", "databaseItems"].map((key) => [key, state[key].map((entry) => entry.id).sort()]));
  const baseline = await saved();

  await check("Single click edits inline and Enter commits the same record and page", async () => {
    await title("alpha").click();
    assert.equal(await editor("alpha").count(), 1);
    assert.equal(await dialog.count(), 0);
    assert.equal(await table.locator(".ProseMirror-selectednode").count(), 0);
    assert.equal(await table.evaluate((node) => Boolean(node.closest(".ProseMirror-selectednode"))), false);
    await editor("alpha").click();
    assert.equal(await table.evaluate((node) => Boolean(node.closest(".ProseMirror-selectednode"))), false);
    await shootBothModes(page, screenshot, "title-edit", { keepVisible: ".db-title-editor" });
    await editor("alpha").fill("  Alpha Enter  ");
    await editor("alpha").press("Enter");
    const state = await persisted((w) => w.pages.find((p) => p.id === "alpha-page").title === "  Alpha Enter  ");
    assert.equal(itemTitle(state, "alpha"), "  Alpha Enter  ");
    assert.deepEqual(identities(state), identities(baseline));
    assert.equal(state.databaseItems.find((item) => item.id === "alpha").pageId, "alpha-page");
    assert.equal(state.databaseItems.find((item) => item.id === "alpha").sourceId, "projects");
    assert.equal(await cell("alpha").evaluate((node) => document.activeElement === node), true);
  });

  await check("Blur commits and reload keeps title and identities", async () => {
    await title("alpha").click();
    await editor("alpha").fill("Alpha blur");
    await page.locator('[data-id="v10-title-before"] .bn-block-content').first().click();
    const state = await persisted((w) => w.pages.find((p) => p.id === "alpha-page").title === "Alpha blur");
    assert.equal(itemTitle(state, "alpha"), "Alpha blur");
    assert.deepEqual(identities(state), identities(baseline));
    await page.reload({ waitUntil: "domcontentloaded" });
    await title("alpha").waitFor();
    assert.equal(await title("alpha").locator(".db-title-label").innerText(), "Alpha blur");
    const reloaded = await saved();
    assert.equal(pageTitle(reloaded, "alpha"), "Alpha blur");
    assert.equal(itemTitle(reloaded, "alpha"), "Alpha blur");
    assert.deepEqual(identities(reloaded), identities(baseline));
  });

  await check("Escape cancels and returns focus to the same cell", async () => {
    await title("alpha").click();
    await editor("alpha").fill("Cancelled title");
    await editor("alpha").press("Escape");
    assert.equal(await editor("alpha").count(), 0);
    assert.equal(await cell("alpha").evaluate((node) => document.activeElement === node), true);
    assert.equal(await title("alpha").locator(".db-title-label").innerText(), "Alpha blur");
    assert.equal(pageTitle(await saved(), "alpha"), "Alpha blur");
  });

  await check("IME Enter does not commit for composing or keyCode 229", async () => {
    await title("alpha").click();
    await editor("alpha").fill("IME draft");
    await editor("alpha").evaluate((node) => {
      node.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, isComposing: true }));
      node.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, keyCode: 229 }));
    });
    assert.equal(await editor("alpha").inputValue(), "IME draft");
    assert.equal(pageTitle(await saved(), "alpha"), "Alpha blur");
    await editor("alpha").press("Escape");
  });

  await check("Explicit open reaches the correct page and body", async () => {
    await cell("alpha").hover();
    await open("alpha").click();
    await dialog.waitFor();
    assert.equal(await dialog.getByLabel("记录标题").inputValue(), "Alpha blur");
    assert.ok((await dialog.innerText()).includes("Alpha 项目的文档正文和交付说明。"));
    await shootBothModes(page, screenshot, "record-open", { keepVisible: ".record-peek" });
    await dialog.getByRole("button", { name: "关闭预览" }).click();
  });

  await check("Locked record cannot edit and opens read-only", async () => {
    await title("beta").click();
    assert.equal(await editor("beta").count(), 0);
    await cell("beta").hover();
    await open("beta").click();
    await dialog.waitFor();
    assert.equal(await dialog.getByLabel("记录标题").inputValue(), "Beta 项目");
    assert.equal(await dialog.getByLabel("记录标题").getAttribute("readonly"), "");
    assert.ok((await dialog.innerText()).includes("Beta 项目的文档正文和交付说明。"));
    await dialog.getByRole("button", { name: "关闭预览" }).click();
    assert.equal(pageTitle(await saved(), "beta"), "Beta 项目");
  });

  await check("Row-end creation makes one record, edits inline and keeps its identity", async () => {
    const before = await saved();
    await table.getByRole("button", { name: "新建页面" }).click();
    const created = await persisted((w) => w.databaseItems.length === before.databaseItems.length + 1 && w.pages.length === before.pages.length + 1);
    const newItems = created.databaseItems.filter((item) => !before.databaseItems.some((old) => old.id === item.id));
    const newPages = created.pages.filter((entry) => !before.pages.some((old) => old.id === entry.id));
    assert.equal(newItems.length, 1);
    assert.equal(newPages.length, 1);
    const item = newItems[0], newPage = newPages[0];
    assert.equal(item.pageId, newPage.id);
    assert.equal(item.sourceId, "projects");
    assert.equal(item.values.status, "todo");
    assert.ok(item.values.date == null);
    assert.equal(newPage.title, "");
    assert.equal(item.values.title, "");
    await editor(item.id).waitFor();
    assert.equal(await editor(item.id).inputValue(), "");
    assert.equal(await editor(item.id).getAttribute("placeholder"), "无标题");
    assert.equal(await editor(item.id).evaluate((node) => document.activeElement === node && node.selectionStart === 0 && node.selectionEnd === node.value.length), true);
    assert.equal(await dialog.count(), 0);
    await shootBothModes(page, screenshot, "row-create", { keepVisible: ".db-title-editor" });
    await editor(item.id).fill("V10 UI 表格 · 2026-11-11");
    await editor(item.id).press("Enter");
    const named = await persisted((w) => w.pages.find((p) => p.id === newPage.id)?.title === "V10 UI 表格 · 2026-11-11");
    assert.equal(named.databaseItems.find((entry) => entry.id === item.id).values.title, "V10 UI 表格 · 2026-11-11");
    assert.equal(named.databaseItems.length, before.databaseItems.length + 1);
    assert.equal(named.pages.length, before.pages.length + 1);
    assert.equal(await cell(item.id).evaluate((node) => document.activeElement === node), true);
    assert.equal(await table.locator(".db-title-editor").count(), 0);
    assert.equal(await dialog.count(), 0);
    await cell(item.id).hover();
    await open(item.id).click();
    await dialog.waitFor();
    assert.equal(await dialog.getByLabel("记录标题").inputValue(), "V10 UI 表格 · 2026-11-11");
    await dialog.getByRole("button", { name: "关闭预览" }).click();
    await page.reload({ waitUntil: "domcontentloaded" });
    await title(item.id).waitFor();
    const reloaded = await saved();
    assert.deepEqual(identities(reloaded), identities(named));
    assert.equal(reloaded.databaseItems.find((entry) => entry.id === item.id).pageId, newPage.id);
    assert.equal(reloaded.pages.find((entry) => entry.id === newPage.id).title, "V10 UI 表格 · 2026-11-11");
  });
}, { workspace });

const emptyWorkspace = coreParityWorkspace();
emptyWorkspace.databaseItems = emptyWorkspace.databaseItems.filter((item) => item.sourceId !== "projects");
emptyWorkspace.ui.preferences = { theme: "light", style: "mobai" };
await browserScenario("database-table-title-v10-empty", async ({ page, check, saved, persisted, assert }) => {
  await check("Empty table can create and Escape retains the created record", async () => {
    const before = await saved();
    const table = page.locator('.database-view[data-source-id="projects"]');
    await table.getByRole("button", { name: "新建页面" }).click();
    const state = await persisted((w) => w.databaseItems.length === before.databaseItems.length + 1 && w.pages.length === before.pages.length + 1);
    const item = state.databaseItems.find((entry) => !before.databaseItems.some((old) => old.id === entry.id));
    const cell = table.locator(`tr[data-item-id="${item.id}"] td[data-property-id="title"]`);
    const input = cell.locator(".db-title-editor");
    await input.waitFor();
    await input.fill("cancelled draft");
    await input.press("Escape");
    assert.equal(await cell.evaluate((node) => document.activeElement === node), true);
    const afterCancel = await saved();
    assert.equal(afterCancel.pages.find((entry) => entry.id === item.pageId).title, "");
    assert.equal(afterCancel.databaseItems.find((entry) => entry.id === item.id).values.title, "");
    assert.equal(afterCancel.databaseItems.length, before.databaseItems.length + 1);
  });
}, { workspace: emptyWorkspace });

const virtualWorkspace = coreParityWorkspace();
const virtualItem = virtualWorkspace.databaseItems.find((item) => item.id === "alpha");
const virtualPage = virtualWorkspace.pages.find((entry) => entry.id === "alpha-page");
for (let index = 0; index < 201; index += 1) {
  const id = `v10-virtual-${index}`;
  virtualWorkspace.databaseItems.push({ ...structuredClone(virtualItem), id, pageId: `${id}-page`, values: { ...structuredClone(virtualItem.values), title: `Virtual ${index}` } });
  virtualWorkspace.pages.push({ ...structuredClone(virtualPage), id: `${id}-page`, title: `Virtual ${index}`, content: [{ id: `${id}-body`, type: "paragraph", content: `Body ${index}` }] });
}
virtualWorkspace.ui.preferences = { theme: "light", style: "mobai" };
await browserScenario("database-table-title-v10-virtual", async ({ page, check, saved, persisted, assert }) => {
  await check("Row-end creation focuses the returned item in a virtual table", async () => {
    const before = await saved();
    const table = page.locator('.database-view[data-source-id="projects"]');
    assert.equal(await table.locator(".db-table-scroll.is-virtual").count(), 1);
    await table.getByRole("button", { name: "新建页面" }).click();
    const state = await persisted((w) => w.databaseItems.length === before.databaseItems.length + 1);
    const item = state.databaseItems.find((entry) => !before.databaseItems.some((old) => old.id === entry.id));
    const cell = table.locator(`tr[data-item-id="${item.id}"] td[data-property-id="title"]`);
    const input = cell.locator(".db-title-editor");
    await input.waitFor();
    assert.equal(await input.evaluate((node) => document.activeElement === node), true);
    await input.fill("Virtual created title");
    await input.press("Enter");
    const named = await persisted((w) => w.pages.find((entry) => entry.id === item.pageId)?.title === "Virtual created title");
    assert.equal(named.databaseItems.length, before.databaseItems.length + 1);
    assert.equal(await cell.evaluate((node) => document.activeElement === node), true);
  });
}, { workspace: virtualWorkspace });

const lockedHost = coreParityWorkspace();
lockedHost.pages.find((page) => page.id === "editor-page").settings.locked = true;
lockedHost.pages.find((page) => page.id === "editor-page").content = [{ id: "v10-locked-host-table", type: "databaseView", props: { sourceId: "projects", viewId: "view-table" } }];
lockedHost.ui.selectedPageId = "editor-page";
lockedHost.ui.preferences = { theme: "light", style: "mobai" };

await browserScenario("database-table-title-v10-locked-host", async ({ page, check, saved, assert }) => {
  await check("Locked host keeps its linked table and record preview read-only", async () => {
    const before = await saved();
    assert.equal(before.pages.find((entry) => entry.id === "database-page").settings.locked, false);
    assert.equal(before.pages.find((entry) => entry.id === "alpha-page").settings.locked, false);
    const cell = page.locator('[data-id="v10-locked-host-table"] tr[data-item-id="alpha"] td[data-property-id="title"]');
    assert.equal(await page.locator('[data-id="v10-locked-host-table"]').getByRole("button", { name: "新建页面" }).count(), 0);
    await cell.locator(".db-title-cell").click();
    assert.equal(await cell.locator(".db-title-editor").count(), 0);
    await cell.hover();
    await cell.locator(".db-title-open").click();
    const dialog = page.getByRole("dialog", { name: "记录预览" });
    await dialog.waitFor();
    assert.equal(await dialog.getByLabel("记录标题").inputValue(), "Alpha 项目");
    assert.equal(await dialog.getByLabel("记录标题").getAttribute("readonly"), "");
    assert.ok((await dialog.innerText()).includes("Alpha 项目的文档正文和交付说明。"));
    assert.equal((await saved()).pages.find((entry) => entry.id === "alpha-page").title, "Alpha 项目");
  });
}, { workspace: lockedHost });
