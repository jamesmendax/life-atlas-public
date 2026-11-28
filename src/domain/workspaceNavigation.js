import { childFolders, compareNavigationOrder } from "./navigation.js";
import { isPageArchived } from "./archive.js";
import { favoritePages } from "./favorites.js";
import { recentGroups } from "./recents.js";

const pageTitle = (page) => page.title || "无标题页面";
const sourceTitle = (source) => source.title || "新数据库";

export function createWorkspaceNavigation(workspace) {
  const folders = workspace.folders || [];
  const pages = workspace.pages || [];
  const pagesById = new Map(pages.map((page) => [page.id, page]));
  const foldersById = new Map(folders.map((folder) => [folder.id, folder]));
  const sourcesById = new Map((workspace.dataSources || []).map((source) => [source.id, source]));
  const recordsByPageId = new Map((workspace.databaseItems || []).map((item) => [item.pageId, item]));
  const multipleSourceOwners = new Set();
  const singleSourceOwners = new Set();
  for (const source of sourcesById.values()) {
    if (source.trashedAt || !source.ownerPageId) continue;
    if (singleSourceOwners.has(source.ownerPageId)) multipleSourceOwners.add(source.ownerPageId);
    else singleSourceOwners.add(source.ownerPageId);
  }
  const recordSource = (page) => sourcesById.get(recordsByPageId.get(page.id)?.sourceId || (page.pageType !== "database" ? page.databaseSourceId : null));
  function ancestors(index, id, parentProperty) {
    const chain = [];
    const seen = new Set();
    let current = index.get(id);
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      chain.push(current);
      current = index.get(current[parentProperty]);
    }
    return chain.reverse();
  }
  const folderPath = (id) => ancestors(foldersById, id, "parentId");
  const familyPath = (id) => ancestors(pagesById, id, "parentPageId");
  const isVisibleFolder = (id) => folderPath(id).every((folder) => !folder.trashedAt);
  const pageVisibility = new Map();
  function canOpenPage(id) {
    if (!pageVisibility.has(id)) {
      pageVisibility.set(id, pagesById.has(id) && familyPath(id).every((page) =>
        !page.trashedAt && isVisibleFolder(page.folderId) && !recordsByPageId.get(page.id)?.trashedAt && !recordSource(page)?.trashedAt,
      ));
    }
    return pageVisibility.get(id);
  }
  const isVisiblePage = (id) => canOpenPage(id) && !isPageArchived(workspace, id);
  const toPage = (page) => ({ kind: "page", id: page.id, label: pageTitle(page), icon: page.icon, iconColor: page.iconColor });
  const toFolder = (folder) => ({ kind: "folder", id: folder.id, label: folder.name, color: folder.color });
  function pagePath(page, visited = new Set()) {
    if (visited.has(page.id)) return [];
    visited.add(page.id);
    const source = recordSource(page);
    const owner = source && pagesById.get(source.ownerPageId);
    if (owner && owner.id !== page.id && canOpenPage(owner.id)) {
      const prefix = pagePath(owner, visited);
      const needsSource = sourceTitle(source) !== pageTitle(owner)
        || multipleSourceOwners.has(owner.id);
      return [...prefix, ...(needsSource ? [{ kind: "source", id: source.id, label: sourceTitle(source) }] : []), toPage(page)];
    }
    return [
      ...folderPath(page.folderId).filter((folder) => !folder.system).map(toFolder),
      ...familyPath(page.id).slice(0, -1).map(toPage),
      toPage(page),
    ];
  }
  function sameLevel(node) {
    if (node.kind === "folder") {
      const { parentId } = foldersById.get(node.id);
      return childFolders(folders, parentId).filter((folder) => isVisibleFolder(folder.id)).map(toFolder);
    }
    const page = pagesById.get(node.id);
    const source = recordSource(page);
    return pages.filter((candidate) => {
      if (!isVisiblePage(candidate.id)) return false;
      const otherSource = recordSource(candidate);
      if (source || otherSource) return Boolean(source && otherSource?.id === source.id);
      if (page.parentPageId || candidate.parentPageId) return page.parentPageId === candidate.parentPageId;
      return (page.folderId ?? null) === (candidate.folderId ?? null);
    }).sort(compareNavigationOrder).map(toPage);
  }
  function breadcrumbs(pageId, folderId) {
    const page = pagesById.get(pageId);
    const path = page && canOpenPage(page.id) ? pagePath(page) : folderPath(folderId)
      .filter((folder) => !folder.system && isVisibleFolder(folder.id)).map(toFolder);
    return path.map((node) => ({ ...node, alternatives: node.kind === "source" ? [] : sameLevel(node) }));
  }
  const libraryEntry = (page) => ({ ...toPage(page), path: ["Private", ...pagePath(page).slice(0, -1).map((entry) => entry.label)].join(" / ") });
  function libraryGroups(now, status = "active") {
    const includes = status === "active" ? isVisiblePage : (id) => canOpenPage(id) && (status === "all" || isPageArchived(workspace, id));
    const candidates = { includeArchived: status === "all" || status === "archived" };
    const privateEntries = pages.filter((page) => includes(page.id)).map(libraryEntry)
      .sort((left, right) => left.path.localeCompare(right.path, "zh-CN") || left.label.localeCompare(right.label, "zh-CN"));
    return [
      { id: "private", label: "私人", empty: "还没有页面。", entries: privateEntries },
      { id: "favorites", label: "收藏", empty: "还没有收藏的页面。", entries: favoritePages(workspace, candidates).filter((page) => includes(page.id)).map(libraryEntry) },
      { id: "recents", label: "最近", empty: "打开页面后会出现在这里。", entries: recentGroups(workspace, now, candidates).flatMap((group) => group.entries)
        .filter((entry) => includes(entry.pageId)).map((entry) => ({ ...libraryEntry(pagesById.get(entry.pageId)), visitedAt: entry.visitedAt })) },
    ];
  }
  return { breadcrumbs, canOpenPage, isVisiblePage, libraryGroups, pageById: (id) => pagesById.get(id) };
}

export function restoreWorkspacePageTabs(preferences, workspaceId, navigation) {
  const session = preferences.reopenPageTabs && workspaceId ? preferences.pageTabs[workspaceId] : null;
  if (!session) return { ids: [], activeId: null };
  const ids = session.ids.filter(navigation.canOpenPage);
  return { ids, activeId: session.activeId ? ids.includes(session.activeId) ? session.activeId : ids.at(-1) ?? null : null };
}
