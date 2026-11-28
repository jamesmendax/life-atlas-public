import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { bigWorkspace } from "../fixtures/big-workspace.mjs";
import { fullWorkspace } from "../fixtures/full-workspace.mjs";
import { REPO_ROOT, assertNoNetworkAndErrors, closeApp, createIsolatedDirectory, launchApp, openPageInSidebar, removeIsolatedDirectory, seedWorkspaceDatabase, shootWindowBothModes } from "./helpers.mjs";

const gbkBuffer = Buffer.from([0xC3, 0xFB, 0xB3, 0xC6, 0x2C, 0xBD, 0xF0, 0xB6, 0xEE, 0x0D, 0x0A, 0xC6, 0xBB, 0xB9, 0xFB, 0x2C, 0x33, 0x0D, 0x0A]);

async function waitForDatabasePage(page, title) {
  const deadline = Date.now() + 30000;
  do {
    const result = await page.evaluate(() => window.lifeAtlas.workspace.load());
    assert.equal(result.ok, true, result.error?.message);
    if (result.value.workspace.pages.some((entry) => entry.title === title && entry.pageType === "database")) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  } while (Date.now() < deadline);
  assert.fail("The imported database page did not reach SQLite before the save deadline");
}

test("a ten thousand record table stays fast", async () => {
  const dataRoot = createIsolatedDirectory("wp15-big-table");
  let handle;
  let complete = false;
  try {
    const workspace = bigWorkspace({ pages: 0, records: 10000 });
    workspace.pages.find((page) => page.id === "big-db-page").title = "大表格";
    workspace.ui = { ...workspace.ui, selectedPageId: null, activeSection: "home", preferences: { theme: "system", style: "mobai" } };
    await seedWorkspaceDatabase(dataRoot, workspace);
    handle = await launchApp({ packaged: true, dataRoot });
    const page = handle.page;
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole("complementary", { name: "主导航" }).waitFor();
    assert.equal(await page.locator(".db-table tbody tr[data-item-id]").count(), 0);
    await page.keyboard.press("Control+k");
    const search = page.getByRole("dialog", { name: "全局搜索", exact: true });
    await search.getByRole("combobox", { name: "搜索文件夹、页面与正文" }).fill("大表格");
    await search.getByRole("option").getByText("大表格", { exact: true }).waitFor();
    const openedAt = Date.now();
    await search.getByRole("combobox", { name: "搜索文件夹、页面与正文" }).press("Enter");
    const table = page.locator('section.database-view[data-source-id="big-ds"] .db-table');
    await table.locator("tbody tr[data-item-id]").first().waitFor();
    const openMs = Date.now() - openedAt;
    console.log(`WP15_TABLE_OPEN_MS=${openMs}`);
    assert.ok(openMs < 1500, `Opening 10k records took ${openMs}ms`);
    assert.ok(await table.locator("tbody tr[data-item-id]").count() < 100);
    assert.equal(await table.locator("tbody tr[data-item-id]").first().getAttribute("data-item-id"), "big-i-0");
    await page.locator(".db-table-scroll").evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await table.locator('tbody tr[data-item-id="big-i-9999"]').waitFor();
    await table.getByRole("button", { name: "编辑 数字 属性", exact: true }).click();
    const sort = page.getByRole("menu", { name: "数字 属性菜单", exact: true }).getByRole("menuitem", { name: "降序排序", exact: true });
    const sortedAt = Date.now();
    await sort.click();
    await page.waitForFunction(() => document.querySelector('section.database-view[data-source-id="big-ds"] tbody tr[data-item-id]')?.dataset.itemId === "big-i-9999");
    const sortMs = Date.now() - sortedAt;
    console.log(`WP15_SORT_MS=${sortMs}`);
    assert.ok(sortMs < 500, `Sorting 10k records took ${sortMs}ms`);
    const numberLabel = "数字 · 记录 9999";
    const numberButton = table.locator('tbody tr[data-item-id="big-i-9999"] td[data-property-id="amount"]').getByRole("button", { name: numberLabel, exact: true });
    assert.equal(await numberButton.innerText(), "9999");
    await numberButton.click();
    const numberDialog = page.getByRole("dialog", { name: `编辑数字 ${numberLabel}`, exact: true });
    const numberInput = numberDialog.getByRole("textbox", { name: numberLabel, exact: true });
    assert.equal(await numberInput.inputValue(), "9999");
    await numberInput.press("Escape");
    await numberDialog.waitFor({ state: "detached" });
    assert.ok(await table.locator("tbody tr[data-item-id]").count() < 100);
    await shootWindowBothModes(handle, "desktop-big-table", { shotsDir: path.join(REPO_ROOT, ".qa/WP-15/shots") });
    await assertNoNetworkAndErrors(handle);
    complete = true;
  } finally {
    if (!complete) console.log(`LIFE_ATLAS_TEST_FAILURE_ROOTS ${JSON.stringify({ test: "a ten thousand record table stays fast", dataRoot, bootstrapDir: handle?.bootstrapDir, tempDir: handle?.tempDir })}`);
    if (handle) await closeApp(handle, { keepDirs: !complete });
    else if (complete && fs.existsSync(dataRoot)) removeIsolatedDirectory(dataRoot);
  }
});

test("csv files import on desktop", async () => {
  const dataRoot = createIsolatedDirectory("wp15-csv");
  let handle;
  let bootstrapDir;
  let complete = false;
  try {
    const workspace = fullWorkspace();
    workspace.ui.preferences = { theme: "system", style: "mobai" };
    await seedWorkspaceDatabase(dataRoot, workspace);
    handle = await launchApp({ packaged: true, dataRoot });
    const page = handle.page;
    await page.getByRole("complementary", { name: "主导航" }).waitFor();
    await page.locator(".workspace-switcher").click();
    await page.getByRole("menu", { name: "工作区菜单", exact: true }).getByRole("menuitem", { name: "导入 CSV…", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "导入 CSV", exact: true });
    await dialog.getByLabel("选择 CSV 文件", { exact: true }).setInputFiles({ name: "gbk.csv", mimeType: "text/csv", buffer: gbkBuffer });
    await dialog.getByText("已识别为 GBK", { exact: true }).waitFor();
    assert.equal(await dialog.getByLabel("列类型 金额", { exact: true }).inputValue(), "number");
    await dialog.getByRole("button", { name: "导入 1 条记录", exact: true }).click();
    await dialog.getByRole("status").waitFor();
    assert.equal(await dialog.getByRole("status").innerText(), "已导入 1 条记录");
    await dialog.getByRole("button", { name: "完成", exact: true }).click();
    await waitForDatabasePage(page, "gbk");
    await openPageInSidebar(page, "gbk");
    assert.equal(await page.locator(".db-table tbody .db-title-label").innerText(), "苹果");
    const imported = await page.evaluate(async () => (await window.lifeAtlas.workspace.load()).value.workspace);
    const source = imported.dataSources.find((entry) => entry.title === "gbk");
    assert.ok(source);
    assert.equal(imported.databaseItems.find((item) => item.sourceId === source.id).values[source.properties[1].id], 3);
    await assertNoNetworkAndErrors(handle);
    bootstrapDir = handle.bootstrapDir;
    const previousTemp = handle.tempDir;
    await closeApp(handle, { keepDirs: true });
    handle = null;
    removeIsolatedDirectory(previousTemp);
    handle = await launchApp({ packaged: true, dataRoot, bootstrapDir });
    await handle.page.getByRole("complementary", { name: "主导航" }).waitFor();
    await openPageInSidebar(handle.page, "gbk");
    assert.equal(await handle.page.locator(".db-table tbody .db-title-label").innerText(), "苹果");
    const restarted = await handle.page.evaluate(async () => (await window.lifeAtlas.workspace.load()).value.workspace);
    assert.deepEqual(restarted.dataSources.find((entry) => entry.id === source.id), source);
    assert.deepEqual(restarted.databaseItems.filter((item) => item.sourceId === source.id), imported.databaseItems.filter((item) => item.sourceId === source.id));
    await assertNoNetworkAndErrors(handle);
    complete = true;
  } finally {
    if (!complete) console.log(`LIFE_ATLAS_TEST_FAILURE_ROOTS ${JSON.stringify({ test: "csv files import on desktop", dataRoot, bootstrapDir: handle?.bootstrapDir || bootstrapDir, tempDir: handle?.tempDir })}`);
    if (handle) await closeApp(handle, { keepDirs: !complete });
    else if (complete) for (const directory of [dataRoot, bootstrapDir]) if (directory && fs.existsSync(directory)) removeIsolatedDirectory(directory);
  }
});
