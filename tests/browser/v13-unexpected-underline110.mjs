import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { browserScenario } from "./harness.mjs";
import { coreParityWorkspace } from "../fixtures/core-parity-workspace.mjs";

const name = "v13-unexpected-underline110";
const run = process.env.UNDERLINE110_RUN || `run-${Date.now()}`;
if (!/^[a-z0-9-]+$/.test(run)) throw new Error("Use a unique underline110 run name");
const directory = path.resolve(".qa/LOCAL-NOTION-001/v13-underline109/browser110", run);
if (existsSync(directory)) throw new Error(`Preserve earlier run: ${directory}`);
mkdirSync(directory, { recursive: true });
const publish = (file, value) => writeFileSync(path.join(directory, file), JSON.stringify(value, null, 2) + "\n");
const text = (value, styles = {}) => ({ type: "text", text: value, styles });
const mention = (pageId, labelSnapshot) => ({ type: "pageMention", props: { pageId, labelSnapshot } });
const href = "http://127.0.0.1:5178/#underline110-target";
const link = (content) => ({ type: "link", href, content });
const heading = (id, level, content) => ({ id, type: "heading", props: { level, textAlignment: "left" }, content });
const books = [
  { id: "seeing-book110", target: "seeing-target110", title: "Seeing Like a State" },
  { id: "creative-book110", target: "creative-target110", title: "The Creative Act" },
];

// native184-formal27-underline-user-resume.json proves both book titles are
// unmarked pageMention content in h3, in the 76% text column of separate rows.
// Keep that actual shape without copying the Wiki or its attachments/database.
const workspace = coreParityWorkspace();
workspace.ui.selectedPageId = "editor-page";
workspace.ui.preferences = { theme: "system" };
const sourcePage = workspace.pages.find((entry) => entry.id === "editor-page");
sourcePage.settings.fullWidth = true;
sourcePage.title = "最近在读 · 下划线110";
sourcePage.content = [
  heading("reading-section110", 2, [text("最近在读")]),
  ...books.map((book) => ({ id: `${book.id}-row`, type: "columnList", props: { columns: 2 }, children: [
    { id: `${book.id}-cover-column`, type: "column", props: { width: 24, index: 0, count: 2 }, children: [{ id: `${book.id}-blank`, type: "paragraph", content: "" }] },
    { id: `${book.id}-text-column`, type: "column", props: { width: 76, index: 1, count: 2 }, children: [heading(book.id, 3, [mention(book.target, book.title)])] },
  ] })),
  heading("mention-h2-110", 2, [mention("seeing-target110", "Seeing Like a State")]),
  heading("anchor-h2-110", 2, [link([text("Seeing Like a State")])]),
  heading("anchor-h3-110", 3, [link([text("The Creative Act")])]),
  heading("marked-h2-110", 2, [text("显式下划线110", { underline: true }), text(" / "), text("粗体110", { bold: true }), text(" / "), text("斜体110", { italic: true })]),
  heading("marked-anchor-h3-110", 3, [link([text("显式链接下划线110", { underline: true, bold: true, italic: true })])]),
];
workspace.pages = [sourcePage, ...books.map((book) => ({ ...structuredClone(sourcePage), id: book.target, title: book.title, content: [{ id: `${book.target}-body`, type: "paragraph", content: `真实导航目标 ${book.title}` }] }))];
for (const collection of ["dataSources", "databaseItems", "databaseViews", "relations", "attachments", "syncedSources"]) workspace[collection] = [];

const editorSelector = '.life-editor[data-page-id="editor-page"] .bn-editor';
const block = (page, id) => page.locator(`${editorSelector} .bn-block-outer[data-id="${id}"]`).first();
const native = (page) => page.evaluate((selector) => document.querySelector(selector).pmViewDesc.node.type.schema.cached.blockNoteEditor.document, editorSelector);
const flatten = (blocks) => blocks.flatMap((entry) => [entry, ...flatten(entry.children || [])]);
const actionableIds = ["seeing-book110", "creative-book110", "mention-h2-110", "anchor-h2-110", "anchor-h3-110"];

async function measure(page) {
  return page.evaluate(({ selector, ids }) => {
    const editor = document.querySelector(selector);
    const style = (element) => {
      const value = getComputedStyle(element);
      return Object.fromEntries(["textDecorationLine", "textDecorationStyle", "textDecorationColor", "textDecorationThickness", "textUnderlineOffset", "fontFamily", "fontSize", "fontWeight", "fontStyle", "lineHeight", "outlineStyle", "outlineWidth", "outlineColor"].map((key) => [key, value[key]]));
    };
    const chain = (element, heading) => {
      const result = [];
      for (let current = element; current; current = current.parentElement) {
        result.push({ tag: current.tagName, className: current.className, css: style(current) });
        if (current === heading) break;
      }
      return result;
    };
    const rows = ids.map((id) => {
      const outer = editor.querySelector(`.bn-block-outer[data-id="${id}"]`);
      const heading = outer.querySelector('[data-content-type="heading"]');
      const action = heading.querySelector(".life-mention > button, a");
      const range = document.createRange(); range.selectNodeContents(action);
      return { id, level: heading.dataset.level, text: action.textContent, tag: action.tagName, css: style(action), chain: chain(action, heading), href: action.getAttribute("href"), target: action.getAttribute("target"), disabled: action.disabled || false, tabIndex: action.tabIndex, hovered: action.matches(":hover"), focused: action === document.activeElement, lineRects: [...range.getClientRects()].filter((rect) => rect.width).map(({ x, y, width, height }) => ({ x, y, width, height })) };
    });
    const markedHeading = editor.querySelector('.bn-block-outer[data-id="marked-h2-110"] [data-content-type="heading"]');
    const markedLinkHeading = editor.querySelector('.bn-block-outer[data-id="marked-anchor-h3-110"] [data-content-type="heading"]');
    const marks = {
      underline: [...markedHeading.querySelectorAll("u")].map((element) => ({ text: element.textContent, chain: chain(element, markedHeading) })),
      bold: [...markedHeading.querySelectorAll("strong,b")].map((element) => ({ text: element.textContent, css: style(element) })),
      italic: [...markedHeading.querySelectorAll("em,i")].map((element) => ({ text: element.textContent, css: style(element) })),
      linkUnderline: [...markedLinkHeading.querySelectorAll("u")].map((element) => ({ text: element.textContent, chain: chain(element, markedLinkHeading) })),
      linkBold: [...markedLinkHeading.querySelectorAll("strong,b")].map((element) => ({ text: element.textContent, css: style(element) })),
      linkItalic: [...markedLinkHeading.querySelectorAll("em,i")].map((element) => ({ text: element.textContent, css: style(element) })),
    };
    return { theme: document.documentElement.dataset.theme, viewport: { width: innerWidth, height: innerHeight }, rows, marks };
  }, { selector: editorSelector, ids: actionableIds });
}

const measurements = [];
let originalDocument;
const report = await browserScenario(name, async ({ page, check, assert, screenshot, persisted }) => {
  await page.locator(editorSelector).waitFor();
  await page.evaluate(() => document.fonts.ready);
  await check("the exact imported book shape renders as enabled h3 page-mention buttons with no explicit underline mark", async () => {
    originalDocument = await native(page);
    const blocks = flatten(originalDocument);
    for (const book of books) {
      const entry = blocks.find((candidate) => candidate.id === book.id);
      assert.equal(entry.type, "heading"); assert.equal(entry.props.level, 3);
      assert.deepEqual(entry.content, [{ ...mention(book.target, book.title), content: undefined }]);
      const action = block(page, book.id).locator(".life-mention > button");
      assert.equal(await action.innerText(), book.title);
      assert.equal(await action.isEnabled(), true);
    }
    publish("fixture.json", { source: ".qa/LOCAL-NOTION-001/v9-formal-database-ui01/evidence/native184-formal27-underline-user-resume.json", document: originalDocument });
  });
  await check("capture actual idle computed decoration chains and screenshots in two themes at 1440px and 948px", async () => {
    for (const width of [1440, 948]) {
      await page.setViewportSize({ width, height: 900 });
      for (const theme of ["light", "dark"]) {
        await page.emulateMedia({ colorScheme: theme });
        await page.waitForFunction((value) => document.documentElement.dataset.theme === value, theme);
        await page.mouse.move(1, 1);
        await page.evaluate(() => document.activeElement?.blur());
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const value = await measure(page);
        measurements.push(value); publish(`idle-${width}-${theme}.json`, value);
        assert.equal(value.rows.length, actionableIds.length);
        for (const row of value.rows) { assert.equal(row.hovered, false); assert.equal(row.focused, false); assert.ok(row.lineRects.length > 0); }
        const label = `idle-${width}-${theme}`;
        await screenshot(label);
        copyFileSync(`.qa/${name}-${label}.png`, path.join(directory, `${label}.png`));
      }
    }
  });
  // The user clarified on 2026-11-14 that Notion uses a very faint line.
  // Preserve the original zero-line test and its evidence in before113;
  // current titles require one faint line rather than no decoration.
  await check("idle h2/h3 page-mention titles have one faint thin underline without duplicate wrapper decoration", async () => {
    const decorations = measurements.flatMap((value) => value.rows.filter((row) => row.tag === "BUTTON").map((row) => ({ theme: value.theme, width: value.viewport.width, id: row.id, lines: row.chain.filter((entry) => entry.css.textDecorationLine.split(" ").includes("underline")) })));
    publish("single-faint-underlines.json", decorations);
    for (const row of decorations) {
      assert.equal(row.lines.length, 1, `${row.theme}/${row.width}/${row.id}: one automatic decoration owner`);
      const css = row.lines[0].css;
      assert.equal(css.textDecorationStyle, "solid");
      assert.equal(css.textDecorationThickness, "1px");
      const color = /^rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)$/.exec(css.textDecorationColor);
      assert.ok(color && Number(color[1]) > 0 && Number(color[1]) <= 0.22, `Reference line stays faint: ${css.textDecorationColor}`);
    }
  });
  await check("explicit underline text and linked underline marks still render with bold and italic in every captured theme/width", async () => {
    const hasUnderline = (mark) => mark.chain.some((entry) => entry.css.textDecorationLine.split(" ").includes("underline"));
    for (const value of measurements) {
      for (const key of ["underline", "linkUnderline"]) {
        assert.equal(value.marks[key].length, 1, `${key} native mark exists`);
        assert.equal(hasUnderline(value.marks[key][0]), true, `${value.theme}/${value.viewport.width}: ${key} remains visually underlined`);
      }
      for (const key of ["bold", "linkBold"]) { assert.equal(value.marks[key].length, 1); assert.ok(Number(value.marks[key][0].css.fontWeight) >= 600, `${key} remains bold`); }
      for (const key of ["italic", "linkItalic"]) { assert.equal(value.marks[key].length, 1); assert.equal(value.marks[key][0].css.fontStyle, "italic", `${key} remains italic`); }
    }
  });
  await check("ordinary h2/h3 anchors retain decoration, href and target; page mentions retain real Enter and click navigation", async () => {
    for (const value of measurements) for (const row of value.rows.filter((entry) => entry.tag === "A")) {
      assert.equal(row.href, href); assert.equal(row.target, "_blank"); assert.ok(row.tabIndex >= 0);
      assert.equal(row.chain.some((entry) => entry.css.textDecorationLine.split(" ").includes("underline")), true, "ordinary anchor links preserve their intentional link decoration");
    }
    const keyboardMention = block(page, "mention-h2-110").locator(".life-mention > button");
    // Keep the complete Tab/focus investigation in browser110/
    // tab-investigation-green02.mjs and its failed green01/green02 evidence.
    // It is not accepted or part of this local decoration improvement.
    await keyboardMention.focus();
    assert.equal(await block(page, "mention-h2-110").locator("button").evaluate((element) => element === document.activeElement), true);
    await page.keyboard.press("Enter");
    await page.locator('.life-editor[data-page-id="seeing-target110"] .bn-editor').waitFor();
    await persisted((value) => value.ui.selectedPageId === "seeing-target110");
    await page.locator('.workspace-sidebar .page-tree-row[data-node-id="editor-page"]').click();
    await page.locator(editorSelector).waitFor();
    await block(page, "creative-book110").locator(".life-mention > button").click();
    await page.locator('.life-editor[data-page-id="creative-target110"] .bn-editor').waitFor();
    await persisted((value) => value.ui.selectedPageId === "creative-target110");
    await page.locator('.workspace-sidebar .page-tree-row[data-node-id="editor-page"]').click();
    await page.locator(editorSelector).waitFor();
    assert.deepEqual(await native(page), originalDocument, "navigation preserves the native links and explicit formatting marks");
  });
}, { workspace, viewport: { width: 1440, height: 900 } });
publish("scenario.json", report);
if (report.failure && existsSync(`.qa/${name}-failure.png`)) copyFileSync(`.qa/${name}-failure.png`, path.join(directory, "failure.png"));
