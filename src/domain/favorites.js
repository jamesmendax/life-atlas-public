import { folderAncestors } from "./navigation.js";
import { isPageArchived } from "./archive.js";

export function toggleFavorite(ui, pageId) {
  const ids = Array.isArray(ui?.favoritePageIds) ? ui.favoritePageIds : [];
  return { ...ui, favoritePageIds: ids.includes(pageId) ? ids.filter((id) => id !== pageId) : [...ids, pageId] };
}

export function moveFavorite(ui, pageId, toIndex) {
  const ids = [...new Set(Array.isArray(ui?.favoritePageIds) ? ui.favoritePageIds : [])];
  const index = ids.indexOf(pageId);
  if (index < 0 || !Number.isFinite(toIndex)) return ui;
  ids.splice(index, 1);
  ids.splice(Math.max(0, Math.min(ids.length, Math.trunc(toIndex))), 0, pageId);
  return { ...ui, favoritePageIds: ids };
}

export function favoritePages(workspace, { includeArchived = false } = {}) {
  const pages = new Map((workspace.pages || []).map((page) => [page.id, page]));
  return [...new Set(Array.isArray(workspace.ui?.favoritePageIds) ? workspace.ui.favoritePageIds : [])].map((id) => pages.get(id)).filter((page) => page && !page.trashedAt && (includeArchived || !isPageArchived(workspace, page.id)) && folderAncestors(workspace.folders, page.folderId).every((folder) => !folder.trashedAt));
}
