import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { browserScenario } from "./harness.mjs";
import { coreParityWorkspace } from "../fixtures/core-parity-workspace.mjs";

const run = process.env.LINK_DECORATION114_RUN || `run-${Date.now()}`;
if (!/^[a-z0-9-]+$/.test(run)) throw new Error("Use a unique link-decoration114 run name");
const base = "LOCAL-NOTION-001/v13-link-decoration113/browser114";
const directory = path.resolve(".qa", base, run);
if (existsSync(directory)) throw new Error(`Preserve earlier run: ${directory}`);
mkdirSync(directory, { recursive: true });
const publish = (file, value) => writeFileSync(path.join(directory, file), JSON.stringify(value, null, 2) + "\n");
// The existing harness appends .json / -<label>.png to its name. A scoped name
// keeps its reports, screenshots and failure evidence in this unique run too.
const harnessName = `${base}/${run}/harness`;
const href = "http://127.0.0.1:5178/#link-decoration114";
const text = (value, styles = {}) => ({ type: "text", text: value, styles });
const link = (value, styles = {}) => ({ type: "link", href, content: [text(value, styles)] });
const mention = (pageId, labelSnapshot) => ({ type: "pageMention", props: { pageId, labelSnapshot } });
const paragraph = (id, content) => ({ id, type: "paragraph", content });
const heading = (id, level, content) => ({ id, type: "heading", props: { level }, content });
const targets = [
  { id: "seeing-target114", title: "Seeing Like a State" },
  { id: "creative-target114", title: "The Creative Act" },
];

// Native BlockNote fixtures only; no HTML surrogate, Wiki import, captured
// workspace, attachment or database is loaded. Explicit underline is an author
// mark and is intentionally measured separately from automatic link styling.
const workspace = coreParityWorkspace();
workspace.ui.selectedPageId = "editor-page";
workspace.ui.preferences = { theme: "system" };
const source = workspace.pages.find((entry) => entry.id === "editor-page");
source.title = "链接淡线回归114";
source.settings.fullWidth = true;
source.content = [
  paragraph("inline-anchor114", [text("普通正文链接："), link("打开参考114")]),
  { id: "maintenance114", type: "callout", props: { icon: "", tone: "brown", backgroundColor: "brown" },
    content: [text("后台维护："), link("整理数据库结构114")],
    children: [paragraph("maintenance-child114", [text("批量维护入口："), link("打开批量视图114")])] },
  heading("mention-h2-114", 2, [text("最近在读："), mention(targets[0].id, targets[0].title)]),
  { id: "reading-row114", type: "columnList", props: { columns: 2 }, children: [
    { id: "cover-column114", type: "column", props: { width: 24, index: 0, count: 2 }, children: [paragraph("cover-blank114", "")] },
    { id: "reading-column114", type: "column", props: { width: 76, index: 1, count: 2 }, children: [heading("mention-h3-114", 3, [mention(targets[1].id, targets[1].title)])] },
  ] },
  paragraph("mention-paragraph114", [text("正文页面引用："), mention(targets[0].id, targets[0].title)]),
  { id: "page-link114", type: "pageLink", props: { pageId: targets[1].id, label: targets[1].title } },
  paragraph("explicit-marks114", [text("显式下划线114", { underline: true }), text(" / "), text("粗体114", { bold: true }), text(" / "), text("斜体114", { italic: true })]),
  paragraph("explicit-linked-marks114", [link("显式链接格式114", { underline: true, bold: true, italic: true })]),
  paragraph("footer-anchor114", [text("页脚："), link("关于这个工作区与维护说明114")]),
];
workspace.pages = [source, ...targets.map((target) => ({ ...structuredClone(source), id: target.id, title: target.title,
  content: [paragraph(`${target.id}-body`, `实际页面导航目标 ${target.title}`)] }))];
for (const collection of ["dataSources", "databaseItems", "databaseViews", "relations", "attachments", "syncedSources"]) workspace[collection] = [];

const editorSelector = '.life-editor[data-page-id="editor-page"] .bn-editor';
const mentionSelector = '.life-mention[data-mention-type="pageMention"] > button';
const cases = [
  { id: "inline-anchor114", type: "paragraph", action: "a", label: "a" },
  { id: "maintenance114", type: "callout", action: ".life-callout-content a", label: ".life-callout-content a" },
  { id: "maintenance-child114", type: "paragraph", action: "a", label: "a" },
  { id: "mention-h2-114", type: "heading", level: 2, action: mentionSelector, label: mentionSelector, target: targets[0] },
  { id: "mention-h3-114", type: "heading", level: 3, action: mentionSelector, label: mentionSelector, target: targets[1] },
  { id: "mention-paragraph114", type: "paragraph", action: mentionSelector, label: mentionSelector, target: targets[0] },
  { id: "page-link114", type: "pageLink", action: "button.life-page-link-block", label: "button.life-page-link-block > span", target: targets[1] },
  { id: "footer-anchor114", type: "paragraph", action: "a", label: "a" },
];
const outerSelector = (id) => `${editorSelector} .bn-block-outer[data-id="${id}"]`;
const actionLocator = (page, entry) => page.locator(outerSelector(entry.id)).locator(`[data-content-type="${entry.type}"]`).first().locator(entry.action);
const native = (page) => page.evaluate((selector) => document.querySelector(selector).pmViewDesc.node.type.schema.cached.blockNoteEditor.document, editorSelector);
const flatten = (blocks) => blocks.flatMap((entry) => [entry, ...flatten(entry.children || [])]);
const settle = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

async function measure(page, ids = cases.map((entry) => entry.id)) {
  return page.evaluate(({ selector, entries }) => {
    const editor = document.querySelector(selector);
    const cssKeys = ["display", "visibility", "opacity", "color", "webkitTextFillColor", "backgroundColor", "backgroundImage", "textDecorationLine", "textDecorationStyle", "textDecorationColor", "textDecorationThickness", "textUnderlineOffset", "borderBottomStyle", "borderBottomWidth", "borderBottomColor", "boxShadow", "fontWeight", "fontStyle"];
    const css = (element, pseudo) => {
      const value = getComputedStyle(element, pseudo);
      return { ...Object.fromEntries(cssKeys.map((key) => [key, value[key]])), content: value.content };
    };
    const color = (value) => {
      if (value === "transparent") return [0, 0, 0, 0];
      const hex = /^#([\da-f]{6}|[\da-f]{3})$/i.exec(value.trim());
      if (hex) {
        const digits = hex[1].length === 3 ? [...hex[1]].map((digit) => digit + digit).join("") : hex[1];
        return [0, 2, 4].map((offset) => parseInt(digits.slice(offset, offset + 2), 16)).concat(1);
      }
      const rgb = /^rgba?\((.+)\)$/i.exec(value.trim());
      if (!rgb) throw new Error(`Unsupported computed color, preserve evidence before changing measurement: ${value}`);
      const parts = rgb[1].trim().split(/[\s,/]+/);
      const channels = parts.slice(0, 3).map((part) => parseFloat(part) * (part.endsWith("%") ? 2.55 : 1));
      return channels.concat(parts[3] === undefined ? 1 : parseFloat(parts[3]) / (parts[3].endsWith("%") ? 100 : 1));
    };
    const over = (foreground, background) => foreground.slice(0, 3).map((channel, index) => channel * foreground[3] + background[index] * (1 - foreground[3]));
    const distance = (a, b) => Math.hypot(...a.slice(0, 3).map((channel, index) => channel - b[index]));
    const rootCss = getComputedStyle(document.documentElement);
    const ink = color(rootCss.getPropertyValue("--mb-ink").trim());
    const paper = color(rootCss.getPropertyValue("--mb-paper").trim());
    const describe = (element) => ({ tag: element.tagName, className: element.className, blockId: element.dataset.id || null });
    const chain = (element, stop) => {
      const result = [];
      for (let current = element; current; current = current.parentElement) {
        result.push({ ...describe(current), css: css(current), element: current });
        if (current === stop) break;
      }
      return result;
    };
    const inspect = (label, action) => {
      const paintingChain = chain(label, document.documentElement);
      const background = [...paintingChain].reverse().reduce((paint, entry) => over(color(entry.css.backgroundColor), paint), paper.slice(0, 3));
      const opacity = paintingChain.reduce((value, entry) => value * Number(entry.css.opacity), 1);
      const fullInk = over(ink, background);
      const denominator = distance(fullInk, background);
      if (denominator <= 0) throw new Error("Full-contrast ink must differ from the painted background");
      const sources = (entries) => entries.flatMap((entry) => {
        const result = [];
        const append = (kind, paintColor, lineCount, thickness, offset) => {
          const rgba = color(paintColor);
          if (rgba[3] <= 0 || entry.css.display === "none" || entry.css.visibility !== "visible") return;
          result.push({ ...describe(entry.element), pseudo: entry.pseudo || null, kind, lineCount, color: paintColor, alpha: rgba[3], thickness, offset,
            contrast: distance(over([rgba[0], rgba[1], rgba[2], rgba[3] * opacity], background), background) / denominator });
        };
        if (entry.css.textDecorationLine.split(/\s+/).includes("underline")) {
          append("text-decoration", entry.css.textDecorationColor, entry.css.textDecorationStyle === "double" ? 2 : 1, entry.css.textDecorationThickness, entry.css.textUnderlineOffset);
        }
        // A bottom border on an inline label can add a second visible line.
        // Whole block/container borders are not link underlines.
        if ((entry.element === label || entry.element === action || entry.css.display.startsWith("inline")) &&
            !["none", "hidden"].includes(entry.css.borderBottomStyle) && parseFloat(entry.css.borderBottomWidth) > 0) {
          append("border-bottom", entry.css.borderBottomColor, entry.css.borderBottomStyle === "double" ? 2 : 1, entry.css.borderBottomWidth, null);
        }
        return result;
      });
      const fragments = [];
      const walker = document.createTreeWalker(label, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (!node.textContent.trim()) continue;
        const range = document.createRange(); range.selectNodeContents(node);
        const rects = [...range.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0).map(({ x, y, width, height }) => ({ x, y, width, height }));
        if (!rects.length) continue;
        const entries = chain(node.parentElement, editor);
        const pseudos = entries.flatMap((entry) => ["::before", "::after"].map((pseudo) => ({ ...entry, pseudo, css: css(entry.element, pseudo) })).filter((entry) => !["none", "normal", '""', "''"].includes(entry.css.content)));
        const lines = sources([...entries, ...pseudos]);
        const nodeCss = css(node.parentElement);
        const rgba = color(nodeCss.color);
        const fill = color(nodeCss.webkitTextFillColor);
        fragments.push({ text: node.textContent, rects, lines, lineCount: lines.reduce((sum, entry) => sum + entry.lineCount, 0),
          textColor: nodeCss.color, textFillColor: nodeCss.webkitTextFillColor, opacity,
          textColorDelta: distance(rgba, ink), fillColorDelta: distance(fill, ink), textAlpha: rgba[3], fillAlpha: fill[3],
          textContrast: distance(over([rgba[0], rgba[1], rgba[2], rgba[3] * opacity], background), background) / denominator });
      }
      return { text: label.textContent, background, ink, fragments, chain: chain(label, editor).map(({ element, ...entry }) => entry) };
    };
    const rows = entries.map((entry) => {
      const outer = editor.querySelector(`.bn-block-outer[data-id="${entry.id}"]`);
      const content = [...outer.querySelectorAll(`[data-content-type="${entry.type}"]`)].find((element) => element.closest(".bn-block-outer") === outer);
      if (!content) throw new Error(`Missing own native ${entry.type} content: ${entry.id}`);
      // Filter by owning block: the maintenance header must not silently select
      // an anchor from its child paragraph if its own anchor disappears.
      const own = (query) => [...content.querySelectorAll(query)].filter((element) => element.closest(".bn-block-outer") === outer);
      const actions = own(entry.action), labels = own(entry.label);
      if (actions.length !== 1 || labels.length !== 1) throw new Error(`Expected exactly one own action/label for ${entry.id}; got ${actions.length}/${labels.length}`);
      return { id: entry.id, type: entry.type, level: content.dataset.level || null, tag: actions[0].tagName, disabled: Boolean(actions[0].disabled), hovered: actions[0].matches(":hover"),
        href: actions[0].getAttribute("href"), target: actions[0].getAttribute("target"), ...inspect(labels[0], actions[0]) };
    });
    const markRow = (id) => {
      const outer = editor.querySelector(`.bn-block-outer[data-id="${id}"]`);
      const snapshots = (query) => [...outer.querySelectorAll(query)].map((element) => ({ text: element.textContent, css: css(element), chain: chain(element, editor).map(({ element, ...entry }) => entry) }));
      return { underline: snapshots("u"), bold: snapshots("strong,b"), italic: snapshots("em,i"), anchor: snapshots("a") };
    };
    return { theme: document.documentElement.dataset.theme, viewport: { width: innerWidth, height: innerHeight }, rows,
      marks: { plain: markRow("explicit-marks114"), linked: markRow("explicit-linked-marks114") } };
  }, { selector: editorSelector, entries: cases.filter((entry) => ids.includes(entry.id)) });
}

function assertAutomaticLinks(assert, value, contrastLimit, hoverId = null) {
  for (const row of value.rows) {
    assert.equal(row.hovered, row.id === hoverId, `${row.id}: measured ${hoverId ? "hover" : "idle"} state`);
    assert.equal(row.disabled, false, `${row.id}: actual navigation action stays enabled`);
    assert.ok(row.fragments.length > 0, `${row.id}: visible text geometry exists`);
    for (const fragment of row.fragments) {
      assert.equal(fragment.lineCount, 1, `${value.theme}/${value.viewport.width}/${row.id}: one painted underline source per text fragment; ${JSON.stringify(fragment.lines)}`);
      assert.ok(fragment.lines.every((line) => line.contrast > 0 && line.contrast <= contrastLimit), `${row.id}: line contrast <= ${contrastLimit}; ${JSON.stringify(fragment.lines)}`);
      assert.ok(fragment.textColorDelta <= 1 && fragment.fillColorDelta <= 1, `${row.id}: text keeps full theme ink rather than fading with its line`);
      assert.equal(fragment.textAlpha, 1); assert.equal(fragment.fillAlpha, 1); assert.equal(fragment.opacity, 1);
      assert.ok(Math.abs(fragment.textContrast - 1) <= 0.005, `${row.id}: composited text keeps full contrast`);
    }
    if (row.tag === "A") { assert.equal(row.href, href); assert.equal(row.target, "_blank"); }
  }
}

function assertMarks(assert, value) {
  for (const [kind, marks] of Object.entries(value.marks)) {
    for (const name of ["underline", "bold", "italic"]) assert.equal(marks[name].length, 1, `${kind}: native ${name} mark exists`);
    assert.ok(marks.underline[0].css.textDecorationLine.split(/\s+/).includes("underline"), `${kind}: the author underline mark itself still paints, independently of the anchor's automatic line`);
    assert.ok(Number(marks.bold[0].css.fontWeight) >= 600, `${kind}: author bold still paints`);
    assert.equal(marks.italic[0].css.fontStyle, "italic", `${kind}: author italic still paints`);
  }
  assert.equal(value.marks.linked.anchor.length, 1);
  const anchor = value.marks.linked.anchor[0];
  const explicit = value.marks.linked.underline[0];
  assert.equal(explicit.text, anchor.text, "linked author underline remains on the actual anchor text");
}

let originalDocument;
const report = await browserScenario(harnessName, async ({ page, check, assert, screenshot, persisted }) => {
  await page.locator(editorSelector).waitFor(); await page.evaluate(() => document.fonts.ready);
  await check("native editor fixture contains the unmarked inline, maintenance, heading, paragraph and block links", async () => {
    originalDocument = await native(page); publish("native-fixture.json", originalDocument);
    const blocks = flatten(originalDocument);
    for (const entry of cases) {
      const block = blocks.find((candidate) => candidate.id === entry.id);
      assert.equal(block.type, entry.type);
      if (entry.level) assert.equal(block.props.level, entry.level);
      if (entry.target) assert.equal(block.type === "pageLink" ? block.props.pageId : block.content.find((item) => item.type === "pageMention").props.pageId, entry.target.id);
      assert.equal(JSON.stringify(block.content || []).includes('"underline":true'), false, `${entry.id}: faint underline is automatic`);
      assert.equal(await actionLocator(page, entry).count(), 1, `${entry.id}: selector resolves one own native action`);
    }
    const marks = blocks.find((entry) => entry.id === "explicit-marks114").content;
    for (const key of ["underline", "bold", "italic"]) assert.ok(marks.some((item) => item.styles?.[key] === true));
    const linked = blocks.find((entry) => entry.id === "explicit-linked-marks114").content[0];
    assert.equal(linked.type, "link"); assert.equal(linked.href, href);
    for (const key of ["underline", "bold", "italic"]) assert.equal(linked.content[0].styles[key], true);
  });
  for (const width of [1440, 948]) for (const theme of ["light", "dark"]) {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme: theme });
    await page.waitForFunction((value) => document.documentElement.dataset.theme === value, theme);
    await check(`${width}px ${theme}: idle links have one faint line and full-contrast text; explicit marks survive`, async () => {
      await page.mouse.move(1, 1); await page.evaluate(() => document.activeElement?.blur()); await settle(page);
      const value = await measure(page); publish(`idle-${width}-${theme}.json`, value);
      await screenshot(`idle-${width}-${theme}`);
      assert.equal(value.rows.length, cases.length);
      assertAutomaticLinks(assert, value, 0.22); assertMarks(assert, value);
    });
    await check(`${width}px ${theme}: every link hover stays subdued with one line and unchanged text contrast`, async () => {
      for (const entry of cases) {
        await actionLocator(page, entry).hover(); await settle(page);
        const value = await measure(page, [entry.id]); publish(`hover-${width}-${theme}-${entry.id}.json`, value);
        // Capture the reported maintenance/footer defects before asserting them.
        if (["maintenance114", "footer-anchor114"].includes(entry.id)) await screenshot(`hover-${width}-${theme}-${entry.id}`);
        assert.equal(value.rows.length, 1); assertAutomaticLinks(assert, value, 0.3, entry.id); assertMarks(assert, value);
      }
    });
  }
  for (const entry of cases.filter((candidate) => candidate.target)) {
    await check(`${entry.id}: clicking the actual page reference opens its persisted target without changing native marks`, async () => {
      await actionLocator(page, entry).click();
      await page.locator(`.life-editor[data-page-id="${entry.target.id}"] .bn-editor`).waitFor();
      assert.equal(await page.locator(".page-title-input").inputValue(), entry.target.title);
      await persisted((value, id) => value.ui.selectedPageId === id, entry.target.id);
      await page.locator('.workspace-sidebar .page-tree-row[data-node-id="editor-page"]').click();
      await page.locator(editorSelector).waitFor();
      await persisted((value) => value.ui.selectedPageId === "editor-page");
      assert.deepEqual(await native(page), originalDocument, "navigation preserves automatic links, reference IDs and explicit author formatting");
    });
  }
}, { workspace, viewport: { width: 1440, height: 900 } });
publish("scenario.json", report);
// Core's existing report reader expects this final summary. Only execution
// writes it; immutable per-run evidence above preserves every earlier result.
writeFileSync(path.resolve(".qa/v13-link-decoration114.json"), JSON.stringify({ ...report, evidenceDirectory: directory }, null, 2) + "\n");
