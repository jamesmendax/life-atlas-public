import { coreParityWorkspace } from "../fixtures/core-parity-workspace.mjs";
import { chooseSavedView, openViewSettingsSection, setViewSettings, viewSettingsPanel } from "./database-navigation.mjs";
import { browserScenario } from "./harness.mjs";
import { createProperty } from "../../src/domain/database.js";

const workspace = coreParityWorkspace();
const source = workspace.dataSources[0];
const table = workspace.databaseViews.find(view => view.id === "view-table");
const dashboard = workspace.databaseViews.find(view => view.id === "view-dashboard");
workspace.pages.find(page => page.id === source.ownerPageId).content = [{
  id:"database-occurrence", type:"databaseView",
  props:{ sourceId:source.id, viewId:table.id, viewIdsJson:JSON.stringify([table.id, dashboard.id]) },
}];
table.visiblePropertyIds = ["title", "amount", "formula", "rollup"];
table.filter = { kind:"group", op:"and", children:[{ propertyId:"formula", operator:"equals", value:"78" }] };
dashboard.config.dashboard = { widgets:[{ id:"results", type:"list" }], globalFilters:[] };
source.properties.find(property => property.id === "formula").config.expression =
  'if({{title}} == "Alpha 项目", empty, if({{title}} == "Beta 项目", 1 / 0, if({{title}} == "Delta 项目", "78", {{amount}})))';
source.properties.push(createProperty({ id:"empty-formula", name:"空公式", type:"formula", config:{ expression:"empty" } }));
const gamma = workspace.databaseItems.find(item => item.id === "gamma");
gamma.values.amount = 78;
workspace.databaseItems.push({ ...gamma, id:"delta", pageId:"delta-page", values:{ ...gamma.values, relation:[], title:"Delta 项目" } });
workspace.pages.push({ ...workspace.pages.find(page => page.id === gamma.pageId), id:"delta-page", title:"Delta 项目", content:[] });

await browserScenario("database-computed-filters", async ({ page, check, persisted, assert }) => {
  const db = page.locator('section.database-view[data-source-id="projects"]');
  const panel = viewSettingsPanel(db);
  const view = (state, id) => state.databaseViews.find(candidate => candidate.id === id);
  const label = (root, name) => root.getByLabel(name, { exact:true });
  const button = (root, name) => root.getByRole("button", { name, exact:true });
  const rows = () => db.locator("tbody tr[data-item-id]").evaluateAll(items => items.map(item => item.dataset.itemId));
  const dashboardRows = () => db.locator('[data-widget-id="results"] .db-list-row').allTextContents();

  await check("view filter offers numeric Formula operators with blank and error rows before the first number", async () => {
    await db.waitFor();
    await chooseSavedView(db, table.id);
    await openViewSettingsSection(db, "筛选");
    const operator = label(panel, "筛选操作 0");
    const value = label(panel, "筛选值 0");
    assert.equal(await operator.inputValue(), "text_equals");
    assert.equal(await value.getAttribute("type"), "text");
    assert.deepEqual(await rows(), ["delta"]);
    await button(panel, "清除筛选").click();
    await button(panel, "+ 条件").click();
    await label(panel, "筛选属性 0").selectOption("empty-formula");
    assert.equal(await value.getAttribute("type"), "number");
    await label(panel, "筛选属性 0").selectOption("formula");
    assert.equal(await value.getAttribute("type"), "number");
    await operator.selectOption("text_equals");
    assert.equal(await value.getAttribute("type"), "text");
    await operator.selectOption("greater_than");
    assert.equal(await value.getAttribute("type"), "number");
    await value.fill("75");
    await persisted(state => view(state, table.id).filter?.children?.[0]?.value === 75);
    assert.deepEqual(await rows(), ["gamma"]);
    await button(panel, "清除筛选").click();
    await setViewSettings(db, false);
  });

  await check("table header opens a numeric Rollup filter and persists a decimal threshold", async () => {
    await button(db, "编辑 供应方评分 属性").click();
    const menu = page.getByRole("menu", { name:"供应方评分 属性菜单", exact:true });
    await menu.getByRole("menuitem", { name:"筛选…", exact:true }).click();
    assert.equal(await label(panel, "筛选属性 0").inputValue(), "rollup");
    const value = label(panel, "筛选值 0");
    assert.equal(await value.getAttribute("type"), "number");
    await label(panel, "筛选操作 0").selectOption("greater_than_or_equal");
    await value.fill("4.5");
    const state = await persisted(state => view(state, table.id).filter?.children?.[0]?.value === 4.5);
    assert.equal(view(state, table.id).filter.children[0].propertyId, "rollup");
    assert.deepEqual(await rows(), ["alpha", "beta", "gamma"]);
    await setViewSettings(db, false);
  });

  await check("dashboard Formulas honor a numeric threshold when saving the view and reopening", async () => {
    await chooseSavedView(db, dashboard.id);
    await db.getByRole("button", { name:/^统一筛选/ }).click();
    const filters = db.getByRole("region", { name:"仪表盘筛选" });
    await button(filters, "＋ 全局筛选").click();
    await label(filters, "仪表盘筛选 1 属性").selectOption("formula");
    const value = label(filters, "仪表盘筛选 1 值");
    assert.equal(await value.getAttribute("type"), "number");
    await label(filters, "仪表盘筛选 1 操作").selectOption("greater_than");
    await value.fill("75");
    assert.deepEqual(await dashboardRows(), ["Gamma 项目"]);
    await button(filters, "保存为视图默认").click();
    await persisted(state => view(state, dashboard.id).config.dashboard.globalFilters[0]?.value === 75);
    await page.reload({ waitUntil:"domcontentloaded" });
    await db.waitFor();
    await chooseSavedView(db, dashboard.id);
    await db.locator('[data-widget-id="results"] .db-list-row').first().waitFor();
    assert.deepEqual(await dashboardRows(), ["Gamma 项目"]);
    await db.getByRole("button", { name:/^统一筛选/ }).click();
    assert.equal(await value.getAttribute("type"), "number");
    assert.equal(await value.inputValue(), "75");
  });
}, { workspace });
