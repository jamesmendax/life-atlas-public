import { archivedPageIds } from "./archive.js";

function editablePage(page, archived) {
  return Boolean(page && !page.trashedAt && !page.settings?.locked && !archived.has(page.id));
}

export function canEditDatabaseSource(workspace, sourceId, archived = archivedPageIds(workspace)) {
  const source = workspace.dataSources?.find((entry) => entry.id === sourceId);
  if (!source || source.trashedAt || source.locked) return false;
  return !source.ownerPageId || editablePage(workspace.pages.find((page) => page.id === source.ownerPageId), archived);
}

export function canEditDatabaseItems(workspace, sourceId, itemIds) {
  const archived = archivedPageIds(workspace);
  if (!canEditDatabaseSource(workspace, sourceId, archived)) return false;
  const wanted = new Set(itemIds);
  const pages = new Map(workspace.pages.map((page) => [page.id, page]));
  for (const item of workspace.databaseItems || []) {
    if (!wanted.has(item.id)) continue;
    if (item.sourceId !== sourceId || item.trashedAt || item.locked || !editablePage(pages.get(item.pageId), archived)) return false;
    wanted.delete(item.id);
  }
  return wanted.size === 0;
}
