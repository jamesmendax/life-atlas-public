import { readFileSync } from "node:fs";
import { browserScenario } from "./harness.mjs";
import { notionGoldenWorkspace } from "../fixtures/notion-golden-page.mjs";

function allWidths(document) {
  const result = [];
  const visit = (blocks) => {
    for (const block of blocks || []) {
      if (block.type === "columnList") result.push((block.children || []).map((child) => child.props.width));
      visit(block.children);
    }
  };
  visit(document);
  return result;
}

const workspace = notionGoldenWorkspace();

await browserScenario("notion-golden-page", async ({ page, check, persisted, saved, screenshot, assert }) => {
  await check("golden fixture renders all target decimal column ratios and key block families", async () => {
    await page.waitForSelector(".life-column-marker");
    const widths = await page.locator(".life-column-marker").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-column-width")));
    for (const expected of ["56","44","33.33","32.67","34","50","54","46","33","24","76"]) assert.ok(widths.includes(expected), expected);
    assert.equal(await page.locator(".life-callout-gray").count() > 0, true);
    assert.equal(await page.locator(".life-callout-brown").count() > 0, true);
    assert.equal(await page.locator(".life-editorial-card").count() >= 4, true);
    assert.equal(await page.locator('img[src*="notion-golden-cover.svg"]').count() >= 1, true);
  });

  await check("browser edit and column resize persist without ratio drift", async () => {
    await page.getByLabel("页面标题").fill("Mendax 的 Vibe Coding Wiki · Golden");
    await persisted((state) => state.pages.find((entry) => entry.id === "editor-page")?.title.endsWith("Golden"));
    const first = page.locator(".life-column-resizer").first();
    const box = await first.boundingBox();
    assert.ok(box);
    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;
    await first.dispatchEvent("pointerdown", { pointerId: 17, pointerType: "mouse", isPrimary: true, clientX: startX, clientY: startY });
    await page.evaluate(({ x, y }) => {
      window.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 17, pointerType: "mouse", isPrimary: true, clientX: x + 32, clientY: y }));
      window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 17, pointerType: "mouse", isPrimary: true, clientX: x + 32, clientY: y }));
    }, { x: startX, y: startY });
    const state = await persisted((value) => allWidths(value.pages.find((entry) => entry.id === "editor-page").content)[0][0] !== 56);
    const resized = allWidths(state.pages.find((entry) => entry.id === "editor-page").content)[0];
    assert.equal(Math.round((resized[0] + resized[1]) * 100) / 100, 100);
    assert.equal(Number.isInteger(resized[0]), false);
  });

  await check("reload keeps all blocks and stored ratios", async () => {
    const before = await saved();
    const widthsBefore = allWidths(before.pages.find((entry) => entry.id === "editor-page").content);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector(".life-column-marker");
    const after = await saved();
    assert.deepEqual(allWidths(after.pages.find((entry) => entry.id === "editor-page").content), widthsBefore);
    assert.match(await page.locator(".page-document").innerText(), /精选入口/);
    assert.match(await page.locator(".page-document").innerText(), /当前 \/ 进行中/);
  });

  await check("native JSON export/import/reload preserves golden document", async () => {
    await page.getByRole("button", { name: "页面操作", exact: true }).click({ force: true });
    await page.getByRole("menuitem", { name: "导出页面", exact: true }).click({ force: true });
    const dialog = page.getByRole("dialog", { name: "导出页面", exact: true });
    await dialog.getByLabel("导出格式", { exact: true }).selectOption("json");
    const pending = page.waitForEvent("download");
    await dialog.getByRole("button", { name: "导出", exact: true }).click({ force: true });
    const download = await pending;
    const file = ".qa/notion-golden-export.json";
    await download.saveAs(file);
    const bundle = JSON.parse(readFileSync(file, "utf8"));
    assert.equal(bundle.kind, "life-atlas-page");
    assert.ok(bundle.page.content.length >= 12);
    await page.locator(".page-import-input").setInputFiles(file);
    await persisted((value) => value.pages.find((entry) => entry.id === "editor-page")?.importRevision > 0);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector(".life-column-marker");
    assert.match(await page.locator(".page-document").innerText(), /Golden/);
    assert.equal(await page.locator(".life-callout-brown").count() > 0, true);
  });

  await check("final replica enters focus-reading presentation", async () => {
    await page.getByRole("button", { name: "页面操作", exact: true }).click({ force: true });
    const focusItem = page.getByRole("menuitem", { name: "专注阅读", exact: true });
    await focusItem.click({ force: true });
    await page.waitForSelector(".app-shell.is-focus-reading");
    assert.equal(await page.locator(".sidebar").isVisible(), false);
    assert.equal(await page.locator(".workspace-header").isVisible(), false);
  });

  await screenshot("replica");
}, { workspace, viewport: { width: 1440, height: 1200 } });
