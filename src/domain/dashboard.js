import { projectViewItems, resolvePropertyValue, searchViewItems } from "./database.js";
import { localDateWindow, overlapsLocalDateWindow } from "./databaseDateRange.js";
import { VIEW_REGISTRY } from "./viewRegistry.js";

export const dashboardViewTypes = ["table", "board", "list", "gallery", "calendar", "timeline", "chart", "roadmap", "feed", "map"].filter(type => VIEW_REGISTRY[type]);
export const widgetNames = { view: "已保存视图", metric: "指标", chart: "图表", list: "列表" };
export function dashboardChartTitle(source, chart) {
  const category = source?.properties.find(property => property.id === chart?.xPropertyId);
  if (chart?.kind === "number") return chart.aggregation === "count" ? "记录总数" : "数值";
  if (chart?.kind === "donut" && category) return category.name + "分布";
  return "图表";
}
export function dashboardSources(workspace) {
  return (workspace.dataSources || []).filter(source => !source.ownerPageId || workspace.pages?.some(page => page.id === source.ownerPageId && !page.trashedAt));
}
export function availableViews(workspace, sourceId) {
  return (workspace.databaseViews || []).filter(view => !view.trashedAt && view.sourceId === sourceId && dashboardViewTypes.includes(view.type));
}
export function compatibleFields(from, to) {
  return from && to && (from.type === to.type || ["title","text"].includes(from.type) && ["title","text"].includes(to.type));
}

function localCondition(rule, primary, source) {
  const origin = primary.properties.find(p => p.id === rule.propertyId);
  if (!origin || (relativePeriod(rule.operator) && origin.type !== "date")) return null;
  if (primary.id === source.id) return rule;
  const target = source.properties.find(p => p.id === rule.mappings?.[source.id]);
  if (!compatibleFields(origin, target)) return null;
  let value = rule.value;
  if (["equals","not_equals","contains","does_not_contain"].includes(rule.operator) && ["select","multi_select","status"].includes(origin.type)) {
    const option = origin.options?.find(option => option.id === value);
    if (option) {
      const targetOption = target.options?.find(entry => entry.name === option.name);
      // Equality compares option IDs. Contains compares display text.
      value = ["contains","does_not_contain"].includes(rule.operator) ? option.name : targetOption?.id ?? null;
      if (!targetOption && ["equals","not_equals"].includes(rule.operator)) {
        return rule.operator === "equals" ? { or: [] } : { and: [] };
      }
    }
  }
  return { propertyId: target.id, operator: rule.operator, value, valueType: rule.valueType };
}

export const relativePeriod = operator => operator === "this_week" || operator === "this_month";

export function dashboardProjection({workspace, primary, dashboard, widget, globalFilters = [], items, query = "", now = new Date()}) {
  const sourceId = widget.sourceId || primary.id;
  const source = dashboardSources(workspace).find(entry => entry.id === sourceId);
  if (!source) return { error: "数据源已删除或位于回收站。可在编辑模式中重新选择。", items: [] };
  const sameSource = sourceId === primary.id;
  const view = widget.type === "view" ? availableViews(workspace, sourceId).find(entry => entry.id === widget.viewId) : null;
  if (widget.type === "view" && !view) return { source, error: widget.viewId ? "此视图已删除、已更换数据源或无法嵌入。请重新选择已保存视图。" : "请选择要显示的已保存视图。", items: [] };
  const conditions = globalFilters.map(rule => localCondition(rule, primary, source));
  const scope = view || (sameSource ? dashboard : { sourceId });
  const filters = [scope.filter, sameSource && view && dashboard.filter, ...conditions.filter(rule => !relativePeriod(rule?.operator))].filter(Boolean);
  let result = projectViewItems(workspace, { ...scope, filter: { and: filters } }, { now });
  for (const rule of conditions.filter(rule => relativePeriod(rule?.operator))) {
    const property = source.properties.find(p => p.id === rule.propertyId && p.type === "date");
    const window = localDateWindow(rule.operator, now);
    result = property ? result.filter(item => overlapsLocalDateWindow(resolvePropertyValue(workspace,source,item,property), window)) : [];
  }
  if (sameSource && items) {
    const allowed = new Set(items.map(item => item.id));
    result = result.filter(item => allowed.has(item.id));
  } else if (query) result = searchViewItems(workspace, source, result, query);
  return { source, view, items: result, unmapped: conditions.filter(condition => !condition).length };
}

export const widthOf = widget => Math.max(1, Math.min(4, Math.round(Number(widget.span) || (widget.size === "small" ? 2 : 4))));
export const clampHeight = height => Math.max(140, Math.min(1000, Math.round(height)));
const columns = 4;
const rowWidth = widgets => widgets.reduce((sum, widget) => sum + widthOf(widget), 0);
const savedRowHeight = widgets => widgets.find(widget => Number.isFinite(widget.rowHeight))?.rowHeight || null;

export function dashboardRowHeight(widgets) {
  const saved = savedRowHeight(widgets);
  if (saved) return clampHeight(saved);
  if (widgets.some(widget => widget.type === "view" || widget.type === "chart")) return 390;
  return widgets.some(widget => widget.type === "list") ? 240 : 150;
}

export function dashboardRows(widgets) {
  const rows = [];
  let occupied = 0;
  for (const widget of widgets) {
    const span = widthOf(widget);
    if (!rows.length || widget.startRow === true || occupied + span > columns) {
      rows.push([]);
      occupied = 0;
    }
    rows.at(-1).push(widget);
    occupied += span;
  }
  return rows;
}

export function moveWidget(widgets, id, target) {
  const from = widgets.findIndex(widget => widget.id === id);
  if (from < 0 || target < 0 || target >= widgets.length || target === from) return widgets;
  const result = widgets.slice();
  result.splice(target, 0, ...result.splice(from, 1));
  return result;
}

function editableRows(widgets) {
  return dashboardRows(widgets).map(tiles => ({ tiles, height: savedRowHeight(tiles), explicit: tiles[0].startRow === true, changed: false }));
}

function writeRows(rows) {
  let occupied = 0;
  return rows.filter(row => row.tiles.length).flatMap(row => {
    // An old auto-packed row may need a marker after an earlier row loses space.
    const startsRow = row.explicit || (occupied > 0 && occupied + widthOf(row.tiles[0]) <= columns);
    occupied = rowWidth(row.tiles);
    return row.tiles.map((widget, index) => {
      const startRow = startsRow && index === 0;
      const keepHeight = !row.changed || (widget.rowHeight ?? null) === row.height;
      if ((widget.startRow === true) === startRow && keepHeight) return widget;
      const updated = { ...widget };
      if (startRow) updated.startRow = true;
      else delete updated.startRow;
      if (!keepHeight) {
        if (row.height == null) delete updated.rowHeight;
        else updated.rowHeight = row.height;
      }
      return updated;
    });
  });
}

const findRow = (rows, id) => rows.find(row => row.tiles.some(widget => widget.id === id));
const indexOfTile = (row, id) => row.tiles.findIndex(widget => widget.id === id);
const adjacent = (index, size) => [index + 1, index - 1].filter(neighbor => neighbor >= 0 && neighbor < size);
const withSpan = (widget, span) => widthOf(widget) === span ? widget : { ...widget, span, size: span === columns ? "wide" : "small" };

function newRow(widget, height = savedRowHeight([widget])) {
  return { tiles: [widget], height, explicit: true, changed: true };
}

function insertAt(row, widget, index, balanceAddedWidget) {
  const free = columns - rowWidth(row.tiles);
  const capacity = columns - row.tiles.length;
  const balanced = Math.max(free, Math.floor(columns / (row.tiles.length + 1)));
  const span = Math.min(widthOf(widget), balanceAddedWidget ? balanced : capacity);
  let needed = Math.max(0, span - free);
  // Prefer the tiles closest to the insertion slot when reclaiming occupied columns.
  for (let distance = 0; needed > 0; distance += 1) {
    for (const neighbor of [index - 1 - distance, index + distance]) {
      if (neighbor < 0 || neighbor >= row.tiles.length) continue;
      const width = widthOf(row.tiles[neighbor]);
      const take = Math.min(needed, width - 1);
      row.tiles[neighbor] = withSpan(row.tiles[neighbor], width - take);
      needed -= take;
    }
  }
  row.tiles.splice(index, 0, withSpan(widget, span));
  row.changed = true;
}

function addRelativeRow(rows, targetRow, widget, side, height) {
  const index = targetRow ? rows.indexOf(targetRow) + (side === "before" ? 0 : 1) : rows.length;
  rows.splice(index, 0, newRow(widget, height));
}

export function insertWidget(widgets, widget, targetId = null, side = "after") {
  if (!widget?.id || widgets.some(tile => tile.id === widget.id)) return widgets;
  const rows = editableRows(widgets);
  const target = targetId == null ? null : findRow(rows, targetId);
  if (!target && targetId != null) return widgets;
  if (!target || target.tiles.length === columns) addRelativeRow(rows, target, widget, side);
  else insertAt(target, widget, indexOfTile(target, targetId) + (side === "before" ? 0 : 1), true);
  return writeRows(rows);
}

export function moveWidgetToRow(widgets, id, targetId = null, side = "after") {
  if (id === targetId) return widgets;
  const rows = editableRows(widgets);
  const from = findRow(rows, id);
  const to = targetId == null ? null : findRow(rows, targetId);
  if (!from || (!to && targetId != null)) return widgets;
  if (!to && from === rows.at(-1) && from.tiles.length === 1) return widgets;
  const fromIndex = indexOfTile(from, id);
  const widget = from.tiles[fromIndex];
  const toIndex = to ? indexOfTile(to, targetId) : -1;
  const after = side === "before" ? 0 : 1;

  if (from === to) {
    const index = toIndex + after - (fromIndex < toIndex ? 1 : 0);
    if (fromIndex === index) return widgets;
    from.tiles.splice(fromIndex, 1);
    from.tiles.splice(index, 0, widget);
    from.changed = true;
  } else if (to?.tiles.length === columns && widthOf(widget) === 1) {
    // A row with four tiles has four one-column slots, so the swap keeps both layouts.
    from.tiles[fromIndex] = to.tiles[toIndex];
    to.tiles[toIndex] = widget;
    from.changed = true;
    to.changed = true;
  } else {
    from.tiles.splice(fromIndex, 1);
    from.changed = true;
    if (!to || to.tiles.length === columns) addRelativeRow(rows, to, widget, side, from.height);
    else insertAt(to, widget, toIndex + after, false);
  }
  return writeRows(rows);
}

export function duplicateWidget(widgets, id, newId) {
  const source = widgets.find(widget => widget.id === id);
  if (!source) return widgets;
  return insertWidget(widgets, { ...structuredClone(source), id: newId }, id);
}

export function removeWidget(widgets, id) {
  const rows = editableRows(widgets);
  const row = findRow(rows, id);
  if (!row) return widgets;
  row.tiles.splice(indexOfTile(row, id), 1);
  row.changed = true;
  return writeRows(rows);
}

function maxWidgetWidth(row, index) {
  const free = columns - rowWidth(row.tiles);
  const available = adjacent(index, row.tiles.length).reduce((sum, neighbor) => sum + widthOf(row.tiles[neighbor]) - 1, free);
  return widthOf(row.tiles[index]) + available;
}

export function widgetResizeBounds(widgets, id) {
  const row = dashboardRows(widgets).find(tiles => tiles.some(widget => widget.id === id));
  const index = row?.findIndex(widget => widget.id === id);
  return { min: 1, max: row ? maxWidgetWidth({ tiles: row }, index) : columns };
}

export function resizeWidget(widgets, id, requested) {
  const rows = editableRows(widgets);
  const row = findRow(rows, id);
  if (!row || !Number.isFinite(requested)) return widgets;
  const index = indexOfTile(row, id);
  const original = widthOf(row.tiles[index]);
  const span = Math.max(1, Math.min(maxWidgetWidth(row, index), Math.round(requested)));
  if (span === original) return widgets;

  const neighbors = adjacent(index, row.tiles.length);
  if (span < original && neighbors.length) {
    const [neighbor] = neighbors;
    row.tiles[neighbor] = withSpan(row.tiles[neighbor], widthOf(row.tiles[neighbor]) + original - span);
  } else {
    let needed = Math.max(0, span - original - (columns - rowWidth(row.tiles)));
    for (const neighbor of neighbors) {
      const width = widthOf(row.tiles[neighbor]);
      const take = Math.min(needed, width - 1);
      row.tiles[neighbor] = withSpan(row.tiles[neighbor], width - take);
      needed -= take;
    }
  }
  row.tiles[index] = withSpan(row.tiles[index], span);
  return writeRows(rows);
}
