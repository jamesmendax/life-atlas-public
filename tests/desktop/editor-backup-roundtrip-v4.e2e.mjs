import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { FIXTURE_TIME, fullWorkspaceAttachmentBytes } from "../fixtures/full-workspace.mjs";
import { copyJson, stableJson, walkBlocks } from "../../src/domain/blockDocument.js";
import { openWorkspaceDatabase, replaceDatabaseWorkspace } from "../../electron/main/storage/workspaceDb.js";
import { openZipFileReader } from "../../electron/main/backup/zipNode.js";
import { sha256File } from "../../electron/main/backup/files.js";
import { assertNoNetworkAndErrors, assertTestPath, createIsolatedDirectory, openPageInSidebar } from "./helpers.mjs";
import { assertBackupDataRootsEqual, assertBackupWorkspaceEqual, captureBackupWorkspace, createBackupDesktopCase, exportBackupUi, readBackupFileWorkspace, readClosedBackupWorkspace, restoreBackupUi, seedDesktopFullWorkspace } from "./backup-helpers.mjs";

const PAGE_ID = "p-a1";
const PAGE_TITLE = "富文档分栏备份验收";
const CHILD_TITLE = "富文档的独立子页面";
const COLUMN_LINK = "lifeatlas://page/p-z1#block-b-z1-mention";
const CHILD_LINK = "lifeatlas://page/p-a1-child#block-backup-child-text";
const EDIT_TEXT = " · 恢复后键盘编辑成功";
const editorSelector = `.life-editor[data-page-id="${PAGE_ID}"] > .bn-container .bn-editor`;
const ordinaryProps = { backgroundColor: "default", textColor: "default", textAlignment: "left" };
const text = (value, styles = {}) => ({ type: "text", text: value, styles });
const link = (href, value, styles = {}) => ({ type: "link", href, content: [text(value, styles)] });
const inlineBlock = (id, type, content, props = {}, children = []) => ({ id, type, props: { ...ordinaryProps, ...props }, content: typeof content === "string" ? [text(content)] : content, children });
const documentBlocks = (workspace) => workspace.pages.find((entry) => entry.id === PAGE_ID).content;
const block = (blocks, id) => walkBlocks(blocks).find((entry) => entry.id === id);
const outer = (page, id) => page.locator(`${editorSelector} .bn-block-outer[data-id="${id}"]`).first();
const content = (page, id) => outer(page, id).locator(":scope > .bn-block > .bn-block-content, :scope > .bn-block > .react-renderer > .bn-block-content").first();
const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const launchIdentity = (handle) => ({ pid: handle.processOwnership.mainPid, createdAt: handle.processOwnership.mainCreatedAt });

function richBlocks(imageUrl, fileUrl) {
  return [
    inlineBlock("backup-root-rich", "paragraph", [text("根段落转换保留粗体", { bold: true }), text(" 与 "), link(CHILD_LINK, "子页面区块链接", { underline: true })]),
    { id: "backup-two", type: "columnList", props: { columns: 2 }, children: [
      { id: "backup-two-left", type: "column", props: { width: 40, index: 0, count: 2 }, children: [
        inlineBlock("backup-two-heading", "heading", "两栏中的中文标题", { level: 1, isToggleable: false }),
        inlineBlock("backup-two-list", "bulletListItem", [text("保留真实列表层级", { bold: true })], {}, [
          inlineBlock("backup-two-numbered", "numberedListItem", [text("从第三项开始", { italic: true })], { start: 3 }, [
            inlineBlock("backup-two-note", "paragraph", [text("嵌套说明带下划线", { underline: true })]),
          ]),
        ]),
      ] },
      { id: "backup-two-right", type: "column", props: { width: 60, index: 1, count: 2 }, children: [
        inlineBlock("backup-two-callout", "callout", [text("本地提示保留颜色", { textColor: "blue" }), text("："), link(COLUMN_LINK, "目标页", { italic: true })], { icon: "💡", tone: "neutral" }),
        { id: "backup-two-image", type: "image", props: { url: imageUrl, name: "图.png", caption: "分栏中的本地附件", previewWidth: 80 }, children: [] },
        { id: "backup-child-link", type: "pageLink", props: { pageId: "p-a1-child", label: CHILD_TITLE }, children: [] },
      ] },
    ] },
    inlineBlock("backup-between", "paragraph", "三栏保留不同权重，完整子树跨栏移动。"),
    { id: "backup-three", type: "columnList", props: { columns: 3 }, children: [
      { id: "backup-three-left", type: "column", props: { width: 33.333333, index: 0, count: 3 }, children: [
        inlineBlock("backup-column-rich", "paragraph", [
          text("栏内转换保留粗体", { bold: true }), text(" 与 "),
          link(COLUMN_LINK, "原区块链接", { italic: true, underline: true }),
          text("代码样式", { code: true }), text("彩色删除线", { textColor: "blue", backgroundColor: "yellow", strike: true }),
        ], {}, [
          inlineBlock("backup-rich-list", "bulletListItem", [text("随父区块移动的子项", { bold: true })], {}, [
            inlineBlock("backup-rich-numbered", "numberedListItem", [text("编号与链接保留 "), link(CHILD_LINK, "子页", { italic: true })], { start: 7 }, [
              inlineBlock("backup-rich-check", "checkListItem", "完成的嵌套待办", { checked: true }, [
                inlineBlock("backup-rich-note", "paragraph", [text("深层中文说明", { italic: true }), text("，这里仍可编辑")]),
              ]),
            ]),
          ]),
        ]),
        inlineBlock("backup-left-tail", "paragraph", "左栏其余内容保持完整"),
      ] },
      { id: "backup-three-middle", type: "column", props: { width: 44.444444, index: 1, count: 3 }, children: [
        inlineBlock("backup-middle-check", "checkListItem", "中栏待办", { checked: true }, [inlineBlock("backup-middle-note", "paragraph", "中栏待办的说明")]),
        inlineBlock("backup-middle-tail", "paragraph", "中栏末段是实际拖放目标"),
      ] },
      { id: "backup-three-right", type: "column", props: { width: 22.222223, index: 2, count: 3 }, children: [
        { id: "backup-right-quote", type: "quote", props: { backgroundColor: "default", textColor: "default" }, content: [text("右栏引用", { italic: true })], children: [] },
        { id: "backup-right-code", type: "codeBlock", props: { language: "javascript" }, content: [text("const preserved = true;")], children: [] },
        { id: "backup-local-file", type: "file", props: { url: fileUrl, name: "说明.pdf", caption: "备份须保留同一附件" }, children: [] },
      ] },
    ] },
    inlineBlock("backup-root-tail", "paragraph", "页面末尾仍是普通正文"),
  ];
}

async function prepareRichWorkspace(state) {
  assertTestPath(state.dataRoot);
  assert.deepEqual(fs.readdirSync(state.dataRoot), [], "The synthetic source root must be newly allocated");
  const workspace = await seedDesktopFullWorkspace(state.dataRoot);
  const imageUrl = block(workspace.pages.find((entry) => entry.id === "p-b1").content, "b-b1-img").props.url;
  const fileUrl = `life-asset://${workspace.attachments.find((entry) => entry.id === "att-file").checksum}`;
  assert.match(imageUrl, /^life-asset:\/\/[a-f0-9]{64}$/);
  assert.match(fileUrl, /^life-asset:\/\/[a-f0-9]{64}$/);
  const richPage = workspace.pages.find((entry) => entry.id === PAGE_ID);
  richPage.title = PAGE_TITLE;
  richPage.content = richBlocks(imageUrl, fileUrl);
  richPage.tags = ["合成验收", "分栏备份"];
  richPage.cover = copyJson(workspace.pages.find((entry) => entry.id === "p-z1").cover);
  richPage.settings = { ...richPage.settings, fontFamily: "default", fullWidth: false, smallText: false, locked: false };
  const childPage = workspace.pages.find((entry) => entry.id === "p-a1-child");
  childPage.title = CHILD_TITLE;
  childPage.content = [inlineBlock("backup-child-text", "paragraph", [text("独立子页面保持原父页面", { bold: true }), text("；"), link(`lifeatlas://page/${PAGE_ID}#block-backup-rich-note`, "返回深层说明", { underline: true })])];
  assert.equal(childPage.parentPageId, PAGE_ID);
  workspace.ui.selectedPageId = PAGE_ID;
  workspace.ui.selectedFolderId = "f-a";
  workspace.ui.activeSection = "private";
  workspace.ui.preferences = { ...workspace.ui.preferences, theme: "system", style: "mobai" };
  const db = openWorkspaceDatabase(path.join(state.dataRoot, "workspace.db"));
  try { replaceDatabaseWorkspace(db, workspace, { generation: "gen-editor-rich-backup-v4", now: FIXTURE_TIME }); }
  finally { db.close(); }
  state.fixtureWorkspace = workspace;
  state.expectedWorkspace = workspace;
}

async function ready(handle) {
  assert.equal(await handle.app.evaluate(({ app }) => app.isPackaged), true, "The rich backup scenario requires the packaged EXE");
  assert.equal(path.resolve(handle.processOwnership.runtimeDir), path.resolve(handle.dataRoot, "runtime"), "The Chromium profile must remain in this isolated data root");
  const page = handle.page;
  page.setDefaultTimeout(9000);
  await page.locator('html[data-la-ready="1"]').waitFor();
  await handle.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 900));
  await page.setViewportSize({ width: 1440, height: 900 });
  await openPageInSidebar(page, PAGE_TITLE);
  await content(page, "backup-two-heading").waitFor();
  await page.waitForFunction((selector) => Boolean(document.querySelector(selector)?.pmViewDesc?.node?.type?.schema?.cached?.blockNoteEditor), editorSelector);
  await page.evaluate(() => document.fonts.ready.then(() => true));
}

async function loadedWorkspace(handle) {
  const result = await handle.page.evaluate(() => window.lifeAtlas.workspace.load());
  assert.equal(result.ok, true, result.error?.message);
  return result.value.workspace;
}

async function persisted(handle, predicate) {
  const deadline = performance.now() + 10000;
  let workspace;
  do {
    workspace = await loadedWorkspace(handle);
    if (predicate(workspace)) return workspace;
    await pause(50);
  } while (performance.now() < deadline);
  assert.fail(`The rich editor mutation did not reach SQLite within 10 seconds: ${JSON.stringify(documentBlocks(workspace))}`);
}

function waitForDocument(handle, expected) {
  const expectedJson = stableJson(expected);
  return persisted(handle, (workspace) => stableJson(documentBlocks(workspace)) === expectedJson);
}

async function nativeSnapshot(page) {
  return page.evaluate((selector) => {
    const editor = document.querySelector(selector).pmViewDesc.node.type.schema.cached.blockNoteEditor;
    return { document: JSON.parse(JSON.stringify(editor.document)), native: editor.prosemirrorState.doc.toJSON(), selection: editor.prosemirrorState.selection.toJSON(), editable: editor.isEditable && editor.prosemirrorView.editable };
  }, editorSelector);
}

function assertFixtureContent(actual, expected) {
  assert.equal(actual.length, expected.length, "Loading must not add, remove or flatten fixture blocks");
  expected.forEach((entry, index) => {
    const loaded = actual[index];
    assert.equal(loaded.id, entry.id);
    assert.equal(loaded.type, entry.type);
    if (Object.hasOwn(entry, "content")) assert.deepEqual(loaded.content, entry.content, `${entry.id}: initial Chinese text, marks and links`);
    for (const [name, value] of Object.entries(entry.props ?? {})) assert.deepEqual(loaded.props[name], value, `${entry.id}.${name}`);
    assertFixtureContent(loaded.children ?? [], entry.children ?? []);
  });
}

function assertForcedIdleCapture(before, after, expectedDocument, metadataPage = before.pages.find((entry) => entry.id === PAGE_ID)) {
  assert.deepEqual(documentBlocks(before), expectedDocument, "A forced flush must start from the independently expected full document");
  assert.ok(Array.isArray(before.pageVersions) && Array.isArray(after.pageVersions));
  const priorIds = new Set(before.pageVersions.map((entry) => entry.id));
  assert.equal(priorIds.size, before.pageVersions.length, "The pre-flush history IDs must be unique");
  const added = [];
  for (const version of after.pageVersions) if (!priorIds.has(version.id)) added.push(version);
  assert.equal(added.length, 1, "The dirty page's normal flush must add exactly one history row");
  assert.equal(after.pageVersions.length, before.pageVersions.length + 1);
  for (const version of before.pageVersions) assert.deepEqual(after.pageVersions.find((entry) => entry.id === version.id), version, `A forced flush must retain prior history ${version.id}`);
  assert.ok(metadataPage);
  const beforePage = before.pages.find((entry) => entry.id === PAGE_ID);
  for (const name of ["title", "icon", "iconColor", "cover", "settings"]) assert.deepEqual(beforePage[name], metadataPage[name], `The intended edit must retain page ${name}`);
  const snapshot = {
    title: metadataPage.title ?? "",
    icon: metadataPage.icon ?? null,
    iconColor: metadataPage.iconColor ?? null,
    cover: copyJson(metadataPage.cover ?? null),
    settings: copyJson(metadataPage.settings),
    content: copyJson(expectedDocument),
  };
  // Observe only the opaque ID; every other expected field comes from pre-flush inputs.
  const expectedIdleVersion = {
    id: added[0].id, pageId: PAGE_ID, createdAt: FIXTURE_TIME, reason: "idle", ...snapshot,
    blockCount: walkBlocks(expectedDocument).length,
    sizeBytes: Buffer.byteLength(JSON.stringify(snapshot), "utf8"),
  };
  assert.match(expectedIdleVersion.id, /^ver-/);
  assert.deepEqual(added[0], expectedIdleVersion, "The complete forced idle row must match independent metadata, time, content, count and UTF-8 size");
  const expectedWorkspace = copyJson(before);
  expectedWorkspace.pageVersions.push(expectedIdleVersion);
  assertBackupWorkspaceEqual(after, expectedWorkspace);
  return { expectedWorkspace, expectedIdleVersion };
}

function nativeIdentities(snapshot) {
  const ids = [];
  const visit = (node) => {
    if (node.attrs?.id) ids.push(node.attrs.id);
    for (const child of node.content ?? []) visit(child);
  };
  visit(snapshot.native);
  return ids;
}

function assertSnapshot(snapshot, expected) {
  assert.equal(snapshot.editable, true);
  assert.deepEqual(snapshot.document, expected, "Every canonical block, prop, child and inline mark must match");
  const ids = walkBlocks(snapshot.document).map((entry) => entry.id);
  assert.ok(ids.every((id) => typeof id === "string" && id.length > 0));
  assert.equal(new Set(ids).size, ids.length, "Canonical identities must remain unique");
  const nativeIds = nativeIdentities(snapshot);
  assert.equal(new Set(nativeIds).size, nativeIds.length, "Native layout and block identities must remain unique");
  for (const id of ids) assert.ok(nativeIds.includes(id), `Native document lost ${id}`);
  for (const layoutId of ["backup-two", "backup-three"]) {
    const layout = block(snapshot.document, layoutId);
    const count = layoutId === "backup-two" ? 2 : 3;
    assert.equal(layout.props.columns, count);
    assert.equal(layout.children.length, count);
    layout.children.forEach((column, index) => {
      assert.equal(column.type, "column");
      assert.equal(column.props.index, index);
      assert.equal(column.props.count, count);
      assert.ok(Number.isFinite(column.props.width) && column.props.width > 0);
      assert.ok(column.children.length > 0);
    });
  }
}

async function historyRoundTrip(handle, before, after, focusId = "backup-root-tail") {
  await content(handle.page, focusId).click({ position: { x: 6, y: 6 } });
  await handle.page.keyboard.press("Control+z");
  await waitForDocument(handle, before.document);
  assert.deepEqual((await nativeSnapshot(handle.page)).native, before.native, "One native undo must restore the whole original document");
  await handle.page.keyboard.press("Control+Shift+z");
  await waitForDocument(handle, after.document);
  assert.deepEqual((await nativeSnapshot(handle.page)).native, after.native, "One native redo must restore the whole changed document");
}

async function convertThroughMenu(handle, id, level) {
  const before = await nativeSnapshot(handle.page);
  const original = copyJson(block(before.document, id));
  const expected = copyJson(before.document);
  const converted = block(expected, id);
  converted.type = "heading";
  converted.props = { ...original.props, level, isToggleable: false };
  await content(handle.page, id).hover();
  await handle.page.locator(`.life-block-actions[data-block-id="${id}"]`).getByRole("button", { name: "区块菜单", exact: true }).click();
  await handle.page.getByRole("menuitem", { name: "转换为", exact: true }).hover();
  const menu = handle.page.locator(".life-block-conversion-menu");
  await menu.getByRole("menuitem", { name: `标题 ${level}`, exact: true }).waitFor();
  assert.equal(await menu.getByRole("menuitem", { name: "代码", exact: true }).isDisabled(), true, "A lossy plain-code conversion must remain unavailable");
  await menu.getByRole("menuitem", { name: `标题 ${level}`, exact: true }).click();
  await waitForDocument(handle, expected);
  const after = await nativeSnapshot(handle.page);
  assertSnapshot(after, expected);
  assert.deepEqual(block(after.document, id).content, original.content);
  assert.deepEqual(block(after.document, id).children, original.children);
  await historyRoundTrip(handle, before, after);
  return { before, after };
}

async function resizeThroughPointer(handle) {
  const page = handle.page;
  await outer(page, "backup-three").scrollIntoViewIfNeeded();
  const before = await nativeSnapshot(page);
  const oldWidths = block(before.document, "backup-three").children.map((column) => column.props.width);
  const thirdWidth = (await outer(page, "backup-three-right").boundingBox()).width;
  const separator = outer(page, "backup-three-left").getByRole("separator", { name: "调整第 1、2 列栏宽", exact: true });
  const bounds = await separator.boundingBox();
  assert.ok(bounds, "The production separator must have a real pointer target");
  const point = { x: bounds.x + bounds.width / 2, y: bounds.y + Math.min(bounds.height / 2, 18) };
  assert.equal(await page.evaluate(({ x, y }) => Boolean(document.elementFromPoint(x, y)?.closest(".life-column-resizer")), point), true);
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + 24, point.y, { steps: 8 });
  await page.locator(`${editorSelector} [data-life-column-preview="true"]`).first().waitFor();
  assert.equal(await page.locator(`${editorSelector} [data-life-column-preview="true"]`).count(), 2);
  assert.deepEqual((await nativeSnapshot(page)).native, before.native, "Resize preview must not rewrite the native document");
  assert.deepEqual(documentBlocks(await loadedWorkspace(handle)), before.document, "Resize preview must not persist");
  await page.mouse.up();
  const saved = await persisted(handle, (workspace) => block(documentBlocks(workspace), "backup-three-left")?.props.width !== oldWidths[0]);
  const widths = block(documentBlocks(saved), "backup-three").children.map((column) => column.props.width);
  assert.ok(widths[0] > oldWidths[0] && widths[1] < oldWidths[1]);
  assert.ok(Math.abs(widths[0] + widths[1] - oldWidths[0] - oldWidths[1]) < 1e-8, "The adjacent pair total must stay constant");
  assert.equal(widths[2], oldWidths[2], "The third weight must remain exactly unchanged");
  assert.ok(Math.abs((await outer(page, "backup-three-right").boundingBox()).width - thirdWidth) <= 1);
  const expected = copyJson(before.document);
  block(expected, "backup-three-left").props.width = widths[0];
  block(expected, "backup-three-middle").props.width = widths[1];
  const after = await nativeSnapshot(page);
  assertSnapshot(after, expected);
  assert.deepEqual(documentBlocks(saved), expected, "Resizing must change only the adjacent widths");
  await historyRoundTrip(handle, before, after);
  return { before, after, widths, thirdWidth };
}

async function moveThroughPointer(handle) {
  const page = handle.page;
  await outer(page, "backup-three").scrollIntoViewIfNeeded();
  await content(page, "backup-column-rich").click({ position: { x: 6, y: 6 } });
  const before = await nativeSnapshot(page);
  const subtree = copyJson(block(before.document, "backup-column-rich"));
  const expected = copyJson(before.document);
  block(expected, "backup-three-left").children = block(expected, "backup-three-left").children.filter((entry) => entry.id !== subtree.id);
  block(expected, "backup-three-middle").children.push(copyJson(subtree));
  await page.evaluate(() => {
    window.__editorRichBackupV4DragTrace = [];
    for (const type of ["dragstart", "dragover", "drop", "dragend"]) document.addEventListener(type, (event) => {
      if (window.__editorRichBackupV4DragTrace.length >= 80 && event.type === "dragover") return;
      window.__editorRichBackupV4DragTrace.push({ type: event.type, trusted: event.isTrusted, blockId: event.target.closest?.(".life-block-actions")?.dataset.blockId || event.target.closest?.(".bn-block-outer")?.dataset.id });
    }, true);
  });
  await content(page, subtree.id).hover();
  const handleButton = page.locator(`.life-block-actions[data-block-id="${subtree.id}"]`).getByRole("button", { name: "区块菜单", exact: true });
  assert.equal(await handleButton.getAttribute("draggable"), "true");
  const sourceBounds = await handleButton.boundingBox();
  const targetBounds = await content(page, "backup-middle-tail").boundingBox();
  assert.ok(sourceBounds && targetBounds, "Cross-column dragging requires visible real geometry");
  const point = { x: targetBounds.x + targetBounds.width / 2, y: targetBounds.y + targetBounds.height - 2 };
  await page.mouse.move(sourceBounds.x + sourceBounds.width / 2, sourceBounds.y + sourceBounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(point.x, point.y, { steps: 12 });
  await page.mouse.move(point.x + 1, point.y);
  await page.locator('.life-block-drop-preview[data-drop-kind="content"]').waitFor();
  assert.equal(await page.locator(".life-block-drop-preview").count(), 1);
  assert.deepEqual((await nativeSnapshot(page)).native, before.native, "The drag target preview must not mutate the tree");
  await page.mouse.up();
  await waitForDocument(handle, expected);
  await page.waitForFunction(() => window.__editorRichBackupV4DragTrace.some((entry) => entry.type === "dragend"));
  const trace = await page.evaluate(() => window.__editorRichBackupV4DragTrace);
  assert.ok(trace.some((entry) => entry.type === "dragstart" && entry.trusted && entry.blockId === "backup-column-rich"));
  assert.ok(trace.some((entry) => entry.type === "drop" && entry.trusted));
  assert.ok(trace.some((entry) => entry.type === "dragend" && entry.trusted));
  const after = await nativeSnapshot(page);
  assertSnapshot(after, expected);
  assert.deepEqual(block(after.document, subtree.id), subtree, "A trusted move must preserve the complete rich subtree");
  assert.deepEqual(block(after.document, "backup-three-left").children.map((entry) => entry.id), ["backup-left-tail"]);
  assert.deepEqual(block(after.document, "backup-three-middle").children.map((entry) => entry.id), ["backup-middle-check", "backup-middle-tail", "backup-column-rich"]);
  assert.equal(await page.locator(".life-block-drop-preview").count(), 0);
  await historyRoundTrip(handle, before, after);
  return { before, after, trace };
}

function assetRows(dataRoot) {
  const db = openWorkspaceDatabase(path.join(assertTestPath(dataRoot), "workspace.db"), { readOnly: true });
  try { return db.prepare("SELECT sha256, size, mime, original_name AS originalName, created_at AS createdAt FROM assets ORDER BY sha256").all().map((row) => ({ ...row })); }
  finally { db.close(); }
}

async function assertAssetFiles(dataRoot, expectedRows) {
  assert.deepEqual(assetRows(dataRoot), expectedRows, "Asset hashes, sizes, MIME, names and timestamps must all survive");
  for (const row of expectedRows) assert.deepEqual(await sha256File(path.join(assertTestPath(dataRoot), "assets", row.sha256.slice(0, 2), row.sha256)), { size: row.size, sha256: row.sha256 });
}

async function assertActualArchive(filePath, expectedWorkspace, expectedAssets) {
  const reader = await openZipFileReader(assertTestPath(filePath));
  try {
    const manifest = JSON.parse((await reader.read("manifest.json")).toString("utf8"));
    assert.equal(manifest.kind, "life-atlas-backup");
    assert.equal(manifest.formatVersion, 1);
    assert.equal(manifest.app.platform, "desktop");
    assert.equal(manifest.workspace.schemaVersion, expectedWorkspace.schemaVersion);
    assert.equal(manifest.workspace.workspaceId, expectedWorkspace.workspaceId);
    assert.deepEqual(manifest.vault, { included: false });
    assert.deepEqual(manifest.assets, { count: expectedAssets.length, totalBytes: expectedAssets.reduce((total, row) => total + row.size, 0) });
    assert.deepEqual(reader.entries().filter((entry) => entry.startsWith("assets/") && entry !== "assets/index.json").sort(), expectedAssets.map((row) => `assets/${row.sha256}`).sort());
    const index = JSON.parse((await reader.read("assets/index.json")).toString("utf8"));
    assert.deepEqual(index.sort((left, right) => left.sha256.localeCompare(right.sha256)), expectedAssets);
    const rawPages = (await reader.read("workspace/entities/pages.jsonl")).toString("utf8").trimEnd().split("\n").map((line) => JSON.parse(line));
    assert.equal(new Set(rawPages.map((entry) => entry.id)).size, expectedWorkspace.pages.length);
    for (const id of [PAGE_ID, "p-a1-child", "p-z1"]) assert.deepEqual(rawPages.find((entry) => entry.id === id), expectedWorkspace.pages.find((entry) => entry.id === id), `${id}: actual JSONL must retain content and all page metadata`);
    for (const row of expectedAssets) assert.deepEqual(await reader.stat(`assets/${row.sha256}`), { size: row.size, sha256: row.sha256 });
    return manifest;
  } finally { reader.close(); }
}

async function renderedLayout(page) {
  return page.evaluate((selector) => {
    const root = document.querySelector(selector);
    return ["backup-two", "backup-three"].map((id) => {
      const group = root.querySelector(`.bn-block-outer[data-id="${id}"] > .bn-block > .bn-block-group`);
      const style = getComputedStyle(group);
      return { id, gap: style.columnGap, columns: [...group.children].filter((entry) => entry.matches(".bn-block-outer[data-id]")).map((entry) => {
        const rect = entry.getBoundingClientRect();
        return { id: entry.dataset.id, left: rect.left, width: rect.width, firstId: entry.querySelector(":scope > .bn-block > .bn-block-group > .bn-block-outer")?.dataset.id };
      }) };
    });
  }, editorSelector);
}

function assertLayoutEqual(actual, expected) {
  assert.equal(actual.length, expected.length);
  expected.forEach((layout, index) => {
    const loaded = actual[index];
    assert.equal(loaded.id, layout.id);
    assert.equal(loaded.gap, layout.gap);
    assert.equal(loaded.columns.length, layout.columns.length);
    layout.columns.forEach((column, columnIndex) => {
      const next = loaded.columns[columnIndex];
      assert.equal(next.id, column.id);
      assert.equal(next.firstId, column.firstId);
      assert.ok(Math.abs(next.left - column.left) <= 1, `${column.id}: restored horizontal placement`);
      assert.ok(Math.abs(next.width - column.width) <= 1, `${column.id}: restored displayed width`);
    });
  });
}

async function assertRenderedContent(handle, expected) {
  const page = handle.page;
  const root = page.locator(editorSelector).first();
  assert.deepEqual(await root.locator(":scope > .bn-block-group > .bn-block-outer").evaluateAll((elements) => elements.map((entry) => entry.dataset.id)), expected.map((entry) => entry.id));
  for (const entry of walkBlocks(expected)) assert.equal(await root.locator(`.bn-block-outer[data-id="${entry.id}"]`).count(), 1, `${entry.id}: exactly one rendered block`);
  for (const id of ["backup-two", "backup-three"]) assert.deepEqual(await outer(page, id).locator(":scope > .bn-block > .bn-block-group > .bn-block-outer").evaluateAll((elements) => elements.map((entry) => entry.dataset.id)), block(expected, id).children.map((entry) => entry.id));
  assert.equal(await outer(page, "backup-three-middle").locator('.bn-block-outer[data-id="backup-column-rich"]').count(), 1);
  await content(page, "backup-column-rich").locator("strong").filter({ hasText: "栏内转换保留粗体" }).waitFor();
  await content(page, "backup-column-rich").locator(`a[href="${COLUMN_LINK}"]`).waitFor();
  await content(page, "backup-root-rich").locator(`a[href="${CHILD_LINK}"]`).waitFor();
  assert.equal(await content(page, "backup-rich-check").getByRole("checkbox").isChecked(), true);
  await page.waitForFunction((selector) => {
    const image = document.querySelector(`${selector} .bn-block-outer[data-id="backup-two-image"] img.bn-visual-media`);
    return Boolean(image?.complete && image.naturalWidth === 1);
  }, editorSelector);
  assert.equal(await page.locator(".life-block-drop-preview").count(), 0);
  assert.equal(await page.locator(`${editorSelector} [data-life-column-preview]`).count(), 0);
}

test("packaged rich columns survive actual backup restore relaunch and remain natively editable", { timeout: 180000 }, async (context) => {
  // This directory is intentionally retained as acceptance evidence, including on success.
  // App/data-root cleanup remains the established helper's owned-only policy.
  const evidenceDir = createIsolatedDirectory("editor-rich-backup-v4-evidence");
  const archivePath = path.join(evidenceDir, "rich-columns.lifeatlas");
  let completed = false;
  let source;
  let destination;
  const record = (label, value) => {
    const target = assertTestPath(path.join(evidenceDir, `${label}.json`));
    const serialized = `${JSON.stringify(value, null, 2)}\n`;
    fs.writeFileSync(target, serialized, { encoding: "utf8", flag: "wx" });
    context.diagnostic(`EDITOR_RICH_BACKUP_STAGE ${JSON.stringify({ label, file: target, size: Buffer.byteLength(serialized, "utf8"), sha256: createHash("sha256").update(serialized, "utf8").digest("hex") })}`);
  };
  const screenshot = async (handle, label) => {
    const target = assertTestPath(path.join(evidenceDir, `${label}.png`));
    assert.equal(fs.existsSync(target), false, "Acceptance screenshots must never replace existing artifacts");
    await outer(handle.page, "backup-three").scrollIntoViewIfNeeded();
    await handle.page.screenshot({ path: target });
    const bytes = fs.readFileSync(target);
    context.diagnostic(`EDITOR_RICH_BACKUP_SCREENSHOT ${JSON.stringify({ file: target, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") })}`);
  };
  context.after(() => context.diagnostic(`EDITOR_RICH_BACKUP_EVIDENCE ${JSON.stringify({ completed, evidenceDir, archivePath, sourceRoot: source?.dataRoot, restoredRoot: destination?.dataRoot })}`));
  context.diagnostic(`EDITOR_RICH_BACKUP_EVIDENCE_CREATED ${evidenceDir}`);

  source = await createBackupDesktopCase(context, { packaged: true, retainOnFailure: true, prepare: prepareRichWorkspace });
  await ready(source.handle);
  const initial = await nativeSnapshot(source.handle.page);
  record("00-initial-before-assert", { snapshot: initial, expectedFixtureDocument: documentBlocks(source.fixtureWorkspace), sourceRoot: source.dataRoot });
  assertFixtureContent(initial.document, documentBlocks(source.fixtureWorkspace));
  assertSnapshot(initial, initial.document);
  const originalAssets = assetRows(source.dataRoot);
  assert.equal(originalAssets.length, 3, "Use the full fixture's referenced image/file and unreferenced asset");
  const fixtureAssets = [...fullWorkspaceAttachmentBytes().values()].map((bytes) => ({ size: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex") })).sort((left, right) => left.sha256.localeCompare(right.sha256));
  assert.deepEqual(originalAssets.map((row) => ({ size: row.size, sha256: row.sha256 })), fixtureAssets, "The source assets must match the independently specified full fixture bytes");
  assert.ok(originalAssets.some((row) => row.mime === "image/png"));
  assert.ok(originalAssets.some((row) => row.mime === "application/pdf"));
  record("01-initial", { snapshot: initial, assets: originalAssets, sourceRoot: source.dataRoot });
  record("02-root-conversion", await convertThroughMenu(source.handle, "backup-root-rich", 3));
  record("03-column-conversion", await convertThroughMenu(source.handle, "backup-column-rich", 2));
  record("04-paired-resize", await resizeThroughPointer(source.handle));
  record("05-trusted-cross-column-move", await moveThroughPointer(source.handle));
  const beforeBackup = await nativeSnapshot(source.handle.page);
  assertSnapshot(beforeBackup, documentBlocks(await loadedWorkspace(source.handle)));
  await assertRenderedContent(source.handle, beforeBackup.document);
  const beforeLayout = await renderedLayout(source.handle.page);
  await screenshot(source.handle, "before-backup");
  assert.equal(fs.existsSync(archivePath), false);
  assert.equal(await source.handle.page.evaluate(() => new Date().toISOString()), FIXTURE_TIME);
  await exportBackupUi(source.handle, archivePath, { onWorkspace: (workspace) => {
    source.beforeExportWorkspace = copyJson(workspace);
    record("05-before-export-flush", { workspace: source.beforeExportWorkspace, sourceRoot: source.dataRoot });
  } });
  source.exportedWorkspace = copyJson(await captureBackupWorkspace(source.handle));
  record("06-source-after-export-flush", { workspace: source.exportedWorkspace, sourceRoot: source.dataRoot });
  const exportFlush = assertForcedIdleCapture(source.beforeExportWorkspace, source.exportedWorkspace, beforeBackup.document);
  assertSnapshot(await nativeSnapshot(source.handle.page), beforeBackup.document);
  assert.deepEqual(documentBlocks(source.exportedWorkspace), beforeBackup.document);
  assertBackupWorkspaceEqual(await readBackupFileWorkspace(archivePath), source.exportedWorkspace);
  const manifest = await assertActualArchive(archivePath, source.exportedWorkspace, originalAssets);
  const archiveHash = await sha256File(archivePath);
  record("06-actual-archive", { archivePath, archiveHash, manifest, workspace: source.exportedWorkspace, expectedIdleVersion: exportFlush.expectedIdleVersion, snapshot: beforeBackup, layout: beforeLayout });

  // Reap the source EXE completely before admitting a second EXE into the scene.
  const sourceIdentity = launchIdentity(source.handle);
  await assertNoNetworkAndErrors(source.handle);
  await source.close();
  assert.equal(source.handle, null);
  assertBackupWorkspaceEqual(readClosedBackupWorkspace(source.dataRoot), source.exportedWorkspace);
  await assertAssetFiles(source.dataRoot, originalAssets);

  destination = await createBackupDesktopCase(context, { packaged: true, retainOnFailure: true, prepare: (state) => { assert.deepEqual(fs.readdirSync(assertTestPath(state.dataRoot)), [], "The second root must be newly allocated"); } });
  assert.notEqual(path.resolve(destination.dataRoot), path.resolve(source.dataRoot));
  assert.notDeepEqual(launchIdentity(destination.handle), sourceIdentity);
  assert.notEqual((await loadedWorkspace(destination.handle)).workspaceId, source.exportedWorkspace.workspaceId);
  const restored = await restoreBackupUi(destination.handle, archivePath);
  assertBackupWorkspaceEqual(restored, source.exportedWorkspace);
  await ready(destination.handle);
  const restoredSnapshot = await nativeSnapshot(destination.handle.page);
  assertSnapshot(restoredSnapshot, beforeBackup.document);
  assert.deepEqual(restoredSnapshot.native, beforeBackup.native, "Restoration must retain the full native tree and marks");
  assert.deepEqual(nativeIdentities(restoredSnapshot), nativeIdentities(beforeBackup));
  assertBackupWorkspaceEqual(await captureBackupWorkspace(destination.handle), source.exportedWorkspace);
  await assertRenderedContent(destination.handle, beforeBackup.document);
  assertLayoutEqual(await renderedLayout(destination.handle.page), beforeLayout);
  record("07-restored", { snapshot: restoredSnapshot, workspace: restored, restoredRoot: destination.dataRoot });
  await screenshot(destination.handle, "after-restore");
  const restoreIdentity = launchIdentity(destination.handle);
  await destination.close();
  await assertBackupDataRootsEqual(destination.dataRoot, source.dataRoot);
  await assertAssetFiles(destination.dataRoot, originalAssets);

  await destination.launch();
  await ready(destination.handle);
  assert.notDeepEqual(launchIdentity(destination.handle), restoreIdentity, "This must be a real EXE close/relaunch");
  assertBackupWorkspaceEqual(await captureBackupWorkspace(destination.handle), source.exportedWorkspace);
  const relaunched = await nativeSnapshot(destination.handle.page);
  assertSnapshot(relaunched, beforeBackup.document);
  assert.deepEqual(relaunched.native, beforeBackup.native, "A new process must reload the exact restored native tree");
  assert.deepEqual(nativeIdentities(relaunched), nativeIdentities(beforeBackup));
  await assertRenderedContent(destination.handle, beforeBackup.document);
  assertLayoutEqual(await renderedLayout(destination.handle.page), beforeLayout);
  record("08-restored-relaunched", relaunched);
  await screenshot(destination.handle, "after-relaunch");

  // Exercise a restored internal link before editing; it must resolve the original page/block.
  await content(destination.handle.page, "backup-column-rich").locator(`a[href="${COLUMN_LINK}"]`).click();
  await destination.handle.page.locator('.life-editor[data-page-id="p-z1"] .bn-block-outer[data-id="b-z1-mention"].is-link-target').waitFor();
  assert.equal(await destination.handle.page.getByLabel("页面标题", { exact: true }).inputValue(), "Z 目标页");
  await openPageInSidebar(destination.handle.page, PAGE_TITLE);
  await content(destination.handle.page, "backup-rich-note").waitFor();
  assertSnapshot(await nativeSnapshot(destination.handle.page), beforeBackup.document);

  // Modify a real deep descendant using the keyboard, never a mutating editor/test API.
  const editBefore = await nativeSnapshot(destination.handle.page);
  const editExpected = copyJson(editBefore.document);
  const note = block(editExpected, "backup-rich-note");
  assert.deepEqual(note.content.at(-1).styles, {});
  note.content.at(-1).text += EDIT_TEXT;
  const editableNote = content(destination.handle.page, "backup-rich-note").locator(".bn-inline-content");
  await editableNote.scrollIntoViewIfNeeded();
  const noteBounds = await editableNote.boundingBox();
  assert.ok(noteBounds && noteBounds.width > 4 && noteBounds.height > 4, "The restored deep paragraph must have a real text target");
  await editableNote.click({ position: { x: noteBounds.width - 2, y: noteBounds.height - 2 } });
  await destination.handle.page.keyboard.press("End");
  const caret = await destination.handle.page.evaluate((selector) => {
    const editor = document.querySelector(selector).pmViewDesc.node.type.schema.cached.blockNoteEditor;
    const selection = editor.prosemirrorState.selection;
    return { id: editor.getTextCursorPosition().block.id, empty: selection.empty, atEnd: selection.$from.parentOffset === selection.$from.parent.content.size };
  }, editorSelector);
  assert.deepEqual(caret, { id: "backup-rich-note", empty: true, atEnd: true }, "Mouse/End must place the real caret at the restored descendant's end");
  await destination.handle.page.keyboard.insertText(EDIT_TEXT);
  await waitForDocument(destination.handle, editExpected);
  const editAfter = await nativeSnapshot(destination.handle.page);
  assertSnapshot(editAfter, editExpected);
  await historyRoundTrip(destination.handle, editBefore, editAfter, "backup-rich-note");
  let editedWorkspace = await captureBackupWorkspace(destination.handle);
  assert.deepEqual(documentBlocks(editedWorkspace), editExpected);
  for (const page of source.exportedWorkspace.pages.filter((entry) => entry.id !== PAGE_ID)) assert.deepEqual(editedWorkspace.pages.find((entry) => entry.id === page.id), page, `Editing restored content must not change associated page ${page.id}`);
  const beforeEditedClose = await nativeSnapshot(destination.handle.page);
  assertSnapshot(beforeEditedClose, editExpected);
  assert.deepEqual(beforeEditedClose.native, editAfter.native, "Normal close must start with the exact intended edited native tree");
  assert.equal(await destination.handle.page.evaluate(() => new Date().toISOString()), FIXTURE_TIME);
  record("09-native-edit-undo-redo", { before: editBefore, after: editAfter, snapshotBeforeClose: beforeEditedClose, workspace: editedWorkspace, expectedDocument: editExpected, capturePhase: "before-close-flush" });
  const editedIdentity = launchIdentity(destination.handle);
  await destination.close();
  const closedEditedWorkspace = readClosedBackupWorkspace(destination.dataRoot);
  record("09-after-close-flush", { workspace: closedEditedWorkspace, restoredRoot: destination.dataRoot });
  const closeFlush = assertForcedIdleCapture(editedWorkspace, closedEditedWorkspace, editExpected, source.exportedWorkspace.pages.find((entry) => entry.id === PAGE_ID));
  editedWorkspace = closeFlush.expectedWorkspace;
  record("09-close-flush-expectation", { workspace: editedWorkspace, expectedIdleVersion: closeFlush.expectedIdleVersion, expectedDocument: editExpected, restoredRoot: destination.dataRoot });
  assertBackupWorkspaceEqual(readClosedBackupWorkspace(destination.dataRoot), editedWorkspace);
  await assertAssetFiles(destination.dataRoot, originalAssets);
  await destination.launch();
  await ready(destination.handle);
  assert.notDeepEqual(launchIdentity(destination.handle), editedIdentity, "The edited content must be read by another new EXE process");
  assertBackupWorkspaceEqual(await captureBackupWorkspace(destination.handle), editedWorkspace);
  const final = await nativeSnapshot(destination.handle.page);
  assertSnapshot(final, editExpected);
  assert.deepEqual(final.native, editAfter.native, "The actual post-restore edit and its marks must survive another close/relaunch");
  assertLayoutEqual(await renderedLayout(destination.handle.page), beforeLayout);
  record("10-edit-relaunched", final);
  await assertNoNetworkAndErrors(destination.handle);
  await destination.close();
  assertBackupWorkspaceEqual(readClosedBackupWorkspace(source.dataRoot), source.exportedWorkspace);
  assert.deepEqual(await sha256File(archivePath), archiveHash, "Restore and later editing must not mutate the backup artifact");
  await assertAssetFiles(destination.dataRoot, originalAssets);
  source.complete();
  destination.complete();
  completed = true;
});
