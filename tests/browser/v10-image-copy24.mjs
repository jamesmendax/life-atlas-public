import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import net from "node:net";
import { browserScenario, sourceFingerprint } from "./harness.mjs";
import { coreParityWorkspace } from "../fixtures/core-parity-workspace.mjs";

const run = process.env.V10_IMAGE_COPY24_RUN;
if (!run || !/^[a-z0-9-]+$/.test(run)) throw new Error("Set a unique V10_IMAGE_COPY24_RUN");
const root = ".qa/LOCAL-NOTION-001/v10-image-copy24";
const name = suffix => `LOCAL-NOTION-001/v10-image-copy24/${run}-${suffix}`;
for (const suffix of ["editable", "locked"]) {
  if (existsSync(`.qa/${name(suffix)}.json`) || existsSync(`.qa/${name(suffix)}-failure.png`)) throw new Error(`Evidence already exists: ${name(suffix)}`);
}
const runtime = path.resolve(root, `${run}-runtime`);
if (existsSync(runtime)) throw new Error(`Runtime already exists: ${runtime}`);
const temp = path.join(runtime, "temp"), cache = path.join(runtime, "cache");
mkdirSync(temp, { recursive: true }); mkdirSync(cache, { recursive: true });
process.env.TEMP = temp; process.env.TMP = temp; process.env.XDG_CACHE_HOME = cache; process.env.npm_config_cache = cache;
const external = process.env.PARITY_BASE_URL;
if (!external && process.env.V10_IMAGE_COPY24_SERVER_HANDOFF !== "1") throw new Error("Await parent server handoff before starting 5178");
process.env.PARITY_BASE_URL = external || "http://127.0.0.1:5178";

function fixture(locked) {
  const w = coreParityWorkspace();
  w.ui.selectedPageId = "editor-page";
  w.ui.preferences = { style: "mobai", theme: "system" };
  const target = w.pages.find(p => p.id === "editor-page");
  target.settings = { ...target.settings, locked };
  target.content = [{ id: "tail24", type: "paragraph", content: "fixture" }];
  return w;
}

async function seedImages(page) {
  const app = page.url(), seed = new URL("/src/domain/attachments.js", app).href;
  let first = true;
  const intercept = route => {
    if (first && route.request().isNavigationRequest()) { first = false; return route.fulfill({ status: 200, contentType: "text/html", body: '<!doctype html><link rel="icon" href="data:,">' }); }
    return route.continue();
  };
  await page.route(seed, intercept);
  try { await page.goto(seed); } finally { await page.unroute(seed, intercept); }
  const refs = await page.evaluate(async () => {
    const { persistBrowserAttachment } = await import("/src/domain/attachments.js");
    const { workspaceStorageKey } = await import("/src/persistence/workspaceRepository.js");
    const w = JSON.parse(localStorage.getItem(workspaceStorageKey));
    const images = [];
    for (const [id, color] of [["image24-red", "#ff0000"], ["image24-blue", "#0000ff"]]) {
      const canvas = document.createElement("canvas"); canvas.width = 3; canvas.height = 2;
      const ctx = canvas.getContext("2d"); ctx.fillStyle = color; ctx.fillRect(0, 0, 3, 2);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
      const saved = await persistBrowserAttachment(new File([blob], `${id}.png`, { type: "image/png" }), { id: `attachment-${id}` });
      const url = saved.url.replace(/^blob:[^#]+/, `blob:${location.origin}/expired-${id}`);
      w.attachments.push(saved.metadata); images.push({ id, type: "image", props: { url, name: `${id}.png` } });
    }
    w.pages.find(p => p.id === "editor-page").content = [...images, { id: "tail24", type: "paragraph", content: "fixture" }];
    localStorage.setItem(workspaceStorageKey, JSON.stringify(w));
    return images.map(image => image.props.url);
  });
  await page.goto(app);
  for (const id of ["image24-red", "image24-blue"]) await page.locator(`.bn-block-outer[data-id="${id}"] img`).evaluate(async img => { await img.decode(); if (!img.naturalWidth) throw new Error("managed image did not decode"); });
  return refs;
}

const image = (page, id) => page.locator(`.life-editor[data-page-id="editor-page"] .bn-block-outer[data-id="${id}"] img`);
const contextMenu = async (page, id) => {
  await image(page, id).click({ button: "right" });
  await page.locator(`.life-block-actions[data-block-id="${id}"]`).waitFor({ state: "visible", timeout: 4000 });
  await page.getByRole("menuitem", { name: "复制图片", exact: true }).waitFor({ state: "visible", timeout: 4000 });
};
const blocks = w => w.pages.find(p => p.id === "editor-page").content;
const entities = w => Object.fromEntries(["pages", "attachments", "dataSources", "databaseItems", "databaseViews", "relations", "syncedSources"].map(key => [key, w[key]]));
async function copiedPixel(page, expectedPixel) {
  const result = await page.waitForFunction(async expected => {
    const entries = await navigator.clipboard.read();
    const item = entries.find(value => value.types.includes("image/png"));
    if (!item) return false;
    const blob = await item.getType("image/png");
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement("canvas"); canvas.width = bitmap.width; canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d"); ctx.drawImage(bitmap, 0, 0);
    const pixel = [...ctx.getImageData(0, 0, 1, 1).data];
    return pixel.every((value, index) => value === expected[index])
      ? { type: blob.type, width: bitmap.width, height: bitmap.height, pixel }
      : false;
  }, expectedPixel, { timeout: 5000 });
  try { return await result.jsonValue(); }
  finally { await result.dispose(); }
}
async function provePortFree() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen({ host: "0.0.0.0", port: 5178, exclusive: true }, resolve); });
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

let server;
const before = sourceFingerprint();
try {
  if (!external) {
    await provePortFree();
    const { createServer } = await import("vite");
    server = await createServer({ configLoader: "native", cacheDir: cache, logLevel: "error", server: { host: "127.0.0.1", port: 5178, strictPort: true } });
    await server.listen();
  }
  await browserScenario(name("editable"), async ({ page, context, check, saved, persisted, screenshot }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(process.env.PARITY_BASE_URL).origin });
    await seedImages(page);
    // Browser startup repairs expired managed blob URLs and saves normalized blocks.
    // Establish the read-only baseline after that pre-existing repair completes.
    const original = await persisted(w => blocks(w).filter(b => b.type === "image").length === 2 && blocks(w).filter(b => b.type === "image").every(b => !b.props.url.includes("expired-")));
    const refs = blocks(original).filter(b => b.type === "image").map(b => b.props.url);
    await check("right-click image exposes separate Copy image, Duplicate and Copy link actions", async () => {
      await contextMenu(page, "image24-blue");
      assert.equal(await page.getByRole("menuitem", { name: "复制图片", exact: true }).count(), 1);
      assert.equal(await page.getByRole("menuitem", { name: "复制", exact: true }).count(), 1);
      assert.equal(await page.getByRole("menuitem", { name: "复制区块链接", exact: true }).count(), 1);
      await screenshot("image-menu");
    });
    await check("clipboard is PNG pixels from second image and copy is read-only", async () => {
      await page.getByRole("menuitem", { name: "复制图片", exact: true }).click();
      assert.deepEqual(await copiedPixel(page, [0, 0, 255, 255]), { type: "image/png", width: 3, height: 2, pixel: [0, 0, 255, 255] });
      assert.deepEqual(entities(await saved()), entities(original));
      await contextMenu(page, "image24-red");
      await page.getByRole("menuitem", { name: "复制图片", exact: true }).click();
      assert.deepEqual(await copiedPixel(page, [255, 0, 0, 255]), { type: "image/png", width: 3, height: 2, pixel: [255, 0, 0, 255] });
      assert.deepEqual(entities(await saved()), entities(original));
    });
    await check("duplicate targets image, shares reference, undo and reload preserve identities", async () => {
      await contextMenu(page, "image24-blue");
      await page.getByRole("menuitem", { name: "复制", exact: true }).click();
      const duplicated = await persisted(w => blocks(w).filter(b => b.type === "image").length === 3);
      const images = blocks(duplicated).filter(b => b.type === "image");
      assert.equal(images[1].id, "image24-blue"); assert.notEqual(images[2].id, images[1].id);
      assert.equal(images[1].props.url, refs[1]); assert.equal(images[2].props.url, refs[1]);
      assert.deepEqual(duplicated.attachments, original.attachments);
      await page.keyboard.press("Control+z");
      await persisted(w => blocks(w).filter(b => b.type === "image").length === 2);
      await page.reload();
      await image(page, "image24-blue").waitFor();
      assert.deepEqual(blocks(await saved()).map(b => b.id), blocks(original).map(b => b.id));
    });
    await check("Escape dismisses menu and failed clipboard write reports error", async () => {
      await page.locator('.bn-block-outer[data-id="tail24"] .bn-inline-content').click();
      await contextMenu(page, "image24-red"); await page.keyboard.press("Escape");
      await page.getByRole("menuitem", { name: "复制图片", exact: true }).waitFor({ state: "hidden" });
      assert.equal(await page.getByRole("menuitem", { name: "复制图片", exact: true }).isVisible(), false);
      await page.waitForFunction(() => document.querySelector('.life-editor[data-page-id="editor-page"] .bn-editor')?.contains(document.activeElement));
      await page.evaluate(() => { Object.defineProperty(navigator.clipboard, "write", { configurable: true, value: () => Promise.reject(new Error("clipboard denied")) }); });
      await contextMenu(page, "image24-red");
      await page.getByRole("menuitem", { name: "复制图片", exact: true }).click();
      await page.getByText("未能复制图片", { exact: true }).waitFor();
      assert.equal(await page.getByText("已复制图片", { exact: true }).isVisible(), false);
    });
  }, { workspace: fixture(false) });
  await browserScenario(name("locked"), async ({ page, context, check, saved, persisted }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(process.env.PARITY_BASE_URL).origin });
    await seedImages(page);
    const beforeRead = await persisted(w => blocks(w).filter(b => b.type === "image").length === 2 && blocks(w).filter(b => b.type === "image").every(b => !b.props.url.includes("expired-")));
    await check("locked image allows copy but disables duplication and preserves entities", async () => {
      await contextMenu(page, "image24-blue");
      assert.equal(await page.getByRole("menuitem", { name: "复制", exact: true }).isDisabled(), true);
      await page.getByRole("menuitem", { name: "复制图片", exact: true }).click();
      assert.deepEqual(await copiedPixel(page, [0, 0, 255, 255]), { type: "image/png", width: 3, height: 2, pixel: [0, 0, 255, 255] });
      assert.deepEqual(entities(await saved()), entities(beforeRead));
    });
  }, { workspace: fixture(true) });
} finally {
  if (server) { await server.close(); await provePortFree(); console.log("OWNED_VITE_CLOSED=true"); }
  else console.log("EXTERNAL_PARITY_SERVER_PRESERVED=true");
  assert.equal(sourceFingerprint(), before, "Source/test inputs changed during run");
}
