import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { setTimeout as wait } from "node:timers/promises";
import { _electron } from "playwright";
import { assertPhysicalPath, isPathInside } from "../../electron/main/storage/dataRoot.js";
import { PACKAGED_EXE, REPO_ROOT, assertNoNetworkAndErrors, closeApp } from "./helpers.mjs";
import { serveMarketFixture, requestedPacks } from "./market-transport.mjs";
import { SAMPLE_TRIP } from "../../src/editor/widgets/trip-data/itineraryState.js";

const footprintTitle = "交互式足迹点亮地图";
const heatmapTitle = "习惯打卡热力日历图";
const itineraryTitle = "旅行计划与路线地图";

async function launch(dataRoot, scratch) {
  const ids = { LIFE_ATLAS_DATA_ROOT: dataRoot };
  for (const [key, name] of [["LIFE_ATLAS_BOOTSTRAP_DIR", "bootstrap"], ["TEMP", "temp"], ["APPDATA", "roaming"], ["LOCALAPPDATA", "local"]]) {
    ids[key] = assertPhysicalPath(path.join(scratch, name), { root: scratch });
    await fs.mkdir(ids[key], { recursive: true });
  }
  const env = { ...process.env, ...ids, TMP: ids.TEMP, LIFE_ATLAS_TEST: "1", LIFE_ATLAS_TEST_MARKET_TRANSPORT: "1" };
  for (const name of ["ELECTRON_RUN_AS_NODE", "LIFE_ATLAS_DEV_URL", "LIFE_ATLAS_DEV_SMOKE", "LIFE_ATLAS_TEST_DEFER_WORKSPACE_LOAD", "LIFE_ATLAS_TEST_CLOCK_MS"]) delete env[name];
  const app = await _electron.launch({
    executablePath: PACKAGED_EXE,
    cwd: REPO_ROOT,
    env,
    timeout: 30000,
    args: ["--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows"],
  });
  await serveMarketFixture(app);
  await app.evaluate(({ globalShortcut }) => globalShortcut.unregisterAll());
  const errors = { page: [], console: [] };
  const record = (win) => {
    win.on("pageerror", (error) => errors.page.push(error.message));
    win.on("console", (msg) => { if (msg.type() === "error") errors.console.push(msg.text()); });
  };
  app.on("window", record);
  for (const win of app.windows()) record(win);
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  await page.locator("html[data-la-ready]").waitFor();
  await page.setViewportSize({ width: 1440, height: 900 });
  return { app, page, errors };
}

function marketWorks(discovery) {
  return discovery.getByRole("list", { name: "市场作品列表", exact: true });
}

async function openMarket(page) {
  await page.locator(".workspace-sidebar").getByRole("button", { name: "模板与市场", exact: true }).click();
  const discovery = page.getByRole("region", { name: "模板与小组件市场", exact: true })
    .filter({ has: page.getByRole("navigation", { name: "市场导航", exact: true }) });
  await discovery.getByRole("status").filter({ hasText: /官方目录已同步|随附官方目录/u }).waitFor();
  await discovery.getByRole("tab", { name: "小组件市场", exact: true }).click();
  await discovery.getByRole("heading", { name: "小组件市场", exact: true }).waitFor();
  return discovery;
}

async function openMarketWork(page, discovery, title) {
  await marketWorks(discovery).getByRole("button", { name: title, exact: true }).click();
  return page.getByRole("region", { name: `${title} 详情`, exact: true });
}

test("v1.2.0 Market 2.0 dark picker, live playable sandbox, Footprint Map and Habit Heatmap persist across restart", { timeout: 120000 }, async (t) => {
  assert.equal(process.platform, "win32");
  await fs.access(PACKAGED_EXE);
  const outputRoot = assertPhysicalPath(process.env.LIFE_ATLAS_MARKET_NATIVE_QA_ROOT || path.join(REPO_ROOT, ".qa"));
  await fs.mkdir(outputRoot, { recursive: true });
  const evidence = await fs.mkdtemp(path.join(outputRoot, "v12-widgets-evidence-"));
  const scratch = await fs.mkdtemp(path.join(outputRoot, "v12-widgets-runtime-"));
  const dataRoot = path.join(scratch, "workspace");
  const handles = new Set();
  let finished = false;
  t.after(async () => {
    for (const h of handles) await closeApp(h, { keepDirs: true });
    if (finished && isPathInside(outputRoot, assertPhysicalPath(scratch))) {
      await fs.rm(scratch, { recursive: true, maxRetries: 5, retryDelay: 100 });
    }
  });
  console.log(`V12_WIDGETS_EVIDENCE ${evidence}`);
  let handle;
  try {
  handle = await launch(dataRoot, scratch);
  handles.add(handle);
  let { page } = handle;

  // Switch to dark theme so screenshots also verify dark Mobai visual parity
  await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
  await wait(150);

  // Browsing may load only the index and thumbnail. A selected download supplies the live preview.
  let discovery = await openMarket(page);
  assert.ok(await marketWorks(discovery).getByRole("listitem").count() >= 10);
  const footprintDetail = await openMarketWork(page, discovery, footprintTitle);
  await footprintDetail.getByRole("img", { name: `${footprintTitle}预览`, exact: true }).waitFor();
  assert.deepEqual(await requestedPacks(handle.app), []);
  assert.equal(await footprintDetail.locator("iframe").count(), 0);
  assert.deepEqual(await page.evaluate(async () => (await window.lifeAtlas.market.installed()).value.entries), []);
  await footprintDetail.getByRole("button", { name: "下载组件", exact: true }).click();
  await footprintDetail.getByText("官方签名已验证", { exact: true }).waitFor();
  const footprintPacks = await requestedPacks(handle.app);
  assert.equal(footprintPacks.length, 1);
  assert.match(footprintPacks[0], /travel-footprint/);
  await footprintDetail.getByRole("button", { name: "实时试玩", exact: true }).click();
  await footprintDetail.frameLocator("iframe").locator(".mw-fp-svg").waitFor();
  await page.screenshot({ path: path.join(evidence, "01-dark-market-footprint-live.png") });

  // Open independent full-canvas sandbox modal
  await footprintDetail.getByRole("button", { name: "独立大窗试玩", exact: true }).click();
  const sandboxDialog = page.getByRole("dialog", { name: `${footprintTitle} · 独立交互试玩`, exact: true });
  const sandbox = sandboxDialog.frameLocator("iframe");
  await sandbox.locator(".mw-fp-svg").waitFor();
  const atlas = sandbox.locator(".mw-fp-svg");
  assert.equal(await atlas.locator("path[data-region]").count(), 477);
  await atlas.getByText("南海诸岛", { exact: true }).waitFor();
  assert.equal(await atlas.locator('[data-region="city-510100"]').getAttribute("data-status"), "visited");
  assert.equal(await atlas.locator('[data-region="city-510700"]').getAttribute("data-status"), "unvisited");
  const mapSize = await atlas.boundingBox();
  const cardSize = await sandbox.locator(".mw-footprint").boundingBox();
  assert.ok(mapSize.width > cardSize.width * 0.89 && mapSize.height > 360, "the map occupies the full reading column");
  await sandbox.locator(".mw-footprint").screenshot({ path: path.join(evidence, "footprint-national-dark.png") });
  await sandbox.getByRole("button", { name: "放大地图" }).click();
  assert.equal(await atlas.getAttribute("data-zoomed"), "true");
  await sandbox.getByRole("button", { name: "地图恢复原始大小" }).click();
  await sandbox.getByLabel("搜索城市或景点").fill("九寨沟");
  await sandbox.locator(".mw-fp-search-pop button").first().click();
  await sandbox.getByRole("button", { name: "← 返回中国全景" }).waitFor();
  await sandbox.getByRole("heading", { name: "阿坝藏族羌族自治州" }).waitFor();
  assert.equal(await atlas.count(), 0, "the journal has its own view");
  await page.screenshot({ path: path.join(evidence, "02-dark-footprint-sandbox-modal.png") });
  await sandbox.getByRole("button", { name: "查看四川地图" }).click();
  assert.equal(await sandbox.getByLabel("地图范围").inputValue(), "cn-510000");
  assert.equal(await atlas.locator("path[data-region]").count(), 21);
  await sandbox.getByLabel("地图范围").selectOption("");
  await sandbox.getByLabel("地图范围").selectOption("pick");
  await atlas.getByRole("button", { name: "放大浙江地图" }).press("Enter");
  assert.equal(await sandbox.getByLabel("地图范围").inputValue(), "cn-330000");
  assert.equal(await atlas.locator("path[data-region]").count(), 11);
  await sandbox.getByLabel("地图范围").selectOption("");
  await page.evaluate(() => { document.documentElement.dataset.theme = "light"; });
  await sandbox.locator(".mw-footprint").screenshot({ path: path.join(evidence, "footprint-national-light.png") });
  await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
  await sandboxDialog.getByRole("button", { name: "返回市集" }).click();
  await sandboxDialog.waitFor({ state: "hidden" });

  // Verify custom dark Mobai target picker opens cleanly (zero native white Windows select!)
  await footprintDetail.getByText("官方签名已验证", { exact: true }).waitFor();
  const picker = footprintDetail.getByRole("combobox", { name: "组件目标页面" });
  await picker.click();
  const targetPages = footprintDetail.getByRole("listbox", { name: "组件目标页面", exact: true });
  await targetPages.waitFor();
  await page.screenshot({ path: path.join(evidence, "03-dark-mobai-target-picker.png") });
  await targetPages.getByRole("option").first().click();
  await footprintDetail.getByRole("button", { name: "插入组件", exact: true }).click();
  await footprintDetail.waitFor({ state: "hidden" });

  // 2. Insert Habit Heatmap onto the same page
  discovery = await openMarket(page);
  const heatmapDetail = await openMarketWork(page, discovery, heatmapTitle);
  await heatmapDetail.getByRole("button", { name: "下载组件", exact: true }).click();
  await heatmapDetail.getByText("官方签名已验证", { exact: true }).waitFor();
  await heatmapDetail.getByRole("button", { name: "插入组件", exact: true }).click();
  await heatmapDetail.waitFor({ state: "hidden" });

  // 3. Interact with both live widgets inside the page editor
  const fpWidget = page.frameLocator('iframe[title*="足迹"]').locator(".mw-footprint");
  const embeddedMap = page.locator('iframe[title*="足迹"]');
  await embeddedMap.scrollIntoViewIfNeeded();
  await fpWidget.getByLabel("搜索城市或景点").click();
  await page.keyboard.press("Tab");
  const frameFeedback = await embeddedMap.evaluate((frame) => {
    const style = getComputedStyle(frame);
    const block = frame.closest(".bn-block-outer");
    const tint = block && [...block.querySelectorAll(".ProseMirror-selectednode > .bn-block-content > *")].some((node) => {
      const layer = getComputedStyle(node, "::after");
      return !["none", "normal"].includes(layer.content) && (layer.boxShadow !== "none" || layer.backgroundColor !== "rgba(0, 0, 0, 0)");
    });
    return { focusInside: document.activeElement === frame, outline: style.outlineStyle, shadow: style.boxShadow, tintedParent: Boolean(tint) };
  });
  assert.deepEqual(frameFeedback, {focusInside:true, outline:"none", shadow:"none", tintedParent:false});
  assert.equal(await fpWidget.locator('[data-status="visited"]').count(), 0, "a new page does not inherit the market demo");
  await fpWidget.getByLabel("搜索城市或景点").fill("三亚");
  await fpWidget.locator(".mw-fp-search-pop button").first().click();
  await fpWidget.getByRole("button", { name: "已点亮", exact: true }).click();
  await fpWidget.locator(".mw-textarea").fill("三亚海滩超蓝，1.2.0 持久化验收通过");
  await fpWidget.getByRole("button", { name: "← 返回中国全景" }).click();
  assert.equal(await fpWidget.locator('[data-region="city-460200"]').getAttribute("data-status"), "visited");
  assert.equal(await fpWidget.locator('[data-region="city-460100"]').getAttribute("data-status"), "unvisited");

  const hmWidget = page.frameLocator('iframe[title*="习惯"]').locator(".mw-heatmap");
  await page.locator('iframe[title*="习惯"]').scrollIntoViewIfNeeded();
  await hmWidget.getByRole("button", { name: /\+ 今日打卡/ }).click();
  const habits = [["键盘添加散步", true], ["点击添加读书", false]];
  for (const [name, keyboard] of habits) {
    await hmWidget.getByRole("button", { name: "+ 新习惯", exact: true }).click();
    const field = hmWidget.getByPlaceholder(/输入习惯名称/);
    await field.fill(name);
    if (keyboard) await field.press("Enter");
    else await hmWidget.getByRole("button", { name: "添加", exact: true }).click();
    const chip = hmWidget.getByRole("button", { name, exact: true });
    await chip.waitFor();
    assert.equal(await chip.count(), 1);
    assert.equal(await field.count(), 0);
  }
  await wait(800);
  await page.screenshot({ path: path.join(evidence, "04-editor-both-widgets-dark.png") });

  await assertNoNetworkAndErrors(handle);
  await closeApp(handle, { keepDirs: true });
  handles.delete(handle);

  // 4. Relaunch packaged app and verify both widgets and edited states persisted cleanly
  handle = await launch(dataRoot, scratch);
  handles.add(handle);
  page = handle.page;
  await handle.app.evaluate(() => { globalThis.marketTestOnline = false; });
  const restoredFp = page.frameLocator('iframe[title*="足迹"]').locator(".mw-footprint");
  await page.locator('iframe[title*="足迹"]').scrollIntoViewIfNeeded();
  await restoredFp.getByLabel("搜索城市或景点").fill("三亚");
  await restoredFp.locator(".mw-fp-search-pop button").first().click();
  assert.equal(await restoredFp.locator(".mw-textarea").inputValue(), "三亚海滩超蓝，1.2.0 持久化验收通过");
  const restoredHeatmap = page.frameLocator('iframe[title*="习惯"]').getByRole("group", { name: "选择习惯", exact: true });
  for (const [name] of habits) await restoredHeatmap.getByRole("button", { name, exact: true }).waitFor();
  assert.deepEqual(await requestedPacks(handle.app), []);
  await handle.app.evaluate(() => { globalThis.marketTestOnline = true; });
  discovery = await openMarket(page);
  let itineraryDetail = await openMarketWork(page, discovery, itineraryTitle);
  await itineraryDetail.getByRole("button", { name: "下载组件", exact: true }).click();
  await itineraryDetail.getByRole("button", { name: "独立大窗试玩", exact: true }).click();
  const tripDialog = page.getByRole("dialog", { name: `${itineraryTitle} · 独立交互试玩`, exact: true });
  const trip = tripDialog.frameLocator("iframe");
  await trip.locator(".trip-map .trip-path").first().waitFor();
  assert.equal(await trip.locator(".trip-path").count(), 3);
  const routeMap = trip.locator(".trip-map.leaflet-container");
  await routeMap.click({ position: { x: 85, y: 65 } });
  await routeMap.press("Tab");
  await routeMap.focus();
  const mapFocus = await routeMap.evaluate((element) => {
    const { outlineStyle, outlineWidth } = getComputedStyle(element);
    return { keyboard: element.matches(":focus-visible"), outlineStyle, outlineWidth: parseFloat(outlineWidth) };
  });
  assert.ok(mapFocus.keyboard && mapFocus.outlineStyle === "solid" && mapFocus.outlineWidth >= 2, JSON.stringify(mapFocus));
  assert.ok((await trip.locator(".trip-path").first().getAttribute("d")).split("L").length > 2);
  await trip.getByRole("button", { name: "A → B 路线 ›", exact: true }).click();
  const leg = trip.getByRole("region", { name: "单段路线详情", exact: true });
  const routeSummary = leg.locator(".trip-route-info strong");
  const car = await routeSummary.innerText();
  await leg.getByRole("button", { name: "骑行", exact: true }).click();
  await leg.getByText(/^示例道路快照 · 骑行/u).waitFor();
  assert.notEqual(await routeSummary.innerText(), car);
  await trip.locator(".trip-map-shell").screenshot({ path: path.join(evidence, "itinerary-kyoto.png") });
  await leg.getByRole("button", { name: "公交地铁", exact: true }).click();
  await leg.getByText("暂无此段公交方案", { exact: true }).waitFor();
  await trip.locator(".trip-path").first().waitFor({ state: "detached" });
  await leg.getByRole("button", { name: "‹ 返回旅行计划", exact: true }).click();
  await trip.getByText("更多地图与导出", { exact: true }).click();
  await trip.getByText("Google 地图", { exact: true }).click();
  assert.match(await trip.getByRole("link", { name: /Google 地图/ }).first().getAttribute("href"), /travelmode=transit/);
  await tripDialog.getByRole("button", { name: "返回市集", exact: true }).click();
  await tripDialog.waitFor({ state: "hidden" });
  await itineraryDetail.getByRole("button", { name: "返回市场", exact: true }).click();
  const restoredFootprintDetail = await openMarketWork(page, discovery, footprintTitle);
  const installedBefore = await page.evaluate(async () => (await window.lifeAtlas.market.installed()).value);
  const mapPackage = installedBefore.entries.find((entry) => entry.id === "life-atlas.travel-footprint");
  assert.ok(mapPackage);
  await restoredFootprintDetail.getByRole("button", { name: "移除下载", exact: true }).click();
  await restoredFootprintDetail.getByRole("button", { name: "确认移除", exact: true }).click();
  await restoredFootprintDetail.getByRole("button", { name: "下载组件", exact: true }).waitFor();
  const installedAfter = await page.evaluate(async () => (await window.lifeAtlas.market.installed()).value);
  assert.equal(installedBefore.totalBytes - installedAfter.totalBytes, mapPackage.size);
  assert.deepEqual(installedAfter.entries.map((entry) => entry.id).sort(), ["life-atlas.habit-heatmap", "life-atlas.trip-itinerary"]);
  const readCityRecord = () => page.evaluate(async () => (await window.lifeAtlas.workspace.load()).value.workspace.pages
    .flatMap((entry) => entry.content || []).find((block) => block.props?.packageId === "life-atlas.travel-footprint")?.props.state);
  const beforeReinstall = await readCityRecord();
  assert.match(beforeReinstall, /三亚海滩超蓝/);
  await restoredFootprintDetail.getByRole("button", { name: "下载组件", exact: true }).click();
  await restoredFootprintDetail.getByText("官方签名已验证", { exact: true }).waitFor();
  await restoredFootprintDetail.getByRole("button", { name: "返回市场", exact: true }).click();
  await discovery.waitFor();
  await page.locator(".workspace-topbar").getByRole("button", { name: "后退", exact: true }).click();
  await restoredFp.locator("path[data-region]").first().waitFor();
  assert.equal(await readCityRecord(), beforeReinstall);
  assert.equal(await restoredFp.locator('[data-region="city-460200"]').getAttribute("data-status"), "visited");
  discovery = await openMarket(page);
  itineraryDetail = await openMarketWork(page, discovery, itineraryTitle);
  await itineraryDetail.getByRole("button", { name: "插入组件", exact: true }).click();
  await itineraryDetail.waitFor({ state: "hidden" });
  const ownTrip = page.frameLocator(`iframe[title="${itineraryTitle}"]`).locator(".mw-itinerary");
  await ownTrip.getByRole("button", { name: "＋ 添加站点" }).waitFor();
  assert.equal(await ownTrip.locator(".mw-stop").count(), 0);
  const demoDay = SAMPLE_TRIP.days.find((day) => day.day === SAMPLE_TRIP.activeDay);
  for (const [index, stop] of demoDay.stops.entries()) {
    const name = "我的京都站点 " + (index + 1);
    await ownTrip.getByRole("button", { name: "＋ 添加站点" }).click();
    await ownTrip.getByLabel("景点或地址").fill(name);
    await ownTrip.getByLabel("纬度，经度（WGS84）").fill(stop.point.join(", "));
    await ownTrip.getByRole("button", { name: "保存站点" }).click();
    await ownTrip.getByRole("button", { name: "标记 " + name, exact: true }).waitFor();
  }
  assert.equal(await ownTrip.locator(".trip-path").count(), 0, "a personal itinerary never inherits the demo's route");
  await ownTrip.locator(".trip-map-attribution").getByText("尚未取得道路轨迹", { exact: true }).waitFor();
  await fs.writeFile(path.join(evidence, "download-evidence.json"), JSON.stringify({ beforeFirstDownload: [], firstDownload: footprintPacks,
    downloadBytes: mapPackage.size, installedBeforeRemoval: installedBefore.totalBytes, installedAfterRemoval: installedAfter.totalBytes,
    offlineRestartDownloadedPacks: 0, restoredCityRecord: true, personalStopsAtDemoCoordinates: demoDay.stops.length, implicitRoutes: 0 }, null, 2));
  await assertNoNetworkAndErrors(handle);
  finished = true;
  } catch (err) {
    console.error("V12_ERROR:", err?.stack || err);
    console.error("V12_PAGE_ERRORS:", handle?.errors);
    throw err;
  }
});
