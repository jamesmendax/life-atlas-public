import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { buildNotionExportZip, notionExportFiles } from "../fixtures/notion-export.mjs";
import { createBackupDesktopCase, seedDesktopFullWorkspace } from "./backup-helpers.mjs";
import { createIsolatedDirectory, queueDialogResponse, assertNoNetworkAndErrors } from "./helpers.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function menuAction(page, name) {
  await page.locator(".workspace-sidebar .workspace-switcher").click();
  await page.getByRole("menu", { name: "工作区菜单", exact: true }).getByRole("menuitem", { name, exact: true }).click();
}

async function searchPage(page, title) {
  await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog", { name: "全局搜索", exact: true });
  await dialog.getByRole("combobox", { name: "搜索文件夹、页面与正文" }).fill(title);
  await dialog.locator(".search-result-row").filter({ has: page.locator("strong", { hasText: title }) }).first().click();
  await dialog.waitFor({ state: "hidden" });
  await page.waitForFunction((title) => document.querySelector(".page-title-input")?.value === title, title);
}

function allFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? allFiles(path.join(directory, entry.name)) : [path.join(directory, entry.name)]);
}

test("notion import stores attachments in the asset store", { timeout: 120000 }, async (context) => {
  const state = await createBackupDesktopCase(context, { packaged: true, retainOnFailure: true, prepare: async (state) => { await seedDesktopFullWorkspace(state.dataRoot); } });
  let page = state.handle.page;
  await menuAction(page, "从 Notion 导入…");
  const dialog = page.getByRole("dialog", { name: "从 Notion 导入", exact: true });
  await dialog.getByLabel("选择 Notion 导出文件", { exact: true }).setInputFiles({ name: "notion.zip", mimeType: "application/zip", buffer: Buffer.from(await buildNotionExportZip()) });
  await dialog.getByRole("button", { name: "导入", exact: true }).waitFor();
  await dialog.getByRole("button", { name: "导入", exact: true }).click();
  await dialog.getByRole("status").filter({ hasText: "已导入 3 个页面、1 个数据库（5 条记录）、3 个附件" }).waitFor();
  await dialog.getByRole("button", { name: "打开导入的文件夹", exact: true }).click();
  await state.close();
  const hashes = Object.entries(notionExportFiles()).filter(([filePath, bytes]) => bytes instanceof Uint8Array && /\.(png|pdf|jpg)$/.test(filePath)).map(([filePath, bytes]) => ({ filePath, bytes, hash: sha256(bytes) }));
  assert.equal(hashes.length, 3);
  const db = new DatabaseSync(path.join(state.dataRoot, "workspace.db"), { readOnly: true });
  try {
    for (const asset of hashes) {
      const file = path.join(state.dataRoot, "assets", asset.hash.slice(0, 2), asset.hash);
      assert.equal(fs.existsSync(file), true, asset.filePath);
      assert.equal(sha256(fs.readFileSync(file)), asset.hash);
      const row = db.prepare("SELECT sha256,size FROM assets WHERE sha256=?").get(asset.hash);
      assert.ok(row, asset.filePath);
      assert.equal(row.size, asset.bytes.byteLength);
    }
  } finally { db.close(); }
  await state.launch();
  page = state.handle.page;
  await searchPage(page, "项目总览");
  await page.waitForFunction(() => [...document.querySelectorAll(".life-editor img")].some((image) => image.src.startsWith("life-asset://") && image.naturalWidth > 0));
  assert.ok(await page.locator('.life-editor img[src^="life-asset://"]').count() > 0);
  await assertNoNetworkAndErrors(state.handle);
  await state.close();
  state.complete();
});

test("markdown export writes a readable folder", { timeout: 90000 }, async (context) => {
  const state = await createBackupDesktopCase(context, { seed: true, packaged: true, retainOnFailure: true });
  const directory = state.own(createIsolatedDirectory("markdown-e2e-output"));
  const page = state.handle.page;
  await menuAction(page, "导出为 Markdown…");
  const dialog = page.getByRole("dialog", { name: "导出为 Markdown", exact: true });
  const fileCount = Number(await dialog.locator('[data-count="文件"] dd').innerText());
  assert.ok(Number.isInteger(fileCount) && fileCount > 0);
  await queueDialogResponse(state.handle, "showOpenDialog", { canceled: false, filePaths: [directory] });
  await dialog.getByRole("button", { name: "导出", exact: true }).click();
  await dialog.getByRole("status").filter({ hasText: "已导出到" }).waitFor();
  assert.doesNotMatch(await dialog.getByRole("status").innerText(), /找不到/);
  const folders = fs.readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.isDirectory() && entry.name.startsWith("Life Atlas 导出 "));
  assert.equal(folders.length, 1);
  const output = path.join(directory, folders[0].name);
  assert.equal(allFiles(output).length, fileCount);
  const image = state.fixtureWorkspace.attachments.find((attachment) => attachment.id === "att-img");
  const hash = image.checksum;
  const assetFile = allFiles(path.join(output, "_assets")).find((filePath) => path.basename(filePath).startsWith(`${hash.slice(0, 12)}-`));
  assert.ok(assetFile);
  assert.equal(sha256(fs.readFileSync(assetFile)), hash);
  const markdown = fs.readFileSync(path.join(output, "A 项目", "A 概览.md"), "utf8");
  const csv = fs.readFileSync(path.join(output, "Z 其他", "整页项目库.csv"), "utf8");
  assert.match(markdown, /^---\nid: "p-a1"/);
  assert.ok(markdown.includes("[Z 目标页](../Z%20其他/Z%20目标页.md)"));
  assert.ok(csv.startsWith("\uFEFF名称,评分,任务,任务数"));
  console.log(`WP18_EXPORTED_MARKDOWN_FIRST20\n${markdown.split(/\r?\n/).slice(0, 20).join("\n")}\nWP18_EXPORTED_MARKDOWN_END`);
  console.log(`WP18_EXPORTED_CSV_FIRST20\n${csv.split(/\r?\n/).slice(0, 20).join("\n")}\nWP18_EXPORTED_CSV_END`);
  await assertNoNetworkAndErrors(state.handle);
  await state.close();
  state.complete();
});
