import test, { describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fullWorkspace } from "../fixtures/full-workspace.mjs";
import { upgradeWorkspace } from "../../src/persistence/migrations.js";
import { copyJson, stableJson, walkBlocks } from "../../src/domain/blockDocument.js";
import { assembleWorkspace, openWorkspaceDatabase, quickCheck, readAllRows } from "../../electron/main/storage/workspaceDb.js";
import { PACKAGED_EXE, REPO_ROOT, assertNoNetworkAndErrors, closeApp, createIsolatedDirectory, launchApp, openPageInSidebar, removeIsolatedDirectory, seedWorkspaceDatabase, shootWindowBothModes } from "./helpers.mjs";

// CDP exercises Chromium's input pipeline. It does not exercise Windows IME
// installation, language selection, candidate windows, or OS keyboard input.
const PAGE_ID = "p-a1";
const ROOT = `.life-editor[data-page-id="${PAGE_ID}"] > .bn-container .bn-editor`;
const EVIDENCE_DIR = path.join(REPO_ROOT, ".qa/LOCAL-NOTION-001");
const BUDGETS = { interactionMs: 30000, locatorMs: 9000, persistenceMs: 6000, lifecycleMs: 60000, suiteMs: 210000 };
const documentBlocks = (workspace) => workspace.pages.find((entry) => entry.id === PAGE_ID).content;
const block = (blocks, id) => walkBlocks(blocks).find((entry) => entry.id === id);
const inlineText = (entries) => entries.map((entry) => entry.type === "link" ? inlineText(entry.content) : entry.text ?? "").join("");
const textOf = (entry) => typeof entry.content === "string" ? entry.content : inlineText(entry.content ?? []);
const content = (page, id) => page.locator(`${ROOT} .bn-block-outer[data-id="${id}"]`).first().locator(":scope > .bn-block > .bn-block-content, :scope > .bn-block > .react-renderer > .bn-block-content").first();
let packageFreeze;

function fixtureWorkspace() {
  const workspace = upgradeWorkspace(fullWorkspace());
  workspace.ui.selectedPageId = PAGE_ID;
  workspace.ui.selectedFolderId = "f-a";
  workspace.ui.preferences = { theme: "system", style: "mobai" };
  const page = workspace.pages.find((entry) => entry.id === PAGE_ID);
  page.icon = "";
  page.cover = null;
  page.content = [
    { id: "trusted-leading", type: "paragraph", content: "输入前的相邻正文保持原样" },
    { id: "trusted-root-input", type: "paragraph", content: [
      { type: "text", text: "前缀 ", styles: {} },
      { type: "text", text: "粗体占位正文", styles: { bold: true } },
      { type: "text", text: " / ", styles: {} },
      { type: "link", href: "lifeatlas://page/p-z1", content: [{ type: "text", text: "相邻链接", styles: { italic: true } }] },
      { type: "text", text: " 尾段", styles: {} },
    ] },
    { id: "trusted-between", type: "paragraph", content: "页根输入与多栏之间的正文" },
    { id: "trusted-columns", type: "columnList", props: { columns: 2 }, children: [
      { id: "trusted-column-left", type: "column", props: { width: 45, index: 0, count: 2 }, children: [
        { id: "trusted-column-input", type: "paragraph", content: [
          { type: "text", text: "列首 ", styles: {} },
          { type: "text", text: "列内占位正文", styles: { italic: true, underline: true } },
          { type: "text", text: " / ", styles: {} },
          { type: "link", href: "lifeatlas://page/p-b1", content: [{ type: "text", text: "列链接", styles: { bold: true } }] },
          { type: "text", text: " 列尾", styles: {} },
        ] },
        { id: "trusted-column-left-tail", type: "paragraph", content: "左栏相邻段落" },
      ] },
      { id: "trusted-column-right", type: "column", props: { width: 55, index: 1, count: 2 }, children: [
        { id: "trusted-column-neighbor", type: "paragraph", content: [{ type: "text", text: "右栏带格式的相邻正文", styles: { bold: true, strike: true } }] },
        { id: "trusted-column-right-tail", type: "paragraph", content: "右栏末段" },
      ] },
    ] },
    { id: "trusted-after-columns", type: "paragraph", content: "多栏后方的相邻正文" },
    { id: "trusted-shortcut-input", type: "paragraph", content: [
      { type: "text", text: "快捷 ", styles: {} },
      { type: "text", text: "组合正文", styles: { bold: true } },
      { type: "text", text: " 保留后缀", styles: {} },
    ] },
    { id: "trusted-cancel-input", type: "paragraph", content: [
      { type: "text", text: "取消 ", styles: {} },
      { type: "text", text: "粗体正文", styles: { bold: true, italic: true } },
      { type: "text", text: " 保留结尾", styles: {} },
    ] },
  ];
  return workspace;
}

async function fileIdentity(file) {
  const digest = createHash("sha256");
  for await (const bytes of fs.createReadStream(file)) digest.update(bytes);
  const stat = fs.statSync(file);
  return { path: file, size: stat.size, mtimeMs: stat.mtimeMs, sha256: digest.digest("hex") };
}

async function packageIdentity(handle) {
  const runtime = await handle.app.evaluate(({ app }) => ({ packaged: app.isPackaged, version: app.getVersion(), appPath: app.getAppPath(), executablePath: process.execPath, versions: process.versions, pid: process.pid, userData: app.getPath("userData") }));
  const archive = path.join(path.dirname(PACKAGED_EXE), "resources/app.asar");
  assert.equal(runtime.packaged, true);
  assert.equal(path.resolve(runtime.executablePath), path.resolve(PACKAGED_EXE));
  assert.equal(path.resolve(runtime.appPath), path.resolve(archive));
  assert.equal(path.resolve(runtime.userData), path.resolve(handle.dataRoot, "runtime"));
  assert.equal(handle.page.url(), "app://bundle/index.html");
  if (!packageFreeze) {
    const asar = createRequire(import.meta.url)("@electron/asar");
    const metadata = JSON.parse(asar.extractFile(archive, "package.json").toString("utf8"));
    const sourceMetadata = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));
    assert.equal(metadata.lifeAtlasFlavor, "test");
    assert.equal(metadata.version, sourceMetadata.version);
    const editorSources = fs.readdirSync(path.join(REPO_ROOT, "src/editor"), { withFileTypes: true }).filter((entry) => entry.isFile() && /\.(?:js|jsx)$/.test(entry.name)).map((entry) => `src/editor/${entry.name}`);
    const rendererAssets = fs.readdirSync(path.join(REPO_ROOT, "dist/client/assets"), { withFileTypes: true }).filter((entry) => entry.isFile() && /\.(?:js|css)$/.test(entry.name)).map((entry) => `dist/client/assets/${entry.name}`);
    assert.ok(rendererAssets.some((relative) => relative.endsWith(".js")));
    // The build config packages src/**/*.js, but not raw JSX or CSS. JSX is
    // source provenance; its actual compiled renderer is checked separately.
    const renderedSources = ["src/App.jsx", "src/components/PageActionsMenu.jsx", "src/ui/keyboard.js", ...editorSources];
    const packagedSources = ["src/domain/blockDocument.js", "src/persistence/normalize.js", "src/ui/keyboard.js", "electron/main/index.js", "electron/main/storage/workspaceDb.js", "electron/preload/workspace.cjs", ...editorSources.filter((relative) => relative.endsWith(".js")), "dist/client/index.html", ...rendererAssets];
    const sourcePaths = [...new Set([...renderedSources, ...packagedSources, "package.json", "tests/desktop/editor-trusted-composition-v4.e2e.mjs", "tests/desktop/helpers.mjs", "tests/browser/editor-trusted-composition-v4.mjs", "tests/fixtures/full-workspace.mjs"])].sort();
    const sourceFiles = [];
    const packagedFiles = [];
    const revision = createHash("sha256");
    for (const relative of sourcePaths) {
      const identity = await fileIdentity(path.join(REPO_ROOT, relative));
      sourceFiles.push({ relative, ...identity });
      revision.update(`${relative}\0${identity.sha256}\n`);
      if (!packagedSources.includes(relative)) continue;
      const bytes = asar.extractFile(archive, path.normalize(relative));
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      assert.equal(sha256, identity.sha256, `Packaged source/renderer differs from the current freeze: ${relative}`);
      packagedFiles.push({ relative, size: bytes.length, sha256 });
    }
    const renderer = sourceFiles.find((entry) => entry.relative === "dist/client/index.html");
    assert.ok(renderer.mtimeMs >= Math.max(...sourceFiles.filter((entry) => renderedSources.includes(entry.relative)).map((entry) => entry.mtimeMs)), "The renderer build must follow the current editor/JSX source freeze");
    const files = [];
    for (const file of [PACKAGED_EXE, archive, path.join(path.dirname(PACKAGED_EXE), "THIRD_PARTY_NOTICES.md"), path.join(REPO_ROOT, "THIRD_PARTY_NOTICES.md")]) files.push(await fileIdentity(file));
    assert.equal(files[2].sha256, files[3].sha256);
    packageFreeze = { version: metadata.version, flavor: metadata.lifeAtlasFlavor, sourceRevisionSha256: revision.digest("hex"), sourceFiles, packagedFiles, files };
  }
  for (const identity of [...packageFreeze.sourceFiles, ...packageFreeze.files]) {
    const stat = fs.statSync(identity.path);
    assert.equal(stat.size, identity.size, `Frozen file size changed: ${identity.path}`);
    assert.equal(stat.mtimeMs, identity.mtimeMs, `Frozen file changed during this serialized test file: ${identity.path}`);
  }
  assert.equal(runtime.version, packageFreeze.version);
  return { runtime, ownership: handle.processOwnership, ...packageFreeze };
}

// Transparent forwarding only: no CompositionEvent creation, trust override,
// substitute event, or production hook. Negative origin evidence is bounded.
function installDispatchDiagnostic() {
  const prototype = EventTarget.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "dispatchEvent");
  const original = descriptor.value;
  const calls = [];
  const ids = new WeakMap();
  let phase = "startup";
  let sequence = 0;
  let overflow = false;
  const tracked = function (event) {
    if (event?.type === "compositionend") {
      const id = ++sequence;
      ids.set(event, id);
      if (calls.length < 16) calls.push({ id, phase, isTrusted: event.isTrusted, constructor: event.constructor?.name ?? null, data: event.data ?? null,
        targetTag: this instanceof Element ? this.tagName : null, targetIsEditor: this instanceof Element && Boolean(this.closest(".bn-editor")), targetIsControl: this instanceof Element && this.hasAttribute("data-packaged-composition-control"),
        stack: String(new Error("compositionend dispatchEvent origin").stack ?? "").split("\n").slice(0, 12).join("\n").slice(0, 2400) });
      else overflow = true;
    }
    return Reflect.apply(original, this, arguments);
  };
  Object.defineProperty(prototype, "dispatchEvent", { ...descriptor, value: tracked });
  window.__packagedCompositionDispatchV4 = {
    read: () => ({ phase, currentIsWrapper: prototype.dispatchEvent === tracked, overflow, calls: calls.map((entry) => ({ ...entry })) }),
    callFor: (event) => ids.get(event) ?? null,
    begin: (next) => { phase = next; calls.length = 0; overflow = false; },
    dispose: () => { if (prototype.dispatchEvent === tracked) Object.defineProperty(prototype, "dispatchEvent", descriptor); delete window.__packagedCompositionDispatchV4; },
  };
}

async function installProbe(page) {
  await page.evaluate((selector) => {
    const root = document.querySelector(selector);
    const editor = root.pmViewDesc.node.type.schema.cached.blockNoteEditor;
    const events = [];
    let active = false;
    let overflow = false;
    const endpoint = (node, offset) => {
      const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
      const inline = element?.closest(".bn-inline-content");
      if (!inline || inline.closest(".bn-editor") !== root || !inline.contains(node)) return null;
      const range = document.createRange();
      range.setStart(inline, 0);
      range.setEnd(node, offset);
      const path = [];
      for (let outer = element.closest(".bn-block-outer[data-id]"); outer && root.contains(outer); outer = outer.parentElement?.closest(".bn-block-outer[data-id]")) path.push(outer.dataset.id);
      return { blockId: path[0] ?? null, textOffset: range.toString().length, position: editor.prosemirrorView.posAtDOM(node, offset), path };
    };
    const selection = () => {
      const current = window.getSelection();
      return current ? { collapsed: current.isCollapsed, text: current.toString(), anchor: endpoint(current.anchorNode, current.anchorOffset), focus: endpoint(current.focusNode, current.focusOffset) } : null;
    };
    const capture = (event) => {
      const target = event.target instanceof Element ? event.target : event.target?.parentElement;
      if (target?.closest(".bn-editor") !== root) return;
      if (event.type === "compositionstart") active = true;
      if (event.type === "compositionend") active = false;
      if (events.length >= 96) { overflow = true; return; }
      const entry = { type: event.type, isTrusted: event.isTrusted, data: event.data ?? null, inputType: event.inputType ?? null, constructor: event.constructor?.name ?? null,
        dispatchCallId: window.__packagedCompositionDispatchV4?.callFor(event) ?? null, isComposing: Boolean(event.isComposing), preeditActive: active, viewComposing: editor.prosemirrorView.composing,
        key: event.key ?? null, code: event.code ?? null, ctrlKey: Boolean(event.ctrlKey), altKey: Boolean(event.altKey), shiftKey: Boolean(event.shiftKey), defaultPrevented: event.defaultPrevented,
        targetIsRoot: target === root, selectionBlockId: selection()?.anchor?.blockId ?? null };
      events.push(entry);
      if (event.type === "keydown") queueMicrotask(() => { entry.defaultPrevented = event.defaultPrevented; });
    };
    const types = ["compositionstart", "compositionupdate", "compositionend", "beforeinput", "input", "keydown"];
    for (const type of types) root.addEventListener(type, capture, true);
    window.__packagedTrustedCompositionV4 = {
      read: () => ({ active, overflow, events: events.map((entry) => ({ ...entry })), selection: selection() }),
      reset: () => { if (active || editor.prosemirrorView.composing) throw new Error("Cannot reset observations during composition"); events.length = 0; overflow = false; },
      dispose: () => { for (const type of types) root.removeEventListener(type, capture, true); delete window.__packagedTrustedCompositionV4; },
    };
  }, ROOT);
}

async function nativeSnapshot(page) {
  return page.evaluate((selector) => {
    const editor = document.querySelector(selector).pmViewDesc.node.type.schema.cached.blockNoteEditor;
    const state = editor.prosemirrorState;
    const history = state.plugins.find((plugin) => plugin.key.startsWith("history$"))?.getState(state);
    if (!history?.done || !history?.undone) throw new Error("Native ProseMirror history is unavailable");
    return { document: JSON.parse(JSON.stringify(editor.document)), native: state.doc.toJSON(), selection: state.selection.toJSON(), selectionEmpty: state.selection.empty,
      history: { undo: history.done.eventCount, redo: history.undone.eventCount }, composing: editor.prosemirrorView.composing, focused: editor.prosemirrorView.hasFocus(), editable: editor.isEditable, viewEditable: editor.prosemirrorView.editable,
      input: window.__packagedTrustedCompositionV4?.read() ?? null, dispatch: window.__packagedCompositionDispatchV4?.read() ?? null };
  }, ROOT);
}

function observe(state, label, snapshot) {
  if (state.trace.observations.length >= 64) { state.trace.overflow = true; throw new Error("Bounded composition observations overflowed"); }
  state.trace.observations.push({ label, snapshot });
}

async function ready(handle) {
  const page = handle.page;
  page.setDefaultTimeout(BUDGETS.locatorMs);
  await page.locator('html[data-la-ready="1"]').waitFor();
  await page.locator(".workspace-sidebar").waitFor();
  await handle.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 900));
  await page.setViewportSize({ width: 1440, height: 900 });
  await openPageInSidebar(page, "A 概览");
  await content(page, "trusted-root-input").waitFor();
  await page.waitForFunction((selector) => Boolean(document.querySelector(selector)?.pmViewDesc?.node?.type?.schema?.cached?.blockNoteEditor), ROOT);
  await page.evaluate(() => document.fonts.ready.then(() => true));
}

async function compositionCase(context, slug) {
  const dataRoot = createIsolatedDirectory("composition-v4-data");
  const bootstrapDir = createIsolatedDirectory("composition-v4-bootstrap");
  const state = { dataRoot, bootstrapDir, handle: null, session: null, complete: false, expired: false, phase: "startup", shots: [], directories: new Set([dataRoot, bootstrapDir]),
    trace: { scenario: "editor-trusted-composition-v4", test: context.name, slug, runId: path.basename(dataRoot), transport: "Chromium CDP Input.imeSetComposition / Input.insertText", osChineseImeVerified: false, budgets: BUDGETS, overflow: false, identities: [], stimuli: [], observations: [] } };
  context.after(async () => {
    const failures = [];
    if (state.handle) {
      try { observe(state, "final", await nativeSnapshot(state.handle.page)); } catch (error) { state.trace.finalDiagnosticError = error.message; failures.push(error); }
      const plain = await state.handle.page.evaluate(() => window.__packagedPlainCompositionV4?.read() ?? null).catch(() => null);
      if (plain) { try { observe(state, "plain-control-final", plain); } catch (error) { failures.push(error); } }
      try { await disposeObservers(state); } catch (error) { failures.push(error); }
      try { await assertNoNetworkAndErrors(state.handle); } catch (error) { failures.push(error); }
      try { await closeApp(state.handle, { keepDirs: true }); state.handle = null; } catch (error) { failures.push(error); }
    }
    state.trace.outcome = state.complete && failures.length === 0 ? "passed" : "failed-or-incomplete";
    state.trace.retainedDirectories = state.trace.outcome === "passed" ? [] : [...state.directories];
    state.trace.cleanupErrors = failures.map((error) => error.message);
    state.trace.originDiagnostic = originDiagnostic(state.trace);
    // File output and binary hashing are outside every timed interaction.
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    const prefix = `editor-desktop-trusted-composition-v4-${slug}-${state.trace.runId}`;
    for (const shot of state.shots) fs.writeFileSync(path.join(EVIDENCE_DIR, `${prefix}-${shot.label}.png`), shot.bytes);
    const traceFile = path.join(EVIDENCE_DIR, `${prefix}-trace.json`);
    fs.writeFileSync(traceFile, `${JSON.stringify(state.trace, null, 2)}\n`, "utf8");
    console.log(`PACKAGED_COMPOSITION_V4 ${JSON.stringify({ test: context.name, traceFile, outcome: state.trace.outcome, originDiagnostic: state.trace.originDiagnostic, retainedDirectories: state.trace.retainedDirectories })}`);
    if (state.trace.outcome === "passed") {
      for (const directory of state.directories) if (fs.existsSync(directory)) removeIsolatedDirectory(directory);
    } else console.log(`LIFE_ATLAS_TEST_FAILURE_ROOTS ${JSON.stringify({ test: context.name, directories: [...state.directories] })}`);
    if (failures.length) throw new AggregateError(failures, "Packaged composition cleanup/network verification failed");
  });
  state.seededWorkspace = await seedWorkspaceDatabase(dataRoot, fixtureWorkspace());
  state.handle = await launchApp({ packaged: true, dataRoot, bootstrapDir });
  state.directories.add(state.handle.tempDir);
  await ready(state.handle);
  state.trace.identities.push(await packageIdentity(state.handle));
  await state.handle.page.addInitScript(installDispatchDiagnostic);
  await state.handle.page.reload({ waitUntil: "domcontentloaded" });
  await ready(state.handle);
  await installProbe(state.handle.page);
  state.session = await state.handle.app.context().newCDPSession(state.handle.page);
  observe(state, "seeded-native", await nativeSnapshot(state.handle.page));
  return state;
}

async function disposeObservers(state) {
  await state.handle.page.evaluate(() => {
    window.__packagedPlainCompositionV4?.dispose();
    window.__packagedTrustedCompositionV4?.dispose();
    window.__packagedCompositionDispatchV4?.dispose();
  });
  if (state.session) { const session = state.session; state.session = null; await session.detach(); }
}

async function loadedWorkspace(handle) {
  const result = await handle.page.evaluate(() => window.lifeAtlas.workspace.load());
  assert.equal(result.ok, true, result.error?.message);
  return result.value.workspace;
}

async function persisted(handle, expected) {
  const deadline = Date.now() + BUDGETS.persistenceMs;
  const expectedJson = stableJson(expected);
  let workspace;
  do {
    workspace = await loadedWorkspace(handle);
    if (stableJson(documentBlocks(workspace)) === expectedJson) return workspace;
    await new Promise((resolve) => setTimeout(resolve, 50));
  } while (Date.now() < deadline);
  assert.fail(`Exact composition content did not reach SQLite within 6 seconds: ${JSON.stringify(documentBlocks(workspace))}`);
}

async function sendInput(state, method, params) {
  assert.equal(state.expired, false, "No input may continue after the interaction deadline");
  const stimulus = { phase: state.phase, method, params };
  state.trace.stimuli.push(stimulus);
  try { await state.session.send(method, params); }
  catch (error) { stimulus.error = error.message; throw error; }
}

async function interactions(state, run) {
  let timer;
  try {
    return await Promise.race([run(), new Promise((resolve, reject) => { timer = setTimeout(() => { state.expired = true; reject(new Error("Packaged composition interactions exceeded the unchanged 30-second budget")); }, BUDGETS.interactionMs); })]);
  } finally { clearTimeout(timer); }
}

async function selectRange(state, id, from, to = from) {
  const page = state.handle.page;
  await content(page, id).click({ position: { x: 6, y: 6 } });
  const positions = await content(page, id).locator(".bn-inline-content").evaluate((inline, range) => {
    const editor = inline.closest(".bn-editor").pmViewDesc.node.type.schema.cached.blockNoteEditor;
    const endpoint = (offset) => {
      const walker = document.createTreeWalker(inline, NodeFilter.SHOW_TEXT);
      let remaining = offset;
      for (let node = walker.nextNode(); node; node = walker.nextNode()) { if (remaining <= node.data.length) return { node, offset: remaining }; remaining -= node.data.length; }
      throw new Error(`Text offset ${offset} is unavailable`);
    };
    const anchor = endpoint(range.from);
    const head = endpoint(range.to);
    window.getSelection().setBaseAndExtent(anchor.node, anchor.offset, head.node, head.offset);
    return { anchor: editor.prosemirrorView.posAtDOM(anchor.node, anchor.offset), head: editor.prosemirrorView.posAtDOM(head.node, head.offset), text: window.getSelection().toString() };
  }, { from, to });
  await page.waitForFunction(({ selector, positions }) => {
    const editor = document.querySelector(selector).pmViewDesc.node.type.schema.cached.blockNoteEditor;
    return editor.prosemirrorView.hasFocus() && editor.prosemirrorState.selection.anchor === positions.anchor && editor.prosemirrorState.selection.head === positions.head;
  }, { selector: ROOT, positions });
  await page.evaluate(() => window.__packagedTrustedCompositionV4.reset());
  await page.evaluate((phase) => window.__packagedCompositionDispatchV4.begin(phase), id);
  state.phase = id;
  return positions;
}

function nativeBlock(native, id) {
  if (native.type === "blockContainer" && native.attrs?.id === id) return native;
  for (const child of native.content ?? []) { const result = nativeBlock(child, id); if (result) return result; }
  return null;
}

function expectedEdit(before, id, inlineIndex, from, to, text) {
  const document = copyJson(before.document);
  const inline = block(document, id).content[inlineIndex];
  assert.equal(inline.type, "text");
  const originalText = inline.text;
  inline.text = originalText.slice(0, from) + text + originalText.slice(to);
  const native = copyJson(before.native);
  const runs = nativeBlock(native, id).content[0].content.filter((entry) => entry.type === "text" && entry.text === originalText);
  assert.equal(runs.length, 1, "The marked native text run must be uniquely identified");
  runs[0].text = inline.text;
  return { document, native };
}

function assertIdentities(before, after) {
  const collectNative = (node) => [...(typeof node.attrs?.id === "string" ? [node.attrs.id] : []), ...(node.content ?? []).flatMap(collectNative)];
  for (const ids of [walkBlocks(after.document).map((entry) => entry.id), collectNative(after.native)]) assert.equal(new Set(ids).size, ids.length, "Block and native layout IDs must remain unique");
  assert.deepEqual(walkBlocks(after.document).map((entry) => entry.id), walkBlocks(before.document).map((entry) => entry.id));
  assert.deepEqual(collectNative(after.native), collectNative(before.native));
}

async function waitForTextAndCaret(state, id, expected, textOffset, composing) {
  await state.handle.page.waitForFunction(({ selector, id, expectedText, textOffset, composing }) => {
    const root = document.querySelector(selector);
    const editor = root.pmViewDesc.node.type.schema.cached.blockNoteEditor;
    const pending = [...editor.document];
    let target;
    while (pending.length) { const entry = pending.shift(); if (entry.id === id) { target = entry; break; } pending.push(...(entry.children ?? [])); }
    const text = (entries) => entries.map((entry) => entry.type === "link" ? text(entry.content) : entry.text ?? "").join("");
    const canonicalText = typeof target?.content === "string" ? target.content : text(target?.content ?? []);
    const outer = root.querySelector(`.bn-block-outer[data-id="${id}"]`);
    const inline = outer?.querySelector(':scope > .bn-block > .bn-block-content .bn-inline-content, :scope > .bn-block > .react-renderer > .bn-block-content .bn-inline-content');
    const input = window.__packagedTrustedCompositionV4.read();
    const selection = input.selection;
    return canonicalText === expectedText && inline?.textContent === expectedText && editor.prosemirrorView.composing === composing && input.active === composing && editor.prosemirrorView.hasFocus() && editor.prosemirrorState.selection.empty && selection?.collapsed &&
      selection.anchor?.blockId === id && selection.focus?.blockId === id && selection.anchor.textOffset === textOffset && selection.focus.textOffset === textOffset && editor.prosemirrorState.selection.anchor === selection.anchor.position && editor.prosemirrorState.selection.head === selection.focus.position;
  }, { selector: ROOT, id, expectedText: textOf(block(expected.document, id)), textOffset, composing });
}

async function preedit(state, label, id, text, expected, textOffset) {
  await sendInput(state, "Input.imeSetComposition", { text, selectionStart: text.length, selectionEnd: text.length });
  await waitForTextAndCaret(state, id, expected, textOffset, true);
  const snapshot = await nativeSnapshot(state.handle.page);
  observe(state, label, snapshot);
  assert.deepEqual(snapshot.document, expected.document);
  assert.deepEqual(snapshot.native, expected.native, "Preedit must preserve the native tree, inline marks, links and neighbors");
  return snapshot;
}

async function commit(state, label, id, text, expected, textOffset) {
  await sendInput(state, "Input.insertText", { text });
  await waitForTextAndCaret(state, id, expected, textOffset, false);
  await persisted(state.handle, expected.document);
  const snapshot = await nativeSnapshot(state.handle.page);
  observe(state, label, snapshot);
  assert.deepEqual(snapshot.document, expected.document);
  assert.deepEqual(snapshot.native, expected.native);
  return snapshot;
}

function assertTrustedPipeline(snapshot, candidates, id) {
  assert.equal(snapshot.input.overflow, false);
  assert.equal(snapshot.input.active, false);
  assert.equal(snapshot.composing, false);
  assert.equal(snapshot.dispatch.currentIsWrapper, true, "Negative dispatch-origin evidence needs the installed forwarding wrapper");
  assert.equal(snapshot.dispatch.overflow, false);
  const events = snapshot.input.events;
  assert.ok(events.length > 0 && events.every((entry) => entry.isTrusted === true), `Every observed pipeline event must remain trusted: ${JSON.stringify(events.map(({ type, isTrusted, dispatchCallId, data }) => ({ type, isTrusted, dispatchCallId, data })))}`);
  assert.equal(events.filter((entry) => entry.type === "compositionstart").length, 1);
  assert.equal(events.filter((entry) => entry.type === "compositionend").length, 1);
  for (const text of candidates) assert.ok(events.some((entry) => entry.type === "compositionupdate" && entry.data === text), `Trusted compositionupdate must expose ${text}`);
  assert.ok(events.some((entry) => entry.type === "beforeinput" && entry.isComposing));
  assert.ok(events.filter((entry) => entry.type === "input").length >= candidates.length);
  assert.ok(events.some((entry) => entry.type === "input" && entry.selectionBlockId === id));
}

async function compositionShortcuts(state, label) {
  for (const shortcut of [{ chord: "Control+Alt+3", code: "Digit3" }, { chord: "Control+d", code: "KeyD" }, { chord: "Shift+F10", code: "F10" }]) {
    const before = await nativeSnapshot(state.handle.page);
    state.trace.stimuli.push({ phase: state.phase, method: "keyboard.press", chord: shortcut.chord });
    await state.handle.page.keyboard.press(shortcut.chord);
    const after = await nativeSnapshot(state.handle.page);
    observe(state, `${label}-${shortcut.code}`, after);
    assert.equal(after.composing, true);
    assert.equal(after.input.active, true);
    assert.equal(after.input.events.filter((entry) => entry.type === "compositionend").length, 0);
    for (const key of ["native", "document", "history", "selection"]) assert.deepEqual(after[key], before[key], shortcut.chord);
    assert.deepEqual(after.input.selection, before.input.selection);
    const key = after.input.events.findLast((entry) => entry.type === "keydown" && entry.code === shortcut.code);
    assert.ok(key?.isTrusted && key.defaultPrevented, `${shortcut.chord} must be consumed by the owning shortcut capture`);
    assert.equal(await state.handle.page.locator(".life-block-menu, .life-block-conversion-menu, .bn-suggestion-menu").count(), 0);
  }
}

async function historyRoundTrip(state, label, before, after) {
  assert.equal(after.history.undo, before.history.undo + 1, "One composition must create one native undo event");
  assert.equal(after.history.redo, 0);
  state.trace.stimuli.push({ phase: state.phase, method: "keyboard.press", chord: "Control+z" });
  await state.handle.page.keyboard.press("Control+z");
  await persisted(state.handle, before.document);
  const undone = await nativeSnapshot(state.handle.page);
  observe(state, `${label}-undo`, undone);
  for (const key of ["native", "document", "selection"]) assert.deepEqual(undone[key], before[key]);
  assert.equal(undone.history.undo, before.history.undo);
  assert.equal(undone.history.redo, 1);
  assertIdentities(before, undone);
  state.trace.stimuli.push({ phase: state.phase, method: "keyboard.press", chord: "Control+Shift+z" });
  await state.handle.page.keyboard.press("Control+Shift+z");
  await persisted(state.handle, after.document);
  const redone = await nativeSnapshot(state.handle.page);
  observe(state, `${label}-redo`, redone);
  for (const key of ["native", "document", "selection", "history"]) assert.deepEqual(redone[key], after[key]);
  assertIdentities(after, redone);
  return redone;
}

async function plainControl(state, { candidates, text, from = 5, to = from, cancel = false }) {
  const page = state.handle.page;
  const before = await nativeSnapshot(page);
  await page.evaluate(({ from, to }) => {
    window.__packagedCompositionDispatchV4.begin("plain-contenteditable");
    const control = document.createElement("div");
    const seed = "前缀 粗体占位正文 / 对照结尾";
    const node = document.createTextNode(seed);
    control.setAttribute("contenteditable", "true");
    control.setAttribute("data-packaged-composition-control", "");
    control.setAttribute("role", "textbox");
    control.setAttribute("aria-label", "组合输入诊断对照");
    control.style.cssText = "position:fixed;top:20px;left:20px;right:20px;min-height:60px;z-index:2147483647;background:Canvas;color:CanvasText";
    control.append(node);
    const events = [];
    let active = false;
    let overflow = false;
    const capture = (event) => {
      if (event.type === "compositionstart") active = true;
      if (event.type === "compositionend") active = false;
      if (events.length >= 32) { overflow = true; return; }
      events.push({ type: event.type, isTrusted: event.isTrusted, data: event.data ?? null, inputType: event.inputType ?? null, isComposing: Boolean(event.isComposing), constructor: event.constructor?.name ?? null, dispatchCallId: window.__packagedCompositionDispatchV4.callFor(event), targetIsControl: event.target === control });
    };
    const types = ["compositionstart", "compositionupdate", "compositionend", "beforeinput", "input"];
    for (const type of types) control.addEventListener(type, capture, true);
    document.body.append(control);
    control.focus();
    window.getSelection().setBaseAndExtent(node, from, node, to);
    const offset = (node, offset) => { if (!node || !control.contains(node)) return null; const range = document.createRange(); range.setStart(control, 0); range.setEnd(node, offset); return range.toString().length; };
    window.__packagedPlainCompositionV4 = {
      read: () => { const selection = window.getSelection(); return { seed, text: control.textContent, focused: document.activeElement === control, active, overflow, events: events.map((entry) => ({ ...entry })), dispatch: window.__packagedCompositionDispatchV4.read(), selection: selection ? { collapsed: selection.isCollapsed, anchorOffset: offset(selection.anchorNode, selection.anchorOffset), focusOffset: offset(selection.focusNode, selection.focusOffset) } : null }; },
      dispose: () => { for (const type of types) control.removeEventListener(type, capture, true); control.remove(); delete window.__packagedPlainCompositionV4; },
    };
  }, { from, to });
  state.phase = "plain-contenteditable";
  const initial = await page.evaluate(() => window.__packagedPlainCompositionV4.read());
  observe(state, "plain-control-before", initial);
  const expected = (text) => initial.seed.slice(0, from) + text + initial.seed.slice(to);
  for (const candidate of candidates) {
    await sendInput(state, "Input.imeSetComposition", { text: candidate, selectionStart: candidate.length, selectionEnd: candidate.length });
    await page.waitForFunction((expected) => { const current = window.__packagedPlainCompositionV4.read(); return current.focused && current.active && current.text === expected; }, expected(candidate));
    observe(state, `plain-control-preedit-${candidate}`, await page.evaluate(() => window.__packagedPlainCompositionV4.read()));
  }
  state.shots.push({ label: "plain-preedit", bytes: await page.screenshot() });
  if (cancel) await sendInput(state, "Input.imeSetComposition", { text: "", selectionStart: 0, selectionEnd: 0 });
  else await sendInput(state, "Input.insertText", { text });
  await page.waitForFunction(({ expectedText, textOffset }) => { const current = window.__packagedPlainCompositionV4.read(); return current.focused && !current.active && current.text === expectedText && current.selection?.collapsed && current.selection.anchorOffset === textOffset && current.selection.focusOffset === textOffset; }, { expectedText: cancel ? initial.seed : expected(text), textOffset: cancel ? from : from + text.length });
  const completed = await page.evaluate(() => window.__packagedPlainCompositionV4.read());
  observe(state, "plain-control-completed", completed);
  assert.equal(completed.overflow, false);
  assert.equal(completed.dispatch.currentIsWrapper, true);
  assert.equal(completed.dispatch.overflow, false);
  assert.equal(completed.events.filter((entry) => entry.type === "compositionstart").length, 1);
  assert.equal(completed.events.filter((entry) => entry.type === "compositionend").length, 1);
  const after = await nativeSnapshot(page);
  for (const key of ["native", "document", "history"]) assert.deepEqual(after[key], before[key], "The plain control must not edit the app document");
  observe(state, "plain-control-app-unchanged", after);
  await page.evaluate(() => window.__packagedPlainCompositionV4.dispose());
}

function originDiagnostic(trace) {
  const plain = trace.observations.find((entry) => entry.label === "plain-control-completed")?.snapshot;
  const app = trace.observations.find((entry) => trace.slug === "cancel" ? entry.label === "cancelled" : entry.label.endsWith("-committed"))?.snapshot;
  if (!plain || !app) return { result: "incomplete-control-or-app-terminal", osChineseImeVerified: false };
  const valid = (snapshot, events) => snapshot.dispatch?.currentIsWrapper === true && snapshot.dispatch.overflow === false && snapshot.overflow !== true && events.every((entry) => entry.dispatchCallId === null || snapshot.dispatch.calls.some((call) => call.id === entry.dispatchCallId));
  if (!valid(plain, plain.events) || !valid(app, app.input.events) || app.input.overflow) return { result: "incomplete-dispatch-or-capture", osChineseImeVerified: false };
  const appEnds = app.input.events.filter((entry) => entry.type === "compositionend");
  const plainEnds = plain.events.filter((entry) => entry.type === "compositionend");
  const positive = appEnds.filter((entry) => entry.isTrusted === false && entry.dispatchCallId !== null);
  const calls = positive.map((entry) => app.dispatch.calls.find((call) => call.id === entry.dispatchCallId));
  const shared = appEnds.some((entry) => entry.isTrusted === false) && plainEnds.some((entry) => entry.isTrusted === false) && appEnds.every((entry) => entry.dispatchCallId === null) && plainEnds.every((entry) => entry.dispatchCallId === null) && app.dispatch.calls.length === 0 && plain.dispatch.calls.length === 0;
  return { result: calls.length ? "main-world-dispatch-observed" : shared ? "untrusted-end-reproduced-on-plain-control-and-app" : appEnds.some((entry) => entry.isTrusted === false) ? "app-control-trust-differential" : "no-untrusted-app-end-observed", appEnds, plainEnds, calls,
    limits: "Null dispatch IDs do not exclude isolated-world/native producers. A plain/app difference also includes marks, tree, focus and shortcut context. CDP is not Windows OS IME.", osChineseImeVerified: false };
}

async function restartAndFinish(state, final, pipelines) {
  const previous = state.handle;
  await persisted(previous, final.document);
  await assertNoNetworkAndErrors(previous);
  await disposeObservers(state);
  await closeApp(previous, { keepDirs: true });
  state.handle = null;
  const database = openWorkspaceDatabase(path.join(state.dataRoot, "workspace.db"), { readOnly: true });
  let closed;
  let sqliteQuickCheck;
  try { sqliteQuickCheck = quickCheck(database); assert.equal(sqliteQuickCheck, "ok"); closed = assembleWorkspace(readAllRows(database)); }
  finally { database.close(); }
  assert.deepEqual(documentBlocks(closed), final.document);
  observe(state, "closed-sqlite", { document: documentBlocks(closed), settings: closed.pages.find((entry) => entry.id === PAGE_ID).settings, quickCheck: sqliteQuickCheck });
  state.handle = await launchApp({ packaged: true, dataRoot: state.dataRoot, bootstrapDir: state.bootstrapDir });
  state.directories.add(state.handle.tempDir);
  await ready(state.handle);
  state.trace.identities.push(await packageIdentity(state.handle));
  await state.handle.page.addInitScript(installDispatchDiagnostic);
  await state.handle.page.reload({ waitUntil: "domcontentloaded" });
  await ready(state.handle);
  await installProbe(state.handle.page);
  const restarted = await nativeSnapshot(state.handle.page);
  observe(state, "restarted", restarted);
  assert.deepEqual(restarted.document, final.document);
  assert.deepEqual(restarted.native, final.native);
  assertIdentities(final, restarted);
  assert.deepEqual(documentBlocks(await loadedWorkspace(state.handle)), final.document);
  assert.equal(restarted.composing, false);
  assert.equal(restarted.input.active, false);
  assert.equal(restarted.editable, true);
  assert.equal(restarted.viewEditable, true);
  for (const [id, href] of [["trusted-root-input", "lifeatlas://page/p-z1"], ["trusted-column-input", "lifeatlas://page/p-b1"]]) await content(state.handle.page, id).locator(`a[href="${href}"]`).waitFor();
  assert.deepEqual(block(restarted.document, "trusted-columns").children.map((entry) => entry.props.width), [45, 55]);
  const shotName = `editor-desktop-trusted-composition-v4-${state.trace.slug}-${state.trace.runId}-restarted`;
  await shootWindowBothModes(state.handle, shotName, { shotsDir: EVIDENCE_DIR });
  state.trace.restartedShots = ["light", "dark"].map((mode) => path.join(EVIDENCE_DIR, `${shotName}-${mode}.png`));
  // Run the original strict trust gate after actual undo/redo and durability.
  // A transport-specific red must retain evidence of operations already made.
  for (const { snapshot, candidates, id } of pipelines) assertTrustedPipeline(snapshot, candidates, id);
  assert.equal(state.trace.overflow, false);
  await assertNoNetworkAndErrors(state.handle);
  state.complete = true;
}

describe("packaged trusted Chromium composition v4", { timeout: BUDGETS.suiteMs, concurrency: false }, () => {
test("packaged trusted Chromium composition commits Chinese text at a marked page-root caret with one native undo redo", { timeout: BUDGETS.lifecycleMs }, async (context) => {
  const state = await compositionCase(context, "page-root");
  await plainControl(state, { candidates: ["中", "中文"], text: "中文输入" });
  const after = await interactions(state, async () => {
    await selectRange(state, "trusted-root-input", 5);
    const before = await nativeSnapshot(state.handle.page);
    observe(state, "page-root-before", before);
    assert.equal(block(before.document, "trusted-root-input").content[1].styles.bold, true);
    assert.deepEqual(before.input.selection.anchor.path, ["trusted-root-input"]);
    await preedit(state, "page-root-preedit-1", "trusted-root-input", "中", expectedEdit(before, "trusted-root-input", 1, 2, 2, "中"), 6);
    await preedit(state, "page-root-preedit-2", "trusted-root-input", "中文", expectedEdit(before, "trusted-root-input", 1, 2, 2, "中文"), 7);
    state.shots.push({ label: "page-root-preedit", bytes: await state.handle.page.screenshot() });
    const committed = await commit(state, "page-root-committed", "trusted-root-input", "中文输入", expectedEdit(before, "trusted-root-input", 1, 2, 2, "中文输入"), 9);
    assertIdentities(before, committed);
    await historyRoundTrip(state, "page-root", before, committed);
    return committed;
  });
  await restartAndFinish(state, after, [{ snapshot: after, candidates: ["中", "中文"], id: "trusted-root-input" }]);
});

test("packaged trusted Chromium composition replaces a marked selection inside columns without changing adjacent blocks or identities", { timeout: BUDGETS.lifecycleMs }, async (context) => {
  const state = await compositionCase(context, "columns");
  await plainControl(state, { candidates: ["候", "候选字"], text: "中文提交", from: 5, to: 7 });
  const after = await interactions(state, async () => {
    assert.equal((await selectRange(state, "trusted-column-input", 5, 7)).text, "占位");
    const before = await nativeSnapshot(state.handle.page);
    observe(state, "columns-before", before);
    assert.deepEqual(block(before.document, "trusted-column-input").content[1].styles, { italic: true, underline: true });
    assert.deepEqual(before.input.selection.anchor.path, ["trusted-column-input", "trusted-column-left", "trusted-columns"]);
    await preedit(state, "columns-preedit-1", "trusted-column-input", "候", expectedEdit(before, "trusted-column-input", 1, 2, 4, "候"), 6);
    await preedit(state, "columns-preedit-2", "trusted-column-input", "候选字", expectedEdit(before, "trusted-column-input", 1, 2, 4, "候选字"), 8);
    await compositionShortcuts(state, "columns-preedit-shortcut");
    state.shots.push({ label: "columns-preedit", bytes: await state.handle.page.screenshot() });
    const committed = await commit(state, "columns-committed", "trusted-column-input", "中文提交", expectedEdit(before, "trusted-column-input", 1, 2, 4, "中文提交"), 9);
    assertIdentities(before, committed);
    assert.deepEqual(committed.input.selection.anchor.path, ["trusted-column-input", "trusted-column-left", "trusted-columns"]);
    await historyRoundTrip(state, "columns", before, committed);
    return committed;
  });
  await restartAndFinish(state, after, [{ snapshot: after, candidates: ["候", "候选字"], id: "trusted-column-input" }]);
});

test("packaged trusted composition consumes block shortcuts without ending preedit and restores conversion after commit", { timeout: BUDGETS.lifecycleMs }, async (context) => {
  const state = await compositionCase(context, "shortcuts");
  await plainControl(state, { candidates: ["组", "组合", "组合续"], text: "组合完成" });
  const after = await interactions(state, async () => {
    await selectRange(state, "trusted-shortcut-input", 5);
    const before = await nativeSnapshot(state.handle.page);
    observe(state, "shortcuts-before", before);
    await preedit(state, "shortcuts-preedit-1", "trusted-shortcut-input", "组", expectedEdit(before, "trusted-shortcut-input", 1, 2, 2, "组"), 6);
    await preedit(state, "shortcuts-preedit-2", "trusted-shortcut-input", "组合", expectedEdit(before, "trusted-shortcut-input", 1, 2, 2, "组合"), 7);
    await compositionShortcuts(state, "page-root-preedit-shortcut");
    await preedit(state, "shortcuts-preedit-3", "trusted-shortcut-input", "组合续", expectedEdit(before, "trusted-shortcut-input", 1, 2, 2, "组合续"), 8);
    const committed = await commit(state, "shortcuts-committed", "trusted-shortcut-input", "组合完成", expectedEdit(before, "trusted-shortcut-input", 1, 2, 2, "组合完成"), 9);
    assertIdentities(before, committed);
    await historyRoundTrip(state, "shortcuts", before, committed);
    await state.handle.page.keyboard.press("Control+Alt+3");
    await state.handle.page.waitForFunction((selector) => {
      const root = document.querySelector(selector);
      const editor = root.pmViewDesc.node.type.schema.cached.blockNoteEditor;
      const target = editor.document.find((entry) => entry.id === "trusted-shortcut-input");
      const body = root.querySelector('.bn-block-outer[data-id="trusted-shortcut-input"] .bn-block-content');
      return target?.type === "heading" && target.props.level === 3 && body?.getAttribute("data-content-type") === "heading";
    }, ROOT);
    const converted = await nativeSnapshot(state.handle.page);
    observe(state, "shortcuts-converted-after-commit", converted);
    const target = block(converted.document, "trusted-shortcut-input");
    assert.equal(target.type, "heading");
    assert.equal(target.props.level, 3);
    assert.deepEqual(target.content, block(committed.document, target.id).content);
    assert.deepEqual(target.children, block(committed.document, target.id).children);
    for (const entry of walkBlocks(committed.document)) if (entry.id !== target.id) assert.deepEqual(block(converted.document, entry.id), entry);
    assert.equal(converted.history.undo, committed.history.undo + 1);
    assertIdentities(committed, converted);
    await persisted(state.handle, converted.document);
    await state.handle.page.keyboard.press("Control+z");
    await persisted(state.handle, committed.document);
    const undone = await nativeSnapshot(state.handle.page);
    observe(state, "shortcuts-conversion-undo", undone);
    assert.deepEqual(undone.native, committed.native);
    return committed;
  });
  await restartAndFinish(state, after, [{ snapshot: after, candidates: ["组", "组合", "组合续"], id: "trusted-shortcut-input" }]);
});

test("packaged trusted Chromium composition cancellation restores the marked caret and committed content survives a close restart", { timeout: BUDGETS.lifecycleMs }, async (context) => {
  const state = await compositionCase(context, "cancel");
  await plainControl(state, { candidates: ["取消中", "取消候选"], text: "", cancel: true });
  const result = await interactions(state, async () => {
    await selectRange(state, "trusted-cancel-input", 5);
    const before = await nativeSnapshot(state.handle.page);
    observe(state, "cancel-before", before);
    await preedit(state, "cancel-preedit-1", "trusted-cancel-input", "取消中", expectedEdit(before, "trusted-cancel-input", 1, 2, 2, "取消中"), 8);
    await preedit(state, "cancel-preedit-2", "trusted-cancel-input", "取消候选", expectedEdit(before, "trusted-cancel-input", 1, 2, 2, "取消候选"), 9);
    await sendInput(state, "Input.imeSetComposition", { text: "", selectionStart: 0, selectionEnd: 0 });
    await waitForTextAndCaret(state, "trusted-cancel-input", before, 5, false);
    await persisted(state.handle, before.document);
    const cancelled = await nativeSnapshot(state.handle.page);
    observe(state, "cancelled", cancelled);
    for (const key of ["document", "native", "selection"]) assert.deepEqual(cancelled[key], before[key]);
    assertIdentities(before, cancelled);
    // A separate marked root block gives this isolated case an actual commit
    // to persist. Cancellation history is recorded, not assigned a fake count.
    await selectRange(state, "trusted-root-input", 5);
    const commitBefore = await nativeSnapshot(state.handle.page);
    await preedit(state, "cancel-followup-preedit-1", "trusted-root-input", "成", expectedEdit(commitBefore, "trusted-root-input", 1, 2, 2, "成"), 6);
    await preedit(state, "cancel-followup-preedit-2", "trusted-root-input", "成功", expectedEdit(commitBefore, "trusted-root-input", 1, 2, 2, "成功"), 7);
    const committed = await commit(state, "cancel-followup-committed", "trusted-root-input", "取消后提交", expectedEdit(commitBefore, "trusted-root-input", 1, 2, 2, "取消后提交"), 10);
    assertIdentities(commitBefore, committed);
    await historyRoundTrip(state, "cancel-followup", commitBefore, committed);
    return { cancelled, committed };
  });
  await restartAndFinish(state, result.committed, [{ snapshot: result.cancelled, candidates: ["取消中", "取消候选"], id: "trusted-cancel-input" }, { snapshot: result.committed, candidates: ["成", "成功"], id: "trusted-root-input" }]);
});

async function lockPage(state, locked) {
  const page = state.handle.page;
  await page.getByRole("button", { name: "页面操作", exact: true }).click();
  await page.getByRole("menuitem", { name: locked ? "锁定页面" : "解锁页面", exact: true }).click();
  await page.keyboard.press("Escape");
  await page.getByRole("menu", { name: "页面操作", exact: true }).waitFor({ state: "hidden" });
  assert.equal(await page.getByRole("button", { name: "页面操作", exact: true }).evaluate((element) => element === document.activeElement), true);
  await page.waitForFunction(({ selector, locked }) => { const editor = document.querySelector(selector).pmViewDesc.node.type.schema.cached.blockNoteEditor; return editor.isEditable === !locked && editor.prosemirrorView.editable === !locked; }, { selector: ROOT, locked });
  assert.equal(await page.locator(ROOT).getAttribute("contenteditable"), String(!locked));
  const deadline = Date.now() + BUDGETS.persistenceMs;
  do { if ((await loadedWorkspace(state.handle)).pages.find((entry) => entry.id === PAGE_ID).settings.locked === locked) return; await new Promise((resolve) => setTimeout(resolve, 50)); } while (Date.now() < deadline);
  assert.fail("Page lock setting did not reach SQLite within 6 seconds");
}

test("packaged locked pages reject composition and owned shortcuts then allow trusted input after unlock", { timeout: BUDGETS.lifecycleMs }, async (context) => {
  const state = await compositionCase(context, "lock");
  await plainControl(state, { candidates: ["解", "解锁"], text: "解锁提交" });
  const after = await interactions(state, async () => {
    await lockPage(state, true);
    await content(state.handle.page, "trusted-column-input").click({ position: { x: 6, y: 6 } });
    const locked = await nativeSnapshot(state.handle.page);
    observe(state, "locked-before-input", locked);
    assert.equal(locked.editable, false);
    assert.equal(locked.viewEditable, false);
    assert.equal(await state.handle.page.locator(".life-block-actions, [data-life-column-preview], .life-block-drop-preview").count(), 0);
    await state.handle.page.evaluate(() => { window.__packagedTrustedCompositionV4.reset(); window.__packagedCompositionDispatchV4.begin("locked-app-editor"); });
    state.phase = "locked-app-editor";
    await sendInput(state, "Input.imeSetComposition", { text: "锁定候选", selectionStart: 4, selectionEnd: 4 });
    await sendInput(state, "Input.insertText", { text: "锁定时不应写入" });
    await sendInput(state, "Input.imeSetComposition", { text: "", selectionStart: 0, selectionEnd: 0 });
    for (const chord of ["Control+Alt+3", "Control+d", "Shift+F10", "Control+z", "Control+Shift+z", "Enter", "Backspace"]) {
      state.trace.stimuli.push({ phase: state.phase, method: "keyboard.press", chord });
      await state.handle.page.keyboard.press(chord);
    }
    const attempted = await nativeSnapshot(state.handle.page);
    observe(state, "locked-after-input", attempted);
    for (const key of ["native", "document", "history"]) assert.deepEqual(attempted[key], locked[key]);
    assert.equal(attempted.composing, false);
    assert.equal(attempted.input.active, false);
    assert.equal(await state.handle.page.locator(".life-block-menu, .life-block-conversion-menu, .bn-suggestion-menu").count(), 0);
    await persisted(state.handle, locked.document);
    await lockPage(state, false);
    await selectRange(state, "trusted-column-input", 5);
    const before = await nativeSnapshot(state.handle.page);
    observe(state, "unlocked-before", before);
    await preedit(state, "unlocked-preedit-1", "trusted-column-input", "解", expectedEdit(before, "trusted-column-input", 1, 2, 2, "解"), 6);
    await preedit(state, "unlocked-preedit-2", "trusted-column-input", "解锁", expectedEdit(before, "trusted-column-input", 1, 2, 2, "解锁"), 7);
    const committed = await commit(state, "unlocked-committed", "trusted-column-input", "解锁提交", expectedEdit(before, "trusted-column-input", 1, 2, 2, "解锁提交"), 9);
    assertIdentities(before, committed);
    await historyRoundTrip(state, "unlocked", before, committed);
    return committed;
  });
  await restartAndFinish(state, after, [{ snapshot: after, candidates: ["解", "解锁"], id: "trusted-column-input" }]);
});
});
