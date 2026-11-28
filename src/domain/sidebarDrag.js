import { childFolders, compareNavigationOrder, folderAncestors, moveFolder, topLevelPages } from "./navigation.js";
import { moveOwnedPage } from "./pageMoves.js";

function isFolderDescendant(folders, ancestorId, candidateParentId) {
  if (!candidateParentId) return false;
  if (candidateParentId === ancestorId) return true;
  return folderAncestors(folders, candidateParentId).some((folder) => folder.id === ancestorId);
}

export function canDropSidebarNode(workspace, source, target, position = "inside") {
  if (!source || !target || !["page", "folder"].includes(source.kind) || !["inside", "before", "after"].includes(position)) return false;
  const sourceNode = (source.kind === "folder" ? workspace.folders : workspace.pages)?.find((entry) => entry.id === source.id && !entry.trashedAt);
  if (!sourceNode || sourceNode.system || (source.kind === "page" && (sourceNode.parentPageId || sourceNode.databaseSourceId && sourceNode.pageType !== "database"))) return false;
  if (target.kind === "root") {
    if (source.kind !== "folder") return false;
    if (position === "inside") return sourceNode.parentId !== null;
    if (sourceNode.parentId !== null) return true;
    return childFolders(workspace.folders, null).length > 1;
  }
  const targetNode = (target.kind === "folder" ? workspace.folders : workspace.pages)?.find((entry) => entry.id === target.id && !entry.trashedAt);
  if (!targetNode || targetNode.system || source.kind === target.kind && source.id === target.id) return false;
  if (position !== "inside") {
    if (source.kind !== target.kind) return false;
    if (source.kind === "folder") {
      return !isFolderDescendant(workspace.folders, source.id, targetNode.parentId ?? null);
    }
    return !targetNode.parentPageId;
  }
  if (target.kind !== "folder") return false;
  if (source.kind === "page") return sourceNode.folderId !== target.id;
  return sourceNode.parentId !== target.id && !folderAncestors(workspace.folders, target.id).some((folder) => folder.id === source.id);
}

export function moveSidebarNode(workspace, source, target, position, now) {
  if (!canDropSidebarNode(workspace, source, target, position)) return workspace;
  if (target.kind === "root") {
    const sourceFolder = workspace.folders.find((entry) => entry.id === source.id);
    const base = sourceFolder.parentId !== null ? moveFolder(workspace, source.id, null, now) : workspace;
    const moved = base.folders.find((entry) => entry.id === source.id);
    const siblings = childFolders(base.folders, null).filter((entry) => entry.id !== source.id).sort(compareNavigationOrder);
    if (position === "before") siblings.unshift(moved);
    else siblings.push(moved);
    const order = new Map(siblings.map((entry, entryIndex) => [entry.id, (entryIndex + 1) * 10]));
    return {
      ...base,
      folders: base.folders.map((entry) => order.has(entry.id) ? { ...entry, sortIndex: order.get(entry.id), updatedAt: now } : entry),
    };
  }
  if (position === "inside") {
    if (source.kind === "folder") return moveFolder(workspace, source.id, target.id, now);
    const siblings = topLevelPages(workspace.pages, target.id);
    const sortIndex = Math.max(0, ...siblings.map((page) => Number(page.sortIndex) || 0)) + 10;
    return moveOwnedPage(workspace, source.id, { folderId: target.id, sortIndex, now });
  }
  if (source.kind === "folder") {
    const sourceFolder = workspace.folders.find((entry) => entry.id === source.id);
    const targetFolder = workspace.folders.find((entry) => entry.id === target.id);
    const targetParentId = targetFolder.parentId ?? null;
    const base = sourceFolder.parentId !== targetParentId ? moveFolder(workspace, source.id, targetParentId, now) : workspace;
    const moved = base.folders.find((entry) => entry.id === source.id);
    const siblings = childFolders(base.folders, targetParentId).filter((entry) => entry.id !== source.id).sort(compareNavigationOrder);
    const index = siblings.findIndex((entry) => entry.id === target.id) + (position === "after" ? 1 : 0);
    siblings.splice(index, 0, moved);
    const order = new Map(siblings.map((entry, entryIndex) => [entry.id, (entryIndex + 1) * 10]));
    return {
      ...base,
      folders: base.folders.map((entry) => order.has(entry.id) ? { ...entry, sortIndex: order.get(entry.id), updatedAt: now } : entry),
    };
  }
  const sourcePage = workspace.pages.find((entry) => entry.id === source.id);
  const targetPage = workspace.pages.find((entry) => entry.id === target.id);
  const targetFolderId = targetPage.folderId;
  const base = sourcePage.folderId !== targetFolderId
    ? moveOwnedPage(workspace, source.id, { folderId: targetFolderId, sortIndex: 0, now })
    : workspace;
  const moved = base.pages.find((entry) => entry.id === source.id);
  const siblings = topLevelPages(base.pages, targetFolderId).filter((entry) => entry.id !== source.id).sort(compareNavigationOrder);
  const index = siblings.findIndex((entry) => entry.id === target.id) + (position === "after" ? 1 : 0);
  siblings.splice(index, 0, moved);
  const order = new Map(siblings.map((entry, entryIndex) => [entry.id, (entryIndex + 1) * 10]));
  return {
    ...base,
    pages: base.pages.map((entry) => order.has(entry.id) ? { ...entry, sortIndex: order.get(entry.id), updatedAt: now } : entry),
  };
}
