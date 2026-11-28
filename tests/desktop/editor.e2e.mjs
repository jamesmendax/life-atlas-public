import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fullWorkspace } from "../fixtures/full-workspace.mjs";
import { upgradeWorkspace } from "../../src/persistence/migrations.js";
import { REPO_ROOT, createIsolatedDirectory, seedWorkspaceDatabase, launchApp, closeApp, readNetworkLog, queueDialogResponse, readDialogCalls, openPageInSidebar, assertNoNetworkAndErrors, shootWindowBothModes } from "./helpers.mjs";

const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const remoteUrls = ["https://example.com/a.png", "https://example.com/a.mp4", "https://example.com/a.mp3", "https://example.com/a.pdf"];

async function editorCase(context, { remote = false } = {}) {
  const dataRoot = createIsolatedDirectory("editor-e2e");
  let handle;
  context.after(async () => {
    if (!handle?.complete) console.log(`LIFE_ATLAS_TEST_FAILURE_ROOTS ${JSON.stringify({ test: context.name, dataRoot, bootstrapDir: handle?.bootstrapDir, tempDir: handle?.tempDir })}`);
    if (handle) await closeApp(handle, { keepDirs: !handle.complete });
  });
  const workspace = upgradeWorkspace(fullWorkspace());
  workspace.ui.preferences = { theme: "system" };
  if (remote) workspace.pages.find((page) => page.id === "p-a1-child").content.push(...["image", "video", "audio", "file"].map((type, index) => ({ id: `remote-${type}`, type, props: { url: remoteUrls[index], name: `远程${type}` }, children: [] })));
  await seedWorkspaceDatabase(dataRoot, workspace);
  handle = await launchApp({ packaged: true, dataRoot });
  handle.complete = false;
  await handle.page.locator('html[data-la-ready="1"]').waitFor();
  await handle.page.locator(".workspace-sidebar").waitFor();
  await handle.page.setViewportSize({ width: 1440, height: 900 });
  return handle;
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

async function newEmptyLine(page) {
  const trailing = page.locator(".bn-editor .bn-trailing-block");
  if (await trailing.count()) { await trailing.last().click(); return; }
  await page.locator(".bn-editor > .bn-block-group > .bn-block-outer").last().locator(".bn-inline-content").first().click();
}

async function pasteRemoteImage(page) {
  await newEmptyLine(page);
  await page.evaluate(() => {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/html", '<p>粘贴远程图片</p><img src="https://example.com/x.png">');
    document.activeElement.dispatchEvent(new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }));
  });
  await page.locator('.life-editor [data-content-type="image"] img[src^="data:image/svg+xml"]').nth(1).waitFor();
}

async function assertRemoteBlocks(page) {
  for (const type of ["image", "video", "audio", "file"]) await page.locator(`.bn-block-outer[data-id="remote-${type}"] [data-content-type="${type}"]`).waitFor();
  await page.locator('.bn-block-outer[data-id="remote-image"] img[src^="data:image/svg+xml"]').waitFor();
}

test("remote media never reaches the network", { timeout: 60000 }, async (context) => {
  const handle = await editorCase(context, { remote: true });
  await openChildPage(handle.page);
  await assertRemoteBlocks(handle.page);
  await pasteRemoteImage(handle.page);
  await pause(2000);
  const log = await readNetworkLog(handle);
  assert.deepEqual(log.completed.filter(({ url }) => url.includes("example.com")), []);
  assert.deepEqual(log.blocked.filter(({ url }) => url.includes("example.com")), []);
  await assertNoNetworkAndErrors(handle, { allowedUrls: [] });
  handle.complete = true;
});

test("copying remote media stays on this computer", { timeout: 60000 }, async (context) => {
  const handle = await editorCase(context, { remote: true });
  await openChildPage(handle.page);
  await assertRemoteBlocks(handle.page);
  await handle.page.getByText("子页面正文", { exact: true }).click();
  await handle.page.keyboard.press("Control+a");
  if (process.env.LIFE_ATLAS_QA_ISOLATE_CLIPBOARD === "1") {
    const copied = await handle.page.evaluate(() => {
      const data = new DataTransfer();
      document.activeElement.dispatchEvent(new ClipboardEvent("copy", { clipboardData: data, bubbles: true, cancelable: true }));
      return { text: data.getData("text/plain"), html: data.getData("text/html") };
    });
    assert.ok(copied.text.length || copied.html.length);
  } else {
    await handle.page.keyboard.press("Control+c");
  }
  await pause(2000);
  const log = await readNetworkLog(handle);
  assert.deepEqual(log.completed.filter(({ url }) => url.includes("example.com")), []);
  await assertNoNetworkAndErrors(handle, { allowedUrls: remoteUrls });
  handle.complete = true;
});

test("code highlighting and equations work under the desktop CSP", { timeout: 60000 }, async (context) => {
  const handle = await editorCase(context);
  const page = handle.page;
  const suggestions = page.locator('.bn-suggestion-menu[role="listbox"]').getByRole("option");
  await openChildPage(page);
  await newEmptyLine(page);
  await page.keyboard.type("/code");
  await suggestions.first().waitFor();
  await page.keyboard.press("Enter");
  const code = page.locator('.life-editor [data-content-type="codeBlock"]').last();
  await code.locator("select").selectOption({ label: "JavaScript" });
  await code.locator(".bn-inline-content").click();
  await page.keyboard.type("const a = 1;");
  await code.locator("span[style]").first().waitFor();
  await newEmptyLine(page);
  await page.keyboard.type("/公式区块");
  await suggestions.first().waitFor();
  await page.keyboard.press("Enter");
  await page.keyboard.type("\\frac{1}{2}");
  await page.locator(".life-equation-rendered .katex").waitFor();
  await newEmptyLine(page);
  await page.keyboard.type(":sm");
  await page.locator(".bn-grid-suggestion-menu").waitFor();
  assert.deepEqual(handle.errors.console.filter((message) => message.includes("Content Security Policy")), []);
  await shootWindowBothModes(handle, "desktop-editor", { shotsDir: path.join(REPO_ROOT, ".qa/WP-14/shots") });
  await assertNoNetworkAndErrors(handle);
  handle.complete = true;
});

test("slash menu scrolls to the last item anywhere in the window", { timeout: 60000 }, async (context) => {
  const handle = await editorCase(context);
  const page = handle.page;
  await handle.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 900));
  await openPageInSidebar(page, "A 概览");
  const menu = page.locator(".bn-suggestion-menu");
  const observeMenu = async () => page.evaluate(() => {
    window.__wp14MenuResizeObserver?.disconnect();
    window.__wp14MenuAttachObserver?.disconnect();
    window.__wp14MenuHeights = [];
    const attach = () => {
      const element = document.querySelector(".bn-suggestion-menu");
      if (!element) return;
      window.__wp14MenuResizeObserver = new ResizeObserver((entries) => window.__wp14MenuHeights.push(entries[0].contentRect.height));
      window.__wp14MenuResizeObserver.observe(element);
      window.__wp14MenuAttachObserver.disconnect();
    };
    window.__wp14MenuAttachObserver = new MutationObserver(attach);
    window.__wp14MenuAttachObserver.observe(document.body, { childList: true, subtree: true });
    attach();
  });
  const assertBottom = async (operation) => {
    const geometry = await menu.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const last = [...element.querySelectorAll('[role="option"]')].at(-1);
      const lastRect = last.getBoundingClientRect();
      const footer = getComputedStyle(element, "::after");
      const footerHeight = footer.boxSizing === "border-box" ? parseFloat(footer.height) : parseFloat(footer.height) + parseFloat(footer.paddingTop) + parseFloat(footer.paddingBottom) + parseFloat(footer.borderTopWidth);
      return { top: rect.top, bottom: rect.bottom, viewport: document.documentElement.clientHeight, scrollTop: element.scrollTop, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight, lastTop: lastRect.top, lastBottom: lastRect.bottom, visibleBottom: rect.bottom - footerHeight + 4 };
    });
    assert.ok(geometry.top >= 0 && geometry.bottom <= geometry.viewport + 1, `${operation}: menu stays in the window`);
    assert.ok(geometry.scrollTop >= geometry.scrollHeight - geometry.clientHeight - 1, `${operation}: actual user scrolling reaches the bottom ${JSON.stringify(geometry)}`);
    assert.ok(geometry.lastTop >= geometry.top && geometry.lastBottom <= geometry.visibleBottom + 1, `${operation}: last option is entirely visible above the footer ${JSON.stringify(geometry)}`);
  };
  const wheelToBottom = async () => {
    const rect = await menu.boundingBox();
    assert.ok(rect);
    await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
    for (let count = 0; count < 40; count += 1) { await page.mouse.wheel(0, 200); await pause(50); }
  };
  await observeMenu();
  const lastBlock = page.locator(".bn-editor > .bn-block-group > .bn-block-outer").last();
  await lastBlock.scrollIntoViewIfNeeded();
  const lastRect = await lastBlock.boundingBox();
  assert.ok(lastRect);
  await page.mouse.click(lastRect.x + 20, lastRect.y + lastRect.height + 20);
  await page.keyboard.type("/");
  await menu.waitFor();
  await pause(500);
  await wheelToBottom();
  await assertBottom("lower-cursor wheel");
  console.log(`WP14_SLASH_RESIZES=${JSON.stringify(await page.evaluate(() => window.__wp14MenuHeights))}`);

  await menu.evaluate((element) => { element.scrollTop = 0; });
  const rect = await menu.boundingBox();
  await page.mouse.move(rect.x + rect.width - 4, rect.y + 16);
  await page.mouse.down();
  for (let position = rect.y + 20; position <= rect.y + rect.height - 2; position += 4) await page.mouse.move(rect.x + rect.width - 4, position);
  await page.mouse.move(rect.x + rect.width - 4, rect.y + rect.height - 2);
  await page.mouse.up();
  await assertBottom("scrollbar drag");

  await page.keyboard.press("Escape");
  const first = page.locator(".bn-editor > .bn-block-group > .bn-block-outer").first().locator(".bn-inline-content").first();
  await first.evaluate((element) => {
    const scroll = element.closest(".workspace-scroll");
    scroll.scrollTop += element.getBoundingClientRect().top - 150;
  });
  await first.click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await observeMenu();
  await page.keyboard.type("/");
  await menu.waitFor();
  await pause(500);
  await wheelToBottom();
  await assertBottom("upper-cursor wheel");
  console.log(`WP14_SLASH_RESIZES=${JSON.stringify(await page.evaluate(() => window.__wp14MenuHeights))}`);
  await assertNoNetworkAndErrors(handle);
  handle.complete = true;
});

test("double clicking remote media asks before opening", { timeout: 60000 }, async (context) => {
  const handle = await editorCase(context, { remote: true });
  await openChildPage(handle.page);
  await assertRemoteBlocks(handle.page);
  await queueDialogResponse(handle, "showMessageBox", { response: 0 });
  await handle.page.locator('.bn-block-outer[data-id="remote-image"] img').dblclick();
  const deadline = Date.now() + 5000;
  let calls;
  do { calls = await readDialogCalls(handle); if (calls.some((call) => call.kind === "openExternal")) break; await pause(50); } while (Date.now() < deadline);
  const prompts = calls.filter((call) => call.kind === "showMessageBox" && call.options?.detail === "https://example.com/a.png");
  const opened = calls.filter((call) => call.kind === "openExternal" && call.options?.url === "https://example.com/a.png");
  assert.equal(prompts.length, 1);
  assert.equal(opened.length, 1);
  assert.ok(calls.indexOf(prompts[0]) < calls.indexOf(opened[0]));
  await assertNoNetworkAndErrors(handle);
  handle.complete = true;
});
