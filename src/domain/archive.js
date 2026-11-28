import { ownedDescendantPageIds } from "./pageOwnership.js";

const indexes = new WeakMap();

function archiveIndex(workspace) {
  if (!workspace || typeof workspace !== "object") return new Set();
  const cached = indexes.get(workspace);
  if (cached && cached.pages === workspace.pages && cached.sources === workspace.dataSources && cached.items === workspace.databaseItems) return cached.ids;
  const roots = (workspace.pages || []).filter((page) => page.archivedAt).map((page) => page.id);
  const ids = new Set(roots.length ? [...roots, ...ownedDescendantPageIds(workspace, roots)] : []);
  indexes.set(workspace, { pages: workspace.pages, sources: workspace.dataSources, items: workspace.databaseItems, ids });
  return ids;
}

export function archivedPageIds(workspace) { return new Set(archiveIndex(workspace)); }

export function isPageArchived(workspace, pageOrId) {
  return archiveIndex(workspace).has(typeof pageOrId === "string" ? pageOrId : pageOrId?.id);
}

export function archiveRootPageId(workspace, pageId) {
  const pages = new Map((workspace.pages || []).map((page) => [page.id, page]));
  const owners = new Map((workspace.dataSources || []).map((source) => [source.id, source.ownerPageId]));
  const recordOwners = new Map((workspace.databaseItems || []).map((item) => [item.pageId, owners.get(item.sourceId)]));
  const pending = [pageId], seen = new Set();
  while (pending.length) {
    const id = pending.shift();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const page = pages.get(id);
    if (page?.archivedAt) return id;
    pending.push(page?.parentPageId, recordOwners.get(id));
  }
  return null;
}

export function archivePage(workspace, pageId, archived = true, now = new Date().toISOString()) {
  const page = workspace.pages?.find((entry) => entry.id === pageId);
  if (!page || page.trashedAt || Boolean(page.archivedAt) === Boolean(archived)) return workspace;
  const time = new Date(now).toISOString();
  return {
    ...workspace,
    pages: workspace.pages.map((entry) => entry.id === pageId
      ? { ...entry, archivedAt: archived ? time : null, updatedAt: time } : entry),
  };
}

export function visibleArchivePages(workspace, { status = "active" } = {}) {
  const archived = archiveIndex(workspace);
  return (workspace.pages || []).filter((page) => !page.trashedAt
    && (status === "all" || archived.has(page.id) === (status === "archived")));
}
