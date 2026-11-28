import { browserScenario, shootBothModes } from "./harness.mjs";
import { fullWorkspace } from "../fixtures/full-workspace.mjs";

const workspace = fullWorkspace();
workspace.ui.preferences = { theme: "system" };

await browserScenario("wp16-history", async ({ page, check, screenshot, assert }) => {
  await page.clock.install({ time: new Date(2026, 9, 1, 9, 0) });
  await page.reload();
  await page.locator('html[data-la-ready="1"]').waitFor();
  const sidebar = page.getByRole("complementary", { name: "主导航" });
  const openPage = async (title, pageId) => {
    await page.keyboard.press("Control+k");
    const search = page.getByRole("dialog", { name: "全局搜索", exact: true });
    await search.getByRole("combobox", { name: "搜索文件夹、页面与正文" }).fill(title);
    await search.locator(".search-result-row").filter({ has: page.locator("strong", { hasText: title }) }).first().click();
    await search.waitFor({ state: "hidden" });
    await page.waitForFunction((title) => document.querySelector(".page-title-input")?.value === title, title);
    await page.locator(`.life-editor[data-page-id="${pageId}"] .bn-editor`).first().waitFor();
  };
  const history = async () => {
    await page.getByRole("button", { name: "页面操作", exact: true }).click();
    await page.getByRole("menu", { name: "页面操作", exact: true }).getByRole("menuitem", { name: "页面历史", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "页面历史", exact: true });
    await dialog.waitFor();
    return dialog;
  };
  const closeHistory = async (dialog) => { await dialog.getByRole("button", { name: "关闭", exact: true }).click(); await dialog.waitFor({ state: "hidden" }); };
  const restoreVersion = async (dialog) => {
    await dialog.getByRole("button", { name: "恢复此版本", exact: true }).click();
    await page.getByRole("alertdialog", { name: "恢复页面版本", exact: true }).getByRole("button", { name: "恢复此版本", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
  };
  await sidebar.waitFor();

  await check("Editing creates a before-edit version and an idle version", async () => {
    await openPage("A 子页面", "p-a1-child");
    await page.locator('.life-editor[data-page-id="p-a1-child"] .bn-block-outer[data-id="b-a1c-p"] .bn-inline-content').first().click();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("第一次修改");
    const first = await history();
    assert.equal(await first.getByRole("option").count(), 1);
    assert.match(await first.getByRole("option").first().innerText(), /编辑前/);
    await closeHistory(first);
    await page.clock.fastForward("02:30");
    const second = await history();
    assert.equal(await second.getByRole("option").count(), 2);
    assert.match(await second.getByRole("option").first().innerText(), /自动保存/);
    await closeHistory(second);
  });

  await check("The history dialog previews and compares versions", async () => {
    const dialog = await history();
    await dialog.getByRole("option").nth(1).click();
    await dialog.locator(".hist-page .bn-editor").waitFor();
    assert.match(await dialog.locator(".hist-diff").innerText(), /与当前相比：/);
    assert.match(await dialog.locator(".hist-page").innerText(), /子页面正文/);
    assert.doesNotMatch(await dialog.locator(".hist-page").innerText(), /第一次修改/);
    assert.equal(await dialog.locator(".hist-page .bn-editor").getAttribute("contenteditable"), "false");
    await shootBothModes(page, screenshot, "history", { keepVisible: '[aria-label="页面历史"]' });
    await closeHistory(dialog);
  });

  await check("Restoring a version brings back the old content and keeps a pre-restore copy", async () => {
    const dialog = await history();
    await dialog.getByRole("option").filter({ hasText: "编辑前" }).click();
    await restoreVersion(dialog);
    const editor = page.locator('.life-editor[data-page-id="p-a1-child"] .bn-editor').first();
    await editor.waitFor();
    assert.match(await editor.innerText(), /子页面正文/);
    assert.doesNotMatch(await editor.innerText(), /第一次修改/);
    await page.getByRole("status").filter({ hasText: /已恢复到 .* 的版本/ }).waitFor();
    const restored = await history();
    assert.equal(await restored.getByRole("option").count(), 3);
    assert.match(await restored.getByRole("option").first().innerText(), /恢复前/);
    await closeHistory(restored);
  });

  await check("Backlinks list the pages that link here", async () => {
    await openPage("Z 目标页", "p-z1");
    const toggle = page.getByRole("button", { name: "1 个反向链接", exact: true });
    await toggle.waitFor();
    assert.equal(await toggle.getAttribute("aria-expanded"), "false");
    await toggle.click();
    const links = page.getByRole("list", { name: "反向链接", exact: true });
    assert.match(await links.innerText(), /A 概览/);
    assert.match(await links.innerText(), /提及：Z 目标页/);
    await shootBothModes(page, screenshot, "backlinks");
    await links.getByRole("button", { name: "A 概览", exact: true }).click();
    await page.waitForFunction(() => document.querySelector(".page-title-input")?.value === "A 概览");
    const destination = page.locator('.life-editor[data-page-id="p-a1"] .bn-block-outer[data-id="b-a1-p"].is-link-target');
    await destination.waitFor();
    const feedback = await destination.evaluate((el) => {
      const block = el.querySelector(":scope > .bn-block");
      return { background: getComputedStyle(block).backgroundColor, cueWidth: getComputedStyle(block, "::before").width,
        selected: Boolean(el.querySelector(".ProseMirror-selectednode")) };
    });
    assert.deepEqual(feedback, { background: "rgba(0, 0, 0, 0)", cueWidth: "2px", selected: false });
  });

  await check("New links and trashed sources update the count", async () => {
    await openPage("B 笔记", "p-b1");
    const editor = page.locator('.life-editor[data-page-id="p-b1"] .bn-editor').first();
    const trailing = editor.locator(".bn-trailing-block");
    if (await trailing.count()) await trailing.last().click();
    else { await editor.locator(".bn-inline-content").last().click(); await page.keyboard.press("Control+End"); await page.keyboard.press("Enter"); }
    await page.keyboard.type("@Z 目标");
    await page.locator(".bn-suggestion-menu").getByRole("option").filter({ hasText: "Z 目标页" }).first().click();
    await page.clock.fastForward("00:01");
    await openPage("Z 目标页", "p-z1");
    await page.getByRole("button", { name: "2 个反向链接", exact: true }).waitFor();
    await openPage("A 概览", "p-a1");
    await page.getByRole("button", { name: "页面操作", exact: true }).click();
    await page.getByRole("menu", { name: "页面操作", exact: true }).getByRole("menuitem", { name: "移到回收站", exact: true }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "移到回收站", exact: true }).click();
    await page.clock.fastForward("00:01");
    await openPage("Z 目标页", "p-z1");
    await page.getByRole("button", { name: "1 个反向链接", exact: true }).waitFor();
  });

  await check("Browser mode keeps history only for the session", async () => {
    await openPage("B 笔记", "p-b1");
    const before = await history();
    assert.ok(await before.getByRole("option").count() > 0);
    await closeHistory(before);
    await page.reload();
    await page.locator('html[data-la-ready="1"]').waitFor();
    await openPage("B 笔记", "p-b1");
    const dialog = await history();
    assert.equal(await dialog.getByRole("option").count(), 0);
    assert.match(await dialog.innerText(), /这个页面还没有历史版本。编辑后会自动保存版本。/);
    assert.match(await dialog.innerText(), /浏览器模式下的历史只保存在本次打开期间，刷新后消失。/);
    await closeHistory(dialog);
  });
}, { workspace, viewport: { width: 1440, height: 900 } });
