import { mkdirSync, readFileSync } from "node:fs";
import sharp from "sharp";
import { browserScenario } from "./harness.mjs";
import { fullWorkspace } from "../fixtures/full-workspace.mjs";
import { createDatabaseView } from "../../src/domain/database.js";
import { changeLayout, openViewSettingsSection, setViewSettings, viewSettingsPanel } from "./database-navigation.mjs";

const DAY = 86400000;
const current = new Date();
const localDay = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, "0")}-${String(current.getDate()).padStart(2, "0")}`;
const anchor = Date.parse(`${localDay}T00:00:00Z`);
const time = current.toISOString();
const day = (offset) => new Date(anchor + offset * DAY).toISOString().slice(0, 10);
const dateValue = (start, end = null) => ({ start: day(start), end: end === null ? null : day(end), includeTime: false, timeZone: null });
const definitions = [
  ["plan", "需求与规划", "phase", -28, -14, "done", ""],
  ["review", "需求评审通过", "review", -14, null, "done", ""],
  ["design", "原型与设计", "phase", -14, 3, "doing", ""],
  ["develop", "开发 v1", "phase", 3, 38, "todo", ""],
  ["docs", "文档编写", "phase", 20, 45, "todo", ""],
  ["freeze", "功能冻结", "milestone", 38, null, "todo", ""],
  ["fixes", "测试与修复", "phase", 38, 52, "todo", ""],
  ["release", "v1.0 发布", "release", 53, null, "todo", "1.0.0"],
];
const workspace = fullWorkspace();
workspace.ui.expandedFolderIds = [...new Set([...workspace.ui.expandedFolderIds, "f-z"])];
workspace.ui.preferences = { theme: "light", style: "mobai" };
const pageSettings = { fontFamily: "default", smallText: false, fullWidth: true, presentationMode: "full", locked: false };
const pageRecord = (id, title, extra = {}) => ({ id, folderId: "f-z", title, icon: "icon:calendar-event", iconColor: null, cover: null, settings: { ...pageSettings }, trashedAt: null, summary: "", contentRevision: 0, summarySourceRevision: 0, summaryUpdatedAt: time, tags: [], sortIndex: 100, createdAt: time, updatedAt: time, content: [], ...extra });
const properties = [
  { id: "title", name: "名称", type: "title" },
  { id: "kind", name: "类型", type: "select", options: [{ id: "phase", name: "阶段", color: "blue" }, { id: "milestone", name: "里程碑", color: "purple" }, { id: "release", name: "发布", color: "green" }, { id: "review", name: "评审", color: "orange" }] },
  { id: "time", name: "时间", type: "date" },
  { id: "status", name: "状态", type: "status", options: [{ id: "todo", name: "未开始", color: "gray", group: "todo" }, { id: "doing", name: "进行中", color: "blue", group: "inProgress" }, { id: "done", name: "已完成", color: "green", group: "complete" }, { id: "delayed", name: "已延期", color: "red", group: "inProgress" }, { id: "canceled", name: "已取消", color: "gray", group: "complete" }] },
  { id: "version", name: "版本", type: "text" },
];
for (const [sourceId, pageId, title, viewId] of [["roadmap-source", "roadmap-page", "路线图测试", "roadmap-table"], ["roadmap-big-source", "roadmap-big-page", "500 条路线图", "roadmap-big-table"]]) {
  workspace.pages.push(pageRecord(pageId, title, { pageType: "database", databaseSourceId: sourceId, databaseViewId: viewId }));
  workspace.dataSources.push({ id: sourceId, title: sourceId === "roadmap-source" ? "里程碑与阶段" : "500 条阶段与里程碑", ownerPageId: pageId, properties: structuredClone(properties), createdAt: time, updatedAt: time });
  workspace.databaseViews.push({ ...createDatabaseView({ id: viewId, sourceId, name: "表格", type: "table" }), createdAt: time, updatedAt: time });
}
for (const [id, title, kind, start, end, status, version] of definitions) {
  const itemId = `roadmap-${id}`;
  const pageId = `roadmap-record-${id}`;
  workspace.pages.push(pageRecord(pageId, title, { databaseSourceId: "roadmap-source", parentDatabaseItemId: null }));
  workspace.databaseItems.push({ id: itemId, sourceId: "roadmap-source", pageId, parentItemId: null, values: { title, kind, time: dateValue(start, end), status, version }, createdAt: time, updatedAt: time });
}
for (let index = 0; index < 500; index++) {
  const id = `roadmap-big-${String(index).padStart(3, "0")}`;
  const title = `阶段 ${String(index).padStart(3, "0")}`;
  workspace.pages.push(pageRecord(`${id}-page`, title, { databaseSourceId: "roadmap-big-source" }));
  workspace.databaseItems.push({ id, sourceId: "roadmap-big-source", pageId: `${id}-page`, parentItemId: null, values: { title, kind: index % 4 === 0 ? "phase" : "milestone", time: dateValue(index - 150, index % 4 === 0 ? index - 138 : null), status: "todo", version: "" }, createdAt: time, updatedAt: time });
}

await browserScenario("wp09-roadmap", async ({ page, check, screenshot, saved, persisted, assert }) => {
  const sidebar = page.getByRole("complementary", { name: "主导航" });
  const database = page.locator('section.database-view[data-source-id="roadmap-source"]');
  const roadmap = database.getByTestId("roadmap-view");
  const node = (id) => roadmap.locator(`[data-entry-id="${id}"]`);
  const openRoadmap = async () => {
    await sidebar.locator('.page-tree-row[title="路线图测试"]').click();
    await database.waitFor({ state: "visible" });
  };
  const settings = (open) => open ? openViewSettingsSection(database, "布局") : setViewSettings(database, false);
  const panel = viewSettingsPanel(database);
  const theme = async (mode) => {
    for (let attempt = 0; attempt < 3 && await page.evaluate(() => document.documentElement.dataset.theme) !== mode; attempt++) await page.locator(".header-theme-toggle").click();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), mode);
  };
  const dragEntry = async (id, days, beforeRelease = null) => {
    const handle = node(id).locator("[data-drag-handle]");
    await handle.scrollIntoViewIfNeeded();
    const bounds = await handle.boundingBox();
    const pixels = await roadmap.evaluate((element) => (Number(element.dataset.axisX1) - Number(element.dataset.axisX0)) / ((Number(element.dataset.domainEnd) - Number(element.dataset.domainStart)) / 86400000));
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width / 2 + days * pixels, bounds.y + bounds.height / 2, { steps: 6 });
    if (beforeRelease) await beforeRelease();
    await page.mouse.up();
  };
  const lockPage = async (lock) => {
    await page.getByRole("button", { name: "页面操作", exact: true }).click();
    await page.getByRole("menuitem", { name: lock ? "锁定页面" : "解锁页面", exact: true }).click();
    await page.keyboard.press("Escape");
    await persisted((value, locked) => value.pages?.find((entry) => entry.id === "roadmap-page")?.settings?.locked === locked, lock);
  };

  await check("A roadmap view can be added and picks the first date property", async () => {
    await openRoadmap();
    await changeLayout(database, "roadmap");
    await page.waitForFunction(() => document.querySelector('[data-testid="roadmap-view"]')?.querySelectorAll("[data-entry-id]").length === 8);
    const state = await persisted((value) => value.databaseViews?.find((entry) => entry.id === "roadmap-table")?.config?.roadmap?.datePropertyId === "time");
    assert.equal(state.databaseItems.filter((item) => item.sourceId === "roadmap-source").length, 8);
    assert.equal(await roadmap.locator("[data-entry-id]").count(), 8);
    await settings(true);
    await panel.getByLabel("时间脉络标记属性", { exact: true }).selectOption("kind");
    for (const [label, shape] of [["阶段", "circle"], ["里程碑", "diamond"], ["发布", "major"], ["评审", "square"]]) await panel.getByLabel(`${label} 标记形状`, { exact: true }).selectOption(shape);
    await panel.getByLabel("时间脉络副标题属性", { exact: true }).selectOption("version");
    await settings(false);
    await persisted((value) => value.databaseViews?.find((entry) => entry.id === "roadmap-table")?.config?.roadmap?.markerMap?.release === "major");
    assert.equal(await node("roadmap-release").locator('circle[r="14"]').count(), 1);
  });

  await check("Hover shows the full details", async () => {
    await theme("light");
    await node("roadmap-freeze").locator(".db-roadmap-card-title").hover();
    const details = page.getByRole("tooltip", { name: "时间脉络详情", exact: true });
    await details.waitFor();
    assert.match(await details.innerText(), /功能冻结/);
    assert.match(await details.innerText(), new RegExp(day(38)));
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-entry-id="roadmap-plan"]')).opacity === "0.4");
    assert.equal(await node("roadmap-plan").evaluate((element) => getComputedStyle(element).opacity), "0.4");
    await screenshot("hover-light");
  });

  await check("Keyboard focus identifies the roadmap entry inside its drawing", async () => {
    const milestone = node("roadmap-freeze");
    for (const mode of ["light", "dark"]) {
      await theme(mode);
      await page.keyboard.press("Tab");
      await milestone.focus();
      const marker = await milestone.evaluate((element) => ({
        keyboard: element.matches(":focus-visible"),
        outline: getComputedStyle(element).outlineStyle,
        title: getComputedStyle(element.querySelector(".db-roadmap-card-title")).textDecorationLine,
      }));
      assert.deepEqual(marker, { keyboard: true, outline: "none", title: "underline" });
    }
  });

  await check("Clicking an entry opens its record page", async () => {
    await node("roadmap-freeze").locator(".db-roadmap-card-title").click();
    await page.getByRole("dialog", { name: "记录预览", exact: true }).getByRole("button", { name: "打开完整页面", exact: true }).click();
    await page.getByLabel("页面标题", { exact: true }).waitFor();
    assert.equal(await page.getByLabel("页面标题", { exact: true }).inputValue(), "功能冻结");
    await persisted((value) => value.ui.selectedPageId === "roadmap-record-freeze");
    await openRoadmap();
  });

  await check("Dragging a milestone changes its date by whole days and persists", async () => {
    const before = (await saved()).databaseItems.find((item) => item.id === "roadmap-freeze").values.time;
    const expected = new Date(Date.parse(`${before.start}T00:00:00Z`) + 3 * DAY).toISOString().slice(0, 10);
    await dragEntry("roadmap-freeze", 3, async () => {
      assert.equal(await roadmap.getAttribute("data-drag-delta"), "3");
      assert.deepEqual((await saved()).databaseItems.find((item) => item.id === "roadmap-freeze").values.time, before);
    });
    const state = await persisted((value, start) => value.databaseItems?.find((item) => item.id === "roadmap-freeze")?.values?.time?.start === start, expected);
    assert.deepEqual(state.databaseItems.find((item) => item.id === "roadmap-freeze").values.time, { ...before, start: expected });
    await page.reload({ waitUntil: "domcontentloaded" });
    await roadmap.waitFor();
    assert.equal((await saved()).databaseItems.find((item) => item.id === "roadmap-freeze").values.time.start, expected);
    const phaseBefore = (await saved()).databaseItems.find((item) => item.id === "roadmap-plan").values.time;
    await dragEntry("roadmap-plan", 2);
    const phaseExpected = new Date(Date.parse(`${phaseBefore.start}T00:00:00Z`) + 2 * DAY).toISOString().slice(0, 10);
    const phaseState = await persisted((value, start) => value.databaseItems?.find((item) => item.id === "roadmap-plan")?.values?.time?.start === start, phaseExpected);
    const phaseAfter = phaseState.databaseItems.find((item) => item.id === "roadmap-plan").values.time;
    assert.equal(Date.parse(phaseAfter.end) - Date.parse(phaseAfter.start), Date.parse(phaseBefore.end) - Date.parse(phaseBefore.start));
    assert.equal(phaseAfter.includeTime, phaseBefore.includeTime);
    assert.equal(phaseAfter.timeZone, phaseBefore.timeZone);
  });

  await check("Locked pages cannot drag", async () => {
    await lockPage(true);
    assert.equal(await roadmap.getAttribute("data-locked"), "true");
    const before = (await saved()).databaseItems.find((item) => item.id === "roadmap-freeze").values.time;
    await dragEntry("roadmap-freeze", 3);
    assert.deepEqual((await saved()).databaseItems.find((item) => item.id === "roadmap-freeze").values.time, before);
    assert.equal(await node("roadmap-freeze").locator("[data-drag-handle]").evaluate((element) => getComputedStyle(element).cursor), "not-allowed");
    await lockPage(false);
  });

  await check("Export produces a 3840 by 2160 png and a valid svg", async () => {
    mkdirSync(".qa/WP-09", { recursive: true });
    const externalRequests = [];
    const requestListener = (request) => { if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== "http://127.0.0.1:5178") externalRequests.push(request.url()); };
    page.on("request", requestListener);
    await theme("dark");
    await roadmap.getByRole("button", { name: "导出", exact: true }).click();
    const dialog = roadmap.getByRole("dialog", { name: "导出时间脉络", exact: true });
    for (const background of ["white", "transparent", "theme"]) {
      await dialog.getByLabel("时间脉络导出背景", { exact: true }).selectOption(background);
      const pngPromise = page.waitForEvent("download");
      await dialog.getByRole("button", { name: "下载 PNG", exact: true }).click();
      const pngDownload = await pngPromise;
      assert.match(pngDownload.suggestedFilename(), /^里程碑与阶段-时间脉络-\d{8}\.png$/);
      const pngPath = background === "white" ? ".qa/WP-09/export-sample.png" : `.qa/WP-09/export-${background}.png`;
      await pngDownload.saveAs(pngPath);
      const png = readFileSync(pngPath);
      assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      assert.equal(png.readUInt32BE(16), 3840);
      assert.equal(png.readUInt32BE(20), 2160);
      const corner = [...await sharp(png).ensureAlpha().extract({ left: 0, top: 0, width: 1, height: 1 }).raw().toBuffer()];
      assert.deepEqual(corner, background === "white" ? [255, 255, 255, 255] : background === "transparent" ? [0, 0, 0, 0] : [25, 25, 25, 255]);
      const svgPromise = page.waitForEvent("download");
      await dialog.getByRole("button", { name: "下载 SVG", exact: true }).click();
      const svgDownload = await svgPromise;
      const svgPath = `.qa/WP-09/export-${background}.svg`;
      await svgDownload.saveAs(svgPath);
      const svg = readFileSync(svgPath, "utf8");
      assert.ok(svg.includes('viewBox="0 0 1920 1080"'));
      for (const [, title] of definitions) assert.ok(svg.includes(title), title);
      assert.ok(!svg.includes("class=") && !svg.includes("var(--") && !svg.includes("url(http"));
      assert.equal(await page.evaluate((source) => new DOMParser().parseFromString(source, "image/svg+xml").querySelectorAll("parsererror").length, svg), 0);
    }
    await dialog.getByRole("button", { name: "关闭", exact: true }).click();
    page.off("request", requestListener);
    assert.deepEqual(externalRequests, []);
    await theme("light");
  });

  await check("Keyboard focus follows time order and Escape cancels a drag", async () => {
    const state = await saved();
    const expected = state.databaseItems.filter((item) => item.sourceId === "roadmap-source").sort((first, second) => Date.parse(first.values.time.start) - Date.parse(second.values.time.start) || first.id.localeCompare(second.id)).map((item) => item.id);
    assert.deepEqual(await roadmap.locator("[data-entry-id]").evaluateAll((elements) => elements.map((element) => element.dataset.entryId)), expected);
    await node(expected[0]).focus();
    for (const id of expected) {
      assert.equal(await page.evaluate(() => document.activeElement?.dataset.entryId), id);
      if (id !== expected.at(-1)) await page.keyboard.press("Tab");
    }
    const before = (await saved()).databaseItems.find((item) => item.id === "roadmap-freeze").values.time;
    await dragEntry("roadmap-freeze", 4, async () => { await page.keyboard.press("Escape"); assert.equal(await roadmap.getAttribute("data-dragging-entry"), ""); });
    assert.deepEqual((await saved()).databaseItems.find((item) => item.id === "roadmap-freeze").values.time, before);
    await node("roadmap-release").focus();
    await page.keyboard.press("Enter");
    await page.getByRole("dialog", { name: "记录预览", exact: true }).getByRole("button", { name: "打开完整页面", exact: true }).click();
    await page.getByLabel("页面标题", { exact: true }).waitFor();
    assert.equal(await page.getByLabel("页面标题", { exact: true }).inputValue(), "v1.0 发布");
    await openRoadmap();
  });

  await check("Empty states and the unscheduled list are shown", async () => {
    await settings(true);
    await panel.getByLabel("时间脉络日期属性", { exact: true }).selectOption("");
    await settings(false);
    await roadmap.getByText("选择一个日期属性来生成时间脉络", { exact: true }).waitFor();
    await persisted((value) => value.databaseViews?.find((entry) => entry.id === "roadmap-table")?.config?.roadmap?.datePropertyId === null);
    await roadmap.getByLabel("时间脉络日期属性", { exact: true }).selectOption("time");
    await database.getByRole("button", { name: "新建记录", exact: true }).click();
    await page.getByRole("dialog", { name: "记录预览", exact: true }).getByRole("button", { name: "关闭预览", exact: true }).click();
    await roadmap.locator(".db-roadmap-unscheduled summary").waitFor();
    assert.equal(await roadmap.locator(".db-roadmap-unscheduled summary").innerText(), "未排期 1 条");
    assert.equal(await roadmap.locator("[data-entry-id]").count(), 8);
    const state = await persisted((value) => value.databaseItems.filter((item) => item.sourceId === "roadmap-source").length === 9);
    const unscheduled = state.databaseItems.find((item) => item.sourceId === "roadmap-source" && !item.values.time);
    await roadmap.locator(".db-roadmap-unscheduled summary").click();
    await roadmap.locator(".db-roadmap-unscheduled").getByRole("button", { name: "无标题", exact: true }).click();
    await page.getByRole("dialog", { name: "记录预览", exact: true }).getByRole("button", { name: "打开完整页面", exact: true }).click();
    await persisted((value, id) => value.ui.selectedPageId === id, unscheduled.pageId);
    await openRoadmap();
  });

  await check("Five hundred entries render within budget", async () => {
    await sidebar.locator('.page-tree-row[title="500 条路线图"]').click();
    const bigDatabase = page.locator('section.database-view[data-source-id="roadmap-big-source"]');
    await bigDatabase.waitFor();
    const layoutPanel = await openViewSettingsSection(bigDatabase, "布局");
    const layout = layoutPanel.getByRole("button", { name: "布局 时间脉络", exact: true });
    assert.notEqual(await bigDatabase.getAttribute("data-view-type"), "roadmap");
    await layout.evaluate((button) => {
      window.wp09RenderMs = null;
      button.addEventListener("click", () => {
        const started = performance.now();
        const database = document.querySelector('section.database-view[data-source-id="roadmap-big-source"]');
        const observer = new MutationObserver(() => {
          if (database.querySelector('[data-testid="roadmap-view"]')?.querySelectorAll("[data-entry-id]").length === 500) {
            window.wp09RenderMs = performance.now() - started;
            observer.disconnect();
          }
        });
        observer.observe(database, { childList: true, subtree: true });
      }, { capture: true, once: true });
    });
    await layout.click();
    await page.waitForFunction(() => Number.isFinite(window.wp09RenderMs));
    const milliseconds = await page.evaluate(() => window.wp09RenderMs);
    console.log(`WP09_RENDER_MS=${milliseconds.toFixed(3)}`);
    assert.ok(milliseconds < 300, `500 entries rendered in ${milliseconds.toFixed(3)}ms`);
    assert.equal(await bigDatabase.getByTestId("roadmap-view").locator("[data-entry-id]").count(), 500);
    await setViewSettings(bigDatabase, false);
    await openRoadmap();
  });

  await page.mouse.move(250, 70);
  await page.locator(".workspace-scroll").evaluateAll((elements) => elements.forEach((element) => element.scrollTo(0, 0)));
  await page.evaluate(() => window.scrollTo(0, 0));
  await theme("light");
  const titleStyle = await page.getByLabel("页面标题", { exact: true }).evaluate((element) => ({ font: getComputedStyle(element).fontFamily, size: getComputedStyle(element).fontSize, weight: getComputedStyle(element).fontWeight }));
  assert.match(titleStyle.font, /^"Segoe UI Variable Text"/);
  assert.equal(titleStyle.size, "40px");
  assert.equal(titleStyle.weight, "700");
  assert.equal(await page.locator(".workspace-scroll").evaluate((element) => getComputedStyle(element).backgroundColor), "rgb(255, 255, 255)");
  assert.equal(await sidebar.evaluate((element) => getComputedStyle(element).backgroundColor), "rgb(247, 247, 245)");
  assert.equal(await roadmap.locator(".db-roadmap-tick-label").first().evaluate((element) => getComputedStyle(element).fontWeight), "600");
  assert.equal(await roadmap.locator(".db-roadmap-axis-past").evaluate((element) => getComputedStyle(element).strokeWidth), "3px");
  await screenshot("timeline-light");
  await theme("dark");
  assert.equal(await page.locator(".workspace-scroll").evaluate((element) => getComputedStyle(element).backgroundColor), "rgb(25, 25, 25)");
  assert.equal(await sidebar.evaluate((element) => getComputedStyle(element).backgroundColor), "rgb(32, 32, 32)");
  await screenshot("timeline-dark");
}, { workspace, viewport: { width: 1440, height: 900 } });
