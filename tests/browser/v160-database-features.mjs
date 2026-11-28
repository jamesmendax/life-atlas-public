import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";
import { coreParityWorkspace } from "../fixtures/core-parity-workspace.mjs";
import { sourceFingerprint } from "./harness.mjs";
import { upgradeWorkspace } from "../../src/persistence/migrations.js";
import { workspaceStorageKey } from "../../src/persistence/workspaceRepository.js";

// Run from the repository root. The scenario uses a private browser context,
// a loopback server and synthetic data for each persisted workspace state.
const root = fileURLToPath(new URL("../../", import.meta.url));
const here = process.env.LIFE_ATLAS_DATABASE_BROWSER_ARTIFACTS
  ? path.resolve(process.env.LIFE_ATLAS_DATABASE_BROWSER_ARTIFACTS)
  : await mkdtemp(path.join(tmpdir(), "lifeatlas-database-browser-"));
await mkdir(here, { recursive: true });
const fingerprint = sourceFingerprint();
const url = "http://127.0.0.1:5193";
const workspace = upgradeWorkspace(coreParityWorkspace());
const primary = workspace.dataSources.find(s => s.id === "projects");
const linked = workspace.dataSources.find(s => s.id === "partners");
linked.title = "Partner ledger";
linked.properties.push({ id: "amount", name: "金额", type: "text" });
workspace.databaseViews.push({ id: "partner-table", sourceId: "partners", type: "table", name: "Partner table", config: {} });
const extra = Array.from({ length: 32 }, (_, i) => ({ id: "long-" + i, name: "A saved view " + i, sourceId: "projects", type: "table", config: {} }));
workspace.databaseViews.push(...extra);
primary.recordLayout = { mode: "tabs", pinnedPropertyIds: ["status"], sections: [{ id: "section-budget", name: "Budget", propertyIds: ["amount"] }], views: [] };
const editor = workspace.pages.find(page => page.id === "editor-page");
editor.content = [{ id: "test-occurrence", type: "databaseView", props: { sourceId: "projects", sourceIdsJson: '["projects"]',
  viewId: "view-table", viewIdsJson: JSON.stringify(["view-table", "view-chart", ...extra.map(view => view.id)]) } }];
workspace.ui.selectedPageId = editor.id;

const dependencies = await realpath(path.join(root, "node_modules"));
const vite = await createServer({ root, configFile: path.join(root, "vite.config.mjs"), cacheDir: path.join(here, "vite-cache"), logLevel: "warn",
  server: { host: "127.0.0.1", port: 5193, strictPort: true, open: false, fs: { allow: [root, dependencies] } } });
let browser;
const passed = [];
try {
  await vite.listen();
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const outside = [], errors = [];
  let context, page, db;
  const openScenario = async seed => {
    await context?.close();
    context = await browser.newContext({ viewport: { width: 1060, height: 960 }, acceptDownloads: true, serviceWorkers: "block" });
    await context.route("**/*", route => {
      const href = new URL(route.request().url());
      if (["http:", "https:"].includes(href.protocol) && href.origin !== url) { outside.push(href.href); return route.abort(); }
      return route.continue();
    });
    await context.addInitScript(({ seed, key }) => {
      if (localStorage.getItem("feature160.seeded")) return;
      localStorage.setItem(key, JSON.stringify(seed));
      localStorage.setItem("feature160.seeded", "1");
      localStorage.setItem("life-atlas.parity.seeded", "1");
    }, { seed, key: workspaceStorageKey });
    page = await context.newPage();
    page.setDefaultTimeout(7000);
    page.on("pageerror", error => errors.push(error.message));
    page.on("response", response => { if (response.status() >= 400) errors.push(response.status() + " " + response.url()); });
    db = page.locator('.life-editor[data-page-id="editor-page"] .database-view[data-view-id]').first();
    await page.goto(url, { waitUntil: "domcontentloaded" });
  };
  const state = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)), workspaceStorageKey);
  await openScenario(workspace);

  for (const mode of ["icon-text", "text", "icon"]) {
    await page.evaluate(async mode => (await import("/src/ui/devicePreferences.js")).updateDevicePreferences({ databaseViewTabDisplay: mode }), mode);
    await db.locator('[role="tablist"][data-tab-display="' + mode + '"]').waitFor();
    const active = db.locator('[role="tab"][aria-selected="true"]');
    assert.equal(await active.locator(".db-v10-view-label").count(), mode === "icon" ? 0 : 1);
    assert.equal(await active.locator("svg").count(), mode === "text" ? 0 : 1);
    const more = db.locator(".db-v10-view-more").filter({ hasText: "更多" }).first();
    await more.click();
    const radio = page.getByRole("menuitemradio", { name: "A saved view 31", exact: true });
    assert.equal(await radio.locator(".db-v10-view-label").count(), mode === "icon" ? 0 : 1);
    assert.equal(await radio.locator("svg").count(), mode === "text" ? 0 : 1);
    await page.keyboard.press("Escape");
  }
  await page.reload({ waitUntil: "domcontentloaded" });
  await db.locator('[role="tablist"][data-tab-display="icon"]').waitFor();
  const selectView = async (id, label) => {
    const tab = db.locator('[role="tab"][data-view-id="' + id + '"]');
    if (await tab.isVisible()) await tab.click();
    else {
      await db.locator("button.db-v10-view-more").click();
      await page.getByRole("menuitemradio", { name: label, exact: true }).click();
    }
    await page.locator('.life-editor[data-page-id="editor-page"] .database-view[data-view-id="' + id + '"]').waitFor();
  };
  const active = db.locator('[role="tab"][aria-selected="true"]');
  await active.focus();
  await page.keyboard.press("End");
  await db.locator('[role="tab"][data-view-id="long-31"][aria-selected="true"]').waitFor();
  assert.equal(await page.evaluate(() => document.activeElement.dataset.viewId), "long-31");
  assert.deepEqual((await state()).databaseViews, workspace.databaseViews);
  passed.push("D03 three displays, overflow and keyboard, device value survives reload without changing saved views");

  await selectView("view-table", "表格");
  await db.getByRole("button", { name: "数据源 项目数据库", exact: true }).click();
  await page.getByLabel("链接现有数据源", { exact: true }).selectOption("partners");
  await page.getByLabel("链接视图", { exact: true }).selectOption("partner-table");
  await db.locator('[role="tab"][data-view-id="partner-table"][aria-selected="true"]').waitFor();
  assert.equal(await db.getAttribute("data-source-id"), "partners");
  await db.getByRole("button", { name: "新建记录", exact: true }).click();
  await page.getByRole("dialog", { name: "记录预览", exact: true }).waitFor();
  await page.getByLabel("记录标题", { exact: true }).fill("New partner record");
  await page.getByRole("button", { name: "关闭预览", exact: true }).click();
  await selectView("view-table", "表格");
  await db.getByRole("button", { name: "新建记录", exact: true }).click();
  await page.getByRole("dialog", { name: "记录预览", exact: true }).waitFor();
  await page.getByLabel("记录标题", { exact: true }).fill("New project record");
  await page.getByRole("button", { name: "关闭预览", exact: true }).click();
  await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).databaseItems.filter(item => String(Object.values(item.values)[0]).startsWith("New ")).length === 2, workspaceStorageKey);
  let saved = await state();
  const block = () => saved.pages.find(entry => entry.id === "editor-page").content[0];
  assert.deepEqual(JSON.parse(block().props.sourceIdsJson), ["projects", "partners"]);
  assert.equal(saved.databaseItems.find(item => Object.values(item.values).includes("New partner record")).sourceId, "partners");
  assert.equal(saved.databaseItems.find(item => Object.values(item.values).includes("New project record")).sourceId, "projects");
  assert.deepEqual(saved.dataSources.map(source => source.properties.find(prop => prop.id === "amount")?.type), ["number", "text"]);
  await page.reload({ waitUntil: "domcontentloaded" });
  await selectView("partner-table", "Partner table");
  await db.getByRole("button", { name: "数据源 Partner ledger", exact: true }).click();
  await page.getByRole("button", { name: "移除数据源引用 Partner ledger", exact: true }).click();
  await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).pages.find(entry => entry.id === "editor-page").content[0].props.sourceIdsJson === '["projects"]', workspaceStorageKey);
  saved = await state();
  assert.ok(saved.dataSources.some(source => source.id === "partners"));
  assert.ok(saved.databaseViews.some(view => view.id === "partner-table"));
  assert.ok(saved.databaseItems.some(item => Object.values(item.values).includes("New partner record")));
  passed.push("D13 actual inline UI links two source schemas, routes both writes, restores on reload and removes only the reference");

  const openProject = async name => {
    await db.getByRole("button", { name: "编辑标题 " + name, exact: true }).hover();
    await db.getByRole("button", { name: "打开 " + name, exact: true }).click();
    return page.getByRole("dialog", { name: "记录预览", exact: true });
  };
  await selectView("view-table", "表格");
  for (const name of ["Alpha 项目", "Beta 项目"]) {
    const record = await openProject(name);
    await record.getByRole("tab", { name: "Budget" }).click();
    assert.equal(await record.getByRole("tabpanel").locator('[data-property-id="amount"]').count(), 1);
    assert.equal(await record.locator('[aria-label="固定属性"] [data-property-id="status"]').count(), 1);
    await record.getByRole("button", { name: "关闭预览", exact: true }).click();
  }
  passed.push("D07 two actual record previews share pinned fields and the named section");

  await selectView("view-chart", "图表");
  await db.getByRole("button", { name: "视图设置", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "视图设置", exact: true });
  await settings.getByRole("button", { name: /^布局/ }).click();
  await settings.getByLabel("图表类型", { exact: true }).selectOption("column");
  for (const [value, axis] of [["none", ""], ["x","x"], ["y","y"], ["both","xy"]]) {
    await settings.getByLabel("图表轴名称", { exact: true }).selectOption(value);
    const current = (await db.locator("[data-chart-axis]").evaluateAll(nodes => nodes.map(node => node.dataset.chartAxis))).sort().join("");
    assert.equal(current, axis);
  }
  await settings.getByLabel("图表类型", { exact: true }).selectOption("donut");
  for (const value of ["none", "name", "value", "both"]) {
    await settings.getByLabel("图表扇区标签", { exact: true }).selectOption(value);
    const labels = await db.locator("[data-chart-sector-label] text").allTextContents();
    if (value === "none") assert.equal(labels.length, 0);
    else if (value === "value") assert.ok(labels.every(text => /^[\d,.-]+$/.test(text)) && labels.length);
    else if (value === "name") assert.ok(labels.every(text => !text.includes(" · ")) && labels.length);
    else assert.ok(labels.every(text => / · /.test(text)) && labels.length);
  }
  await page.keyboard.press("Escape");
  const screen = await db.locator("[data-chart-sector-label] text").allTextContents();
  await db.getByRole("button", { name: "保存图表…", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "保存图表", exact: true });
  for (const ext of ["SVG", "PNG"]) {
    const result = page.waitForEvent("download");
    await dialog.getByRole("button", { name: "下载 " + ext, exact: true }).click();
    const download = await result;
    const file = path.join(here, "chart-with-labels." + ext.toLowerCase());
    await download.saveAs(file);
    const bytes = await readFile(file);
    if (ext === "SVG") {
      const exportLabels = await page.evaluate(svg => [...new DOMParser().parseFromString(svg, "image/svg+xml").querySelectorAll("[data-chart-sector-label] text")].map(node => node.textContent), bytes.toString("utf8"));
      assert.deepEqual(exportLabels, screen);
    } else {
      assert.deepEqual([...bytes.subarray(0, 8)], [137,80,78,71,13,10,26,10]);
      assert.ok(bytes.length > 4000);
    }
  }
  await dialog.getByRole("button", { name: "关闭对话框", exact: true }).click();
  await page.reload({ waitUntil: "domcontentloaded" });
  await db.locator("[data-chart-sector-label] text").first().waitFor();
  assert.deepEqual(await db.locator("[data-chart-sector-label] text").allTextContents(), screen);
  passed.push("D08 four axis modes and four donut modes, actual SVG and PNG downloads, display matches exported labels and persists");

  const chart = db.locator(".db-chart-surface");
  await chart.evaluate(surface => { surface.style.inlineSize = "245px"; });
  const fillColors = [];
  for (const colorScheme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme });
    await page.waitForFunction(mode => document.documentElement.dataset.theme === mode, colorScheme);
    const labels = await chart.locator("[data-chart-sector-label] text").evaluateAll(nodes => nodes.map(node => {
      const bounds = node.getBBox();
      const svg = node.ownerSVGElement;
      const svgBox = svg.getBoundingClientRect();
      return { inside: bounds.x >= 0 && bounds.x + bounds.width <= svg.viewBox.baseVal.width,
        pixels: Number.parseFloat(getComputedStyle(node).fontSize) * svgBox.width / svg.viewBox.baseVal.width,
        svgWidth: svgBox.width, layoutWidth: svg.viewBox.baseVal.width, label: node.textContent,
        fill: getComputedStyle(node).fill };
    }));
    assert.ok(labels.length && labels.every(label => label.inside && label.pixels >= 8), JSON.stringify(labels));
    assert.ok(await chart.evaluate(surface => surface.scrollWidth <= surface.clientWidth));
    fillColors.push(labels[0].fill);
    await chart.screenshot({ path: path.join(here, `chart-narrow-${colorScheme}.png`) });
  }
  assert.notEqual(fillColors[0], fillColors[1]);
  passed.push("D08 sector labels fit at 245px and paint in light and dark colors");

  const keep = await state();
  const baselineBlock = keep.pages.find(entry => entry.id === "editor-page").content[0];
  const setOccurrenceCase = async (spec, ownerState = null, prepare = () => {}) => {
    const next = structuredClone(keep);
    const target = next.pages.find(entry => entry.id === "editor-page").content[0];
    target.props = { ...baselineBlock.props, ...spec };
    const source = next.dataSources.find(entry => entry.id === "partners");
    if (ownerState) {
      source.ownerPageId = "partner-owner";
      const owner = next.pages.find(entry => entry.id === "database-page");
      next.pages.push({ ...owner, id: "partner-owner", title: source.title, pageType: "page", databaseSourceId: null, databaseViewId: null, settings: { ...owner.settings, locked: ownerState === "locked" },
        archivedAt: ownerState === "archived" ? "2026-11-26T00:00:00.000Z" : null, trashedAt: ownerState === "trashed" ? "2026-11-26T00:00:00.000Z" : null });
    }
    next.ui.selectedPageId = "editor-page";
    prepare(next);
    await openScenario(next);
  };
  const dual = { sourceIdsJson: '["projects","partners"]', viewId: "partner-table", viewIdsJson: '["view-table","partner-table"]' };
  for (const ownerState of ["locked", "archived", "trashed"]) {
    await setOccurrenceCase(dual, ownerState);
    const partner = page.locator('.life-editor[data-page-id="editor-page"] .database-view[data-view-id="partner-table"]');
    await partner.waitFor();
    assert.equal(await partner.getByRole("button", { name: "新建记录", exact: true }).count(), 0);
    if (ownerState === "archived") await partner.getByText("来源已归档，此视图为只读。", { exact: true }).waitFor();
    if (ownerState === "trashed") {
      await partner.getByText("数据源位于回收站中", { exact: true }).waitFor();
      assert.equal(await partner.getByRole("table").count(), 0);
    }
    await selectView("view-table", "表格");
    assert.equal(await db.getByRole("button", { name: "新建记录", exact: true }).count(), 1);
  }
  for (const spec of [
    { ...dual, sourceIdsJson: '["projects"]' },
    { ...dual, sourceIdsJson: '["projects","missing-source"]' },
    { ...dual, viewId: "deleted-view", viewIdsJson: '["view-table","deleted-view"]' },
  ]) {
    await setOccurrenceCase(spec);
    await page.locator('.life-editor[data-page-id="editor-page"] .database-view[role="alert"]').getByText("此处的数据库视图不可用", { exact: true }).waitFor();
    assert.equal(await db.count(), 0);
  }
  await setOccurrenceCase({ sourceIdsJson: "", viewId: "view-table", viewIdsJson: '["view-table"]' });
  await db.locator('[role="tab"][data-view-id="view-table"][aria-selected="true"]').waitFor();
  await db.getByRole("button", { name: "数据源 项目数据库", exact: true }).click();
  await page.getByRole("button", { name: "新建数据源", exact: true }).click();
  await page.waitForFunction(key => {
    const loaded = JSON.parse(localStorage.getItem(key));
    const source = loaded.dataSources.find(entry => entry.title === "新数据库");
    const props = loaded.pages.find(entry => entry.id === "editor-page").content[0].props;
    return source && JSON.parse(props.sourceIdsJson || "[]").includes(source.id);
  }, workspaceStorageKey);
  const newSource = (await state()).dataSources.find(entry => entry.title === "新数据库");
  assert.equal(newSource.ownerPageId, "editor-page");
  await page.locator(`.life-editor[data-page-id="editor-page"] .database-view[data-source-id="${newSource.id}"]`).waitFor();
  passed.push("D13 legacy reopen, new source, active owner lock/archive/trash, return to another source and diagnostic-only malformed data");

  await setOccurrenceCase({ sourceIdsJson: "", viewId: "view-dashboard", viewIdsJson: '["view-dashboard"]' }, null, next => {
    const dashboard = next.databaseViews.find(entry => entry.id === "view-dashboard");
    dashboard.config = { dashboard: { widgets: [{ id: "partner-panel", type: "view", sourceId: "partners", viewId: "partner-table" }] } };
  });
  const dashboard = page.locator('.database-view[data-view-id="view-dashboard"]');
  const nested = dashboard.locator('[data-widget-id="partner-panel"] .database-view[data-source-id="partners"][data-view-id="partner-table"]');
  await nested.getByText("供应方一", { exact: true }).waitFor();
  assert.equal(await nested.getByText("Alpha 项目", { exact: true }).count(), 0);
  await nested.getByRole("button", { name: "新建记录", exact: true }).click();
  const widgetRecord = page.getByRole("dialog", { name: "记录预览", exact: true });
  await widgetRecord.getByLabel("记录标题", { exact: true }).fill("Dashboard partner record");
  await widgetRecord.getByRole("button", { name: "关闭预览", exact: true }).click();
  await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).databaseItems.some(item =>
    item.sourceId === "partners" && Object.values(item.values).includes("Dashboard partner record")), workspaceStorageKey);
  passed.push("D13 existing cross-source dashboard projects and creates records in its child source");

  await setOccurrenceCase({ sourceIdsJson: "", viewId: "view-table", viewIdsJson: '["view-table"]' }, null, next => {
    const table = next.databaseViews.find(entry => entry.id === "view-table");
    table.config = { ...table.config, openRecordsIn: "side" };
  });
  await db.getByRole("button", { name: "编辑标题 Alpha 项目", exact: true }).hover();
  await db.getByRole("button", { name: "打开 Alpha 项目", exact: true }).click();
  const side = page.getByRole("region", { name: "记录侧边预览", exact: true });
  await side.getByRole("tab", { name: "Budget" }).click();
  assert.equal(await side.getByRole("tabpanel").locator('[data-property-id="amount"]').count(), 1);
  await side.getByRole("button", { name: "打开完整页面", exact: true }).click();
  const full = page.locator(".page-document .db-record-properties");
  await full.getByRole("tab", { name: "Budget" }).click();
  assert.equal(await full.getByRole("tabpanel").locator('[data-property-id="amount"]').count(), 1);
  assert.equal(await full.locator('[aria-label="固定属性"] [data-property-id="status"]').count(), 1);
  await page.locator('.life-editor[data-page-id="alpha-page"]').getByText("Alpha 项目的文档正文和交付说明。", { exact: true }).waitFor();
  passed.push("D07 the side preview and full page show the same layout and preserve the body");

  assert.deepEqual(outside, []);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ sourceFingerprint: fingerprint, browser: browser.version(), artifacts: here, passed, outside, errors }, null, 2));
} catch(error) {
  console.log(JSON.stringify({ sourceFingerprint: fingerprint, artifacts: here, passed }, null, 2));
  throw error;
} finally {
  try { await browser?.close(); } finally { await vite.close(); }
}
