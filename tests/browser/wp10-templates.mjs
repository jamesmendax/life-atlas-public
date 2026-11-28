import { browserScenario } from "./harness.mjs";
import { fullWorkspace } from "../fixtures/full-workspace.mjs";
import { checkWorkspaceIntegrity } from "../../src/domain/integrity.js";
import { walkBlocks } from "../../src/domain/blockDocument.js";
import { workspaceStorageKey } from "../../src/persistence/workspaceRepository.js";

const workspace = fullWorkspace();
workspace.ui.preferences = { theme: "light", style: "mobai" };
const NOW = "2026-11-01T02:00:00.000Z";
const BUILTIN_TITLE = "软件开发进程";
const withoutBlockIds = (blocks) => (blocks || []).map(({ id, children, ...block }) => ({ ...block, ...(children ? { children: withoutBlockIds(children) } : {}) }));

await browserScenario("wp10-templates", async ({ page, check, screenshot, saved, persisted, assert }) => {
  const sidebar = page.getByRole("complementary", { name: "主导航" });
  const marketButton = sidebar.getByRole("button", { name: "模板与市场", exact: true });
  const marketList = page.getByRole("region", { name: "模板与小组件市场", exact: true });
  const marketDetail = (title) => page.getByRole("region", { name: title + " 详情", exact: true });
  const marketCard = (title) => marketList.getByRole("button", { name: title, exact: true });
  const builtin = marketDetail(BUILTIN_TITLE);
  const builtinHeading = builtin.getByRole("heading", { name: BUILTIN_TITLE, exact: true });
  const builtinCard = marketCard(BUILTIN_TITLE);
  const projectName = builtin.getByRole("textbox", { name: "项目名称", exact: true });
  const sampleData = builtin.getByRole("switch", { name: "包含示例数据", exact: true });
  const folders = (detail) => detail.getByRole("combobox", { name: "模板目标文件夹", exact: true });
  const folderSearch = (detail) => detail.getByRole("combobox", { name: "搜索目标文件夹…", exact: true });
  const useTemplate = (detail) => detail.getByRole("button", { name: "使用模板", exact: true });
  const earlier = page.getByRole("button", { name: "后退", exact: true });
  const later = page.getByRole("button", { name: "前进", exact: true });
  const origin = new URL(page.url()).origin;
  const externalRequests = [];
  page.on("request", (request) => {
    if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== origin) externalRequests.push(request.url());
  });
  let projectId;
  let milestoneSourceId;
  let taskSourceId;
  let roadmapViewId;
  let templateId;
  const theme = async (mode) => {
    for (let attempt = 0; attempt < 3 && await page.evaluate(() => document.documentElement.dataset.theme) !== mode; attempt += 1) await page.locator(".header-theme-toggle").click();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), mode);
  };
  const openMarket = async () => {
    await marketButton.click();
    await marketList.getByRole("tablist", { name: "市场分区" }).waitFor();
  };
  const chooseBuiltin = async () => {
    await marketList.getByRole("tab", { name: "模板市场", exact: true }).click();
    await builtinCard.click();
    await builtinHeading.waitFor();
  };
  const chooseMine = async (title) => {
    await marketList.getByRole("tab", { name: /^我的模板/ }).click();
    await marketCard(title).click();
    const detail = marketDetail(title);
    await detail.getByRole("heading", { name: title, exact: true }).waitFor();
    return detail;
  };
  const waitForFocus = async (locator) => {
    const element = await locator.elementHandle();
    await page.waitForFunction((node) => node === document.activeElement, element);
  };
  const chooseFolder = async (detail, name, id) => {
    const picker = folders(detail);
    await picker.click();
    const search = folderSearch(detail);
    await waitForFocus(search);
    await search.fill(name);
    const option = detail.getByRole("option", { name, exact: true });
    await option.waitFor();
    assert.equal(await search.getAttribute("aria-activedescendant"), await option.getAttribute("id"));
    await search.press("Enter");
    await search.waitFor({ state: "detached" });
    assert.equal(await picker.getAttribute("data-value"), id);
    await waitForFocus(picker);
  };
  const openProject = async () => {
    await sidebar.locator('.page-tree-row[title="Life Atlas 桌面版 · 开发进程"]').click();
    await page.locator('[data-testid="roadmap-view"]').waitFor();
  };
  const returnTop = async () => {
    await page.locator(".workspace-scroll").evaluateAll((elements) => elements.forEach((element) => element.scrollTo(0, 0)));
    await page.evaluate(() => window.scrollTo(0, 0));
  };
  const checkCanvas = async (region) => {
    const bounds = await region.evaluate((element) => {
      const frame = element.parentElement;
      const canvas = element.querySelector(".mp-browse-canvas, .mp-detail-canvas");
      const { width, height } = element.getBoundingClientRect();
      return {
        inWorkspace: frame.classList.contains("workspace-scroll"),
        modal: Boolean(element.closest('[aria-modal="true"]')),
        width,
        height,
        frameWidth: frame.clientWidth,
        frameHeight: frame.clientHeight,
        scrollable: getComputedStyle(canvas).overflowY,
        horizontalOverflow: canvas.scrollWidth - canvas.clientWidth,
        viewportOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    assert.equal(bounds.inWorkspace, true);
    assert.equal(bounds.modal, false);
    assert.ok(Math.abs(bounds.width - bounds.frameWidth) <= 1, JSON.stringify(bounds));
    assert.ok(Math.abs(bounds.height - bounds.frameHeight) <= 1, JSON.stringify(bounds));
    assert.equal(bounds.scrollable, "auto");
    assert.ok(bounds.horizontalOverflow <= 1, JSON.stringify(bounds));
    assert.ok(bounds.viewportOverflow <= 1, JSON.stringify(bounds));
  };
  const checkDetailStyle = async (mode) => {
    await page.evaluate(() => document.fonts.ready);
    const dimensions = await builtin.evaluate((element) => {
      const style = getComputedStyle(element);
      const action = element.querySelector(".mp-action-card");
      const title = getComputedStyle(action.querySelector("h1"));
      return {
        background: style.backgroundColor,
        font: style.fontFamily,
        actionBackground: getComputedStyle(action).backgroundColor,
        titleSize: title.fontSize,
        titleWeight: title.fontWeight,
        numbers: getComputedStyle(element.querySelector(".mp-stage-svg .thumb-num text")).fontSize,
        major: getComputedStyle(element.querySelector(".mp-stage-svg .thumb-major")).fill,
        ordinary: getComputedStyle(element.querySelector(".mp-stage-svg .thumb-ms:not(.is-done)")).fill,
      };
    });
    assert.equal(dimensions.titleSize, "24px");
    assert.equal(dimensions.titleWeight, "700");
    assert.match(dimensions.font, /^"Segoe UI Variable Text"/);
    assert.equal(dimensions.background, mode === "light" ? "rgb(255, 255, 255)" : "rgb(25, 25, 25)");
    assert.equal(dimensions.actionBackground, mode === "light" ? "rgb(255, 255, 255)" : "rgb(37, 37, 37)");
    assert.equal(dimensions.numbers, "17px");
    assert.equal(dimensions.major, "rgb(35, 131, 226)");
    assert.equal(dimensions.ordinary, mode === "light" ? "rgb(255, 255, 255)" : "rgb(25, 25, 25)");
  };

  await check("Local templates open in the marketplace canvas without a native market bridge", async () => {
    await theme("light");
    await openMarket();
    await checkCanvas(marketList);
    assert.equal(await page.evaluate(() => Boolean(window.lifeAtlas?.market)), false);
    const allTab = marketList.getByRole("tab", { name: "全部精选", exact: true });
    const templatesTab = marketList.getByRole("tab", { name: "模板市场", exact: true });
    assert.equal(await allTab.getAttribute("aria-selected"), "true");
    await allTab.press("ArrowRight");
    await waitForFocus(templatesTab);
    assert.equal(await templatesTab.getAttribute("aria-selected"), "true");
    await templatesTab.press("ArrowLeft");
    await waitForFocus(allTab);
    assert.equal(await marketList.getByRole("tab", { name: "小组件市场", exact: true }).count(), 0);
    assert.equal(await marketList.getByRole("button", { name: "导入本地包", exact: true }).count(), 0);
    await marketCard("周记模板").waitFor();
    const search = marketList.getByRole("searchbox", { name: "搜索模板或小组件", exact: true });
    await search.fill("无法命中");
    await marketList.getByText("没有找到与“无法命中”匹配的作品。", { exact: true }).waitFor();
    await marketList.getByRole("button", { name: "清空搜索", exact: true }).click();
    await marketList.getByRole("button", { name: "研发规划", exact: true }).click();
    await builtinCard.waitFor();
    assert.equal(await marketCard("周记模板").count(), 0);
    await builtinCard.press("Enter");
    await waitForFocus(builtinHeading);
    await checkCanvas(builtin);
    assert.equal(await projectName.inputValue(), "新项目");
    assert.equal(await folders(builtin).getAttribute("data-value"), "f-a");
    assert.equal(await sampleData.getAttribute("aria-checked"), "true");
    await folders(builtin).click();
    await waitForFocus(folderSearch(builtin));
    await builtin.getByRole("option", { name: "A 项目 / B 资料 / C 细节", exact: true }).waitFor();
    await folderSearch(builtin).press("Escape");
    await folderSearch(builtin).waitFor({ state: "detached" });
    await waitForFocus(folders(builtin));
    await projectName.press("Escape");
    assert.equal(await builtin.isVisible(), true);
    await checkDetailStyle("light");
    await screenshot("templates-light");
    const desktopViewport = page.viewportSize();
    await page.setViewportSize({ width: 900, height: 760 });
    try {
      await checkCanvas(builtin);
      const columns = await builtin.locator(".mp-detail-grid").evaluate((element) => getComputedStyle(element).gridTemplateColumns);
      assert.equal(columns.trim().split(/\s+/).length, 1);
    } finally {
      await page.setViewportSize(desktopViewport);
    }
  });

  await check("Marketplace navigation restores pages, listing cards and detail focus", async () => {
    await theme("dark");
    const savedWhileBrowsing = await persisted((value) => value.ui?.preferences?.theme === "dark");
    assert.equal(savedWhileBrowsing.ui.activeSection, "private");
    await theme("light");
    await earlier.click();
    await waitForFocus(builtinCard);
    await earlier.click();
    const pageTitle = page.getByLabel("页面标题", { exact: true });
    await pageTitle.waitFor();
    assert.equal(await pageTitle.inputValue(), "A 概览");
    await later.click();
    await builtinCard.waitFor();
    await later.click();
    await waitForFocus(builtinHeading);
    await builtinHeading.press("Escape");
    await waitForFocus(builtinCard);
    await builtinCard.click();
    await waitForFocus(builtinHeading);
    await builtin.getByRole("button", { name: "返回市场", exact: true }).click();
    await waitForFocus(builtinCard);
  });

  await check("Retrying a failed template save opens exactly one project and roadmap", async () => {
    await openMarket();
    await chooseBuiltin();
    await projectName.fill(" ");
    assert.equal(await useTemplate(builtin).isDisabled(), true);
    await projectName.fill("Life Atlas 桌面版");
    await chooseFolder(builtin, "Z 其他", "f-z");
    const title = "Life Atlas 桌面版 · 开发进程";
    await page.evaluate(({ storageKey, title }) => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function setItem(key, value) {
        if (key === storageKey && JSON.parse(value).pages.some((entry) => entry.title === title)) {
          Storage.prototype.setItem = original;
          throw new Error("Synthetic template save failure");
        }
        return original.call(this, key, value);
      };
    }, { storageKey: workspaceStorageKey, title });
    await useTemplate(builtin).click();
    await builtin.getByText(/内容已添加，保存尚未完成/u).waitFor();
    assert.equal((await saved()).pages.some((entry) => entry.title === title), false);
    await builtin.getByRole("button", { name: "重试保存已有内容", exact: true }).click();
    await builtin.waitFor({ state: "detached" });
    await page.getByLabel("页面标题", { exact: true }).waitFor();
    assert.equal(await page.getByLabel("页面标题", { exact: true }).inputValue(), title);
    await page.waitForFunction(() => document.querySelector('[data-testid="roadmap-view"]')?.querySelectorAll("[data-entry-id]").length === 8);
    const state = await persisted((value, title) => value.pages?.some((entry) => entry.title === title && entry.id === value.ui.selectedPageId) && value.databaseItems?.length === 20, title);
    const projects = state.pages.filter((entry) => entry.title === title);
    assert.equal(projects.length, 1);
    const [project] = projects;
    projectId = project.id;
    milestoneSourceId = state.dataSources.find((source) => source.ownerPageId === project.id && source.title === "里程碑与阶段").id;
    taskSourceId = state.dataSources.find((source) => source.ownerPageId === project.id && source.title === "任务").id;
    roadmapViewId = state.databaseViews.find((view) => view.sourceId === milestoneSourceId && view.type === "roadmap").id;
    assert.equal(project.folderId, "f-z");
    assert.equal(project.settings.fullWidth, true);
    assert.equal(state.ui.selectedPageId, projectId);
    assert.ok(state.ui.expandedFolderIds.includes("f-z"));
    assert.equal(await page.getByTestId("roadmap-view").locator("[data-entry-id]").count(), 8);
    assert.equal(checkWorkspaceIntegrity(state).ok, true);
    await returnTop();
    await screenshot("project-light");
  });

  await check("The generated project survives a reload", async () => {
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByTestId("roadmap-view").waitFor();
    assert.equal(await page.getByLabel("页面标题", { exact: true }).inputValue(), "Life Atlas 桌面版 · 开发进程");
    assert.equal(await page.getByTestId("roadmap-view").locator("[data-entry-id]").count(), 8);
    const state = await saved();
    assert.equal(state.pages.find((entry) => entry.id === projectId).folderId, "f-z");
    assert.equal(state.dataSources.filter((source) => source.ownerPageId === projectId).length, 2);
    const views = state.databaseViews.filter((view) => [milestoneSourceId, taskSourceId].includes(view.sourceId));
    assert.equal(views.filter((view) => !view.linked).length, 7);
    assert.equal(views.filter((view) => view.linked).length, 2);
    assert.equal(views.length, 9);
    assert.equal(state.databaseItems.filter((item) => item.sourceId === milestoneSourceId).length, 8);
    assert.equal(state.databaseItems.filter((item) => item.sourceId === taskSourceId).length, 8);
    assert.equal(state.relations.filter((relation) => [milestoneSourceId, taskSourceId].includes(relation.sourceId)).length, 2);
    assert.equal(checkWorkspaceIntegrity(state).ok, true);
  });

  await check("Progress rollups show 100 and 33 percent", async () => {
    const roadmap = page.getByTestId("roadmap-view");
    const detail = roadmap.getByRole("tooltip", { name: "时间脉络详情", exact: true });
    for (const [title, expected] of [["需求与规划", "100%"], ["原型与设计", "33%"]]) {
      await roadmap.getByRole("button", { name: new RegExp(`^${title}，`, "u") }).focus();
      await detail.getByText(expected, { exact: true }).waitFor();
    }
    await persisted((value) => value.pages?.find((entry) => entry.id === projectId)?.content?.find((block) => block.type === "databaseView")?.props?.viewId === roadmapViewId);
  });

  await check("Without sample data the views show empty states", async () => {
    await openMarket();
    await chooseBuiltin();
    await projectName.fill("空白项目");
    await sampleData.click();
    assert.equal(await sampleData.getAttribute("aria-checked"), "false");
    await useTemplate(builtin).click();
    await page.getByTestId("roadmap-view").getByText("还没有带日期的记录", { exact: true }).waitFor();
    const state = await persisted((value) => value.pages?.some((entry) => entry.title === "空白项目 · 开发进程"));
    const blank = state.pages.find((entry) => entry.title === "空白项目 · 开发进程");
    const sourceIds = state.dataSources.filter((source) => source.ownerPageId === blank.id).map((source) => source.id);
    assert.equal(sourceIds.length, 2);
    assert.equal(state.databaseItems.filter((item) => sourceIds.includes(item.sourceId)).length, 0);
    assert.equal(state.databaseViews.filter((view) => sourceIds.includes(view.sourceId) && !view.linked).length, 7);
    assert.equal(state.databaseViews.filter((view) => sourceIds.includes(view.sourceId) && view.linked).length, 2);
    assert.equal(await page.getByTestId("roadmap-view").locator("[data-entry-id]").count(), 0);
    assert.equal(checkWorkspaceIntegrity(state).ok, true);
  });

  await check("A page can be saved, reused and deleted from My Templates", async () => {
    await sidebar.locator('.page-tree-row[title="A 概览"]').click();
    await page.locator(".life-editor").getByText("概览", { exact: true }).first().waitFor();
    await page.getByRole("button", { name: "页面操作", exact: true }).click();
    await page.getByRole("menuitem", { name: "保存为页面模板…", exact: true }).click();
    const prompt = page.locator('[data-la-dialog="prompt"]');
    await prompt.waitFor();
    await prompt.locator("input").fill("概览模板");
    await prompt.locator("[data-la-dialog-confirm]").click();
    const before = await persisted((value) => value.pageTemplates?.some((template) => template.name === "概览模板"));
    const template = before.pageTemplates.find((entry) => entry.name === "概览模板");
    const original = before.pages.find((entry) => entry.id === "p-a1");
    templateId = template.id;
    assert.deepEqual(withoutBlockIds(template.content), withoutBlockIds(original.content));
    await openMarket();
    const mine = await chooseMine("概览模板");
    const deleteTemplate = mine.getByRole("button", { name: "删除模板", exact: true });
    assert.equal(await mine.getByRole("textbox", { name: "项目名称", exact: true }).count(), 0);
    assert.equal(await mine.getByRole("switch", { name: "包含示例数据", exact: true }).count(), 0);
    assert.match(await mine.locator(".mp-mine-detail-preview").innerText(), /概览/);
    assert.equal(await mine.locator(".mp-mine-detail-preview p").first().evaluate((element) => getComputedStyle(element).fontWeight), "600");
    await chooseFolder(mine, "空文件夹", "f-empty");
    await screenshot("mine-light");
    await deleteTemplate.click();
    const confirmation = page.getByRole("alertdialog", { name: "删除模板", exact: true });
    await confirmation.waitFor();
    assert.match(await confirmation.innerText(), /删除“概览模板”？删除后不能恢复。/);
    await page.keyboard.press("Escape");
    await confirmation.waitFor({ state: "detached" });
    await waitForFocus(deleteTemplate);
    assert.equal(await mine.isVisible(), true);
    assert.ok((await saved()).pageTemplates.some((entry) => entry.id === templateId));
    await useTemplate(mine).click();
    await mine.waitFor({ state: "detached" });
    const reusedState = await persisted((value) => value.pages?.some((entry) => entry.folderId === "f-empty" && entry.title === "概览模板" && entry.id === value.ui.selectedPageId));
    const reused = reusedState.pages.find((entry) => entry.folderId === "f-empty" && entry.title === "概览模板");
    assert.equal(reusedState.ui.selectedPageId, reused.id);
    assert.notEqual(reused.id, original.id);
    assert.deepEqual(withoutBlockIds(reused.content), withoutBlockIds(original.content));
    const originalIds = new Set(walkBlocks(original.content).map((block) => block.id));
    assert.ok(walkBlocks(reused.content).every((block) => !originalIds.has(block.id)));
    assert.ok(reusedState.ui.expandedFolderIds.includes("f-empty"));
    assert.equal(checkWorkspaceIntegrity(reusedState).ok, true);
    await openMarket();
    await chooseMine("概览模板");
    await deleteTemplate.click();
    await confirmation.getByRole("button", { name: "删除模板", exact: true }).click();
    await confirmation.waitFor({ state: "detached" });
    await marketList.getByRole("heading", { name: "我的模板", exact: true }).waitFor();
    const deletedState = await persisted((value) => !value.pageTemplates?.some((entry) => entry.id === templateId));
    assert.ok(deletedState.pages.some((entry) => entry.id === reused.id));
    assert.equal(await marketCard("概览模板").count(), 0);
    await marketCard("周记模板").waitFor();
  });

  await theme("dark");
  await openMarket();
  await chooseBuiltin();
  await checkCanvas(builtin);
  await checkDetailStyle("dark");
  await screenshot("templates-dark");
  await builtinHeading.press("Escape");
  await builtinCard.waitFor();
  await openProject();
  await returnTop();
  assert.equal(await page.getByTestId("roadmap-view").locator("[data-entry-id]").count(), 8);
  await page.evaluate(() => document.fonts.ready);
  assert.equal(await page.locator(".workspace-scroll").evaluate((element) => getComputedStyle(element).backgroundColor), "rgb(25, 25, 25)");
  await screenshot("project-dark");
  assert.deepEqual(externalRequests, []);
}, { workspace, now: NOW, viewport: { width: 1440, height: 900 } });
