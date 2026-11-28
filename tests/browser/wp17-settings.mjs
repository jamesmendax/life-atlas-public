import { browserScenario, answerProductDialog } from "./harness.mjs";
import { changeLayout } from "./database-navigation.mjs";
import { fullWorkspace } from "../fixtures/full-workspace.mjs";
import { SHORTCUTS } from "../../src/editor/shortcuts.js";
import packageInfo from "../../package.json" with { type: "json" };

const workspace = fullWorkspace();
workspace.ui.preferences = { theme: "system" };
workspace.dataSources.find((source) => source.id === "ds-full").properties.push({ id: "launch", name: "发布日期", type: "date", options: [], config: {} });
for (const [id, start] of [["i-3", "2026-09-10"], ["i-4", "2026-10-20"]]) {
  workspace.databaseItems.find((item) => item.id === id).values.launch = { start, end: null, includeTime: false, timeZone: null };
}
workspace.pages.find((entry) => entry.id === "p-b1").content.push(
  { id: "wp17-code", type: "codeBlock", props: { language: "javascript" }, content: [{ type: "text", text: "const knowledge = 'local';", styles: {} }], children: [] },
  { id: "wp17-equation", type: "equation", props: {}, content: [{ type: "text", text: "E = mc^2", styles: {} }], children: [] },
);

await browserScenario("wp17-settings", async ({ page, check, screenshot, persisted, assert }) => {
  const nativeDialogs = [];
  page.on("dialog", async (dialog) => { nativeDialogs.push(dialog.type()); await dialog.dismiss(); });
  const sidebar = page.getByRole("complementary", { name: "主导航" });
  const openPage = async (title, pageId) => {
    await page.keyboard.press("Control+k");
    const dialog = page.getByRole("dialog", { name: "全局搜索", exact: true });
    await dialog.getByRole("combobox", { name: "搜索文件夹、页面与正文" }).fill(title);
    await dialog.locator(".search-result-row").filter({ has: page.locator("strong", { hasText: title }) }).first().click();
    await dialog.waitFor({ state: "hidden" });
    await page.waitForFunction((expected) => document.querySelector(".page-title-input")?.value === expected, title);
    if (pageId !== "p-db") await page.locator(`.life-editor[data-page-id="${pageId}"] .bn-editor`).first().waitFor();
  };
  const settings = async () => {
    await page.keyboard.press("Control+,");
    const dialog = page.getByRole("dialog", { name: "设置", exact: true });
    await dialog.waitFor();
    return dialog;
  };
  const closeSettings = async (dialog) => { await dialog.getByRole("button", { name: "关闭设置", exact: true }).click(); await dialog.waitFor({ state: "hidden" }); };
  const pageMenu = async () => { await page.getByRole("button", { name: "页面操作", exact: true }).click(); return page.getByRole("menu", { name: "页面操作", exact: true }); };
  const setMode = async (dialog, label, expected) => {
    await dialog.getByRole("radiogroup", { name: "模式", exact: true }).getByRole("radio", { name: label, exact: true }).click();
    await page.waitForFunction((mode) => document.documentElement.dataset.theme === mode, expected);
  };
  const measure = async (selector, background) => {
    const target = page.locator(selector).first();
    await target.waitFor();
    const result = await target.evaluate((element, background) => {
      let current = element;
      let color;
      while (current) {
        color = getComputedStyle(current)[background ? "backgroundColor" : "color"];
        const components = color.match(/[\d.]+/g)?.map(Number) || [];
        if (!background || components.length < 4 || components[3] >= 1) break;
        current = current.parentElement;
      }
      const channels = (color?.match(/[\d.]+/g) || ["255", "255", "255"]).slice(0, 3).map((value) => {
        const channel = Number(value) / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
      return { color, luminance: channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722 };
    }, background);
    console.log(`WP17_LUMINANCE ${selector} ${JSON.stringify(result)}`);
    assert.ok(background ? result.luminance >= 0.75 : result.luminance <= 0.35, `${selector}: ${result.luminance}`);
  };
  await sidebar.waitFor();

  await check("Mode switches immediately and persists", async () => {
    await openPage("A 概览", "p-a1");
    let dialog = await settings();
    await setMode(dialog, "白天", "light");
    await page.waitForFunction(() => document.querySelector('.life-editor[data-page-id="p-a1"] .bn-container')?.dataset.colorScheme === "light");
    assert.equal(await page.locator(".header-theme-toggle").getAttribute("title"), "外观：白天");
    await persisted((value) => value.ui.preferences.theme === "light");
    await closeSettings(dialog);
    await page.reload();
    await page.locator('html[data-la-ready="1"][data-theme="light"]').waitFor();
    assert.equal(await page.locator(".header-theme-toggle").getAttribute("title"), "外观：白天");
    dialog = await settings();
    await setMode(dialog, "跟随系统", "light");
    await page.emulateMedia({ colorScheme: "dark" });
    await page.locator('html[data-theme="dark"]').waitFor();
    await page.emulateMedia({ colorScheme: "light" });
    await page.locator('html[data-theme="light"]').waitFor();
    await closeSettings(dialog);
  });

  await check("Daytime has no dark surfaces", async () => {
    await openPage("B 笔记", "p-b1");
    for (const selector of [".workspace-sidebar", ".workspace-pane", ".page-document", ".db-table"]) await measure(selector, true);
    for (const selector of [".page-title-input", '.page-tree-row[aria-selected="true"] .workspace-tree-label', ".db-table tbody td"]) await measure(selector, false);
    await sidebar.locator(".workspace-switcher").click();
    await measure(".ui-popover", true);
    await page.keyboard.press("Escape");
    const dialog = await settings();
    await measure(".ui-dialog", true);
    assert.equal(Math.round((await dialog.boundingBox()).width), 940);
    assert.equal(Math.round((await dialog.boundingBox()).height), 640);
    await closeSettings(dialog);
  });

  await check("Daytime screenshots cover the main surfaces", async () => {
    await openPage("A 概览", "p-a1");
    await screenshot("light-sidebar-page");
    await openPage("整页项目库", "p-db");
    const database = page.locator('section.database-view[data-source-id="ds-full"]');
    for (const type of ["table", "board", "calendar", "roadmap"]) {
      await changeLayout(database, type);
      await page.waitForFunction((type) => document.querySelector('section.database-view[data-source-id="ds-full"]')?.dataset.viewType === type, type);
      if (type === "roadmap") await database.getByTestId("roadmap-view").waitFor();
      await screenshot(`light-${type}`);
    }
    await changeLayout(database, "table");
    await sidebar.getByRole("button", { name: "模板", exact: true }).click();
    await page.getByRole("dialog", { name: "模板库", exact: true }).waitFor();
    await screenshot("light-templates");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Control+k");
    await page.getByRole("dialog", { name: "全局搜索", exact: true }).waitFor();
    await screenshot("light-search");
    await page.keyboard.press("Escape");
    const dialog = await settings();
    await screenshot("light-settings");
    await closeSettings(dialog);
    await openPage("A 概览", "p-a1");
    await (await pageMenu()).getByRole("menuitem", { name: "移到回收站", exact: true }).click();
    await page.locator('[data-la-dialog="confirm"]').waitFor();
    await screenshot("light-confirm");
    await page.keyboard.press("Escape");
    await page.locator(".page-title-input").fill("A 概览 · 设置验收");
    await (await pageMenu()).getByRole("menuitem", { name: "页面历史", exact: true }).click();
    const history = page.getByRole("dialog", { name: "页面历史", exact: true });
    await history.locator(".hist-page .bn-editor").waitFor();
    await screenshot("light-history");
    await page.keyboard.press("Escape");
    await page.locator(".page-title-input").fill("A 概览");
    await openPage("B 笔记", "p-b1");
    await page.locator(".life-equation-rendered .katex").waitFor();
    const codeBlock = page.locator('[data-content-type="codeBlock"]').first();
    await codeBlock.locator(".shiki").first().waitFor();
    await codeBlock.evaluate((element) => element.scrollIntoView({ block: "center" }));
    for (const target of [codeBlock, page.locator(".life-equation-rendered .katex").first()]) {
      const bounds = await target.boundingBox();
      assert.ok(bounds && bounds.y >= 0 && bounds.y + bounds.height <= 900, "Code and equation must both be visible in their evidence screenshot");
    }
    await screenshot("light-code-equation");
  });

  await check("Settings sections all do something", async () => {
    let dialog = await settings();
    await setMode(dialog, "白天", "light");
    await dialog.getByRole("radiogroup", { name: "默认字体", exact: true }).getByRole("radio", { name: "等宽", exact: true }).click();
    await persisted((value) => value.ui.preferences.defaultFont === "mono");
    await closeSettings(dialog);
    await sidebar.getByRole("button", { name: "新建页面", exact: true }).click();
    const createDialog = page.locator(".new-folder-modal");
    await createDialog.getByRole("textbox", { name: "页面标题", exact: true }).fill("默认等宽页面");
    await createDialog.getByRole("button", { name: "创建页面", exact: true }).click();
    await createDialog.waitFor({ state: "hidden" });
    const created = await persisted((value) => value.pages.some((entry) => !workspace.pages.some((old) => old.id === entry.id) && entry.settings.fontFamily === "mono"));
    assert.equal(created.pages.find((entry) => entry.id === created.ui.selectedPageId).settings.fontFamily, "mono");
    dialog = await settings();
    await dialog.getByLabel("启动时打开", { exact: true }).selectOption("home");
    await persisted((value) => value.ui.preferences.startPage === "home");
    await closeSettings(dialog);
    await page.reload();
    await page.locator(".home-page").waitFor();
    dialog = await settings();
    await dialog.getByRole("tab", { name: "工作区", exact: true }).click();
    await dialog.getByLabel("工作区名称", { exact: true }).fill("设置改名");
    await dialog.getByRole("button", { name: "保存工作区", exact: true }).click();
    await persisted((value) => value.ui.workspaceName === "设置改名");
    assert.equal(await sidebar.locator(".workspace-name").innerText(), "设置改名");
    await dialog.getByRole("tab", { name: "快捷键", exact: true }).click();
    assert.equal(await dialog.getByRole("table", { name: "快捷键", exact: true }).locator("tbody tr").count(), SHORTCUTS.length);
    await dialog.getByRole("tab", { name: "关于", exact: true }).click();
    assert.match(await dialog.getByRole("table", { name: "版本信息", exact: true }).innerText(), new RegExp(packageInfo.version.replaceAll(".", "\\.")));
    assert.equal(await dialog.getByRole("tab", { name: "数据", exact: true }).count(), 0);
    await dialog.getByRole("tab", { name: "密钥库", exact: true }).click();
    assert.match(await dialog.innerText(), /仅桌面版可用/);
    await dialog.getByRole("tab", { name: "备份", exact: true }).click();
    await dialog.getByRole("button", { name: "打开备份与恢复…", exact: true }).click();
    await page.getByRole("dialog", { name: "备份与恢复", exact: true }).waitFor();
    await page.keyboard.press("Escape");
  });

  await check("Product dialogs replace native dialogs", async () => {
    await openPage("Z 目标页", "p-z1");
    await (await pageMenu()).getByRole("menuitem", { name: "移到回收站", exact: true }).click();
    let dialog = page.locator('[data-la-dialog="confirm"]');
    await dialog.waitFor();
    assert.equal(await dialog.getByRole("button", { name: "移到回收站", exact: true }).evaluate((button) => document.activeElement === button), true);
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    await persisted((value) => !value.pages.find((entry) => entry.id === "p-z1").trashedAt);
    await (await pageMenu()).getByRole("menuitem", { name: "移到回收站", exact: true }).click();
    await answerProductDialog(page);
    await persisted((value) => Boolean(value.pages.find((entry) => entry.id === "p-z1").trashedAt));
    assert.deepEqual(nativeDialogs, []);
  });
}, { workspace, viewport: { width: 1440, height: 900 } });
