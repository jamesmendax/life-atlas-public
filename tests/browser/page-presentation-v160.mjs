import assert from "node:assert/strict";
import { chromium } from "playwright";
import { coreParityWorkspace } from "../fixtures/core-parity-workspace.mjs";
import { stableJson } from "../../src/domain/blockDocument.js";
import { workspaceStorageKey } from "../../src/persistence/workspaceRepository.js";
import { upgradeWorkspace } from "../../src/persistence/migrations.js";

const workspace = coreParityWorkspace();
workspace.ui.selectedPageId = "editor-page";
const original = workspace.pages.find((page) => page.id === "editor-page");
original.title = "项目现场演示";
original.content = [
  { id: "presentation-first", type: "paragraph", content: "第一张正文" },
  { id: "presentation-fold", type: "toggleListItem", content: "演示折叠内容", children: [
    { id: "presentation-inner-divider", type: "divider" },
    { id: "presentation-child", type: "paragraph", content: "展开后可见" },
  ] },
  { id: "presentation-break", type: "divider" },
  { id: "presentation-second", type: "paragraph", content: "第二张正文" },
];
const base = process.env.PARITY_BASE_URL || "http://127.0.0.1:5178";
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1420, height: 960 } });
  const page = await context.newPage();
  page.setDefaultTimeout(9000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/__presentation-seed", (route) => route.fulfill({ contentType: "text/html", body: "<!doctype html>" }));
  await page.goto(`${base}/__presentation-seed`);
  await page.evaluate(async ({ seed, key }) => {
    const { persistBrowserAttachment } = await import("/src/domain/attachments.js");
    const canvas = document.createElement("canvas");
    canvas.width = 720;
    canvas.height = 400;
    const paint = canvas.getContext("2d");
    paint.fillStyle = "#1976d2";
    paint.fillRect(0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    const image = await persistBrowserAttachment(new File([blob], "演示图片.png", { type: "image/png" }), { id: "presentation-img" });
    seed.attachments.push(image.metadata);
    seed.pages.find((page) => page.id === "editor-page").content.push({
      id: "presentation-local-img", type: "image", props: { url: image.url, name: "演示图片.png", previewWidth: 720 },
    });
    localStorage.setItem(key, JSON.stringify(seed));
  }, { seed: upgradeWorkspace(workspace), key: workspaceStorageKey });
  await page.goto(base);
  const host = page.locator('.workspace-scroll .life-editor[data-page-id="editor-page"]');
  const originalImage = host.locator('img[alt="演示图片.png"]');
  await originalImage.evaluate((image) => image.decode());
  const currentImage = await originalImage.getAttribute("src");
  await page.waitForFunction(({ key, url }) => JSON.parse(localStorage.getItem(key))?.pages.find((page) => page.id === "editor-page")?.content.find((block) => block.id === "presentation-local-img")?.props.url === url, { key: workspaceStorageKey, url: currentImage });
  const persistedState = () => page.evaluate((key) => {
    const data = JSON.parse(localStorage.getItem(key));
    return {
      page: data.pages.find((entry) => entry.id === "editor-page"),
      versions: data.pageVersions?.filter((entry) => entry.pageId === "editor-page"),
      toggleKeys: Object.keys(localStorage).filter((key) => key.startsWith("toggle-")).sort().map((key) => [key, localStorage.getItem(key)]),
    };
  }, workspaceStorageKey);
  const before = await persistedState();
  const trigger = page.getByRole("button", { name: "页面操作", exact: true });
  const dialog = page.getByRole("dialog", { name: "演示页面", exact: true });

  await trigger.click();
  await page.getByRole("menuitem", { name: "演示页面", exact: true }).click();
  await dialog.getByRole("heading", { name: original.title, exact: true }).waitFor();
  assert.equal(await dialog.getByRole("button", { name: "上一页", exact: true }).isDisabled(), true);
  assert.equal(await dialog.getByLabel("幻灯片页码").textContent(), "1 / 3");

  await dialog.getByRole("button", { name: "下一页", exact: true }).click();
  await dialog.getByText("第一张正文", { exact: true }).waitFor();
  assert.equal(await dialog.getByText("展开后可见", { exact: true }).isVisible(), false);
  const toggle = dialog.locator(".bn-toggle-button");
  await toggle.click();
  assert.equal(await dialog.getByText("展开后可见", { exact: true }).isVisible(), true);
  assert.equal(await dialog.locator(".bn-editor").getAttribute("contenteditable"), "false");
  assert.equal(await host.locator('[data-id="presentation-fold"] .bn-toggle-wrapper').getAttribute("data-show-children"), "false");

  await page.keyboard.press("End");
  await dialog.getByText("第二张正文", { exact: true }).waitFor();
  assert.equal(await dialog.getByRole("button", { name: "下一页", exact: true }).isDisabled(), true);
  const image = dialog.getByRole("img", { name: "演示图片.png", exact: true });
  assert.deepEqual(await image.evaluate(async (element) => {
    await element.decode();
    return [element.naturalWidth, element.naturalHeight];
  }), [720, 400]);
  await page.setViewportSize({ width: 650, height: 490 });
  const imageBounds = await image.boundingBox();
  const viewportBounds = await dialog.locator(".page-presentation-viewport").boundingBox();
  assert.ok(imageBounds && viewportBounds && imageBounds.width < viewportBounds.width);
  assert.ok(imageBounds.height <= viewportBounds.height);

  await page.keyboard.press("Home");
  assert.equal(await dialog.getByLabel("幻灯片页码").textContent(), "1 / 3");
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  assert.equal(await host.getByText("第一张正文", { exact: true }).isVisible(), true);
  await page.keyboard.press("Control+Alt+p");
  await dialog.getByRole("heading", { name: original.title, exact: true }).waitFor();
  await page.keyboard.press("ArrowRight");
  await dialog.getByText("第一张正文", { exact: true }).waitFor();
  assert.equal(await dialog.getByText("展开后可见", { exact: true }).isVisible(), false);
  await page.keyboard.press("ArrowLeft");
  assert.equal(await dialog.getByLabel("幻灯片页码").textContent(), "1 / 3");
  await dialog.getByRole("button", { name: "退出演示", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  assert.equal(stableJson(await persistedState()), stableJson(before));
  assert.deepEqual(errors, []);
  console.log("PASS page-presentation-v160: app menu, shortcut, title and two slides, local image, responsive viewport, isolated toggle and source");
} finally {
  await browser.close();
}
