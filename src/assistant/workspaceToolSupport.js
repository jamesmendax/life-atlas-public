import { stableJson, walkBlocks } from "../domain/blockDocument.js";
import { markdownToBlocks } from "../domain/markdownBlocks.js";
import { childFolders, folderAncestors } from "../domain/navigation.js";
import { latestVersionOf, snapshotSignature } from "../domain/pageHistory.js";
import { applyTrackedPageEdit } from "../domain/pageHistoryCapture.js";

export class WorkspaceToolError extends Error {}

export const toolError = (message) => { throw new WorkspaceToolError(message); };
export const toolResult = (workspace, value) => ({ workspace, result: { ok: true, ...value } });
export const labelOf = (page) => page.title || "无标题页面";
export const pageIdentity = (page) => ({ page_id: page.id, title: labelOf(page).slice(0, 240) });
export const nextSortIndex = (items) => items.reduce((last, entry) => Math.max(last, entry.sortIndex || 0), 0) + 10;
export const pageById = (workspace, id) => workspace.pages.find((page) => page.id === id);

export function availableFolder(workspace, id) {
  const path = folderAncestors(workspace.folders, id);
  return path[0]?.parentId === null && path.every((folder) => !folder.trashedAt && !folder.system) ? path.at(-1) : null;
}

export function resolveCreationFolder(workspace, requestedId, { currentFolderId, now, idFactory }) {
  const folder = availableFolder(workspace, requestedId || currentFolderId);
  if (requestedId && !folder) toolError("目标文件夹已不可用。");
  const existing = folder ?? childFolders(workspace.folders, null)[0];
  if (existing) return { workspace, folder: existing };
  const fallback = {
    id: idFactory("folder"), parentId: null, name: "我的空间", color: "stone", sortIndex: 10, lastOpenedPageId: null,
    trashedAt: null, trashedByFolderId: null, createdAt: now, updatedAt: now,
  };
  return { workspace: { ...workspace, folders: [...workspace.folders, fallback] }, folder: fallback };
}

export function getPage(workspace, id, currentPageId, { edit = false, trashed = false } = {}) {
  const page = pageById(workspace, id === "current" ? currentPageId : id);
  if (!page || Boolean(page.trashedAt) !== trashed) toolError(trashed ? "未找到可恢复的页面。" : "未找到可用页面。");
  if (edit && page.settings?.locked) toolError("页面已锁定，解除锁定后可编辑。");
  return page;
}

export function checkAuthoringBlockLimit(blocks) {
  if (walkBlocks(blocks).length > 400) toolError("一次最多可以写入 400 个区块。");
  return blocks;
}

export function markdownDocument(markdown, idFactory, options = {}) {
  const checkTableSize = (size) => { if (size > 8000) toolError("一个表格最多可以写入 8000 个单元格。"); };
  return checkAuthoringBlockLimit(markdownToBlocks(markdown, { idFactory, extended: true, preserveLinks: true, checkTableSize, ...options }));
}

export function editedPage(workspace, page, patch, { time, idFactory }, requiresVersion = false) {
  if (!Object.entries(patch).some(([key, value]) => stableJson(value) !== stableJson(page[key]))) return workspace;
  const beforeEditId = idFactory("ver");
  const next = applyTrackedPageEdit(workspace, { pageId: page.id, patch: {
    ...patch, ...(Object.hasOwn(patch, "content") ? { importRevision: (page.importRevision || 0) + 1 } : {}),
  }, now: time, beforeEditId });
  if (requiresVersion && next !== workspace
    && !next.pageVersions?.some((version) => version.id === beforeEditId)
    && snapshotSignature(latestVersionOf(next.pageVersions, page.id)) !== snapshotSignature(page)) {
    toolError("页面过大，无法保存修改前的可恢复版本。");
  }
  return next;
}
