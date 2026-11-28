import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { coverGallery } from "../../src/data/coverGallery.js";
import { createPageVersion } from "../../src/domain/pageHistory.js";
import { coreParityWorkspace } from "../fixtures/core-parity-workspace.mjs";

export const historyScopeTime = "2026-11-26T12:00:00.000Z";
const ids = { inline: "editor-page", whole: "database-page", row: "alpha-page" };
const paragraph = (id, content) => ({ id, type: "paragraph", content });
const database = (id, viewId) => ({ id, type: "databaseView", props: { sourceId: "projects", viewId } });

export function historyScopeFixture() {
  const workspace = coreParityWorkspace();
  const inline = workspace.pages.find(page => page.id === ids.inline);
  const whole = workspace.pages.find(page => page.id === ids.whole);
  const row = workspace.pages.find(page => page.id === ids.row);
  const cover = { kind: "gallery", value: coverGallery[0].id, position: 72 };
  inline.content = [paragraph("inline-current", "现在的内嵌页正文"), database("inline-db", "view-table")];
  whole.content = [paragraph("whole-current", "现在的整页库正文")];
  workspace.syncedSources[0].blocks = [paragraph("live-sync", "这段同步正文来自现时来源"), database("synced-db", "view-board")];
  const make = (page, patch, key, hour) => createPageVersion({ ...page, ...patch }, {
    id: key, reason: "before-edit", now: `2026-11-25T${hour}:00:00.000Z`,
  });
  workspace.pageVersions = [
    make(inline, { title: "历史内嵌页标题", cover, content: [
      paragraph("inline-before", "内嵌页捕获的旧正文"), database("inline-db", "view-table"),
      { id: "linked-sync", type: "syncedBlock", props: { sourceId: "shared-source" } },
    ] }, "inline-version", "13"),
    make(whole, { title: "历史整页库含区块", cover, content: [
      paragraph("whole-embedded", "整页库捕获的旧正文"), database("whole-db", "view-table"),
    ] }, "whole-occurrence-version", "13"),
    make(whole, { title: "历史整页库声明", databaseViewId: "view-list",
      content: [paragraph("whole-detached", "旧的整页库声明附带正文")] }, "whole-declaration-version", "12"),
    make(row, { title: "历史记录名", content: [paragraph("row-old", "旧的记录正文")] }, "row-version", "13"),
  ];
  workspace.ui = { ...workspace.ui, selectedPageId: inline.id, activeSection: "private",
    preferences: { style: "mobai", theme: "light", startPage: "last" } };
  return workspace;
}

export async function verifyHistoryScope({ page, saved, persisted, check }) {
  const open = async title => {
    await page.keyboard.press("Control+k");
    const search = page.getByRole("dialog", { name: "全局搜索", exact: true });
    await search.getByRole("combobox", { name: "搜索文件夹、页面与正文" }).fill(title);
    await search.locator(".search-result-row").filter({ has: page.getByText(title, { exact: true }) }).first().click();
    await search.waitFor({ state: "hidden" });
    await page.locator(".page-title-input").waitFor();
    assert.equal(await page.getByLabel("页面标题", { exact: true }).inputValue(), title);
  };
  const history = async () => {
    await page.getByRole("button", { name: "页面操作", exact: true }).click();
    await page.getByRole("menu", { name: "页面操作", exact: true }).getByRole("menuitem", { name: "页面历史", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "页面历史", exact: true });
    await dialog.waitFor();
    return dialog;
  };
  const confirmRestore = async dialog => {
    await dialog.getByRole("button", { name: "恢复此版本", exact: true }).click();
    const confirm = page.getByRole("alertdialog", { name: "恢复页面版本", exact: true });
    await confirm.waitFor();
    return confirm;
  };
  const approve = async (dialog, confirm) => {
    await confirm.getByRole("button", { name: "恢复此版本", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
  };
  const assertUnchanged = (baseline, actual) => {
    for (const collection of ["databaseItems", "dataSources", "databaseViews"]) assert.deepEqual(actual[collection], baseline[collection], collection);
  };
  const currentPage = (state, pageId) => state.pages.find(entry => entry.id === pageId);
  const assertSafePreview = async (preview, title, body, databaseLabel) => {
    await preview.getByRole("heading", { name: title, exact: true }).waitFor();
    await preview.locator(".hist-page").getByText(body, { exact: true }).waitFor();
    assert.equal(await preview.locator(".database-view, [data-item-id]").count(), 0);
    assert.doesNotMatch(await preview.innerText(), /Alpha 项目|这段同步正文来自现时来源/);
    assert.ok(await preview.getByText(new RegExp(databaseLabel + " · 此版本保存了引用")).count());
  };
  const getPageCover = preview => preview.locator(".hist-cover .page-cover");
  const baseline = await saved();

  await check("page history labels block identities and locates their current and historical instances", async () => {
    const dialog = await history();
    await dialog.getByRole("option").filter({ hasText: "来源未知" }).waitFor();
    const changes = dialog.locator(".hist-block-diff");
    await changes.locator("summary").click();
    const removed = changes.locator('[data-history-block-id="inline-before"]');
    assert.match(await removed.innerText(), /删除.*内嵌页捕获的旧正文/s);
    await removed.getByRole("button", { name: "在版本中定位", exact: true }).click();
    await page.locator('[data-page-history-location="inline-before"]').waitFor();
    const added = changes.locator('[data-history-block-id="inline-current"]');
    assert.match(await added.innerText(), /新增.*现在的内嵌页正文/s);
    await added.getByRole("button", { name: "在当前页定位", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    await page.locator('[data-page-history-location="inline-current"]').waitFor();
    assert.deepEqual(currentPage(await saved(), ids.inline).content, currentPage(baseline, ids.inline).content);
  });

  await check("inline history shows captured text and cover while its live database and synced rows are represented by references", async () => {
    await page.getByLabel("页面标题", { exact: true }).waitFor();
    const dialog = await history();
    const preview = dialog.getByRole("region", { name: "版本预览" });
    await assertSafePreview(preview, "历史内嵌页标题", "内嵌页捕获的旧正文", "数据库视图");
    await preview.getByText(/同步区块 · 此版本保存了引用/).waitFor();
    assert.match(await getPageCover(preview).getAttribute("style"), /center 72%/);
    await getPageCover(preview).locator("img").waitFor({ state: "attached" });
    assert.equal(await preview.getByRole("button", { name: "更换封面", exact: true }).count(), 0);
    let confirm = await confirmRestore(dialog);
    const description = await confirm.innerText();
    assert.match(description, /标题.*封面.*正文/);
    assert.match(description, /记录和视图设置保留当前数据库中的内容/);
    await confirm.getByRole("button", { name: "取消", exact: true }).click();
    assert.equal(await dialog.isVisible(), true);
    confirm = await confirmRestore(dialog);
    await approve(dialog, confirm);
    const restored = await persisted(state => currentPage(state, ids.inline).title === "历史内嵌页标题");
    assertUnchanged(baseline, restored);
    assert.equal(currentPage(restored, ids.inline).cover.position, 72);
    assert.equal(currentPage(restored, ids.inline).content.find(block => block.id === "inline-db").type, "databaseView");
    assert.equal(currentPage(restored, ids.inline).content.find(block => block.id === "linked-sync").type, "syncedBlock");
  });

  await check("whole-page history recognizes stored database occurrences and detached declarations, and restores declarations without data mutations", async () => {
    await open("项目数据库");
    const dialog = await history();
    const preview = dialog.getByRole("region", { name: "版本预览" });
    await assertSafePreview(preview, "历史整页库含区块", "整页库捕获的旧正文", "整页数据库");
    assert.equal(await preview.getByText(/整页数据库 · 此版本保存了引用/).count(), 1);
    assert.match(await getPageCover(preview).getAttribute("style"), /center 72%/);
    await dialog.getByRole("option").nth(1).click();
    await assertSafePreview(preview, "历史整页库声明", "旧的整页库声明附带正文", "整页数据库");
    assert.equal(await getPageCover(preview).count(), 0);
    const confirm = await confirmRestore(dialog);
    assert.match(await confirm.innerText(), /数据库视图引用.*记录和视图设置保留当前数据库中的内容/);
    await approve(dialog, confirm);
    const restored = await persisted(state => currentPage(state, ids.whole).title === "历史整页库声明");
    assertUnchanged(baseline, restored);
    assert.equal(currentPage(restored, ids.whole).pageType, "database");
    assert.equal(currentPage(restored, ids.whole).databaseSourceId, "projects");
    assert.equal(currentPage(restored, ids.whole).databaseViewId, "view-list");
  });

  await check("a record restore names its title mirror and preserves the other record properties", async () => {
    await open("Alpha 项目");
    const dialog = await history();
    await dialog.getByRole("heading", { name: "历史记录名", exact: true }).waitFor();
    const confirm = await confirmRestore(dialog);
    assert.match(await confirm.innerText(), /该记录的名称会与页面标题同步.*其他记录属性及数据库视图设置保留当前内容/);
    await approve(dialog, confirm);
    const restored = await persisted(state => currentPage(state, ids.row).title === "历史记录名");
    const row = restored.databaseItems.find(item => item.id === "alpha");
    const old = baseline.databaseItems.find(item => item.id === "alpha");
    assert.deepEqual(row.values, { ...old.values, title: "历史记录名" });
    assert.deepEqual(restored.databaseItems.filter(item => item !== row), baseline.databaseItems.filter(item => item !== old));
    assert.deepEqual(restored.databaseViews, baseline.databaseViews);
    assert.deepEqual(restored.dataSources, baseline.dataSources);
  });
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const { browserScenario } = await import("./harness.mjs");
  await browserScenario("page-history-scope", verifyHistoryScope, { workspace: historyScopeFixture(), now: historyScopeTime });
}
