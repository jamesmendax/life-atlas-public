import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdirSync, mkdtempSync } from "node:fs";
import { chromium } from "playwright";
import { createBlankWorkspace } from "../../src/domain/blankWorkspace.js";
import { createDatabaseView, createProperty } from "../../src/domain/database.js";
import { workspaceStorageKey } from "../../src/persistence/workspaceRepository.js";
import { DEVICE_PREFERENCES_KEY } from "../../src/ui/devicePreferences.js";

const now = new Date().toISOString();
const workspace = createBlankWorkspace({ now, idFactory: (prefix) => `${prefix}-navigation` });
workspace.folders.push({ id: "nav-folder", parentId: null, name: "导航测试", sortIndex: 10, createdAt: now, updatedAt: now });
const makePage = (id, title, settings = {}) => ({
  id, title, folderId: "nav-folder", parentPageId: null, content: Array.from({ length: settings.lines ?? 1 }, (_, index) => ({
    id: `${id}-line-${index}`, type: "paragraph", content: `${title} 第 ${index + 1} 段`,
  })), createdAt: now, updatedAt: now, sortIndex: settings.sortIndex ?? 10, ...settings.fields,
});
const recentIds = Array.from({ length: 12 }, (_, index) => `nav-index-${index}`);
workspace.pages.push(
  makePage("nav-a", "验收 A", { lines: 60 }),
  makePage("nav-b", "验收 B", { lines: 60 }),
  makePage("nav-parent", "上级页面"),
  makePage("nav-middle", "同名页面", { fields: { parentPageId: "nav-parent" }, sortIndex: 10 }),
  makePage("nav-other-middle", "同名页面", { fields: { parentPageId: "nav-parent" }, sortIndex: 20 }),
  makePage("nav-deep", "三级页面", { fields: { parentPageId: "nav-middle" } }),
  makePage("nav-archived", "归档页面", { fields: { parentPageId: "nav-parent", archivedAt: now } }),
  makePage("nav-trashed", "回收站页面", { fields: { parentPageId: "nav-parent", trashedAt: now } }),
  makePage("nav-db", "两来源数据库", { fields: { pageType: "database", databaseSourceId: "nav-source-a", databaseSourceIds: ["nav-source-a", "nav-source-b"], databaseViewId: "nav-view-a" } }),
  ...recentIds.map((id, index) => makePage(id, `资料 ${index + 1}`)),
);
for (const [source, label] of [["a", "来源甲"], ["b", "来源乙"]]) {
  workspace.dataSources.push({
    id: `nav-source-${source}`, title: label, ownerPageId: "nav-db",
    properties: [createProperty({ id: "title", type: "title", name: "名称" })], createdAt: now, updatedAt: now,
  });
  workspace.databaseViews.push(createDatabaseView({ id: `nav-view-${source}`, sourceId: `nav-source-${source}`, name: label, type: "table" }));
  for (const index of [1, 2]) {
    const pageId = `nav-record-${source}${index}`;
    workspace.pages.push(makePage(pageId, "同名记录", { fields: { databaseSourceId: `nav-source-${source}` }, sortIndex: index }));
    workspace.databaseItems.push({ id: `item-${pageId}`, pageId, sourceId: `nav-source-${source}`, values: { title: "同名记录" }, createdAt: now, updatedAt: now });
  }
}
workspace.ui = {
  ...workspace.ui, activeSection: "home", selectedPageId: null,
  favoritePageIds: recentIds, recentVisits: recentIds.map((pageId) => ({ pageId, visitedAt: now })),
  preferences: { theme: "light", startPage: "last" },
};

const temp = process.env.LIFE_ATLAS_NAV_TEST_OUTPUT || os.tmpdir();
mkdirSync(temp, { recursive: true });
const output = mkdtempSync(path.join(temp, "workspace-navigation-160-"));
const url = process.env.PARITY_BASE_URL || "http://127.0.0.1:5192";
const profile = path.join(output, "profile");
const launch = () => chromium.launchPersistentContext(profile, {
  channel: "msedge", headless: true, viewport: { width: 1420, height: 950 },
  artifactsDir: path.join(output, "browser-artifacts"),
});
let context;
let page;
const errors = [];
const checks = [];
const check = (label) => { checks.push(label); console.log(`PASS ${label}`); };
const readPrefs = () => page.evaluate((key) => JSON.parse(localStorage.getItem(key)), DEVICE_PREFERENCES_KEY);
const readWorkspace = () => page.evaluate((key) => JSON.parse(localStorage.getItem(key)), workspaceStorageKey);
const title = () => page.getByRole("textbox", { name: "页面标题", exact: true });
const tab = (id) => page.locator(`.workspace-page-tabs [data-page-id="${id}"]`);
const privateGroup = () => page.getByRole("region", { name: "私人", exact: true });
const openLibrary = async () => {
  await page.getByRole("complementary", { name: "主导航" }).getByRole("button", { name: "资料库", exact: true }).click();
  await page.getByRole("heading", { name: "资料库", exact: true }).waitFor();
};
const libraryOpen = async (id) => {
  await openLibrary();
  await privateGroup().locator(`[data-page-id="${id}"]`).click();
  await title().waitFor();
};
const open = async (seed) => {
  context = await launch();
  page = context.pages()[0] ?? await context.newPage();
  page.setDefaultTimeout(12_000);
  page.on("pageerror", (error) => errors.push(error.stack));
  if (seed) await page.addInitScript(({ key, workspace }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(workspace));
  }, { key: workspaceStorageKey, workspace });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.documentElement.dataset.laReady === "1");
};
const contrastChoice = (name) => page.getByRole("radiogroup", { name: "对比度", exact: true }).getByRole("radio", { name, exact: true });
const closeSettings = () => page.getByRole("button", { name: "关闭设置", exact: true }).click();
const getView = () => page.evaluate(() => {
  const root = document.querySelector(".life-editor .bn-editor");
  const editor = root.pmViewDesc.node.type.schema.cached.blockNoteEditor;
  return { selection: editor.prosemirrorState.selection.toJSON(), scroll: root.closest(".workspace-scroll").scrollTop };
});
const selectDraft = async (id, draft, scroll) => {
  await page.locator(`[data-id="${id}-line-0"] .bn-inline-content`).click();
  await page.keyboard.press("End");
  await page.keyboard.insertText(draft);
  await page.keyboard.press("Shift+ArrowLeft");
  await page.keyboard.press("Shift+ArrowLeft");
  await page.waitForFunction(() => getSelection()?.toString().length === 2);
  await page.locator(".workspace-scroll").evaluate((node, top) => node.scrollTo({ top, behavior: "instant" }), scroll);
  return getView();
};
const compareView = async (id, expected) => {
  await page.locator(`.bn-block-outer[data-id="${id}-line-0"]`).waitFor({ state: "attached" });
  await page.waitForFunction((view) => {
    const editor = document.querySelector(".life-editor .bn-editor")?.pmViewDesc?.node.type.schema.cached.blockNoteEditor;
    return JSON.stringify(editor?.prosemirrorState.selection.toJSON()) === JSON.stringify(view.selection)
      && Math.abs(document.querySelector(".workspace-scroll").scrollTop - view.scroll) < 3;
  }, expected);
};
const capture = (name) => page.screenshot({ path: path.join(output, name + ".png") });

try {
  await open(true);
  await page.keyboard.press("Control+Comma");
  let settings = page.getByRole("dialog", { name: "设置", exact: true });
  await settings.waitFor();
  await settings.getByRole("checkbox", { name: "重新打开页面标签" }).check();
  for (const group of ["私人", "收藏", "最近"]) await settings.getByRole("checkbox", { name: group, exact: true }).uncheck();
  await contrastChoice("高对比").click();
  const root = () => page.locator("html");
  assert.equal(await root().getAttribute("data-theme"), "light");
  assert.equal(await root().getAttribute("data-resolved-contrast"), "high");
  await settings.getByRole("radio", { name: "夜间", exact: true }).click();
  assert.equal(await root().getAttribute("data-theme"), "dark");
  assert.equal(await root().getAttribute("data-resolved-contrast"), "high");
  await contrastChoice("标准").click();
  assert.equal(await root().getAttribute("data-theme"), "dark");
  assert.equal(await root().getAttribute("data-resolved-contrast"), "standard");
  await contrastChoice("跟随系统").click();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-contrast", value: "more" }] });
  await page.waitForFunction(() => document.documentElement.dataset.resolvedContrast === "high");
  await contrastChoice("高对比").click();
  await closeSettings();
  await capture("high-dark");
  await page.emulateMedia({ forcedColors: "active" });
  await page.getByRole("button", { name: "打开页面标签", exact: true }).focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  const focused = await page.evaluate(() => ({ match: matchMedia("(forced-colors: active)").matches, style: getComputedStyle(document.activeElement).outlineStyle }));
  assert.deepEqual(focused, { match: true, style: "solid" });
  await capture("forced-colors");
  await page.emulateMedia({ forcedColors: "none" });
  check("Independent contrast and theme choices, system contrast, forced-color focus");

  await openLibrary();
  assert.ok(await privateGroup().getByRole("button").count() > 12);
  for (const group of ["收藏", "最近"]) assert.equal(await page.getByRole("region", { name: group, exact: true }).getByRole("button").count(), 12);
  const sidebar = () => page.getByRole("complementary", { name: "主导航" });
  assert.equal(await sidebar().getByRole("region", { name: "Private" }).count(), 0);
  assert.equal(await sidebar().getByRole("button", { name: "Recents", exact: true }).count(), 0);
  assert.equal(await sidebar().locator("[data-favorite-id]").count(), 0);
  assert.equal(await privateGroup().locator('[data-page-id="nav-archived"]').count(), 0);
  await page.getByRole("combobox", { name: "资料库页面状态" }).selectOption("archived");
  assert.equal(await privateGroup().getByRole("button").count(), 1);
  assert.equal(await privateGroup().locator('[data-page-id="nav-archived"]').count(), 1);
  await page.getByRole("combobox", { name: "资料库页面状态" }).selectOption("active");
  await capture("library");
  check("Complete original entries remain accessible from the library after hiding all sidebar sections");

  await libraryOpen("nav-deep");
  const crumb = page.getByRole("button", { name: "同名页面的同级项", exact: true });
  await crumb.hover();
  const siblings = page.getByRole("menu", { name: "同名页面的同级项", exact: true });
  await siblings.waitFor();
  assert.deepEqual(await siblings.getByRole("menuitem").evaluateAll((rows) => rows.map((row) => row.dataset.navigationId)), ["nav-middle", "nav-other-middle"]);
  await siblings.locator('[data-navigation-id="nav-other-middle"]').click();
  assert.equal(await tab("nav-other-middle").getAttribute("aria-selected"), "true");
  await tab("nav-deep").click();
  await crumb.focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Escape");
  assert.equal(await crumb.evaluate((element) => document.activeElement === element), true);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  assert.equal(await tab("nav-other-middle").getAttribute("aria-selected"), "true");
  await libraryOpen("nav-record-b1");
  await page.getByRole("button", { name: "同名记录的同级项", exact: true }).click();
  const records = page.getByRole("menu", { name: "同名记录的同级项", exact: true });
  assert.deepEqual(await records.getByRole("menuitem").evaluateAll((rows) => rows.map((row) => row.dataset.navigationId)), ["nav-record-b1", "nav-record-b2"]);
  await records.locator('[data-navigation-id="nav-record-b2"]').click();
  assert.equal(await tab("nav-record-b2").getAttribute("aria-selected"), "true");
  check("Mouse and keyboard open the same ID from same-name siblings and records stay scoped to their source");

  await libraryOpen("nav-a");
  const first = await selectDraft("nav-a", "-ALPHA", 610);
  await page.keyboard.press("Control+t");
  const search = page.getByRole("dialog", { name: "全局搜索", exact: true });
  await search.waitFor();
  await search.getByRole("combobox", { name: "搜索文件夹、页面与正文" }).fill("验收 B");
  assert.equal(await search.getByRole("button", { name: "页面", exact: true }).getAttribute("aria-pressed"), "true");
  await search.getByRole("option", { name: /验收 B/ }).click();
  const second = await selectDraft("nav-b", "-BRAVO", 910);
  assert.notDeepEqual(first.scroll, second.scroll);
  await tab("nav-a").click();
  await compareView("nav-a", first);
  await tab("nav-b").click();
  await compareView("nav-b", second);
  await page.keyboard.press("Control+Shift+Tab");
  assert.equal(await tab("nav-a").getAttribute("aria-selected"), "true");
  await page.keyboard.press("Control+Tab");
  assert.equal(await tab("nav-b").getAttribute("aria-selected"), "true");
  await page.getByRole("button", { name: "标签页选项", exact: true }).click();
  await page.getByRole("menuitem", { name: "关闭其他标签页", exact: true }).click();
  assert.equal(await page.locator(".workspace-page-tabs [role=tab]").count(), 1);
  await libraryOpen("nav-a");
  await tab("nav-b").click();
  assert.equal(await page.locator(".workspace-page-tabs [role=tab]").count(), 2);
  await page.waitForFunction(({ key }) => {
    const saved = JSON.parse(localStorage.getItem(key));
    return ["nav-a", "nav-b"].every((id) => /ALPHA|BRAVO/.test(JSON.stringify(saved.pages.find((entry) => entry.id === id)?.content)));
  }, { key: workspaceStorageKey });
  const saved = await readWorkspace();
  assert.equal(saved.ui.pageTabs, undefined);
  assert.equal(saved.ui.preferences.contrast, undefined);
  assert.equal(saved.ui.preferences.reopenPageTabs, undefined);
  const device = await readPrefs();
  const session = device.pageTabs[workspace.workspaceId];
  assert.deepEqual(session, { ids: ["nav-b", "nav-a"], activeId: "nav-b" });
  await page.evaluate(({ key, device, workspaceId }) => {
    device.pageTabs[workspaceId].ids.push("nav-missing", "nav-trashed");
    localStorage.setItem(key, JSON.stringify(device));
  }, { key: DEVICE_PREFERENCES_KEY, device, workspaceId: workspace.workspaceId });
  await context.close();
  context = null;
  check("Both live drafts, separate scroll and selection, keyboard tab switching, and closing other tabs");

  await open(false);
  assert.equal(await tab("nav-b").getAttribute("aria-selected"), "true");
  assert.deepEqual(await page.locator(".workspace-page-tabs [role=tab]").evaluateAll((tabs) => tabs.map((element) => element.dataset.pageId)), ["nav-b", "nav-a"]);
  assert.equal(await root().getAttribute("data-theme"), "dark");
  assert.equal(await root().getAttribute("data-resolved-contrast"), "high");
  assert.equal(await sidebar().getByRole("button", { name: "Recents", exact: true }).count(), 0);
  await page.locator('.bn-block-outer[data-id="nav-b-line-0"] .bn-inline-content').filter({ hasText: "BRAVO" }).waitFor();
  await tab("nav-a").click();
  await page.locator('.bn-block-outer[data-id="nav-a-line-0"] .bn-inline-content').filter({ hasText: "ALPHA" }).waitFor();
  await tab("nav-a").press("Delete");
  assert.equal(await tab("nav-b").getAttribute("aria-selected"), "true");
  await page.keyboard.press("Control+w");
  await page.locator(".home-page").waitFor();
  assert.equal(await page.locator(".workspace-page-tabs [role=tab]").count(), 0);
  assert.deepEqual((await readPrefs()).pageTabs[workspace.workspaceId], { ids: [], activeId: null });
  await context.newPage();
  await Promise.all([page.waitForEvent("close"), page.close({ runBeforeUnload: true })]);
  await context.close();
  context = null;
  await open(false);
  await page.locator(".home-page").waitFor();
  assert.equal(await page.locator(".workspace-page-tabs [role=tab]").count(), 0);
  check("Cold restarts keep both drafts and valid tabs, preserve settings, and respect closing the last tab");
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ checks, output }, null, 2));
} catch (error) {
  console.error(error);
  console.error(JSON.stringify({ errors, checks, output }, null, 2));
  await page?.screenshot({ path: path.join(output, "failure.png"), timeout: 5000 }).catch(() => {});
  process.exitCode = 1;
} finally {
  await context?.close();
}
