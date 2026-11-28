import { readFileSync } from "node:fs";
import JSZip from "jszip";
import { browserScenario, shootBothModes } from "./harness.mjs";
import { fullWorkspace, FIXTURE_TIME } from "../fixtures/full-workspace.mjs";
import { buildNotionExportZip, buildHtmlExportZip } from "../fixtures/notion-export.mjs";

const workspace = fullWorkspace();
workspace.ui.preferences = { theme: "system" };

await browserScenario("wp18-import-export", async ({ page, check, screenshot, saved, persisted, assert }) => {
  const sidebar = page.getByRole("complementary", { name: "主导航" });
  const menuAction = async (name) => { await sidebar.locator(".workspace-switcher").click(); await page.getByRole("menu", { name: "工作区菜单", exact: true }).getByRole("menuitem", { name, exact: true }).click(); };
  const searchPage = async (title) => {
    await page.keyboard.press("Control+k");
    const dialog = page.getByRole("dialog", { name: "全局搜索", exact: true });
    await dialog.getByRole("combobox", { name: "搜索文件夹、页面与正文" }).fill(title);
    await dialog.locator(".search-result-row").filter({ has: page.locator("strong", { hasText: title }) }).first().click();
    await dialog.waitFor({ state: "hidden" });
    await page.waitForFunction((title) => document.querySelector(".page-title-input")?.value === title, title);
  };
  await sidebar.waitFor();

  await check("A notion export is previewed and imported", async () => {
    await menuAction("从 Notion 导入…");
    const dialog = page.getByRole("dialog", { name: "从 Notion 导入", exact: true });
    await dialog.getByLabel("选择 Notion 导出文件", { exact: true }).setInputFiles({ name: "notion.zip", mimeType: "application/zip", buffer: Buffer.from(await buildNotionExportZip()) });
    await dialog.getByRole("button", { name: "导入", exact: true }).waitFor();
    for (const [label, value] of [["页面", "3"], ["数据库", "1"], ["记录", "5"], ["附件", "3"]]) assert.equal(await dialog.locator(`[data-count="${label}"] dd`).innerText(), value);
    assert.match(await dialog.locator('[data-count="附件大小"] dd').innerText(), /6\.1\s*KB/);
    await shootBothModes(page, screenshot, "import", { keepVisible: ".ui-dialog" });
    await dialog.getByRole("button", { name: "导入", exact: true }).click();
    await dialog.getByRole("status").filter({ hasText: "已导入 3 个页面、1 个数据库（5 条记录）、3 个附件" }).waitFor();
    const imported = await persisted((value) => value.folders.some((folder) => /^从 Notion 导入 \d{4}-\d{2}-\d{2}$/.test(folder.name)));
    const folder = imported.folders.find((entry) => /^从 Notion 导入 \d{4}-\d{2}-\d{2}$/.test(entry.name));
    assert.ok(await sidebar.locator(`[data-node-id="${folder.id}"]`).isVisible());
    await dialog.getByRole("button", { name: "打开导入的文件夹", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
  });

  await check("Imported content looks right", async () => {
    await searchPage("项目总览");
    const editor = page.locator(".life-editor .bn-editor").first();
    await editor.locator(".life-callout").waitFor();
    assert.match(await editor.locator(".life-callout").innerText(), /提示：这是一个标注/);
    assert.ok(await editor.locator(".katex").count() > 0);
    assert.ok(await editor.locator('table').count() > 0);
    assert.ok(await editor.locator('[data-content-type="codeBlock"]').count() > 0);
    await page.waitForFunction(() => [...document.querySelectorAll(".life-editor img")].some((image) => image.naturalWidth > 0));
    await editor.locator(".life-page-link-block").filter({ hasText: "会议记录" }).click();
    await page.waitForFunction(() => document.querySelector(".page-title-input")?.value === "会议记录");
    assert.match(await page.locator(".life-editor").first().innerText(), /回到|第一条|子条目/);
    await searchPage("任务库");
    const table = page.locator(".database-view .db-table").first();
    await table.waitFor();
    assert.equal(await table.locator("tbody tr[data-item-id]").count(), 5);
    const value = await saved();
    const source = value.dataSources.find((entry) => entry.title === "任务库");
    const tag = source.properties.find((property) => property.name === "标签");
    const cells = table.locator(`td[data-property-id="${tag.id}"]`);
    assert.match((await cells.allTextContents()).join("\n"), /前端/);
    assert.match((await cells.allTextContents()).join("\n"), /后端/);
    await searchPage("项目总览");
    await shootBothModes(page, screenshot, "notion-imported");
  });

  await check("Html exports are refused", async () => {
    await menuAction("从 Notion 导入…");
    const dialog = page.getByRole("dialog", { name: "从 Notion 导入", exact: true });
    await dialog.getByLabel("选择 Notion 导出文件", { exact: true }).setInputFiles({ name: "html.zip", mimeType: "application/zip", buffer: Buffer.from(await buildHtmlExportZip()) });
    await dialog.getByRole("alert").filter({ hasText: "这是 HTML 格式的导出包" }).waitFor();
    assert.equal(await dialog.getByRole("button", { name: "导入", exact: true }).count(), 0);
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
  });

  await check("The workspace exports to a markdown zip", async () => {
    await menuAction("导出为 Markdown…");
    const dialog = page.getByRole("dialog", { name: "导出为 Markdown", exact: true });
    await dialog.waitFor();
    await shootBothModes(page, screenshot, "markdown-export", { keepVisible: ".ui-dialog" });
    const download = page.waitForEvent("download");
    await dialog.getByRole("button", { name: "导出", exact: true }).click();
    const completed = await download;
    const filePath = await completed.path();
    const zip = await JSZip.loadAsync(readFileSync(filePath));
    assert.ok(zip.file("README.md"));
    assert.ok(zip.file("A 项目/A 概览.md"));
    assert.match(await zip.file("A 项目/A 概览.md").async("string"), /id: "p-a1"/);
    assert.equal(Object.values(zip.files).some((file) => file.dir), false);
    await dialog.getByRole("status").filter({ hasText: "已下载" }).waitFor();
    assert.match(await dialog.getByRole("status").innerText(), /个附件找不到，已跳过/);
    await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  });
}, { workspace, now: FIXTURE_TIME, viewport: { width: 1440, height: 900 } });
