import { browserScenario } from "./harness.mjs";
import { fullWorkspace } from "../fixtures/full-workspace.mjs";

await browserScenario("v11-fullwidth54", async ({ page, check, screenshot, saved, persisted, assert }) => {
  const article = page.locator(".page-document");
  const header = article.locator(":scope > .page-document-header");
  const editor = article.locator(":scope > .life-editor");
  const setPresentation = async (name) => {
    await page.getByRole("button", { name: "页面操作", exact: true }).click();
    await page.getByRole("menuitem", { name, exact: true }).click();
    await page.keyboard.press("Escape");
  };
  const geometry = () => article.evaluate((element) => {
    const rect = (node) => { const r = node.getBoundingClientRect(); return { left: r.left, width: r.width, right: r.right }; };
    const main = rect(element);
    const header = rect(element.querySelector(":scope > .page-document-header"));
    const editor = rect(element.querySelector(":scope > .life-editor"));
    return { main, header, editor, overflow: document.documentElement.scrollWidth > innerWidth };
  });
  const same = (a, b) => Math.abs(a - b) < 1;
  let linksBefore;
  let narrowDefault;

  await check("1440px full width remains compatible with the existing presentation contract", async () => {
    await page.locator('.workspace-sidebar .page-tree-row[data-node-id="p-a1"]').click();
    await editor.locator(".bn-editor").waitFor();
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.locator(":root").getAttribute("data-style"), "mobai");
    assert.ok(same((await geometry()).header.width, 708));
    linksBefore = (await saved()).pages.find((entry) => entry.id === "p-a1").content.filter((block) => block.id === "b-a1-link" || block.id === "b-a1-p");
    await page.setViewportSize({ width: 948, height: 900 });
    narrowDefault = (await geometry()).header.width;
    await page.setViewportSize({ width: 1440, height: 900 });
    await setPresentation("全宽");
    await persisted((workspace) => workspace.pages.find((entry) => entry.id === "p-a1").settings.presentationMode === "full");
    const box = await geometry();
    assert.ok(box.header.width > 900 && box.header.width <= 1122, JSON.stringify(box));
    assert.ok(same(box.header.width, box.editor.width) && same(box.header.left, box.editor.left), JSON.stringify(box));
  });

  await check("1707px full width follows the available surface without the 1120px cap", async () => {
    await page.setViewportSize({ width: 1707, height: 1019 });
    const box = await geometry();
    assert.ok(box.header.width > 1122, JSON.stringify(box));
    assert.ok(same(box.header.width, box.main.width - 192), JSON.stringify(box));
    assert.ok(same(box.header.left - box.main.left, 96) && same(box.main.right - box.header.right, 96), JSON.stringify(box));
    assert.ok(same(box.header.width, box.editor.width) && same(box.header.left, box.editor.left), JSON.stringify(box));
    assert.equal(box.overflow, false);
    await screenshot("1707-full");
  });

  await check("948px gutters shrink and default width returns without horizontal overflow", async () => {
    await page.setViewportSize({ width: 948, height: 900 });
    const full = await geometry();
    const gutter = full.header.left - full.main.left;
    assert.ok(gutter >= 23 && gutter < 96, JSON.stringify(full));
    assert.ok(same(full.header.width, full.editor.width));
    assert.equal(full.overflow, false);
    await setPresentation("默认宽");
    await persisted((workspace) => workspace.pages.find((entry) => entry.id === "p-a1").settings.presentationMode === "default");
    const ordinary = await geometry();
    assert.ok(same(ordinary.header.width, narrowDefault), JSON.stringify({ full, ordinary, narrowDefault }));
    assert.equal(ordinary.overflow, false);
    await page.setViewportSize({ width: 1440, height: 900 });
    assert.ok(same((await geometry()).header.width, 708));
  });

  await check("Focus retains its own capped width and the existing editor links survive", async () => {
    await page.setViewportSize({ width: 1707, height: 1019 });
    await setPresentation("专注阅读");
    await page.locator(".app-shell.is-focus-reading").waitFor();
    assert.ok((await header.boundingBox()).width <= 1122);
    await page.getByRole("button", { name: "退出专注阅读", exact: true }).click();
    await persisted((workspace) => workspace.pages.find((entry) => entry.id === "p-a1").settings.presentationMode === "full");
    assert.deepEqual((await saved()).pages.find((entry) => entry.id === "p-a1").content.filter((block) => block.id === "b-a1-link" || block.id === "b-a1-p"), linksBefore);
    await editor.locator(".life-page-link-block").getByText("C 深层").click();
    await page.waitForFunction(() => document.querySelector(".page-title-input")?.value === "C 深层");
  });
}, { workspace: fullWorkspace(), viewport: { width: 1440, height: 900 } });
