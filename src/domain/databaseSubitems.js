import { isPageArchived } from "./archive.js";
import { dataSourceById, databaseItemById } from "./database.js";

export function databaseScheduleError(code, message) {
  return Object.assign(new Error(message), { code });
}

export function databaseRecords(workspace) {
  const pages = new Map((workspace.pages || []).map((page) => [page.id, page]));
  const available = (item) => {
    const page = item && pages.get(item.pageId);
    return Boolean(page && !page.trashedAt && !isPageArchived(workspace, page.id));
  };
  return { pages, available };
}

export function assertRecordWritable(workspace, records, source, item) {
  const owner = records.pages.get(source.ownerPageId);
  if (!records.available(item) || (source.ownerPageId && (!owner || owner.trashedAt || isPageArchived(workspace, owner.id)))) {
    throw databaseScheduleError("unavailable-record", "记录或数据源当前不可编辑。");
  }
  if (source.locked || owner?.settings?.locked || records.pages.get(item.pageId)?.settings?.locked) {
    throw databaseScheduleError("locked-record", "排期或层级涉及已锁定的记录或数据源，请先解锁。");
  }
}

export function setDatabaseItemParent(workspace, itemId, parentId, now = new Date().toISOString()) {
  const item = databaseItemById(workspace, itemId);
  const source = item && dataSourceById(workspace, item.sourceId);
  if (!source) throw databaseScheduleError("unavailable-record", "找不到要调整的记录。");
  const records = databaseRecords(workspace);
  assertRecordWritable(workspace, records, source, item);
  const nextId = parentId ?? null;
  if (nextId === (item.parentItemId ?? null)) return workspace;
  if (nextId !== null) {
    const items = new Map(workspace.databaseItems.filter((entry) => entry.sourceId === source.id).map((entry) => [entry.id, entry]));
    const parent = items.get(nextId);
    if (!records.available(parent)) throw databaseScheduleError("invalid-parent", "请选择同一数据源中可用的父项。");
    assertRecordWritable(workspace, records, source, parent);
    const visited = new Set([itemId]);
    for (let ancestor = parent; ancestor; ancestor = items.get(ancestor.parentItemId)) {
      if (visited.has(ancestor.id)) throw databaseScheduleError("parent-cycle", "父项不能是这条记录或其子项。");
      visited.add(ancestor.id);
    }
  }
  return {
    ...workspace,
    databaseItems: workspace.databaseItems.map((entry) => entry.id === itemId ? { ...entry, parentItemId: nextId, updatedAt: now } : entry),
    pages: workspace.pages.map((page) => page.id === item.pageId ? { ...page, parentDatabaseItemId: nextId, updatedAt: now } : page),
  };
}

export function subitemViewConfig(view) {
  const config = view?.config?.subitems;
  const rowView = view?.type === "table" || view?.type === "list";
  const cardView = view?.type === "board" || view?.type === "gallery";
  const filters = rowView ? ["all", "parents", "children"] : cardView || view?.type === "calendar" ? ["all", "parents"] : ["all"];
  return {
    display: rowView || cardView ? ["nested", "flat"].includes(config?.display) ? config.display : rowView ? "nested" : "flat" : "flat",
    filter: filters.includes(config?.filter) ? config.filter : "all",
  };
}

export function filterSubitems(items, filter) {
  if (filter === "all") return items;
  return items.filter((item) => filter === "children" ? Boolean(item.parentItemId) : !item.parentItemId);
}

export function subitemForest(items) {
  const visible = new Set(items.map((item) => item.id));
  const children = new Map();
  const roots = [];
  for (const item of items) {
    if (!visible.has(item.parentItemId) || item.id === item.parentItemId) roots.push(item);
    else {
      if (!children.has(item.parentItemId)) children.set(item.parentItemId, []);
      children.get(item.parentItemId).push(item);
    }
  }
  return { roots, children };
}

export function subitemRows(items, display, collapsed = new Set()) {
  if (display === "flat") return items.map((item) => ({ item, depth: 0, hasChildren: false }));
  const { roots, children } = subitemForest(items);
  const rows = [];
  const seen = new Set();
  const visit = (root) => {
    const stack = [{ item: root, depth: 0, hidden: false }];
    while (stack.length) {
      const { item, depth, hidden } = stack.pop();
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      const descendants = children.get(item.id) || [];
      if (!hidden) rows.push({ item, depth, hasChildren: descendants.length > 0 });
      for (let index = descendants.length - 1; index >= 0; index--) {
        stack.push({ item: descendants[index], depth: depth + 1, hidden: hidden || collapsed.has(item.id) });
      }
    }
  };
  for (const item of roots) visit(item);
  // Preserve access to records from imported workspaces with a malformed parent cycle.
  for (const item of items) if (!seen.has(item.id)) visit(item);
  return rows;
}
