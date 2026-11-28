import { browserScenario, shootBothModes } from "./harness.mjs";
import { fullWorkspace, FIXTURE_TIME } from "../fixtures/full-workspace.mjs";

const workspace = fullWorkspace();
workspace.ui.preferences = { theme: "system" };
workspace.databaseItems.find((item) => item.id === "i-1").values.due = { start: "2026-10-04", end: null, includeTime: false, timeZone: null };
workspace.databaseItems.find((item) => item.id === "i-2").values.due = { start: "2026-10-11", end: null, includeTime: false, timeZone: null };

await browserScenario("wp12-navigation", async ({ page, check, screenshot, saved, persisted, assert }) => {
  const sidebar = page.getByRole("complementary", { name: "主导航" });
  const row = (id) => sidebar.locator(`[data-node-id="${id}"]`);
  const nav = (name) => sidebar.getByRole("button", { name, exact: true });
  const openPage = async (id) => { await row(id).click(); await page.locator(".page-title-input").waitFor(); };
  const visit = async (id) => {
    await openPage(id);
    await page.waitForTimeout(750);
    await page.waitForTimeout(750);
    await persisted((value) => value.ui?.recentVisits?.some((entry) => entry.pageId === id));
  };
  const privateAction = async (name) => {
    await sidebar.getByRole("button", { name: "Private 更多选项", exact: true }).click();
    await page.getByRole("menu", { name: "Private 更多选项" }).getByRole("menuitem", { name, exact: true }).click();
  };
  const contextAction = async (target, name) => { await target.click({ button: "right" }); await page.locator(".sidebar-context-menu").getByRole("menuitem", { name, exact: true }).click(); };
  await check("Sidebar has no teamspaces and follows the new order", async () => {
    await sidebar.waitFor();
    assert.doesNotMatch(await sidebar.innerText(), /Teamspaces|团队空间|总部/);
    const labels = await sidebar.locator("button").allTextContents();
    let previous = -1;
    for (const label of ["搜索", "Home", "Recents", "Private", "模板", "密钥库", "回收站"]) {
      const index = labels.findIndex((text) => text.includes(label));
      assert.ok(index > previous, `${label} must follow the previous navigation group`);
      previous = index;
    }
  });
  await check("Recents records real visits in order and drops trashed pages", async () => {
    await privateAction("展开全部");
    await visit("p-a1");
    await visit("p-b1");
    await visit("p-z1");
    await nav("Recents").click();
    const titles = () => page.locator(".recent-card .recent-copy strong").allTextContents();
    assert.deepEqual((await titles()).slice(0, 3), ["Z 目标页", "B 笔记", "A 概览"]);
    await persisted((value) => value.ui.activeSection === "recents");
    await page.reload();
    await page.locator(".recents-view").waitFor();
    assert.deepEqual((await titles()).slice(0, 3), ["Z 目标页", "B 笔记", "A 概览"]);
    await contextAction(row("p-b1"), "移到回收站");
    await page.getByRole("alertdialog").getByRole("button", { name: "移到回收站", exact: true }).click();
    await persisted((value) => Boolean(value.pages.find((entry) => entry.id === "p-b1")?.trashedAt));
    assert.deepEqual((await titles()).slice(0, 2), ["Z 目标页", "A 概览"]);
    await shootBothModes(page, screenshot, "recents");
  });
  await check("Favorites can be added removed reordered and survive reload", async () => {
    await contextAction(row("p-a1"), "添加到收藏");
    await contextAction(row("p-z1"), "添加到收藏");
    const favorite = (id) => sidebar.locator(`[data-favorite-id="${id}"]`);
    await favorite("p-z1").dragTo(favorite("p-a1"));
    await persisted((value) => value.ui?.favoritePageIds?.[0] === "p-z1");
    await contextAction(favorite("p-z1"), "下移");
    await persisted((value) => value.ui?.favoritePageIds?.[0] === "p-a1");
    await page.reload();
    await favorite("p-a1").waitFor();
    assert.deepEqual(await sidebar.locator("[data-favorite-id]").evaluateAll((elements) => elements.map((element) => element.dataset.favoriteId)), ["p-a1", "p-z1"]);
    await contextAction(favorite("p-z1"), "从收藏移除");
    await persisted((value) => value.ui?.favoritePageIds?.length === 1);
    await shootBothModes(page, screenshot, "sidebar");
  });
  await check("Home shows real recents favorites and upcoming records", async () => {
    await nav("回收站").click();
    await page.locator('[data-trash-id="p-b1"]').getByRole("button", { name: "恢复", exact: true }).click();
    await nav("Home").click();
    await persisted((value) => value.pages.find((entry) => entry.id === "p-rec-1")?.trashedAt === null);
    const home = page.locator(".home-page");
    await home.waitFor();
    assert.match(await home.getByRole("region", { name: "即将到来" }).innerText(), /任务一/);
    assert.doesNotMatch(await home.getByRole("region", { name: "即将到来" }).innerText(), /任务二/);
    assert.equal(await home.locator(".home-recent-card").count(), 3);
    assert.equal(await home.getByRole("region", { name: "收藏", exact: true }).count(), 1);
    await shootBothModes(page, screenshot, "home");
    await contextAction(sidebar.locator('[data-favorite-id="p-a1"]'), "从收藏移除");
    await persisted((value) => value.ui?.favoritePageIds?.length === 0);
    assert.equal(await home.getByRole("region", { name: "收藏", exact: true }).count(), 0);
  });
  await check("Renaming the workspace updates the sidebar and the greeting", async () => {
    await sidebar.locator(".workspace-switcher").click();
    const menu = page.getByRole("menu", { name: "工作区菜单" });
    assert.deepEqual(await menu.getByRole("menuitem").allTextContents(), ["设置…", "重命名工作区…", "备份与恢复…", "导入 CSV…", "从 Notion 导入…", "导出为 Markdown…", "关于 Life Atlas"]);
    await shootBothModes(page, screenshot, "menu", { keepVisible: '[role="menu"]' });
    await menu.getByRole("menuitem", { name: "重命名工作区…", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "重命名工作区", exact: true });
    await dialog.getByLabel("工作区名称", { exact: true }).fill("我的知识花园");
    await dialog.getByLabel("工作区图标", { exact: true }).fill("🌿");
    await dialog.getByRole("button", { name: "保存", exact: true }).click();
    await persisted((value) => value.ui.workspaceName === "我的知识花园" && value.ui.workspaceIcon === "🌿");
    assert.equal(await sidebar.locator(".workspace-name").innerText(), "我的知识花园");
    assert.match(await page.locator(".home-hello").innerText(), /我的知识花园/);
    await sidebar.locator(".workspace-switcher").click();
    await menu.getByRole("menuitem", { name: "关于 Life Atlas", exact: true }).click();
    const about = page.getByRole("dialog", { name: "关于 Life Atlas", exact: true });
    assert.match(await about.innerText(), /BlockNote[\s\S]*MPL-2.0/);
    await page.keyboard.press("Escape");
  });
  await check("Private more menu actions work", async () => {
    await privateAction("新建页面");
    await page.getByLabel("页面标题", { exact: true }).fill("导航新页");
    await persisted((value) => value.pages.some((entry) => entry.title === "导航新页"));
    await privateAction("新建文件夹");
    await page.getByPlaceholder("例如：研究").fill("导航顶层");
    await page.getByRole("button", { name: "创建文件夹", exact: true }).click();
    await persisted((value) => value.folders.some((entry) => entry.name === "导航顶层" && entry.parentId === null));
    await privateAction("折叠全部");
    await persisted((value) => value.ui.expandedFolderIds?.length === 0);
    await privateAction("展开全部");
    await persisted((value) => value.ui.expandedFolderIds?.length === value.folders.filter((folder) => !folder.trashedAt).length);
    assert.equal(await row("f-c").isVisible(), true);
  });
  await check("Drag and drop moves and reorders and refuses invalid targets", async () => {
    await row("p-a1").dragTo(row("f-z"));
    await persisted((value) => value.pages.find((entry) => entry.id === "p-a1")?.folderId === "f-z");
    await row("p-a1").dragTo(row("p-z1"), { targetPosition: { x: 70, y: 2 } });
    await persisted((value) => value.pages.find((entry) => entry.id === "p-a1")?.sortIndex < value.pages.find((entry) => entry.id === "p-z1")?.sortIndex);
    const before = (await saved()).folders.find((folder) => folder.id === "f-a").parentId;
    await row("f-a").dragTo(row("f-c"));
    assert.equal((await saved()).folders.find((folder) => folder.id === "f-a").parentId, before);
    await row("f-b").dragTo(row("f-z"));
    await persisted((value) => value.folders.find((entry) => entry.id === "f-b")?.parentId === "f-z");
    await page.reload();
    await sidebar.waitFor();
    const restored = await saved();
    assert.equal(restored.pages.find((entry) => entry.id === "p-a1").folderId, "f-z");
    assert.equal(restored.folders.find((entry) => entry.id === "f-b").parentId, "f-z");
    assert.equal(restored.folders.find((entry) => entry.id === "f-a").parentId, before);
  });
  await check("Back and forward work with buttons and shortcuts", async () => {
    await openPage("p-a1");
    await openPage("p-z1");
    const title = page.locator(".page-title-input");
    await page.getByRole("button", { name: "后退", exact: true }).click();
    assert.equal(await title.inputValue(), "A 概览");
    await page.getByRole("button", { name: "前进", exact: true }).click();
    assert.equal(await title.inputValue(), "Z 目标页");
    await page.keyboard.press("Alt+ArrowLeft");
    assert.equal(await title.inputValue(), "A 概览");
    await page.keyboard.press("Alt+ArrowRight");
    assert.equal(await title.inputValue(), "Z 目标页");
    await page.keyboard.press("Control+[");
    assert.equal(await title.inputValue(), "A 概览");
    await page.keyboard.press("Control+]");
    assert.equal(await title.inputValue(), "Z 目标页");
  });
  await check("Sidebar width and collapse persist", async () => {
    const separator = page.getByRole("separator", { name: "调整侧栏宽度", exact: true });
    const box = await separator.boundingBox();
    await page.mouse.move(box.x + 2, box.y + 120);
    await page.mouse.down();
    await page.mouse.move(340, box.y + 120, { steps: 8 });
    await page.mouse.up();
    await persisted((value) => value.ui.sidebarWidth > 330 && value.ui.sidebarWidth < 350);
    await page.keyboard.press("Control+\\");
    await persisted((value) => value.ui.sidebarCollapsed === true);
    assert.equal(await sidebar.count(), 0);
    await page.reload();
    await page.getByRole("button", { name: "展开侧栏", exact: true }).click();
    await sidebar.waitFor();
    assert.ok((await sidebar.boundingBox()).width > 330);
    await persisted((value) => value.ui.sidebarCollapsed === false);
  });
}, { workspace, now: FIXTURE_TIME, viewport: { width: 1440, height: 900 } });
