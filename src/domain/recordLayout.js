import { isPageArchived } from "./archive.js";

export const MAX_PINNED_RECORD_PROPERTIES = 15;

const entries = value => Array.isArray(value) ? value : [];
const isId = value => typeof value === "string" && value.trim() !== "";

export function normalizeRecordLayout(layout, source) {
  if (!layout || typeof layout !== "object" || Array.isArray(layout)) return null;
  const available = new Set((source?.properties || []).filter(property => property.type !== "title").map(property => property.id));
  const takeProperties = (ids, limit = Infinity) => {
    const kept = [];
    for (const id of entries(ids)) {
      if (kept.length === limit) break;
      if (available.delete(id)) kept.push(id);
    }
    return kept;
  };
  const distinct = (collection, normalize) => {
    const seen = new Set();
    return entries(collection).flatMap(entry => {
      if (!isId(entry?.id) || seen.has(entry.id)) return [];
      const next = normalize(entry);
      if (!next) return [];
      seen.add(entry.id);
      return [next];
    });
  };
  const name = (value, fallback) => typeof value === "string" && value.trim() ? value.trim() : fallback;
  return {
    mode: layout.mode === "tabs" ? "tabs" : "simple",
    pinnedPropertyIds: takeProperties(layout.pinnedPropertyIds, MAX_PINNED_RECORD_PROPERTIES),
    sections: distinct(layout.sections, entry => ({ id: entry.id, name: name(entry.name, "属性分区"), propertyIds: takeProperties(entry.propertyIds) })),
    views: distinct(layout.views, entry => isId(entry.sourceId) && isId(entry.viewId) ? {
      id: entry.id, name: name(entry.name, "关联视图"), sourceId: entry.sourceId, viewId: entry.viewId,
    } : null),
  };
}

export function resolveRecordLayoutView(workspace, { sourceId, viewId }) {
  const source = workspace?.dataSources?.find(entry => entry.id === sourceId && !entry.trashedAt);
  if (!source || source.ownerPageId && !workspace.pages?.some(page => page.id === source.ownerPageId && !page.trashedAt)) return null;
  const view = workspace.databaseViews?.find(entry => entry.id === viewId && entry.sourceId === sourceId && !entry.trashedAt);
  return view ? { source, view, archived: isPageArchived(workspace, source.ownerPageId) } : null;
}
