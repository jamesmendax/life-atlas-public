import { browserScenario } from "./harness.mjs";
import { coreParityWorkspace } from "../fixtures/core-parity-workspace.mjs";

const workspace = coreParityWorkspace();
workspace.pages.find((page) => page.id === "editor-page").content = [{ id: "header-name-table", type: "databaseView", props: { sourceId: "projects", viewId: "view-table" } }];
workspace.ui.selectedPageId = "editor-page";
workspace.ui.preferences = { theme: "light", style: "mobai" };

await browserScenario(`LOCAL-NOTION-001/v10-table-header-name34/${process.env.HEADER34_RUN || "local"}`, async ({ page, check, saved, persisted, assert }) => {
  const table = page.locator('[data-id="header-name-table"] .database-view');
  const header = table.locator('.db-property-header[data-type="title"]');
  const menu = page.getByRole("menu").filter({ has: page.locator(".db-property-menu-identity > small").filter({ hasText: /^名称$/ }) });
  const input = menu.getByLabel("属性名称", { exact: true });
  const before = await saved();
  await check("Title property name saves immediately and Escape keeps it", async () => {
    await header.click();
    await input.fill("V10 标题属性34");
    const changed = await persisted((state) => state.dataSources.find((entry) => entry.id === "projects").properties.find((entry) => entry.id === "title").name === "V10 标题属性34");
    assert.deepEqual(changed.databaseItems, before.databaseItems);
    await input.press("Escape");
    assert.equal(await menu.count(), 0);
    assert.equal(await header.evaluate((node) => document.activeElement === node), true);
    await page.reload({ waitUntil: "domcontentloaded" });
    await header.waitFor();
    assert.equal((await saved()).dataSources.find((entry) => entry.id === "projects").properties.find((entry) => entry.id === "title").name, "V10 标题属性34");
  });
  await check("A unique empty name is saved and Enter leaves the menu open", async () => {
    await header.click();
    await input.fill("");
    await persisted((state) => state.dataSources.find((entry) => entry.id === "projects").properties.find((entry) => entry.id === "title").name === "");
    assert.equal(await menu.getByRole("alert").count(), 0);
    await input.press("Enter");
    assert.equal(await input.isVisible(), true);
    await input.press("Escape");
    assert.equal(await header.evaluate((node) => document.activeElement === node), true);
    await page.reload({ waitUntil: "domcontentloaded" });
    await header.waitFor();
    assert.equal((await saved()).dataSources.find((entry) => entry.id === "projects").properties.find((entry) => entry.id === "title").name, "");
  });
  await check("Input keeps focus and cursor keys, composition, Enter and outside click behave correctly", async () => {
    await header.click();
    await input.fill("焦点名称");
    await persisted((state) => state.dataSources.find((entry) => entry.id === "projects").properties.find((entry) => entry.id === "title").name === "焦点名称");
    assert.equal(await input.evaluate((node) => document.activeElement === node), true);
    await input.press("Home");
    assert.equal(await input.evaluate((node) => node.selectionStart), 0);
    await input.press("End");
    assert.equal(await input.evaluate((node) => node.selectionStart), 4);
    await input.press("ArrowLeft");
    assert.equal(await input.evaluate((node) => node.selectionStart), 3);
    await input.press("ArrowUp");
    assert.equal(await input.evaluate((node) => document.activeElement === node), true);
    await input.evaluate((node) => {
      node.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, isComposing: true }));
      node.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, keyCode: 229 }));
    });
    assert.equal(await input.isVisible(), true);
    await input.press("Enter");
    assert.equal(await input.isVisible(), true);
    const persistedBeforeEnter = await saved();
    await page.waitForTimeout(600);
    assert.deepEqual((await saved()).dataSources, persistedBeforeEnter.dataSources);
    await table.locator('.db-property-header[data-type="status"]').click();
    assert.equal(await input.count(), 0);
    assert.equal(await header.evaluate((node) => document.activeElement === node), false);
    await page.keyboard.press("Escape");
  });
}, { workspace });

const duplicateWorkspace = structuredClone(workspace);
const duplicateSource = duplicateWorkspace.dataSources.find((entry) => entry.id === "projects");
duplicateSource.properties.push({ id: "header34-blank", name: "", type: "text", options: [], config: {} });
await browserScenario(`LOCAL-NOTION-001/v10-table-header-name34/${process.env.HEADER34_RUN || "local"}-duplicate`, async ({ page, check, saved, persisted, assert }) => {
  const table = page.locator('[data-id="header-name-table"] .database-view');
  const header = table.locator('.db-property-header[data-type="title"]');
  const menu = page.getByRole("menu").filter({ has: page.getByLabel("属性名称", { exact: true }) });
  const input = menu.getByLabel("属性名称", { exact: true });
  const getName = (state) => state.dataSources.find((entry) => entry.id === "projects").properties.find((entry) => entry.id === "title").name;
  await check("Duplicate empty name stays editable and Escape preserves the last valid name", async () => {
    const before = await saved();
    await header.click();
    assert.equal(await menu.getByRole("alert").count(), 0);
    await input.fill("有效名称");
    await persisted((state) => getName(state) === "有效名称");
    await input.fill("");
    assert.equal(await input.inputValue(), "");
    assert.equal(await input.getAttribute("aria-invalid"), "true");
    await menu.getByRole("alert").waitFor();
    await page.waitForTimeout(800);
    assert.equal(getName(await saved()), "有效名称");
    await input.fill("修正名称");
    assert.equal(await menu.getByRole("alert").count(), 0);
    await persisted((state) => getName(state) === "修正名称");
    const statusName = duplicateSource.properties.find((entry) => entry.id === "status").name;
    await input.fill(statusName);
    await menu.getByRole("alert").waitFor();
    await page.waitForTimeout(600);
    assert.equal(getName(await saved()), "修正名称");
    await input.fill("");
    await input.press("Escape");
    assert.equal(await header.evaluate((node) => document.activeElement === node), true);
    const after = await saved();
    assert.equal(getName(after), "修正名称");
    assert.deepEqual(after.databaseItems, before.databaseItems);
  });
}, { workspace: duplicateWorkspace });

const historicalWorkspace = structuredClone(workspace);
const historicalSource = historicalWorkspace.dataSources.find((entry) => entry.id === "projects");
const originalName = historicalSource.properties.find((entry) => entry.id === "title").name;
historicalSource.properties.push({ id: "header34-existing-duplicate", name: originalName, type: "text", options: [], config: {} });
await browserScenario(`LOCAL-NOTION-001/v10-table-header-name34/${process.env.HEADER34_RUN || "local"}-historical`, async ({ page, check, saved, assert }) => {
  await check("An unchanged historical duplicate is not rejected or migrated", async () => {
    const before = await saved();
    const header = page.locator('[data-id="header-name-table"] .db-property-header[data-type="title"]');
    await header.click();
    const input = page.getByRole("menu").getByLabel("属性名称", { exact: true });
    assert.equal(await input.inputValue(), originalName);
    await input.fill(originalName);
    assert.equal(await page.getByRole("menu").getByRole("alert").count(), 0);
    await input.press("Escape");
    const after = await saved();
    assert.deepEqual(after.dataSources.find((entry) => entry.id === "projects").properties, before.dataSources.find((entry) => entry.id === "projects").properties);
  });
}, { workspace: historicalWorkspace });

const lockedWorkspace = structuredClone(workspace);
lockedWorkspace.pages.find((page) => page.id === "editor-page").settings.locked = true;
await browserScenario(`LOCAL-NOTION-001/v10-table-header-name34/${process.env.HEADER34_RUN || "local"}-locked`, async ({ page, check, saved, assert }) => {
  await check("Locked host disables the title property menu", async () => {
    const before = await saved();
    const header = page.locator('[data-id="header-name-table"] .db-property-header[data-type="title"]');
    assert.equal(await header.isDisabled(), true);
    assert.equal(await page.getByLabel("属性名称", { exact: true }).count(), 0);
    assert.deepEqual((await saved()).dataSources, before.dataSources);
  });
}, { workspace: lockedWorkspace });
