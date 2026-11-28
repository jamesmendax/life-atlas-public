import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fullWorkspace } from "../fixtures/full-workspace.mjs";
import { waitForNativeCaretAtBlockEnd } from "../editor-caret.mjs";
import { upgradeWorkspace } from "../../src/persistence/migrations.js";
import { blockContext, copyJson, stableJson, walkBlocks } from "../../src/domain/blockDocument.js";
import { assembleWorkspace, openWorkspaceDatabase, quickCheck, readAllRows } from "../../electron/main/storage/workspaceDb.js";
import { PACKAGED_EXE, REPO_ROOT, assertNoNetworkAndErrors, closeApp, createIsolatedDirectory, launchApp, openPageInSidebar, removeIsolatedDirectory, seedWorkspaceDatabase, shootWindowBothModes } from "./helpers.mjs";

const PAGE_ID = "p-a1";
const FINAL_TEXT = "桌面重启保留的普通正文";
const EVIDENCE_DIR = path.join(REPO_ROOT, ".qa/LOCAL-NOTION-001");
const editorSelector = `.life-editor[data-page-id="${PAGE_ID}"]`;
const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const documentBlocks = (workspace) => workspace.pages.find((entry) => entry.id === PAGE_ID).content;
const block = (blocks, blockId) => walkBlocks(blocks).find((entry) => entry.id === blockId);
const storedBlock = (workspace, blockId) => block(documentBlocks(workspace), blockId);
const outer = (page, blockId) => page.locator(`${editorSelector} > .bn-container .bn-editor .bn-block-outer[data-id="${blockId}"]`).first();
const content = (page, blockId) => outer(page, blockId).locator(":scope > .bn-block > .bn-block-content, :scope > .bn-block > .react-renderer > .bn-block-content").first();

function fixtureWorkspace() {
  const workspace = upgradeWorkspace(fullWorkspace());
  workspace.ui.selectedPageId = PAGE_ID;
  workspace.ui.selectedFolderId = "f-a";
  workspace.ui.preferences = { theme: "system", style: "mobai" };
  workspace.pages.find((entry) => entry.id === PAGE_ID).content = [
    { id: "two", type: "columnList", props: { columns: 2 }, children: [
      { id: "two-left", type: "column", props: { width: 50, index: 0, count: 2 }, children: [
        { id: "heading-one", type: "heading", props: { level: 1 }, content: "桌面分栏标题" },
        { id: "heading-two", type: "heading", props: { level: 2 }, content: "二级标题" },
      ] },
      { id: "two-right", type: "column", props: { width: 50, index: 1, count: 2 }, children: [{ id: "callout", type: "callout", content: "提示内容", props: { icon: "💡", tone: "neutral" } }] },
    ] },
    { id: "root-text", type: "paragraph", content: "已有正文保持可编辑。" },
    { id: "three", type: "columnList", props: { columns: 3 }, children: [
      { id: "three-left", type: "column", props: { width: 50, index: 0, count: 3 }, children: [
        { id: "rich", type: "paragraph", content: [{ type: "text", text: "保留粗体", styles: { bold: true } }, { type: "text", text: " 和 ", styles: {} }, { type: "link", href: "lifeatlas://page/p-z1", content: [{ type: "text", text: "原有链接", styles: { italic: true } }] }], children: [{ id: "rich-child", type: "bulletListItem", content: "子区块保持不变" }] },
        { id: "left-tail", type: "paragraph", content: "左栏正文" },
      ] },
      { id: "three-middle", type: "column", props: { width: 50, index: 1, count: 3 }, children: [{ id: "middle-text", type: "checkListItem", content: "中栏待办", props: { checked: true } }, { id: "middle-tail", type: "paragraph", content: "中栏正文" }] },
      { id: "three-right", type: "column", props: { width: 50, index: 2, count: 3 }, children: [{ id: "right-text", type: "paragraph", content: "右栏正文" }] },
    ] },
    { id: "root-tail", type: "paragraph", content: "页面末尾" },
  ];
  return workspace;
}

function evidence(label, value) {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(path.join(EVIDENCE_DIR, `editor-desktop-v4-${label}.json`), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function ready(handle, firstBlockId = "heading-one") {
  assert.equal(await handle.app.evaluate(({ app }) => app.isPackaged), true, "This regression must run the packaged EXE");
  assert.equal(path.resolve(handle.processOwnership.runtimeDir), path.resolve(handle.dataRoot, "runtime"), "The Chromium profile must stay inside this test's data root");
  const page = handle.page;
  page.setDefaultTimeout(9000);
  await page.locator('html[data-la-ready="1"]').waitFor();
  await page.locator(".workspace-sidebar").waitFor();
  await handle.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 900));
  await page.setViewportSize({ width: 1440, height: 900 });
  await openPageInSidebar(page, "A 概览");
  await content(page, firstBlockId).waitFor();
  await page.waitForFunction((selector) => Boolean(document.querySelector(`${selector} .bn-editor`)?.pmViewDesc?.node?.type?.schema?.cached?.blockNoteEditor), editorSelector);
  await page.evaluate(() => document.fonts.ready.then(() => true));
}

async function editorCase(context, { workspace = fixtureWorkspace(), firstBlockId = "heading-one" } = {}) {
  const dataRoot = createIsolatedDirectory("editor-v4-data");
  const bootstrapDir = createIsolatedDirectory("editor-v4-bootstrap");
  const state = { dataRoot, bootstrapDir, firstBlockId, handle: null, complete: false, directories: new Set([dataRoot, bootstrapDir]) };
  context.after(async () => {
    let closeFailure;
    if (state.handle) {
      try { await closeApp(state.handle, { keepDirs: true }); }
      catch (error) { closeFailure = error; }
    }
    if (!state.complete || closeFailure) console.log(`LIFE_ATLAS_TEST_FAILURE_ROOTS ${JSON.stringify({ test: context.name, directories: [...state.directories] })}`);
    else for (const directory of state.directories) if (fs.existsSync(directory)) removeIsolatedDirectory(directory);
    if (closeFailure) throw closeFailure;
  });
  await seedWorkspaceDatabase(dataRoot, workspace);
  state.handle = await launchApp({ packaged: true, dataRoot, bootstrapDir });
  state.directories.add(state.handle.tempDir);
  await ready(state.handle, firstBlockId);
  return state;
}

async function loadedWorkspace(handle) {
  const result = await handle.page.evaluate(() => window.lifeAtlas.workspace.load());
  assert.equal(result.ok, true, result.error?.message);
  return result.value.workspace;
}

async function persisted(handle, predicate) {
  const deadline = Date.now() + 10000;
  let workspace;
  do {
    workspace = await loadedWorkspace(handle);
    if (predicate(workspace)) return workspace;
    await pause(50);
  } while (Date.now() < deadline);
  assert.fail(`The expected editor mutation did not reach SQLite within 10 seconds: ${JSON.stringify(documentBlocks(workspace))}`);
}

async function nativeSnapshot(page) {
  return page.evaluate((selector) => {
    const editor = document.querySelector(`${selector} .bn-editor`).pmViewDesc.node.type.schema.cached.blockNoteEditor;
    return { document: JSON.parse(JSON.stringify(editor.document)), native: editor.prosemirrorState.doc.toJSON(), selection: editor.prosemirrorState.selection.toJSON() };
  }, editorSelector);
}

async function openConversionMenu(page, blockId) {
  await content(page, blockId).hover();
  const toolbar = page.locator(`.life-block-actions[data-block-id="${blockId}"]`);
  await toolbar.getByRole("button", { name: "区块菜单", exact: true }).click();
  await page.getByRole("menuitem", { name: "转换为", exact: true }).hover();
  await page.locator(".life-block-conversion-menu").getByRole("menuitem", { name: "标题 2", exact: true }).waitFor();
}

async function convertRich(handle) {
  await openConversionMenu(handle.page, "rich");
  await handle.page.locator(".life-block-conversion-menu").getByRole("menuitem", { name: "标题 2", exact: true }).click();
  return persisted(handle, (workspace) => storedBlock(workspace, "rich")?.type === "heading" && storedBlock(workspace, "rich").props.level === 2);
}

async function geometry(page) {
  return page.evaluate((selector) => {
    const root = document.querySelector(`${selector} .bn-editor`);
    const rect = (element) => {
      const bounds = element.getBoundingClientRect();
      return { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height, right: bounds.right, bottom: bounds.bottom };
    };
    const title = rect(document.querySelector(".page-title-input"));
    const first = rect(root.querySelector('.bn-block-outer[data-id="two"]'));
    const rows = { header: { gap: first.top - title.bottom } };
    for (const blockId of ["two", "two-left", "two-right", "heading-one", "heading-two", "callout", "three", "three-left", "three-middle", "three-right", "rich", "rich-child", "middle-text", "right-text"]) {
      const element = root.querySelector(`.bn-block-outer[data-id="${blockId}"]`);
      const body = element.querySelector(":scope > .bn-block > .bn-block-content, :scope > .bn-block > .react-renderer > .bn-block-content");
      const style = getComputedStyle(body);
      const rail = getComputedStyle(element, "::before");
      const group = element.querySelector(":scope > .bn-block > .bn-block-group");
      const firstChild = group?.querySelector(":scope > .bn-block-outer");
      const leading = [];
      for (const child of group?.children || []) {
        if (child === firstChild) break;
        leading.push({ className: child.className, bounds: rect(child) });
      }
      rows[blockId] = { outer: rect(element), content: rect(body), size: style.fontSize, weight: style.fontWeight, lineHeight: style.lineHeight, dataLevel: body.getAttribute("data-level"), rail: { content: rail.content, width: rail.borderLeftWidth }, leading };
    }
    return rows;
  }, editorSelector);
}

async function beginResize(page, delta = 24) {
  await outer(page, "three").scrollIntoViewIfNeeded();
  const resizer = outer(page, "three-left").getByRole("separator", { name: "调整第 1、2 列栏宽", exact: true });
  const bounds = await resizer.boundingBox();
  assert.ok(bounds, "The production column separator must have a real mouse target");
  const start = { x: bounds.x + bounds.width / 2, y: bounds.y + Math.min(bounds.height / 2, 18) };
  assert.equal(await page.evaluate(({ x, y }) => Boolean(document.elementFromPoint(x, y)?.closest(".life-column-resizer")), start), true);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + delta, start.y, { steps: 8 });
  await page.locator(`${editorSelector} [data-life-column-preview="true"]`).first().waitFor();
  assert.equal(await page.locator(`${editorSelector} [data-life-column-preview="true"]`).count(), 2);
}

async function resizeColumns(handle) {
  const original = storedBlock(await loadedWorkspace(handle), "three").children.map((entry) => entry.props.width);
  await beginResize(handle.page);
  await handle.page.mouse.up();
  return persisted(handle, (workspace) => storedBlock(workspace, "three-left")?.props.width !== original[0]);
}

async function restart(state, { inspectClosed } = {}) {
  const previous = state.handle;
  await assertNoNetworkAndErrors(previous);
  await closeApp(previous, { keepDirs: true });
  state.handle = null;
  if (inspectClosed) await inspectClosed();
  removeIsolatedDirectory(previous.tempDir);
  state.directories.delete(previous.tempDir);
  state.handle = await launchApp({ packaged: true, dataRoot: state.dataRoot, bootstrapDir: state.bootstrapDir });
  state.directories.add(state.handle.tempDir);
  await ready(state.handle, state.firstBlockId);
}

test("packaged columns keep readable headings and rich conversion shares native undo redo", { timeout: 60000 }, async (context) => {
  const state = await editorCase(context);
  const { handle } = state;
  const page = handle.page;
  const measured = await geometry(page);
  assert.ok(measured.header.gap >= 0 && measured.header.gap <= 64, `Title to first block gap: ${measured.header.gap}`);
  assert.equal(measured["heading-one"].dataLevel, null);
  assert.equal(measured["heading-one"].size, "30px");
  assert.equal(measured["heading-one"].weight, "600");
  assert.equal(measured["heading-two"].size, "24px");
  assert.equal(measured["heading-two"].weight, "600");
  assert.ok(Math.abs(measured["heading-one"].content.top - measured.callout.content.top) <= 1);
  for (const blockId of ["two", "three", "two-left", "two-right", "three-left", "three-middle", "three-right"]) {
    assert.equal(measured[blockId].content.height, 0, `${blockId} must not add a visible layout row`);
    assert.deepEqual(measured[blockId].leading, [], `${blockId} must not have a leading widget`);
  }
  for (const [columnId, firstId] of [["two-left", "heading-one"], ["two-right", "callout"], ["three-left", "rich"], ["three-middle", "middle-text"], ["three-right", "right-text"]]) assert.ok(Math.abs(measured[columnId].outer.top - measured[firstId].outer.top) <= 1, columnId);
  for (const blockId of ["two-left", "two-right", "heading-one", "heading-two", "callout", "three-left", "three-middle", "three-right", "rich"]) assert.ok(measured[blockId].rail.content === "none" || measured[blockId].rail.width === "0px", blockId);
  assert.ok(measured["rich-child"].content.left > measured.rich.content.left + 20);
  evidence("geometry", measured);
  await shootWindowBothModes(handle, "editor-desktop-v4-columns", { shotsDir: EVIDENCE_DIR });

  await content(page, "rich").scrollIntoViewIfNeeded();
  const beforeHover = await content(page, "rich").boundingBox();
  const before = await nativeSnapshot(page);
  const original = block(before.document, "rich");
  await openConversionMenu(page, "rich");
  assert.deepEqual(await content(page, "rich").boundingBox(), beforeHover, "Hover controls must not move the existing rich content");
  const menu = page.locator(".life-block-conversion-menu");
  assert.equal(await menu.getByRole("menuitem", { name: "标题 2", exact: true }).isDisabled(), false);
  assert.equal(await menu.getByRole("menuitem", { name: "代码", exact: true }).isDisabled(), true);
  await menu.getByRole("menuitem", { name: "标题 2", exact: true }).click();
  const converted = await persisted(handle, (workspace) => storedBlock(workspace, "rich")?.type === "heading" && storedBlock(workspace, "rich").props.level === 2);
  assert.deepEqual(storedBlock(converted, "rich").content, original.content);
  assert.deepEqual(storedBlock(converted, "rich").children, original.children);
  assert.equal(storedBlock(converted, "three-left").children[0].id, "rich");
  const after = await nativeSnapshot(page);
  await page.keyboard.press("Control+z");
  await persisted(handle, (workspace) => storedBlock(workspace, "rich")?.type === "paragraph");
  assert.deepEqual((await nativeSnapshot(page)).native, before.native);
  await page.keyboard.press("Control+Shift+z");
  await persisted(handle, (workspace) => storedBlock(workspace, "rich")?.type === "heading");
  assert.deepEqual((await nativeSnapshot(page)).native, after.native);
  evidence("conversion", { before, after });
  await assertNoNetworkAndErrors(handle);
  state.complete = true;
});

// Packaged counterpart of the frozen browser long-document acceptance. Keep its
// event/frame definitions and budgets; an observed rendering opportunity is not
// a GPU presentation timestamp, and Chromium trusted input is not Windows IME.
const LONGDOC_ROOT = `${editorSelector} .bn-editor`;
const LONGDOC_BUDGETS = { inputP95Ms: 100, nativeCaretP95Ms: 100, scrollFrameP95Ms: 50, wheelResponseP95Ms: 100 };

function longdocColumns(prefix) {
  return { id: prefix, type: "columnList", props: { columns: 3 }, children: [
    { id: `${prefix}-left`, type: "column", props: { width: 40, index: 0, count: 3 }, children: [
      { id: `${prefix}-left-heading`, type: "heading", props: { level: 3 }, content: "研究与资料" },
      { id: `${prefix}-left-rich`, type: "paragraph", content: [
        { type: "text", text: "保留研究结论", styles: { bold: true } },
        { type: "text", text: " 与 ", styles: {} },
        { type: "link", href: "lifeatlas://page/p-z1", content: [{ type: "text", text: "本地项目链接", styles: { italic: true } }] },
      ], children: [{ id: `${prefix}-child`, type: "bulletListItem", content: "完整保留资料子项", children: [{ id: `${prefix}-grandchild`, type: "paragraph", content: "子项内的复核记录" }] }] },
      { id: `${prefix}-left-detail`, type: "paragraph", content: "比较方法、核对来源，再记录下一步。" },
      { id: `${prefix}-left-tail`, type: "paragraph", content: "研究栏保留的最后一段" },
    ] },
    { id: `${prefix}-middle`, type: "column", props: { width: 35, index: 1, count: 3 }, children: [
      { id: `${prefix}-middle-heading`, type: "heading", props: { level: 3 }, content: "本周行动" },
      { id: `${prefix}-middle-check`, type: "checkListItem", props: { checked: true }, content: "已核对本地记录" },
      { id: `${prefix}-middle-detail`, type: "paragraph", content: "逐项验证成果与实际交互。" },
      { id: `${prefix}-middle-target`, type: "paragraph", content: "在这一段之后接收完整资料子树" },
    ] },
    { id: `${prefix}-right`, type: "column", props: { width: 25, index: 2, count: 3 }, children: [
      { id: `${prefix}-right-heading`, type: "heading", props: { level: 3 }, content: "复盘" },
      { id: `${prefix}-right-check`, type: "checkListItem", props: { checked: false }, content: "等待复查" },
      { id: `${prefix}-right-detail`, type: "paragraph", content: "记录限制与未完成的判断。" },
      { id: `${prefix}-right-tail`, type: "paragraph", content: "复盘栏保留的最后一段" },
    ] },
  ] };
}

function longdocFixtureWorkspace() {
  const workspace = fixtureWorkspace();
  const blocks = [{ id: "ld-start", type: "paragraph", content: "长文档开头 · 编辑输入从这里开始。" }];
  for (let section = 0; section < 20; section += 1) {
    const prefix = `ld-section-${section}`;
    blocks.push(
      { id: `${prefix}-heading`, type: "heading", props: { level: 2 }, content: `第 ${section + 1} 节 · 本地工作记录` },
      { id: `${prefix}-lead`, type: "paragraph", content: `第 ${section + 1} 节 · 实验、设计与本地工作记录。` },
      { id: `${prefix}-detail`, type: "paragraph", content: "先记录观察到的结果、所用材料与操作，再把下一步安排写清楚。保留证据来源，使之后的复核能够准确找到原来的内容。" },
      { id: `${prefix}-list`, type: "bulletListItem", content: "有层级的复核清单", children: [
        { id: `${prefix}-child-one`, type: "bulletListItem", content: "检查输入材料与原始事实" },
        { id: `${prefix}-child-two`, type: "bulletListItem", content: "记录后续行动", children: [{ id: `${prefix}-grandchild`, type: "paragraph", content: "说明判断的依据、限制与待验证之处。" }] },
      ] },
      { id: `${prefix}-check-one`, type: "checkListItem", props: { checked: section % 2 === 0 }, content: "整理本节的材料与记录" },
      { id: `${prefix}-check-two`, type: "checkListItem", props: { checked: false }, content: "复核下一次行动是否完成" },
      { id: `${prefix}-quote`, type: "quote", content: "结果需要与原始材料一起保存，便于后续继续工作。" },
      { id: `${prefix}-code`, type: "codeBlock", props: { language: "text" }, content: `section: ${section + 1}\nstate: awaiting-review\nsource: local-record` },
      { id: `${prefix}-sources`, type: "paragraph", content: "资料来源：本节的实验记录、设计说明和本地项目文档。" },
      { id: `${prefix}-decision`, type: "paragraph", content: "决策记录：先验证最重要的事实，再安排适合当前条件的行动。" },
      { id: `${prefix}-risks`, type: "paragraph", content: "待复核事项：区分真实结果与尚未验证的假设，避免把预计完成当成已经完成。" },
      { id: `${prefix}-closing`, type: "paragraph", content: "本节结束后保留正文、清单和代码片段，之后可以继续编辑或移动其中的资料。" },
    );
    if (section === 7) blocks.push(longdocColumns("ld-columns-mid"));
    if (section === 15) blocks.push(longdocColumns("ld-columns-late"));
  }
  blocks.push({ id: "ld-end", type: "paragraph", content: "长文档末尾 · 最后一条正文可继续编辑。" });
  workspace.pages.find((entry) => entry.id === PAGE_ID).content = blocks;
  return workspace;
}

async function longdocFileIdentity(file) {
  const digest = createHash("sha256");
  for await (const bytes of fs.createReadStream(file)) digest.update(bytes);
  return { path: file, size: fs.statSync(file).size, sha256: digest.digest("hex") };
}

function longdocRepositoryFiles(relative) {
  const files = [];
  for (const entry of fs.readdirSync(path.join(REPO_ROOT, relative), { withFileTypes: true })) {
    const child = `${relative}/${entry.name}`;
    if (entry.isDirectory()) files.push(...longdocRepositoryFiles(child));
    else {
      assert.equal(entry.isFile(), true, `Package/source evidence requires a physical ordinary file: ${child}`);
      files.push(child);
    }
  }
  return files;
}

async function longdocPackageIdentity(handle) {
  const runtime = await handle.app.evaluate(({ app }) => ({ packaged: app.isPackaged, version: app.getVersion(), appPath: app.getAppPath(), executablePath: process.execPath, versions: process.versions, pid: process.pid, userData: app.getPath("userData") }));
  assert.equal(runtime.packaged, true);
  assert.equal(runtime.versions.electron, "44.4.5", "The benchmark must use the approved packaged Electron runtime");
  assert.equal(path.resolve(runtime.executablePath), path.resolve(PACKAGED_EXE));
  assert.equal(path.resolve(runtime.userData), path.resolve(handle.dataRoot, "runtime"));
  const archive = path.join(path.dirname(PACKAGED_EXE), "resources/app.asar");
  assert.equal(path.resolve(runtime.appPath), path.resolve(archive));
  assert.equal(handle.page.url(), "app://bundle/index.html", "The measured editor must use the packaged renderer protocol");
  const asar = createRequire(import.meta.url)("@electron/asar");
  const metadata = JSON.parse(asar.extractFile(archive, "package.json").toString("utf8"));
  const sourceMetadata = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));
  assert.equal(metadata.lifeAtlasFlavor, "test");
  assert.equal(metadata.version, sourceMetadata.version);
  assert.equal(runtime.version, sourceMetadata.version);
  const rawSources = longdocRepositoryFiles("src");
  const electronSources = longdocRepositoryFiles("electron");
  const rendererFiles = longdocRepositoryFiles("dist/client");
  for (const entry of ["index.html", "vault.html", "setup.html"]) assert.ok(rendererFiles.includes(`dist/client/${entry}`), `The compiled renderer ${entry} must exist`);
  assert.ok(rendererFiles.some((file) => file.endsWith(".js")), "A fresh renderer bundle must exist");
  // electron-builder intentionally packages raw src/**/*.js, electron/** and
  // compiled dist/client/**. Raw JSX/CSS belong in source provenance only;
  // their running implementation is verified through every compiled file.
  const packagedPaths = new Set([...rawSources.filter((file) => file.endsWith(".js")), ...electronSources, ...rendererFiles]);
  const sourcePaths = [...new Set([...rawSources, ...electronSources, ...rendererFiles, "package.json", "electron-builder.yml", "tests/desktop/editor-interactions-v4.e2e.mjs", "tests/desktop/helpers.mjs", "tests/browser/editor-long-document-v4.mjs", "tests/editor-caret.mjs", "tests/fixtures/full-workspace.mjs"])].sort();
  const sourceFiles = [];
  const packagedFiles = [];
  const revision = createHash("sha256");
  for (const relative of sourcePaths) {
    const identity = await longdocFileIdentity(path.join(REPO_ROOT, relative));
    sourceFiles.push({ ...identity, relative });
    revision.update(`${relative}\0${identity.sha256}\n`);
    if (!packagedPaths.has(relative)) continue;
    const bytes = asar.extractFile(archive, path.normalize(relative));
    const packagedSha256 = createHash("sha256").update(bytes).digest("hex");
    assert.equal(packagedSha256, identity.sha256, `The packaged editor/source/renderer differs from the current freeze: ${relative}`);
    packagedFiles.push({ relative, size: bytes.length, sha256: packagedSha256 });
  }
  // Stream binary hashes before an observation starts; never hash during a
  // typing, wheel, hover, or drag measurement window.
  const files = [];
  for (const file of [PACKAGED_EXE, archive, path.join(path.dirname(PACKAGED_EXE), "THIRD_PARTY_NOTICES.md")]) files.push(await longdocFileIdentity(file));
  const notices = await longdocFileIdentity(path.join(REPO_ROOT, "THIRD_PARTY_NOTICES.md"));
  assert.equal(files[2].sha256, notices.sha256);
  return { runtime, ownership: handle.processOwnership, files, sourceRevisionSha256: revision.digest("hex"), sourceFiles, packagedFiles, version: metadata.version, flavor: metadata.lifeAtlasFlavor };
}

function readClosedLongdocWorkspace(dataRoot) {
  const file = path.join(dataRoot, "workspace.db");
  const database = openWorkspaceDatabase(file, { readOnly: true });
  try {
    assert.equal(quickCheck(database), "ok", "The normally closed long-document SQLite database must pass quick_check");
    return assembleWorkspace(readAllRows(database));
  } finally { database.close(); }
}

async function longdocNativeSnapshot(page) {
  return page.evaluate((selector) => {
    const editor = document.querySelector(selector).pmViewDesc.node.type.schema.cached.blockNoteEditor;
    const state = editor.prosemirrorState;
    const history = state.plugins.find((plugin) => plugin.key.startsWith("history$"))?.getState(state);
    if (!history?.done || !history?.undone) throw new Error("The real native history must be observable");
    return { document: JSON.parse(JSON.stringify(editor.document)), native: state.doc.toJSON(), selection: state.selection.toJSON(), history: { undo: history.done.eventCount, redo: history.undone.eventCount } };
  }, LONGDOC_ROOT);
}

async function observeLongdocReadiness(page, expectedBlocks) {
  await page.evaluate(({ selector, expectedBlocks }) => {
    const measurement = { kind: "post-launch-renderer-readiness", installedAt: performance.now(), readyAt: null, afterFrameAt: null, blockCount: null };
    window.__editorDesktopLongdocV4Load = measurement;
    const inspect = () => {
      const root = document.querySelector(selector);
      if (!root || root.getAttribute("contenteditable") !== "true" || document.fonts.status !== "loaded" || root.querySelectorAll(".bn-block-outer[data-id]").length !== expectedBlocks) {
        requestAnimationFrame(inspect);
        return;
      }
      measurement.readyAt = performance.now();
      requestAnimationFrame(() => setTimeout(() => {
        measurement.afterFrameAt = performance.now();
        measurement.blockCount = root.querySelectorAll(".bn-block-outer[data-id]").length;
      }, 0));
    };
    requestAnimationFrame(inspect);
  }, { selector: LONGDOC_ROOT, expectedBlocks });
  await page.waitForFunction(() => Number.isFinite(window.__editorDesktopLongdocV4Load?.afterFrameAt));
  const measured = await page.evaluate(() => window.__editorDesktopLongdocV4Load);
  assert.equal(measured.blockCount, expectedBlocks);
  assert.ok(measured.installedAt <= measured.readyAt && measured.readyAt <= measured.afterFrameAt);
  return measured;
}

function installDesktopLongdocObservation(selector) {
  const root = document.querySelector(selector);
  const scroller = root?.closest(".workspace-scroll");
  const editor = root?.pmViewDesc?.node.type.schema.cached.blockNoteEditor;
  if (!root || !scroller || !editor) throw new Error("The production editor and workspace scroller must exist");
  const listeners = [];
  const observers = [];
  const pendingFrames = new Set();
  const pendingTasks = new Set();
  let active = null;
  let frameHandle = null;
  const supported = PerformanceObserver.supportedEntryTypes || [];
  const addListener = (target, type, callback, options = true) => {
    target.addEventListener(type, callback, options);
    const capture = typeof options === "boolean" ? options : Boolean(options.capture);
    listeners.push(() => target.removeEventListener(type, callback, capture));
  };
  const append = (buffer, value) => {
    if (buffer.length >= 1024) { active.overflow = true; return; }
    buffer.push(value);
  };
  const afterFrame = (callback) => {
    const frame = requestAnimationFrame(() => {
      pendingFrames.delete(frame);
      const task = setTimeout(() => { pendingTasks.delete(task); callback(); }, 0);
      pendingTasks.add(task);
    });
    pendingFrames.add(frame);
  };
  const pairWheelScroll = (sample, scroll) => {
    if (!sample || !scroll || sample.requestIndex === null || scroll.requestIndex !== sample.requestIndex || scroll.requestMarkedAt !== sample.requestMarkedAt || !scroll.trusted || scroll.scrollTop === sample.beforeTop) return;
    if (sample.pairedScrollIndex !== undefined && sample.pairedScrollIndex !== scroll.index) return;
    if (!Number.isFinite(sample.startedAt) || !Number.isFinite(scroll.eventTimestamp) || sample.startedAt < sample.requestMarkedAt || sample.startedAt > sample.observedAt || scroll.eventTimestamp < sample.startedAt || scroll.observedAt < scroll.eventTimestamp) {
      sample.timingError = "Wheel and scroll timestamps must retain their actual nonnegative request/event/observation order";
      return;
    }
    if (sample.firstScrollMs === null) {
      sample.pairedScrollIndex = scroll.index;
      scroll.pairedWheelIndex = sample.index;
      sample.firstScrollMs = scroll.observedAt - sample.startedAt;
      sample.firstScrollObservedAt = scroll.observedAt;
      sample.firstScrollEventTimestamp = scroll.eventTimestamp;
      sample.scrollObservedBeforeWheel = scroll.observedAt < sample.observedAt;
      sample.wheelCaptureToFirstScrollMs = scroll.observedAt >= sample.observedAt ? scroll.observedAt - sample.observedAt : null;
      sample.afterTop = scroll.scrollTop;
    }
    if (sample.afterFrameMs === null && Number.isFinite(scroll.afterFrameAt)) {
      if (scroll.afterFrameAt < scroll.observedAt || scroll.afterFrameAt < sample.startedAt) {
        sample.timingError = "A real after-frame callback must follow the wheel event and scroll observation";
        return;
      }
      sample.afterFrameAt = scroll.afterFrameAt;
      sample.afterFrameMs = scroll.afterFrameAt - sample.startedAt;
      sample.afterFrameObservedBeforeWheel = scroll.afterFrameAt < sample.observedAt;
      sample.wheelCaptureToAfterFrameMs = scroll.afterFrameAt >= sample.observedAt ? scroll.afterFrameAt - sample.observedAt : null;
    }
  };
  const nativeCaret = (sample) => {
    if (sample.nativeCaretMs !== null) return;
    const selection = editor.prosemirrorState.selection;
    const domSelection = window.getSelection();
    const focus = domSelection?.focusNode;
    const owner = (focus?.nodeType === Node.ELEMENT_NODE ? focus : focus?.parentElement)?.closest(".bn-block-outer[data-id]");
    if (selection.empty && selection.head === sample.headBefore + sample.data.length && domSelection?.isCollapsed && owner?.dataset.id === sample.blockId && editor.prosemirrorView.hasFocus()) {
      sample.nativeCaretMs = performance.now() - sample.startedAt;
      sample.headAfter = selection.head;
      sample.domCaretBlockId = owner.dataset.id;
    }
  };
  addListener(root, "beforeinput", (event) => {
    if (active?.kind !== "input" || event.inputType !== "insertText") return;
    const selection = editor.prosemirrorState.selection;
    const domSelection = window.getSelection();
    const focus = domSelection?.focusNode;
    const owner = (focus?.nodeType === Node.ELEMENT_NODE ? focus : focus?.parentElement)?.closest(".bn-block-outer[data-id]");
    append(active.inputs, { startedAt: performance.now(), eventTimestamp: event.timeStamp, beforeInputTrusted: event.isTrusted, data: event.data || "", blockId: owner?.dataset.id, headBefore: selection.head, nativeCaretMs: null, afterFrameMs: null, inputCaptureMicrotaskToAfterFrameMs: null });
  });
  addListener(root, "input", (event) => {
    if (active?.kind !== "input") return;
    const sample = active.inputs.findLast((entry) => entry.inputAt === undefined);
    if (!sample) { active.unpairedInputs += 1; return; }
    sample.inputAt = performance.now();
    sample.inputTrusted = event.isTrusted;
    queueMicrotask(() => {
      sample.inputCaptureMicrotaskAt = performance.now();
      nativeCaret(sample);
      afterFrame(() => {
        nativeCaret(sample);
        sample.afterFrameMs = performance.now() - sample.startedAt;
        sample.inputCaptureToAfterFrameMs = performance.now() - sample.inputAt;
        sample.inputCaptureMicrotaskToAfterFrameMs = performance.now() - sample.inputCaptureMicrotaskAt;
      });
    });
  });
  addListener(root, "keydown", (event) => {
    if (active?.kind === "input" && event.key.length === 1) append(active.keys, { key: event.key, trusted: event.isTrusted, startedAt: performance.now() });
  });
  addListener(scroller, "wheel", (event) => {
    if (active?.kind !== "scroll") return;
    const observedAt = performance.now();
    const request = active.pendingWheel;
    active.lastWheelAt = event.timeStamp;
    const sample = { index: active.wheels.length, requestIndex: request?.index ?? null, startedAt: event.timeStamp, eventTimestamp: event.timeStamp, observedAt, captureDelayMs: observedAt >= event.timeStamp ? observedAt - event.timeStamp : null, trusted: event.isTrusted, deltaY: event.deltaY, deltaX: event.deltaX, deltaMode: event.deltaMode, cancelable: event.cancelable, defaultPrevented: event.defaultPrevented, beforeTop: request?.initial.top ?? null, observedAtTop: scroller.scrollTop, requestMarkedAt: request?.markedAt ?? null, requestInitialTop: request?.initial.top ?? null, precedingFrameAt: active.previousFrameAt, precedingFrameTop: active.previousTop, precedingScrollAt: active.lastScrollAt, firstScrollMs: null, afterFrameMs: null };
    append(active.wheels, sample);
    const scroll = active.scrollEvents.find((entry) => entry.requestIndex === sample.requestIndex && entry.requestMarkedAt === sample.requestMarkedAt && entry.eventTimestamp >= sample.eventTimestamp && entry.scrollTop !== sample.beforeTop);
    pairWheelScroll(sample, scroll);
  }, { capture: true, passive: true });
  addListener(scroller, "scroll", (event) => {
    if (active?.kind !== "scroll") return;
    active.lastScrollAt = performance.now();
    const request = active.pendingWheel;
    const sample = active.wheels.find((entry) => entry.requestIndex === request?.index && entry.requestMarkedAt === request?.markedAt);
    const scroll = { index: active.scrollEvents.length, observedAt: active.lastScrollAt, eventTimestamp: event.timeStamp, trusted: event.isTrusted, scrollTop: scroller.scrollTop, requestIndex: request?.index ?? null, requestMarkedAt: request?.markedAt ?? null, requestInitialTop: request?.initial.top ?? null, wheelCount: active.wheels.length, candidateWheelIndex: sample?.index ?? null, candidateBeforeTop: sample?.beforeTop ?? null, candidateObservedAt: sample?.observedAt ?? null, differsFromCandidateTop: Boolean(sample) && scroller.scrollTop !== sample.beforeTop, differsFromRequestTop: Boolean(request) && scroller.scrollTop !== request.initial.top, precedingFrameAt: active.previousFrameAt, precedingFrameTop: active.previousTop, afterFrameAt: null };
    append(active.scrollEvents, scroll);
    if (!request || !scroll.differsFromRequestTop || scroll.eventTimestamp < request.markedAt) return;
    pairWheelScroll(sample, scroll);
    afterFrame(() => {
      scroll.afterFrameAt = performance.now();
      const deliveredWheel = active?.wheels.find((entry) => entry.requestIndex === scroll.requestIndex && entry.requestMarkedAt === scroll.requestMarkedAt);
      pairWheelScroll(deliveredWheel, scroll);
    });
  });
  addListener(root, "pointermove", (event) => {
    if (active?.kind !== "hover" || event.buttons) return;
    const owner = event.target instanceof Element ? event.target.closest(".bn-block-outer[data-id]") : null;
    if (!owner || owner.dataset.id === active.lastHoveredId) return;
    active.lastHoveredId = owner.dataset.id;
    const sample = { blockId: owner.dataset.id, startedAt: performance.now(), trusted: event.isTrusted, controlAfterFrameMs: null };
    append(active.hovers, sample);
    const inspect = () => afterFrame(() => {
      const toolbar = document.querySelector(`.life-block-actions[data-block-id="${CSS.escape(sample.blockId)}"]`);
      if (toolbar && toolbar.getBoundingClientRect().width > 0 && getComputedStyle(toolbar).visibility !== "hidden") sample.controlAfterFrameMs = performance.now() - sample.startedAt;
      else if (performance.now() - sample.startedAt < 1000) inspect();
    });
    inspect();
  });
  addListener(document, "dragstart", (event) => {
    if (active?.kind === "drag" && event.target instanceof Element && event.target.closest(".life-block-actions")) append(active.dragEvents, { type: event.type, trusted: event.isTrusted, at: performance.now() });
  });
  addListener(root, "dragover", (event) => {
    if (active?.kind !== "drag") return;
    active.lastDragOverAt = performance.now();
    const sample = { startedAt: active.lastDragOverAt, trusted: event.isTrusted, clientX: event.clientX, clientY: event.clientY, previewAfterFrameMs: null, previewKind: null };
    append(active.dragOvers, sample);
    afterFrame(() => {
      const preview = document.querySelector(".life-block-drop-preview");
      if (preview) { sample.previewAfterFrameMs = performance.now() - sample.startedAt; sample.previewKind = preview.dataset.dropKind; }
    });
  });
  addListener(document, "drop", (event) => {
    if (active?.kind === "drag" && root.contains(event.target)) append(active.dragEvents, { type: event.type, trusted: event.isTrusted, at: performance.now() });
  });
  const observe = (type, consume, options = {}) => {
    if (!supported.includes(type)) return;
    const observer = new PerformanceObserver((list) => consume(list.getEntries()));
    observer.observe({ type, buffered: false, ...options });
    observers.push({ observer, consume });
  };
  observe("longtask", (entries) => {
    if (!active) return;
    for (const entry of entries) if (entry.startTime >= active.startedAt) append(active.longTasks, { startedAt: entry.startTime, durationMs: entry.duration });
  });
  observe("event", (entries) => {
    if (active?.kind !== "input") return;
    for (const entry of entries) {
      if (entry.startTime < active.startedAt || !["keydown", "keyup", "beforeinput", "input"].includes(entry.name)) continue;
      append(active.eventTiming, { name: entry.name, startTime: entry.startTime, durationMs: entry.duration, processingStart: entry.processingStart, processingEnd: entry.processingEnd, processingDelayMs: entry.processingStart - entry.startTime, handlerMs: entry.processingEnd - entry.processingStart, handlerToNextPaintMs: entry.startTime + entry.duration - entry.processingEnd, interactionId: entry.interactionId });
    }
  }, { durationThreshold: 16 });
  const frame = (timestamp) => {
    if (!active) return;
    const top = scroller.scrollTop;
    const interactionAt = active.kind === "scroll" ? active.lastWheelAt : active.kind === "drag" ? active.lastDragOverAt : null;
    const windowIntersectsInterval = Number.isFinite(interactionAt) && active.previousFrameAt !== null && active.previousFrameAt <= interactionAt + 200 && timestamp >= interactionAt;
    const scrolled = active.kind === "scroll" && top !== active.previousTop;
    if (active.previousFrameAt !== null && (windowIntersectsInterval || active.previousFrameActive || scrolled)) append(active.frames, { from: active.previousFrameAt, at: timestamp, intervalMs: timestamp - active.previousFrameAt, scrollTop: top });
    active.previousFrameActive = scrolled || (Number.isFinite(interactionAt) && timestamp >= interactionAt && timestamp <= interactionAt + 200);
    active.previousFrameAt = timestamp;
    active.previousTop = top;
    frameHandle = requestAnimationFrame(frame);
  };
  window.__editorDesktopLongdocV4Probe = {
    supported: { eventTiming: supported.includes("event"), longTask: supported.includes("longtask") },
    start(label, kind) {
      if (active) throw new Error("An observation window is already active");
      active = { label, kind, startedAt: performance.now(), inputs: [], keys: [], wheels: [], scrollEvents: [], frames: [], hovers: [], dragEvents: [], dragOvers: [], longTasks: [], eventTiming: [], overflow: false, unpairedInputs: 0, pendingWheel: null, previousFrameAt: null, previousFrameActive: false, previousTop: scroller.scrollTop, lastWheelAt: -Infinity, lastDragOverAt: -Infinity, lastScrollAt: performance.now(), lastHoveredId: null };
      frameHandle = requestAnimationFrame(frame);
    },
    pending() { return pendingFrames.size + pendingTasks.size; },
    current() { return active; },
    finish() {
      for (const { observer, consume } of observers) consume(observer.takeRecords());
      if (pendingFrames.size || pendingTasks.size) throw new Error("Every scheduled after-frame callback must finish before a sample is accepted");
      cancelAnimationFrame(frameHandle);
      active.completedAt = performance.now();
      const result = JSON.parse(JSON.stringify(active));
      active = null;
      return result;
    },
    dispose() {
      cancelAnimationFrame(frameHandle);
      for (const frame of pendingFrames) cancelAnimationFrame(frame);
      for (const task of pendingTasks) clearTimeout(task);
      for (const remove of listeners) remove();
      for (const { observer } of observers) observer.disconnect();
      delete window.__editorDesktopLongdocV4Probe;
    },
  };
}

const longdocText = (entry) => typeof entry?.content === "string" ? entry.content : (entry?.content || []).map((part) => part.type === "link" ? part.content.map((inline) => inline.text || "").join("") : part.text || "").join("");
const longdocSummary = (values) => {
  const ordered = [...values].filter(Number.isFinite).sort((first, second) => first - second);
  if (!ordered.length) return { count: 0, p50: null, p95: null, max: null };
  return { count: ordered.length, p50: ordered[Math.ceil(ordered.length * 0.5) - 1], p95: ordered[Math.ceil(ordered.length * 0.95) - 1], max: ordered.at(-1) };
};

async function startDesktopLongdocObservation(page, label, kind) {
  await page.evaluate(({ label, kind }) => window.__editorDesktopLongdocV4Probe.start(label, kind), { label, kind });
}

async function finishDesktopLongdocObservation(page) {
  await page.waitForFunction(() => window.__editorDesktopLongdocV4Probe.pending() === 0);
  const result = await page.evaluate(() => window.__editorDesktopLongdocV4Probe.finish());
  assert.equal(result.overflow, false, "The measurement buffers must not overflow");
  return result;
}

function assertLongdocTypingSamples(observed, blockId, suffix) {
  assert.equal(observed.inputs.length, suffix.length);
  assert.equal(observed.keys.length, suffix.length);
  assert.equal(observed.unpairedInputs, 0);
  assert.ok(observed.keys.every((entry) => entry.trusted));
  assert.equal(observed.keys.map((entry) => entry.key).join(""), suffix);
  assert.equal(observed.inputs.map((entry) => entry.data).join(""), suffix);
  assert.ok(observed.inputs.every((entry) => entry.beforeInputTrusted && entry.inputTrusted && entry.blockId === blockId && entry.domCaretBlockId === blockId && Number.isFinite(entry.nativeCaretMs) && entry.nativeCaretMs >= 0 && Number.isFinite(entry.afterFrameMs) && entry.afterFrameMs >= entry.nativeCaretMs));
  const summary = { beforeInputToAfterFrameMs: longdocSummary(observed.inputs.map((entry) => entry.afterFrameMs)), nativeCaretMs: longdocSummary(observed.inputs.map((entry) => entry.nativeCaretMs)), browserEventTiming: longdocSummary(observed.eventTiming.map((entry) => entry.durationMs)) };
  assert.equal(summary.beforeInputToAfterFrameMs.count, suffix.length);
  assert.equal(summary.nativeCaretMs.count, suffix.length);
  assert.ok(Number.isFinite(summary.beforeInputToAfterFrameMs.p95) && summary.beforeInputToAfterFrameMs.p95 <= LONGDOC_BUDGETS.inputP95Ms, `${blockId} trusted input p95: ${summary.beforeInputToAfterFrameMs.p95} ms`);
  assert.ok(Number.isFinite(summary.nativeCaretMs.p95) && summary.nativeCaretMs.p95 <= LONGDOC_BUDGETS.nativeCaretP95Ms, `${blockId} native caret p95: ${summary.nativeCaretMs.p95} ms`);
  return summary;
}

async function assertLongdocCaretVisible(page) {
  const caret = await page.evaluate((selector) => {
    const root = document.querySelector(selector);
    const editor = root.pmViewDesc.node.type.schema.cached.blockNoteEditor;
    const bounds = editor.prosemirrorView.coordsAtPos(editor.prosemirrorState.selection.head);
    const viewport = root.closest(".workspace-scroll").getBoundingClientRect();
    const selection = editor.prosemirrorState.selection;
    const domSelection = window.getSelection();
    const focus = domSelection?.focusNode;
    const owner = (focus?.nodeType === Node.ELEMENT_NODE ? focus : focus?.parentElement)?.closest(".bn-block-outer[data-id]");
    return { focused: editor.prosemirrorView.hasFocus(), blockId: editor.getTextCursorPosition().block.id, domCaretBlockId: owner?.dataset.id, collapsed: domSelection?.isCollapsed, headOffset: selection.$head.parentOffset, top: bounds.top, bottom: bounds.bottom, viewportTop: viewport.top, viewportBottom: viewport.bottom };
  }, LONGDOC_ROOT);
  assert.equal(caret.focused, true);
  assert.ok(caret.top >= caret.viewportTop && caret.bottom <= caret.viewportBottom, "The real native caret must remain visible");
  return caret;
}

async function longdocScrollGeometry(page) {
  return page.locator(".workspace-scroll").evaluate((element) => ({ top: element.scrollTop, height: element.clientHeight, extent: element.scrollHeight, maximum: element.scrollHeight - element.clientHeight }));
}

async function longdocBlockGeometry(page, blockIds) {
  return page.evaluate(({ selector, blockIds }) => {
    const root = document.querySelector(selector);
    const scroller = root.closest(".workspace-scroll");
    const rows = {};
    for (const blockId of blockIds) {
      const outer = root.querySelector(`.bn-block-outer[data-id="${blockId}"]`);
      const content = outer.querySelector(":scope > .bn-block > .bn-block-content, :scope > .bn-block > .react-renderer > .bn-block-content");
      rows[blockId] = [outer, content].map((element) => { const bounds = element.getBoundingClientRect(); return { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height }; });
    }
    return { rows, scrollTop: scroller.scrollTop, scrollHeight: scroller.scrollHeight };
  }, { selector: LONGDOC_ROOT, blockIds });
}

test("packaged paired resize previews stay out of SQLite and Escape adds no history", { timeout: 60000 }, async (context) => {
  const state = await editorCase(context);
  const { handle } = state;
  const page = handle.page;
  await content(page, "root-text").click();
  const before = await nativeSnapshot(page);
  const savedBefore = documentBlocks(await loadedWorkspace(handle));
  const thirdWidth = (await outer(page, "three-right").boundingBox()).width;
  await beginResize(page);
  assert.deepEqual((await nativeSnapshot(page)).native, before.native);
  assert.deepEqual(documentBlocks(await loadedWorkspace(handle)), savedBefore);
  await page.mouse.up();
  const resized = await persisted(handle, (workspace) => storedBlock(workspace, "three-left")?.props.width !== 50);
  const widths = storedBlock(resized, "three").children.map((entry) => entry.props.width);
  assert.ok(widths[0] > 50 && widths[1] < 50);
  assert.ok(Math.abs(widths[0] + widths[1] - 100) < 1e-8);
  assert.equal(widths[2], 50);
  assert.ok(Math.abs((await outer(page, "three-right").boundingBox()).width - thirdWidth) <= 1);
  const after = await nativeSnapshot(page);
  await content(page, "root-tail").click();
  await page.keyboard.press("Control+z");
  await persisted(handle, (workspace) => storedBlock(workspace, "three-left")?.props.width === 50);
  assert.deepEqual((await nativeSnapshot(page)).native, before.native);
  await page.keyboard.press("Control+Shift+z");
  await persisted(handle, (workspace) => storedBlock(workspace, "three-left")?.props.width === widths[0]);
  assert.deepEqual((await nativeSnapshot(page)).native, after.native);

  await beginResize(page, 32);
  assert.deepEqual((await nativeSnapshot(page)).native, after.native);
  assert.deepEqual(documentBlocks(await loadedWorkspace(handle)), after.document);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  assert.equal(await page.locator(`${editorSelector} [data-life-column-preview]`).count(), 0);
  assert.deepEqual((await nativeSnapshot(page)).native, after.native);
  await content(page, "root-tail").click();
  await page.keyboard.press("Control+z");
  await persisted(handle, (workspace) => storedBlock(workspace, "three-left")?.props.width === 50);
  assert.deepEqual((await nativeSnapshot(page)).native, before.native);
  await page.keyboard.press("Control+Shift+z");
  await persisted(handle, (workspace) => storedBlock(workspace, "three-left")?.props.width === widths[0]);
  assert.deepEqual((await nativeSnapshot(page)).native, after.native);
  evidence("resize", { before, after, widths, thirdWidth });
  await shootWindowBothModes(handle, "editor-desktop-v4-resized", { shotsDir: EVIDENCE_DIR });
  await assertNoNetworkAndErrors(handle);
  state.complete = true;
});

test("packaged trusted rich dragging and resized plain text survive a close restart", { timeout: 90000 }, async (context) => {
  const state = await editorCase(context);
  let { handle } = state;
  const page = handle.page;
  await convertRich(handle);
  await resizeColumns(handle);
  await content(page, "rich").hover();
  const beforeDrag = await nativeSnapshot(page);
  const original = block(beforeDrag.document, "rich");
  await page.evaluate(() => {
    window.__editorDesktopV4DragTrace = [];
    for (const type of ["dragstart", "dragover", "drop", "dragend"]) document.addEventListener(type, (event) => {
      if (window.__editorDesktopV4DragTrace.length >= 40 && !["drop", "dragend"].includes(event.type)) return;
      window.__editorDesktopV4DragTrace.push({ type: event.type, trusted: event.isTrusted, blockId: event.target.closest?.(".life-block-actions")?.dataset.blockId || event.target.closest?.(".bn-block-outer")?.dataset.id });
    }, true);
  });
  const dragHandle = page.locator('.life-block-actions[data-block-id="rich"] .life-block-handle');
  const target = content(page, "middle-tail");
  const targetBounds = await target.boundingBox();
  assert.ok(targetBounds);
  await dragHandle.dragTo(target, { targetPosition: { x: targetBounds.width / 2, y: targetBounds.height - 2 } });
  const moved = await persisted(handle, (workspace) => storedBlock(workspace, "three-middle")?.children.some((entry) => entry.id === "rich"));
  const dragTrace = await page.evaluate(() => window.__editorDesktopV4DragTrace);
  evidence("drag-trace", dragTrace);
  assert.ok(dragTrace.some((entry) => entry.type === "dragstart" && entry.trusted && entry.blockId === "rich"));
  assert.ok(dragTrace.some((entry) => entry.type === "drop" && entry.trusted));
  assert.deepEqual(storedBlock(moved, "rich"), original);
  assert.deepEqual(storedBlock(moved, "three-left").children.map((entry) => entry.id), ["left-tail"]);
  assert.deepEqual(storedBlock(moved, "three-middle").children.map((entry) => entry.id), ["middle-text", "middle-tail", "rich"]);
  assert.equal(walkBlocks(documentBlocks(moved)).filter((entry) => entry.id === "rich" || entry.id === "rich-child").length, 2);
  const afterDrag = await nativeSnapshot(page);
  await page.keyboard.press("Control+z");
  await persisted(handle, (workspace) => storedBlock(workspace, "three-left")?.children[0]?.id === "rich");
  assert.deepEqual((await nativeSnapshot(page)).native, beforeDrag.native);
  await page.keyboard.press("Control+Shift+z");
  await persisted(handle, (workspace) => storedBlock(workspace, "three-middle")?.children.at(-1)?.id === "rich");
  assert.deepEqual((await nativeSnapshot(page)).native, afterDrag.native);

  await page.locator(`${editorSelector} .life-layout-trailing[data-layout-owner="root"]`).click();
  await page.keyboard.insertText(FINAL_TEXT);
  const beforeRestart = await persisted(handle, (workspace) => {
    const last = documentBlocks(workspace).at(-1);
    return storedBlock(workspace, "three-middle")?.children.at(-1)?.id === "rich" && Array.isArray(last?.content) && last.content.some((entry) => entry.text === FINAL_TEXT);
  });
  const finalParagraph = documentBlocks(beforeRestart).at(-1);
  assert.equal(finalParagraph.type, "paragraph");
  assert.deepEqual(finalParagraph.content, [{ type: "text", text: FINAL_TEXT, styles: {} }]);
  assert.deepEqual(finalParagraph.children, []);
  const finalSnapshot = await nativeSnapshot(page);
  assert.deepEqual(finalSnapshot.document, documentBlocks(beforeRestart));
  await restart(state);
  handle = state.handle;
  const afterRestart = await loadedWorkspace(handle);
  assert.deepEqual(documentBlocks(afterRestart), documentBlocks(beforeRestart));
  assert.deepEqual((await nativeSnapshot(handle.page)).native, finalSnapshot.native);
  assert.deepEqual(storedBlock(afterRestart, "three").children.map((entry) => entry.props.width), storedBlock(beforeRestart, "three").children.map((entry) => entry.props.width));
  assert.deepEqual(storedBlock(afterRestart, "three-middle").children.map((entry) => entry.id), ["middle-text", "middle-tail", "rich"]);
  assert.deepEqual(storedBlock(afterRestart, "rich"), original);
  await content(handle.page, finalParagraph.id).getByText(FINAL_TEXT, { exact: true }).waitFor();
  await content(handle.page, "rich").locator('a[href="lifeatlas://page/p-z1"]').waitFor();
  assert.equal(await outer(handle.page, "three-middle").locator('.bn-block-outer[data-id="rich"]').count(), 1);
  evidence("restart", { dataRoot: state.dataRoot, bootstrapDir: state.bootstrapDir, beforeDrag, afterDrag, beforeRestart: finalSnapshot, afterRestart: await nativeSnapshot(handle.page) });
  await shootWindowBothModes(handle, "editor-desktop-v4-restarted", { shotsDir: EVIDENCE_DIR });
  await assertNoNetworkAndErrors(handle);
  state.complete = true;
});

test("packaged long document keeps trusted input wheel drag budgets and exact SQLite content across close restart", { timeout: 90000 }, async (context) => {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const outputDirectory = fs.mkdtempSync(path.join(EVIDENCE_DIR, "editor-desktop-v4-longdoc-"));
  const metricsFile = path.join(outputDirectory, "metrics.json");
  const workspace = longdocFixtureWorkspace();
  const fixtureExpected = copyJson(documentBlocks(workspace));
  const fixtureBlocks = walkBlocks(fixtureExpected);
  const fixtureIds = fixtureBlocks.map((entry) => entry.id);
  const metrics = {
    status: "running", test: context.name, outputDirectory,
    browserReference: { path: "tests/browser/editor-long-document-v4.mjs", authoredFromSha256: "A808E4649EE04A6B75D3F041AF2D53D98342215A67D7783F3F7CAB8A6A969603" },
    fixture: { blocks: fixtureIds.length, sections: 20, threeColumnGroups: 2, pageId: PAGE_ID, localLinkTarget: "p-z1" },
    budgets: LONGDOC_BUDGETS, completedStages: [], measurements: {},
  };
  let state;
  let failure;
  const publish = () => fs.writeFileSync(metricsFile, `${JSON.stringify(metrics, null, 2)}\n`, "utf8");
  const record = (label, value) => { metrics.measurements[label] = value; publish(); };
  const stage = async (label, callback) => {
    metrics.activeStage = label;
    publish();
    await callback();
    metrics.completedStages.push(label);
    publish();
    console.log(`LIFE_ATLAS_TEST_LONGDOC_STAGE ${JSON.stringify({ label, outputDirectory })}`);
  };
  const shot = async (label, animations = "disabled") => {
    const file = path.join(outputDirectory, `${label}.png`);
    await state.handle.page.screenshot({ path: file, fullPage: false, animations });
    return file;
  };
  const waitForDocument = (expected) => {
    const json = stableJson(expected);
    return persisted(state.handle, (value) => stableJson(documentBlocks(value)) === json);
  };
  console.log(`LIFE_ATLAS_TEST_LONGDOC_EVIDENCE ${JSON.stringify({ test: context.name, outputDirectory, metricsFile })}`);
  publish();
  try {
    assert.equal(fixtureIds.length, 338);
    assert.equal(new Set(fixtureIds).size, fixtureIds.length);
    state = await editorCase(context, { workspace, firstBlockId: "ld-start" });
    metrics.dataRoot = state.dataRoot;
    metrics.bootstrapDir = state.bootstrapDir;
    const page = state.handle.page;
    let firstIdentity;

    await stage("load", async () => {
      firstIdentity = await longdocPackageIdentity(state.handle);
      record("identity", firstIdentity);
      const readiness = await observeLongdocReadiness(page, fixtureIds.length);
      const snapshot = await longdocNativeSnapshot(page);
      assert.deepEqual(walkBlocks(snapshot.document).map((entry) => entry.id), fixtureIds);
      assert.deepEqual(snapshot.document.map((entry) => entry.id), fixtureExpected.map((entry) => entry.id));
      for (const original of fixtureBlocks) {
        const rendered = block(snapshot.document, original.id);
        assert.ok(rendered, original.id);
        assert.equal(rendered.type, original.type, original.id);
        assert.equal(longdocText(rendered), longdocText(original), original.id);
        for (const [property, expected] of Object.entries(original.props || {})) assert.deepEqual(rendered.props?.[property], expected, `${original.id} explicit property ${property}`);
        if (original.content !== undefined) {
          const expectedContent = typeof original.content === "string" ? original.content ? [{ type: "text", text: original.content, styles: {} }] : [] : copyJson(original.content);
          assert.deepEqual(rendered.content, expectedContent, `${original.id} exact inline text, marks and links`);
        }
        assert.deepEqual((rendered.children || []).map((entry) => entry.id), (original.children || []).map((entry) => entry.id), `${original.id} direct child order`);
        assert.equal(blockContext(snapshot.document, original.id).parent?.id ?? null, blockContext(fixtureExpected, original.id).parent?.id ?? null, `${original.id} original parent`);
      }
      assert.deepEqual(await page.locator(LONGDOC_ROOT).locator(".bn-block-outer[data-id]").evaluateAll((elements) => elements.map((element) => element.dataset.id)), fixtureIds);
      const scroller = await longdocScrollGeometry(page);
      assert.ok(scroller.maximum > scroller.height * 10, "The actual EXE document must extend over ten viewport heights");
      await shootWindowBothModes(state.handle, "longdoc-loaded", { shotsDir: outputDirectory });
      record("load", { readiness, scroller, snapshot, screenshots: [path.join(outputDirectory, "longdoc-loaded-light.png"), path.join(outputDirectory, "longdoc-loaded-dark.png")] });
      await page.evaluate(installDesktopLongdocObservation, LONGDOC_ROOT);
      const supported = await page.evaluate(() => window.__editorDesktopLongdocV4Probe.supported);
      assert.deepEqual(supported, { eventTiming: true, longTask: true }, "The EXE benchmark requires real Event Timing and Long Task support");
      record("observerSupport", supported);
      await assertNoNetworkAndErrors(state.handle);
    });

    await stage("typing", async () => {
      const samples = [];
      const eventTiming = [];
      for (const [position, blockId] of [["start", "ld-start"], ["middle", "ld-section-10-lead"], ["end", "ld-end"]]) {
        await content(page, blockId).click();
        await page.keyboard.press("End");
        await waitForNativeCaretAtBlockEnd(page, LONGDOC_ROOT, blockId);
        const before = await longdocNativeSnapshot(page);
        const suffix = ` local-${position}-v4-012345`;
        const expectedText = `${longdocText(block(before.document, blockId))}${suffix}`;
        await startDesktopLongdocObservation(page, `typing-${position}`, "input");
        await page.keyboard.type(suffix, { delay: 60 });
        const observed = await finishDesktopLongdocObservation(page);
        // Publish raw samples before assertions so a missing or slow event is
        // retained as red evidence rather than replaced by a summary value.
        record(`typing-${position}`, { observed, before });
        const summary = assertLongdocTypingSamples(observed, blockId, suffix);
        const after = await longdocNativeSnapshot(page);
        assert.equal(after.selection.anchor, before.selection.anchor + suffix.length);
        assert.equal(after.selection.head, after.selection.anchor);
        assert.equal(longdocText(block(after.document, blockId)), expectedText);
        assert.deepEqual(block(after.document, blockId).content, [{ type: "text", text: expectedText, styles: {} }]);
        const expected = copyJson(before.document);
        block(expected, blockId).content = copyJson(block(after.document, blockId).content);
        assert.deepEqual(after.document, expected, "Only the targeted inline content may change during native typing");
        assert.equal(after.history.undo, before.history.undo + 1, "Each native typing burst must be one undo event");
        await waitForDocument(after.document);
        await page.keyboard.press("Control+z");
        await waitForDocument(before.document);
        const undone = await longdocNativeSnapshot(page);
        assert.deepEqual(undone.native, before.native);
        assert.deepEqual(undone.selection, before.selection);
        await page.keyboard.press("Control+Shift+z");
        await waitForDocument(after.document);
        const redone = await longdocNativeSnapshot(page);
        assert.deepEqual(redone.native, after.native);
        assert.deepEqual(redone.selection, after.selection);
        const caret = await assertLongdocCaretVisible(page);
        record(`typing-${position}`, { observed, summary, before, after, undone, redone, caret, screenshot: await shot(`typing-${position}`) });
        samples.push(...observed.inputs);
        eventTiming.push(...observed.eventTiming);
      }
      const summary = { beforeInputToAfterFrameMs: longdocSummary(samples.map((entry) => entry.afterFrameMs)), inputCaptureToAfterFrameMs: longdocSummary(samples.map((entry) => entry.inputCaptureToAfterFrameMs)), inputCaptureMicrotaskToAfterFrameMs: longdocSummary(samples.map((entry) => entry.inputCaptureMicrotaskToAfterFrameMs)), nativeCaretMs: longdocSummary(samples.map((entry) => entry.nativeCaretMs)), browserEventTiming: { eventToNextPaintMs: longdocSummary(eventTiming.map((entry) => entry.durationMs)), handlerMs: longdocSummary(eventTiming.map((entry) => entry.handlerMs)), handlerToNextPaintMs: longdocSummary(eventTiming.map((entry) => entry.handlerToNextPaintMs)) } };
      record("typingSummary", summary);
      assert.equal(summary.beforeInputToAfterFrameMs.count, samples.length);
      assert.equal(summary.nativeCaretMs.count, samples.length);
      assert.ok(Number.isFinite(summary.beforeInputToAfterFrameMs.p95) && summary.beforeInputToAfterFrameMs.p95 <= LONGDOC_BUDGETS.inputP95Ms);
      assert.ok(Number.isFinite(summary.nativeCaretMs.p95) && summary.nativeCaretMs.p95 <= LONGDOC_BUDGETS.nativeCaretP95Ms);
    });

    await stage("scroll", async () => {
      const bounds = await page.locator(".workspace-scroll").boundingBox();
      assert.ok(bounds);
      await page.mouse.move(bounds.x + bounds.width - 24, bounds.y + bounds.height / 2);
      await page.mouse.wheel(0, -(await longdocScrollGeometry(page)).maximum);
      await page.waitForFunction(() => document.querySelector(".workspace-scroll").scrollTop <= 1);
      const before = await longdocNativeSnapshot(page);
      const original = await longdocScrollGeometry(page);
      const step = Math.ceil(original.maximum / 14);
      await startDesktopLongdocObservation(page, "scroll", "scroll");
      const wheel = async (deltaY) => {
        const initial = await longdocScrollGeometry(page);
        const count = await page.evaluate(({ deltaY, initial }) => {
          const observation = window.__editorDesktopLongdocV4Probe.current();
          observation.pendingWheel = { index: observation.wheels.length, markedAt: performance.now(), deltaY, initial };
          return observation.wheels.length;
        }, { deltaY, initial });
        await page.mouse.wheel(0, deltaY);
        await page.waitForFunction(({ count, initialTop, down }) => {
          const observation = window.__editorDesktopLongdocV4Probe.current();
          const sample = observation.wheels[count];
          const top = document.querySelector(".workspace-scroll").scrollTop;
          return sample?.afterFrameMs !== null && sample?.afterFrameMs !== undefined && performance.now() - observation.lastScrollAt >= 50 && (down ? top > initialTop : top < initialTop);
        }, { count, initialTop: initial.top, down: deltaY > 0 });
      };
      for (let stepIndex = 0; stepIndex < 12; stepIndex += 1) await wheel(step);
      await wheel(original.maximum);
      await page.waitForFunction(() => { const scroller = document.querySelector(".workspace-scroll"); return Math.abs(scroller.scrollTop - scroller.scrollHeight + scroller.clientHeight) <= 1; });
      const bottom = await longdocScrollGeometry(page);
      assert.ok(Math.abs(bottom.top - original.maximum) <= 1, "Trusted wheels must reach the actual long-document bottom");
      for (let stepIndex = 0; stepIndex < 12; stepIndex += 1) await wheel(-step);
      await wheel(-original.maximum);
      await page.waitForFunction(() => document.querySelector(".workspace-scroll").scrollTop <= 1);
      const top = await longdocScrollGeometry(page);
      assert.ok(top.top <= 1, "Trusted wheels must return to the actual document top");
      const observed = await finishDesktopLongdocObservation(page);
      const intervals = observed.frames.map((entry) => entry.intervalMs);
      const summary = { activeFrameIntervalMs: longdocSummary(intervals), wheelToFirstScrollMs: longdocSummary(observed.wheels.map((entry) => entry.firstScrollMs)), wheelEventToCaptureMs: longdocSummary(observed.wheels.map((entry) => entry.captureDelayMs)), wheelCaptureToFirstScrollMs: longdocSummary(observed.wheels.map((entry) => entry.wheelCaptureToFirstScrollMs)), wheelToAfterFrameMs: longdocSummary(observed.wheels.map((entry) => entry.afterFrameMs)), framesOver50Ms: intervals.filter((value) => value > 50).length, longTasks: observed.longTasks, longTaskDurationMs: longdocSummary(observed.longTasks.map((entry) => entry.durationMs)) };
      record("scroll", { observed, summary, original, bottom, top, before, screenshot: await shot("scrolled-top") });
      assert.equal(observed.wheels.length, 26);
      assert.equal(observed.wheels.filter((entry) => entry.deltaY > 0).length, 13);
      assert.equal(observed.wheels.filter((entry) => entry.deltaY < 0).length, 13);
      assert.ok(observed.wheels.every((entry, index) => entry.trusted && entry.requestIndex === index && Number.isFinite(entry.firstScrollMs) && Number.isFinite(entry.afterFrameMs)));
      assert.ok(observed.wheels.every((entry) => !entry.timingError && entry.firstScrollMs >= 0 && entry.afterFrameMs >= entry.firstScrollMs && Number.isFinite(entry.captureDelayMs) && entry.captureDelayMs >= 0), "Every wheel must retain actual nonnegative event/scroll/after-frame timings");
      assert.ok(intervals.length >= 30, "Active EXE wheel scrolling must produce at least thirty real frame intervals");
      assert.ok(observed.frames.every((entry) => Number.isFinite(entry.intervalMs) && entry.intervalMs > 0 && entry.intervalMs === entry.at - entry.from), "Frame jitter must be full successive rAF intervals");
      assert.equal(summary.wheelToFirstScrollMs.count, 26);
      assert.equal(summary.wheelToAfterFrameMs.count, 26);
      assert.ok(Number.isFinite(summary.activeFrameIntervalMs.p95) && summary.activeFrameIntervalMs.p95 <= LONGDOC_BUDGETS.scrollFrameP95Ms, `Active scroll frame p95: ${summary.activeFrameIntervalMs.p95} ms`);
      assert.ok(Number.isFinite(summary.wheelToFirstScrollMs.p95) && summary.wheelToFirstScrollMs.p95 <= LONGDOC_BUDGETS.wheelResponseP95Ms, `Wheel response p95: ${summary.wheelToFirstScrollMs.p95} ms`);
      assert.ok(Number.isFinite(summary.wheelToAfterFrameMs.p95) && summary.wheelToAfterFrameMs.p95 <= LONGDOC_BUDGETS.wheelResponseP95Ms, `Wheel after-frame p95: ${summary.wheelToAfterFrameMs.p95} ms`);
      const after = await longdocNativeSnapshot(page);
      assert.deepEqual(after.native, before.native, "Scrolling must not mutate the native document");
      assert.deepEqual(after.selection, before.selection);
      assert.deepEqual(after.history, before.history);
      await waitForDocument(before.document);
    });

    await stage("hover", async () => {
      const ids = ["ld-columns-mid", "ld-columns-mid-left", "ld-columns-mid-middle", "ld-columns-mid-right", "ld-columns-mid-left-rich", "ld-columns-mid-middle-target"];
      await outer(page, "ld-columns-mid").scrollIntoViewIfNeeded();
      await content(page, "ld-columns-mid-left-rich").click();
      const before = await longdocNativeSnapshot(page);
      const original = await longdocBlockGeometry(page, ids);
      const bounds = await page.locator(".workspace-scroll").boundingBox();
      assert.ok(bounds);
      await page.mouse.move(bounds.x + bounds.width - 24, bounds.y + bounds.height / 2);
      await startDesktopLongdocObservation(page, "hover", "hover");
      for (const blockId of ["ld-columns-mid-left-rich", "ld-columns-mid-middle-target", "ld-columns-mid-right-detail", "ld-columns-mid-left-rich"]) {
        await content(page, blockId).hover();
        const toolbar = page.locator(`.life-block-actions[data-block-id="${blockId}"]`);
        await toolbar.getByRole("button", { name: "添加区块", exact: true }).waitFor();
        const menuButton = toolbar.getByRole("button", { name: "区块菜单", exact: true });
        assert.equal(await menuButton.isDisabled(), false);
        assert.equal(await menuButton.getAttribute("draggable"), "true");
        assert.equal(await menuButton.evaluate((element) => { const bounds = element.getBoundingClientRect(); return element.contains(document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2)); }), true, "The visible menu/drag handle must be hit-testable");
        await page.waitForFunction((expected) => Number.isFinite(window.__editorDesktopLongdocV4Probe.current().hovers.findLast((entry) => entry.blockId === expected)?.controlAfterFrameMs), blockId);
        assert.deepEqual(await longdocBlockGeometry(page, ids), original, "Hover controls must not move long-page content or scroll offsets");
      }
      const observed = await finishDesktopLongdocObservation(page);
      record("hover", { observed, original, before });
      assert.ok(observed.hovers.length >= 3);
      assert.ok(observed.hovers.every((entry) => entry.trusted && Number.isFinite(entry.controlAfterFrameMs)));
      await page.locator('.life-block-actions[data-block-id="ld-columns-mid-left-rich"]').getByRole("button", { name: "区块菜单", exact: true }).click();
      await page.getByRole("menuitem", { name: "转换为", exact: true }).hover();
      const conversion = page.locator(".life-block-conversion-menu");
      assert.equal(await conversion.getByRole("menuitem", { name: "标题 2", exact: true }).isDisabled(), false);
      assert.equal(await conversion.getByRole("menuitem", { name: "代码", exact: true }).isDisabled(), true);
      assert.deepEqual(await longdocBlockGeometry(page, ids), original);
      assert.deepEqual((await longdocNativeSnapshot(page)).native, before.native);
      record("hoverMenu", { screenshot: await shot("conversion-menu"), geometry: await longdocBlockGeometry(page, ids) });
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      await page.locator(".life-block-menu").waitFor({ state: "hidden" });
      assert.deepEqual(await longdocBlockGeometry(page, ids), original);
    });

    await stage("drag", async () => {
      const sourceId = "ld-columns-mid-left-rich";
      const targetId = "ld-columns-mid-middle-target";
      await content(page, sourceId).hover();
      const before = await longdocNativeSnapshot(page);
      const beforeCaret = await assertLongdocCaretVisible(page);
      assert.equal(beforeCaret.blockId, sourceId);
      const original = copyJson(block(before.document, sourceId));
      const expected = copyJson(before.document);
      block(expected, "ld-columns-mid-left").children = block(expected, "ld-columns-mid-left").children.filter((entry) => entry.id !== sourceId);
      block(expected, "ld-columns-mid-middle").children.push(copyJson(original));
      const dragHandle = page.locator(`.life-block-actions[data-block-id="${sourceId}"]`).getByRole("button", { name: "区块菜单", exact: true });
      const sourceBounds = await dragHandle.boundingBox();
      const targetBounds = await content(page, targetId).boundingBox();
      assert.ok(sourceBounds && targetBounds);
      const geometryBefore = await longdocScrollGeometry(page);
      await startDesktopLongdocObservation(page, "drag-preview", "drag");
      await page.mouse.move(sourceBounds.x + sourceBounds.width / 2, sourceBounds.y + sourceBounds.height / 2);
      await page.mouse.down();
      await page.mouse.move(targetBounds.x + targetBounds.width / 2, targetBounds.y + targetBounds.height - 2, { steps: 12 });
      await page.mouse.move(targetBounds.x + targetBounds.width / 2 + 1, targetBounds.y + targetBounds.height - 2);
      const preview = page.locator('.life-block-drop-preview[data-drop-kind="content"]');
      await preview.waitFor();
      const previewBounds = await preview.boundingBox();
      assert.ok(previewBounds);
      assert.ok(Math.abs(previewBounds.x - targetBounds.x) <= 1);
      assert.ok(Math.abs(previewBounds.y - targetBounds.y - targetBounds.height) <= 1);
      assert.ok(Math.abs(previewBounds.width - targetBounds.width) <= 1);
      assert.deepEqual((await longdocNativeSnapshot(page)).native, before.native);
      assert.equal((await longdocScrollGeometry(page)).top, geometryBefore.top, "A visible cross-column drag must not jump the long page");
      const previewObservation = await finishDesktopLongdocObservation(page);
      record("dragPreview", { observed: previewObservation, sourceBounds, targetBounds, previewBounds, screenshot: await shot("drag-preview", "allow") });
      await startDesktopLongdocObservation(page, "drag-drop", "drag");
      await page.mouse.up();
      const dropObservation = await finishDesktopLongdocObservation(page);
      const observed = { windows: { preview: previewObservation, drop: dropObservation }, dragEvents: [...previewObservation.dragEvents, ...dropObservation.dragEvents], dragOvers: [...previewObservation.dragOvers, ...dropObservation.dragOvers], frames: [...previewObservation.frames, ...dropObservation.frames], longTasks: [...previewObservation.longTasks, ...dropObservation.longTasks] };
      record("drag", { observed, previewAfterFrameMs: longdocSummary(observed.dragOvers.map((entry) => entry.previewAfterFrameMs)), activeFrameIntervalMs: longdocSummary(observed.frames.map((entry) => entry.intervalMs)), longTaskDurationMs: longdocSummary(observed.longTasks.map((entry) => entry.durationMs)) });
      assert.ok(observed.dragEvents.some((entry) => entry.type === "dragstart" && entry.trusted));
      assert.ok(observed.dragEvents.some((entry) => entry.type === "drop" && entry.trusted));
      assert.ok(observed.dragOvers.length > 0 && observed.dragOvers.every((entry) => entry.trusted));
      assert.ok(observed.dragOvers.some((entry) => entry.previewKind === "content" && Number.isFinite(entry.previewAfterFrameMs)), "A real content-target preview must have an actual after-frame sample");
      await waitForDocument(expected);
      const after = await longdocNativeSnapshot(page);
      assert.deepEqual(after.document, expected);
      assert.deepEqual(block(after.document, sourceId), original);
      assert.equal(after.history.undo, before.history.undo + 1);
      const afterCaret = await assertLongdocCaretVisible(page);
      assert.equal(afterCaret.blockId, sourceId);
      assert.equal(afterCaret.domCaretBlockId, sourceId);
      assert.equal(afterCaret.collapsed, true);
      assert.equal(afterCaret.headOffset, beforeCaret.headOffset, "The moved rich block must keep its actual native text-caret offset and focus");
      assert.deepEqual(walkBlocks(after.document).map((entry) => entry.id).sort(), [...fixtureIds].sort());
      assert.equal(await page.locator(LONGDOC_ROOT).locator(`.bn-block-outer[data-id="${sourceId}"]`).count(), 1);
      assert.equal(await page.locator(".life-block-drop-preview").count(), 0);
      await content(page, targetId).click();
      await page.keyboard.press("Control+z");
      await waitForDocument(before.document);
      assert.deepEqual((await longdocNativeSnapshot(page)).native, before.native);
      await page.keyboard.press("Control+Shift+z");
      await waitForDocument(after.document);
      assert.deepEqual((await longdocNativeSnapshot(page)).native, after.native);
      record("dragCommitted", { before, after, beforeCaret, afterCaret, originalSubtree: original, screenshot: await shot("drag-committed") });
    });

    await stage("close-restart", async () => {
      const beforeClose = await longdocNativeSnapshot(page);
      await waitForDocument(beforeClose.document);
      assert.deepEqual(documentBlocks(await loadedWorkspace(state.handle)), beforeClose.document);
      await page.evaluate(() => window.__editorDesktopLongdocV4Probe.dispose());
      const previousOwnership = state.handle.processOwnership;
      await restart(state, { inspectClosed: async () => {
        const closedWorkspace = readClosedLongdocWorkspace(state.dataRoot);
        assert.deepEqual(documentBlocks(closedWorkspace), beforeClose.document, "The physical SQLite database must contain the exact edited/moved long document after EXE close");
        const closedIds = walkBlocks(documentBlocks(closedWorkspace)).map((entry) => entry.id);
        assert.equal(closedIds.length, 338);
        assert.equal(new Set(closedIds).size, 338);
        for (const groupId of ["ld-columns-mid", "ld-columns-late"]) assert.deepEqual(storedBlock(closedWorkspace, groupId).children.map((entry) => entry.props.width), [40, 35, 25]);
        record("closedSQLite", { file: await longdocFileIdentity(path.join(state.dataRoot, "workspace.db")), document: documentBlocks(closedWorkspace), previousOwnership });
      } });
      const restartedPage = state.handle.page;
      assert.notDeepEqual({ pid: state.handle.processOwnership.mainPid, createdAt: state.handle.processOwnership.mainCreatedAt }, { pid: previousOwnership.mainPid, createdAt: previousOwnership.mainCreatedAt }, "Restart must create a distinct owned EXE process");
      const readiness = await observeLongdocReadiness(restartedPage, fixtureIds.length);
      const secondIdentity = await longdocPackageIdentity(state.handle);
      assert.deepEqual(secondIdentity.files, firstIdentity.files, "Close/restart must use the same frozen EXE, ASAR and notices");
      assert.equal(secondIdentity.sourceRevisionSha256, firstIdentity.sourceRevisionSha256);
      const afterRestart = await longdocNativeSnapshot(restartedPage);
      assert.deepEqual(afterRestart.document, beforeClose.document);
      assert.deepEqual(afterRestart.native, beforeClose.native);
      assert.deepEqual(documentBlocks(await loadedWorkspace(state.handle)), beforeClose.document);
      const ids = walkBlocks(afterRestart.document).map((entry) => entry.id);
      assert.equal(ids.length, 338);
      assert.equal(new Set(ids).size, 338);
      assert.deepEqual(await restartedPage.locator(LONGDOC_ROOT).locator(".bn-block-outer[data-id]").evaluateAll((elements) => elements.map((element) => element.dataset.id)), ids);
      assert.equal(blockContext(afterRestart.document, "ld-columns-mid-left-rich").parent.id, "ld-columns-mid-middle");
      assert.equal(blockContext(afterRestart.document, "ld-columns-mid-child").parent.id, "ld-columns-mid-left-rich");
      assert.equal(blockContext(afterRestart.document, "ld-columns-mid-grandchild").parent.id, "ld-columns-mid-child");
      for (const groupId of ["ld-columns-mid", "ld-columns-late"]) assert.deepEqual(block(afterRestart.document, groupId).children.map((entry) => entry.props.width), [40, 35, 25]);
      const rich = block(afterRestart.document, "ld-columns-mid-left-rich");
      assert.deepEqual(rich.content, block(fixtureExpected, "ld-columns-mid-left-rich").content);
      await content(restartedPage, "ld-columns-mid-left-rich").locator('a[href="lifeatlas://page/p-z1"]').click();
      await restartedPage.locator('.life-editor[data-page-id="p-z1"] > .bn-container .bn-editor').first().waitFor();
      assert.equal(await restartedPage.getByLabel("页面标题", { exact: true }).inputValue(), "Z 目标页");
      await ready(state.handle, "ld-start");
      assert.deepEqual((await longdocNativeSnapshot(restartedPage)).native, beforeClose.native);

      // A fresh renderer must remain natively editable after SQLite reload and
      // local-link navigation, with exact native undo/redo and the same budgets.
      await restartedPage.evaluate(installDesktopLongdocObservation, LONGDOC_ROOT);
      await content(restartedPage, "ld-end").click();
      await restartedPage.keyboard.press("End");
      await waitForNativeCaretAtBlockEnd(restartedPage, LONGDOC_ROOT, "ld-end");
      const beforeInput = await longdocNativeSnapshot(restartedPage);
      const suffix = " restart-v4-checked";
      await startDesktopLongdocObservation(restartedPage, "typing-after-restart", "input");
      await restartedPage.keyboard.type(suffix, { delay: 60 });
      const observed = await finishDesktopLongdocObservation(restartedPage);
      record("typingAfterRestart", { observed, before: beforeInput });
      const summary = assertLongdocTypingSamples(observed, "ld-end", suffix);
      const afterInput = await longdocNativeSnapshot(restartedPage);
      const expected = copyJson(beforeInput.document);
      block(expected, "ld-end").content = [{ type: "text", text: `${longdocText(block(beforeInput.document, "ld-end"))}${suffix}`, styles: {} }];
      assert.deepEqual(afterInput.document, expected);
      assert.equal(afterInput.selection.anchor, beforeInput.selection.anchor + suffix.length);
      assert.equal(afterInput.selection.head, afterInput.selection.anchor);
      assert.equal(afterInput.history.undo, beforeInput.history.undo + 1);
      await waitForDocument(afterInput.document);
      const caret = await assertLongdocCaretVisible(restartedPage);
      await restartedPage.keyboard.press("Control+z");
      await waitForDocument(beforeInput.document);
      assert.deepEqual((await longdocNativeSnapshot(restartedPage)).native, beforeInput.native);
      assert.deepEqual((await longdocNativeSnapshot(restartedPage)).selection, beforeInput.selection);
      await restartedPage.keyboard.press("Control+Shift+z");
      await waitForDocument(afterInput.document);
      assert.deepEqual((await longdocNativeSnapshot(restartedPage)).native, afterInput.native);
      assert.deepEqual((await longdocNativeSnapshot(restartedPage)).selection, afterInput.selection);
      await restartedPage.keyboard.press("Control+z");
      await waitForDocument(beforeClose.document);
      assert.deepEqual((await longdocNativeSnapshot(restartedPage)).native, beforeClose.native);
      record("typingAfterRestart", { observed, summary, before: beforeInput, after: afterInput, caret });
      await restartedPage.evaluate(() => window.__editorDesktopLongdocV4Probe.dispose());
      await shootWindowBothModes(state.handle, "longdoc-restarted", { shotsDir: outputDirectory });
      record("restart", { readiness, identity: secondIdentity, beforeClose, afterRestart, screenshots: [path.join(outputDirectory, "longdoc-restarted-light.png"), path.join(outputDirectory, "longdoc-restarted-dark.png")] });
      await assertNoNetworkAndErrors(state.handle);
      const finalHandle = state.handle;
      await closeApp(finalHandle, { keepDirs: true });
      state.handle = null;
      const finalClosedWorkspace = readClosedLongdocWorkspace(state.dataRoot);
      assert.deepEqual(documentBlocks(finalClosedWorkspace), beforeClose.document);
      record("finalClosedSQLite", { file: await longdocFileIdentity(path.join(state.dataRoot, "workspace.db")), document: documentBlocks(finalClosedWorkspace), ownership: finalHandle.processOwnership });
    });

    assert.deepEqual(metrics.completedStages, ["load", "typing", "scroll", "hover", "drag", "close-restart"]);
    metrics.activeStage = null;
    metrics.status = "checks-completed-and-closed";
    publish();
    console.log(`LIFE_ATLAS_TEST_LONGDOC_COMPLETED ${JSON.stringify({ stages: metrics.completedStages.length, blocks: fixtureIds.length, outputDirectory, metricsFile })}`);
    state.complete = true;
  } catch (error) {
    failure = error;
    if (state) state.complete = false;
    metrics.status = "failed";
    metrics.failure = error.stack;
    if (state?.handle && !state.handle.page.isClosed()) {
      try {
        metrics.failureDiagnostics = await state.handle.page.evaluate((selector) => {
          const probe = window.__editorDesktopLongdocV4Probe;
          const root = document.querySelector(selector);
          const scroller = root?.closest(".workspace-scroll") || document.querySelector(".workspace-scroll");
          return { capturedAt: performance.now(), activeProbe: probe?.current() ? JSON.parse(JSON.stringify(probe.current())) : null, pendingCallbacks: probe?.pending() ?? null, scroller: scroller ? { connected: scroller.isConnected, top: scroller.scrollTop, height: scroller.clientHeight, extent: scroller.scrollHeight, maximum: scroller.scrollHeight - scroller.clientHeight } : null };
        }, LONGDOC_ROOT);
      } catch (diagnosticError) { metrics.failureDiagnostics = { captureError: diagnosticError.message }; }
    }
    publish();
    throw error;
  } finally {
    if (state?.handle && !state.handle.page.isClosed()) {
      try { await state.handle.page.evaluate(() => window.__editorDesktopLongdocV4Probe?.dispose()); }
      catch (disposeError) {
        state.complete = false;
        metrics.observerCleanupError = disposeError.stack;
        metrics.status = "failed";
        publish();
        if (!failure) throw disposeError;
      }
    }
  }
});
