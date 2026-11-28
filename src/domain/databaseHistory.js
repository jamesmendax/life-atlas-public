import { copyJson, newEntityId, stableJson, walkBlocks } from "./blockDocument.js";
import { readBrowserAttachmentBlob } from "./attachments.js";
import { assetHashFromUrl } from "./attachmentUrls.js";
import { isPageArchived } from "./archive.js";
import { isEmptyProperty, normalizeIdValues, READ_ONLY_PROPERTY_TYPES } from "./databaseProperties.js";
import { checkWorkspaceIntegrity } from "./integrity.js";
import { trashGroupMembers, trashPage } from "./trash.js";

const byId = (entries = []) => new Map(entries.map((entry) => [entry.id, entry]));
const same = (left, right) => left === right || stableJson(left) === stableJson(right);
const sorted = (entries) => [...entries].sort((left, right) => left.id.localeCompare(right.id));
const storedValue = (property) => property.type === "unique_id" || !READ_ONLY_PROPERTY_TYPES.includes(property.type);
const inScope = (relation, sourceId) => relation.sourceId === sourceId || relation.targetSourceId === sourceId;
const withoutTimestamp = ({ updatedAt, ...entity }) => entity;
const encoder = new TextEncoder();
export const MAX_DATABASE_VERSION_BYTES = 19 * 1024 * 1024;
const versionTooLarge = "此数据库版本超过 19 MiB，无法保存历史快照。";

function externalViewIds(workspace, source) {
  const external = new Set();
  const visit = (body) => {
    walkBlocks(body, (block) => {
      if (block.type !== "databaseView") return;
      external.add(block.props?.viewId);
      try {
        const ids = JSON.parse(block.props?.viewIdsJson || "[]");
        if (Array.isArray(ids)) for (const id of ids) external.add(id);
      } catch { /* The declared primary view is still an external reference. */ }
    });
  };
  for (const page of workspace.pages || []) {
    if (page.id === source.ownerPageId) continue;
    if (page.databaseViewId) external.add(page.databaseViewId);
    visit(page.content);
  }
  for (const entity of workspace.pageTemplates || []) visit(entity.content);
  for (const entity of workspace.databaseTemplates || []) visit(entity.pageContent);
  for (const entity of workspace.syncedSources || []) visit(entity.blocks);
  for (const other of workspace.dataSources || []) {
    if (other.id === source.id) continue;
    const views = other.recordLayout?.views;
    if (Array.isArray(views)) for (const layoutView of views) external.add(layoutView.viewId);
  }
  for (const view of workspace.databaseViews || []) {
    if (view.type !== "dashboard" || (view.sourceId === source.id && !view.linked && !external.has(view.id))) continue;
    const widgets = view.config?.dashboard?.widgets;
    if (!Array.isArray(widgets)) continue;
    for (const widget of widgets) {
      if (widget?.type === "view" && (widget.sourceId || view.sourceId) === source.id) external.add(widget.viewId);
    }
  }
  return external;
}

function ownViews(workspace, source, protectedIds) {
  const candidates = (workspace.databaseViews || []).filter((view) => view.sourceId === source.id && !view.linked && !view.trashedAt);
  if (!candidates.length) return candidates;
  const external = protectedIds ?? externalViewIds(workspace, source);
  return candidates.filter((view) => !external.has(view.id));
}

function snapshot(workspace, source, pages = byId(workspace.pages)) {
  if (!source) return null;
  const allowed = new Set((source.properties || []).filter(storedValue).map((property) => property.id));
  return {
    source,
    items: (workspace.databaseItems || []).flatMap((item) => {
      const page = pages.get(item.pageId);
      if (item.sourceId !== source.id || item.trashedAt || !page || page.trashedAt) return [];
      const values = Object.fromEntries(Object.entries(item.values || {}).filter(([key]) => allowed.has(key)));
      return [{ ...item, values }];
    }),
    views: ownViews(workspace, source),
    relations: (workspace.relations || []).filter((relation) => inScope(relation, source.id)),
  };
}

function snapshotKey({ source, items = [], views = [], relations = [] }) {
  return stableJson({
    source: withoutTimestamp(source),
    items: sorted(items).map(withoutTimestamp),
    views: sorted(views).map(withoutTimestamp),
    relations: sorted(relations),
  });
}

function sameSnapshot(first, second) {
  const equalEntries = (left, right, project) => {
    if (left.length !== right.length) return false;
    if (!left.length) return true;
    const matches = byId(right);
    return left.every((entry) => matches.has(entry.id) && same(project(entry), project(matches.get(entry.id))));
  };
  return same(withoutTimestamp(first.source), withoutTimestamp(second.source))
    && equalEntries(first.items, second.items, withoutTimestamp)
    && equalEntries(first.views, second.views, withoutTimestamp)
    && equalEntries(first.relations, second.relations, (entry) => entry);
}

function versionFits({ items, views, relations, ...metadata }) {
  // Account for the actual UTF-8 entity including wrapper keys and commas, and
  // stop at the first oversized collection instead of concatenating it.
  let bytes = encoder.encode(JSON.stringify({ ...metadata, items: [], views: [], relations: [] })).byteLength;
  for (const entries of [items, views, relations]) {
    for (const [index, entry] of entries.entries()) {
      bytes += encoder.encode(JSON.stringify(entry)).byteLength + (index ? 1 : 0);
      if (bytes > MAX_DATABASE_VERSION_BYTES) return false;
    }
  }
  return bytes <= MAX_DATABASE_VERSION_BYTES;
}

export function databaseVersionSignature(version) {
  const key = snapshotKey(version);
  // Persist a compact fingerprint. Capture deduplication and restore use exact comparisons.
  let hash = 2166136261;
  for (let index = 0; index < key.length; index++) hash = Math.imul(hash ^ key.charCodeAt(index), 16777619);
  return `${key.length}:${(hash >>> 0).toString(16)}`;
}

function appendVersion(workspace, state, { reason, now, idFactory, force = false, automatic = false }) {
  if (!state) return workspace;
  const versions = workspace.databaseVersions || [];
  const version = {
    id: idFactory("db-version"), sourceId: state.source.id, createdAt: new Date(now).toISOString(), reason,
    ...state, signature: "0000000000:00000000",
  };
  if (!versionFits(version)) {
    if (!automatic) throw new Error(versionTooLarge);
    return { ...workspace, ui: { ...workspace.ui, databaseHistoryCaptureWarning: {
      sourceId: state.source.id, message: `${versionTooLarge} 当前编辑已保留。`,
    } } };
  }
  const signature = databaseVersionSignature(state);
  let latest;
  for (const version of versions) {
    if (version.sourceId === state.source.id && (!latest || String(version.createdAt) >= String(latest.createdAt))) latest = version;
  }
  if (!force && (latest?.signature === signature || !latest?.signature) && latest?.source && snapshotKey(latest) === snapshotKey(state)) return workspace;
  version.signature = signature;
  if (versions.some((entry) => entry.id === version.id)) throw new Error("数据库版本 ID 已存在。");
  return { ...workspace, databaseVersions: [...versions, copyJson(version)] };
}

export function recordDatabaseVersion(workspace, sourceId, { reason = "manual", now = Date.now(), idFactory = newEntityId } = {}) {
  const source = byId(workspace.dataSources).get(sourceId);
  const owner = byId(workspace.pages).get(source?.ownerPageId);
  if (!source || source.trashedAt || (source.ownerPageId && (!owner || owner.trashedAt))) throw new Error("数据库当前不可用。");
  return appendVersion(workspace, snapshot(workspace, source), { reason, now, idFactory });
}

export function captureDatabaseVersions(before, next, { now = Date.now(), idFactory = newEntityId, reason = "before-edit" } = {}) {
  if (before === next || before.workspaceId !== next.workspaceId) return next;
  const tracked = ["dataSources", "databaseItems", "databaseViews", "relations"];
  if (tracked.every((key) => before[key] === next[key]) && before.pages === next.pages) return next;
  const dirty = new Set();
  const mark = (entity) => {
    if (entity.sourceId) dirty.add(entity.sourceId);
    if (entity.targetSourceId) dirty.add(entity.targetSourceId);
  };
  if (before.dataSources !== next.dataSources) {
    const oldSources = byId(before.dataSources);
    for (const source of next.dataSources || []) if (oldSources.get(source.id) !== source) dirty.add(source.id);
  }
  for (const key of tracked.slice(1)) {
    if (before[key] === next[key]) continue;
    const oldEntries = byId(before[key]);
    for (const entity of next[key] || []) {
      const old = oldEntries.get(entity.id);
      if (old !== entity) { mark(entity); if (old) mark(old); }
      oldEntries.delete(entity.id);
    }
    for (const entity of oldEntries.values()) mark(entity);
  }
  const oldPages = byId(before.pages);
  const nextPages = before.pages === next.pages ? oldPages : byId(next.pages);
  if (nextPages !== oldPages) {
    for (const item of before.databaseItems || []) {
      const oldPage = oldPages.get(item.pageId);
      const nextPage = nextPages.get(item.pageId);
      if (Boolean(oldPage?.trashedAt) !== Boolean(nextPage?.trashedAt)) dirty.add(item.sourceId);
    }
  }
  if (!dirty.size) return next;
  const oldSources = byId(before.dataSources);
  const nextSources = byId(next.dataSources);
  const nextItems = byId(next.databaseItems);
  const oldItems = byId(before.databaseItems);
  const removedItems = new Set([...oldItems.keys()].filter((id) => !nextItems.has(id)));
  let result = next;
  for (const sourceId of dirty) {
    const oldSource = oldSources.get(sourceId);
    const newSource = nextSources.get(sourceId);
    if (!oldSource || !newSource || newSource.trashedAt) continue;
    const owner = nextPages.get(newSource.ownerPageId);
    if (newSource.ownerPageId && (!owner || owner.trashedAt)) continue;
    const prior = snapshot(before, oldSource, oldPages);
    // Permanent deletion can also reclaim assets. A version created here would already be unrestorable.
    if (prior.items.some((item) => !nextItems.has(item.id) || !nextPages.has(item.pageId))) continue;
    if (prior.relations.some((edge) => !nextSources.has(edge.sourceId) || !nextSources.has(edge.targetSourceId))) continue;
    const relationFields = (oldSource.properties || []).filter((property) => property.type === "relation");
    if (relationFields.some(({ config }) => config?.targetSourceId && !nextSources.has(config.targetSourceId))) continue;
    if (removedItems.size && prior.items.some((item) => relationFields.some((property) =>
      normalizeIdValues(item.values?.[property.id]).some((id) => removedItems.has(id))))) continue;
    const current = snapshot(next, newSource, nextPages);
    if (!sameSnapshot(prior, current)) result = appendVersion(result, prior, { reason, now, idFactory, automatic: true });
  }
  return result;
}

function requireRestore(condition, message) {
  if (!condition) throw new Error(message);
}

function restoreValues(live, historical, liveSource, savedSource, single) {
  const historicValues = historical.values || {};
  if (!single) return Object.fromEntries((savedSource.properties || []).filter(storedValue)
    .filter((property) => Object.hasOwn(historicValues, property.id)).map(({ id }) => [id, copyJson(historicValues[id])]));
  const properties = byId(liveSource.properties);
  const values = { ...live.values };
  for (const old of (savedSource.properties || []).filter(storedValue)) {
    const current = properties.get(old.id);
    const hasValue = Object.hasOwn(historicValues, old.id);
    if (current?.type !== old.type) {
      requireRestore(!hasValue || isEmptyProperty(historicValues[old.id]), `属性「${old.name || old.id}」已删除或改了类型，请使用整库恢复。`);
      continue;
    }
    if (!hasValue) { delete values[old.id]; continue; }
    const raw = historicValues[old.id];
    if (["select", "status", "multi_select"].includes(current.type)) {
      const ids = normalizeIdValues(raw);
      const available = byId(current.options);
      requireRestore(ids.every((id) => available.has(id)), `属性「${old.name || old.id}」的历史选项已删除，请使用整库恢复。`);
    }
    values[old.id] = copyJson(raw);
  }
  return values;
}

function validateItemLinks(workspace, source, restored, currentPages) {
  const items = byId(workspace.databaseItems);
  const attachments = byId(workspace.attachments);
  const people = byId(workspace.people);
  const fields = (source.properties || []).filter((property) => property.type === "files" || property.type === "people");
  const attachmentIds = new Set();
  const checkChain = (root, field) => {
    const done = new Set(), visiting = new Set();
    const stack = [[root, false]];
    while (stack.length) {
      const [item, leaving] = stack.pop();
      if (leaving) { visiting.delete(item.id); done.add(item.id); continue; }
      if (done.has(item.id)) continue;
      const label = field === "parentItemId" ? "父级" : "依赖";
      requireRestore(!visiting.has(item.id), `记录 ${root.id} 的${label}形成循环。`);
      visiting.add(item.id);
      stack.push([item, true]);
      const ids = field === "parentItemId" ? normalizeIdValues(item.parentItemId) : normalizeIdValues(item.dependencyIds);
      for (const id of ids) {
        const target = items.get(id);
        const page = currentPages.get(target?.pageId);
        requireRestore(target?.sourceId === source.id && page && !page.trashedAt && !target.trashedAt, `记录 ${root.id} 的${label}记录 ${id} 不可用。`);
        requireRestore(!isPageArchived(workspace, page.id), `记录 ${root.id} 的${label}记录 ${id} 已归档，请先解除归档。`);
        requireRestore(!target.locked && !page.settings?.locked, `记录 ${root.id} 的${label}记录 ${id} 已锁定，请先解锁。`);
        stack.push([target, false]);
      }
    }
  };
  for (const item of restored) {
    for (const property of fields) {
      const targets = property.type === "files" ? attachments : people;
      for (const id of normalizeIdValues(item.values?.[property.id])) {
        requireRestore(targets.has(id), `记录 ${item.id} 的「${property.name || property.id}」缺少${property.type === "files" ? "附件" : "人员"} ${id}。`);
        if (property.type === "files") attachmentIds.add(id);
      }
    }
    checkChain(item, "parentItemId");
    checkChain(item, "dependencyIds");
  }
  return [...attachmentIds];
}

function validateRelations(before, next, sourceId, restoredIds, structureRestored) {
  const sources = byId(next.dataSources);
  const items = byId(next.databaseItems);
  const pages = byId(next.pages);
  const definitions = new Map((next.relations || []).map((edge) => [`${edge.sourceId}\0${edge.propertyId}`, edge]));
  const fields = new Map([...sources].map(([id, source]) => [id, byId(source.properties)]));
  const oldDefinitions = new Map((before.relations || []).map((edge) => [`${edge.sourceId}\0${edge.propertyId}`, edge]));
  const lookup = (source, field) => definitions.get(`${source}\0${field}`);
  const liveRows = new Map();
  for (const item of items.values()) {
    if (!liveRows.has(item.sourceId)) liveRows.set(item.sourceId, []);
    liveRows.get(item.sourceId).push(item);
  }
  for (const source of sources.values()) for (const property of source.properties || []) {
    if (property.type !== "relation") continue;
    const key = `${source.id}\0${property.id}`;
    const definition = lookup(source.id, property.id);
    const old = oldDefinitions.get(key);
    const targetId = definition?.targetSourceId || property.config?.targetSourceId;
    if (source.id !== sourceId && targetId !== sourceId && old?.targetSourceId !== sourceId) continue;
    const label = `「${source.title || source.id}」的关联「${property.name || property.id}」`;
    const reciprocal = definition?.reciprocalPropertyId;
    if (structureRestored && targetId) requireRestore(sources.has(targetId), `${label}的目标数据库已删除。`);
    if (reciprocal && (structureRestored || (liveRows.get(source.id) || []).some((item) => restoredIds.has(item.id)))) {
      const reverseField = fields.get(targetId)?.get(reciprocal);
      const reverse = lookup(targetId, reciprocal);
      requireRestore(reverseField?.type === "relation" && (reverse?.targetSourceId || reverseField.config?.targetSourceId) === source.id
        && (!reverse?.reciprocalPropertyId || reverse.reciprocalPropertyId === property.id), `${label}与目标数据库的反向关联定义冲突。`);
    }
    for (const item of liveRows.get(source.id) || []) {
      const ids = normalizeIdValues(item.values?.[property.id]);
      if (restoredIds.has(item.id)) {
        requireRestore(property.config?.relationLimit !== 1 || ids.length < 2, `${label}只允许关联一条记录。`);
        for (const id of ids) {
          const target = items.get(id);
          const page = pages.get(target?.pageId);
          requireRestore(target && target.sourceId === targetId && page && !page.trashedAt && !target.trashedAt, `${label}引用的记录 ${id} 不可用。`);
        }
      }
      if (!reciprocal) continue;
      for (const id of ids) {
        if (!restoredIds.has(item.id) && !restoredIds.has(id)) continue;
        const target = items.get(id);
        requireRestore(target?.sourceId === targetId && normalizeIdValues(target.values?.[reciprocal]).includes(item.id), `${label}与记录 ${id} 的反向关联不一致。`);
      }
    }
    if (reciprocal) for (const target of liveRows.get(targetId) || []) {
      for (const id of normalizeIdValues(target.values?.[reciprocal])) {
        if (!restoredIds.has(id) && !restoredIds.has(target.id)) continue;
        const item = items.get(id);
        requireRestore(item?.sourceId === source.id && normalizeIdValues(item.values?.[property.id]).includes(target.id), `${label}与记录 ${target.id} 的反向关联不一致。`);
      }
    }
  }
  if (!structureRestored) return;
  for (const definition of next.relations || []) {
    if (!inScope(definition, sourceId)) continue;
    requireRestore(fields.get(definition.sourceId)?.get(definition.propertyId)?.type === "relation", "历史关系定义的来源属性已删除。");
  }
  for (const edge of oldDefinitions.values()) {
    if (edge.sourceId !== sourceId || edge.targetSourceId === sourceId || !edge.reciprocalPropertyId) continue;
    const replacement = lookup(edge.sourceId, edge.propertyId);
    if (replacement?.targetSourceId === edge.targetSourceId && replacement.reciprocalPropertyId === edge.reciprocalPropertyId) continue;
    const linked = (liveRows.get(edge.targetSourceId) || []).some((item) =>
      normalizeIdValues(item.values?.[edge.reciprocalPropertyId]).some((id) => items.get(id)?.sourceId === sourceId));
    requireRestore(!linked, `目标数据库「${sources.get(edge.targetSourceId)?.title || edge.targetSourceId}」仍使用反向关联 ${edge.reciprocalPropertyId}。`);
  }
}

function withUniqueCounters(source, previousSource, items, single) {
  const previous = byId(previousSource.properties);
  let changed = false;
  const properties = source.properties.map((property) => {
    if (property.type !== "unique_id") return property;
    const seen = new Set();
    let highest = 0;
    for (const item of items) {
      const value = item.values?.[property.id];
      if (value == null || value === "") continue;
      requireRestore(Number.isSafeInteger(value) && value > 0 && !seen.has(value), `属性「${property.name || property.id}」的编号与现有记录冲突。`);
      seen.add(value);
      highest = Math.max(highest, value);
    }
    const nextNumber = Math.max(property.config?.nextNumber || 1, previous.get(property.id)?.config?.nextNumber || 1, highest + 1);
    if (single) {
      requireRestore(nextNumber === property.config?.nextNumber, `属性「${property.name || property.id}」的编号需要整库恢复。`);
      return property;
    }
    if (nextNumber === property.config?.nextNumber) return property;
    changed = true;
    return { ...property, config: { ...property.config, nextNumber } };
  });
  return changed ? { ...source, properties } : source;
}

function applyPageLifecycle(workspace, rows, historical, sourceId, itemId, now) {
  let result = workspace;
  const removedPageIds = new Set();
  const recoveredPageIds = new Set();
  if (itemId) return { result, removedPageIds, recoveredPageIds };
  const currentPages = byId(workspace.pages);
  const historicalPages = new Set([...historical.values()].map((row) => row.pageId));
  for (const row of rows.values()) {
    if (row.sourceId !== sourceId || historical.has(row.id)) continue;
    const page = currentPages.get(row.pageId);
    if (!page || page.trashedAt || removedPageIds.has(page.id) || row.trashedAt) continue;
    requireRestore(!row.locked && !page.settings?.locked, `新记录「${page.title || row.id}」已锁定。`);
    requireRestore(!isPageArchived(workspace, page.id), `新记录「${page.title || row.id}」已归档，请先解除归档。`);
    const trashed = trashPage(result, page.id, now);
    for (const entry of trashed.pages) {
      if (!entry.trashedAt || currentPages.get(entry.id)?.trashedAt || removedPageIds.has(entry.id)) continue;
      requireRestore(!entry.settings?.locked, `记录下的页面「${entry.title || entry.id}」已锁定。`);
      requireRestore(!isPageArchived(workspace, entry.id), `记录下的页面「${entry.title || entry.id}」已归档，请先解除归档。`);
      requireRestore(!historicalPages.has(entry.id), "新记录包含仍需恢复的历史记录，请先调整页面归属。");
      removedPageIds.add(entry.id);
    }
    result = trashed;
  }
  const pages = byId(result.pages);
  const folders = byId(result.folders);
  for (const pageId of historicalPages) {
    const page = pages.get(pageId);
    if (!page?.trashedAt) continue;
    const root = page.trashedByPageId || page.id;
    requireRestore(!page.trashedByFolderId && historicalPages.has(root), `记录「${page.title || pageId}」随其他页面或文件夹删除，请先从回收站恢复该组。`);
    const { pageIds } = trashGroupMembers(result, { kind: "page", id: root });
    requireRestore(pageIds.includes(pageId), `记录「${page.title || pageId}」的回收站分组已失效。`);
    for (const id of pageIds) recoveredPageIds.add(id);
  }
  for (const id of recoveredPageIds) {
    const page = pages.get(id);
    const parent = pages.get(page.parentPageId);
    requireRestore(!page.settings?.locked, `待恢复页面「${page.title || id}」已锁定。`);
    requireRestore(!isPageArchived(workspace, page.id), `待恢复页面「${page.title || id}」已归档，请先解除归档。`);
    requireRestore(folders.has(page.folderId) && !folders.get(page.folderId).trashedAt, `待恢复页面「${page.title || id}」的文件夹不可用。`);
    requireRestore(!page.parentPageId || (parent && (!parent.trashedAt || recoveredPageIds.has(parent.id))), `待恢复页面「${page.title || id}」的上级页面不可用。`);
  }
  if (recoveredPageIds.size) {
    const ui = { ...result.ui, trashRestoreState: { ...result.ui?.trashRestoreState } };
    for (const id of recoveredPageIds) delete ui.trashRestoreState[`page:${id}`];
    if (!Object.keys(ui.trashRestoreState).length) delete ui.trashRestoreState;
    result = { ...result, ui, pages: result.pages.map((page) => recoveredPageIds.has(page.id)
      ? { ...page, trashedAt: null, trashedByFolderId: null, trashedByPageId: null, updatedAt: now } : page) };
  }
  return { result, removedPageIds, recoveredPageIds };
}

function summarizeFields(current, historic) {
  const fields = byId(current);
  const changes = [];
  for (const entry of historic) {
    const live = fields.get(entry.id);
    if (!same(live, entry)) changes.push({ id: entry.id, name: entry.name, before: live?.type, after: entry.type, kind: live ? "updated" : "restored" });
    fields.delete(entry.id);
  }
  for (const entry of fields.values()) changes.push({ id: entry.id, name: entry.name, before: entry.type, kind: "removed" });
  return changes;
}

function planRestore(workspace, sourceId, versionId, { itemId, now }) {
  const version = (workspace.databaseVersions || []).find((entry) => entry.id === versionId && entry.sourceId === sourceId);
  const source = byId(workspace.dataSources).get(sourceId);
  const pages = byId(workspace.pages);
  const owner = pages.get(source?.ownerPageId);
  requireRestore(version?.source?.id === sourceId && Array.isArray(version.items) && Array.isArray(version.views)
    && Array.isArray(version.relations) && Array.isArray(version.source.properties), "找不到有效的数据库版本。");
  requireRestore(source && !source.trashedAt && (!source.ownerPageId || (owner && !owner.trashedAt)), "数据库或所在页面不可用。");
  requireRestore(!source.locked && !owner?.settings?.locked, "数据库或所在页面已锁定。");
  requireRestore(!isPageArchived(workspace, owner?.id), "数据库所在页面已归档，请先解除归档。");
  requireRestore(itemId || (version.source.ownerPageId || null) === (source.ownerPageId || null), "数据库的所属页面已经变更。");

  const rows = byId(workspace.databaseItems);
  const historical = byId(itemId ? version.items.filter((item) => item.id === itemId) : version.items);
  requireRestore(!itemId || historical.has(itemId), "该版本中没有这条记录。");
  requireRestore(itemId || historical.size === version.items.length, "版本包含重复记录 ID。");
  const assignments = new Map(), pageAssignments = new Map(), updatedRows = new Set();
  const titleField = (itemId ? source : version.source).properties.find((property) => property.type === "title");
  for (const saved of historical.values()) {
    const item = rows.get(saved.id);
    const page = pages.get(saved.pageId);
    requireRestore(item?.sourceId === sourceId && saved.sourceId === sourceId && item.pageId === saved.pageId && page, `历史记录 ${saved.id} 或其页面已永久删除或移到其他数据库。`);
    requireRestore(!item.locked && !page.settings?.locked, `记录「${page.title || item.id}」已锁定。`);
    requireRestore(!isPageArchived(workspace, page.id), `记录「${page.title || item.id}」已归档，请先解除归档。`);
    requireRestore(!itemId || (!item.trashedAt && !page.trashedAt), `记录「${page.title || item.id}」在回收站中。`);
    const values = restoreValues(item, saved, source, version.source, Boolean(itemId));
    const parentItemId = saved.parentItemId ?? null;
    const updated = { ...item, values, parentItemId, dependencyIds: copyJson(saved.dependencyIds || []) };
    if (!itemId && item.trashedAt) updated.trashedAt = null;
    if (!same(item, updated)) {
      assignments.set(item.id, { ...updated, updatedAt: now });
      updatedRows.add(item.id);
    }
    const patch = {};
    if ((page.parentDatabaseItemId ?? null) !== parentItemId) patch.parentDatabaseItemId = parentItemId;
    if (!itemId && titleField && typeof values[titleField.id] === "string" && values[titleField.id] !== item.values?.[titleField.id]) patch.title = values[titleField.id];
    if (Object.keys(patch).length) {
      pageAssignments.set(page.id, patch);
      updatedRows.add(item.id);
    }
  }
  let restoredSource = itemId ? source : { ...copyJson(version.source), createdAt: source.createdAt, updatedAt: now };
  if (!itemId) {
    // Identity and permission belong to the live source.
    for (const field of ["locked", "trashedAt"]) {
      if (Object.hasOwn(source, field)) restoredSource[field] = source[field];
      else delete restoredSource[field];
    }
  }
  let { result, removedPageIds, recoveredPageIds } = applyPageLifecycle(workspace, rows, historical, sourceId, itemId, now);
  const candidateItems = (workspace.databaseItems || []).map((item) => assignments.get(item.id) || item);
  restoredSource = withUniqueCounters(restoredSource, source, candidateItems.filter((item) => item.sourceId === sourceId), Boolean(itemId));
  if (same(withoutTimestamp(source), withoutTimestamp(restoredSource))) restoredSource = source;
  if (pageAssignments.size) result = { ...result, pages: result.pages.map((page) => pageAssignments.has(page.id)
    ? { ...page, ...pageAssignments.get(page.id), updatedAt: now } : page) };
  const liveViews = byId(workspace.databaseViews);
  const protectedViews = itemId ? new Set() : externalViewIds(workspace, source);
  const localViews = new Set((itemId ? [] : ownViews(workspace, source, protectedViews)).map((view) => view.id));
  const replacements = new Map();
  if (!itemId) for (const view of version.views) {
    requireRestore(view.sourceId === sourceId && !view.linked && !view.trashedAt, "版本包含归属无效的视图。");
    const live = liveViews.get(view.id);
    requireRestore(!live || live.sourceId === sourceId, `历史视图「${view.name || view.id}」的 ID 已被其他数据库占用。`);
    requireRestore(live || !protectedViews.has(view.id), `历史视图「${view.name || view.id}」仍有外部引用，请先修复该引用。`);
    if ((!live || localViews.has(view.id)) && !same(live, view)) replacements.set(view.id, copyJson(view));
  }
  const views = replacements.size ? (workspace.databaseViews || []).map((view) => replacements.get(view.id) || view)
    .concat([...replacements.values()].filter((view) => !liveViews.has(view.id))) : workspace.databaseViews;
  let relations = workspace.relations;
  if (!itemId) {
    const oldRelations = (workspace.relations || []).filter((entry) => entry.sourceId !== sourceId);
    const ownRelations = version.relations.filter((edge) => edge.sourceId === sourceId);
    const protectedIds = byId(oldRelations);
    requireRestore(ownRelations.every((edge) => !protectedIds.has(edge.id)) && byId(ownRelations).size === ownRelations.length, "历史关系 ID 与当前数据库冲突。");
    const merged = [...oldRelations, ...copyJson(ownRelations)];
    if (!same(sorted(merged), sorted(relations || []))) relations = merged;
  }
  const summary = {
    columns: itemId ? [] : summarizeFields(source.properties, restoredSource.properties),
    columnOrderChanged: !itemId && !same(source.properties.map(({ id }) => id), restoredSource.properties.map(({ id }) => id)),
    sourceChanged: restoredSource !== source,
    rowsChanged: updatedRows.size,
    rowsRestored: [...historical.values()].filter((item) => recoveredPageIds.has(item.pageId) || rows.get(item.id)?.trashedAt).length,
    rowsToTrash: [...rows.values()].filter((item) => item.sourceId === sourceId && removedPageIds.has(item.pageId)).length,
    pagesToTrash: removedPageIds.size,
    pagesRestored: recoveredPageIds.size,
    views: [...replacements.values()].map((view) => {
      const live = liveViews.get(view.id);
      const fields = ["name", "type", "filter", "sorts", "groupBy", "grouping", "visiblePropertyIds", "config"];
      return { id: view.id, name: view.name, kind: live ? "updated" : "restored", fields: live ? fields.filter((key) => !same(live[key], view[key])) : [] };
    }),
    viewsPreserved: itemId ? 0 : (workspace.databaseViews || []).filter((view) => view.sourceId === sourceId && !replacements.has(view.id) && !version.views.some((entry) => entry.id === view.id && localViews.has(view.id))).length,
  };
  const changed = restoredSource !== source || updatedRows.size || removedPageIds.size || recoveredPageIds.size || replacements.size || relations !== workspace.relations;
  let attachmentIds = [];
  if (changed) {
    result = {
      ...result,
      dataSources: restoredSource === source ? workspace.dataSources : workspace.dataSources.map((entry) => entry.id === sourceId ? restoredSource : entry),
      databaseItems: assignments.size ? candidateItems : workspace.databaseItems,
      databaseViews: views, relations,
    };
    const restored = [...historical.keys()].map((id) => assignments.get(id) || rows.get(id));
    const resultPages = byId(result.pages);
    attachmentIds = validateItemLinks(result, restoredSource, restored, resultPages);
    if (Array.isArray(restoredSource.recordLayout?.views) && !same(restoredSource.recordLayout, source.recordLayout)) {
      const sourceIndex = byId(result.dataSources);
      const viewIndex = byId(result.databaseViews);
      for (const layoutView of restoredSource.recordLayout.views) {
        const target = sourceIndex.get(layoutView.sourceId);
        const targetPage = resultPages.get(target?.ownerPageId);
        const view = viewIndex.get(layoutView.viewId);
        requireRestore(target && !target.trashedAt && (!target.ownerPageId || (targetPage && !targetPage.trashedAt))
          && view?.sourceId === target.id && !view.trashedAt, `记录布局中的「${layoutView.name || layoutView.viewId}」引用的数据库或视图已不可用。`);
      }
    }
    validateRelations(workspace, result, sourceId, new Set(historical.keys()), !itemId);
    const blocking = ({ severity, code }) => severity === "error" || code.startsWith("RELATION_VALUE_");
    const oldProblems = new Set(checkWorkspaceIntegrity(workspace).problems.filter(blocking).map(stableJson));
    const problem = checkWorkspaceIntegrity(result).problems.find((entry) => blocking(entry) && !oldProblems.has(stableJson(entry)));
    requireRestore(!problem, problem && `恢复会产生无效引用（${problem.id}）：${problem.detail}`);
  }
  if (!changed) return { result, summary, changed: false, expectedSignature: "no-change", attachmentIds };
  const current = snapshot(workspace, source, pages);
  requireRestore(versionFits({ ...current, id: "v".repeat(200), sourceId, createdAt: now, reason: "pre-restore", signature: "0000000000:00000000" }),
    "当前数据库版本超过 19 MiB，无法保存恢复前的快照。");
  const expectedSignature = stableJson({
    sourceId, itemId, versionId, current: snapshotKey(current),
    target: snapshotKey(version), removedPageIds: [...removedPageIds].sort(), recoveredPageIds: [...recoveredPageIds].sort(),
    views: summary.views, rowsChanged: summary.rowsChanged,
  });
  return { result, summary, changed: Boolean(changed), expectedSignature, attachmentIds };
}

export function previewDatabaseRestore(workspace, sourceId, versionId, { itemId } = {}) {
  try {
    const { summary, changed, expectedSignature, attachmentIds } = planRestore(workspace, sourceId, versionId, { itemId, now: "1970-01-01T00:00:00.000Z" });
    return { ok: true, summary, changed, expectedSignature, attachmentIds };
  } catch (error) { return { ok: false, reason: error.message }; }
}

export async function assertDatabaseRestoreAttachments(workspace, preview) {
  requireRestore(preview?.ok, preview?.reason || "请先预览数据库恢复的影响。");
  const attachments = byId(workspace.attachments);
  for (const id of preview.attachmentIds) {
    const attachment = attachments.get(id);
    requireRestore(attachment, `缺少历史附件 ${id}。`);
    let available = true;
    try {
      if (attachment.provider === "local-ref") available = Boolean(await readBrowserAttachmentBlob(attachment.storageKey || id));
      if (attachment.provider === "asset") {
        const url = `life-asset://${attachment.storageKey}`;
        available = Boolean(assetHashFromUrl(url)) && (await fetch(url, { method: "HEAD" })).ok;
      }
    } catch { available = false; }
    requireRestore(available, `历史附件「${attachment.name || id}」的文件不可用。`);
  }
}

export function restoreDatabaseVersion(workspace, sourceId, versionId, { itemId, expectedSignature, now = Date.now(), idFactory = newEntityId } = {}) {
  requireRestore(typeof expectedSignature === "string", "请先预览数据库恢复的影响。");
  const time = new Date(now).toISOString();
  const plan = planRestore(workspace, sourceId, versionId, { itemId, now: time });
  requireRestore(plan.expectedSignature === expectedSignature, "预览后数据库发生了变化，请重新预览。");
  if (!plan.changed) return workspace;
  const state = snapshot(workspace, byId(workspace.dataSources).get(sourceId));
  return appendVersion(plan.result, state, { reason: "pre-restore", now: time, idFactory, force: true });
}
