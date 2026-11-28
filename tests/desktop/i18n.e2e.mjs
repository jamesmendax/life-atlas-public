import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { _electron } from "playwright";
import { FIXTURE_TIME } from "../fixtures/full-workspace.mjs";
import { vaultItemInputs } from "../fixtures/vault-items.mjs";
import { captureBackupWorkspace, readClosedBackupWorkspace } from "./backup-helpers.mjs";
import {
  PACKAGED_EXE, REPO_ROOT, assertTestPath, closeApp, createIsolatedDirectory,
  isolatedElectronEnv, launchApp, queueDialogResponse, removeIsolatedDirectory, seedDesktopFullWorkspace,
} from "./helpers.mjs";
import { callVault, openVaultWindow, seedVault, unlockUi } from "./vault-helpers.mjs";

const runFile = promisify(execFile);
const SETUP = "lifeAtlasSetup";
const WORKSPACE = "lifeAtlas";
const VAULT = "lifeAtlasVault";
const PREVIEW = "lifeAtlasMarkdownPreview";
const PREVIEW_URL = "app://bundle/markdown-preview.html";
const PREVIEW_HEADING = "Synthetic Markdown · 页面 · ページ";

const localeCases = [
  ["zh-CN", "zh-Hans-CN", "zh-CN", "把数据放在哪里？", ["开始使用 · Life Atlas", "开始使用 Life Atlas"]],
  ["zh-SG", "zh-Hans-SG", "zh-SG", "把数据放在哪里？", ["开始使用 · Life Atlas", "开始使用 Life Atlas"]],
  ["ja-JP", "ja-JP,en-US", "ja", "データをどこに保存しますか？", ["はじめに · Life Atlas", "Life Atlas をはじめる"]],
  ["en-SG", "de-DE,en-SG,ja-JP", "en-SG", "Where should your data live?", ["Get started · Life Atlas", "Get started with Life Atlas"]],
  ["en-US", "en-US", "en-US", "Where should your data live?", ["Get started · Life Atlas", "Get started with Life Atlas"]],
];

function fixture(context) {
  const root = createIsolatedDirectory("i18n-e2e");
  const bootstrapDir = path.join(root, "bootstrap");
  const dataRoot = path.join(root, "data");
  const localeFile = path.join(bootstrapDir, "locale.json");
  const bootstrapFile = path.join(bootstrapDir, "bootstrap.json");
  const markdown = path.join(root, "preview.md");
  const roaming = path.join(root, "roaming");
  const local = path.join(root, "local");
  for (const directory of [bootstrapDir, roaming, local]) fs.mkdirSync(directory);
  fs.writeFileSync(markdown, "# " + PREVIEW_HEADING + "\n\nSynthetic Markdown file.\n");
  const env = (systemLocales) => ({
    APPDATA: roaming,
    LOCALAPPDATA: local,
    LIFE_ATLAS_TEST_SYSTEM_LOCALES: systemLocales,
    LIFE_ATLAS_TEST_CLOCK_MS: String(Date.parse(FIXTURE_TIME)),
  });
  let handle;
  async function close() {
    if (!handle) return;
    const current = handle;
    await closeApp(current, { keepDirs: true });
    handle = undefined;
    if (current.tempDir) removeIsolatedDirectory(current.tempDir);
  }
  context.after(async () => {
    await close();
    removeIsolatedDirectory(root);
  });
  return {
    dataRoot, localeFile, bootstrapFile, markdown, close,
    async launch(systemLocales, { workspace = false } = {}) {
      assert.equal(handle, undefined);
      handle = await launchApp({
        packaged: true, dataRoot: null, bootstrapDir, env: env(systemLocales),
        ...(workspace ? { rendererClock: { mode: "fixed", time: FIXTURE_TIME } } : {}),
      });
      handle.page.setDefaultTimeout(15000);
      return handle;
    },
    async launchStandalonePreview(systemLocales) {
      assert.equal(handle, undefined);
      const tempDir = path.join(root, "standalone-temp");
      fs.mkdirSync(tempDir);
      const childEnv = isolatedElectronEnv({ dataRoot: null, bootstrapDir, tempDir, env: env(systemLocales) });
      const app = await _electron.launch({
        executablePath: PACKAGED_EXE, cwd: REPO_ROOT, env: childEnv,
        args: ["--markdown-preview", markdown], timeout: 30000,
      });
      handle = { app };
      return app;
    },
  };
}

async function assertLocale(page, bridge, expected, { canSet = false } = {}) {
  const state = await page.evaluate(async (name) => {
    const api = window[name].locale;
    return { result: await api.get(), setter: typeof api.set, subscriber: typeof api.onChanged };
  }, bridge);
  assert.deepEqual(state, {
    result: { ok: true, value: { locale: expected } },
    setter: canSet ? "function" : "undefined",
    subscriber: "function",
  }, bridge);
}

async function subscribeToLocale(page, bridge) {
  await page.evaluate((name) => {
    window.__i18nLocaleEvents = [];
    window[name].locale.onChanged((value) => window.__i18nLocaleEvents.push(value));
  }, bridge);
}

function setLocale(page, bridge, locale) {
  return page.evaluate(({ name, value }) => window[name].locale.set({ locale: value }), { name: bridge, value: locale });
}

async function switchLocale(sourcePage, sourceBridge, locale, recipients) {
  assert.deepEqual(await setLocale(sourcePage, sourceBridge, locale), { ok: true, value: { locale } });
  await assertLocaleChanged(locale, recipients);
}

async function assertLocaleChanged(locale, recipients) {
  for (const [page, bridge] of recipients) {
    await page.waitForFunction((value) => window.__i18nLocaleEvents.at(-1)?.locale === value, locale);
    assert.deepEqual(await page.evaluate(() => window.__i18nLocaleEvents.at(-1)), { locale });
    await assertLocale(page, bridge, locale, { canSet: bridge === SETUP || bridge === WORKSPACE });
  }
}

async function assertWindowTitle(app, page, titles) {
  const window = await app.browserWindow(page);
  const title = await window.evaluate((target) => target.getTitle());
  assert.ok(titles.includes(title), 'Unexpected native title "' + title + '", expected ' + JSON.stringify(titles));
}

async function waitForSetup(page) {
  await page.locator('html[data-la-setup-ready="1"]').waitFor();
  await page.locator('.wiz-steps [aria-current="step"]').waitFor();
}

async function chooseSetupFolder(handle, target) {
  await queueDialogResponse(handle, "showOpenDialog", { canceled: false, filePaths: [target] });
  await handle.page.locator(".wizard .wiz-choice").nth(1).click();
  await handle.page.locator('.wiz-choice[aria-pressed="true"] .wiz-path').filter({ hasText: target }).waitFor();
  await handle.page.getByRole("status").waitFor();
}

async function advanceSetup(page) {
  const next = page.locator(".wiz-footer .btn-primary");
  await next.click();
  await page.locator('.wiz-steps li:nth-child(2)[aria-current="step"]').waitFor();
  await next.click();
  await page.locator(".wiz-summary .wiz-path").waitFor();
}

async function openPreview(handle, file) {
  const [page] = await Promise.all([
    handle.app.waitForEvent("window", { timeout: 15000 }),
    runFile(PACKAGED_EXE, ["--markdown-preview", file], { cwd: REPO_ROOT, env: handle.env, timeout: 15000, windowsHide: true }),
  ]);
  page.setDefaultTimeout(15000);
  await page.waitForURL(PREVIEW_URL);
  await page.getByRole("heading", { name: PREVIEW_HEADING, exact: true }).waitFor();
  return page;
}

async function workspaceData(page) {
  const result = await page.evaluate(() => window.lifeAtlas.workspace.load());
  assert.equal(result.ok, true, result.error?.message);
  return result.value.workspace;
}

function contentOf(workspace) {
  const { savedAt, ui, ...content } = workspace;
  assert.equal(content.schemaVersion, 20);
  return content;
}

for (const [locale, systemLocales, lang, heading, titles] of localeCases) {
  test("first run uses " + locale + " from preferred system languages", { timeout: 60000 }, async (context) => {
    const scenario = fixture(context);
    const { app, page } = await scenario.launch(systemLocales);
    await waitForSetup(page);
    await assertLocale(page, SETUP, locale, { canSet: true });
    await page.locator('html[lang="' + lang + '"]').waitFor();
    await page.getByRole("heading", { name: heading, exact: true }).waitFor();
    await assertWindowTitle(app, page, titles);

    if (locale === "en-SG") {
      await chooseSetupFolder({ app, page }, scenario.dataRoot);
      await advanceSetup(page);
      const exited = once(app.process(), "exit");
      await page.locator(".wiz-footer .btn-primary").click();
      assert.equal((await exited)[0], 0);
      await scenario.close();
      assert.equal(JSON.parse(fs.readFileSync(scenario.bootstrapFile, "utf8")).dataRoot, scenario.dataRoot);
      assert.equal(JSON.parse(fs.readFileSync(scenario.localeFile, "utf8")).locale, "en-SG");
      const restarted = await scenario.launch("ja-JP", { workspace: true });
      await assertLocale(restarted.page, WORKSPACE, "en-SG", { canSet: true });
      assert.equal((await workspaceData(restarted.page)).schemaVersion, 20);
    }
  });
}

test("setup language changes keep wizard progress and reach an open Markdown preview", { timeout: 90000 }, async (context) => {
  const scenario = fixture(context);
  const handle = await scenario.launch("zh-CN");
  const { app, page } = handle;
  await waitForSetup(page);
  await chooseSetupFolder(handle, scenario.dataRoot);
  await advanceSetup(page);
  const preview = await openPreview(handle, scenario.markdown);
  await assertLocale(preview, PREVIEW, "zh-CN");
  const windows = [[page, SETUP], [preview, PREVIEW]];
  for (const [window, bridge] of windows) await subscribeToLocale(window, bridge);
  const selector = page.locator(".wiz-lang select");
  assert.deepEqual(await selector.locator("option").evaluateAll((options) => options.map((option) => option.value)), localeCases.map(([locale]) => locale));
  await selector.selectOption("ja-JP");
  await assertLocaleChanged("ja-JP", windows);
  await page.locator('html[lang="ja"]').waitFor();
  await page.getByRole("heading", { name: "準備が整いました", exact: true }).waitFor();
  await preview.locator('html[lang="ja"]').waitFor();
  await preview.getByRole("heading", { name: "Markdown プレビュー", exact: true }).waitFor();
  assert.equal(await page.locator(".wiz-summary .wiz-path").textContent(), scenario.dataRoot);
  assert.equal(await page.locator('.wiz-steps li:nth-child(3)[aria-current="step"]').count(), 1);
  await assertWindowTitle(app, page, ["はじめに · Life Atlas", "Life Atlas をはじめる"]);
  await assertWindowTitle(app, preview, ["Markdown プレビュー · Life Atlas"]);
  await preview.getByRole("heading", { name: PREVIEW_HEADING, exact: true }).waitFor();
  assert.equal(JSON.parse(fs.readFileSync(scenario.localeFile, "utf8")).locale, "ja-JP");
});

test("existing workspaces keep Chinese by default, and language switches preserve schema 20 data and the unlocked vault", { timeout: 120000 }, async (context) => {
  const scenario = fixture(context);
  await seedDesktopFullWorkspace(scenario.dataRoot);
  const seededVault = await seedVault(scenario.dataRoot, [vaultItemInputs()[0]]);
  const seededData = contentOf(readClosedBackupWorkspace(scenario.dataRoot));
  fs.writeFileSync(scenario.bootstrapFile, JSON.stringify({ dataRoot: scenario.dataRoot }));

  const handle = await scenario.launch("en-US", { workspace: true });
  const { app, page } = handle;
  await assertLocale(page, WORKSPACE, "zh-CN", { canSet: true });
  assert.deepEqual(contentOf(await workspaceData(page)), seededData);
  const preview = await openPreview(handle, scenario.markdown);
  const vault = await openVaultWindow(handle);
  await assertLocale(preview, PREVIEW, "zh-CN");
  await assertLocale(vault, VAULT, "zh-CN");
  await unlockUi(vault);
  const vaultBefore = (await callVault(vault, "list")).summaries;
  assert.deepEqual(vaultBefore.map(({ id, title }) => ({ id, title })), seededVault.summaries.map(({ id, title }) => ({ id, title })));
  assert.equal((await setLocale(page, WORKSPACE, "fr-FR")).error.code, "E_INVALID_ARGUMENT");
  const workspaceBefore = await captureBackupWorkspace(handle);
  assert.deepEqual(contentOf(workspaceBefore), seededData);

  const windows = [[page, WORKSPACE], [vault, VAULT], [preview, PREVIEW]];
  for (const [window, bridge] of windows) await subscribeToLocale(window, bridge);
  for (const locale of ["zh-SG", "en-US", "en-SG", "ja-JP"]) {
    await switchLocale(page, WORKSPACE, locale, windows);
    assert.equal((await callVault(vault, "status")).locked, false);
    assert.deepEqual((await callVault(vault, "list")).summaries, vaultBefore);
    assert.deepEqual(await workspaceData(page), workspaceBefore);
  }
  assert.equal(await vault.locator('.vw[data-screen="main"]').count(), 1);
  await vault.locator('html[lang="ja"]').waitFor();
  await assertWindowTitle(app, vault, ["保管庫", "Life Atlas 保管庫"]);
  await assertWindowTitle(app, preview, ["Markdown プレビュー · Life Atlas"]);
  await scenario.close();

  assert.deepEqual(JSON.parse(fs.readFileSync(scenario.bootstrapFile, "utf8")), { dataRoot: scenario.dataRoot });
  assert.deepEqual(contentOf(readClosedBackupWorkspace(scenario.dataRoot)), seededData);
  assert.equal(JSON.parse(fs.readFileSync(scenario.localeFile, "utf8")).locale, "ja-JP");

  // A shell launch reads the preference even when the workspace has not started.
  const standalone = await scenario.launchStandalonePreview("en-US");
  const standalonePage = await standalone.firstWindow();
  await standalonePage.waitForURL(PREVIEW_URL);
  await standalonePage.getByRole("heading", { name: PREVIEW_HEADING, exact: true }).waitFor();
  await standalonePage.getByRole("heading", { name: "Markdown プレビュー", exact: true }).waitFor();
  const startup = await standalone.evaluate(({ app, BrowserWindow }) => ({
    profile: app.getPath("userData"),
    urls: BrowserWindow.getAllWindows().map((window) => window.webContents.getURL()),
  }));
  assertTestPath(startup.profile);
  assert.deepEqual(startup.urls, [PREVIEW_URL]);
  assert.equal(fs.existsSync(path.join(scenario.dataRoot, ".lock")), false);
  await assertLocale(standalonePage, PREVIEW, "ja-JP");
  await assertWindowTitle(standalone, standalonePage, ["Markdown プレビュー · Life Atlas"]);
  await scenario.close();

  const restarted = await scenario.launch("en-US", { workspace: true });
  await assertLocale(restarted.page, WORKSPACE, "ja-JP", { canSet: true });
  assert.deepEqual(contentOf(await workspaceData(restarted.page)), seededData);
});
