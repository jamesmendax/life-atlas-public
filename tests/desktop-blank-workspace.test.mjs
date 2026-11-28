import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createBlankWorkspace } from "../src/domain/blankWorkspace.js";
import { checkWorkspaceIntegrity } from "../src/domain/integrity.js";
import { seedWorkspace } from "../src/domain/workspaceSeed.js";
import { CURRENT_SCHEMA_VERSION } from "../src/persistence/migrations.js";
import { normalizeLoadedWorkspace } from "../src/persistence/normalize.js";
import { markdownToBlocks, captureTitle } from "../src/domain/markdownBlocks.js";
import { newNotePage } from "../src/domain/newPage.js";
import { topLevelPages } from "../src/domain/navigation.js";
import { inboxPages, archivePages } from "../src/domain/inbox.js";
import { createDesktopBackupContext } from "./desktop/backup-helpers.mjs";
import { installWorkspaceFixedDate } from "./desktop/helpers.mjs";

const time = "2026-10-01T08:00:00.000Z";
const appSource = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");

function blank() {
  let sequence = 0;
  return createBlankWorkspace({ now: time, idFactory: (prefix) => `${prefix}-${++sequence}` });
}

function captureFromApp(workspace) {
  const capture = appSource.match(/  function saveQuickCapture\(\{ title, body, open \}\) \{[\s\S]*?\n  \}/);
  const sort = appSource.match(/function nextSortIndex\(items\) \{[\s\S]*?\n\}/);
  const colors = appSource.match(/const iconColorChoices = \[[\s\S]*?\n\];/);
  assert.ok(capture, "The real quick capture handler must be tested");
  assert.ok(sort);
  assert.ok(colors);
  let captured = workspace;
  let sequence = 0;
  let captureOpen = true;
  let notice = "";
  const realm = vm.createContext({
    workspace, folders: workspace.folders, pages: workspace.pages, markdownToBlocks, captureTitle, newNotePage, pagesOf: topLevelPages,
    makeId: (prefix) => `${prefix}-capture-${++sequence}`,
    setWorkspace: (update) => { captured = update(captured); },
    setCaptureOpen: (value) => { captureOpen = value; },
    setWorkspaceNotice: (value) => { notice = value; },
  });
  vm.runInContext(`${colors[0]}\n${sort[0]}\n(${installWorkspaceFixedDate.toString()})(${Date.parse(time)});\n${capture[0]}\nsaveQuickCapture({ title: "第一条快速记录", body: "# 第一次记录\\n- [ ] 核对保存", open: false });`, realm);
  assert.equal(captureOpen, false);
  assert.equal(notice, "已保存到收件箱");
  return structuredClone(captured);
}

test("blank workspace has one folder and the welcome page", () => {
  const workspace = blank();
  assert.equal(workspace.schemaVersion, CURRENT_SCHEMA_VERSION);
  assert.equal(workspace.folders.filter((folder) => !folder.system).length, 1);
  assert.equal(workspace.folders.filter((folder) => folder.system === "inbox").length, 1);
  assert.equal(workspace.folders.length, 2);
  assert.equal(workspace.folders[0].name, "我的空间");
  assert.equal(workspace.pages.length, 1);
  assert.equal(workspace.pages[0].title, "开始使用 Life Atlas");
  assert.equal(workspace.pages[0].folderId, workspace.folders[0].id);
  assert.equal(workspace.pages[0].icon, "👋");
  assert.deepEqual(workspace.pages[0].content.map(({ type, content }) => ({ type, content })), [
    { type: "heading", content: "欢迎" },
    { type: "paragraph", content: "这里是你的私人工作空间，所有内容只保存在这台电脑的数据目录里。" },
    { type: "checkListItem", content: "输入 / 试试添加标题、待办、表格和数据库" },
    { type: "checkListItem", content: "在左上角菜单里找到“备份与恢复”，导出第一份完整备份" },
    { type: "checkListItem", content: "打开模板库，试试“软件开发进程”模板" },
  ]);
  assert.equal(workspace.pages[0].content[0].props.level, 2);
  assert.ok(workspace.pages[0].content.slice(2).every((block) => block.props.checked === false));
});

test("blank workspace passes the integrity checker", () => {
  assert.equal(checkWorkspaceIntegrity(blank()).ok, true);
});

test("blank workspace contains no seed sample data", () => {
  const sampleTitles = new Set((seedWorkspace.pages || []).map((page) => page.title));
  assert.ok(blank().pages.every((page) => !sampleTitles.has(page.title)));
});

test("fresh blank initializes the unique WP13 inbox without consuming ordinary IDs", () => {
  const workspace = blank();
  const inboxes = workspace.folders.filter((folder) => folder.system === "inbox");
  assert.equal(inboxes.length, 1);
  assert.deepEqual(inboxes[0], { id: "system-inbox", system: "inbox", name: "收件箱", parentId: null, color: "stone", sortIndex: -1, lastOpenedPageId: null, trashedAt: null, trashedByFolderId: null, createdAt: time, updatedAt: time });
  assert.equal(workspace.folders.filter((folder) => !folder.system).length, 1);
  assert.equal(workspace.folders.find((folder) => !folder.system).id, "folder-1");
  assert.equal(workspace.pages.length, 1);
  assert.equal(workspace.pages[0].id, "page-2");
  assert.equal(workspace.workspaceId, "ws-3");
  assert.deepEqual(inboxPages(workspace), []);
});

test("normalizing a fresh current-schema blank keeps one empty inbox", () => {
  const workspace = blank();
  assert.equal(workspace.schemaVersion, CURRENT_SCHEMA_VERSION);
  const normalized = normalizeLoadedWorkspace(workspace, { fallbackWorkspace: workspace, now: time });
  const repeated = normalizeLoadedWorkspace(normalized, { fallbackWorkspace: normalized, now: time });
  assert.equal(normalized.folders.filter((folder) => folder.system === "inbox").length, 1);
  assert.deepEqual(repeated, normalized);
  assert.deepEqual(inboxPages(repeated), []);
  assert.equal(repeated.pages[0].id, workspace.pages[0].id);
});

test("a freshly loaded current-schema blank can capture and durably reload inbox pages", async (context) => {
  const source = await createDesktopBackupContext(context, { seed: false, retainOnFailure: true });
  const loaded = await source.workspaceService.load();
  context.diagnostic(`freshRoot=${source.dataRoot}; freshSchema=${loaded.workspace.schemaVersion}; folders=${loaded.workspace.folders.length}; inboxes=${loaded.workspace.folders.filter((folder) => folder.system === "inbox").length}`);
  assert.equal(loaded.workspace.schemaVersion, CURRENT_SCHEMA_VERSION);
  const captured = captureFromApp(loaded.workspace);
  const pending = inboxPages(captured);
  assert.equal(pending.length, 1);
  const page = pending[0];
  assert.equal(page.folderId, "system-inbox");
  assert.equal(page.inboxedAt, time);
  assert.equal(page.title, "第一条快速记录");
  assert.deepEqual(page.content.map((block) => block.type), ["heading", "checkListItem"]);
  assert.equal(captured.pages.length, loaded.workspace.pages.length + 1);
  await source.workspaceService.applyChanges({ generation: loaded.generation, schemaVersion: CURRENT_SCHEMA_VERSION, upserts: [{ collection: "pages", id: page.id, json: JSON.stringify(page) }], deletes: [], ui: null });
  const reopened = await source.workspaceService.reopen();
  assert.equal(reopened.workspace.folders.filter((folder) => folder.system === "inbox").length, 1);
  assert.deepEqual(inboxPages(reopened.workspace), [page]);
  assert.equal(reopened.workspace.pages.find((candidate) => candidate.id === loaded.workspace.pages[0].id).title, "开始使用 Life Atlas");
  const ordinary = reopened.workspace.folders.find((folder) => !folder.system);
  const archived = archivePages(reopened.workspace, [page.id], ordinary.id, time);
  assert.deepEqual(inboxPages(archived), []);
  assert.equal(archived.pages.length, reopened.workspace.pages.length);
  assert.deepEqual(archived.pages.find((candidate) => candidate.id === page.id), { ...page, folderId: ordinary.id, inboxedAt: null, updatedAt: time });
  source.complete();
});
