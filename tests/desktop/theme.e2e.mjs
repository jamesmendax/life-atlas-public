import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { WORKSPACE_CSP, VAULT_CSP } from "../../electron/main/security.js";
import { assertPhysicalPath } from "../../electron/main/storage/dataRoot.js";
import { createBackupDesktopCase, readClosedBackupWorkspace } from "./backup-helpers.mjs";
import { REPO_ROOT, assertNoNetworkAndErrors, assertTestPath } from "./helpers.mjs";
import { openVaultWindow } from "./vault-helpers.mjs";

function throwFailures(failures, message) {
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, message);
}

async function closeThemeCase(state) {
  if (!state.handle) return;
  const failures = [];
  try { await assertNoNetworkAndErrors(state.handle); } catch (error) { failures.push(error); }
  try { await state.close({ check: false }); } catch (error) { failures.push(error); }
  throwFailures(failures, "Theme case validation or owned process cleanup failed");
}

async function withThemeCases(context, operation) {
  const states = [];
  const failures = [];
  const createCase = async ({ setup = false } = {}) => {
    const state = await createBackupDesktopCase(context, { seed: !setup, setup, packaged: true, retainOnFailure: true });
    states.push(state);
    for (const directory of [state.dataRoot, state.bootstrapDir, state.handle.tempDir].filter(Boolean)) assertTestPath(directory);
    context.diagnostic(`WP20_THEME_CASE ${JSON.stringify({ setup, dataRoot: state.dataRoot, bootstrapDir: state.bootstrapDir, tempDir: state.handle.tempDir, packaged: state.handle.packaged, processOwnership: state.handle.processOwnership })}`);
    if (!setup) {
      const info = await state.handle.page.evaluate(() => window.lifeAtlas.app.getInfo());
      assert.equal(info.ok, true, info.error?.message);
      assert.equal(info.value.isPackaged, true);
      assert.equal(info.value.flavor, "test");
    }
    return state;
  };
  try { await operation(createCase); } catch (error) { failures.push(error); }
  for (const state of [...states].reverse()) {
    try { await closeThemeCase(state); } catch (error) { failures.push(error); }
  }
  if (!failures.length) for (const state of states) state.complete();
  throwFailures(failures, "Theme assertions failed; cleanup diagnostics and fixture directories retained");
}

async function readNativeWindows(handle) {
  return handle.app.evaluate(({ app, BrowserWindow, Menu, nativeTheme }) => ({
    mainPid: process.pid,
    packaged: app.isPackaged,
    themeSource: nativeTheme.themeSource,
    shouldUseDarkColors: nativeTheme.shouldUseDarkColors,
    applicationMenuIsNull: Menu.getApplicationMenu() === null,
    windows: BrowserWindow.getAllWindows().map((window) => ({
      id: window.id,
      webContentsId: window.webContents.id,
      rendererPid: window.webContents.getOSProcessId(),
      url: window.webContents.getURL(),
      menuBarVisible: window.isMenuBarVisible(),
      backgroundColor: window.getBackgroundColor().toLowerCase(),
    })),
  }));
}

async function assertNativeMode(context, handle, source, pages) {
  const deadline = performance.now() + 5000;
  let snapshot;
  while (true) {
    snapshot = await readNativeWindows(handle);
    const color = snapshot.shouldUseDarkColors ? "#191919" : "#ffffff";
    if (snapshot.themeSource === source && snapshot.windows.length === pages.length && snapshot.windows.every((window) => window.backgroundColor === color)) break;
    assert.ok(performance.now() < deadline, `Native theme did not settle: ${JSON.stringify(snapshot)}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(snapshot.packaged, true);
  assert.equal(snapshot.mainPid, handle.processOwnership.mainPid);
  assert.equal(snapshot.themeSource, source);
  if (source !== "system") assert.equal(snapshot.shouldUseDarkColors, source === "dark");
  assert.equal(snapshot.applicationMenuIsNull, true);
  const mode = snapshot.shouldUseDarkColors ? "dark" : "light";
  for (const { page, kind } of pages) {
    await page.emulateMedia({ colorScheme: null });
    await page.waitForFunction(({ dark, workspace }) => matchMedia("(prefers-color-scheme: dark)").matches === dark
      && (!workspace || document.documentElement.dataset.theme === (dark ? "dark" : "light"))
      && getComputedStyle(document.body).backgroundColor === (dark ? "rgb(25, 25, 25)" : "rgb(255, 255, 255)"), { dark: mode === "dark", workspace: kind === "workspace" }, { timeout: 5000 });
    const url = new URL(page.url());
    assert.equal(url.protocol, "app:");
    assert.equal(url.hostname, "bundle");
    assert.equal(url.pathname, kind === "workspace" ? "/index.html" : `/${kind}.html`);
    const windows = snapshot.windows.filter((window) => window.url === page.url());
    assert.equal(windows.length, 1, `The ${kind} page must belong to exactly one native window`);
    assert.equal(windows[0].menuBarVisible, false, `${kind} menu bar must be hidden`);
    assert.equal(windows[0].backgroundColor, mode === "dark" ? "#191919" : "#ffffff");
  }
  context.diagnostic(`WP20_NATIVE_THEME ${JSON.stringify({ source, mode, ...snapshot })}`);
  return snapshot;
}

async function assertPersistedPreference(page, source) {
  const deadline = performance.now() + 5000;
  while (true) {
    const stored = await page.evaluate(async () => {
      const loaded = await window.lifeAtlas.workspace.load();
      return { loaded, cachedPreference: localStorage.getItem("life-atlas.theme-preference") };
    });
    if (stored.loaded.ok === true && stored.loaded.value.workspace.ui.preferences.theme === source && stored.cachedPreference === source) break;
    assert.ok(performance.now() < deadline, `Theme preference did not persist: ${JSON.stringify({ expected: source, persisted: stored.loaded.value?.workspace?.ui?.preferences?.theme, cache: stored.cachedPreference })}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const loaded = await page.evaluate(() => window.lifeAtlas.workspace.load());
  assert.equal(loaded.ok, true, loaded.error?.message);
  assert.equal(loaded.value.workspace.ui.preferences.theme, source);
}

async function cyclePreference(context, state, source, pages) {
  await state.handle.page.getByRole("button", { name: "切换白天/夜间", exact: true }).click();
  await assertNativeMode(context, state.handle, source, pages);
  await assertPersistedPreference(state.handle.page, source);
}

async function assertBundledFonts(context, page, kind) {
  const fontRequests = [];
  const fontResponses = [];
  const observeFontRequest = (request) => {
    if (request.resourceType() === "font") fontRequests.push(request);
  };
  let csp;
  let fonts;
  page.on("request", observeFontRequest);
  try {
    const response = await page.reload({ waitUntil: "domcontentloaded" });
    assert.ok(response, `${kind} document must have a real bundle response`);
    assert.equal(response.status(), 200);
    csp = await response.headerValue("content-security-policy");
    assert.equal(csp, kind === "vault" ? VAULT_CSP : WORKSPACE_CSP);
    const fontDirective = csp.split(";").map((directive) => directive.trim()).find((directive) => directive.startsWith("font-src "));
    if (kind === "vault") assert.ok(csp.split(";").map((directive) => directive.trim()).includes("default-src 'self'"));
    else assert.equal(fontDirective, "font-src 'self' data:");
    const readiness = kind === "workspace" ? "la-ready" : `la-${kind}-ready`;
    await page.locator(`html[data-${readiness}="1"]`).waitFor();
    const requests = [{ family: "Noto Sans SC Variable", descriptor: '700 40px "Noto Sans SC Variable"', prefix: "noto-sans-sc-" }];
    if (kind === "workspace") requests.push({ family: "Noto Serif SC Variable", descriptor: '400 16px "Noto Serif SC Variable"', prefix: "noto-serif-sc-" });
    fonts = await page.evaluate(async ({ requests: expected, workspace }) => {
      await document.fonts.ready;
      const loaded = [];
      for (const request of expected) {
        const faces = await document.fonts.load(request.descriptor, "电");
        loaded.push({ ...request, check: document.fonts.check(request.descriptor, "电"), faces: faces.map((face) => ({ family: face.family.replace(/^["']|["']$/g, ""), status: face.status })) });
      }
      await document.fonts.ready;
      const element = workspace ? document.querySelector(".page-title-input") : document.body;
      const style = element ? getComputedStyle(element) : null;
      return { url: location.href, fontFamily: style?.fontFamily, fontSize: style?.fontSize, fontWeight: style?.fontWeight, loaded, resources: performance.getEntriesByType("resource").map((entry) => entry.name).filter((name) => /\.woff2(?:[?#]|$)/i.test(name)) };
    }, { requests, workspace: kind === "workspace" });
    for (const request of fontRequests) {
      const response = await request.response();
      assert.ok(response, `${kind}: ${request.url()} must have a real font response`);
      assert.equal(await response.finished(), null, `${kind}: ${request.url()} font response must finish successfully`);
      assert.equal(response.status(), 200, `${kind}: ${request.url()} font response must return 200`);
      fontResponses.push({ url: response.url(), status: response.status() });
    }
    fonts.resources = [...new Set([...fonts.resources, ...fontResponses.map((response) => response.url)])];
  } finally {
    page.off("request", observeFontRequest);
  }
  assert.match(fonts.fontFamily, /^"Segoe UI Variable Text"/);
  if (kind === "workspace") {
    assert.equal(fonts.fontSize, "40px");
    assert.equal(fonts.fontWeight, "700");
  }
  for (const font of fonts.loaded) {
    assert.equal(font.check, true, `${kind}: ${font.family} must pass FontFaceSet.check`);
    assert.ok(font.faces.length > 0, `${kind}: ${font.family} must load a registered font face instead of falling back`);
    for (const face of font.faces) {
      assert.equal(face.family, font.family);
      assert.equal(face.status, "loaded");
    }
    assert.ok(fonts.resources.some((resource) => {
      const url = new URL(resource);
      return url.protocol === "app:" && url.hostname === "bundle" && url.pathname.startsWith(`/assets/${font.prefix}`) && url.pathname.endsWith(".woff2");
    }), `${kind}: ${font.family} must be loaded from a bundled woff2 asset`);
  }
  for (const resource of fonts.resources) assert.ok(resource.startsWith("app://bundle/assets/"), `${kind}: fonts must use local bundle resources`);
  context.diagnostic(`WP20_BUNDLED_FONTS ${JSON.stringify({ kind, csp, ...fonts, fontResponses })}`);
}

async function screenshotDesktop(page, mode) {
  const directory = assertPhysicalPath(path.join(REPO_ROOT, ".qa", "WP-20"), { root: path.join(REPO_ROOT, ".qa") });
  fs.mkdirSync(directory, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(directory, `desktop-${mode}.png`) });
}

test("bundled fonts load under the desktop csp", { timeout: 120000 }, async (context) => {
  await withThemeCases(context, async (createCase) => {
    const workspace = await createCase();
    await cyclePreference(context, workspace, "light", [{ page: workspace.handle.page, kind: "workspace" }]);
    await assertBundledFonts(context, workspace.handle.page, "workspace");
    const vaultPage = await openVaultWindow(workspace.handle);
    await assertBundledFonts(context, vaultPage, "vault");
    await assertNativeMode(context, workspace.handle, "light", [{ page: workspace.handle.page, kind: "workspace" }, { page: vaultPage, kind: "vault" }]);
    await screenshotDesktop(workspace.handle.page, "light");
    await closeThemeCase(workspace);
    const setup = await createCase({ setup: true });
    await assertBundledFonts(context, setup.handle.page, "setup");
    await assertNativeMode(context, setup.handle, "system", [{ page: setup.handle.page, kind: "setup" }]);
  });
});

test("the theme preference sets the native theme source", { timeout: 120000 }, async (context) => {
  await withThemeCases(context, async (createCase) => {
    const state = await createCase();
    await assertPersistedPreference(state.handle.page, "system");
    let vaultPage = await openVaultWindow(state.handle);
    await assertNativeMode(context, state.handle, "system", [{ page: state.handle.page, kind: "workspace" }, { page: vaultPage, kind: "vault" }]);
    for (const source of ["light", "dark"]) {
      await cyclePreference(context, state, source, [{ page: state.handle.page, kind: "workspace" }, { page: vaultPage, kind: "vault" }]);
      if (source === "dark") await screenshotDesktop(state.handle.page, "dark");
    }
    await closeThemeCase(state);
    assert.equal(readClosedBackupWorkspace(state.dataRoot).ui.preferences.theme, "dark");
    await state.launch();
    vaultPage = await openVaultWindow(state.handle);
    await assertNativeMode(context, state.handle, "dark", [{ page: state.handle.page, kind: "workspace" }, { page: vaultPage, kind: "vault" }]);
    await assertPersistedPreference(state.handle.page, "dark");
    await cyclePreference(context, state, "system", [{ page: state.handle.page, kind: "workspace" }, { page: vaultPage, kind: "vault" }]);
    await closeThemeCase(state);
    assert.equal(readClosedBackupWorkspace(state.dataRoot).ui.preferences.theme, "system");
    await state.launch();
    await assertNativeMode(context, state.handle, "system", [{ page: state.handle.page, kind: "workspace" }]);
    await assertPersistedPreference(state.handle.page, "system");
  });
});

test("windows have no menu bar and follow the mode background", { timeout: 120000 }, async (context) => {
  await withThemeCases(context, async (createCase) => {
    const workspace = await createCase();
    await assertNativeMode(context, workspace.handle, "system", [{ page: workspace.handle.page, kind: "workspace" }]);
    await cyclePreference(context, workspace, "light", [{ page: workspace.handle.page, kind: "workspace" }]);
    const vaultPage = await openVaultWindow(workspace.handle);
    const pages = [{ page: workspace.handle.page, kind: "workspace" }, { page: vaultPage, kind: "vault" }];
    await assertNativeMode(context, workspace.handle, "light", pages);
    await cyclePreference(context, workspace, "dark", pages);
    await cyclePreference(context, workspace, "system", pages);
    await closeThemeCase(workspace);
    const setup = await createCase({ setup: true });
    await assertNativeMode(context, setup.handle, "system", [{ page: setup.handle.page, kind: "setup" }]);
    for (const source of ["light", "dark", "system"]) {
      await setup.handle.app.evaluate(({ nativeTheme }, preference) => { nativeTheme.themeSource = preference; }, source);
      await assertNativeMode(context, setup.handle, source, [{ page: setup.handle.page, kind: "setup" }]);
    }
  });
});
