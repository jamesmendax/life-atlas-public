import { browserScenario } from "./harness.mjs";
import { fullWorkspace } from "../fixtures/full-workspace.mjs";
import { mkdirSync } from "node:fs";

const reportRoot = "LOCAL-NOTION-001/v10-page-default-create";
mkdirSync(`.qa/${reportRoot}`, { recursive: true });
const workspace = fullWorkspace();
workspace.ui.preferences = { startPage: "last", theme: "system" };

await browserScenario(`${reportRoot}/page-default-create`, async ({ page, check, saved, persisted, assert }) => {
  const sidebar = page.getByRole("complementary", { name: "主导航" });
  const row = (id) => sidebar.locator(`[data-node-id="${id}"]`);
  const title = page.getByLabel("页面标题", { exact: true });
  const newPage = async (action, folderId) => {
    const before = await saved();
    const ids = new Set(before.pages.map((entry) => entry.id));
    await action();
    assert.equal(await page.locator(".new-folder-modal").count(), 0, "New must not require a naming dialog");
    await title.waitFor({ state: "visible", timeout: 4000 });
    const after = await persisted((value) => value.pages.filter((entry) => !ids.has(entry.id)).length === 1 && !ids.has(value.ui.selectedPageId));
    const created = after.pages.find((entry) => !ids.has(entry.id));
    assert.equal(created.id, after.ui.selectedPageId);
    assert.equal(created.folderId, folderId);
    assert.equal(created.title, "");
    assert.equal(await title.inputValue(), "");
    assert.equal(await page.locator(".new-folder-modal").count(), 0);
    assert.equal(after.databaseItems.length, before.databaseItems.length);
    assert.equal(after.databaseItems.some((item) => item.pageId === created.id), false);
    return created.id;
  };

  await check("Private plus creates an empty page, retains identity through reload and rename", async () => {
    const id = await newPage(() => sidebar.getByRole("button", { name: "新建页面", exact: true }).click(), "f-a");
    const count = (await saved()).pages.length;
    assert.equal(await title.evaluate((element) => document.activeElement === element), true);
    await title.blur();
    await page.keyboard.press("Escape");
    await sidebar.getByRole("button", { name: "Home", exact: true }).click();
    await persisted((value) => value.ui.activeSection === "home" && value.pages.some((entry) => entry.id === id && entry.title === ""));
    await page.reload();
    await row(id).click();
    assert.equal(await title.inputValue(), "");
    await title.fill("后续命名");
    await title.blur();
    const renamed = await persisted((value) => value.pages.find((entry) => entry.id === id)?.title === "后续命名");
    assert.equal(renamed.pages.filter((entry) => entry.id === id).length, 1);
    assert.equal(renamed.pages.length, count);
    await page.reload();
    assert.equal(await title.inputValue(), "后续命名");
  });

  await check("Private menu and Home create in selected ordinary folder", async () => {
    await sidebar.getByRole("button", { name: "Private 更多选项", exact: true }).click();
    await newPage(() => page.getByRole("menu", { name: "Private 更多选项" }).getByRole("menuitem", { name: "新建页面", exact: true }).click(), "f-a");
    await sidebar.getByRole("button", { name: "Home", exact: true }).click();
    await newPage(() => page.locator(".home-page").getByRole("button", { name: "新建页面", exact: true }).click(), "f-a");
  });

  await check("Folder view creates inside empty folder and history returns to created page", async () => {
    await row("f-empty").locator(".tree-folder-main").click();
    const id = await newPage(() => page.getByRole("button", { name: "新建第一篇笔记", exact: true }).click(), "f-empty");
    await page.getByRole("button", { name: "后退", exact: true }).click();
    await page.getByRole("button", { name: "前进", exact: true }).click();
    const state = await persisted((value) => value.ui.selectedPageId === id);
    assert.equal(state.ui.selectedFolderId, "f-empty");
    assert.equal(await title.inputValue(), "");
    assert.equal(await row(id).isVisible(), true);
    await row("f-empty").locator(".tree-folder-main").click();
    await newPage(() => page.getByRole("button", { name: "新建笔记", exact: true }).click(), "f-empty");
  });

  await check("Folder context action creates in context target", async () => {
    await row("f-z").click({ button: "right" });
    const id = await newPage(() => page.locator(".sidebar-context-menu").getByRole("menuitem", { name: "新建页面", exact: true }).click(), "f-z");
    assert.equal(await row(id).isVisible(), true);
    await persisted((value) => value.folders.find((folder) => folder.id === "f-z")?.lastOpenedPageId === id);
    await persisted((value) => value.ui.recentVisits?.some((visit) => visit.pageId === id));
    await page.getByRole("button", { name: "Home", exact: true }).click();
  });
}, { workspace });

const noFolders = fullWorkspace();
noFolders.folders = [{ id: "system-inbox", system: "inbox", parentId: null, name: "收件箱", color: "stone", sortIndex: -1, lastOpenedPageId: null, createdAt: "2026-10-01T08:00:00.000Z", updatedAt: "2026-10-01T08:00:00.000Z" }];
noFolders.pages = [];
noFolders.ui = { ...noFolders.ui, selectedFolderId: "system-inbox", selectedPageId: null, expandedFolderIds: [], preferences: { startPage: "last", theme: "system" } };

await browserScenario(`${reportRoot}/page-default-no-folder`, async ({ page, check, saved, persisted, assert }) => {
  await check("Inbox-only workspace creates one normal root and reuses it for subsequent page", async () => {
    const plus = page.getByRole("complementary", { name: "主导航" }).getByRole("button", { name: "新建页面", exact: true });
    await plus.click();
    await page.getByLabel("页面标题", { exact: true }).waitFor();
    await plus.click();
    const first = await persisted((value) => value.pages.length === 2);
    const folder = first.folders.find((entry) => !entry.system && !entry.trashedAt);
    assert.equal(folder.name, "我的空间");
    assert.equal(folder.parentId, null);
    assert.equal(first.pages[0].folderId, folder.id);
    assert.equal(first.pages[0].title, "");
    const firstId = first.pages[0].id;
    const second = await persisted((value) => value.pages.length === 2 && value.ui.selectedPageId !== firstId);
    assert.equal(second.folders.filter((entry) => !entry.system && !entry.trashedAt).length, 1);
    assert.equal(second.pages.every((entry) => entry.folderId === folder.id && entry.title === ""), true);
    assert.notEqual(second.pages[0].id, second.pages[1].id);
    await page.reload();
    assert.equal(await page.getByLabel("页面标题", { exact: true }).inputValue(), "");
    const reloaded = await saved();
    assert.equal(reloaded.pages.length, 2);
    assert.equal(reloaded.folders.filter((entry) => !entry.system && !entry.trashedAt).length, 1);
  });
}, { workspace: noFolders });
