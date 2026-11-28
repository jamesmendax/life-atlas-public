import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createPageExport,
  duplicatePage,
  movePage,
  movePageToTrash,
  normalizePageSettings,
  parsePageImport,
  safeExportFileName,
} from "../src/domain/pageActions.js";
import { buildSearchDocuments } from "../src/search/searchIndex.js";
import { fullWorkspace } from "./fixtures/full-workspace.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const appSource = fs.readFileSync(path.join(root, "src", "App.jsx"), "utf8");
const editorSource = fs.readFileSync(path.join(root, "src", "editor", "PageEditor.jsx"), "utf8");
const menuSource = fs.readFileSync(path.join(root, "src", "components", "PageActionsMenu.jsx"), "utf8");
const cssSource = fs.readFileSync(path.join(root, "src", "styles.css"), "utf8");

const samplePage = {
  id: "chemistry",
  folderId: "parenting",
  title: "化学",
  icon: "🧪",
  iconColor: "#6fa8dc",
  cover: null,
  settings: { fontFamily: "serif", smallText: true, fullWidth: true, presentationMode: "full", locked: false },
  sortIndex: 10,
  createdAt: "2026-09-18T00:00:00.000Z",
  updatedAt: "2026-09-18T00:00:00.000Z",
  content: [{ type: "paragraph", content: "氧化还原" }],
};

test("page settings normalize to the supported local options", () => {
  assert.deepEqual(normalizePageSettings(), {
    fontFamily: "default",
    smallText: false,
    fullWidth: false,
    presentationMode: "default",
    locked: false,
  });
  assert.deepEqual(normalizePageSettings({
    fontFamily: "serif",
    smallText: 1,
    fullWidth: true,
    presentationMode: "full",
    locked: true,
  }), {
    fontFamily: "serif",
    smallText: true,
    fullWidth: true,
    presentationMode: "full",
    locked: true,
  });
  assert.equal(normalizePageSettings({ fontFamily: "comic" }).fontFamily, "default");
});

test("duplicate, move and soft-trash preserve page content without destructive deletion", () => {
  const duplicate = duplicatePage(samplePage, {
    id: "chemistry-copy",
    sortIndex: 20,
    now: "2026-09-18T01:00:00.000Z",
  });
  assert.equal(duplicate.id, "chemistry-copy");
  assert.equal(duplicate.title, "化学 副本");
  assert.equal(duplicate.folderId, "parenting");
  assert.deepEqual(duplicate.settings, samplePage.settings);
  assert.notEqual(duplicate.content, samplePage.content);

  const moved = movePage(duplicate, {
    folderId: "study",
    sortIndex: 30,
    now: "2026-09-18T02:00:00.000Z",
  });
  assert.equal(moved.folderId, "study");
  assert.equal(moved.sortIndex, 30);

  const trashed = movePageToTrash(moved, "2026-09-18T03:00:00.000Z");
  assert.equal(trashed.trashedAt, "2026-09-18T03:00:00.000Z");
  const docs = buildSearchDocuments(
    [{ id: "study", parentId: null, name: "学习" }],
    [trashed],
  );
  assert.equal(docs.some((doc) => doc.entityId === trashed.id), false);
});

test("moving a rich page preserves its identity, nested blocks and owned references", () => {
  const workspace = fullWorkspace();
  const page = workspace.pages.find((entry) => entry.id === "p-b1");
  page.content.unshift({
    id: "rich-parent", type: "paragraph",
    content: [
      { type: "text", text: "加粗", styles: { bold: true, italic: true } },
      { type: "link", href: "https://example.org/reference", content: [{ type: "text", text: "来源", styles: { underline: true } }] },
    ],
    children: [{ id: "rich-child", type: "paragraph", content: [{ type: "text", text: "嵌套正文", styles: { code: true } }] }],
  });
  const before = structuredClone(workspace);
  const moved = movePage(page, { folderId: "f-z", sortIndex: 50, now: "2026-10-02T08:00:00.000Z" });

  assert.equal(moved.folderId, "f-z");
  assert.equal(moved.sortIndex, 50);
  assert.equal(moved.id, page.id);
  assert.deepEqual(moved.content, before.pages.find((entry) => entry.id === page.id).content);
  assert.deepEqual(moved.settings, page.settings);
  assert.equal(moved.content.find((block) => block.id === "b-b1-db").props.sourceId, "ds-inline");
  assert.equal(workspace.dataSources.find((source) => source.id === "ds-inline").ownerPageId, moved.id);
  assert.deepEqual(workspace.databaseItems.filter((item) => item.sourceId === "ds-inline").map((item) => item.pageId), ["p-rec-1", "p-rec-2"]);
  assert.deepEqual(workspace.syncedSources, before.syncedSources);
  assert.deepEqual(workspace.attachments, before.attachments);
  assert.deepEqual(workspace, before);
});

test("local export and import round-trip JSON and support markdown/text import", () => {
  const exported = createPageExport(samplePage);
  assert.equal(exported.kind, "life-atlas-page");
  assert.equal(exported.page.title, "化学");
  assert.deepEqual(exported.page.settings, samplePage.settings);

  const imported = parsePageImport(JSON.stringify(exported), "chemistry.life-atlas.json");
  assert.equal(imported.title, "化学");
  assert.equal(imported.settings.fontFamily, "serif");
  assert.deepEqual(imported.content, samplePage.content);

  const markdown = parsePageImport("# 一级标题\n正文\n## 二级标题", "notes.md");
  assert.equal(markdown.content[0].type, "heading");
  assert.equal(markdown.content[0].props.level, 1);
  assert.equal(markdown.content[1].type, "paragraph");
  assert.equal(markdown.content[2].props.level, 2);
  assert.throws(() => parsePageImport("x", "photo.png"), /仅支持/);
  assert.equal(safeExportFileName('A:B/C*D?'), "A-B-C-D-");
});

test("page actions UI contains only local actions and removes the meaningless notification bell", () => {
  assert.doesNotMatch(appSource, /label="通知"/);
  assert.doesNotMatch(appSource, /IconBell/);
  assert.match(appSource, /PageActionsMenu/);
  assert.match(menuSource, /搜索操作/);
  assert.match(menuSource, /Default/);
  assert.match(menuSource, /Serif/);
  assert.match(menuSource, /Mono/);
  assert.match(menuSource, /撤回/);
  assert.match(menuSource, /重做/);
  assert.match(menuSource, /小号文字/);
  assert.match(menuSource, /全宽/);
  assert.match(menuSource, /锁定页面/);
  assert.match(menuSource, /导入本地文件/);
  assert.match(menuSource, /导出页面/);
  assert.doesNotMatch(menuSource, /Use with AI|Translate|Share|Available offline/);
});

test("undo/redo and lock are wired to BlockNote's real editor APIs", () => {
  assert.match(editorSource, /editor\.canExec\(undoCommand\)/);
  assert.match(editorSource, /editor\.canExec\(redoCommand\)/);
  assert.match(editorSource, /editor\.undo\(\)/);
  assert.match(editorSource, /editor\.redo\(\)/);
  assert.match(editorSource, /editor\.isEditable = !locked/);
  assert.match(appSource, /undoCurrentPage/);
  assert.match(appSource, /redoCurrentPage/);
});

test("page typography, small-text, full-width and menu styling have explicit product rules", () => {
  assert.match(cssSource, /\.page-actions-menu\s*\{/);
  assert.match(cssSource, /\.page-font-choice-serif strong/);
  assert.match(cssSource, /\.page-font-choice-mono strong/);
  assert.match(cssSource, /\.page-document\.is-small-text/);
  assert.match(cssSource, /\.page-document\.is-full-width/);
  assert.match(cssSource, /\.page-document\.is-locked/);
});
