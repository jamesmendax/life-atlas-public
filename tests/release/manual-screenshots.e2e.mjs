import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { assertPhysicalPath } from "../../electron/main/storage/dataRoot.js";
import { backupFixture } from "../fixtures/backup-helpers.mjs";
import { seedVault } from "../desktop/seed-vault.mjs";
import { openVaultWindow, unlockUi } from "../desktop/vault-helpers.mjs";
import { openBackupDialog, seedDesktopFullWorkspace } from "../desktop/backup-helpers.mjs";
import { REPO_ROOT, assertNoNetworkAndErrors, closeApp, createIsolatedDirectory, launchApp, openPageInSidebar, queueDialogResponse, removeIsolatedDirectory } from "../desktop/helpers.mjs";

const MASTER = "Release-Sweep-Pass-2026!";
const names = ["first-run", "restore-from-backup", "backup-dialog", "vault-lock", "vault-main", "template-gallery", "roadmap", "slash-menu", "database-table", "quick-capture", "settings"];
const workspaceSize = { width: 1440, height: 900 };
const demoValue = "示例-不是真的";
const field = (label, sensitive = false) => ({ label, kind: sensitive ? "secret" : "text", value: demoValue, sensitive });
const demoItems = [
  { type: "login", title: "示例邮箱", tags: ["演示"], favorite: true, fields: [field("用户名"), field("密码", true), field("备注")] },
  { type: "server", title: "示例服务器", tags: ["演示"], favorite: false, fields: [field("主机"), field("用户名"), field("密码", true)] },
  { type: "apiKey", title: "示例 API Key", tags: ["演示"], favorite: false, fields: [field("服务商"), field("API Key", true), field("Secret", true)] },
];

async function waitForPersistedPage(page, title) {
  const deadline = Date.now() + 30000;
  do {
    const result = await page.evaluate(() => window.lifeAtlas.workspace.load());
    assert.equal(result.ok, true, result.error?.message);
    if (result.value.workspace.pages.some((entry) => entry.title === title)) return result;
    await new Promise((resolve) => setTimeout(resolve, 50));
  } while (Date.now() < deadline);
  assert.fail("The newly created ordinary page did not reach SQLite before the original 30 second deadline");
}

async function imageBrightness(filePath) {
  const { channels } = await sharp(filePath).stats();
  return channels.slice(0, 3).reduce((sum, channel) => sum + channel.mean, 0) / 3;
}

async function validateImages(shotsDir, dimensions) {
  const expected = names.flatMap((name) => ["light", "dark"].map((mode) => `${name}-${mode}.png`)).sort();
  assert.deepEqual(fs.readdirSync(shotsDir).sort(), expected);
  assert.equal(expected.length, 22);
  for (const name of names) {
    const size = dimensions.get(name);
    assert.ok(size, `Missing actual window dimensions for ${name}`);
    for (const mode of ["light", "dark"]) {
      const metadata = await sharp(path.join(shotsDir, `${name}-${mode}.png`)).metadata();
      assert.equal(metadata.format, "png");
      assert.equal(metadata.width, size.width, `${name}-${mode} width`);
      assert.equal(metadata.height, size.height, `${name}-${mode} height`);
    }
    const light = await imageBrightness(path.join(shotsDir, `${name}-light.png`));
    const dark = await imageBrightness(path.join(shotsDir, `${name}-dark.png`));
    assert.ok(light - dark > 40, `${name} must show two real, distinct theme modes`);
    console.log(`MANUAL_IMAGE ${name} ${size.width}x${size.height} light=${light.toFixed(1)} dark=${dark.toFixed(1)}`);
  }
  return expected;
}

function deliverImages(shotsDir, files) {
  const directory = assertPhysicalPath(path.join(REPO_ROOT, "docs/manual-images"), { root: path.join(REPO_ROOT, "docs") });
  const replace = process.env.LIFE_ATLAS_REPLACE_MANUAL_IMAGES === "1";
  if (fs.existsSync(directory)) {
    const existing = fs.readdirSync(directory).filter((name) => name.endsWith(".png"));
    if (replace) assert.deepEqual(existing.filter((name) => !files.includes(name)), [], "Replacement must not remove images outside the owned manual set");
    else assert.deepEqual(existing, [], "Do not overwrite existing manual images without explicit ownership reconciliation");
  }
  fs.mkdirSync(directory, { recursive: true });
  for (const name of files) fs.copyFileSync(path.join(shotsDir, name), path.join(directory, name), replace ? 0 : fs.constants.COPYFILE_EXCL);
  assert.deepEqual(fs.readdirSync(directory).filter((name) => name.endsWith(".png")).sort(), files);
}

test("the user manual screenshots come from version 1.0.0 in both modes", { timeout: 240000 }, async () => {
  const root = createIsolatedDirectory("manual-screenshots");
  const dataRoot = path.join(root, "data");
  const workspaceBootstrap = path.join(root, "workspace-bootstrap");
  const firstBootstrap = path.join(root, "first-bootstrap");
  const fixtureDirectory = path.join(root, "fixtures");
  const restoreRoot = path.join(root, "restore-data");
  for (const directory of [dataRoot, workspaceBootstrap, firstBootstrap, fixtureDirectory]) fs.mkdirSync(directory, { recursive: true });
  const qaRoot = assertPhysicalPath(path.join(REPO_ROOT, ".qa/WP-19"), { root: path.join(REPO_ROOT, ".qa") });
  fs.mkdirSync(qaRoot, { recursive: true });
  const shotsDir = fs.mkdtempSync(path.join(qaRoot, "manual-shots-"));
  const handles = new Set();
  const closeAttempted = new Set();
  const temporaryDirectories = new Set();
  const dimensions = new Map();
  let failure;
  const open = async (options) => {
    const handle = await launchApp({ packaged: true, ...options });
    handles.add(handle);
    temporaryDirectories.add(handle.tempDir);
    assert.equal(await handle.app.evaluate(({ app }) => app.getVersion()), "1.0.0", "Manual screenshots require the real 1.0.0 test package");
    return handle;
  };
  const finish = async (handle) => {
    await assertNoNetworkAndErrors(handle);
    closeAttempted.add(handle);
    await closeApp(handle, { keepDirs: true });
    handles.delete(handle);
  };
  const readNativeSize = async (handle, page) => {
    const windowHandle = await handle.app.browserWindow(page);
    try {
      return await windowHandle.evaluate((nativeWindow) => {
        const [width, height] = nativeWindow.getContentSize();
        return { width, height };
      });
    } finally {
      await windowHandle.dispose();
    }
  };
  const setWorkspaceSize = async (handle) => {
    const windowHandle = await handle.app.browserWindow(handle.page);
    try {
      await windowHandle.evaluate((nativeWindow, size) => nativeWindow.setContentSize(size.width, size.height), workspaceSize);
    } finally {
      await windowHandle.dispose();
    }
    await handle.page.waitForFunction((size) => innerWidth === size.width && innerHeight === size.height, workspaceSize);
    assert.deepEqual(await readNativeSize(handle, handle.page), workspaceSize, "Workspace screenshots require the specified native content size");
  };
  const shootModes = async (handle, page, name) => {
    try {
      for (const mode of ["light", "dark"]) {
        await handle.app.evaluate(({ nativeTheme }, source) => { nativeTheme.themeSource = source; }, mode);
        await page.emulateMedia({ colorScheme: mode });
        await page.waitForFunction((dark) => matchMedia("(prefers-color-scheme: dark)").matches === dark, mode === "dark");
        if (await page.evaluate(() => document.documentElement.dataset.laReady === "1")) await page.locator(`html[data-theme="${mode}"]`).waitFor();
        await page.evaluate(() => document.fonts.ready);
        const size = dimensions.get(name);
        assert.deepEqual(await readNativeSize(handle, page), size, `${name}-${mode} native content size must match the screenshot dimensions`);
        assert.deepEqual(await page.evaluate(() => ({ width: innerWidth, height: innerHeight })), size, `${name}-${mode} renderer size must match the native content size`);
        await page.screenshot({ path: path.join(shotsDir, `${name}-${mode}.png`), scale: "css" });
      }
    } finally {
      await page.emulateMedia({ colorScheme: null });
      await handle.app.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = "system"; });
    }
  };
  const shootNative = async (handle, page, name) => {
    const size = await readNativeSize(handle, page);
    dimensions.set(name, size);
    await shootModes(handle, page, name);
    assert.deepEqual(await page.evaluate(() => ({ width: innerWidth, height: innerHeight })), size, "Native wizard/vault window size must not change for screenshots");
  };
  const shootWorkspace = async (handle, name) => {
    dimensions.set(name, workspaceSize);
    await setWorkspaceSize(handle);
    await shootModes(handle, handle.page, name);
  };
  try {
    const wizard = await open({ dataRoot: null, bootstrapDir: firstBootstrap });
    await wizard.page.locator(".wizard").waitFor();
    await wizard.page.getByRole("status").filter({ hasText: "将创建这个文件夹" }).waitFor();
    await wizard.page.waitForFunction(() => document.querySelector(".wizard .wiz-main")?.getAttribute("aria-busy") === "false" && !document.querySelector(".wizard .wiz-choice")?.disabled);
    await shootNative(wizard, wizard.page, "first-run");
    const browserBackup = await backupFixture();
    const backupFile = path.join(fixtureDirectory, "browser-migration.lifeatlas");
    fs.writeFileSync(backupFile, browserBackup.bytes);
    await queueDialogResponse(wizard, "showOpenDialog", { canceled: false, filePaths: [restoreRoot] });
    await wizard.page.locator(".wizard .wiz-choice").nth(1).click();
    await wizard.page.getByRole("status").filter({ hasText: "将创建这个文件夹" }).waitFor();
    await wizard.page.getByRole("button", { name: "继续", exact: true }).click();
    await wizard.page.getByRole("button", { name: /^从备份恢复/ }).click();
    await queueDialogResponse(wizard, "showOpenDialog", { canceled: false, filePaths: [backupFile] });
    await wizard.page.getByRole("button", { name: "选择备份文件…", exact: true }).click();
    await wizard.page.locator(".wiz-summary").getByText("浏览器迁移包", { exact: true }).waitFor();
    await shootNative(wizard, wizard.page, "restore-from-backup");
    await finish(wizard);

    await seedDesktopFullWorkspace(dataRoot);
    await seedVault(dataRoot, { password: MASTER, inputs: demoItems });
    const handle = await open({ dataRoot, bootstrapDir: workspaceBootstrap });
    const page = handle.page;
    await page.locator('html[data-la-ready="1"]').waitFor();
    await page.locator(".workspace-sidebar").waitFor();
    await setWorkspaceSize(handle);
    await page.keyboard.press("Control+,");
    const appearance = page.getByRole("dialog", { name: "设置", exact: true });
    await appearance.getByRole("radiogroup", { name: "模式", exact: true }).getByRole("radio", { name: "跟随系统", exact: true }).click();
    await appearance.getByRole("button", { name: "关闭设置", exact: true }).click();

    const backupDialog = await openBackupDialog(handle);
    await backupDialog.getByLabel(/^包含密钥库/).waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll(".mb-backup-dialog label")].some((label) => label.textContent.startsWith("包含密钥库") && !label.querySelector("input")?.disabled && label.querySelector("input")?.checked));
    assert.equal(await backupDialog.getByLabel(/^包含密钥库/).isEnabled(), true);
    assert.equal(await backupDialog.getByLabel(/^包含密钥库/).isChecked(), true);
    await shootWorkspace(handle, "backup-dialog");
    await backupDialog.getByRole("button", { name: "关闭对话框", exact: true }).click();

    const vaultPage = await openVaultWindow(handle);
    await vaultPage.locator('.vw[data-screen="locked"]').waitFor();
    assert.equal(await vaultPage.getByLabel("主密码", { exact: true }).inputValue(), "");
    await shootNative(handle, vaultPage, "vault-lock");
    await unlockUi(vaultPage, MASTER);
    await vaultPage.locator(".vw-item").filter({ hasText: "示例邮箱" }).click();
    await vaultPage.getByRole("heading", { name: "示例邮箱", exact: true }).waitFor();
    assert.equal(await vaultPage.locator(".vw-item").count(), 3);
    assert.equal(await vaultPage.locator(".vw-field.is-secret .vw-field-value").innerText(), "••••••••");
    await shootNative(handle, vaultPage, "vault-main");
    await vaultPage.getByRole("button", { name: "上锁", exact: true }).click();
    await vaultPage.locator('.vw[data-screen="locked"]').waitFor();
    await vaultPage.close();

    await page.getByRole("complementary", { name: "主导航" }).getByRole("button", { name: "模板", exact: true }).click();
    const gallery = page.getByRole("dialog", { name: "模板库", exact: true });
    await gallery.getByRole("button", { name: "开发", exact: true }).click();
    await gallery.getByRole("button", { name: "软件开发进程", exact: true }).click();
    await gallery.getByLabel("项目名称", { exact: true }).fill("示例项目");
    await gallery.getByLabel("放在", { exact: true }).selectOption("f-z");
    await shootWorkspace(handle, "template-gallery");
    await gallery.getByRole("button", { name: "使用模板", exact: true }).click();
    await gallery.waitFor({ state: "detached" });
    await page.getByTestId("roadmap-view").waitFor();
    await page.waitForFunction(() => document.querySelector('[data-testid="roadmap-view"]')?.querySelectorAll("[data-entry-id]").length === 8);
    assert.equal(await page.getByLabel("页面标题", { exact: true }).inputValue(), "示例项目 · 开发进程");
    await page.locator(".workspace-scroll").evaluateAll((elements) => elements.forEach((element) => element.scrollTo(0, 0)));
    await shootWorkspace(handle, "roadmap");

    await openPageInSidebar(page, "A 概览");
    const trailing = page.locator(".life-editor .bn-editor .bn-trailing-block");
    if (await trailing.count()) await trailing.last().click();
    else await page.locator(".life-editor .bn-editor > .bn-block-group > .bn-block-outer").last().locator(".bn-inline-content").first().click();
    await page.keyboard.type("/");
    await page.locator(".bn-suggestion-menu [role=option]").first().waitFor();
    await shootWorkspace(handle, "slash-menu");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Backspace");

    await openPageInSidebar(page, "B 笔记");
    await page.locator('section.database-view[data-source-id="ds-inline"] .db-table').waitFor();
    await shootWorkspace(handle, "database-table");
    await page.keyboard.press("Control+Shift+n");
    const capture = page.getByRole("dialog", { name: "快速记录", exact: true });
    await capture.getByLabel("记录标题", { exact: true }).fill("下一步要做的事");
    await capture.getByLabel("记录正文", { exact: true }).fill("把今天的想法记在这里，稍后从收件箱归档。");
    await shootWorkspace(handle, "quick-capture");
    await capture.getByLabel("记录正文", { exact: true }).fill("");
    await page.keyboard.press("Escape");
    await capture.waitFor({ state: "hidden" });
    await page.keyboard.press("Control+,");
    const settings = page.getByRole("dialog", { name: "设置", exact: true });
    await settings.getByRole("radiogroup", { name: "模式", exact: true }).waitFor();
    await shootWorkspace(handle, "settings");
    await settings.getByRole("button", { name: "关闭设置", exact: true }).click();

    const diagnosticTitle = "示例正文宽度核验";
    await page.locator(".private-nav-header").hover();
    await page.locator(".workspace-sidebar").getByRole("button", { name: "新建页面", exact: true }).click();
    const createPage = page.locator(".new-folder-modal");
    await createPage.getByLabel("页面标题", { exact: true }).fill(diagnosticTitle);
    await createPage.getByRole("button", { name: "创建页面", exact: true }).click();
    await page.waitForFunction((title) => document.querySelector(".page-title-input")?.value === title, diagnosticTitle);
    await page.locator(".page-document:not(.is-full-width) > .life-editor .bn-editor").waitFor();
    const loaded = await waitForPersistedPage(page, diagnosticTitle);
    assert.equal(loaded.ok, true, loaded.error?.message);
    const diagnosticPage = loaded.value.workspace.pages.find((entry) => entry.title === diagnosticTitle);
    assert.equal(diagnosticPage.settings.fullWidth, false, "The measured page must be a real newly created ordinary page");
    assert.equal(diagnosticPage.settings.presentationMode, "default");
    assert.equal(Boolean(diagnosticPage.databaseSourceId), false);
    try {
      for (const mode of ["light", "dark"]) {
        await handle.app.evaluate(({ nativeTheme }, source) => { nativeTheme.themeSource = source; }, mode);
        await page.emulateMedia({ colorScheme: mode });
        await page.waitForFunction((dark) => matchMedia("(prefers-color-scheme: dark)").matches === dark, mode === "dark");
        await page.locator(`html[data-theme="${mode}"]`).waitFor();
        await page.evaluate(() => document.fonts.ready);
        const nativeContentSize = await readNativeSize(handle, page);
        const documentColumn = await page.locator(".page-document:not(.is-full-width)").evaluate((element) => {
          const editor = element.querySelector(":scope > .life-editor");
          return { viewport: { width: innerWidth, height: innerHeight }, pageId: editor.dataset.pageId, theme: document.documentElement.dataset.theme, fullWidth: element.classList.contains("is-full-width"), headerWidth: element.querySelector(":scope > .page-document-header").getBoundingClientRect().width, editorWidth: editor.getBoundingClientRect().width };
        });
        console.log(`MANUAL_DOCUMENT_COLUMN ${JSON.stringify({ ...documentColumn, nativeContentSize, storedFullWidth: diagnosticPage.settings.fullWidth })}`);
        assert.deepEqual(nativeContentSize, workspaceSize);
        assert.deepEqual(documentColumn.viewport, { width: 1440, height: 900 });
        assert.equal(documentColumn.theme, mode);
        assert.equal(documentColumn.pageId, diagnosticPage.id);
        assert.equal(documentColumn.fullWidth, false);
        assert.equal(documentColumn.headerWidth, 708, "Ordinary page header must use the specified document column");
        assert.equal(documentColumn.editorWidth, 708, "Ordinary page body must use the specified document column");
      }
    } finally {
      await page.emulateMedia({ colorScheme: null });
      await handle.app.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = "system"; });
    }
    await finish(handle);
    const files = await validateImages(shotsDir, dimensions);
    deliverImages(shotsDir, files);
    console.log(`MANUAL_SCREENSHOTS_PASSED version=1.0.0 images=22 evidence=${shotsDir}`);
  } catch (error) { failure = error; }
  finally {
    for (const handle of handles) {
      if (closeAttempted.has(handle)) continue;
      try { await closeApp(handle, { keepDirs: true }); }
      catch (error) { failure = failure ? new AggregateError([failure, error], "Manual capture and normal close failed") : error; }
    }
  }
  if (failure) { console.log(`MANUAL_SCREENSHOTS_PRESERVED data=${root} evidence=${shotsDir}`); throw failure; }
  for (const directory of temporaryDirectories) removeIsolatedDirectory(directory);
  removeIsolatedDirectory(root);
});
