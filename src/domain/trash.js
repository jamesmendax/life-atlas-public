import { walkBlocks } from "./blockDocument.js";
import { attachmentIdFromUrl } from "./attachments.js";
import { assetHashFromUrl } from "./attachmentUrls.js";
import { visitDatabaseVersionFiles } from "./databaseHistoryFiles.js";
import { compareNavigationOrder } from "./navigation.js";
import { isTrashExpired, trashDaysRemaining } from "./pageActions.js";
import { ownedDescendantPageIds } from "./pageOwnership.js";
export { ownedDescendantPageIds } from "./pageOwnership.js";

function isTrashRoot(entity) {
  return Boolean(entity?.trashedAt && !entity.trashedByFolderId && !entity.trashedByPageId);
}

function trashRoots(workspace) {
  return [
    ...(workspace.folders || []).filter(isTrashRoot).map((entity) => ({ kind: "folder", entity })),
    ...(workspace.pages || []).filter(isTrashRoot).map((entity) => ({ kind: "page", entity })),
  ];
}

function folderBranchIds(workspace, folderId) {
  const ids = new Set([folderId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const folder of workspace.folders || []) {
      if (!ids.has(folder.id) && ids.has(folder.parentId)) {
        ids.add(folder.id);
        changed = true;
      }
    }
  }
  return ids;
}

function folderAncestors(workspace, folderId) {
  const folders = new Map((workspace.folders || []).map((folder) => [folder.id, folder]));
  const ancestors = [];
  const seen = new Set();
  let current = folders.get(folderId);
  while (current && !seen.has(current.id)) {
    ancestors.unshift(current);
    seen.add(current.id);
    current = folders.get(current.parentId);
  }
  return ancestors;
}

function clearedNavigation(workspace, pageIds, folderIds, group) {
  const pointers = [];
  const folders = (workspace.folders || []).map((folder) => {
    if (!pageIds.has(folder.lastOpenedPageId)) return folder;
    pointers.push([folder.id, folder.lastOpenedPageId]);
    return { ...folder, lastOpenedPageId: null };
  });
  const ui = { ...(workspace.ui || {}) };
  if (pageIds.has(ui.selectedPageId)) ui.selectedPageId = null;
  if (folderIds.has(ui.selectedFolderId)) ui.selectedFolderId = null;
  if (group && pointers.length) {
    ui.trashRestoreState = { ...(ui.trashRestoreState || {}), [`${group.kind}:${group.id}`]: Object.fromEntries(pointers) };
  }
  return { ...workspace, folders, ui };
}

function withoutRestoreState(ui, group) {
  const next = { ...ui };
  if (!next.trashRestoreState) return next;
  const state = { ...next.trashRestoreState };
  delete state[`${group.kind}:${group.id}`];
  if (Object.keys(state).length) next.trashRestoreState = state;
  else delete next.trashRestoreState;
  return next;
}

export function trashFolder(workspace, folderId, now) {
  const root = (workspace.folders || []).find((folder) => folder.id === folderId);
  if (root?.system) throw new Error("系统文件夹不能删除、移动或改名");
  if (!root || root.trashedAt) return workspace;
  const branch = folderBranchIds(workspace, folderId);
  const folderIds = new Set((workspace.folders || []).filter((folder) => branch.has(folder.id) && !folder.trashedAt).map((folder) => folder.id));
  const roots = (workspace.pages || []).filter((page) => branch.has(page.folderId) && !page.trashedAt).map((page) => page.id);
  const owned = new Set([...roots, ...ownedDescendantPageIds(workspace, roots)]);
  const pageIds = new Set((workspace.pages || []).filter((page) => owned.has(page.id) && !page.trashedAt).map((page) => page.id));
  return clearedNavigation({
    ...workspace,
    folders: (workspace.folders || []).map((folder) => folderIds.has(folder.id) ? { ...folder, trashedAt: now, trashedByFolderId: folder.id === folderId ? null : folderId, updatedAt: now } : folder),
    pages: (workspace.pages || []).map((page) => pageIds.has(page.id) ? { ...page, trashedAt: now, trashedByFolderId: folderId, trashedByPageId: null, updatedAt: now } : page),
  }, pageIds, folderIds, { kind: "folder", id: folderId });
}

export function trashPage(workspace, pageId, now) {
  const root = (workspace.pages || []).find((page) => page.id === pageId);
  if (!root || root.trashedAt) return workspace;
  const owned = new Set([pageId, ...ownedDescendantPageIds(workspace, [pageId])]);
  const pageIds = new Set((workspace.pages || []).filter((page) => owned.has(page.id) && !page.trashedAt).map((page) => page.id));
  return clearedNavigation({
    ...workspace,
    pages: (workspace.pages || []).map((page) => pageIds.has(page.id) ? { ...page, trashedAt: now, trashedByFolderId: null, trashedByPageId: page.id === pageId ? null : pageId, updatedAt: now } : page),
  }, pageIds, new Set(), { kind: "page", id: pageId });
}

export function trashGroupMembers(workspace, { kind, id }) {
  const collection = kind === "folder" ? workspace.folders : kind === "page" ? workspace.pages : [];
  const root = (collection || []).find((entity) => entity.id === id);
  if (!isTrashRoot(root)) return { folderIds: [], pageIds: [] };
  if (kind === "folder") return {
    folderIds: (workspace.folders || []).filter((folder) => folder.trashedAt && (folder.id === id || folder.trashedByFolderId === id)).map((folder) => folder.id),
    pageIds: (workspace.pages || []).filter((page) => page.trashedAt && page.trashedByFolderId === id).map((page) => page.id),
  };
  return { folderIds: [], pageIds: (workspace.pages || []).filter((page) => page.trashedAt && (page.id === id || page.trashedByPageId === id)).map((page) => page.id) };
}

export function listTrashGroups(workspace, now) {
  const roots = trashRoots(workspace);
  const counts = new Map(roots.map(({ kind, entity }) => [`${kind}:${entity.id}`, { folderCount: 0, pageCount: 0 }]));
  for (const folder of workspace.folders || []) {
    if (!folder.trashedAt) continue;
    const group = counts.get(`folder:${folder.trashedByFolderId || folder.id}`);
    if (group) group.folderCount += 1;
  }
  for (const page of workspace.pages || []) {
    if (!page.trashedAt) continue;
    const folderGroup = counts.get(`folder:${page.trashedByFolderId}`);
    const pageGroup = counts.get(`page:${page.trashedByPageId || page.id}`);
    if (folderGroup) folderGroup.pageCount += 1;
    if (pageGroup) pageGroup.pageCount += 1;
  }
  return roots.map(({ kind, entity }) => {
    const path = folderAncestors(workspace, kind === "folder" ? entity.parentId : entity.folderId).map((folder) => folder.name);
    return {
      kind, id: entity.id, name: kind === "folder" ? entity.name : entity.title || "无标题页面",
      path: ["Private", ...path].join(" / "), trashedAt: entity.trashedAt,
      daysRemaining: trashDaysRemaining(entity, now ?? workspace.savedAt ?? "1970-01-01T00:00:00.000Z"),
      ...counts.get(`${kind}:${entity.id}`),
    };
  }).sort((left, right) => String(right.trashedAt).localeCompare(String(left.trashedAt)));
}

export function restoreTrashGroup(workspace, group, { now, idFactory } = {}) {
  const members = trashGroupMembers(workspace, group);
  if (!members.folderIds.length && !members.pageIds.length) return { workspace, restored: null };
  const folderIds = new Set(members.folderIds);
  const pageIds = new Set(members.pageIds);
  const restoredEntity = (entity) => ({ ...entity, trashedAt: null, trashedByFolderId: null, updatedAt: now });
  let result = {
    ...workspace,
    folders: (workspace.folders || []).map((folder) => folderIds.has(folder.id) ? restoredEntity(folder) : folder),
    pages: (workspace.pages || []).map((page) => pageIds.has(page.id) ? { ...restoredEntity(page), trashedByPageId: null } : page),
  };
  let folderId;
  if (group.kind === "folder") {
    const root = result.folders.find((folder) => folder.id === group.id);
    const parent = result.folders.find((folder) => folder.id === root.parentId);
    if (!parent || parent.trashedAt) result.folders = result.folders.map((folder) => folder.id === group.id ? { ...folder, parentId: null } : folder);
    folderId = group.id;
  } else {
    const root = result.pages.find((page) => page.id === group.id);
    let folder = result.folders.find((entry) => entry.id === root.folderId && !entry.trashedAt);
    if (!folder) folder = result.folders.filter((entry) => !entry.parentId && !entry.trashedAt && !entry.system).sort(compareNavigationOrder)[0];
    if (!folder) {
      if (typeof idFactory !== "function") throw new Error("恢复页面需要 ID 生成器");
      folder = { id: idFactory("folder"), parentId: null, name: "我的空间", color: "stone", sortIndex: 10, lastOpenedPageId: null, trashedAt: null, trashedByFolderId: null, createdAt: now, updatedAt: now };
      result.folders = [...result.folders, folder];
    }
    folderId = folder.id;
    result.pages = result.pages.map((page) => {
      if (!pageIds.has(page.id)) return page;
      const currentFolder = result.folders.find((entry) => entry.id === page.folderId);
      const parent = result.pages.find((entry) => entry.id === page.parentPageId);
      return { ...page, ...(page.id === group.id || !currentFolder || currentFolder.trashedAt ? { folderId } : {}), ...(page.parentPageId && (!parent || parent.trashedAt) ? { parentPageId: null } : {}) };
    });
  }
  const pointers = workspace.ui?.trashRestoreState?.[`${group.kind}:${group.id}`] || {};
  result.folders = result.folders.map((folder) => {
    const page = result.pages.find((entry) => entry.id === pointers[folder.id]);
    return folder.lastOpenedPageId == null && page && !page.trashedAt && page.folderId === folder.id
      ? { ...folder, lastOpenedPageId: page.id }
      : folder;
  });
  const ui = withoutRestoreState(result.ui || {}, group);
  ui.selectedPageId = group.kind === "page" ? group.id : null;
  ui.selectedFolderId = folderId;
  ui.expandedFolderIds = [...new Set([...(ui.expandedFolderIds || []), ...folderAncestors(result, folderId).map((folder) => folder.id)])];
  return { workspace: { ...result, ui }, restored: { kind: group.kind, id: group.id, folderId } };
}

function documentBodies(workspace) {
  return [
    ...(workspace.pages || []).map((page) => page.content),
    ...(workspace.pageVersions || []).map((version) => version.content),
    ...(workspace.pageTemplates || []).map((template) => template.content),
    ...(workspace.databaseTemplates || []).map((template) => template.pageContent),
    ...(workspace.syncedSources || []).map((source) => source.blocks),
  ];
}

function idValues(value) {
  return Array.isArray(value) ? value : typeof value === "string" && value ? [value] : [];
}

export function syncedSourceReferences(workspace) {
  const references = new Set();
  for (const body of documentBodies(workspace)) {
    walkBlocks(body, (block) => { if (block.type === "syncedBlock" && block.props?.sourceId) references.add(block.props.sourceId); });
  }
  return references;
}

export function attachmentReferences(workspace) {
  const references = new Set();
  const assetReferences = new Map();
  for (const attachment of workspace.attachments || []) {
    const hash = attachment.checksum || (attachment.provider === "asset" && attachment.storageKey);
    if (!hash) continue;
    const ids = assetReferences.get(hash) || [];
    ids.push(attachment.id);
    assetReferences.set(hash, ids);
  }
  const visitUrl = (url) => {
    const urlId = attachmentIdFromUrl(url);
    if (urlId) references.add(urlId);
    const assetHash = assetHashFromUrl(url);
    if (assetHash) for (const id of assetReferences.get(assetHash) || []) references.add(id);
  };
  for (const body of documentBodies(workspace)) {
    walkBlocks(body, (block) => {
      visitUrl(block.props?.url);
      if (block.props?.attachmentId) references.add(block.props.attachmentId);
    });
  }
  for (const appearance of [...(workspace.pages || []), ...(workspace.pageVersions || []), ...(workspace.pageTemplates || []), ...(workspace.databaseTemplates || []).map((template) => template.pageAppearance)]) {
    visitUrl(appearance?.icon);
    visitUrl(typeof appearance?.cover === "string" ? appearance.cover : appearance?.cover?.value);
  }
  const sources = new Map((workspace.dataSources || []).map((source) => [source.id, source]));
  const values = [
    ...(workspace.databaseItems || []).map((item) => ({ sourceId: item.sourceId, values: item.values })),
    ...(workspace.databaseTemplates || []).map((template) => ({ sourceId: template.sourceId, values: template.defaultValues })),
  ];
  for (const entry of values) {
    for (const property of sources.get(entry.sourceId)?.properties || []) {
      if (property.type === "files") for (const id of idValues(entry.values?.[property.id])) references.add(id);
    }
  }
  visitDatabaseVersionFiles(workspace.databaseVersions, (owner, key) => {
    const id = owner[key];
    references.add(id);
    visitUrl(id);
  });
  return references;
}

function pruneRestoreState(workspace) {
  if (!workspace.ui?.trashRestoreState) return workspace;
  const roots = new Set(trashRoots(workspace).map(({ kind, entity }) => `${kind}:${entity.id}`));
  const folders = new Set((workspace.folders || []).map((folder) => folder.id));
  const pages = new Set((workspace.pages || []).map((page) => page.id));
  const state = {};
  for (const [key, pointers] of Object.entries(workspace.ui.trashRestoreState)) {
    if (!roots.has(key)) continue;
    const kept = Object.fromEntries(Object.entries(pointers).filter(([folderId, pageId]) => folders.has(folderId) && pages.has(pageId)));
    if (Object.keys(kept).length) state[key] = kept;
  }
  const ui = { ...workspace.ui };
  if (Object.keys(state).length) ui.trashRestoreState = state;
  else delete ui.trashRestoreState;
  return { ...workspace, ui };
}

function orderedIds(value) {
  return Array.isArray(value) && value.every((id) => typeof id === "string" && id.trim()) && new Set(value).size === value.length;
}

function readDeclaredIds(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const ids = JSON.parse(value);
    return orderedIds(ids) ? ids : null;
  } catch { return null; }
}

function cleanDeletedDatabaseMembers(workspace, deletedSourceIds, removedViews) {
  if (!deletedSourceIds.size) return workspace;
  const availableSources = new Set(workspace.dataSources.map(({ id }) => id));
  const viewById = new Map(workspace.databaseViews.map((view) => [view.id, view]));
  const removedViewSource = new Map(removedViews.map(({ id, sourceId }) => [id, sourceId]));
  const cleanedSources = (primary, declared) => {
    if (!orderedIds(declared) || declared.length < 2 || declared[0] !== primary) return null;
    const remaining = declared.filter((id) => !deletedSourceIds.has(id));
    // Keep the unavailable-source notice when there is no surviving primary.
    return remaining.length < declared.length && availableSources.has(remaining[0]) ? remaining : null;
  };
  const removedDeclaredView = (id, sources) => sources.includes(removedViewSource.get(id));
  const eligibleView = (id, allowedSources) => {
    const view = viewById.get(id);
    return view && !view.trashedAt && allowedSources.includes(view.sourceId);
  };

  function cleanProps(props) {
    const before = readDeclaredIds(props?.sourceIdsJson);
    const sources = cleanedSources(props?.sourceId, before);
    if (!sources) return props;
    const next = { ...props, sourceId: sources[0], sourceIdsJson: JSON.stringify(sources) };
    const viewIds = readDeclaredIds(props.viewIdsJson);
    const isDeleted = (id) => removedDeclaredView(id, before);
    if (viewIds) {
      const remaining = viewIds.filter((id) => !isDeleted(id));
      if (remaining.length !== viewIds.length) next.viewIdsJson = JSON.stringify(remaining);
      if (isDeleted(props.viewId) && viewIds.includes(props.viewId)) {
        next.viewId = remaining.find((id) => eligibleView(id, sources)) ?? "";
        if (!remaining.length) next.viewIdsJson = "";
      }
    } else if ((props.viewIdsJson == null || (typeof props.viewIdsJson === "string" && !props.viewIdsJson.trim())) && isDeleted(props.viewId)) {
      next.viewId = "";
    }
    return next;
  }

  function cleanBody(blocks) {
    if (!Array.isArray(blocks)) return blocks;
    return mapChanged(blocks, (block) => {
      if (!block || typeof block !== "object") return block;
      const props = block.type === "databaseView" ? cleanProps(block.props) : block.props;
      const children = cleanBody(block.children);
      const updated = props === block.props ? block : { ...block, props };
      return children === block.children ? updated : { ...updated, children };
    });
  }

  function mapChanged(entries, transform) {
    const next = entries.map(transform);
    return next.some((entry, index) => entry !== entries[index]) ? next : entries;
  }
  const cleanEntityBody = (entity, key) => {
    const blocks = cleanBody(entity[key]);
    return blocks === entity[key] ? entity : { ...entity, [key]: blocks };
  };
  return {
    ...workspace,
    pages: mapChanged(workspace.pages, (page) => {
      const cleaned = cleanEntityBody(page, "content");
      const updated = cleaned === page ? page : { ...cleaned, importRevision: (page.importRevision || 0) + 1 };
      if (page.pageType !== "database") return updated;
      const before = page.databaseSourceIds;
      const sources = cleanedSources(page.databaseSourceId, before);
      if (!sources) return updated;
      const next = { ...updated, databaseSourceId: sources[0], databaseSourceIds: sources };
      if (removedDeclaredView(page.databaseViewId, before)) {
        const canonical = walkBlocks(page.content).find((block) => block.type === "databaseView"
          && block.props?.sourceId === page.databaseSourceId && block.props.viewId === page.databaseViewId);
        const repaired = canonical ? walkBlocks(updated.content).find((block) => block.id === canonical.id)?.props?.viewId : null;
        next.databaseViewId = eligibleView(repaired, sources) ? repaired : null;
      }
      return next;
    }),
    ...(Array.isArray(workspace.syncedSources) ? { syncedSources: mapChanged(workspace.syncedSources, (source) => {
      const updated = cleanEntityBody(source, "blocks");
      return updated === source ? source : { ...updated, revision: (source.revision || 0) + 1 };
    }) } : {}),
    ...(Array.isArray(workspace.pageTemplates) ? { pageTemplates: mapChanged(workspace.pageTemplates, (template) => cleanEntityBody(template, "content")) } : {}),
    databaseTemplates: mapChanged(workspace.databaseTemplates, (template) => cleanEntityBody(template, "pageContent")),
  };
}

export function permanentlyDelete(workspace, { pageIds = [], folderIds = [] } = {}) {
  const pages = new Set(pageIds);
  const folders = new Set(folderIds);
  if (!pages.size && !folders.size) return workspace;
  const sourceIds = new Set((workspace.dataSources || []).filter((source) => pages.has(source.ownerPageId)).map((source) => source.id));
  const removedPages = (workspace.pages || []).filter((page) => pages.has(page.id));
  const removedItems = (workspace.databaseItems || []).filter((item) => sourceIds.has(item.sourceId) || pages.has(item.pageId));
  const removedViews = (workspace.databaseViews || []).filter((view) => sourceIds.has(view.sourceId));
  const removedVersions = (workspace.databaseVersions || []).filter((version) => sourceIds.has(version.sourceId));
  const itemIds = new Set(removedItems.map((item) => item.id));
  const syncCandidates = syncedSourceReferences({ pages: removedPages });
  const attachmentCandidates = attachmentReferences({ pages: removedPages, databaseItems: removedItems, databaseVersions: removedVersions, dataSources: workspace.dataSources, attachments: workspace.attachments });
  const discussionIds = new Set((workspace.discussions || []).filter((discussion) => pages.has(discussion.pageId)).map((discussion) => discussion.id));
  const sources = (workspace.dataSources || []).filter((source) => !sourceIds.has(source.id)).map((source) => {
    let changed = false;
    const properties = (source.properties || []).map((property) => {
      if (property.type !== "relation" || !sourceIds.has(property.config?.targetSourceId)) return property;
      changed = true;
      return { ...property, config: { ...property.config, targetSourceId: null } };
    });
    return changed ? { ...source, properties } : source;
  });
  const sourceMap = new Map(sources.map((source) => [source.id, source]));
  let result = {
    ...workspace,
    folders: (workspace.folders || []).filter((folder) => !folders.has(folder.id)),
    pages: (workspace.pages || []).filter((page) => !pages.has(page.id)),
    ...(Array.isArray(workspace.pageVersions) ? { pageVersions: workspace.pageVersions.filter((version) => !pages.has(version.pageId)) } : {}),
    ...(removedVersions.length ? { databaseVersions: workspace.databaseVersions.filter((version) => !sourceIds.has(version.sourceId)) } : {}),
    dataSources: sources,
    databaseViews: (workspace.databaseViews || []).filter((view) => !sourceIds.has(view.sourceId)),
    databaseTemplates: (workspace.databaseTemplates || []).filter((template) => !sourceIds.has(template.sourceId)),
    relations: (workspace.relations || []).filter((relation) => !sourceIds.has(relation.sourceId) && !sourceIds.has(relation.targetSourceId)),
    databaseItems: (workspace.databaseItems || []).filter((item) => !itemIds.has(item.id)).map((item) => {
      let values = item.values;
      for (const property of sourceMap.get(item.sourceId)?.properties || []) {
        if (property.type !== "relation") continue;
        const raw = item.values?.[property.id];
        const kept = idValues(raw).filter((id) => !itemIds.has(id));
        if (kept.length !== idValues(raw).length) values = { ...values, [property.id]: kept };
      }
      return values === item.values ? item : { ...item, values };
    }),
    discussions: (workspace.discussions || []).filter((discussion) => !discussionIds.has(discussion.id)),
    comments: (workspace.comments || []).filter((comment) => !discussionIds.has(comment.discussionId)),
  };
  result = cleanDeletedDatabaseMembers(result, sourceIds, removedViews);
  let changed = true;
  while (changed) {
    const references = syncedSourceReferences(result);
    const sourcesToKeep = (result.syncedSources || []).filter((source) => !syncCandidates.has(source.id) || references.has(source.id));
    changed = sourcesToKeep.length !== (result.syncedSources || []).length;
    if (changed) result = { ...result, syncedSources: sourcesToKeep };
  }
  const references = attachmentReferences(result);
  result = { ...result, attachments: (result.attachments || []).filter((attachment) => !attachmentCandidates.has(attachment.id) || references.has(attachment.id)) };
  result = clearedNavigation(result, pages, folders);
  result.ui.expandedFolderIds = (result.ui.expandedFolderIds || []).filter((id) => !folders.has(id));
  return pruneRestoreState(result);
}

export function deleteTrashGroupPermanently(workspace, group) {
  return permanentlyDelete(workspace, trashGroupMembers(workspace, group));
}

function deleteGroups(workspace, groups) {
  const folderRoots = new Set(groups.filter((group) => group.kind === "folder").map((group) => group.entity.id));
  const pageRoots = new Set(groups.filter((group) => group.kind === "page").map((group) => group.entity.id));
  const folderIds = (workspace.folders || []).filter((folder) => folder.trashedAt && (folderRoots.has(folder.id) || folderRoots.has(folder.trashedByFolderId))).map((folder) => folder.id);
  const pageIds = (workspace.pages || []).filter((page) => page.trashedAt && (pageRoots.has(page.id) || pageRoots.has(page.trashedByPageId) || folderRoots.has(page.trashedByFolderId))).map((page) => page.id);
  return permanentlyDelete(workspace, { pageIds, folderIds });
}

export function emptyTrash(workspace) {
  return deleteGroups(workspace, trashRoots(workspace));
}

export function purgeExpiredTrashGroups(workspace, now) {
  return deleteGroups(workspace, trashRoots(workspace).filter(({ entity }) => isTrashExpired(entity, now ?? workspace.savedAt ?? "1970-01-01T00:00:00.000Z")));
}

export function pageAvailability(workspace, pageId) {
  const page = (workspace.pages || []).find((entry) => entry.id === pageId);
  return !page ? "missing" : page.trashedAt ? "trashed" : "ok";
}
