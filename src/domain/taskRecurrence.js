import { copyJson, stableJson } from "./blockDocument.js";
import { dateMillis } from "./databaseProperties.js";
import { resolveStatusValue, statusOptionGroup } from "./statusGroups.js";

export const RECURRENCE_UNITS = Object.freeze({ days: "天", weeks: "周", months: "月" });
const RECEIPT_LIMIT = 64;
const DAY_MS = 86_400_000;
const isoEndpoint = /^(\d{4}-\d{2}-\d{2})(?:T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,9})?)?(?:Z|[+-](?:[01]\d|2[0-3]):?[0-5]\d)?)?$/;

function monthlyAnchor(item, property, itemId = item.id) {
  const config = property.type === "status" && property.config?.recurrence;
  if (config?.unit !== "months") return null;
  const due = item.values?.[config.datePropertyId];
  const latest = Array.isArray(item.recurrenceReceipts) && item.recurrenceReceipts.findLast(entry => entry?.itemId === itemId && entry.propertyId === property.id);
  if (latest && latest.unit !== "months") return null;
  const anchor = latest || (Array.isArray(item.recurrenceAnchors) && item.recurrenceAnchors.find(entry => entry?.propertyId === property.id));
  if (!anchor || anchor.datePropertyId !== config.datePropertyId
    || !Number.isInteger(anchor.anchorDay) || anchor.anchorDay < 1 || anchor.anchorDay > 31
    || !due || stableJson(anchor.nextDue) !== stableJson(due)) return null;
  return { propertyId: property.id, datePropertyId: config.datePropertyId, nextDue: due, anchorDay: anchor.anchorDay };
}

// The copy has its own command history. A clamped month still needs the
// original calendar day. Existing 1.5.0 workspaces keep that day in a receipt.
export function detachWorkflowHistory(copy, source, originalId = copy.id) {
  if (copy.recurrenceReceipts || copy.recurrenceAnchors) {
    const anchors = (source?.properties || []).map(property => monthlyAnchor(copy, property, originalId)).filter(Boolean);
    if (anchors.length) copy.recurrenceAnchors = anchors;
    else delete copy.recurrenceAnchors;
  }
  delete copy.recurrenceReceipts;
  delete copy.actionReceipt;
  delete copy.actionUpdateReceipts;
}

export function recurrenceConfigIssue(source, property, config) {
  const options = property?.options || [];
  const completed = options.find(option => option.id === config?.completeOptionId);
  const reset = options.find(option => option.id === config?.resetOptionId);
  if (!completed || statusOptionGroup(completed) !== "complete") return "请选择完成分组中的状态。";
  if (!reset || statusOptionGroup(reset) === "complete") return "请选择待办或进行中分组的重置状态。";
  if (!source.properties.some(entry => entry.id === config.datePropertyId && entry.type === "date")) return "请选择本数据库中的日期属性。";
  if (!source.properties.some(entry => entry.id === config.intervalPropertyId && entry.type === "number")) return "请选择本数据库中的数字属性作为重复间隔。";
  if (!Object.hasOwn(RECURRENCE_UNITS, config.unit)) return "请选择重复间隔的单位。";
  return null;
}

// A command carries what the user saw. React retries and delayed board/batch
// commands must still refer to that occurrence after the row has been reset.
export function captureRecurrenceOccurrence(source, item, property) {
  const config = property?.type === "status" && property.config?.recurrence;
  if (!item || !config) return null;
  const receipts = Array.isArray(item.recurrenceReceipts) ? item.recurrenceReceipts : [];
  return copyJson({
    itemId: item.id, propertyId: property.id, sourceId: source.id,
    config, status: resolveStatusValue(item, property), due: item.values?.[config.datePropertyId] ?? null,
    interval: item.values?.[config.intervalPropertyId] ?? null,
    lastOperationId: receipts.findLast(entry => entry?.itemId === item.id && entry.propertyId === property.id)?.operationId ?? null,
  });
}

function calendarDay(endpoint) {
  const match = typeof endpoint === "string" && isoEndpoint.exec(endpoint);
  if (!match) return null;
  const day = new Date(match[1] + "T00:00:00Z");
  return Number.isFinite(day.getTime()) && day.toISOString().slice(0, 10) === match[1] ? day : null;
}

function shiftEndpoint(endpoint, delta) {
  const day = calendarDay(endpoint);
  if (!day) return null;
  day.setUTCDate(day.getUTCDate() + delta);
  return Number.isFinite(day.getTime()) && day.getUTCFullYear() >= 0 && day.getUTCFullYear() <= 9999
    ? day.toISOString().slice(0, 10) + endpoint.slice(10) : null;
}

function nextDate(value, interval, unit, anchorDay) {
  const date = typeof value === "string" ? { start: value } : value;
  const start = calendarDay(date?.start);
  if (!start) return null;
  let days = unit === "weeks" ? interval * 7 : interval;
  if (unit === "months") {
    // Keep the intended day across shorter months, e.g. Jan 31 → Feb 28 → Mar 31.
    const last = new Date(start);
    last.setUTCMonth(last.getUTCMonth() + interval + 1, 0);
    last.setUTCDate(Math.min(anchorDay, last.getUTCDate()));
    days = (last.getTime() - start.getTime()) / DAY_MS;
  }
  const nextStart = shiftEndpoint(date.start, days);
  const nextEnd = date.end ? shiftEndpoint(date.end, days) : date.end;
  if (!nextStart || (date.end && !nextEnd)) return null;
  const validRange = (first, last) => {
    const instant = endpoint => dateMillis({ ...date, start: endpoint, includeTime: endpoint.length > 10 });
    const from = instant(first), to = last ? instant(last) : from;
    return Number.isFinite(from) && Number.isFinite(to) && from <= to;
  };
  if (!validRange(date.start, date.end) || !validRange(nextStart, nextEnd)) return null;
  if (typeof value === "string") return nextStart;
  return date.end ? { ...date, start: nextStart, end: nextEnd } : { ...date, start: nextStart };
}

export function applyTaskRecurrence(workspace, { itemId, propertyId, value, expectedOccurrence, operationId, now = Date.now() }) {
  const ordinary = { workspace, handled: false };
  const blocked = reason => ({ workspace, handled: true, reason });
  const item = workspace.databaseItems.find(entry => entry.id === itemId);
  const source = item && workspace.dataSources.find(entry => entry.id === item.sourceId);
  const property = source?.properties.find(entry => entry.id === propertyId);
  const config = property?.type === "status" && property.config?.recurrence;
  const receipts = Array.isArray(item?.recurrenceReceipts) ? item.recurrenceReceipts : [];
  if (operationId && receipts.some(entry => entry?.itemId === itemId && entry.propertyId === propertyId && entry.operationId === operationId))
    return { workspace, handled: true, duplicate: true };
  const option = property?.options?.find(entry => entry.id === value);
  const completesGroup = option && statusOptionGroup(option) === "complete";
  const configuredOption = config && property.options?.find(entry => entry.id === config.completeOptionId);
  const invalidTrigger = config && completesGroup && (!configuredOption || statusOptionGroup(configuredOption) !== "complete");
  const completing = config && (value === config.completeOptionId || invalidTrigger);
  if (!completing && (!expectedOccurrence || value !== expectedOccurrence.config?.completeOptionId)) return ordinary;
  const current = captureRecurrenceOccurrence(source, item, property);
  if (expectedOccurrence !== undefined && stableJson(current) !== stableJson(expectedOccurrence)) return blocked("这期任务或重复规则已更改，请重新查看后完成。");
  if (!completing) return ordinary;
  const unavailable = page => !page || page.trashedAt || page.settings?.locked;
  if (source.locked || source.trashedAt || item.locked || item.trashedAt || unavailable(workspace.pages.find(page => page.id === item.pageId))
    || source.ownerPageId && unavailable(workspace.pages.find(page => page.id === source.ownerPageId))) return blocked("任务或所在数据库已锁定或移至回收站。");
  if (current.status === value) return { workspace, handled: true, duplicate: true };
  if ((current.interval == null || current.interval === "") && source.properties.some(entry => entry.id === config.intervalPropertyId && entry.type === "number")) return ordinary;
  const issue = recurrenceConfigIssue(source, property, config);
  if (issue) return blocked(issue);
  const previousOption = property.options.find(entry => entry.id === current.status);
  if (previousOption && statusOptionGroup(previousOption) === "complete") return ordinary;
  if (!expectedOccurrence || typeof operationId !== "string" || !operationId.trim()) return blocked("缺少本期任务的完成标识，请重新查看后完成。");
  if (item.recurrenceReceipts != null && !Array.isArray(item.recurrenceReceipts)) return blocked("周期任务的完成记录格式无效。");
  const interval = Number(current.interval);
  if (!["string", "number"].includes(typeof current.interval) || !Number.isSafeInteger(interval) || interval < 1) return blocked("重复间隔须为正整数。");
  const previousStart = typeof current.due === "string" ? current.due : current.due?.start;
  const anchorDay = monthlyAnchor(item, property)?.anchorDay ?? calendarDay(previousStart)?.getUTCDate();
  const nextDue = nextDate(current.due, interval, config.unit, anchorDay);
  if (!nextDue) return blocked("请检查截止日期、日期范围和重复间隔，无法计算下一期日期。");
  const completed = new Date(now);
  if (!Number.isFinite(completed.getTime())) return blocked("完成时间无效。");
  const completedAt = completed.toISOString();
  const receipt = {
    itemId, propertyId, operationId, completedAt, datePropertyId: config.datePropertyId, previousDue: current.due, nextDue,
    previousStatus: current.status, completeOptionId: value, resetOptionId: config.resetOptionId, interval, unit: config.unit, anchorDay,
  };
  const updated = {
    ...item, updatedAt: completedAt,
    values: { ...item.values, [propertyId]: config.resetOptionId, [config.datePropertyId]: nextDue },
    recurrenceReceipts: [...receipts, receipt].slice(-RECEIPT_LIMIT),
  };
  if (config.unit === "months" || Array.isArray(item.recurrenceAnchors)) {
    const anchors = (Array.isArray(item.recurrenceAnchors) ? item.recurrenceAnchors : []).filter(entry => entry?.propertyId !== propertyId);
    if (config.unit === "months") anchors.push({ propertyId, datePropertyId: config.datePropertyId, nextDue, anchorDay });
    if (anchors.length) updated.recurrenceAnchors = anchors;
    else delete updated.recurrenceAnchors;
  }
  return { workspace: { ...workspace, databaseItems: workspace.databaseItems.map(entry => entry.id === itemId ? updated : entry) }, handled: true };
}
