import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { browserScenario } from "./harness.mjs";
import { coreParityWorkspace } from "../fixtures/core-parity-workspace.mjs";

const run = process.env.HEADING_LINK87_RUN || `run-${Date.now()}`;
if (!/^[a-z0-9-]+$/.test(run)) throw new Error("Use a unique heading-link87 run name");
const directory = path.resolve(".qa/LOCAL-NOTION-001/v11-wiki-replica48/heading-link87", run);
if (existsSync(directory)) throw new Error(`Preserve earlier run: ${directory}`);
mkdirSync(directory, { recursive: true });
const publish = (name, value) => writeFileSync(path.join(directory, name), JSON.stringify(value, null, 2) + "\n");

// The long title and level are from source-html48 h3#095c707f-fd4d-467d-87e8-8f372a8f4067.
// A reduced native document isolates rendering without changing import or mention semantics.
const longTitle = "从 Vibe Coding 到长期工程：Harness 是什么，以及如何从零搭一套适用于 90% 项目的 Harness";
const mention = (pageId, labelSnapshot) => ({ type: "pageMention", props: { pageId, labelSnapshot } });
const text = (value) => ({ type: "text", text: value, styles: {} });
const heading = (id, level, content, textAlignment = "left") => ({ id, type: "heading", props: { level, textAlignment }, content });
const workspace = coreParityWorkspace();
workspace.ui.selectedPageId = "editor-page";
workspace.ui.preferences = { theme: "system" };
const sourcePage = workspace.pages.find((entry) => entry.id === "editor-page");
sourcePage.settings.fullWidth = true;
sourcePage.content = [
  { id: "featured-columns87", type: "columnList", props: { columns: 3 }, children: [
    { id: "featured-column-link87", type: "column", props: { index: 0, count: 3, width: 100 / 3 }, children: [heading("featured-link87", 3, [mention("long-target87", longTitle)])] },
    { id: "featured-column-plain87", type: "column", props: { index: 1, count: 3, width: 100 / 3 }, children: [heading("featured-plain87", 3, [text(longTitle)])] },
    { id: "featured-column-anchor87", type: "column", props: { index: 2, count: 3, width: 100 / 3 }, children: [heading("featured-anchor87", 3, [{ type: "link", href: "lifeatlas://page/long-target87", content: [text(longTitle)] }])] },
  ] },
  ...[1, 2, 3].map((level) => heading(`mixed-h${level}-87`, level, [text("标题前缀 "), mention("short-target87", "短标题87"), text(" 标题后缀")])),
  heading("center-heading87", 3, [text("居中 "), mention("short-target87", "短标题87")], "center"),
  heading("right-heading87", 3, [text("右对齐 "), mention("short-target87", "短标题87")], "right"),
  { id: "paragraph-mention87", type: "paragraph", content: [text("普通段落 "), mention("short-target87", "短标题87"), text(" 正文尾部")] },
  { id: "save-line87", type: "paragraph", content: [text("保存重载验证87")] },
];
for (const [id, title] of [["long-target87", longTitle], ["short-target87", "短标题87"]]) {
  workspace.pages.push({ ...structuredClone(sourcePage), id, title, content: [{ id: `${id}-body`, type: "paragraph", content: `真实导航目标 ${id}` }] });
}
const editorSelector = '.life-editor[data-page-id="editor-page"] .bn-editor';
const block = (page, id) => page.locator(`${editorSelector} .bn-block-outer[data-id="${id}"]`).first();
const native = (page) => page.evaluate((selector) => document.querySelector(selector).pmViewDesc.node.type.schema.cached.blockNoteEditor.document, editorSelector);
const flatten = (blocks) => blocks.flatMap((entry) => [entry, ...flatten(entry.children || [])]);
const headingSnapshot = (blocks) => flatten(blocks).filter((entry) => entry.type === "heading");

async function measure(page) {
  return page.evaluate((selector) => {
    const editor = document.querySelector(selector);
    const style = (element) => {
      const value = getComputedStyle(element);
      return Object.fromEntries(["fontFamily", "fontSize", "fontWeight", "lineHeight", "textAlign", "display", "paddingLeft", "paddingRight"].map((key) => [key, value[key]]));
    };
    const rect = (element) => {
      const value = element.getBoundingClientRect();
      return { x: value.x, y: value.y, width: value.width, height: value.height, right: value.right };
    };
    const lines = (element) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      const result = [];
      while (walker.nextNode()) {
        const range = document.createRange(); range.selectNodeContents(walker.currentNode);
        for (const value of range.getClientRects()) if (value.width) result.push({ x: value.x, y: value.y, width: value.width, right: value.right });
      }
      // A text range can return a separate trailing-space fragment on the same
      // visual line. Compare line origins, not individual fragment origins.
      const rows = [];
      for (const fragment of result) {
        const row = rows.find((entry) => Math.abs(entry.y - fragment.y) < 0.5);
        if (!row) rows.push({ ...fragment });
        else {
          row.x = Math.min(row.x, fragment.x); row.right = Math.max(row.right, fragment.right);
          row.width = row.right - row.x;
        }
      }
      return rows;
    };
    const headings = [...editor.querySelectorAll('[data-content-type="heading"]')].map((element) => {
      const inline = element.querySelector(".bn-inline-content");
      const wrapper = element.querySelector(".life-mention");
      const link = element.querySelector(".life-mention > button, a");
      return {
        id: element.closest(".bn-block-outer").dataset.id, level: element.dataset.level,
        heading: style(element), inline: style(inline), rect: rect(inline), plainLines: lines(inline),
        ...(link ? { mention: wrapper && style(wrapper), link: style(link), linkRect: rect(link), linkLines: lines(link), disabled: link.disabled || false } : {}),
      };
    });
    const paragraph = editor.querySelector('[data-id="paragraph-mention87"] [data-content-type="paragraph"]');
    const paragraphLink = paragraph.querySelector(".life-mention > button");
    return { viewport: { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth }, headings, paragraph: { inline: style(paragraph.querySelector(".bn-inline-content")), mention: style(paragraph.querySelector(".life-mention")), link: style(paragraphLink) } };
  }, editorSelector);
}

const report = await browserScenario("v13-heading-link87", async ({ page, check, assert, saved, persisted }) => {
  await page.locator(editorSelector).waitFor();
  await page.evaluate(() => document.fonts.ready);
  let initial;
  let originalHeadings;
  const typography = (value) => {
    for (const row of value.headings.filter((entry) => entry.link)) {
      for (const key of ["fontFamily", "fontSize", "fontWeight", "lineHeight"]) assert.equal(row.link[key], row.inline[key], `${row.id} ${key} follows its heading`);
      assert.equal(row.link.textAlign, row.inline.textAlign, `${row.id} link alignment follows its heading`);
    }
  };
  const wrappedLeft = (value) => {
    const linked = value.headings.find((entry) => entry.id === "featured-link87");
    const plain = value.headings.find((entry) => entry.id === "featured-plain87");
    assert.ok(linked.linkLines.length >= 2, "the real long title must wrap");
    assert.ok(plain.plainLines.length >= 2, "the same plain heading must wrap");
    for (const line of linked.linkLines) assert.ok(Math.abs(line.x - linked.linkRect.x) < 1, `wrapped link line begins at the link left edge: ${JSON.stringify(line)}`);
    for (const line of plain.plainLines) assert.ok(Math.abs(line.x - plain.rect.x) < 1, "plain heading control remains left aligned");
    assert.ok(Math.abs((linked.linkLines[0].x - linked.rect.x) - (plain.plainLines[0].x - plain.rect.x)) < 1, "linked and plain headings share the same text origin");
  };

  await check("record current heading/link/paragraph CSS and long-title line geometry before assertions", async () => {
    initial = await measure(page); publish("initial-measurements.json", initial);
    originalHeadings = headingSnapshot(await native(page));
    assert.equal(initial.headings.length, 8);
    const long = initial.headings.find((entry) => entry.id === "featured-link87");
    assert.ok(long.linkLines.length >= 2);
    await page.screenshot({ path: path.join(directory, "desktop-light.png"), fullPage: true, animations: "disabled" });
  });
  await check("heading links inherit font family, size, weight, line height and explicit alignment", async () => {
    typography(initial);
    const plain = initial.headings.find((entry) => entry.id === "featured-plain87");
    const linked = initial.headings.find((entry) => entry.id === "featured-link87");
    for (const key of ["fontFamily", "fontSize", "fontWeight", "lineHeight"]) assert.equal(linked.link[key], plain.inline[key]);
    assert.deepEqual(["center-heading87", "right-heading87"].map((id) => initial.headings.find((entry) => entry.id === id).link.textAlign), ["center", "right"]);
  });
  await check("multiline page mention follows the same left alignment as the plain heading", async () => wrappedLeft(initial));
  await check("paragraph mention keeps its existing 500 weight and body font", async () => {
    assert.equal(initial.paragraph.link.fontWeight, "500");
    assert.equal(initial.paragraph.mention.fontWeight, "500");
    assert.equal(initial.paragraph.link.fontSize, initial.paragraph.inline.fontSize);
    assert.equal(initial.paragraph.link.fontFamily, initial.paragraph.inline.fontFamily);
  });
  await check("heading links open their actual local page targets", async () => {
    await block(page, "featured-link87").locator(".life-mention > button").click();
    await page.waitForFunction((title) => document.querySelector(".page-title-input")?.value === title, longTitle);
    await page.locator('.life-editor[data-page-id="long-target87"] .bn-editor').waitFor();
    assert.equal((await persisted((value) => value.ui.selectedPageId === "long-target87")).ui.selectedPageId, "long-target87");
    await page.locator('.workspace-sidebar .page-tree-row[data-node-id="editor-page"]').click();
    await page.locator(editorSelector).waitFor();
    await block(page, "mixed-h2-87").locator(".life-mention > button").click();
    await page.locator('.life-editor[data-page-id="short-target87"] .bn-editor').waitFor();
    assert.equal((await persisted((value) => value.ui.selectedPageId === "short-target87")).ui.selectedPageId, "short-target87");
    await page.locator('.workspace-sidebar .page-tree-row[data-node-id="editor-page"]').click();
    await page.locator(editorSelector).waitFor();
  });
  await check("948px window keeps wrapping, inherited typography and no horizontal overflow in both themes", async () => {
    await page.setViewportSize({ width: 948, height: 900 });
    for (const mode of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme: mode });
      await page.waitForFunction((value) => document.documentElement.dataset.theme === value, mode);
      const measurements = await measure(page); publish(`narrow-${mode}-measurements.json`, measurements);
      typography(measurements); wrappedLeft(measurements);
      assert.ok(measurements.viewport.scrollWidth <= measurements.viewport.width, "window has no horizontal overflow");
      const long = measurements.headings.find((entry) => entry.id === "featured-link87");
      assert.ok(long.linkRect.right <= long.rect.right + 1, "wrapped button stays inside its heading");
      for (const line of long.linkLines) assert.ok(line.right <= long.rect.right + 1, "wrapped text stays inside its heading");
      await page.screenshot({ path: path.join(directory, `narrow-${mode}.png`), fullPage: true, animations: "disabled" });
    }
  });
  await check("a real edit saves and reloads with unchanged heading targets, alignment and typography", async () => {
    const content = block(page, "save-line87").locator(".bn-inline-content");
    await content.click(); await page.keyboard.press("End"); await page.keyboard.insertText(" · 已保存87");
    const stored = await persisted((value) => JSON.stringify(value.pages.find((entry) => entry.id === "editor-page").content).includes("已保存87"));
    const savedContent = stored.pages.find((entry) => entry.id === "editor-page").content;
    assert.deepEqual(headingSnapshot(await native(page)), originalHeadings);
    await page.reload(); await page.locator(editorSelector).waitFor(); await page.evaluate(() => document.fonts.ready);
    assert.deepEqual((await saved()).pages.find((entry) => entry.id === "editor-page").content, savedContent);
    assert.deepEqual(headingSnapshot(await native(page)), originalHeadings);
    const measurements = await measure(page); publish("reloaded-measurements.json", measurements);
    typography(measurements); wrappedLeft(measurements);
    assert.equal(measurements.paragraph.link.fontWeight, "500");
    publish("saved-content.json", savedContent);
    await page.screenshot({ path: path.join(directory, "reloaded-dark.png"), fullPage: true, animations: "disabled" });
  });
}, { workspace, viewport: { width: 1440, height: 900 } });
publish("scenario.json", report);
