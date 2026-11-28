import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { chromium } from "playwright";
import { coreParityWorkspace } from "../fixtures/core-parity-workspace.mjs";
import { upgradeWorkspace } from "../../src/persistence/migrations.js";
import { workspaceStorageKey } from "../../src/persistence/workspaceRepository.js";

const base = "http://127.0.0.1:5178";
const release = process.argv.includes("--release");
const theme = process.env.ATOMIC_TEST_THEME === "dark" ? "dark" : "light";
const evidence = path.resolve(".qa", "initial-atomic-selection", process.env.ATOMIC_TEST_RUN ||
  (release ? `release-${theme}-${Date.now()}` : "current"));
const template = JSON.parse(await fs.readFile("market/official/focus-study/template.json", "utf8"));
const photo = "data:image/png;base64," + (await fs.readFile("market/official/focus-study/assets/study.png")).toString("base64");
const fixture = coreParityWorkspace();
const original = fixture.pages.find((item) => item.id === "editor-page");
const pageOf = (id, title, content) => ({ ...original, id, title, content, parentPageId: null, folderId: "work" });
const text = (id) => ({ id, type: "paragraph", content: "继续编辑" });
const image = { id: "photo", type: "image", props: { url: photo, name: "study.png", caption: "日光下的笔记本" } };
const record = fixture.pages.find((item) => item.id === "alpha-page");
record.content = [{ ...image, id: "record-image" }, text("record-text")];
fixture.syncedSources[0].blocks = [{ ...image, id: "mirror-image" }, text("mirror-text")];
fixture.syncedSources.push({ ...fixture.syncedSources[0], id: "picture-source", blocks: [{ ...image, id: "isolated-photo" }] });
const table = { id: "grid", type: "table", content: { type: "tableContent", rows: [
  { cells: ["左上", "右上"] }, { cells: ["左下", "右下"] },
] } };
const sync = (id) => ({ id, type: "syncedBlock", props: { sourceId: "shared-source" } });
const database = { id: "db", type: "databaseView", props: { sourceId: "projects", viewId: "view-table" } };
const media = ["file", "audio", "video", "tableOfContents", "pageLink"].flatMap((type) => [
  { id: "example-" + type, type, props: type === "pageLink" ? { pageId: "other", label: "链接" } : {} }, text("after-" + type),
]);
media[0].props = { name: "说明.txt", url: "data:text/plain,selection-fixture" };
media[2].props = { name: "fixture.wav", url: "data:audio/wav;base64," + (await fs.readFile("market/official/pomodoro/assets/mechanical-tick.wav")).toString("base64") };
// Two black 32 × 24 VP8 frames, encoded without user media or metadata.
media[4].props = { name: "fixture.webm", url: "data:video/webm;base64,GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwH/////////EU2bdKtNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIG7TbuMU6uEElTDZ1OsggEI7AEAAAAAAABoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmlSrXsYMPQkBNgIRMYXZmV0GETGF2ZhZUrmvIrgEAAAAAAAA/14EBc8WIAAAAAAAAAAGcgQAitZyDdW5kiIEAhoVWX1ZQOIOBASPjg4QL68IA4JCwgSC6gRiagQJVsIRVuYEBElTDZ6xzc6ljwItjxYgAAAAAAAAAAWfImEWjh0VOQ09ERVJEh4tMYXZjIGxpYnZweB9DtnXA54EAo6SBAACAMAIAnQEqIAAYAABHCIWFiIWEiAICAAeQ88nA/v+rUICjlYEAyACxAQAFEKwAGAAYWC/0AAhwAA==" };
fixture.pages = [pageOf("other", "切换用页面", [text("other-text")]), pageOf("official-study", template.title,
  template.blocks.map((block, index) => index ? { ...block, id: "study-" + index } : image)),
  pageOf("two", "图片与正文", [image, text("tail")]), pageOf("only", "只有图片", [image]),
  pageOf("rule", "分割线与正文", [{ id: "rule-block", type: "divider" }, text("rule-tail")]),
  pageOf("matrix", "媒体区块", media), pageOf("grid-page", "单元格选区", [table, text("grid-tail")]),
  pageOf("bridge", "跨媒体选择", [text("before-range"), text("range-from"), { ...image, id: "range-picture" },
    { ...media[0], id: "range-file" }, text("range-to"), text("after-range")]),
  pageOf("mirror", "同步区块选区", [sync("mirror-a"), sync("mirror-b"), { id: "solo-sync", type: "syncedBlock", props: { sourceId: "picture-source" } }, text("mirror-tail")]),
  pageOf("columns", "分栏选区", [{ id: "columns-parent", type: "columnList", props: { columns: 2 }, children: [
    { type: "column", id: "col-a", props: { width: 50, index: 0, count: 2 }, children: [{ ...image, id: "column-image" }, text("column-text")] },
    { type: "column", id: "col-b", props: { width: 50, index: 1, count: 2 }, children: [text("col-b-text")] },
  ] }]), pageOf("database-page", "数据库选区", [database, text("db-tail")]), record];
fixture.ui.selectedPageId = "other";
fixture.ui.expandedFolderIds = ["work"];
fixture.ui.preferences = { theme: "system", style: "mobai" };
await fs.mkdir(evidence, { recursive: true });
const source = process.argv.includes("--source");
assert.ok(!release || (!source && !process.env.ATOMIC_EXTERNAL_SERVER), "a packaged check must launch its own release process");
let server, browser, nativeProcess, releaseHelpers, nativeEvidence, tab;
const report = [];
const writeNativeEvidence = () => fs.writeFile(path.join(evidence, "native.json"), JSON.stringify(nativeEvidence, null, 2));
async function fileHash(file) {
  const hash = createHash("sha256");
  for await (const bytes of createReadStream(file)) hash.update(bytes);
  return hash.digest("hex");
}
async function openReleaseWindow(exe, profile) {
  nativeProcess = releaseHelpers.startApp(exe, profile, { args: ["--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0"] });
  const endpoint = await releaseHelpers.waitFor(() => nativeProcess.releaseOutput.stderr.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[\w-]+)/u)?.[1],
    { timeoutMs: 30000, message: "release did not advertise its local CDP endpoint" });
  browser = await chromium.connectOverCDP(endpoint);
  const page = await releaseHelpers.waitFor(() => browser.contexts()[0].pages().find((candidate) => candidate.url() === "app://bundle/index.html"),
    { timeoutMs: 30000, message: "the packaged workspace window did not open" });
  tab = page;
  await page.locator("html[data-la-ready]").waitFor();
  const info = await page.evaluate(() => window.lifeAtlas.app.getInfo());
  assert.equal(info.ok, true); assert.equal(info.value.isPackaged, true); assert.equal(info.value.flavor, "release");
  assert.equal(path.resolve(info.value.dataRoot), profile);
  const owner = await nativeProcess.releaseOwnershipReady;
  assert.ok(owner, "release PID identity was not verified"); assert.equal(path.resolve(owner.executablePath), exe);
  assert.equal(path.resolve(owner.runtimeDir), path.join(profile, "runtime"));
  return { page, owner, info };
}
async function closeReleaseWindow() {
  if (tab && !tab.isClosed()) await tab.evaluate(() => { setTimeout(() => window.close(), 0); }).catch(() => {});
  await releaseHelpers.waitFor(() => nativeProcess.exitCode !== null, { timeoutMs: 8000, intervalMs: 100 }).catch(() => {});
  await releaseHelpers.closeAppGracefully(nativeProcess);
  assert.equal(nativeProcess.exitCode, 0, "release process did not exit cleanly");
}
async function startRelease() {
  const { createIsolatedDirectory, REPO_ROOT, seedWorkspaceDatabase } = await import("../desktop/helpers.mjs");
  releaseHelpers = await import("../release/helpers.mjs");
  const profile = createIsolatedDirectory("release-atomic-selection-" + theme);
  const exe = path.join(REPO_ROOT, "release", "release", "win-unpacked", "Life Atlas.exe");
  const attachments = [image, media[0], media[2], media[4]].map(({ props: { name, url } }) => {
    const [format, data] = url.split(",");
    const mime = format.slice(5).split(";")[0];
    const bytes = format.endsWith(";base64") ? Buffer.from(data, "base64") : Buffer.from(decodeURIComponent(data));
    return { name, url, mime, bytes, hash: createHash("sha256").update(bytes).digest("hex") };
  });
  const urls = new Map(attachments.map(({ url, hash }) => [url, "life-asset://" + hash]));
  const data = upgradeWorkspace(JSON.parse(JSON.stringify(fixture, (_, value) => urls.get(value) || value)));
  data.ui.preferences = { ...data.ui.preferences, theme };
  // Seed a closed workspace so the startup snapshot cannot overwrite its
  // preferences or selection with those from a concurrently open renderer.
  await seedWorkspaceDatabase(profile, data);
  const { page, owner, info } = await openReleaseWindow(exe, profile);
  nativeEvidence = { exe, profile, processId: owner.mainPid, processCreatedAt: owner.mainCreatedAt,
    version: info.value.appVersion, flavor: info.value.flavor, electron: info.value.versions.electron, url: page.url(), theme,
    asarSha256: await fileHash(path.join(path.dirname(exe), "resources", "app.asar")),
    exeSha256: await fileHash(exe), attachments: [], result: "running" };
  await writeNativeEvidence();
  if (process.env.ATOMIC_RELEASE_ASAR_SHA256) assert.equal(nativeEvidence.asarSha256, process.env.ATOMIC_RELEASE_ASAR_SHA256.toLowerCase());
  await page.bringToFront();
  nativeEvidence.window = await page.evaluate(() => ({ innerWidth, innerHeight, outerWidth, outerHeight, devicePixelRatio,
    screenWidth: screen.availWidth, screenHeight: screen.availHeight }));
  for (const { name, mime, bytes, hash } of attachments) {
    const stored = await page.evaluate(({ name, mime, data }) => window.lifeAtlas.assets.put({
      name, mime, bytes: Uint8Array.from(atob(data), (value) => value.charCodeAt(0)).buffer,
    }), { name, mime, data: bytes.toString("base64") });
    assert.equal(stored.ok, true, stored.error?.message);
    assert.equal(stored.value.url, "life-asset://" + hash);
    assert.equal(await fileHash(path.join(profile, "assets", hash.slice(0, 2), hash)), hash);
    nativeEvidence.attachments.push({ name, mime, bytes: bytes.length, sha256: hash });
  }
  await page.reload();
  await page.locator("html[data-la-ready]").waitFor();
  const result = await page.evaluate(() => window.lifeAtlas.workspace.load());
  assert.ok(result.ok, result.error?.message);
  const reopened = result.value.workspace;
  assert.equal(reopened.ui.preferences.theme, theme);
  assert.ok(reopened.pages.find((p) => p.id === "only")?.content[0].props.url.startsWith("life-asset://"));
  nativeEvidence.loadedFromSqlite = { pages: reopened.pages.length, syncedSources: reopened.syncedSources.length, savedAt: reopened.savedAt };
  await writeNativeEvidence();
  return page;
}
try {
  if (release) tab = await startRelease();
  else {
    if (!process.env.ATOMIC_EXTERNAL_SERVER) {
      const { createServer, preview } = await import("vite");
      const config = { configLoader: "native", logLevel: "error", [source ? "server" : "preview"]: { host: "127.0.0.1", port: 5178, strictPort: true } };
      server = source ? await createServer(config) : await preview(config);
      if (source) await server.listen();
    }
    browser = await chromium.launch({ channel: "msedge", headless: true });
    const ctx = await browser.newContext({ viewport: { width: 1140, height: 900 }, colorScheme: theme });
    await ctx.addInitScript(({ key, data }) => { if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(data)); },
      { key: workspaceStorageKey, data: upgradeWorkspace(fixture) });
    tab = await ctx.newPage();
    await tab.goto(base);
  }
  tab.setDefaultTimeout(12000);
  const editor = tab.locator(".life-editor .bn-editor").first();
  await tab.waitForFunction((expected) => document.documentElement.dataset.theme === expected, theme);
  async function open(id, title) {
    await tab.getByRole("treeitem", { name: title, exact: true }).getByText(title, { exact: true }).first().click();
    await tab.locator('.life-editor[data-page-id="' + id + '"] .bn-editor').first().waitFor();
    await tab.mouse.move(12, 12);
    await tab.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  }
  async function inspect(label, pane = editor, details = {}) {
    const result = await pane.evaluate((root) => {
      const api = root.pmViewDesc.node.type.schema.cached.blockNoteEditor;
      const selection = api.prosemirrorState.selection;
      const owned = (s) => [...root.querySelectorAll(s)].filter((el) => el.closest(".bn-editor") === root);
      const selected = owned(".ProseMirror-selectednode").map((el) => ({
        className: el.className, block: el.closest("[data-id]")?.dataset.id, node: el.dataset.contentType || null,
        tint: [el, ...el.children, ...el.querySelectorAll(".bn-block-content > *")].map((child) => getComputedStyle(child, "::after").backgroundColor),
        shadows: [el, ...el.querySelectorAll(".bn-block-content > *")].map((child) => getComputedStyle(child, "::after").boxShadow),
        outline: getComputedStyle(el).outlineStyle,
      }));
      const active = document.activeElement;
      const activeStyle = active && getComputedStyle(active);
      const handles = owned(".bn-resize-handle").filter((el) => el.checkVisibility({ opacityProperty: true, visibilityProperty: true })).length;
      const markers = owned(".life-selected-atom,.life-selected-range").map((el) => {
        const css = getComputedStyle(el, "::after");
        return { block: el.dataset.id, shown: css.content !== "none" && css.content !== "normal",
          color: css.backgroundColor, width: css.width, inset: css.insetInlineStart };
      });
      return { pm: selection.toJSON(), nodeType: selection.node?.type.name || null, active: document.activeElement?.className,
        focused: api.prosemirrorView.hasFocus(), wrapper: root.closest(".life-editor").className, selected, handles, markers,
        focusStyle: { tag: active?.tagName, keyboard: active?.matches(":focus-visible"), outline: activeStyle?.outline,
          shadow: activeStyle?.boxShadow, shell: active === root },
        rootEditable: root.isContentEditable, rootOutline: getComputedStyle(root).outlineStyle,
        rootShadow: getComputedStyle(root).boxShadow, rootTabIndex: root.tabIndex,
        focusableShells: owned('.bn-block-outer[tabindex],.bn-block-content[tabindex],.bn-react-node-view-renderer[tabindex],.bn-visual-media-wrapper[tabindex],.bn-block[tabindex]').map((el) => el.className),
        nativeText: getSelection()?.toString(), textTint: getComputedStyle(root.querySelector(".bn-inline-content") || root, "::selection").backgroundColor,
        cells: owned(".selectedCell").map((cell) => getComputedStyle(cell, "::after").backgroundColor),
        ids: api.document.map(({ id }) => id) };
    });
    report.push({ label, ...result, ...details });
    await fs.writeFile(path.join(evidence, "selection.json"), JSON.stringify(report, null, 2));
    return result;
  }
  async function selectPreviousAtom(pane, blockId, enteredByArrowDown = false) {
    const tail = pane.locator('.bn-block-outer[data-id="' + blockId + '"] .bn-inline-content').first();
    const element = await tail.elementHandle();
    const keyboardStart = { enteredBy: enteredByArrowDown ? "ArrowDown" : "glyph-click", blockId };
    const waitForCaret = async (boundary) => {
      const settled = await tab.waitForFunction(({ text, blockId, boundary }) => {
        const root = text.closest(".bn-editor");
        const api = root?.pmViewDesc?.node.type.schema.cached.blockNoteEditor;
        const native = document.getSelection(), pm = api?.prosemirrorState.selection;
        if (!api?.prosemirrorView.hasFocus() || !native?.isCollapsed || !pm?.empty || !text.contains(native.focusNode)
          || api.getTextCursorPosition().block.id !== blockId || !pm.$head.parent.isTextblock) return false;
        const range = document.createRange();
        range.selectNodeContents(text);
        range.setEnd(native.focusNode, native.focusOffset);
        const nativeOffset = range.toString().length, pmOffset = pm.$head.parentOffset;
        if (nativeOffset !== pmOffset || (boundary === "start" && pmOffset !== 0) || (boundary === "inside" && pmOffset <= 0)) return false;
        return { id: blockId, nativeOffset, pmOffset, pmPosition: pm.head };
      }, { text: element, blockId, boundary }, { timeout: 3000 });
      try { return await settled.jsonValue(); }
      finally { await settled.dispose(); }
    };
    try {
      if (!enteredByArrowDown) {
        await tail.scrollIntoViewIfNeeded();
        // The inline box is the full width of the editor. Aim inside a glyph.
        keyboardStart.glyph = await tail.evaluate((el) => {
          const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
          let node, last;
          while ((node = walker.nextNode())) if (node.length) last = node;
          const range = document.createRange();
          range.setStart(last, last.length - 1);
          range.setEnd(last, last.length);
          const rect = range.getBoundingClientRect(), outer = el.getBoundingClientRect();
          return { x: rect.left - outer.left + rect.width * 0.75, y: rect.top - outer.top + rect.height / 2 };
        });
        await tail.click({ position: keyboardStart.glyph });
      }
      keyboardStart.afterEntry = await waitForCaret(enteredByArrowDown ? "any" : "inside");
      await tab.keyboard.press("Home");
      keyboardStart.beforeArrow = await waitForCaret("start");
      await tab.keyboard.press("ArrowLeft");
      return keyboardStart;
    } catch (error) {
      await inspect("keyboard-start-failed-" + blockId, pane, { keyboardStart });
      throw error;
    } finally {
      await element.dispose();
    }
  }
  const checks = [];
  for (const [id, title] of [["official-study", template.title], ["two", "图片与正文"], ["only", "只有图片"], ["rule", "分割线与正文"], ["official-study", template.title]]) {
    await open(id, title);
    if (id !== "rule") await editor.locator("img").first().evaluate((img) => img.decode());
    const before = await inspect(id);
    await tab.screenshot({ path: path.join(evidence, id + ".png"), animations: "disabled" });
    if (id === "two") {
      await editor.locator("img").hover();
      await inspect("hover");
      await tab.screenshot({ path: path.join(evidence, "hover.png"), animations: "disabled" });
    }
    checks.push([id, before]);
  }
  const picture = editor.locator("img").first();
  await picture.click();
  const activeMouse = await inspect("active-image-click");
  assert.equal(activeMouse.nodeType, "image");
  await tab.screenshot({ path: path.join(evidence, "clicked-image.png"), animations: "disabled" });
  for (const [id, state] of checks) {
    assert.equal(state.handles, 0, id + " displays resize handles before a selection");
    assert.equal(state.selected.length, 0, id + " displays a selected atomic block on open");
    assert.notEqual(state.pm.type, "node", id + " starts with a node selection");
    assert.equal(state.focused, false, id + " stole sidebar focus");
  }
  assert.equal(activeMouse.selected.some((item) => item.shadows.some((shadow) => shadow !== "none")
    || item.tint.some((tint) => tint !== "rgba(0, 0, 0, 0)") || item.outline !== "none"), false,
  "a mouse-selected image has a block-wide outline, shadow or coloured overlay");
  assert.equal(activeMouse.markers.some((marker) => marker.shown), false);
  await tab.keyboard.press("ArrowDown");
  await inspect("active-arrow-down");
  const imageStart = await selectPreviousAtom(editor, "study-1", true);
  const activeKey = await inspect("active-arrow-left", editor, { keyboardStart: imageStart });
  assert.equal(activeKey.nodeType, "image");
  const neutralGutter = (marker) => {
    const rgb = marker.color.match(/[\d.]+/g)?.map(Number).slice(0, 3);
    return marker.shown && Number.parseFloat(marker.width) <= 3 && Number.parseFloat(marker.inset) < 0 &&
      rgb?.length === 3 && Math.max(...rgb) - Math.min(...rgb) < 25;
  };
  assert.equal(activeKey.markers.filter(neutralGutter).length, 1);
  await tab.mouse.move(12, 12);
  await tab.screenshot({ path: path.join(evidence, "keyboard-image.png"), animations: "disabled" });
  const copied = await editor.evaluate((root) => {
    const data = new DataTransfer();
    root.dispatchEvent(new ClipboardEvent("copy", { bubbles: true, cancelable: true, clipboardData: data }));
    return { html: data.getData("text/html"), text: data.getData("text/plain") };
  });
  assert.ok(copied.html.includes("<img"), "keyboard-selected image is present in the editor's clipboard HTML");
  await editor.locator('[data-id="study-1"] .bn-inline-content').click();
  await tab.keyboard.press("Home");
  await tab.keyboard.press("Shift+End");
  const ordinary = await inspect("native-text-range");
  assert.equal(ordinary.nativeText, "今天的目标");
  assert.equal(ordinary.markers.length, 0);
  assert.notEqual(ordinary.textTint, "rgba(0, 0, 0, 0)");
  await tab.screenshot({ path: path.join(evidence, "native-text-range.png"), animations: "disabled" });
  await tab.keyboard.press("Shift+ArrowDown");
  const cross = await inspect("cross-block-text-range");
  assert.ok(cross.nativeText.includes("今天的目标") && cross.nativeText.trim().length > ordinary.nativeText.length);
  assert.ok(cross.markers.filter(neutralGutter).length >= 2);
  await tab.screenshot({ path: path.join(evidence, "cross-block-range.png"), animations: "disabled" });
  await picture.hover();
  const edge = await editor.locator('.bn-resize-handle').last().boundingBox();
  const oldWidth = (await picture.boundingBox()).width;
  await tab.mouse.move(edge.x + edge.width / 2, edge.y + edge.height / 2);
  await tab.mouse.down();
  await tab.mouse.move(edge.x - 104, edge.y + edge.height / 2, { steps: 8 });
  await tab.mouse.up();
  await tab.waitForFunction((oldWidth) => {
    const api = document.querySelector(".life-editor .bn-editor")?.pmViewDesc?.node.type.schema.cached.blockNoteEditor;
    const w = api?.getBlock("photo")?.props.previewWidth;
    return w > 64 && w < oldWidth - 50;
  }, oldWidth);
  await open("two", "图片与正文");
  await editor.locator('[data-id="tail"] .bn-inline-content').click();
  await tab.keyboard.insertText("可写");
  await tab.waitForFunction(() => document.querySelector('[data-id="tail"] .bn-inline-content')?.textContent.includes("可写"));
  assert.equal(await editor.locator('[data-id="photo"] img').count(), 1, "editing the paragraph retained the image");
  await editor.locator("img").hover();
  await tab.locator('.life-block-actions[data-block-id="photo"] .life-block-handle').waitFor({ state: "visible" });
  const handle = tab.locator('.life-block-actions[data-block-id="photo"] .life-block-handle');
  const target = editor.locator('.bn-block-outer[data-id="tail"]');
  const targetBox = await target.boundingBox();
  await handle.dragTo(target, { targetPosition: { x: targetBox.width / 2, y: targetBox.height - 2 } });
  await tab.waitForFunction(() => {
    const api = document.querySelector(".life-editor .bn-editor")?.pmViewDesc?.node.type.schema.cached.blockNoteEditor;
    return api?.document[0]?.id === "tail" && api.document[1]?.id === "photo";
  });
  await inspect("after-image-moved");
  await tab.screenshot({ path: path.join(evidence, "reordered-image.png"), animations: "disabled" });
  await open("only", "只有图片");
  const only = await inspect("atomic-only-unchanged");
  assert.deepEqual(only.ids, ["photo"]);
  assert.deepEqual(only.pm, { type: "gapcursor", pos: 2 });
  await editor.locator("img").hover();
  await tab.getByRole("treeitem", { name: template.title, exact: true }).locator(".sidebar-page-main").press("Enter");
  await tab.locator('.life-editor[data-page-id="official-study"] .bn-editor').waitFor();
  await tab.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  const underPointer = await inspect("keyboard-open-with-stationary-pointer");
  assert.equal(underPointer.selected.length, 0);
  assert.equal(underPointer.handles, 0, "opening a page under the stationary pointer displays resize handles");
  await editor.locator("img").click();
  await tab.keyboard.press("Delete");
  await editor.locator('[data-id="photo"] img').waitFor({ state: "detached" });
  await tab.keyboard.press("Control+z");
  await editor.locator('[data-id="photo"] img').waitFor();
  const noFrame = (state) => state.selected.every((s) => s.outline === "none" &&
    s.tint.every((c) => c === "rgba(0, 0, 0, 0)") && s.shadows.every((shadow) => shadow === "none"));
  const imagePixels = async (selector) => {
    const bytes = await selector.screenshot({ animations: "disabled" });
    return tab.evaluate(async (raw) => {
      const img = await createImageBitmap(new Blob([Uint8Array.from(raw)], { type: "image/png" }));
      const cv = document.createElement("canvas"); cv.width = img.width; cv.height = img.height;
      const ctx = cv.getContext("2d"); ctx.drawImage(img, 0, 0); const samples = [];
      for (const x of [.15, .33, .56, .78]) for (const y of [.18, .51, .77]) {
        samples.push(...ctx.getImageData(Math.round(cv.width*x), Math.round(cv.height*y), 1, 1).data);
      }
      img.close(); return samples;
    }, [...bytes]);
  };
  await open("bridge", "跨媒体选择");
  const crossPicture = editor.locator('[data-id="range-picture"] img');
  await crossPicture.evaluate((img) => img.decode());
  const originalPixels = await imagePixels(crossPicture);
  const startRange = editor.locator('[data-id="range-from"] .bn-inline-content');
  const endRange = editor.locator('[data-id="range-to"] .bn-inline-content');
  await startRange.click(); await tab.keyboard.press("Home");
  await endRange.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }));
  await endRange.click({ modifiers: ["Shift"], position: { x: 25, y: 8 } });
  await tab.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  const crossed = await inspect("text-across-image-and-file");
  assert.deepEqual(crossed.markers.filter(neutralGutter).map((m) => m.block), ["range-from", "range-picture", "range-file", "range-to"]);
  assert.ok(crossed.nativeText.includes("继续编辑"));
  await tab.screenshot({ path: path.join(evidence, "text-across-media.png"), animations: "disabled" });
  assert.deepEqual(await imagePixels(crossPicture), originalPixels, "Chromium tinted the image inside a native text range");
  await endRange.evaluate((el) => {
    const editor = el.closest(".bn-editor").pmViewDesc.node.type.schema.cached.blockNoteEditor;
    const view = editor.prosemirrorView, selection = view.state.selection;
    const end = view.posAtDOM(el.firstChild, 0);
    view.dispatch(view.state.tr.setSelection(selection.constructor.create(view.state.doc, selection.anchor, end)));
  });
  const boundary = await inspect("range-ends-before-text");
  assert.deepEqual(boundary.markers.map((m) => m.block), ["range-from", "range-picture", "range-file"]);
  await open("matrix", "媒体区块");
  await editor.locator("audio").first().waitFor();
  await editor.locator("video").first().evaluate((video) => {
    if (video.readyState >= 1) return;
    return new Promise((ok, fail) => { video.addEventListener("loadedmetadata", ok, { once: true }); video.addEventListener("error", fail, { once: true }); });
  });
  for (const type of ["file", "audio", "video", "tableOfContents", "pageLink"]) {
    const keyboardStart = await selectPreviousAtom(editor, "after-" + type);
    const selected = await inspect("key-selected-" + type, editor, { keyboardStart });
    assert.equal(selected.nodeType, type);
    assert.ok(noFrame(selected) && selected.markers.filter(neutralGutter).length === 1);
    await tab.getByRole("textbox", { name: "页面标题", exact: true }).focus();
    assert.ok(noFrame(await inspect("blurred-" + type)));
    await editor.evaluate((el) => el.pmViewDesc.node.type.schema.cached.blockNoteEditor.prosemirrorView.focus());
    const returned = await inspect("refocused-" + type);
    assert.equal(returned.pm.type, "node"); assert.equal(returned.nodeType, type);
    assert.ok(noFrame(returned)); assert.equal(returned.rootOutline, "none"); assert.equal(returned.rootShadow, "none");
  }
  for (const kind of ["audio", "video"]) {
    await editor.locator(kind).first().focus();
    const focused = await inspect("media-control-focus-" + kind);
    assert.equal(focused.focusStyle.tag, kind.toUpperCase());
    assert.ok(focused.focusStyle.outline.includes(" none ") && focused.focusStyle.shadow === "none");
  }
  await open("columns", "分栏选区");
  await editor.locator('[data-id="column-image"] img').click();
  assert.ok(noFrame(await inspect("image-in-column")));
  await open("database-page", "数据库选区");
  const databaseUI = editor.locator("section.database-view");
  await databaseUI.locator('tr[data-item-id="alpha"] td[data-property-id="title"]').waitFor();
  const dbStart = await selectPreviousAtom(editor, "db-tail");
  const dbSelected = await inspect("selected-database-block", editor, { keyboardStart: dbStart });
  assert.equal(dbSelected.nodeType, "databaseView"); assert.ok(noFrame(dbSelected));
  const recordCell = databaseUI.locator('tr[data-item-id="alpha"] td[data-property-id="title"]');
  await recordCell.focus();
  const focusCell = await inspect("database-property-cell-focus");
  assert.equal(focusCell.focusStyle.shadow, "none");
  await recordCell.locator(".db-title-control").hover();
  await recordCell.locator(".db-title-open").click();
  const peek = tab.getByRole("dialog", { name: "记录预览" });
  const peekEditor = peek.locator(".bn-editor").first();
  await peekEditor.locator("img").waitFor();
  assert.notEqual((await inspect("record-preview-open", peekEditor)).pm.type, "node");
  await peek.getByRole("textbox", { name: "记录标题" }).press("Enter");
  assert.equal((await inspect("record-title-enter", peekEditor)).focused, true);
  await peekEditor.locator("img").click(); assert.ok(noFrame(await inspect("record-preview-click", peekEditor)));
  await tab.screenshot({ path: path.join(evidence, "record-preview.png"), animations: "disabled" });
  await peek.getByRole("button", { name: "关闭预览" }).click();
  const afterRecord = await inspect("record-preview-dismiss"); assert.equal(afterRecord.nodeType, "databaseView"); assert.ok(noFrame(afterRecord));
  await open("official-study", template.title);
  await editor.locator('[data-id="study-1"] .bn-inline-content').click(); await tab.keyboard.press("End"); await tab.keyboard.insertText("历史");
  await tab.getByRole("button", { name: "页面操作", exact: true }).click();
  await tab.getByRole("menuitem", { name: "页面历史", exact: true }).click();
  const history = tab.getByRole("dialog", { name: "页面历史" });
  const historical = history.locator(".hist-page .bn-editor");
  await historical.locator("img").first().waitFor();
  const historicalState = await inspect("history-read-only", historical);
  assert.equal(historicalState.rootEditable, false); assert.notEqual(historicalState.pm.type, "node");
  assert.equal(historicalState.rootOutline, "none"); assert.equal(historicalState.rootShadow, "none");
  await historical.locator("img").first().click(); assert.ok(noFrame(await inspect("history-image-click", historical)));
  await tab.screenshot({ path: path.join(evidence, "history-preview.png"), animations: "disabled" });
  await tab.keyboard.press("Tab");
  const closeHistory = history.getByRole("button", { name: "关闭", exact: true });
  await closeHistory.focus();
  const historyControl = await inspect("history-keyboard-control", historical);
  assert.equal(historyControl.focusStyle.tag, "BUTTON");
  assert.ok(!historyControl.focusStyle.outline.includes(" none ") || historyControl.focusStyle.shadow !== "none");
  await closeHistory.click();
  assert.ok(noFrame(await inspect("history-dismiss")));
  await open("mirror", "同步区块选区");
  const mirrors = tab.locator(".life-synced-editor .bn-editor");
  await mirrors.nth(1).locator("img").waitFor();
  const initialMirror = await inspect("nested-synced-source", mirrors.first());
  const onlyMirror = await inspect("atomic-only-synced-source", mirrors.nth(2));
  const mirrorStart = await selectPreviousAtom(mirrors.first(), "mirror-text");
  const nestedKey = await inspect("keyboard-in-synced-editor", mirrors.first(), { keyboardStart: mirrorStart });
  assert.equal(nestedKey.nodeType, "image");
  assert.ok(noFrame(nestedKey) && nestedKey.markers.filter(neutralGutter).length === 1);
  await mirrors.first().locator('[data-id="mirror-text"] .bn-inline-content').click();
  await tab.keyboard.press("Shift+F10");
  await tab.getByRole("menuitem", { name: "删除", exact: true }).click();
  await mirrors.nth(1).locator('[data-id="mirror-text"]').waitFor({ state: "detached" });
  const mirrorRefresh = await inspect("synced-partner-replaced-document", mirrors.nth(1));
  assert.deepEqual(mirrorRefresh.ids, ["mirror-image"]); assert.equal(mirrorRefresh.pm.type, "gapcursor");
  await tab.screenshot({ path: path.join(evidence, "synced-source-refresh.png"), animations: "disabled" });
  await open("grid-page", "单元格选区");
  const cells = editor.locator("td");
  await cells.first().click();
  await cells.last().click({ modifiers: ["Shift"] });
  const selectedCells = await inspect("table-cell-range");
  await tab.screenshot({ path: path.join(evidence, "table-cell-range.png"), animations: "disabled" });
  assert.equal(selectedCells.pm.type, "cell");
  assert.equal(selectedCells.cells.length, 4);
  assert.ok(selectedCells.cells.every((color) => {
    const [r, g, b] = (color.match(/[\d.]+/g) || []).map(Number);
    return Math.max(r, g, b) - Math.min(r, g, b) < 22;
  }), "multi-cell selection paints a blue block");
  assert.notEqual(initialMirror.pm.type, "node", "the nested synced editor opens with a selected node");
  assert.notEqual(onlyMirror.pm.type, "node", "the atomic-only synced editor opens with a selected node");
  if (release) {
    const persisted = await releaseHelpers.waitFor(() => tab.evaluate(async (previousWidth) => {
      const saved = await window.lifeAtlas.workspace.load();
      if (!saved.ok) return false;
      const work = saved.value.workspace;
      const blocks = work.pages.find((p) => p.id === "two")?.content;
      const resized = work.pages.find((p) => p.id === "official-study")?.content.find((b) => b.id === "photo");
      const source = work.syncedSources.find((s) => s.id === "shared-source")?.blocks;
      const historyIds = work.pageVersions.filter((v) => v.pageId === "official-study").map((v) => v.id);
      if (blocks?.[0]?.id !== "tail" || blocks[1]?.id !== "photo" || source?.length !== 1 || source[0].id !== "mirror-image" || !historyIds.length) return false;
      if (!JSON.stringify(blocks[0].content).includes("可写") || !resized?.props.url.startsWith("life-asset://") ||
        !(resized.props.previewWidth > 64 && resized.props.previewWidth < previousWidth - 50)) return false;
      return { reorderedBlocks: blocks.slice(0, 2).map((b) => b.id), syncedBlocks: source.map((b) => b.id),
        historyVersions: historyIds.length, historyIds, resizedWidth: resized.props.previewWidth, editedParagraph: blocks[0].content };
    }, oldWidth), { timeoutMs: 12000, intervalMs: 150, message: "SQLite did not persist resize, reorder, text, sync and history changes" });
    assert.ok(persisted.resizedWidth > 64 && persisted.historyVersions > 0);
    nativeEvidence.persistedEdits = persisted;
    await open("other", "切换用页面");
    await editor.locator('[data-id="other-text"] .bn-inline-content').click();
    await tab.keyboard.press("End");
    // Exercise the real editor's clipboard handlers without touching the
    // user's system clipboard while the separate desktop app is in use.
    await editor.evaluate((root, serialized) => {
      const data = new DataTransfer();
      data.setData("text/html", serialized.html);
      data.setData("text/plain", serialized.text);
      root.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }));
    }, copied);
    const pasted = editor.locator("img").first();
    await pasted.waitFor();
    const imageUrl = await pasted.getAttribute("src");
    assert.equal(imageUrl, "life-asset://" + nativeEvidence.attachments.find(item => item.name === "study.png").sha256);
    await tab.keyboard.press("Control+z");
    await pasted.waitFor({ state: "detached" });
    nativeEvidence.clipboardRoundTrip = { input: "renderer ClipboardEvent and DataTransfer", imageUrl, undone: true };
    await open("only", "只有图片");
    await releaseHelpers.waitFor(() => tab.evaluate(async () => (await window.lifeAtlas.workspace.load()).value.workspace.ui.selectedPageId === "only"),
      { timeoutMs: 7000, message: "the destination page was not saved before exit" });
    await closeReleaseWindow();
    await browser.close().catch(() => {});
    const second = await openReleaseWindow(nativeEvidence.exe, nativeEvidence.profile);
    assert.notEqual(second.owner.mainPid, nativeEvidence.processId);
    const reopened = second.page.locator('.life-editor[data-page-id="only"] .bn-editor').first();
    await reopened.locator("img").waitFor();
    const passive = await inspect("cold-start-atomic-only-image", reopened);
    assert.equal(passive.pm.type, "gapcursor");
    assert.ok(noFrame(passive) && !passive.markers.some(marker => marker.shown));
    await second.page.screenshot({ path: path.join(evidence, "cold-open.png"), animations: "disabled" });
    nativeEvidence.coldRestart = { firstExitCode: 0, secondPid: second.owner.mainPid, page: "only", selection: passive.pm.type };
    nativeEvidence.states = report.length;
    nativeEvidence.result = "passed";
    await writeNativeEvidence();
  }
  console.log("PASS passive, pointer, keyboard, cross-block and native text selection", release ? "release" : "browser", theme, evidence);
} catch (error) {
  if (nativeEvidence) {
    nativeEvidence.result = "failed"; nativeEvidence.error = error.message; nativeEvidence.states = report.length;
    await writeNativeEvidence();
    if (tab && !tab.isClosed()) await tab.screenshot({ path: path.join(evidence, "failure.png") }).catch(() => {});
  }
  throw error;
} finally {
  if (nativeProcess) {
    try {
      await closeReleaseWindow();
      if (nativeEvidence) {
        nativeEvidence.processClosedCleanly = nativeProcess.exitCode === 0;
        assert.ok(nativeEvidence.processClosedCleanly, "release process did not exit cleanly");
        if (nativeEvidence.result === "passed") {
          const { entities } = releaseHelpers.readWorkspaceState(nativeEvidence.profile);
          const reordered = entities.pages.two.content;
          const resized = entities.pages["official-study"].content.find((block) => block.id === "photo");
          const historyIds = Object.values(entities.pageVersions).filter((version) => version.pageId === "official-study").map((version) => version.id);
          const stored = {
            asarSha256: nativeEvidence.asarSha256, profile: nativeEvidence.profile, theme,
            reorderedBlocks: reordered.slice(0, 2).map((block) => block.id), text: reordered[0].content,
            resizedWidth: resized.props.previewWidth, managedImage: resized.props.url,
            syncedBlocks: entities.syncedSources["shared-source"].blocks.map((block) => block.id),
            historyVersions: historyIds.length, historyIds,
          };
          const persisted = nativeEvidence.persistedEdits;
          assert.deepEqual(stored.reorderedBlocks, ["tail", "photo"]);
          assert.deepEqual(stored.text, persisted.editedParagraph);
          assert.equal(stored.resizedWidth, persisted.resizedWidth);
          assert.equal(stored.managedImage, "life-asset://" + nativeEvidence.attachments.find((item) => item.name === "study.png").sha256);
          assert.deepEqual(stored.syncedBlocks, ["mirror-image"]);
          assert.ok(persisted.historyIds.every(id => historyIds.includes(id)), "a saved history version disappeared after the cold restart");
          await fs.writeFile(path.join(evidence, "sqlite-after-exit.json"), JSON.stringify(stored, null, 2));
        }
      }
    } catch (error) {
      if (nativeEvidence) { nativeEvidence.result = "failed"; nativeEvidence.closeError = error.message; }
      throw error;
    } finally {
      await browser?.close().catch(() => {});
      if (nativeEvidence) await writeNativeEvidence();
    }
  } else await browser?.close();
  if (server) { if (source) await server.close(); else await new Promise((resolve) => server.httpServer.close(resolve)); }
}
