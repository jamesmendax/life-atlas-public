import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import { WORKSPACE_CSP } from "../../electron/main/security.js";
import { openWorkspaceDatabase, replaceDatabaseWorkspace } from "../../electron/main/storage/workspaceDb.js";
import { REPO_ROOT, PACKAGED_EXE, createIsolatedDirectory, removeIsolatedDirectory, seedDesktopFullWorkspace, launchApp, closeApp, readNetworkLog, readDialogCalls, queueDialogResponse, openPageInSidebar, assertNoNetworkAndErrors } from "./helpers.mjs";

const require = createRequire(import.meta.url);
const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function shellCase(context, { seed = false, transform, packaged = false } = {}) {
  const dataRoot = createIsolatedDirectory("shell-e2e");
  let handle;
  let completed = false;
  context.after(async () => {
    let failure;
    if (handle) {
      try { await closeApp(handle, { keepDirs: true }); } catch (error) { failure = error; }
    }
    const directories = [...new Set([dataRoot, handle?.bootstrapDir, handle?.tempDir].filter(Boolean))];
    if (!completed || failure) console.log(`LIFE_ATLAS_SHELL_CASE_RETAINED ${JSON.stringify({ directories, completed })}`);
    else for (const directory of directories) if (fs.existsSync(directory)) removeIsolatedDirectory(directory);
    if (failure) throw failure;
  });
  if (seed) {
    const workspace = await seedDesktopFullWorkspace(dataRoot);
    if (transform) {
      transform(workspace);
      const db = openWorkspaceDatabase(path.join(dataRoot, "workspace.db"));
      try { replaceDatabaseWorkspace(db, workspace, { generation: "gen-e2e", now: workspace.savedAt }); } finally { db.close(); }
    }
  }
  handle = await launchApp({ dataRoot, packaged });
  handle.complete = () => { completed = true; };
  await handle.page.locator('html[data-la-ready="1"]').waitFor();
  await handle.page.locator(".workspace-sidebar").waitFor();
  return handle;
}

async function clickPage(page, title) {
  await openPageInSidebar(page, title);
}

test("window loads the existing interface", { timeout: 60000 }, async (context) => {
  const handle = await shellCase(context);
  await handle.page.setViewportSize({ width: 1440, height: 900 });
  const directory = path.join(REPO_ROOT, ".qa", "WP-03");
  fs.mkdirSync(directory, { recursive: true });
  await handle.page.screenshot({ path: path.join(directory, "desktop-window.png") });
  assert.equal(await handle.page.locator(".workspace-sidebar").isVisible(), true);
  await assertNoNetworkAndErrors(handle);
  handle.complete();
});

test("renderer has no node access", { timeout: 60000 }, async (context) => {
  const handle = await shellCase(context);
  const surface = await handle.page.evaluate(() => ({ requireType: typeof require, processType: typeof process, moduleType: typeof module, platform: window.lifeAtlas.platform, hasVaultBridge: window.lifeAtlasVault !== undefined }));
  assert.deepEqual(surface, { requireType: "undefined", processType: "undefined", moduleType: "undefined", platform: "desktop", hasVaultBridge: false });
  await assertNoNetworkAndErrors(handle);
  handle.complete();
});

test("app documents carry the exact workspace CSP", { timeout: 60000 }, async (context) => {
  const handle = await shellCase(context);
  const csp = await handle.page.evaluate(async () => (await fetch("app://bundle/index.html")).headers.get("content-security-policy"));
  assert.equal(csp, WORKSPACE_CSP);
  await assertNoNetworkAndErrors(handle);
  handle.complete();
});

test("navigation and new windows are blocked", { timeout: 60000 }, async (context) => {
  const handle = await shellCase(context);
  await handle.page.evaluate(() => { location.href = "https://example.com/"; });
  await pause(1000);
  assert.match(handle.page.url(), /^app:\/\/bundle\/index\.html(?:[?#]|$)/);
  assert.equal(await handle.page.evaluate(() => window.open("https://example.com/") === null), true);
  await pause(1000);
  assert.equal(await handle.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
  assert.equal(await handle.page.evaluate(async () => { try { await navigator.mediaDevices.getUserMedia({ audio: true }); return false; } catch { return true; } }), true);
  await assertNoNetworkAndErrors(handle, { allowedUrls: ["https://example.com/"] });
  handle.complete();
});

test("remote content never reaches the network", { timeout: 60000 }, async (context) => {
  const handle = await shellCase(context, { seed: true, transform: (workspace) => {
    workspace.pages.find((page) => page.id === "p-a1").content.push({ id: "b-remote-img", type: "image", props: { url: "https://example.com/a.png", name: "remote", caption: "" } });
  } });
  for (const title of ["Z 目标页", "B 笔记", "A 概览"]) await clickPage(handle.page, title);
  const editor = handle.page.locator('.life-editor .bn-editor[contenteditable="true"]').first();
  await editor.click();
  await handle.page.keyboard.press("Control+End");
  await handle.page.keyboard.press("Enter");
  await handle.page.keyboard.type("/");
  await handle.page.getByRole("listbox").waitFor();
  await handle.page.keyboard.press("Escape");
  const network = await readNetworkLog(handle);
  assert.deepEqual(network.completed.filter(({ url }) => /^(?:https?|wss?):/.test(url)), []);
  await assertNoNetworkAndErrors(handle, { allowedUrls: ["https://example.com/a.png"] });
  handle.complete();
});

test("external links ask before opening", { timeout: 60000 }, async (context) => {
  const handle = await shellCase(context);
  const clickLink = () => handle.page.evaluate(() => { const link = document.createElement("a"); link.href = "https://example.com/x"; document.body.appendChild(link); link.click(); link.remove(); });
  await clickLink();
  await pause(1000);
  const cancelled = await readDialogCalls(handle);
  assert.equal(cancelled.filter((call) => call.kind === "showMessageBox" && call.options.detail === "https://example.com/x").length, 1);
  assert.equal(cancelled.filter((call) => call.kind === "openExternal").length, 0);
  await queueDialogResponse(handle, "showMessageBox", { response: 0 });
  await clickLink();
  await pause(1000);
  const opened = (await readDialogCalls(handle)).filter((call) => call.kind === "openExternal");
  assert.equal(opened.length, 1);
  assert.equal(opened[0].options.url, "https://example.com/x");
  await assertNoNetworkAndErrors(handle, { allowedUrls: ["https://example.com/x"] });
  handle.complete();
});

test("second instance exits and keeps one window", { timeout: 60000 }, async (context) => {
  const handle = await shellCase(context);
  const started = performance.now();
  const child = spawn(require("electron"), [REPO_ROOT], { cwd: REPO_ROOT, env: handle.env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (data) => { output += data.toString(); });
  child.stderr.on("data", (data) => { output += data.toString(); });
  context.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill(); });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { child.kill(); reject(new Error(`Second instance did not exit within 5000ms: ${output}`)); }, 5000);
    child.once("error", (error) => { clearTimeout(timeout); reject(error); });
    child.once("exit", () => { clearTimeout(timeout); resolve(); });
  });
  assert.ok(performance.now() - started < 5000);
  assert.equal(await handle.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
  await assertNoNetworkAndErrors(handle);
  handle.complete();
});

test("session data stays inside the data root", { timeout: 60000 }, async (context) => {
  const handle = await shellCase(context);
  const paths = await handle.app.evaluate(({ app }) => ({ userData: app.getPath("userData"), sessionData: app.getPath("sessionData"), crashDumps: app.getPath("crashDumps") }));
  assert.deepEqual(paths, { userData: path.join(handle.dataRoot, "runtime"), sessionData: path.join(handle.dataRoot, "runtime"), crashDumps: path.join(handle.dataRoot, "runtime", "crashes") });
  assert.deepEqual(fs.readdirSync(handle.bootstrapDir), []);
  await assertNoNetworkAndErrors(handle);
  handle.complete();
});

test("packaged build disables devtools and spellcheck", { timeout: 60000 }, async (context) => {
  const handle = await shellCase(context, { packaged: true });
  const options = await handle.app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.webContents.openDevTools();
    return { devToolsOpened: window.webContents.isDevToolsOpened(), spellcheck: window.webContents.session.isSpellCheckerEnabled(), sandbox: window.webContents.getLastWebPreferences().sandbox, nodeIntegration: window.webContents.getLastWebPreferences().nodeIntegration };
  });
  assert.deepEqual(options, { devToolsOpened: false, spellcheck: false, sandbox: true, nodeIntegration: false });
  const info = await handle.page.evaluate(() => window.lifeAtlas.app.getInfo());
  assert.equal(info.ok, true);
  assert.equal(info.value.flavor, "test");
  assert.equal(info.value.isPackaged, true);
  await assertNoNetworkAndErrors(handle);
  handle.complete();
});

test("the packaged app contains only runtime files", () => {
  const resources = path.join(path.dirname(PACKAGED_EXE), "resources");
  const asar = fs.readFileSync(path.join(resources, "app.asar"));
  const headerSize = asar.readUInt32LE(12);
  const header = JSON.parse(asar.subarray(16, 16 + headerSize).toString("utf8"));
  const allowedRoots = new Set(["dist", "electron", "src", "package.json", "node_modules"]);
  for (const name of Object.keys(header.files)) assert.ok(allowedRoots.has(name), `Unexpected packaged root ${name}`);
  const allowedPackages = new Set(["yazl", "yauzl", "hash-wasm", "buffer-crc32", "pend", "tesseract.js-core"]);
  for (const name of Object.keys(header.files.node_modules?.files || {})) assert.ok(allowedPackages.has(name), `Unexpected runtime package ${name}`);
  assert.ok(asar.length < 80 * 1024 * 1024, `ASAR_BYTES=${asar.length}`);
  const unpackedDir = path.join(resources, "app.asar.unpacked");
  if (fs.existsSync(unpackedDir)) {
    assert.deepEqual(fs.readdirSync(unpackedDir).sort(), ["electron", "node_modules"]);
  }
});

test("prompts use the product dialog on desktop", { timeout: 60000 }, async (context) => {
  const handle = await shellCase(context, { seed: true });
  await clickPage(handle.page, "整页项目库");
  await handle.page.getByRole("button", { name: "数据源 整页项目库", exact: true }).click();
  await handle.page.getByRole("button", { name: "重命名数据源", exact: true }).click();
  const prompt = handle.page.locator('[data-la-dialog="prompt"]');
  await prompt.waitFor();
  await prompt.locator("input").fill("改名测试");
  await prompt.locator("[data-la-dialog-confirm]").click();
  await handle.page.getByRole("button", { name: "数据源 改名测试", exact: true }).waitFor();
  await assertNoNetworkAndErrors(handle);
  handle.complete();
});
