export function compareNavigationOrder(a, b) {
  return (a?.sortIndex ?? 0) - (b?.sortIndex ?? 0)
    || String(a?.name ?? a?.title ?? "").localeCompare(String(b?.name ?? b?.title ?? ""));
}

export function childFolders(folders, parentId) {
  return (folders || []).filter((folder) => folder.parentId === parentId && !folder.trashedAt && !folder.system).sort(compareNavigationOrder);
}

export function folderAncestors(folders, id) {
  const ancestors = [];
  const byId = new Map((folders || []).map((folder) => [folder.id, folder]));
  const seen = new Set();
  let current = byId.get(id);
  while (current && !seen.has(current.id)) {
    ancestors.unshift(current);
    seen.add(current.id);
    current = byId.get(current.parentId);
  }
  return ancestors;
}

export function isDuplicateCompanionPage(page, siblings, sources) {
  if (!page || page.pageType === "database") return false;
  const blocks = Array.isArray(page.content) ? page.content : [];
  const dbBlocks = blocks.filter((block) => block?.type === "databaseView");
  if (dbBlocks.length !== 1) return false;
  const otherBlocks = blocks.filter((block) => block?.type !== "databaseView");
  if (otherBlocks.length !== 1) return false;
  const dbBlock = dbBlocks[0];
  const sourceId = dbBlock.props?.sourceId;
  if (!sourceId) return false;

  return (siblings || []).some((sibling) =>
    sibling.id !== page.id
    && !sibling.trashedAt
    && sibling.pageType === "database"
    && (sibling.databaseSourceId === sourceId || sibling.id === sources?.get(sourceId)?.ownerPageId)
    && sibling.title === page.title,
  );
}

export function topLevelPages(pages, folderId, sources = null) {
  const top = (pages || []).filter((page) =>
    page.folderId === folderId
    && !page.trashedAt
    && !page.parentPageId
    && (!page.databaseSourceId || page.pageType === "database"),
  );
  const filtered = sources ? top.filter((page) => !isDuplicateCompanionPage(page, top, sources)) : top;
  return filtered.sort(compareNavigationOrder);
}

// Rebuild when pages/dataSources/databaseViews change, then share across tree rows.
export function createPageNavigationIndex(workspace) {
  const pagesById = new Map();
  const childrenByParent = new Map();
  for (const page of workspace?.pages || []) {
    pagesById.set(page.id, page);
    const parentId = page.parentPageId;
    if (parentId && parentId !== page.id && !page.trashedAt
      && (!page.databaseSourceId || page.pageType === "database")) {
      if (!childrenByParent.has(parentId)) childrenByParent.set(parentId, []);
      childrenByParent.get(parentId).push(page);
    }
  }
  return {
    pagesById, childrenByParent,
    sourcesById: new Map((workspace?.dataSources || []).map((source) => [source.id, source])),
    viewsById: new Map((workspace?.databaseViews || []).map((view) => [view.id, view])),
  };
}

export function databaseNavigationEntries(workspace, pageId, index = createPageNavigationIndex(workspace)) {
  const { pagesById, sourcesById: sources, viewsById: views } = index;
  const owner = pagesById.get(pageId);
  if (!owner || owner.trashedAt) return [];
  const isDatabaseOwner = owner.pageType === "database" || Boolean(owner.databaseSourceId);
  if (!isDatabaseOwner) return [];

  const sourceId = owner.databaseSourceId
    || [...sources.values()].find((source) => source.ownerPageId === owner.id && !source.trashedAt)?.id;
  const source = sourceId ? sources.get(sourceId) : null;
  if (!source || source.trashedAt) return [];

  let occurrenceViewIds = null;
  let canonicalBlockId = null;
  if (Array.isArray(owner.content)) {
    const queue = [...owner.content];
    while (queue.length) {
      const block = queue.shift();
      if (block?.type === "databaseView" && block.props?.sourceId === source.id) {
        canonicalBlockId = block.id;
        if (typeof block.props?.viewIdsJson === "string") {
          try {
            const parsed = JSON.parse(block.props.viewIdsJson);
            if (Array.isArray(parsed)) occurrenceViewIds = parsed;
          } catch {}
        }
        break;
      }
      if (Array.isArray(block?.children)) queue.push(...block.children);
    }
  }

  const orderedViews = [];
  if (occurrenceViewIds) {
    for (const viewId of occurrenceViewIds) {
      const view = views.get(viewId);
      if (view && !view.trashedAt && view.sourceId === source.id) {
        orderedViews.push(view);
      }
    }
  }
  if (!orderedViews.length) {
    const sourceViews = [...views.values()]
      .filter((view) => view.sourceId === source.id && !view.trashedAt)
      .sort(compareNavigationOrder);
    orderedViews.push(...sourceViews);
  }

  return orderedViews.map((view) => ({
    key: `databaseView:${owner.id}:${view.id}`,
    kind: "databaseView",
    pageId: owner.id,
    blockId: canonicalBlockId,
    sourceId: source.id,
    viewId: view.id,
    label: view.name || "未命名视图",
    isCanonicalView: true,
  }));
}

// The document supplies appearance order, while parentPageId supplies ownership.
// A link to an unrelated page never turns that page into a sidebar child.
export function pageNavigationEntries(workspace, parentPageId, index = createPageNavigationIndex(workspace), options = {}) {
  const { pagesById, childrenByParent, sourcesById: sources, viewsById: views } = index;
  const owner = pagesById.get(parentPageId);
  if (!owner || owner.trashedAt) return [];
  const entries = [];
  if (options.includeDatabaseViews) {
    entries.push(...databaseNavigationEntries(workspace, parentPageId, index));
  }
  const children = new Map((childrenByParent.get(parentPageId) || []).map((page) => [page.id, page]));
  const linkedViewOf = (page) => {
    if (page.pageType === "database" || !Array.isArray(page.content) || page.content.length !== 1) return null;
    const block = page.content[0];
    if (block?.type !== "databaseView" || !block.id) return null;
    const source = sources.get(block.props?.sourceId);
    const view = views.get(block.props?.viewId);
    if (!source || source.trashedAt || !view || view.trashedAt
      || view.sourceId !== source.id || source.ownerPageId === page.id) return null;
    return { sourceId: source.id, viewId: view.id, blockId: block.id };
  };
  const ownerLinkedView = linkedViewOf(owner);
  const viewBlockIds = new Set();
  const addPage = (page) => {
    children.delete(page.id);
    if (isDuplicateCompanionPage(page, childrenByParent.get(parentPageId) || [], sources)) {
      return;
    }
    const linkedDatabaseView = linkedViewOf(page);
    const source = linkedDatabaseView && sources.get(linkedDatabaseView.sourceId);
    const linkedLabel = source && (!page.title || ["新页面", "Untitled", "无标题"].includes(page.title) || page.title === source.title);
    entries.push({
      key: `page:${page.id}`, kind: "page", pageId: page.id,
      label: linkedLabel ? `View of ${source.title || "新数据库"}` : page.title || "无标题页面", page,
      ...(linkedDatabaseView ? { linkedDatabaseView } : {}),
    });
  };
  const stack = Array.isArray(owner.content) ? [...owner.content].reverse() : [];
  const seen = new Set();
  while (stack.length) {
    const block = stack.pop();
    if (!block || typeof block !== "object" || seen.has(block)) continue;
    seen.add(block);
    if (block.type === "pageLink") {
      const child = children.get(block.props?.pageId);
      if (child) addPage(child);
    } else if (block.type === "databaseView" && block.id && block.id !== ownerLinkedView?.blockId && !viewBlockIds.has(block.id)) {
      const source = sources.get(block.props?.sourceId);
      const view = views.get(block.props?.viewId);
      // The source owner's canonical block is already represented by its page.
      if (source && !source.trashedAt && view && !view.trashedAt
        && view.sourceId === source.id && source.ownerPageId !== owner.id) {
        entries.push({
          key: `databaseView:${owner.id}:${block.id}`, kind: "databaseView", pageId: owner.id,
          label: `View of ${source.title || "新数据库"}`,
          sourceId: source.id, viewId: view.id, blockId: block.id,
        });
        viewBlockIds.add(block.id);
      }
    }
    if (Array.isArray(block.children)) {
      for (let index = block.children.length - 1; index >= 0; index -= 1) stack.push(block.children[index]);
    }
  }
  const unlinkedChildren = [...children.values()].filter((child) =>
    !isDuplicateCompanionPage(child, childrenByParent.get(parentPageId) || [], sources),
  );
  unlinkedChildren.sort(compareNavigationOrder).forEach(addPage);
  return entries;
}

export function pageAncestors(pages, pageId) {
  const byId = new Map((pages || []).map((page) => [page.id, page]));
  const page = byId.get(pageId);
  if (!page || page.trashedAt) return [];
  const ancestors = [];
  const seen = new Set([pageId]);
  let current = byId.get(page.parentPageId);
  while (current && !current.trashedAt && !seen.has(current.id)) {
    ancestors.unshift(current);
    seen.add(current.id);
    current = byId.get(current.parentPageId);
  }
  return ancestors;
}

export function moveFolder(workspace, folderId, targetParentId, now) {
  const folders = workspace.folders || [];
  const source = folders.find((folder) => folder.id === folderId);
  if (source?.system) throw new Error("系统文件夹不能删除、移动或改名");
  if (!source || source.trashedAt) throw new Error("文件夹不可用");
  const parentId = targetParentId ?? null;
  const target = parentId === null ? null : folders.find((folder) => folder.id === parentId);
  if (target?.system) throw new Error("系统文件夹不能删除、移动或改名");
  if (parentId !== null && (!target || target.trashedAt)) throw new Error("目标文件夹不可用");
  const folderMap = new Map(folders.map((folder) => [folder.id, folder]));
  const seen = new Set();
  let ancestor = target;
  while (ancestor && !seen.has(ancestor.id)) {
    if (ancestor.id === folderId) throw new Error("不能把文件夹移动到它自己或它的子文件夹里");
    seen.add(ancestor.id);
    ancestor = folderMap.get(ancestor.parentId);
  }
  const siblings = folders.filter((folder) => folder.id !== folderId && folder.parentId === parentId);
  const sortIndex = siblings.reduce((maximum, folder) => Math.max(maximum, Number(folder.sortIndex) || 0), 0) + 10;
  return { ...workspace, folders: folders.map((folder) => folder.id === folderId ? { ...folder, parentId, sortIndex, updatedAt: now } : folder) };
}

export function renameFolder(workspace, folderId, name, now) {
  const folder = workspace.folders?.find((entry) => entry.id === folderId);
  if (folder?.system) throw new Error("系统文件夹不能删除、移动或改名");
  if (!folder || folder.trashedAt) throw new Error("文件夹不可用");
  return { ...workspace, folders: workspace.folders.map((entry) => entry.id === folderId ? { ...entry, name, updatedAt: now } : entry) };
}
