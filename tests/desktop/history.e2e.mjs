import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fullWorkspace } from "../fixtures/full-workspace.mjs";
import { upgradeWorkspace } from "../../src/persistence/migrations.js";
import { assertNoNetworkAndErrors, closeApp, createIsolatedDirectory, launchApp, removeIsolatedDirectory, seedWorkspaceDatabase } from "./helpers.mjs";

async function historyCase(context) {
  const dataRoot = createIsolatedDirectory("history-e2e-data");
  const bootstrapDir = createIsolatedDirectory("history-e2e-bootstrap");
  const state = { dataRoot, bootstrapDir, handle: null, packaged: true, complete: false };
  context.after(async () => {
    if (!state.complete) console.log(`LIFE_ATLAS_TEST_FAILURE_ROOTS ${JSON.stringify({ test: context.name, dataRoot, bootstrapDir, tempDir: state.handle?.tempDir })}`);
    if (state.handle) await closeApp(state.handle, { keepDirs: !state.complete });
    else if (state.complete) for (const directory of [dataRoot, bootstrapDir]) if (fs.existsSync(directory)) removeIsolatedDirectory(directory);
  });
  const workspace = upgradeWorkspace(fullWorkspace());
  workspace.ui.preferences = { theme: "system" };
  await seedWorkspaceDatabase(dataRoot, workspace);
  state.handle = await launchApp({ packaged: state.packaged, dataRoot, bootstrapDir });
  await state.handle.page.locator('html[data-la-ready="1"]').waitFor();
  return state;
}

async function openChildPage(page) {
  await page.keyboard.press("Control+k");
  const search = page.getByRole("dialog", { name: "全局搜索", exact: true });
  await search.getByRole("combobox", { name: "搜索文件夹、页面与正文" }).fill("A 子页面");
  await search.locator(".search-result-row").filter({ has: page.locator("strong", { hasText: "A 子页面" }) }).first().click();
  await search.waitFor({ state: "hidden" });
  await page.locator('.life-editor[data-page-id="p-a1-child"] .bn-editor').first().waitFor();
  assert.equal(await page.getByLabel("页面标题", { exact: true }).inputValue(), "A 子页面");
}

async function historyDialog(page) {
  await page.getByRole("button", { name: "页面操作", exact: true }).click();
  await page.getByRole("menu", { name: "页面操作", exact: true }).getByRole("menuitem", { name: "页面历史", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "页面历史", exact: true });
  await dialog.waitFor();
  return dialog;
}

async function editChildPage(page) {
  await openChildPage(page);
  await page.locator('.life-editor[data-page-id="p-a1-child"] .bn-block-outer[data-id="b-a1c-p"] .bn-inline-content').first().click();
  await page.keyboard.press("End");
  await page.waitForFunction(() => {
    const block = document.querySelector('.life-editor[data-page-id="p-a1-child"] .bn-block-outer[data-id="b-a1c-p"] .bn-inline-content');
    const nativeSelection = window.getSelection();
    const editorSelection = block?.closest(".bn-editor")?.editor?.state?.selection;
    return block && nativeSelection?.isCollapsed && block.contains(nativeSelection.anchorNode)
      && nativeSelection.anchorOffset === block.textContent.length && editorSelection?.empty
      && editorSelection.$from.parent.textContent === block.textContent
      && editorSelection.$from.parentOffset === block.textContent.length;
  });
  await page.keyboard.press("Enter");
  await page.keyboard.type("桌面修改");
  await page.getByText("桌面修改", { exact: true }).waitFor();
}

async function restart(state) {
  const previous = state.handle;
  await assertNoNetworkAndErrors(previous);
  await closeApp(previous, { keepDirs: true });
  removeIsolatedDirectory(previous.tempDir);
  state.handle = null;
  state.handle = await launchApp({ packaged: state.packaged, dataRoot: state.dataRoot, bootstrapDir: state.bootstrapDir });
  await state.handle.page.locator('html[data-la-ready="1"]').waitFor();
  return state.handle.page;
}

test("page versions survive a restart", { timeout: 90000 }, async (context) => {
  const state = await historyCase(context);
  await editChildPage(state.handle.page);
  const page = await restart(state);
  await openChildPage(page);
  const dialog = await historyDialog(page);
  const versions = await dialog.getByRole("option").allTextContents();
  assert.equal(versions.length, 2);
  assert.match(versions[0], /自动保存/);
  assert.match(versions[1], /编辑前/);
  assert.doesNotMatch(await dialog.innerText(), /浏览器模式下的历史/);
  await assertNoNetworkAndErrors(state.handle);
  state.complete = true;
});

test("restoring on desktop is saved to the database", { timeout: 120000 }, async (context) => {
  const state = await historyCase(context);
  await editChildPage(state.handle.page);
  let page = await restart(state);
  await openChildPage(page);
  const dialog = await historyDialog(page);
  await dialog.getByRole("option").filter({ hasText: "编辑前" }).click();
  await dialog.getByRole("button", { name: "恢复此版本", exact: true }).click();
  await page.getByRole("alertdialog", { name: "恢复页面版本", exact: true }).getByRole("button", { name: "恢复此版本", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  page = await restart(state);
  await openChildPage(page);
  const editor = page.locator('.life-editor[data-page-id="p-a1-child"] .bn-editor').first();
  assert.match(await editor.innerText(), /子页面正文/);
  assert.doesNotMatch(await editor.innerText(), /桌面修改/);
  const restored = await historyDialog(page);
  assert.equal(await restored.getByRole("option").count(), 3);
  assert.match(await restored.getByRole("option").first().innerText(), /恢复前/);
  await assertNoNetworkAndErrors(state.handle);
  state.complete = true;
});
