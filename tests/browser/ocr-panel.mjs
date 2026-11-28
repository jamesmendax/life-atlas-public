import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("../../", import.meta.url));
const client = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, "dist", "client");
const evidence = path.join(root, ".qa", "ocr");
const origin = "https://life-atlas-ocr-fixture.invalid";
await fs.mkdir(evidence, { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    const file = path.resolve(client, `.${decodeURIComponent(url.pathname)}`);
    if (path.relative(client, file).startsWith("..")) return route.abort();
    try { await route.fulfill({ path: file }); }
    catch { await route.fulfill({ status: 404 }); }
  });
  await context.addInitScript(() => {
    window.actions = [];
    window.clipboardFixture = null;
    window.lifeAtlas = {
      ocr: {
        getStatus: async () => ({ ok: true, available: true, engine: "Tesseract" }),
        recognizeFile: async (language) => {
          window.actions.push(["file", language]);
          return { ok: true, text: "离线识别测试\nOffline text recognition" };
        },
        recognizeClipboard: async (language) => {
          window.actions.push(["clipboard", language]);
          return window.clipboardFixture === null
            ? { ok: false, message: "剪贴板里没有图片，请先复制一张图片。" }
            : { ok: true, text: window.clipboardFixture };
        },
        recognizeScreen: async (language) => {
          const panel = document.querySelector(".workspace-assistant");
          window.actions.push(["screen", language, getComputedStyle(panel).visibility, Boolean(document.querySelector(".assistant-launcher"))]);
          await new Promise((resolve) => setTimeout(resolve, 120));
          return { ok: true, cancelled: true };
        },
        copyText: async (text) => { window.actions.push(["copy", text]); return { ok: true }; },
      },
    };
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${origin}/index.html`);
  const launcher = page.getByRole("button", { name: "打开 AI 助手" });
  await launcher.click({ button: "right" });
  await page.getByRole("button", { name: "识图取字" }).click();
  const panel = page.getByRole("complementary", { name: "识图小窗" });
  await panel.waitFor();
  const language = panel.getByRole("combobox", { name: "识别语言" });
  const optionColors = () => language.evaluate((select) => {
    const picker = getComputedStyle(select, "::picker(select)");
    return [picker.appearance, picker.backgroundColor, picker.color];
  });
  await language.click();
  assert.deepEqual(await optionColors(), ["base-select", "rgb(255, 255, 255)", "rgb(55, 53, 47)"]);
  await panel.screenshot({ path: path.join(evidence, "ocr-language-light.png") });
  await panel.getByRole("option", { name: "简体中文 + English", exact: true }).click();
  assert.equal(await panel.getByText("识图取字", { exact: true }).count(), 1);
  assert.equal(await panel.locator(".la-ocr h2, .la-ocr__icon").count(), 0);
  await panel.getByRole("button", { name: "选择图片" }).click();
  const result = panel.getByRole("textbox", { name: "识别结果" });
  await page.waitForFunction(() => document.querySelector(".la-ocr textarea")?.value.includes("Offline text recognition"));
  await panel.screenshot({ path: path.join(evidence, "ocr-panel-light.png") });
  await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
  await panel.screenshot({ path: path.join(evidence, "ocr-panel-dark.png") });
  await language.click();
  assert.deepEqual(await optionColors(), ["base-select", "rgb(37, 37, 37)", "rgb(212, 212, 212)"]);
  await panel.screenshot({ path: path.join(evidence, "ocr-language-dark.png") });
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  assert.equal(await language.inputValue(), "eng");
  await language.press("Space");
  await page.keyboard.press("Escape");
  assert.equal(await panel.isVisible(), true);

  const clipboardButton = panel.getByRole("button", { name: "剪贴板图片" });
  const pasteImage = async (type) => {
    const clipboardData = new DataTransfer();
    clipboardData.items.add(new File([], "example.png", { type }));
    document.activeElement.dispatchEvent(new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }));
  };
  await page.evaluate(() => { window.clipboardFixture = "Paste image from a web browser"; });
  await result.focus();
  await page.evaluate(pasteImage, "image/png");
  await page.waitForFunction(() => document.querySelector(".la-ocr textarea")?.value === "Paste image from a web browser");
  await page.evaluate(() => { window.clipboardFixture = "Paste Explorer image file"; });
  await page.evaluate(pasteImage, "application/octet-stream");
  await page.waitForFunction(() => document.querySelector(".la-ocr textarea")?.value === "Paste Explorer image file");
  await page.evaluate(() => { window.clipboardFixture = "Clipboard button image"; });
  await clipboardButton.click();
  await page.waitForFunction(() => document.querySelector(".la-ocr textarea")?.value === "Clipboard button image");
  await page.evaluate(() => { window.clipboardFixture = "Clipboard keyboard shortcut"; });
  await panel.evaluate((element) => {
    element.focus();
    element.dispatchEvent(new KeyboardEvent("keydown", { key: "v", ctrlKey: true, bubbles: true, cancelable: true }));
  });
  await page.waitForFunction(() => document.querySelector(".la-ocr textarea")?.value === "Clipboard keyboard shortcut");
  await result.focus();
  assert.equal(await result.evaluate((element) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", "https://example.invalid/page");
    clipboardData.setData("text/uri-list", "https://example.invalid/page");
    return element.dispatchEvent(new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }));
  }), true);
  await result.fill("已编辑的文字");
  await panel.getByRole("button", { name: "复制文字" }).click();
  await panel.getByText("已复制文字").waitFor();
  await panel.getByRole("button", { name: "框选屏幕" }).click();
  await page.waitForFunction(() => window.actions.some(([kind]) => kind === "screen"));
  await panel.waitFor({ state: "visible" });
  assert.equal(await result.inputValue(), "已编辑的文字");
  await page.evaluate(() => { window.clipboardFixture = null; });
  await clipboardButton.click();
  await panel.getByText("剪贴板里没有图片，请先复制一张图片。").waitFor();
  assert.equal(await result.inputValue(), "已编辑的文字");
  assert.deepEqual(await page.evaluate(() => window.actions), [
    ["file", "chi_sim+eng"], ["clipboard", "eng"], ["clipboard", "eng"], ["clipboard", "eng"], ["clipboard", "eng"],
    ["copy", "已编辑的文字"], ["screen", "eng", "hidden", false], ["clipboard", "eng"],
  ]);
  await panel.getByRole("button", { name: "关闭小窗" }).click();
  await launcher.waitFor();
  assert.deepEqual(errors, []);
  console.log("OCR panel, both language themes, keyboard and clipboard actions, edit, copy and feedback passed.");
} finally {
  await browser.close();
}
