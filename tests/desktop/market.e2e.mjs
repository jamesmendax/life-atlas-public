import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { setTimeout as wait } from "node:timers/promises";
import { _electron } from "playwright";
import { assertPhysicalPath, isPathInside } from "../../electron/main/storage/dataRoot.js";
import { createBackupService } from "../../electron/main/backup/index.js";
import { createDesktopBackupContext } from "./backup-helpers.mjs";
import { PACKAGED_EXE, REPO_ROOT, assertNoNetworkAndErrors, closeApp, openPageInSidebar, queueDialogResponse, readDialogCalls } from "./helpers.mjs";
import { marketFixture, requestedPacks, serveMarketFixture } from "./market-transport.mjs";

const templateTitle = "专注学习页";
const widgetTitle = "番茄钟";
const timerFrames = (page) => page.locator(`iframe[title="${widgetTitle}"][src^="life-widget://"]`);
const timerCard = (frames, index) => frames.nth(index).contentFrame().getByRole("region", { name: widgetTitle, exact: true });

async function launch(dataRoot, scratch) {
  const ids = { LIFE_ATLAS_DATA_ROOT: dataRoot };
  for (const [key, name] of [["LIFE_ATLAS_BOOTSTRAP_DIR", "bootstrap"], ["TEMP", "temp"], ["APPDATA", "roaming"], ["LOCALAPPDATA", "local"]]) {
    ids[key] = assertPhysicalPath(path.join(scratch, name), { root: scratch });
    await fs.mkdir(ids[key], { recursive: true });
  }
  const env = { ...process.env, ...ids, TMP: ids.TEMP, LIFE_ATLAS_TEST: "1", LIFE_ATLAS_TEST_MARKET_TRANSPORT: "1" };
  for (const name of ["ELECTRON_RUN_AS_NODE", "LIFE_ATLAS_DEV_URL", "LIFE_ATLAS_DEV_SMOKE", "LIFE_ATLAS_TEST_DEFER_WORKSPACE_LOAD", "LIFE_ATLAS_TEST_CLOCK_MS"]) delete env[name];
  const app = await _electron.launch({
    executablePath: PACKAGED_EXE, cwd: REPO_ROOT, env, timeout: 30000,
    args: ["--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows"],
  });
  const errors = { page: [], console: [] };
  const record = (window) => {
    window.on("pageerror", (error) => errors.page.push(error.message));
    window.on("console", (message) => { if (message.type() === "error") errors.console.push(message.text()); });
  };
  const handle = { app, errors };
  let attested = false;
  try {
    const identity = await app.evaluate(({ app }) => ({ pid: process.pid, profile: app.getPath("userData"), executable: process.execPath }));
    assert.equal(path.resolve(identity.profile), path.join(dataRoot, "runtime"));
    assert.equal(path.resolve(identity.executable), PACKAGED_EXE);
    attested = true;
    await app.evaluate(({ globalShortcut }) => globalShortcut.unregisterAll());
    app.on("window", record);
    for (const window of app.windows()) record(window);
    const page = await app.firstWindow();
    handle.page = page;
    page.setDefaultTimeout(15000);
    await page.locator("html[data-la-ready]").waitFor();
    await serveMarketFixture(app);
    await page.setViewportSize({ width: 1440, height: 900 });
    const info = await page.evaluate(() => window.lifeAtlas.app.getInfo());
    assert.equal(info.ok, true, info.error?.message);
    assert.equal(info.value.isPackaged, true);
    assert.equal(info.value.flavor, "test");
    handle.version = info.value.appVersion;
    assert.equal(path.resolve(info.value.dataRoot), dataRoot);
    console.log(`NATIVE_MARKET_LAUNCH ${JSON.stringify({ ...identity, version: info.value.appVersion, electron: info.value.versions.electron, dataRoot })}`);
    return handle;
  } catch (error) {
    if (attested && handle.page && !handle.page.isClosed()) console.log("NATIVE_MARKET_STARTUP", await handle.page.title(), await handle.page.locator("body").innerText());
    await closeApp(handle, { keepDirs: true });
    throw error;
  }
}

function marketDiscovery(page) {
  return page.getByRole("region", { name: "模板与小组件市场", exact: true })
    .filter({ has: page.getByRole("navigation", { name: "市场导航", exact: true }) });
}

function marketDetail(page, title) {
  return page.getByRole("region", { name: `${title} 详情`, exact: true });
}

function marketCard(discovery, title) {
  return discovery.getByRole("list", { name: "市场作品列表", exact: true })
    .getByRole("button", { name: title, exact: true });
}

function topbarButton(page, name) {
  return page.locator(".workspace-topbar").getByRole("button", { name, exact: true });
}

async function openMarket(page, catalogueStatus = /官方目录已同步/u) {
  await page.locator(".workspace-sidebar").getByRole("button", { name: "模板与市场", exact: true }).click();
  const discovery = marketDiscovery(page);
  await discovery.getByRole("status").filter({ hasText: catalogueStatus }).waitFor();
  return discovery;
}

async function decodeImage(image) {
  await image.scrollIntoViewIfNeeded();
  return image.evaluate(async (node) => {
    await node.decode();
    return { width: node.naturalWidth, height: node.naturalHeight, source: node.currentSrc.replace(/^data:[\s\S]+$/, "data:image/png") };
  });
}

async function loadWorkspace(page) {
  const loaded = await page.evaluate(() => window.lifeAtlas.workspace.load());
  assert.equal(loaded.ok, true, loaded.error?.message);
  return loaded.value.workspace;
}

async function waitForStoredWidgets(page, verify) {
  const deadline = Date.now() + 15000;
  let stored = [];
  while (Date.now() < deadline) {
    const workspace = await loadWorkspace(page);
    const selected = workspace.pages.find((p) => p.title === templateTitle);
    stored = (selected?.content ?? []).filter((block) => block.type === "marketComponent")
      .map(({ id, props }) => ({ id, asset: props.url, state: JSON.parse(props.state) }));
    if (stored.length === 2 && verify(stored.map(({ state }) => state))) return stored;
    await wait(200);
  }
  assert.fail(`Timer states did not reach the workspace store: ${JSON.stringify(stored)}`);
}

function waitForClock(widget, time) {
  return widget.locator(`[role="timer"][data-time=${JSON.stringify(time)}]`).waitFor();
}

async function observePlayback(page) {
  await page.evaluate(() => {
    window.marketMedia = [];
    const soundFiles = new Map();
    const create = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (value) => { const url = create(value); soundFiles.set(url, value); return url; };
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      const observed = { element: this, source: this.src, volume: this.volume, file: soundFiles.get(this.src), acknowledged: false };
      window.marketMedia.push(observed);
      const playback = play.call(this);
      void playback.then(() => { observed.acknowledged = true; }, () => {});
      return playback;
    };
  });
}

async function waitForPlayback(page, source, volume, expectedBlob) {
  await page.waitForFunction((source) => window.marketMedia.some((event) => event.source.includes(source)
    && event.acknowledged && event.element.currentTime > 0), source, { timeout: 5000 });
  const observed = await page.evaluate((source) => window.marketMedia
    .filter((event) => event.source.includes(source) && event.acknowledged)
    .map((event) => ({ source: event.source, volume: event.volume })), source);
  assert.equal(observed.length, 1);
  assert.equal(observed[0].volume, volume);
  if (expectedBlob) {
    const hash = await page.evaluate(async (source) => {
      const event = window.marketMedia.find((item) => item.source.includes(source) && item.acknowledged);
      if (!event?.file) return null;
      const digest = await crypto.subtle.digest("SHA-256", await event.file.arrayBuffer());
      return Array.from(new Uint8Array(digest), (n) => n.toString(16).padStart(2, "0")).join("");
    }, source);
    assert.equal(hash, expectedBlob);
  }
  return observed[0].source;
}

test("packaged Windows market imports the official learning page and persists two independent timers and alarm settings", { timeout: 120000 }, async (t) => {
  assert.equal(process.platform, "win32", "The packaged market scenario requires Windows");
  await fs.access(PACKAGED_EXE);
  const outputRoot = assertPhysicalPath(process.env.LIFE_ATLAS_MARKET_NATIVE_QA_ROOT || path.join(REPO_ROOT, ".qa"));
  await fs.mkdir(outputRoot, { recursive: true });
  const evidence = await fs.mkdtemp(path.join(outputRoot, "native-market-evidence-"));
  const scratch = await fs.mkdtemp(path.join(outputRoot, "native-market-runtime-"));
  const dataRoot = path.join(scratch, "workspace");
  const handles = new Set();
  let finished = false;
  t.after(async () => {
    for (const handle of handles) await closeApp(handle, { keepDirs: true });
    if (finished && process.env.LIFE_ATLAS_MARKET_NATIVE_KEEP_DATA !== "1" && isPathInside(outputRoot, assertPhysicalPath(scratch))) {
      await fs.rm(scratch, { recursive: true, maxRetries: 5, retryDelay: 100 });
    }
  });
  console.log(`NATIVE_MARKET_EVIDENCE ${evidence}`);
  console.log(`NATIVE_MARKET_RUNTIME ${scratch}`);
  const catalog = JSON.parse(await fs.readFile(path.join(marketFixture, "catalog-v2.json"), "utf8"));
  const localEntry = catalog.entries.find((entry) => entry.id === "life-atlas.pomodoro");
  const templateEntry = catalog.entries.find((entry) => entry.title === templateTitle);
  assert.ok(localEntry && templateEntry, "The publication fixture must serve both selected signed packages");
  const localPack = path.join(scratch, "local-pomodoro.atlaspack");
  await fs.copyFile(assertPhysicalPath(path.join(marketFixture, localEntry.packagePath), { root: marketFixture, allowMissing: false }), localPack);

  let handle = await launch(dataRoot, scratch);
  handles.add(handle);
  let page = handle.page;
  let discovery = await openMarket(page);
  const studyCard = marketCard(discovery, templateTitle);
  await page.keyboard.press("Tab");
  await studyCard.focus();
  const indicator = await studyCard.evaluate((element) => ({
    keyboard: element.matches(":focus-visible"),
    outline: getComputedStyle(element).outlineStyle,
    width: parseFloat(getComputedStyle(element).outlineWidth),
  }));
  assert.ok(indicator.keyboard && indicator.outline !== "none" && indicator.width > 0, JSON.stringify(indicator));
  await studyCard.press("Enter");
  const studyDetail = marketDetail(page, templateTitle);
  const preview = await decodeImage(studyDetail.getByRole("img", { name: "专注学习页预览", exact: true }));
  assert.ok(preview.width > 0 && preview.height > 0);
  assert.equal(preview.source, "data:image/png");
  assert.deepEqual(await requestedPacks(handle.app), []);
  await studyDetail.getByRole("button", { name: "下载模板", exact: true }).click();
  await studyDetail.getByText("官方签名已验证", { exact: true }).waitFor();
  assert.deepEqual(await requestedPacks(handle.app), [templateEntry.packagePath]);
  assert.deepEqual(await decodeImage(studyDetail.getByRole("img", { name: "专注学习页预览", exact: true })), preview);
  await page.screenshot({ path: path.join(evidence, "01-market-preview.png") });
  assert.ok(await studyDetail.getByRole("combobox", { name: "模板目标文件夹" }).getAttribute("data-value"));
  await studyDetail.getByRole("button", { name: "使用模板", exact: true }).click();
  await studyDetail.waitFor({ state: "hidden" });
  assert.equal(await page.getByLabel("页面标题", { exact: true }).inputValue(), templateTitle);
  const studyImage = page.locator('img[src^="life-asset://"]').first();
  const importedImage = await decodeImage(studyImage);
  assert.match(importedImage.source, /^life-asset:\/\/[a-f0-9]{64}\/?$/u);
  assert.ok(importedImage.width > 0 && importedImage.height > 0);
  assert.equal(await page.locator(".life-editor .ProseMirror-selectednode").count(), 0, "Opening the study template selected its first image");
  await page.screenshot({ path: path.join(evidence, "02-imported-learning-page.png") });
  await studyImage.click();
  const selectedPhoto = page.locator(".life-editor .node-image.ProseMirror-selectednode");
  await selectedPhoto.waitFor();
  const paintedOverlay = await selectedPhoto.evaluate((node) => {
    const outline = getComputedStyle(node);
    return (outline.outlineStyle !== "none" && parseFloat(outline.outlineWidth) > 0)
      || [...node.querySelectorAll(".bn-block-content > *")].some((child) => {
        const layer = getComputedStyle(child, "::after");
        return !["none", "normal"].includes(layer.content)
          && (layer.boxShadow !== "none" || layer.backgroundColor !== "rgba(0, 0, 0, 0)");
      });
  });
  assert.equal(paintedOverlay, false, "Clicking an image painted an outline or a tint over its content");
  await page.screenshot({ path: path.join(evidence, "02b-selected-learning-image.png") });

  discovery = await openMarket(page);
  await marketCard(discovery, widgetTitle).click();
  const timerDetail = marketDetail(page, widgetTitle);
  await timerDetail.waitFor();
  await topbarButton(page, "后退").click();
  await discovery.waitFor();
  await topbarButton(page, "后退").click();
  assert.equal(await page.getByLabel("页面标题", { exact: true }).inputValue(), templateTitle);
  await topbarButton(page, "前进").click();
  await discovery.waitFor();
  await topbarButton(page, "前进").click();
  await timerDetail.waitFor();
  await timerDetail.getByRole("button", { name: "返回市场", exact: true }).click();
  await discovery.waitFor();
  await topbarButton(page, "前进").click();
  await timerDetail.waitFor();

  const timerImage = timerDetail.getByRole("img", { name: "番茄钟预览", exact: true });
  const timerPreview = await fs.readFile(path.join(marketFixture, localEntry.previewPath));
  const timerPreviewSource = "data:image/png;base64," + timerPreview.toString("base64");
  assert.equal(await timerImage.getAttribute("src"), timerPreviewSource);
  assert.ok((await decodeImage(timerImage)).width > 0);
  assert.deepEqual(await requestedPacks(handle.app), [templateEntry.packagePath]);
  assert.equal(await timerDetail.locator("iframe").count(), 0);
  await timerDetail.getByRole("button", { name: "下载组件", exact: true }).click();
  await timerDetail.getByText("官方签名已验证", { exact: true }).waitFor();
  const selectedDownloads = [templateEntry.packagePath, localEntry.packagePath];
  assert.deepEqual(await requestedPacks(handle.app), selectedDownloads);
  await timerDetail.getByRole("button", { name: "实时试玩", exact: true }).click();
  await waitForClock(timerCard(timerFrames(timerDetail), 0), "25:00");
  await page.screenshot({ path: path.join(evidence, "01b-market-live-preview.png") });
  await timerDetail.getByRole("button", { name: "预览图", exact: true }).click();
  await timerDetail.locator("iframe").waitFor({ state: "detached" });
  assert.equal(await timerDetail.getByRole("combobox", { name: "组件目标页面" }).locator(".mb-target-trigger-text").innerText(), templateTitle);
  await timerDetail.getByRole("button", { name: "插入组件" }).click();
  await timerDetail.waitFor({ state: "hidden" });
  let timers = timerFrames(page);
  let first = timerCard(timers, 0);
  await timers.first().scrollIntoViewIfNeeded();
  await waitForClock(first, "25:00");
  await page.mouse.move(0, 0);
  await first.screenshot({ path: path.join(evidence, "06-pomodoro-market-card.png"), animations: "disabled" });
  await first.getByRole("button", { name: "开始专注", exact: true }).click();
  await first.locator('[role="timer"][data-time^="24:"]').waitFor();
  await page.screenshot({ path: path.join(evidence, "03-running-pomodoro.png") });
  await first.getByRole("button", { name: "暂停", exact: true }).click();
  await first.getByRole("button", { name: "继续", exact: true }).waitFor();
  const pausedClock = await first.getByRole("timer").getAttribute("data-time");

  discovery = await openMarket(page);
  await queueDialogResponse(handle, "showOpenDialog", [localPack]);
  await discovery.getByRole("button", { name: "导入本地包", exact: true }).click();
  await timerDetail.getByText("官方签名已验证", { exact: true }).waitFor();
  await timerDetail.getByRole("heading", { name: widgetTitle, exact: true }).waitFor();
  await timerDetail.getByRole("button", { name: "插入组件" }).click();
  await timerDetail.waitFor({ state: "hidden" });
  await timers.nth(1).waitFor();
  assert.equal(await timers.count(), 2);
  assert.deepEqual(await requestedPacks(handle.app), selectedDownloads);
  const localDialog = (await readDialogCalls(handle)).findLast((call) => call.kind === "showOpenDialog");
  assert.deepEqual(localDialog?.response?.filePaths, [localPack]);
  assert.deepEqual(localDialog?.options?.filters?.[0]?.extensions, ["atlaspack"]);
  const second = timerCard(timers, 1);
  await timers.nth(1).scrollIntoViewIfNeeded();
  await waitForClock(second, "25:00");
  await second.getByRole("button", { name: "短休息 5 分", exact: true }).click();
  await waitForClock(second, "05:00");
  await timers.first().scrollIntoViewIfNeeded();
  await waitForClock(first, pausedClock);

  const original = await waitForStoredWidgets(page, ([focus, rest]) => focus.paused && rest.phase === "break");
  assert.equal(original[0].state.endsAt, null);
  assert.ok(original[0].state.remaining < 25 * 60_000);
  assert.equal(original[1].state.endsAt, null);
  assert.equal(original[1].state.remaining, 300000);
  assert.equal(original[1].state.settings.finishUrl, "");

  const wav = await fs.readFile(path.join(REPO_ROOT, "market", "official", "pomodoro", "assets", "standard-alarm.wav"));
  const alarmName = "桌面验收自选铃声.wav";
  const alarmHash = createHash("sha256").update(wav).digest("hex");
  const alarmUrl = `life-asset://${alarmHash}`;
  const alarmPath = assertPhysicalPath(path.join(dataRoot, "assets", alarmHash.slice(0, 2), alarmHash), { root: dataRoot });
  const firstDocument = await (await timers.first().elementHandle()).contentFrame();
  await observePlayback(firstDocument);
  await first.getByRole("button", { name: "番茄钟设置", exact: true }).click();
  const settings = timers.first().contentFrame().getByRole("dialog", { name: "番茄钟设置", exact: true });
  await settings.getByText("默认闹铃", { exact: true }).waitFor();
  await settings.getByRole("radio", { name: "竖排", exact: true }).check();
  await settings.getByRole("spinbutton", { name: "专注时长", exact: true }).fill("1");
  await settings.getByRole("slider", { name: "结束铃声音量", exact: true }).fill("73");
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    settings.getByRole("button", { name: "选择音频", exact: true }).click(),
  ]);
  await chooser.setFiles({ name: alarmName, mimeType: "audio/wav", buffer: wav });
  await settings.getByText(alarmName, { exact: true }).waitFor();
  await settings.getByRole("button", { name: "试听结束铃声", exact: true }).click();
  const previewAlarmSource = await waitForPlayback(firstDocument, "blob:", 0.73, alarmHash);
  await settings.getByRole("button", { name: "停止结束铃声", exact: true }).click();
  await page.screenshot({ path: path.join(evidence, "05-pomodoro-settings.png") });
  await settings.getByRole("button", { name: "保存", exact: true }).click();
  await settings.waitFor({ state: "hidden" });
  await first.getByRole("button", { name: "番茄钟设置", exact: true }).click();
  const restMinutes = settings.getByRole("spinbutton", { name: "短休息时长", exact: true });
  await restMinutes.fill("0");
  await restMinutes.press("Enter");
  assert.equal(await settings.isVisible(), true);
  assert.equal(await restMinutes.evaluate((input) => input.validity.customError), true);
  await restMinutes.fill("6");
  await restMinutes.press("Enter");
  await settings.waitFor({ state: "hidden" });
  await waitForClock(first, pausedClock);
  const saved = await waitForStoredWidgets(page, ([focus]) => focus.settings.finishUrl === alarmUrl && focus.settings.restMinutes === 6);
  assert.notEqual(saved[0].id, saved[1].id);
  assert.equal(saved[0].asset, saved[1].asset);
  assert.deepEqual(saved[1], original[1]);
  assert.equal(saved[0].state.settings.finishName, alarmName);
  assert.equal(saved[0].state.settings.focusMinutes, 1);
  assert.equal(saved[0].state.settings.face, "vertical");
  assert.equal(saved[0].state.settings.finishVolume, 73);
  assert.equal(saved[0].state.remaining, original[0].state.remaining);
  assert.equal(saved[0].state.paused, true);
  assert.deepEqual(await fs.readFile(alarmPath), wav);

  const backupPath = path.join(scratch, "pomodoro-copy.lifeatlas");
  await queueDialogResponse(handle, "showSaveDialog", { canceled: false, filePath: backupPath });
  const exported = await page.evaluate(() => window.lifeAtlas.backup.exportFull({ includeVault: false, encryptPassword: null }));
  assert.equal(exported.ok, true, exported.error?.message);
  const destination = await createDesktopBackupContext(t, { seed: false, appVersion: handle.version });
  const importer = createBackupService(destination);
  t.after(() => importer.stop());
  const inspected = await importer.inspectFile(backupPath);
  await importer.restore({ token: inspected.token, restoreVault: false });
  const restoredPage = destination.workspaceService.readWorkspace().pages.find((entry) => entry.title === templateTitle);
  const restoredWidget = restoredPage?.content.find((entry) => entry.id === saved[0].id);
  assert.deepEqual(JSON.parse(restoredWidget?.props.state), saved[0].state);
  assert.deepEqual(await fs.readFile(destination.assetStore.filePath(alarmHash)), wav);
  assert.deepEqual(await fs.readFile(destination.assetStore.filePath(localEntry.sha256)), await fs.readFile(localPack));

  const beforeMarket = await loadWorkspace(page);
  discovery = await openMarket(page);
  await marketCard(discovery, widgetTitle).click();
  await timerDetail.getByRole("button", { name: "插入组件", exact: true }).waitFor();
  await topbarButton(page, "切换白天/夜间").click();
  await page.waitForFunction(async (previousTheme) => {
    const result = await window.lifeAtlas.workspace.load();
    return result.ok && result.value.workspace.ui.preferences.theme !== previousTheme;
  }, beforeMarket.ui.preferences.theme, { polling: 200 });
  assert.equal((await loadWorkspace(page)).ui.activeSection, "private");

  await assertNoNetworkAndErrors(handle);
  await closeApp(handle, { keepDirs: true });
  handles.delete(handle);

  handle = await launch(dataRoot, scratch);
  handles.add(handle);
  page = handle.page;
  await handle.app.evaluate(() => { globalThis.marketTestOnline = false; });
  assert.equal((await loadWorkspace(page)).ui.activeSection, "private");
  assert.equal(await page.getByLabel("页面标题", { exact: true }).inputValue(), templateTitle);
  assert.equal(await topbarButton(page, "后退").isDisabled(), true);
  assert.equal(await topbarButton(page, "前进").isDisabled(), true);

  const offlineDiscovery = await openMarket(page, /随附官方目录/u);
  await offlineDiscovery.getByRole("tab", { name: /^已下载/u }).click();
  await marketCard(offlineDiscovery, widgetTitle).click();
  const offlineTimerDetail = marketDetail(page, widgetTitle);
  await offlineTimerDetail.getByRole("button", { name: "插入组件", exact: true }).waitFor();
  assert.equal(await offlineTimerDetail.getByRole("img", { name: "番茄钟预览", exact: true }).getAttribute("src"), timerPreviewSource);
  assert.deepEqual(await requestedPacks(handle.app), []);
  await offlineTimerDetail.getByRole("button", { name: "返回市场", exact: true }).click();
  await offlineDiscovery.waitFor();
  await topbarButton(page, "后退").click();
  assert.equal(await page.getByLabel("页面标题", { exact: true }).inputValue(), templateTitle);

  timers = timerFrames(page);
  first = timerCard(timers, 0);
  await timers.first().scrollIntoViewIfNeeded();
  await waitForClock(first, pausedClock);
  await first.getByRole("button", { name: "继续", exact: true }).waitFor();
  const restoredSecond = timerCard(timers, 1);
  await timers.nth(1).scrollIntoViewIfNeeded();
  await waitForClock(restoredSecond, "05:00");
  await restoredSecond.getByRole("button", { name: "开始休息", exact: true }).waitFor();
  assert.deepEqual(await waitForStoredWidgets(page, ([focus]) => focus.settings.finishUrl === alarmUrl), saved);
  await page.screenshot({ path: path.join(evidence, "04-restored-independent-timers.png") });

  await observePlayback(page);
  await page.clock.install({ time: new Date() });
  await restoredSecond.getByRole("button", { name: "开始休息", exact: true }).click();
  await waitForStoredWidgets(page, ([, rest]) => rest.endsAt > 0);
  await page.clock.fastForward("05:01");
  await waitForClock(restoredSecond, "00:00");
  const defaultAlarmSource = await waitForPlayback(page, "blob:", 0.9, alarmHash);
  await restoredSecond.getByRole("button", { name: "停止铃声", exact: true }).click();
  await waitForClock(first, pausedClock);

  await first.getByRole("button", { name: "重置", exact: true }).click();
  await waitForClock(first, "01:00");
  await first.getByRole("button", { name: "开始专注", exact: true }).click();
  await waitForStoredWidgets(page, ([focus]) => focus.endsAt > 0);
  const alternate = (await loadWorkspace(page)).pages.find((entry) => !entry.trashedAt && entry.title !== templateTitle);
  assert.ok(alternate, "A second page must be available to verify that the alarm survives navigation");
  await openPageInSidebar(page, alternate.title);
  await timers.first().waitFor({ state: "detached" });
  await page.clock.fastForward("01:01");
  const customAlarmSource = await waitForPlayback(page, alarmUrl, 0.73);
  assert.equal(await page.getByLabel("页面标题", { exact: true }).inputValue(), alternate.title);
  await openPageInSidebar(page, templateTitle);
  await timers.first().scrollIntoViewIfNeeded();
  await waitForClock(first, "00:00");
  await first.getByText("专注结束", { exact: true }).waitFor();
  assert.deepEqual(await fs.readFile(alarmPath), wav);
  assert.deepEqual(await requestedPacks(handle.app), []);
  await assertNoNetworkAndErrors(handle);
  const result = {
    catalogue: "isolated-official-release-fixture", downloads: selectedDownloads, offlineRestart: true, preview, importedImage, pausedClock, saved, localPackImported: true, restored: true, portableBackupRestored: true,
    alarm: { previewed: previewAlarmSource.startsWith("blob:"), defaultAlarmSource, customAlarmSource, managedHash: alarmHash, firedOnPage: alternate.title },
  };
  await fs.writeFile(path.join(evidence, "result.json"), JSON.stringify(result, null, 2) + "\n", "utf8");
  console.log(`NATIVE_MARKET_RESULT ${JSON.stringify(result)}`);
  finished = true;
});
