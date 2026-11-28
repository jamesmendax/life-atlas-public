import { dataSourceById, databaseItemById, updateDatabaseItemValue } from "./database.js";
import { normalizeIdValues, normalizePropertyValue } from "./databaseProperties.js";
import { assertRecordWritable, databaseRecords, databaseScheduleError } from "./databaseSubitems.js";
import { scheduleDate, scheduleSuccessor } from "./databaseScheduleDates.js";

export const DEPENDENCY_MODES = Object.freeze({ none: "不自动移动", overlap: "重叠时顺延", "preserve-gap": "移动时保留间距" });

export function normalizeDependencyConfig(source, input = source?.dependencyConfig) {
  const datePropertyId = source?.properties?.find((property) => property.type === "date" && property.id === input?.datePropertyId)?.id ?? null;
  return {
    datePropertyId,
    mode: datePropertyId && Object.hasOwn(DEPENDENCY_MODES, input?.mode) ? input.mode : "none",
    skipWeekends: Boolean(input?.skipWeekends),
  };
}

function requireSchedule(value) {
  const date = scheduleDate(value);
  if (!date) throw databaseScheduleError("missing-dependency-date", "排期涉及没有日期的记录。请先填写相关日期。");
  return date;
}

function scheduleFields(date) {
  return JSON.stringify([date?.start, date?.end, date?.includeTime, date?.timeZone]);
}

function requirePredecessor(items, records, id) {
  const item = items.get(id);
  if (!records.available(item)) throw databaseScheduleError("invalid-dependency", "前置记录必须在同一数据源且可用。");
  return item;
}

export function setItemDependencies(workspace, itemId, ids, now = new Date().toISOString()) {
  const item = databaseItemById(workspace, itemId);
  const source = item && dataSourceById(workspace, item.sourceId);
  if (!source) throw databaseScheduleError("unavailable-record", "找不到要调整的记录。");
  const records = databaseRecords(workspace);
  assertRecordWritable(workspace, records, source, item);
  const before = normalizeIdValues(item.dependencyIds);
  const next = normalizeIdValues(ids);
  if (before.length === next.length && before.every((id, index) => next[index] === id)) return workspace;
  const items = new Map(workspace.databaseItems.filter((entry) => entry.sourceId === source.id).map((entry) => [entry.id, entry]));
  const config = normalizeDependencyConfig(source);
  const known = new Set(before);
  const visited = new Set();
  const stack = [...next];
  while (stack.length) {
    const id = stack.pop();
    if (id === item.id) throw databaseScheduleError("dependency-cycle", "此前置记录会形成循环依赖。");
    if (visited.has(id)) continue;
    visited.add(id);
    const predecessor = requirePredecessor(items, records, id);
    stack.push(...normalizeIdValues(predecessor.dependencyIds));
  }
  if (config.mode !== "none" && next.some((id) => !known.has(id))) {
    requireSchedule(item.values?.[config.datePropertyId]);
    for (const id of next) if (!known.has(id)) requireSchedule(items.get(id).values?.[config.datePropertyId]);
  }
  return { ...workspace, databaseItems: workspace.databaseItems.map((entry) => entry.id === itemId ? { ...entry, dependencyIds: next, updatedAt: now } : entry) };
}

function scheduleSource(workspace, source, records, config, edited, staged, now) {
  const propertyId = config.datePropertyId;
  const items = new Map(workspace.databaseItems.filter((item) => item.sourceId === source.id).map((item) => [item.id, item]));
  const predecessors = new Map();
  const followers = new Map();
  for (const item of items.values()) {
    if (!records.available(item)) continue;
    const ids = normalizeIdValues(item.dependencyIds);
    predecessors.set(item.id, ids);
    for (const id of ids) {
      if (!followers.has(id)) followers.set(id, []);
      followers.get(id).push(item.id);
    }
  }
  const affected = new Set(edited);
  for (const id of affected) for (const follower of followers.get(id) || []) affected.add(follower);
  const remaining = new Map();
  const ordered = [];
  for (const id of affected) {
    const count = (predecessors.get(id) || []).filter((predecessor) => affected.has(predecessor)).length;
    remaining.set(id, count);
    if (!count) ordered.push(id);
  }
  for (const id of ordered) {
    for (const follower of followers.get(id) || []) {
      const count = remaining.get(follower) - 1;
      remaining.set(follower, count);
      if (!count) ordered.push(follower);
    }
  }
  if (ordered.length !== affected.size) throw databaseScheduleError("dependency-cycle", "记录之间存在循环依赖，请先检查前置关系。");

  const scheduleBefore = (item) => requireSchedule(item.values?.[propertyId]);
  const scheduleAfter = (item) => requireSchedule((staged.get(item.id) || item).values?.[propertyId]);
  const changed = new Set();
  for (const id of ordered) {
    const item = items.get(id);
    const incoming = predecessors.get(id) || [];
    if (edited.has(id)) {
      if (incoming.length || followers.has(id)) {
        scheduleAfter(item);
        for (const predecessor of incoming) scheduleAfter(requirePredecessor(items, records, predecessor));
      }
      changed.add(id);
      continue;
    }
    if (!incoming.some((predecessor) => changed.has(predecessor))) continue;
    const current = scheduleBefore(item);
    const boundaries = incoming.map((predecessor) => {
      const previous = requirePredecessor(items, records, predecessor);
      const after = scheduleAfter(previous);
      const moved = changed.has(predecessor);
      return { before: config.mode === "preserve-gap" && moved ? scheduleBefore(previous) : after, after, changed: moved };
    });
    const next = scheduleSuccessor(current, boundaries, config.mode, config.skipWeekends);
    if (current === next) continue;
    assertRecordWritable(workspace, records, source, item);
    staged.set(id, updateDatabaseItemValue(staged.get(id) || item, propertyId, next.date, now));
    changed.add(id);
  }
}

export function applyDependencyDateChanges(workspace, changes, now = new Date().toISOString()) {
  if (!changes.length) return workspace;
  const staged = new Map();
  const rootsBySource = new Map();
  const records = databaseRecords(workspace);
  const items = new Map((workspace.databaseItems || []).map((item) => [item.id, item]));
  for (const { itemId, propertyId, value } of changes) {
    const item = items.get(itemId);
    const source = item && dataSourceById(workspace, item.sourceId);
    const property = source?.properties?.find((entry) => entry.id === propertyId && entry.type === "date");
    if (!property) throw databaseScheduleError("invalid-date-property", "找不到要修改的日期属性。");
    assertRecordWritable(workspace, records, source, item);
    const previous = staged.get(itemId) || item;
    const config = normalizeDependencyConfig(source);
    const configured = config.datePropertyId === propertyId;
    const next = configured ? scheduleDate(value)?.date ?? null : normalizePropertyValue(property, value);
    if (JSON.stringify(normalizePropertyValue(property, previous.values?.[propertyId])) === JSON.stringify(next)) continue;
    staged.set(itemId, updateDatabaseItemValue(previous, propertyId, next, now));
    if (configured && config.mode !== "none") {
      if (!rootsBySource.has(source)) rootsBySource.set(source, { config, edited: new Set() });
      rootsBySource.get(source).edited.add(itemId);
    }
  }
  for (const [source, { config, edited }] of rootsBySource) {
    const propertyId = config.datePropertyId;
    for (const id of edited) {
      const before = normalizePropertyValue("date", items.get(id).values?.[propertyId]);
      const after = staged.get(id).values[propertyId];
      if (scheduleFields(before) === scheduleFields(after)) edited.delete(id);
    }
    if (edited.size) scheduleSource(workspace, source, records, config, edited, staged, now);
  }
  return staged.size ? { ...workspace, databaseItems: workspace.databaseItems.map((item) => staged.get(item.id) || item) } : workspace;
}

export function applyDependencyDateChange(workspace, { now, ...change }) {
  return applyDependencyDateChanges(workspace, [change], now);
}
