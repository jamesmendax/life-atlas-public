import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { PNG_1X1_BASE64 } from "../fixtures/full-workspace.mjs";
import { REPO_ROOT } from "./helpers.mjs";
import { waitFor } from "../release/helpers.mjs";
import { root, block, inline, openPage, mainTitle, focusInfo, editorSnapshot, pause, showBlockMenu } from "./ux-review-editor-support.mjs";

const flat = (blocks) => blocks.flatMap((b) => [b, ...flat(b.children || [])]);
const mainMenu = (page) => page.getByRole("menu", { name: "页面操作", exact: true });
async function actions(page) {
  const menu = mainMenu(page);
  if (!await menu.isVisible()) await page.getByRole("button", { name: "页面操作", exact: true }).click();
  await menu.waitFor();
  return menu;
}
async function assertSelectedText(page, expected) {
  const text = await page.evaluate(() => String(getSelection()));
  assert.ok(text.includes(expected), text);
}

async function checkSourceTabs(page, dialog, name) {
  const group = dialog.getByRole("tablist", { name });
  const tabs = group.getByRole("tab");
  await group.getByRole("tab", { selected: true }).focus();
  const last = await tabs.count() - 1;
  const path = [];
  for (const [key, index] of [["Home", 0], ["End", last], ["ArrowRight", 0], ["ArrowLeft", last], ["Home", 0]]) {
    await page.keyboard.press(key);
    const state = await tabs.evaluateAll((items) => ({
      focused: items.indexOf(document.activeElement),
      selected: items.findIndex((item) => item.getAttribute("aria-selected") === "true"),
      stops: items.flatMap((item, i) => item.tabIndex === 0 ? [i] : []),
    }));
    assert.deepEqual(state, { focused: index, selected: index, stops: [index] });
    path.push({ key, ...state });
  }
  const cells = dialog.locator(".virtual-asset-cell");
  await cells.first().getByRole("button").first().focus();
  await page.keyboard.press("ArrowRight");
  await page.waitForFunction(() => document.activeElement?.closest(".virtual-asset-cell")?.dataset.index === "1");
  return { path, assetIndex: 1 };
}

const saved = async (page) => (await page.evaluate(() => window.lifeAtlas.workspace.load())).value.workspace;

async function persisted(page, read) {
  return waitFor(async () => read(await saved(page)), { timeoutMs: 4200, intervalMs: 70 });
}
export async function scanBlocks(page, label, { visibleFirst = false, readEvents } = {}) {
  const initial = await editorSnapshot(page);
  const rows = [];
  for (const type of initial.types) {
    const targets = root(page).locator('[data-content-type="' + type + '"]');
    const index = visibleFirst ? await targets.evaluateAll((items) => Math.max(0, items.findIndex((item) => {
      const rect = item.closest(".bn-block-outer")?.getBoundingClientRect();
      return rect?.height > 0 && rect.width > 0;
    }))) : 0;
    const target = targets.nth(index);
    if (!await target.count()) { rows.push({ type, availability: "no-rendered-content" }); continue; }
    const geometry = await target.boundingBox();
    const item = target.locator("xpath=ancestor::*[contains(@class,'bn-block-outer')][1]");
    const hover = geometry && geometry.height > 2 ? target : item;
    const rect = await hover.boundingBox();
    if (!rect?.height || !rect.width) { rows.push({ type, availability: "hidden-layout-marker", geometry }); continue; }
    await hover.scrollIntoViewIfNeeded();
    await hover.hover({ position: { x: 3, y: Math.min(6, rect.height / 2) }, timeout: 650 }).catch(() => {});
    const paint = await target.evaluate((el) => {
      const style = getComputedStyle(el);
      return { outline: style.outlineStyle, background: style.backgroundColor, shadow: style.boxShadow,
        selected: Boolean(el.closest(".ProseMirror-selectednode,[data-life-block-selected=true]")), hover: el.matches(":hover") };
    });
    const point = await hover.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      const left = Math.max(0, rect.left), right = Math.min(innerWidth, rect.right);
      const top = Math.max(0, rect.top), bottom = Math.min(innerHeight, rect.bottom);
      for (const y of [top + 3, (top + bottom) / 2, bottom - 3]) {
        for (const x of [left + 4, left + 18, (left + right) / 2, right - 4]) {
          const hit = document.elementFromPoint(x, y);
          if (hit && el.contains(hit) && !hit.closest('button,a,input,select,summary,textarea,[role=tab],[role=slider],audio,video,.bn-toggle-button,.bn-add-file-button,.life-column-resizer')) return { x, y };
        }
      }
      return null;
    });
    let pointer = null, keyboard = null;
    if (readEvents) await readEvents();
    if (point) {
      await page.mouse.click(point.x, point.y);
      pointer = await editorSnapshot(page).then(({ selection, focused, cursor }) => ({ selection, focused, cursor }));
      if (pointer.focused) {
        await page.keyboard.press("ArrowRight");
        keyboard = await editorSnapshot(page).then(({ selection, focused, cursor }) => ({ selection, focused, cursor }));
      }
    }
    rows.push({ type, availability: geometry?.height > 2 ? "rendered" : "layout-container", paint, point, pointer, keyboard,
      ...(readEvents ? { occurrence: index, events: await readEvents() } : {}) });
  }
  const stored = [...new Set(flat(initial.blocks).map((b) => b.type))];
  const missingFromDocument = initial.types.filter((t) => !stored.includes(t));
  assert.deepEqual(missingFromDocument, []);
  assert.deepEqual(rows.filter((row) => row.availability === "no-rendered-content"), []);
  return { label, types: initial.types, stored, missingFromDocument, rows };
}

export async function createReviewTemplatePage(page, name) {
  await openPage(page, mainTitle);
  await (await actions(page)).getByRole("menuitem", { name: /保存为页面模板/ }).click();
  const prompt = page.getByRole("dialog", { name: "保存为页面模板" });
  await prompt.getByRole("textbox").fill(name);
  await prompt.getByRole("button", { name: "保存", exact: true }).click();
  await page.locator(".workspace-sidebar").getByRole("button", { name: "模板", exact: true }).click();
  const gallery = page.getByRole("dialog", { name: "模板库" });
  await gallery.getByRole("button", { name: /我的模板/u }).click();
  await gallery.getByRole("button", { name, exact: true }).click();
  await gallery.getByRole("button", { name: "使用模板", exact: true }).click();
  await gallery.waitFor({ state: "hidden" });
  const id = await page.locator(".life-editor").first().getAttribute("data-page-id");
  assert.ok(id && id !== "editor-page");
  return { id, title: await page.locator(".page-title-input").first().inputValue() };
}

async function syntheticVideo() {
  const alias = execFileSync("where.exe", ["ffmpeg.exe"], { encoding: "utf8", windowsHide: true }).trim().split(/\r?\n/u)[0];
  const ffmpeg = await fs.realpath(alias);
  const bytes = execFileSync(ffmpeg, ["-nostdin", "-hide_banner", "-loglevel", "error", "-threads", "1", "-f", "lavfi", "-i",
    "testsrc2=size=96x64:rate=10:duration=0.5", "-an", "-c:v", "libvpx", "-threads", "1", "-f", "webm", "pipe:1"], { windowsHide: true, timeout: 10000 });
  const probe = JSON.parse(execFileSync(path.join(path.dirname(ffmpeg), "ffprobe.exe"),
    ["-v", "error", "-show_entries", "stream=codec_name,width,height", "-of", "json", "pipe:0"], { input: bytes, windowsHide: true, encoding: "utf8" }));
  assert.deepEqual(probe.streams[0], { codec_name: "vp8", width: 96, height: 64 });
  return bytes;
}

function syntheticPdf() {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << >> /Contents 4 0 R >>",
    "<< /Length 0 >>\nstream\n\nendstream",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [];
  for (const [index, source] of objects.entries()) {
    offsets.push(String(pdf.length).padStart(10, "0"));
    pdf += (index + 1) + " 0 obj\n" + source + "\nendobj\n";
  }
  const start = pdf.length;
  pdf += "xref\n0 5\n0000000000 65535 f \n" + offsets.map((offset) => offset + " 00000 n \n").join("");
  return Buffer.from(pdf + "trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n" + start + "\n%%EOF\n");
}

async function upload(page, type) {
  const target = block(page, "ux-" + type);
  await target.scrollIntoViewIfNeeded();
  const button = target.locator(".bn-add-file-button, .bn-file-block-content-wrapper, [data-test=file-upload-button]").first();
  if (await button.count()) await button.click();
  else await target.locator('[data-content-type="' + (type === "pdf" ? "file" : type) + '"]').first().click();
  const panel = page.locator(".bn-panel:visible").last();
  await panel.waitFor();
  const mime = { image: "image/png", file: "text/plain", pdf: "application/pdf", audio: "audio/wav", video: "video/webm" }[type];
  const name = { image: "picture.png", file: "notes.txt", pdf: "document.pdf", audio: "tone.wav", video: "colors.webm" }[type];
  const bytes = type === "image" ? Buffer.from(PNG_1X1_BASE64, "base64") : type === "audio" ? await fs.readFile(path.join(REPO_ROOT, "market/official/pomodoro/assets/mechanical-tick.wav")) :
    type === "video" ? await syntheticVideo() : type === "pdf" ? syntheticPdf() : Buffer.from("隔离附件内容\n");
  await panel.locator('input[type="file"]').setInputFiles({ name, mimeType: mime, buffer: bytes });
  await panel.waitFor({ state: "hidden" });
  await page.waitForFunction(({ id, name }) => {
    const el = document.querySelector(".life-editor > .bn-container .bn-editor");
    const b = el.pmViewDesc.node.type.schema.cached.blockNoteEditor.document.find((b) => b.id === id);
    return b?.props.name === name && Boolean(b.props.url);
  }, { id: "ux-" + type, name });
  const out = { name, bytes: bytes.length, url: (await editorSnapshot(page)).blocks.find((b) => b.id === "ux-" + type).props.url };
  if (type === "audio" || type === "video") {
    const media = target.locator(type);
    if (type === "video") out.independentlyDecoded = { codec: "vp8", width: 96, height: 64 };
    try { await media.waitFor(); }
    catch { throw new Error("Uploaded " + mime + " " + bytes.length + "B from " + out.url + " did not render a player: " + await target.innerText()); }
    await page.waitForFunction(({ id, kind }) => document.querySelector('[data-id="' + id + '"] ' + kind)?.readyState >= 1, { id: "ux-" + type, kind: type });
    const bounds = await media.boundingBox();
    await media.click({ position: { x: 20, y: Math.max(3, bounds.height - 20) } });
    const playback = () => media.evaluate((el) => ({ ready: el.readyState, paused: el.paused, controls: el.controls,
      duration: Number.isFinite(el.duration) ? el.duration : null, source: el.currentSrc.split(":")[0],
      playedSeconds: el.played.length ? el.played.end(el.played.length - 1) : 0, frames: el.getVideoPlaybackQuality?.().totalVideoFrames }));
    await pause(110);
    if (type === "video" && !(await playback()).playedSeconds) {
      await media.press("Space");
      await pause(350);
    }
    out.player = await playback();
  } else if (type === "image") {
    out.decoded = await target.locator("img").evaluate((el) => ({ width: el.naturalWidth, height: el.naturalHeight }));
    assert.equal(out.decoded.width, 1);
  } else {
    assert.ok((await target.innerText()).includes(name));
    if (type === "pdf") out.inlineViewer = await target.locator("iframe,object,embed,canvas").count();
  }
  return out;
}

export async function runEditorControls({ page, check, finding, shot, surface }) {
  await check("regular-all-registered-blocks-light", () => scanBlocks(page, "ordinary-light"));
  await check("native-pointer-and-keyboard-text-toolbar", async () => {
    const text = inline(page, "ux-format");
    const reselect = async () => {
      await text.click(); await page.keyboard.press("End");
      for (let i = 0; i < 3; i++) await page.keyboard.press("Shift+ArrowLeft");
    };
    const marks = async () => {
      const state = await editorSnapshot(page);
      return { runs: state.blocks.find((b) => b.id === "ux-format").content.map(({ text, styles }) => ({ text, styles })),
        selection: state.selection, native: await page.evaluate(() => String(getSelection())), focus: await focusInfo(page) };
    };
    const styled = (obs, style, expected = "XYZ") => Boolean(expected) && obs.runs.filter((run) => run.styles?.[style]).map((run) => run.text).join("").includes(expected);
    await reselect();
    await assertSelectedText(page, "XYZ");
    const toolbar = page.locator(".bn-formatting-toolbar:visible,.bn-toolbar:visible").filter({ has: page.locator("button") }).last();
    await toolbar.waitFor();
    const buttons = await toolbar.locator("button").evaluateAll((els) => els.map((el) => ({ name: el.getAttribute("aria-label") || el.title || el.innerText, pressed: el.getAttribute("aria-pressed") })));
    await shot("text-selection-toolbar");
    const before = await marks();
    if (before.native !== "XYZ") finding("keyboard-selection-settled-range", { intended: "XYZ", before });
    await toolbar.locator('[data-test="bold"]').click();
    const afterBold = await marks();
    if (!styled(afterBold, "bold", before.native)) finding("format-bold-pointer-range", { before, afterBold });
    await page.keyboard.press("Control+i");
    await pause(80);
    const afterShortcut = await marks();
    if (!styled(afterShortcut, "italic", before.native) || !afterShortcut.focus.inEditor) {
      finding("format-toolbar-pointer-to-keyboard", { afterBold, afterShortcut });
      await reselect();
      await page.keyboard.press("Control+i");
    }
    const finalItalic = await marks();
    assert.ok(styled(finalItalic, "italic", finalItalic.native), "Keyboard italic from inside the editor should format the selected suffix");
    await reselect();
    await page.keyboard.press("Control+u");
    assert.ok(styled(await marks(), "underline"), "Keyboard underline should apply to the selected suffix");
    await page.keyboard.press("Shift+F10");
    await page.getByRole("searchbox", { name: "搜索区块操作" }).waitFor();
    await page.keyboard.press("Escape");
    await assertSelectedText(page, "XYZ");
    const restored = await focusInfo(page);
    assert.ok(restored.inEditor);
    return { buttons, before, afterBold, afterShortcut, restored };
  });
  await check("trusted-block-drag-undo-redo", async () => {
    const source = block(page, "ux-drag-a").locator(".bn-block-content").first();
    const target = block(page, "ux-drag-c").locator(".bn-block-content").first();
    await inline(page, "ux-drag-a").click();
    await target.scrollIntoViewIfNeeded(); await source.hover({ position: { x: 9, y: 8 } });
    const sr = await source.boundingBox();
    await page.mouse.move(sr.x + 10, sr.y + 8);
    const handle = page.locator('.life-block-actions[data-block-id="ux-drag-a"] [draggable="true"]');
    const from = await handle.boundingBox(), to = await target.boundingBox();
    assert.ok(from && to);
    const trace = await page.evaluateHandle(() => {
      const samples = [];
      const events = { dragstart: 0, dragover: 0, drop: 0 };
      const sample = () => {
        const cue = document.querySelector(".life-block-drop-preview");
        if (!cue) return;
        const rect = cue.getBoundingClientRect();
        if (rect.width && rect.height && getComputedStyle(cue).visibility === "visible" && samples.length < 20) {
          samples.push({ kind: cue.dataset.dropKind, left: rect.left, top: rect.top, width: rect.width, height: rect.height });
        }
      };
      const observer = new MutationObserver(sample);
      observer.observe(document.body, { childList: true });
      const nativeDrag = (event) => { if (event.isTrusted) events[event.type]++; sample(); };
      for (const type of Object.keys(events)) document.addEventListener(type, nativeDrag, true);
      return { samples, events, stop() {
        observer.disconnect();
        for (const type of Object.keys(events)) document.removeEventListener(type, nativeDrag, true);
      } };
    });
    const x = from.x + from.width / 2, y = from.y + from.height / 2;
    await page.mouse.move(x, y); await page.mouse.down();
    try {
      await page.mouse.move(x + 8, y + 2, { steps: 3 });
      await page.mouse.move(to.x + 24, to.y + to.height - 2, { steps: 14 });
      await page.mouse.move(to.x + 25, to.y + to.height - 2);
      await pause(100);
    } finally { await page.mouse.up(); }
    const drag = await trace.evaluate((probe) => { probe.stop(); return { cues: probe.samples, events: probe.events }; });
    await trace.dispose();
    const order = async () => (await editorSnapshot(page)).blocks.map((b) => b.id).filter((id) => id.startsWith("ux-drag"));
    const onDisk = (expected) => persisted(page, (ws) => {
      const ids = ws.pages.find((entry) => entry.id === "editor-page").content.map((item) => item.id).filter((id) => id.startsWith("ux-drag"));
      return ids.join() === expected.join() && ids;
    });
    const moved = await order();
    assert.deepEqual(moved, ["ux-drag-b", "ux-drag-c", "ux-drag-a"], JSON.stringify({ from, to, moved, drag }));
    const saved = { moved: await onDisk(moved) };
    await inline(page, "ux-drag-b").click(); await page.keyboard.press("Control+z");
    const undone = await order(); assert.equal(undone[0], "ux-drag-a");
    saved.undone = await onDisk(undone);
    await page.keyboard.press("Control+Shift+z"); assert.deepEqual(await order(), moved);
    saved.redone = await onDisk(moved);
    assert.ok(drag.cues.length, "No visible drop indicator during drag " + JSON.stringify({ from, to, moved, undone, drag }));
    assert.ok(drag.events.dragstart && drag.events.drop);
    return { moved, undone, saved, ...drag };
  });
  await check("selection-toolbar-alignment-colors-type-nest-link", async () => {
    const id = "ux-format-extra";
    const toolbar = page.locator(".bn-formatting-toolbar:visible").last();
    const select = async () => {
      await inline(page, id).click(); await page.keyboard.press("End");
      for (let i = 0; i < 3; i++) await page.keyboard.press("Shift+ArrowLeft");
      await assertSelectedText(page, "XYZ");
      await toolbar.waitFor();
    };
    const documentBlock = async () => flat((await editorSnapshot(page)).blocks).find((item) => item.id === id);
    await select();
    for (const [label, alignment] of [["居中", "center"], ["右对齐", "right"], ["左对齐", "left"]]) {
      await toolbar.getByRole("button", { name: label, exact: true }).click();
      assert.equal((await documentBlock()).props.textAlignment, alignment);
    }
    await toolbar.getByRole("button", { name: "删除线", exact: true }).click();
    assert.ok((await documentBlock()).content.some((run) => run.text === "XYZ" && run.styles.strike));
    for (const [kind, color] of [["text", "red"], ["background", "yellow"]]) {
      await select(); await toolbar.getByRole("button", { name: "颜色", exact: true }).click();
      await page.locator('[data-test="' + kind + '-color-' + color + '"]:visible').click();
      assert.ok((await documentBlock()).content.some((run) => run.text === "XYZ" && run.styles[kind + "Color"] === color));
    }
    await select(); await toolbar.getByRole("button", { name: "段落", exact: true }).click();
    await page.getByRole("menuitem", { name: "二级标题", exact: true }).click();
    assert.equal((await documentBlock()).props.level, 2);
    await select(); await toolbar.getByRole("button", { name: "二级标题", exact: true }).click();
    await page.getByRole("menuitem", { name: "段落", exact: true }).click();
    assert.equal((await documentBlock()).type, "paragraph");
    await select(); await toolbar.getByRole("button", { name: "嵌套", exact: true }).click();
    assert.ok((await editorSnapshot(page)).blocks.find((item) => item.id === "ux-end").children.some((item) => item.id === id));
    await select(); await toolbar.getByRole("button", { name: "取消嵌套", exact: true }).click();
    assert.ok((await editorSnapshot(page)).blocks.some((item) => item.id === id));
    await select(); await toolbar.getByRole("button", { name: "添加链接", exact: true }).click();
    const link = page.getByPlaceholder("编辑链接地址");
    await link.fill("https://example.invalid/selected-text"); await link.press("Enter");
    const result = await documentBlock();
    assert.ok(result.content.some((run) => run.type === "link" && run.href === "https://example.invalid/selected-text" && run.content.some((s) => s.text === "XYZ")));
    return { alignment: ["center", "right", "left"], colors: ["red", "yellow"], type: ["heading 2", "paragraph"], nestedUnder: "ux-end", link: result.content };
  });
  await check("table-cell-tab-and-row-column-heading", async () => {
    const table = block(page, "ux-table");
    const cells = table.locator("td,th");
    await cells.first().click(); await page.keyboard.press("End"); await page.keyboard.insertText("格一");
    await page.keyboard.press("Tab"); await page.keyboard.insertText("格二");
    assert.match(await cells.nth(0).innerText(), /格一/u); assert.match(await cells.nth(1).innerText(), /格二/u);
    const menu = await showBlockMenu(page, "ux-table");
    const options = await menu.getByRole("menuitem").allTextContents();
    await menu.getByRole("menuitem", { name: "行标题", exact: true }).click();
    await showBlockMenu(page, "ux-table"); await page.getByRole("menuitem", { name: "列标题", exact: true }).click();
    const content = (await editorSnapshot(page)).blocks.find((b) => b.id === "ux-table").content;
    assert.equal(content.headerRows, 1); assert.equal(content.headerCols, 1);
    return { options, headers: [content.headerRows, content.headerCols], cells: await cells.allTextContents() };
  });
  await check("table-row-and-column-insert-and-remove", async () => {
    const table = block(page, "ux-table");
    const read = () => table.locator("tr").evaluateAll((rows) => rows.map((row) => [...row.cells].map((cell) => cell.textContent)));
    const before = await read();
    const apply = async (row, col, direction, label) => {
      const cell = table.locator("tr").nth(row).locator("td,th").nth(col);
      await cell.hover();
      const selector = direction === "row" ? '.bn-table-handle:not([style*="rotate"])' : '.bn-table-handle[style*="rotate"]';
      await page.locator(selector + ":visible").first().click();
      await page.getByRole("menuitem", { name: label, exact: true }).click();
      return read();
    };
    const addedRow = await apply(0, 0, "row", "下方添加行");
    assert.equal(addedRow.length, before.length + 1);
    const addedCol = await apply(0, 0, "column", "右侧添加列");
    assert.equal(addedCol[0].length, before[0].length + 1);
    await apply(1, 0, "row", "删除行");
    const restored = await apply(0, 1, "column", "删除列");
    assert.deepEqual(restored, before);
    return { before, addedRow, addedCol, restored };
  });
  await check("shared-source-edit-duplicate-detach-and-keyboard-dismiss", async () => {
    const sources = page.locator('.life-synced-source[data-source-id="shared-source"]:visible');
    const initial = await sources.count();
    const first = block(page, "sync-main").locator(".life-synced-source").first();
    await first.locator(".bn-inline-content").first().click(); await page.keyboard.press("End"); await page.keyboard.insertText("跨引用测试");
    await page.waitForFunction(() => [...document.querySelectorAll(".life-synced-source")].filter((el) => el.getBoundingClientRect().height > 0).every((el) => el.textContent.includes("跨引用测试")));
    const trigger = first.locator("summary");
    await trigger.press("Enter"); await first.getByRole("button", { name: "在下方添加引用" }).waitFor();
    await page.keyboard.press("Escape");
    assert.ok(await trigger.evaluate((el) => document.activeElement === el));
    await trigger.click(); await first.getByRole("button", { name: "在下方添加引用" }).click();
    assert.equal(await sources.count(), initial + 1);
    const added = sources.nth(1); await added.hover({ position: { x: 12, y: 12 } });
    const actions = added.locator("summary");
    const reach = await actions.evaluate((el) => { const r = el.getBoundingClientRect(); const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return { inside: el.contains(hit), hitBlock: hit?.closest(".bn-block-outer")?.dataset.id, targetBlock: el.closest(".bn-block-outer")?.dataset.id }; });
    if (reach.inside) await actions.click();
    else { finding("adjacent-synced-summary-pointer", reach); await actions.press("Enter"); }
    await added.getByRole("button", { name: "取消同步并保留副本" }).click();
    assert.equal(await sources.count(), initial);
    return { references: initial, localCopy: (await editorSnapshot(page)).blocks.some((b) => b.type === "paragraph" && JSON.stringify(b.content).includes("跨引用测试")) };
  });
  await check("checkbox-toggle-callout-and-equation", async () => {
    const box = block(page, "ux-checkListItem").locator('input[type=checkbox]');
    await box.check(); assert.ok(await box.isChecked()); await box.uncheck();
    const toggle = block(page, "ux-toggleListItem").locator(".bn-toggle-button").first();
    const hidden = await block(page, "ux-toggle-child").isVisible(); await toggle.click();
    assert.notEqual(await block(page, "ux-toggle-child").isVisible(), hidden); await toggle.click();
    await block(page, "ux-callout").getByRole("button", { name: "编辑 Callout 图标" }).click();
    const prompt = page.getByRole("dialog", { name: "Callout 图标" });
    await prompt.getByRole("textbox").fill("☆"); await prompt.getByRole("button", { name: "保存" }).click();
    assert.equal(await block(page, "ux-callout").getByRole("button").first().innerText(), "☆");
    await block(page, "ux-equation").locator(".life-equation-rendered").click(); await page.keyboard.press("End"); await page.keyboard.insertText("+1");
    await block(page, "ux-equation").locator(".katex").waitFor();
    return { checkbox: await box.isChecked(), toggleRestored: await block(page, "ux-toggle-child").isVisible() === hidden,
      equation: (await editorSnapshot(page)).blocks.find((b) => b.id === "ux-equation").content };
  });
  await check("tabs-switch-add-rename-and-column-keyboard-resize", async () => {
    const tabs = page.getByRole("tablist", { name: "内容标签页" }).first();
    const first = tabs.getByRole("tab").first(); await first.click(); await first.press("ArrowRight");
    assert.equal(await tabs.getByRole("tab").nth(1).getAttribute("aria-selected"), "true");
    await tabs.getByRole("button", { name: "添加标签页" }).click();
    await tabs.locator("summary").click(); await tabs.getByRole("button", { name: "重命名标签" }).click();
    const name = page.getByRole("textbox", { name: "标签名称" });
    await name.fill("交互标签"); await name.press("Enter"); await tabs.getByRole("tab", { name: "交互标签" }).waitFor();
    const separator = page.getByRole("separator", { name: "调整第 1、2 列栏宽" }).first();
    const before = await separator.getAttribute("aria-valuenow");
    await separator.press("ArrowRight"); await pause(100);
    const after = await separator.getAttribute("aria-valuenow");
    assert.notEqual(after, before);
    return { labels: await tabs.getByRole("tab").allTextContents(), widths: [before, after] };
  });
  await check("page-links-editorial-and-breadcrumb", async () => {
    const crumb = await block(page, "ux-breadcrumb").innerText();
    await block(page, "ux-pageLink").getByRole("button", { name: /Alpha 项目/u }).click();
    await page.waitForFunction(() => document.querySelector(".page-title-input")?.value === "Alpha 项目");
    await page.keyboard.press("Alt+ArrowLeft");
    await page.waitForFunction((title) => document.querySelector(".page-title-input")?.value === title, mainTitle);
    await block(page, "ux-editorialSection").getByRole("button", { name: /精选卡/ }).click();
    await page.waitForFunction(() => document.querySelector(".page-title-input")?.value === "Alpha 项目");
    await openPage(page, mainTitle);
    return { crumb, pageLink: "Alpha 项目", editorialCard: "Alpha 项目" };
  });
  await check("backlinks-from-target-to-source-and-find-in-page", async () => {
    await openPage(page, "Alpha 项目");
    const backlinks = page.locator(".backlinks-toggle");
    await backlinks.press("Enter");
    const list = page.getByRole("list", { name: "反向链接" });
    const snippets = await list.locator("li").allTextContents();
    await list.getByRole("button", { name: mainTitle, exact: true }).click();
    await page.waitForFunction((name) => document.querySelector(".page-title-input")?.value === name, mainTitle);
    await inline(page, "ux-format").click();
    await page.keyboard.press("Control+f");
    const bar = page.getByRole("search", { name: "页内查找" });
    const term = bar.getByRole("textbox", { name: "查找内容" });
    await term.fill("滚动定位用正文");
    await bar.getByText("1/12", { exact: true }).waitFor();
    await term.press("Enter"); await bar.getByText("2/12", { exact: true }).waitFor();
    await term.press("Shift+Enter"); await bar.getByText("1/12", { exact: true }).waitFor();
    await bar.getByRole("button", { name: "上一个匹配" }).click();
    await bar.getByText("12/12", { exact: true }).waitFor();
    await term.fill("没有这段文本"); await bar.getByText("0/0", { exact: true }).waitFor();
    await term.press("Escape"); await bar.waitFor({ state: "hidden" });
    const restored = await focusInfo(page);
    if (!await root(page).evaluate((el) => el === document.activeElement)) finding("find-close-focus", { restored });
    const title = page.locator(".page-title-input").first();
    await title.click(); await page.keyboard.press("Control+f");
    const closeButton = bar.getByRole("button", { name: "关闭查找" });
    await closeButton.press("Escape"); await bar.waitFor({ state: "hidden" });
    assert.ok(await title.evaluate((el) => el === document.activeElement));
    return { snippets, counts: ["1/12", "2/12", "1/12", "12/12", "0/0"], restored, titleControlEscape: await focusInfo(page) };
  });
  await check("workspace-tools-page-and-block-discussion-lifecycle", async () => {
    await openPage(page, mainTitle);
    const trigger = page.getByRole("button", { name: "工作区工具", exact: true });
    if (await trigger.getAttribute("aria-expanded") !== "true") await trigger.click();
    const panel = page.getByLabel("工作区工具面板", { exact: true });
    await panel.getByRole("button", { name: "讨论", exact: true }).click();
    const add = async (message) => {
      await panel.getByLabel("新评论", { exact: true }).fill(message);
      await panel.getByRole("button", { name: "添加讨论" }).click();
      return panel.locator(".workspace-thread").filter({ hasText: message });
    };
    const thread = await add("局部验收整页讨论");
    await thread.getByRole("textbox").fill("局部验收回复"); await thread.getByRole("button", { name: "回复", exact: true }).click();
    await thread.getByText("局部验收回复").waitFor();
    await thread.getByRole("button", { name: "解决" }).click(); await thread.getByText("已解决").waitFor();
    const unresolved = panel.getByLabel("仅显示未解决");
    await unresolved.check(); assert.equal(await thread.count(), 0);
    await unresolved.uncheck(); await thread.getByRole("button", { name: "重新打开" }).click(); await thread.getByText("进行中").waitFor();
    await panel.getByLabel("评论锚点类型").selectOption("block"); await panel.getByLabel("评论区块").selectOption("ux-format");
    const anchored = await add("局部验收区块讨论");
    assert.ok((await anchored.innerText()).includes("ux-format"));
    const labels = await panel.locator(".workspace-thread header").allTextContents();
    await shot("workspace-discussions"); await trigger.click();
    return { labels, resolvedFilteredThenReopened: true };
  });
  await check("workspace-tools-template-and-external-attachment-metadata", async () => {
    const trigger = page.getByRole("button", { name: "工作区工具", exact: true });
    if (await trigger.getAttribute("aria-expanded") !== "true") await trigger.click();
    const panel = page.getByLabel("工作区工具面板", { exact: true });
    await panel.getByRole("button", { name: "模板", exact: true }).click();
    await panel.getByLabel("页面模板名称").fill("工具创建的走查模板");
    await panel.getByRole("button", { name: "保存为模板" }).click();
    const select = panel.getByLabel("选择页面模板");
    await select.selectOption({ label: "工具创建的走查模板" });
    await panel.getByRole("button", { name: "从模板新建页面" }).click();
    await page.waitForFunction(() => document.querySelector(".life-editor")?.getAttribute("data-page-id") !== "editor-page");
    const created = await page.locator(".page-title-input").inputValue();
    await openPage(page, mainTitle);
    if (await trigger.getAttribute("aria-expanded") !== "true") await trigger.click();
    await panel.getByRole("button", { name: "模板", exact: true }).click();
    await select.selectOption({ label: "工具创建的走查模板" }); await panel.getByRole("button", { name: "删除", exact: true }).click();
    assert.ok(!(await select.locator("option").allTextContents()).includes("工具创建的走查模板"));
    await panel.getByRole("button", { name: "附件", exact: true }).click();
    await panel.getByLabel("附件名称").fill("走查资料说明"); await panel.getByLabel("附件地址").fill("https://example.invalid/only-metadata");
    await panel.getByRole("button", { name: "添加附件" }).click();
    const href = await panel.getByRole("link", { name: /走查资料说明/ }).getAttribute("href");
    assert.equal(href, "https://example.invalid/only-metadata"); await trigger.click();
    return { created, href };
  });
  await check("workspace-tools-record-template-defaults-and-body", async () => {
    await openPage(page, "Alpha 项目");
    const trigger = page.getByRole("button", { name: "工作区工具", exact: true });
    if (await trigger.getAttribute("aria-expanded") !== "true") await trigger.click();
    const tools = page.getByLabel("工作区工具面板", { exact: true });
    await tools.getByRole("button", { name: "模板", exact: true }).click();
    await tools.getByLabel("数据库模板名称").fill("走查记录模板");
    await tools.getByRole("button", { name: "保存数据库模板" }).click();
    const select = tools.getByLabel("选择数据库模板");
    await select.selectOption({ label: "走查记录模板" });
    const before = await page.evaluate(async () => (await window.lifeAtlas.workspace.load()).value.workspace.databaseItems.map((item) => item.id));
    await tools.getByRole("button", { name: "从模板新建记录" }).click();
    const item = await persisted(page, (ws) => {
      const created = ws.databaseItems.find((entry) => !before.includes(entry.id));
      return created && { id: created.id, amount: created.values?.amount, pageText: JSON.stringify(ws.pages.find((p) => p.id === created.pageId)?.content) };
    });
    assert.equal(item.amount, 120); assert.match(item.pageText, /Alpha 项目/u);
    await openPage(page, mainTitle);
    const carried = await trigger.getAttribute("aria-expanded");
    if (carried === "true") {
      finding("workspace-tools-carries-to-next-page", { carried, title: mainTitle });
      await trigger.click();
    }
    return item;
  });
  await check("workspace-tools-floating-dismiss", async () => {
    await openPage(page, mainTitle);
    const trigger = page.getByRole("button", { name: "工作区工具", exact: true });
    if (await trigger.getAttribute("aria-expanded") !== "true") await trigger.click();
    const panel = page.getByLabel("工作区工具面板", { exact: true });
    await panel.getByRole("button", { name: "讨论", exact: true }).focus();
    await page.keyboard.press("Escape");
    const afterEscape = await trigger.getAttribute("aria-expanded");
    const focusAfterEscape = await focusInfo(page);
    if (afterEscape !== "true") await trigger.click();
    await page.locator(".page-title-input").first().click();
    const afterOutside = await trigger.getAttribute("aria-expanded");
    if (afterEscape === "true" || afterOutside === "true" || focusAfterEscape.label !== "工作区工具") finding("workspace-tools-floating-dismiss", { afterEscape, afterOutside, focusAfterEscape });
    if (afterOutside === "true") await trigger.click();
    return { afterEscape, afterOutside };
  });
  await check("outline-jump-and-nested-headings", async () => {
    const toc = page.locator(".life-toc-block").first();
    const labels = await toc.getByRole("button").allTextContents();
    await inline(page, "ux-heading").click(); await page.keyboard.press("End"); await page.keyboard.insertText("已更新");
    await pause(240);
    const revised = await toc.getByRole("button").allTextContents();
    const liveText = await inline(page, "ux-heading").innerText();
    if (liveText.includes("已更新") && !revised.some((label) => label.includes("已更新"))) finding("outline-live-heading-title", { labels, revised, liveText });
    await toc.getByRole("button", { name: "末尾标题" }).click(); await pause(750);
    const observation = await block(page, "ux-bottom-heading").evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, viewport: innerHeight, visible: r.top >= 0 && r.bottom <= innerHeight };
    });
    const cursor = (await editorSnapshot(page)).cursor;
    const missingNested = !labels.includes("嵌套标题");
    if (!observation.visible || missingNested) { await shot("outline-after-jump"); finding("outline-jump", { labels, cursor, ...observation, missingNested }); }
    const hiddenHeading = block(page, "ux-tab-heading");
    const tabs = root(page).getByRole("tablist", { name: "内容标签页" }).first();
    await tabs.getByRole("tab").first().click();
    const hiddenBefore = !await hiddenHeading.isVisible();
    const entry = toc.getByRole("button", { name: "折叠标签中的标题" });
    if (await entry.count()) {
      await entry.press("Enter"); await pause(200);
      const exposed = await hiddenHeading.isVisible();
      const targetCursor = (await editorSnapshot(page)).cursor;
      if (!hiddenBefore || !exposed || targetCursor !== "ux-tab-heading") finding("outline-hidden-tab-and-toggle", { hiddenBefore, exposed, targetCursor });
    } else finding("outline-hidden-tab-and-toggle", { hiddenBefore, missingEntry: true });
    return { labels, revised, liveText, cursor, ...observation, missingNested, hiddenBefore };
  });
  for (const type of ["image", "audio", "video", "file", "pdf"]) await check("upload-" + type, async () => {
    const result = await upload(page, type);
    if (type === "video" && !(result.player.playedSeconds > 0)) finding("video-control-playback", result.player);
    return result;
  });
  await check("icon-dialog-keyboard-containment-return-and-save", async () => {
    const trigger = page.getByRole("button", { name: "更换图标", exact: true });
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "更换图标" });
    const sources = await checkSourceTabs(page, dialog, "图标来源");
    await dialog.getByRole("button", { name: "保存图标" }).focus();
    await page.keyboard.press("Tab");
    const inside = await dialog.evaluate((el) => el.contains(document.activeElement));
    const afterTab = await focusInfo(page);
    await page.keyboard.press("Escape"); await dialog.waitFor({ state: "hidden" });
    const afterEscape = await focusInfo(page);
    if (!inside || !await trigger.evaluate((el) => el === document.activeElement)) {
      await shot("icon-close-focus");
      finding("icon-dialog-focus", { inside, afterTab, afterEscape });
    }
    await trigger.click();
    await dialog.getByRole("tab", { name: /Icons/ }).click();
    await dialog.getByRole("button", { name: "随机图标" }).click();
    await dialog.getByRole("tab", { name: "Upload" }).click();
    const uploadText = await dialog.locator(".icon-upload-panel").innerText();
    if (uploadText.includes("浏览器原型")) finding("icon-upload-copy", { uploadText });
    await shot("icon-upload");
    await dialog.locator('input[type=file]').setInputFiles({ name: "icon.png", mimeType: "image/png", buffer: Buffer.from(PNG_1X1_BASE64, "base64") });
    await dialog.getByRole("button", { name: "保存图标" }).click();
    await trigger.locator("img").waitFor();
    const afterSave = await focusInfo(page);
    if (!await trigger.evaluate((el) => el === document.activeElement)) finding("icon-save-focus", { afterSave });
    await (await actions(page)).getByRole("menuitem", { name: "自定义页面" }).click();
    await dialog.waitFor(); await page.keyboard.press("Escape"); await dialog.waitFor({ state: "hidden" });
    const menuReturn = await focusInfo(page);
    if (menuReturn.label !== "页面操作") finding("customize-from-page-menu-focus", { menuReturn });
    return { sources, inside, afterTab, afterEscape, afterSave, menuReturn, uploaded: await trigger.locator("img").getAttribute("src") };
  });
  await check("cover-picker-star-save-and-keyboard-reposition", async () => {
    const cover = page.locator(".page-cover").first();
    await cover.hover();
    await cover.getByRole("button", { name: "更换封面" }).click();
    const dialog = page.getByRole("dialog", { name: "更换封面" });
    const sources = await checkSourceTabs(page, dialog, "封面来源");
    await dialog.getByRole("button", { name: "保存封面" }).focus(); await page.keyboard.press("Tab");
    const contained = await dialog.evaluate((el) => el.contains(document.activeElement));
    const afterTab = await focusInfo(page);
    await page.keyboard.press("Escape"); await dialog.waitFor({ state: "hidden" });
    const afterEscape = await focusInfo(page);
    const opener = cover.getByRole("button", { name: "更换封面" });
    if (!contained || !await opener.evaluate((el) => el === document.activeElement)) finding("cover-dialog-focus", { contained, afterTab, afterEscape });
    await cover.hover(); await opener.click();
    await dialog.getByRole("tab", { name: "Upload" }).click(); await dialog.getByRole("tab", { name: "Gallery" }).click();
    const card = dialog.locator(".cover-choice").first(); const choice = await card.innerText();
    await dialog.locator(".cover-favorite-button").first().click(); await card.click();
    await dialog.getByRole("button", { name: "保存封面" }).click(); await dialog.waitFor({ state: "hidden" });
    const afterSave = await focusInfo(page);
    if (!await opener.evaluate((el) => el === document.activeElement)) finding("cover-save-focus", { afterSave });
    await cover.hover();
    const position = cover.getByRole("button", { name: "调整位置" });
    await position.click(); const slider = cover.getByRole("slider", { name: "封面垂直位置" });
    await slider.press("Home"); await slider.press("Shift+ArrowUp"); await slider.press("Enter");
    assert.match(await cover.evaluate((el) => el.style.backgroundPosition), /10%$/u);
    assert.ok(await position.evaluate((el) => el === document.activeElement));
    return { choice, sources, afterSave, position: "10%", focus: await focusInfo(page) };
  });
  await check("page-more-presentation-lock-search-and-history", async () => {
    await openPage(page, mainTitle);
    await inline(page, "ux-format").click(); await page.keyboard.press("End"); await page.keyboard.insertText("历史走查");
    let menu = await actions(page);
    const controls = await menu.locator("button").allTextContents();
    const appearance = () => inline(page, "ux-format").evaluate((el) => {
      const css = getComputedStyle(el);
      return { fontSize: css.fontSize, fontFamily: css.fontFamily, canvasWidth: el.closest(".life-editor").getBoundingClientRect().width };
    });
    const readings = { before: await appearance() };
    await menu.getByPlaceholder("搜索操作…").fill("no match 999"); await menu.getByText("没有匹配的本地操作").waitFor();
    await page.keyboard.press("Escape"); const dismiss = await focusInfo(page);
    menu = await actions(page);
    for (const [name, className, expected] of [["小号文字", "is-small-text", true], ["全宽", "is-full-width", true],
      ["默认宽", "is-full-width", false], ["锁定页面", "is-locked", true], ["解锁页面", "is-locked", false]]) {
      await (await actions(page)).getByRole("menuitem", { name, exact: true }).click();
      await page.waitForFunction(([name, active]) => document.querySelector(".page-document")?.classList.contains(name) === active, [className, expected]);
      readings[name] = await appearance();
      if (name === "锁定页面") assert.equal(await root(page).getAttribute("contenteditable"), "false");
    }
    await (await actions(page)).getByRole("button", { name: /Serif/ }).click();
    await page.locator(".page-document.page-font-serif").waitFor();
    readings.serif = await appearance();
    if (readings["小号文字"].fontSize === readings.before.fontSize) finding("small-text-size", { before: readings.before, after: readings["小号文字"] });
    if (readings.serif.fontFamily === readings.before.fontFamily) finding("serif-font-family", { before: readings.before, after: readings.serif });
    await (await actions(page)).getByRole("menuitem", { name: "页面历史" }).click();
    const history = page.getByRole("dialog", { name: "页面历史" });
    await history.getByRole("option").first().waitFor();
    const options = await history.getByRole("option").allTextContents();
    const first = history.getByRole("option").first(); await first.focus(); await first.press("End"); await page.keyboard.press("Home");
    assert.equal(await first.getAttribute("aria-selected"), "true");
    await shot("history-version");
    await page.keyboard.press("Escape"); await history.waitFor({ state: "hidden" });
    const afterHistory = await focusInfo(page);
    if (afterHistory.label !== "页面操作") finding("history-close-focus", { afterHistory });
    return { controls, options, dismiss, afterHistory, readings };
  });
  await check("template-from-normal-page-uses-registered-blocks", async () => {
    const { id: current } = await createReviewTemplatePage(page, "全块走查模板");
    await surface("dark", 1000, 720); await shot("template-dark-narrow");
    const scan = await scanBlocks(page, "template-dark-narrow");
    assert.equal(scan.missingFromDocument.length, 0);
    return { current, ...scan };
  });
  await check("restore-an-earlier-version-of-an-isolated-page", async () => {
    await openPage(page, "版本恢复走查");
    await inline(page, "ux-history-text").click(); await page.keyboard.press("End"); await page.keyboard.insertText("新增变动");
    await persisted(page, (ws) => JSON.stringify(ws.pages.find((entry) => entry.id === "ux-history").content).includes("新增变动"));
    await (await actions(page)).getByRole("menuitem", { name: "页面历史" }).click();
    const dialog = page.getByRole("dialog", { name: "页面历史" });
    const earlier = dialog.getByRole("option").filter({ hasText: "编辑前" }).last();
    await earlier.click();
    const preview = dialog.locator(".bn-editor").first();
    assert.equal(await preview.getAttribute("contenteditable"), "false");
    const readOnlyText = await preview.innerText();
    assert.ok(readOnlyText.includes("待保留的原文"));
    await preview.getByText("待保留的原文", { exact: true }).click();
    await page.keyboard.type("locked-preview"); await page.keyboard.press("Backspace");
    assert.equal(await preview.innerText(), readOnlyText);
    await dialog.getByRole("button", { name: "恢复此版本" }).click();
    const confirm = page.getByRole("alertdialog", { name: "恢复页面版本" });
    await confirm.getByRole("button", { name: "恢复此版本" }).click();
    await dialog.waitFor({ state: "hidden" });
    await persisted(page, (ws) => {
      const text = JSON.stringify(ws.pages.find((entry) => entry.id === "ux-history").content);
      return text.includes("待保留的原文") && !text.includes("新增变动");
    });
    const restored = await root(page).innerText();
    await openPage(page, mainTitle);
    return { restored, readOnlyText };
  });
  await check("page-duplicate-favorite-move-export-and-trash-isolated-copy", async () => {
    await openPage(page, mainTitle);
    await (await actions(page)).getByRole("menuitem", { name: "创建副本" }).click();
    await page.waitForFunction((title) => document.querySelector(".page-title-input")?.value !== title, mainTitle);
    const copyId = await page.locator(".life-editor").first().getAttribute("data-page-id");
    assert.notEqual(copyId, "editor-page");
    const copyName = await page.locator(".page-title-input").inputValue();
    await (await actions(page)).getByRole("menuitem", { name: "添加到收藏" }).click();
    await (await actions(page)).getByRole("menuitem", { name: "从收藏移除" }).click();
    await (await actions(page)).getByRole("menuitem", { name: /移动到/ }).click();
    const move = page.locator(".page-move-modal");
    await move.waitFor();
    const semanticDialog = await page.getByRole("dialog", { name: "移动页面" }).count();
    if (!semanticDialog) finding("move-page-missing-dialog-role", { semanticDialog, title: await move.getByRole("heading").innerText() });
    await move.locator("select").selectOption("ux-move-target");
    await move.getByRole("button", { name: "移动页面" }).click();
    await (await actions(page)).getByRole("menuitem", { name: "导出页面" }).click();
    const exporting = page.getByRole("dialog", { name: "导出页面" });
    const formats = await exporting.locator("select option").allTextContents();
    await exporting.getByRole("button", { name: "关闭导出" }).click();
    await (await actions(page)).getByRole("menuitem", { name: "移到回收站" }).click();
    const confirmTrash = page.getByRole("alertdialog").filter({ has: page.getByRole("button", { name: "移到回收站", exact: true }) });
    await confirmTrash.getByRole("button", { name: "移到回收站", exact: true }).click();
    const trashed = await persisted(page, (ws) => ws.pages.find((p) => p.id === copyId)?.trashedAt);
    await openPage(page, mainTitle);
    return { copyName, copyId, formats, trashed };
  });
  await check("ordinary-dark-narrow-pointer-keyboard-and-scroll", async () => {
    await openPage(page, mainTitle); const dimensions = await surface("dark", 1000, 720);
    await inline(page, "ux-format").click(); await page.keyboard.press("Shift+F10");
    const search = page.getByRole("searchbox", { name: "搜索区块操作" }); await search.fill("转换"); await page.keyboard.press("Escape");
    await page.mouse.move(dimensions.width * 0.65, dimensions.height * 0.7);
    await page.mouse.wheel(0, 680); await pause(140);
    await shot("ordinary-dark-narrow");
    return { dimensions, focus: await focusInfo(page), blockTypes: (await editorSnapshot(page)).types };
  });
}
