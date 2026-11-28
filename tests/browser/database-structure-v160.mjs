import assert from "node:assert/strict";
import { chromium } from "playwright";
import { coreParityWorkspace } from "../fixtures/core-parity-workspace.mjs";
import { upgradeWorkspace } from "../../src/persistence/migrations.js";
import { workspaceStorageKey } from "../../src/persistence/workspaceRepository.js";

const workspace = coreParityWorkspace();
workspace.pages.find((page) => page.id === "database-page").content = [{
  id: "db-structure", type: "databaseView", props: { sourceId: "projects", viewId: "view-table", viewIdsJson: JSON.stringify(["view-table", "view-board", "view-list", "view-gallery"]) },
}];
const date = (start) => ({ start, end: null, includeTime: false, timeZone: null });
for (const [id, day] of Object.entries({ alpha: "02", beta: "04", gamma: "06" })) {
  const item = workspace.databaseItems.find((record) => record.id === id);
  item.values.date = date(`2026-11-${day}`);
}
workspace.databaseViews.find((view) => view.id === "view-table").visiblePropertyIds = ["title", "date"];
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  await context.addInitScript(({ key, seed }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(seed));
  }, { key: workspaceStorageKey, seed: upgradeWorkspace(workspace) });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const settings = page.getByRole("button", { name: "视图设置", exact: true });
  const settingsPanel = page.getByRole("dialog", { name: "视图设置", exact: true });
  const row = (id) => page.locator(`.db-table tr[data-item-id="${id}"]`);
  const snapshot = () => page.evaluate((key) => JSON.parse(localStorage.getItem(key)), workspaceStorageKey);
  const fieldPersisted = (collection, id, field, expected) => page.waitForFunction(({ key, collection, id, field, expected }) => {
    let value = JSON.parse(localStorage.getItem(key))?.[collection]?.find((entry) => entry.id === id);
    for (const name of field) value = value?.[name];
    return JSON.stringify(value) === JSON.stringify(expected);
  }, { key: workspaceStorageKey, collection, id, field, expected });
  const openSettings = async (section) => {
    await settings.click();
    await settingsPanel.getByRole("button", { name: section, exact: true }).click();
  };
  const configureDependencies = async (id, name) => {
    await row(id).getByRole("button", { name: /^记录操作/ }).click();
    await page.getByRole("menuitem", { name: /^前置依赖/ }).click();
    const panel = page.getByRole("dialog", { name: "前置依赖" });
    await panel.getByRole("checkbox", { name, exact: true }).check();
    return panel;
  };
  await page.goto(process.env.PARITY_BASE_URL || "http://127.0.0.1:5194");
  await row("beta").getByRole("button", { name: "记录操作 Beta 项目" }).click();
  await page.getByRole("menuitem", { name: "调整父项…" }).click();
  const parent = page.getByRole("dialog", { name: "调整父项" });
  await parent.getByRole("combobox", { name: "父项", exact: true }).selectOption("alpha");
  await parent.getByRole("button", { name: "保存", exact: true }).click();
  await fieldPersisted("databaseItems", "beta", ["parentItemId"], "alpha");
  assert.equal((await snapshot()).pages.find((entry) => entry.id === "beta-page").parentDatabaseItemId, "alpha");

  await row("alpha").getByRole("button", { name: "折叠 Alpha 项目 的子项" }).click();
  await row("beta").waitFor({ state: "detached" });
  await row("alpha").getByRole("button", { name: "展开 Alpha 项目 的子项" }).click();
  await row("beta").waitFor();
  await openSettings("子项");
  await settingsPanel.getByLabel("显示记录").selectOption("children");
  await row("alpha").waitFor({ state: "detached" });
  await row("beta").waitFor();
  await settingsPanel.getByLabel("显示记录").selectOption("parents");
  await row("beta").waitFor({ state: "detached" });
  await settingsPanel.getByLabel("显示记录").selectOption("all");
  await settingsPanel.getByLabel("子项布局").selectOption("flat");
  await settingsPanel.getByRole("button", { name: "关闭视图设置" }).click();
  await row("beta").waitFor();
  assert.equal(await row("alpha").getByRole("button", { name: /的子项/ }).count(), 0);

  await openSettings("依赖排期");
  await settingsPanel.getByLabel("排期日期").selectOption("date");
  await settingsPanel.getByLabel("排期方式").selectOption("overlap");
  await settingsPanel.getByRole("checkbox", { name: "自动排期跳过周末" }).check();
  await settingsPanel.getByRole("button", { name: "关闭视图设置" }).click();
  await fieldPersisted("dataSources", "projects", ["dependencyConfig"], { datePropertyId: "date", mode: "overlap", skipWeekends: true });
  const first = await configureDependencies("beta", "Alpha 项目");
  await first.getByRole("button", { name: "保存", exact: true }).click();
  await fieldPersisted("databaseItems", "beta", ["dependencyIds"], ["alpha"]);
  const second = await configureDependencies("gamma", "Beta 项目");
  await second.getByRole("button", { name: "保存", exact: true }).click();
  await fieldPersisted("databaseItems", "gamma", ["dependencyIds"], ["beta"]);
  const cycle = await configureDependencies("alpha", "Gamma 项目");
  await cycle.getByRole("button", { name: "保存", exact: true }).click();
  const inlineError = cycle.getByRole("alert");
  const workspaceError = page.getByText(/循环依赖/, { exact: false });
  await inlineError.or(workspaceError).first().waitFor();
  if (await cycle.isVisible()) await cycle.getByRole("button", { name: "取消" }).click();
  assert.deepEqual((await snapshot()).databaseItems.find((item) => item.id === "alpha").dependencyIds, []);

  await row("alpha").locator("td[data-property-id=date] summary").click();
  const input = page.getByLabel("日期 · Alpha 项目 开始", { exact: true });
  await input.fill("2026-11-08");
  await input.press("Escape");
  await fieldPersisted("databaseItems", "beta", ["values", "date", "start"], "2026-11-09");
  await fieldPersisted("databaseItems", "gamma", ["values", "date", "start"], "2026-11-10");
  await page.reload();
  await row("beta").waitFor();
  assert.equal(await row("alpha").getByRole("button", { name: /的子项/ }).count(), 0);
  await row("alpha").hover();
  await row("alpha").getByRole("button", { name: "+ 子项", exact: true }).click();
  await page.waitForFunction((key) => JSON.parse(localStorage.getItem(key))?.databaseItems.some((item) => item.id !== "beta" && item.parentItemId === "alpha" && item.values.title === "子项"), workspaceStorageKey);

  const databaseTabs = page.getByRole("tablist", { name: "数据库视图" });
  await databaseTabs.getByRole("tab", { selected: true }).press("End");
  await databaseTabs.getByRole("tab", { name: "gallery view", selected: true }).waitFor();
  await openSettings("子项");
  await settingsPanel.getByLabel("子项布局").selectOption("nested");
  await settingsPanel.getByRole("button", { name: "关闭视图设置" }).click();
  const card = page.locator('.db-gallery-card[data-item-id="alpha"]');
  await card.locator(".db-card-subitems summary").click();
  await card.getByRole("button", { name: "Beta 项目", exact: true }).waitFor();
  assert.equal(await page.locator('.db-gallery-card[data-item-id="beta"]').count(), 0);
  await openSettings("子项");
  await settingsPanel.getByLabel("子项布局").selectOption("flat");
  await settingsPanel.getByRole("button", { name: "关闭视图设置" }).click();
  await page.locator('.db-gallery-card[data-item-id="beta"]').waitFor();

  await databaseTabs.getByRole("tab", { selected: true }).press("Home");
  await databaseTabs.getByRole("tab", { name: "table view", selected: true }).press("ArrowRight");
  await databaseTabs.getByRole("tab", { name: "board view", selected: true }).waitFor();
  await openSettings("子项");
  await settingsPanel.getByLabel("子项布局").selectOption("nested");
  await settingsPanel.getByRole("button", { name: "关闭视图设置" }).click();
  const boardParent = page.locator('.db-board-card[data-item-id="alpha"]');
  await boardParent.locator(".db-card-subitems summary").click();
  await boardParent.getByRole("button", { name: "Beta 项目", exact: true }).waitFor();
  assert.equal(await page.locator('.db-board-card[data-item-id="beta"]').count(), 0);
  await openSettings("子项");
  await settingsPanel.getByLabel("显示记录").selectOption("parents");
  await settingsPanel.getByRole("button", { name: "关闭视图设置" }).click();
  await boardParent.locator(".db-card-subitems").waitFor({ state: "detached" });
  assert.deepEqual(errors, []);
  console.log("PASS database-structure-v160: parent editor, subitem creation, collapse, filters, gallery/board nesting across groups, dependency settings, cycle rejection, weekend cascade and reload");
} finally {
  await browser.close();
}
