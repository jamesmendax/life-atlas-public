import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { browserScenario } from "./harness.mjs";
import { fullWorkspace, PNG_1X1_BASE64 } from "../fixtures/full-workspace.mjs";
import { openZipReader } from "../../src/backup/zipBrowser.js";

const workspace = fullWorkspace();
const marker = `RESTORE-MARKER-${randomBytes(4).toString("hex")}`;
workspace.pages.push({ ...structuredClone(workspace.pages.find((page) => page.id === "p-z1")), id: "p-restore-marker", title: marker, content: [{ id: "restore-marker-body", type: "paragraph", content: marker }] });
const exportedPath = path.resolve(".qa/WP-02/scenario-export.lifeatlas");

await browserScenario("wp02-backup", async ({ page, check, screenshot, saved, persisted, assert }) => {
  await page.locator('html[data-la-ready="1"]').waitFor();
  await page.evaluate(async (base64) => {
    const { writeBrowserAttachmentBlob } = await import("/src/domain/attachments.js");
    await writeBrowserAttachmentBlob("att-img", new Blob([Uint8Array.from(atob(base64), (character) => character.charCodeAt(0))], { type: "image/png" }));
  }, PNG_1X1_BASE64);
  const switcher = page.locator(".workspace-switcher");
  const dialog = page.getByRole("dialog", { name: "备份与恢复", exact: true });
  const openBackup = async () => {
    await switcher.click();
    await page.getByRole("menuitem", { name: "备份与恢复…", exact: true }).click();
    await dialog.waitFor();
  };

  await check("Backup dialog opens from the workspace menu with keyboard focus", async () => {
    await openBackup();
    assert.equal(await dialog.getByRole("button", { name: "导出", exact: true }).evaluate((element) => element === document.activeElement), true);
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    assert.equal(await switcher.evaluate((element) => element === document.activeElement), true);
    await openBackup();
    await screenshot("backup-dialog");
  });
  await check("Export downloads a complete package", async () => {
    const downloaded = page.waitForEvent("download");
    await dialog.getByRole("button", { name: "导出", exact: true }).click();
    mkdirSync(path.dirname(exportedPath), { recursive: true });
    await (await downloaded).saveAs(exportedPath);
    const reader = await openZipReader(new Uint8Array(readFileSync(exportedPath)));
    assert.equal(reader.entries()[0], "manifest.json");
    const manifest = JSON.parse(new TextDecoder().decode(await reader.read("manifest.json")));
    assert.equal(manifest.app.platform, "browser");
    assert.ok(manifest.files.some((file) => file.path === "assets/c414cd0e204de974f73753c7e28d7638e7b3691bb8b1a2bab6b25bb7fed7ce77"));
    assert.ok(new TextDecoder().decode(await reader.read("workspace/entities/pages.jsonl")).includes(marker));
  });
  await check("Restore replaces data from the package", async () => {
    await page.route("**/__backup-reset", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><html><title>Backup reset</title></html>" }));
    await page.goto("http://127.0.0.1:5178/__backup-reset");
    await page.evaluate(async () => {
      for (const key of Object.keys(localStorage)) if (key.startsWith("life-atlas.workspace")) localStorage.removeItem(key);
      await new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase("life-atlas.attachments.v1");
        request.onsuccess = resolve;
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error("Attachment database is still open"));
      });
    });
    await page.goto("http://127.0.0.1:5178", { waitUntil: "domcontentloaded" });
    await page.locator('html[data-la-ready="1"]').waitFor();
    assert.equal(await page.locator(".workspace-sidebar .page-tree-row").filter({ hasText: marker }).count(), 0);
    await openBackup();
    await dialog.getByLabel("选择备份文件", { exact: true }).setInputFiles(exportedPath);
    await dialog.locator(".mb-backup-summary").waitFor();
    await screenshot("restore-summary");
    await dialog.getByRole("button", { name: "恢复", exact: true }).click();
    const reloaded = page.waitForEvent("domcontentloaded");
    await page.getByRole("alertdialog", { name: "恢复这个备份？", exact: true }).getByRole("button", { name: "确认恢复", exact: true }).click();
    await reloaded;
    await page.locator('html[data-la-ready="1"]').waitFor();
    await persisted((value) => value.pages.some((entry) => entry.title === marker));
    const expand = page.getByRole("button", { name: "展开Z 其他", exact: true });
    if (await expand.count()) await expand.click();
    assert.equal(await page.locator(".workspace-sidebar .page-tree-row").filter({ hasText: marker }).count(), 1);
    await page.locator('.workspace-sidebar .page-tree-row[title="B 笔记"]').click();
    await page.waitForFunction(() => [...document.querySelectorAll(".life-editor img")].some((image) => image.naturalWidth === 1));
    assert.equal((await saved()).pages.some((entry) => entry.title === marker), true);
    await screenshot("after-restore");
  });
  await check("Restore keeps a pre-restore copy", async () => {
    const copies = await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith("life-atlas.workspace.pre-restore-")));
    assert.equal(copies.length, 1);
  });
}, { workspace, now: "2026-10-02T08:00:00.000Z", viewport: { width: 1440, height: 900 } });
