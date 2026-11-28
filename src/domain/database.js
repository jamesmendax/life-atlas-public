import { VIEW_TYPES, normalizeViewConfig } from "./viewRegistry.js";
import { comparablePropertyValue, formatPropertyValue, isEmptyProperty, normalizeDate, normalizeIdValues } from "./databaseProperties.js";
import { resolvePropertyValue, resolveTypedPropertyValue } from "./databasePropertyValues.js";
import { STATUS_GROUPS, statusDefaultOptionId, statusOptionGroup } from "./statusGroups.js";
import { normalizeRollupConfig } from "./rollupConfiguration.js";
import { defaultPageSettings } from "./pageActions.js";
import { cloneBlockDocument, copyJson } from "./blockDocument.js";
import { allocateUniqueIds } from "./propertyChanges.js";
import { detachWorkflowHistory } from "./taskRecurrence.js";
import { applyTableManualOrder } from "./tableRowOrder.js";
import { chartDateBucket, chartDateInterval } from "./chartDates.js";
import { chartAxisKey, chartAxisOrder, chartStableBucketKey } from "./chartCategories.js";
import { filterGroup, isComputedFilterProperty, isComputedListTextOperator, isComputedNumberEquality, isDateComparison, isDateFilterProperty, isEqualityFilter, isNumberComparison, matchesComputedListText, matchesFixedDateFilter, matchesNumberFilter } from "./databaseFilters.js";
import { localDateWindow, matchesLocalDateWindow, relativeDateTarget } from "./databaseDateRange.js";
import { isComputedDateValue } from "./computedPropertyKinds.js";
import { isFormulaError } from "./formula/engine.js";
import { archivedPageIds } from "./archive.js";
export { resolvePropertyValue, resolveDisplayPropertyValue, resolveFormulaPropertyValue } from "./databasePropertyValues.js";
export const DATABASE_VIEW_TYPES = VIEW_TYPES;
export const DATABASE_PROPERTY_TYPES = [
  "title",
  "text",
  "number",
  "converted_amount",
  "select",
  "multi_select",
  "status",
  "date",
  "checkbox",
  "people",
  "url",
  "email",
  "phone",
  "files",
  "place",
  "relation",
  "rollup",
  "button",
  "formula",
  "id",
  "created_time",
  "modified_time",
  "unique_id",
  "created_by",
  "last_edited_by",
];

const nowIso = () => new Date().toISOString();
const clone = (value) => JSON.parse(JSON.stringify(value));
const slug = (value) => String(value || "item").trim().toLowerCase().replace(/[^a-z0-9一-鿿]+/g, "-").replace(/^-|-$/g, "").slice(0, 42) || "item";

export function databaseId(prefix = "db") {
  const random = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  return `${prefix}-${random}`;
}

export function createProperty({ id, name, type = "text", options = [], config = {} } = {}) {
  const normalizedType = DATABASE_PROPERTY_TYPES.includes(type) ? type : "text";
  const propertyConfig = config && typeof config === "object" ? { ...clone(config) } : {};
  return {
    id: id || databaseId("prop"),
    name: name || (normalizedType === "title" ? "名称" : "属性"),
    type: normalizedType,
    options: Array.isArray(options) ? clone(options) : [],
    config: normalizedType === "unique_id" ? { prefix: "", nextNumber: 1, ...propertyConfig }
      : normalizedType === "rollup" ? normalizeRollupConfig(propertyConfig) : propertyConfig,
  };
}

export function defaultDatabaseProperties() {
  return [
    createProperty({ id: "title", name: "名称", type: "title" }),
    createProperty({
      id: "status",
      name: "状态",
      type: "status",
      config: { defaultOptionId: "todo" },
      options: [
        { id: "todo", name: "未开始", color: "gray", group: "todo" },
        { id: "doing", name: "进行中", color: "blue", group: "inProgress" },
        { id: "done", name: "已完成", color: "green", group: "complete" },
      ],
    }),
    createProperty({ id: "date", name: "日期", type: "date" }),
    createProperty({ id: "done", name: "完成", type: "checkbox" }),
  ];
}

export function defaultDatabaseItemValues(source) {
  const values = {};
  for (const property of source?.properties || []) {
    const optionId = statusDefaultOptionId(property);
    if (optionId) values[property.id] = optionId;
  }
  return values;
}

export function createDataSource({
  id,
  title = "新数据库",
  ownerPageId = null,
  properties,
  createdAt,
  updatedAt,
} = {}) {
  const time = updatedAt || createdAt || nowIso();
  const normalized = Array.isArray(properties) && properties.length ? properties.map((property) => createProperty(property)) : defaultDatabaseProperties();
  if (!normalized.some((property) => property.type === "title")) {
    normalized.unshift(createProperty({ id: "title", name: "名称", type: "title" }));
  }
  return {
    id: id || databaseId("source"),
    title,
    ownerPageId,
    properties: normalized,
    createdAt: createdAt || time,
    updatedAt: time,
  };
}

export function createDatabaseView({
  id,
  sourceId,
  name = "表格",
  type = "table",
  filter = null,
  sorts = [],
  groupBy = null,
  grouping = null,
  visiblePropertyIds = null,
  config = {},
  linked = false,
} = {}) {
  if (!sourceId) throw new Error("DatabaseView requires sourceId");
  return {
    id: id || databaseId("view"),
    sourceId,
    name,
    type: DATABASE_VIEW_TYPES.includes(type) ? type : "table",
    filter: filter && typeof filter === "object" ? clone(filter) : null,
    sorts: Array.isArray(sorts) ? clone(sorts) : [],
    groupBy: groupBy || null,
    ...(grouping && typeof grouping === "object"
      ? { grouping: clone(grouping) }
      : groupBy
        ? { grouping: { primaryPropertyId: groupBy, secondaryPropertyId: null, hiddenGroupKeys: [], order: [], showEmpty: true } }
        : {}),
    visiblePropertyIds: Array.isArray(visiblePropertyIds) ? [...visiblePropertyIds] : null,
    config: normalizeViewConfig(type, config),
    linked: Boolean(linked),
  };
}

export function createLinkedView(sourceId, options = {}) {
  return createDatabaseView({ ...options, sourceId, linked: true });
}

// Creating a map is an explicit schema edit. Opening an older map, panning it,
// or viewing a linked read-only source must never add fields in the background.
export function ensureMapPlaceProperty(workspace, view, now = nowIso(), idFactory = databaseId) {
  if (view?.type !== "map") return workspace;
  const source = dataSourceById(workspace, view.sourceId);
  if (!source || source.trashedAt || source.properties.some((property) => property.type === "place")) return workspace;
  const owner = source.ownerPageId && workspace.pages?.find((page) => page.id === source.ownerPageId);
  if (owner?.settings?.locked || owner?.trashedAt) return workspace;

  const properties = source.properties;
  let name = "地点";
  for (let suffix = 1; properties.some((property) => property.name === name); suffix++) name = suffix === 1 ? "地图地点" : `地图地点 ${suffix}`;
  const place = createProperty({ id: idFactory("prop"), name, type: "place" });
  return {
    ...workspace,
    dataSources: workspace.dataSources.map((entry) => entry.id === source.id ? { ...entry, properties: [...properties, place], updatedAt: now } : entry),
    databaseViews: workspace.databaseViews.map((entry) => entry.sourceId === source.id && (entry.type === "table" || entry.id === view.id) && Array.isArray(entry.visiblePropertyIds)
      ? { ...entry, visiblePropertyIds: [...entry.visiblePropertyIds, place.id] } : entry),
  };
}

export function createDatabaseItem({
  id,
  sourceId,
  pageId,
  parentItemId = null,
  values = {},
  createdAt,
  updatedAt,
} = {}) {
  if (!sourceId) throw new Error("DatabaseItem requires sourceId");
  if (!pageId) throw new Error("DatabaseItem requires pageId");
  const time = updatedAt || createdAt || nowIso();
  return {
    id: id || databaseId("item"),
    sourceId,
    pageId,
    parentItemId: parentItemId || null,
    values: values && typeof values === "object" ? clone(values) : {},
    createdAt: createdAt || time,
    updatedAt: time,
  };
}

export function createRelation({ id, sourceId, propertyId, targetSourceId, reciprocalPropertyId = null } = {}) {
  if (!sourceId || !propertyId || !targetSourceId) throw new Error("Relation requires sourceId/propertyId/targetSourceId");
  return {
    id: id || databaseId("relation"),
    sourceId,
    propertyId,
    targetSourceId,
    reciprocalPropertyId,
  };
}

export function relationDefinition(workspace, sourceId, property) {
  if (property?.type !== "relation") return null;
  const relation = workspace?.relations?.find(entry => entry.sourceId === sourceId && entry.propertyId === property.id);
  return relation?.targetSourceId ? relation : { ...relation, targetSourceId: property.config?.targetSourceId };
}

export function dataSourceById(workspace, sourceId) {
  return (workspace?.dataSources || []).find((source) => source.id === sourceId) ?? null;
}

export function databaseViewById(workspace, viewId) {
  return (workspace?.databaseViews || []).find((view) => view.id === viewId) ?? null;
}

export function databaseItemById(workspace, itemId) {
  return (workspace?.databaseItems || []).find((item) => item.id === itemId) ?? null;
}

export function itemsForSource(workspace, sourceId) {
  return (workspace?.databaseItems || []).filter((item) => item.sourceId === sourceId);
}

export function viewsForSource(workspace, sourceId) {
  return (workspace?.databaseViews || []).filter((view) => view.sourceId === sourceId);
}

export function childItems(workspace, itemId) {
  return (workspace?.databaseItems || []).filter((item) => item.parentItemId === itemId);
}

export function databaseItemPage(workspace, item) {
  return (workspace?.pages || []).find((page) => page.id === item?.pageId) ?? null;
}

function comparable(value) {
  if (value == null) return "";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number") return value;
  const date = Date.parse(value);
  return Number.isFinite(date) && /^d{4}-d{2}-d{2}/.test(String(value)) ? date : String(value).toLocaleLowerCase();
}

export function itemDisplayTitle(workspace, source, item) {
  const titleProperty = source?.properties?.find((property) => property.type === "title");
  const value = titleProperty ? resolvePropertyValue(workspace, source, item, titleProperty) : null;
  if (value) return String(value);
  const page = databaseItemPage(workspace, item);
  return String(page?.title || "无标题");
}

export function chartBucket(workspace, source, item, x, group, dateInterval) {
  const seriesRaw = group ? resolvePropertyValue(workspace, source, item, group) : null;
  const series = group ? formatPropertyValue(workspace, group, seriesRaw) || "未设置" : "";
  const raw = x ? resolvePropertyValue(workspace, source, item, x) : null;
  const interval = chartDateInterval(x, dateInterval);
  const categoryKey = chartAxisKey(x, raw, interval, item.id);
  const seriesKey = chartAxisKey(group, seriesRaw);
  const stableKey = chartStableBucketKey(categoryKey, seriesKey);
  const hasOptionIdentity = property => ["select", "status", "multi_select", "checkbox", "people", "relation", "files"].includes(property?.type);
  if (interval !== "exact") {
    const period = chartDateBucket(raw, interval);
    const category = [interval, period?.start ?? null];
    const legacyKey = JSON.stringify([category, series]);
    return { key: hasOptionIdentity(group) ? stableKey : legacyKey, legacyKey, stableKey, categoryKey, seriesKey,
      label: period?.label || "未设置", order: period?.order ?? null, missing: !period, group: series };
  }
  const formatted = x ? formatPropertyValue(workspace, x, raw) : itemDisplayTitle(workspace, source, item);
  const label = formatted || "未设置";
  const legacyKey = JSON.stringify([x ? label : item.id, series]);
  const order = chartAxisOrder(x, raw);
  const stable = hasOptionIdentity(x) || hasOptionIdentity(group) || (x && (!formatted || raw === "未设置")) || (group && (!seriesRaw || seriesRaw === "未设置"));
  return { key: stable ? stableKey : legacyKey, legacyKey, stableKey, categoryKey, seriesKey,
    label: x?.type === "checkbox" && raw === false ? "未勾选" : label,
    order: Number.isFinite(order) ? order : null, missing: !formatted && raw !== false, group: group?.type === "checkbox" && seriesRaw === false ? "未勾选" : series };
}

function matchesFilter(workspace, source, item, filter, dateWindow, evaluationOptions) {
  if (!filter) return true;
  const group = filterGroup(filter);
  if (group) {
    const matches = child => matchesFilter(workspace, source, item, child, dateWindow, evaluationOptions);
    return group.op === "or" ? group.children.some(matches) : group.children.every(matches);
  }
  const property = source?.properties?.find((candidate) => candidate.id === filter.propertyId);
  const computed = isComputedFilterProperty(property);
  const listFilter = isComputedListTextOperator(filter.operator);
  if (listFilter && !computed) return false;
  const value = listFilter ? resolveTypedPropertyValue(workspace, source, item, property, evaluationOptions)
    : resolvePropertyValue(workspace, source, item, property, undefined, evaluationOptions);
  if (isFormulaError(value)) return false;
  const expected = filter.value;
  if (isNumberComparison(filter.operator) || isComputedNumberEquality(property, filter)) return matchesNumberFilter(property, value, filter);
  const date = isDateFilterProperty(property) || (computed && isComputedDateValue(value));
  if (filter.operator === "relative_date") {
    return date && matchesLocalDateWindow(value, dateWindow(expected), relativeDateTarget(expected, filter.dateTarget));
  }
  if (listFilter) return matchesComputedListText(value, filter);
  if ((date && filter.valueType !== "text" && isEqualityFilter(filter.operator)) ||
    (computed && filter.valueType === "date" && isEqualityFilter(filter.operator)) || isDateComparison(filter.operator)) {
    return date && matchesFixedDateFilter(value, filter);
  }
  const equals = Array.isArray(value) ? value.includes(expected) : typeof value === "object" && value !== null
    ? formatPropertyValue(workspace, property, value) === String(expected || "")
    : value === expected;
  const choiceContains = ["multi_select", "people"].includes(property?.type);
  switch (filter.operator) {
    case "status_group_is": {
      const option = property?.type === "status" ? property.options?.find((entry) => entry.id === value) : null;
      return Boolean(option && STATUS_GROUPS.includes(expected) && statusOptionGroup(option) === expected);
    }
    case "equals": return equals;
    case "not_equals": return !equals;
    case "contains": return choiceContains ? equals : formatPropertyValue(workspace, property, value).toLocaleLowerCase().includes(String(expected ?? "").toLocaleLowerCase());
    case "not_contains":
    case "does_not_contain": return choiceContains ? !equals : !formatPropertyValue(workspace, property, value).toLocaleLowerCase().includes(String(expected ?? "").toLocaleLowerCase());
    case "starts_with": return formatPropertyValue(workspace, property, value).toLocaleLowerCase().startsWith(String(expected ?? "").toLocaleLowerCase());
    case "is_empty": return isEmptyProperty(value);
    case "is_not_empty": return !isEmptyProperty(value);
    case "checked": return value === true;
    case "unchecked": return value === false || (property?.type === "checkbox" && value == null);
    case "any_checked": return Array.isArray(value) && value.includes(true);
    case "any_unchecked": return Array.isArray(value) && value.includes(false);
    default: return true;
  }
}

const sortText = new Intl.Collator(undefined, { numeric: true });

function compareSortValues(left, right) {
  if (typeof left === "string" && typeof right === "string") return sortText.compare(left, right);
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function viewSortKey(workspace, source, property, evaluationOptions) {
  if (!property) return () => null;
  if (property.type !== "select" && property.type !== "multi_select") {
    return item => comparablePropertyValue(workspace, property, resolvePropertyValue(workspace, source, item, property, undefined, evaluationOptions));
  }
  const optionRanks = new Map((property.options ?? []).map((option, index) => [option.id, index]));
  return item => {
    const [firstOption] = normalizeIdValues(resolvePropertyValue(workspace, source, item, property));
    return firstOption === undefined ? null : optionRanks.get(firstOption) ?? Infinity;
  };
}

export function projectViewItems(workspace, view, { now = new Date() } = {}) {
  const source = dataSourceById(workspace, view?.sourceId);
  if (!source) return [];
  const archived = archivedPageIds(workspace);
  const evaluationOptions = { now };
  const pages = new Map();
  for (const page of workspace?.pages || []) if (!pages.has(page.id)) pages.set(page.id, page);
  const dateWindows = new Map();
  const dateWindow = period => {
    if (!dateWindows.has(period)) dateWindows.set(period, localDateWindow(period, now));
    return dateWindows.get(period);
  };
  let items = itemsForSource(workspace, source.id)
    .filter((item) => {
      const page = pages.get(item.pageId);
      return (!page || !page.trashedAt) && !archived.has(item.pageId);
    })
    .filter((item) => matchesFilter(workspace, source, item, view?.filter, dateWindow, evaluationOptions));
  const slice = view?.config?.chartSlice;
  if (slice && view.type === "table") {
    const x = source.properties.find(property => property.id === slice.xPropertyId);
    const group = source.properties.find(property => property.id === slice.groupPropertyId);
    if (slice.key != null || Array.isArray(slice.bucketKeys)) {
      if ((slice.xPropertyId && !x) || (slice.groupPropertyId && !group)) return [];
      const keys = Array.isArray(slice.bucketKeys) ? new Set(slice.bucketKeys) : null;
      const value = slice.valuePropertyId && source.properties.find(property => property.id === slice.valuePropertyId);
      if (slice.valuePropertyId && !value) return [];
      items = items.filter(item => {
        if (value && !Number.isFinite(resolvePropertyValue(workspace, source, item, value))) return false;
        const bucket = chartBucket(workspace, source, item, x, group, slice.dateInterval);
        return keys ? keys.has(bucket.stableKey) : [bucket.key, bucket.legacyKey, bucket.stableKey].includes(slice.key);
      });
    }
    if (slice.query) items = searchViewItems(workspace, source, items, slice.query);
  }
  const sorts = Array.isArray(view?.sorts) ? view.sorts : [];
  if (sorts.length) {
    const sortKeys = sorts.map(({ propertyId }) => viewSortKey(workspace, source, source.properties.find(property => property.id === propertyId), evaluationOptions));
    items = items.map((item, originalIndex) => ({ item, originalIndex, keys: sortKeys.map(readKey => readKey(item)) })).sort((leftEntry, rightEntry) => {
      for (let sortIndex = 0; sortIndex < sorts.length; sortIndex++) {
        const sort = sorts[sortIndex];
        const left = leftEntry.keys[sortIndex];
        const right = rightEntry.keys[sortIndex];
        if (left === null || right === null) {
          if (left !== right) return left === null ? 1 : -1;
          continue;
        }
        const order = compareSortValues(left, right);
        if (order !== 0) return sort.direction === "desc" ? -order : order;
      }
      return leftEntry.originalIndex - rightEntry.originalIndex;
    }).map((entry) => entry.item);
  } else if (view?.type === "table") {
    items = applyTableManualOrder(items, view.config?.table?.manualOrder);
  }
  return items;
}

export function searchViewItems(workspace, source, items, query) {
  const needle = String(query ?? "").trim().toLocaleLowerCase();
  if (!needle) return items;
  const searchable = source.properties.filter((property) => ["title", "text", "url", "email", "phone", "select", "status", "multi_select", "number"].includes(property.type));
  return items.filter((item) => searchable.some((property) => formatPropertyValue(workspace, property, resolvePropertyValue(workspace, source, item, property)).toLocaleLowerCase().includes(needle)));
}

export const UNASSIGNED_GROUP_KEY = "未分组";
export const DATE_GROUP_INTERVALS = ["month", "year"];
export const DATE_GROUP_SORTS = ["asc", "desc"];

export function dateGroupInterval(grouping) {
  return grouping?.dateInterval === "year" ? "year" : "month";
}

function dateGroupPeriod(key, grouping) {
  const interval = dateGroupInterval(grouping);
  const start = interval === "year" ? `${key}-01-01` : `${key}-01`;
  const period = chartDateBucket(start, interval);
  return period?.start === start ? period : null;
}

export function groupViewDateValue(view, key) {
  return normalizeDate(dateGroupPeriod(key, view.grouping)?.start);
}

export function groupViewLabel(workspace, view, key) {
  if (key === UNASSIGNED_GROUP_KEY) return key;
  const source = dataSourceById(workspace, view?.sourceId);
  const id = view?.grouping ? view.grouping.primaryPropertyId : view?.groupBy;
  const property = source?.properties?.find(candidate => candidate.id === id);
  return property?.type === "date" ? dateGroupPeriod(key, view.grouping)?.label || key
    : property?.options?.find(option => option.id === key)?.name || formatPropertyValue(workspace, property, key) || key;
}

export function groupOptionsInDisplayOrder(property) {
  const options = property?.options || [];
  return property?.type === "status"
    ? STATUS_GROUPS.flatMap(group => options.filter(option => statusOptionGroup(option) === group))
    : options;
}

function groupItemsByProperty(workspace, source, property, items, grouping) {
  const groups = new Map();
  const dateInterval = property?.type === "date" ? dateGroupInterval(grouping) : null;
  for (const item of items) {
    const value = property ? resolvePropertyValue(workspace, source, item, property) : null;
    const period = dateInterval && chartDateBucket(value, dateInterval);
    const keys = dateInterval ? (period ? [period.start.slice(0, dateInterval === "year" ? 4 : 7)] : [])
      : (Array.isArray(value) ? value : [value]).filter(key => key != null && key !== "").map(String);
    for (const key of keys.length ? new Set(keys) : [UNASSIGNED_GROUP_KEY]) {
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    }
  }
  return groups;
}

export function groupViewItems(workspace, view, scopedItems) {
  const source = dataSourceById(workspace, view?.sourceId);
  const grouping = view?.grouping && typeof view.grouping === "object"
    ? view.grouping
    : { primaryPropertyId: view?.groupBy || null, secondaryPropertyId: null, hiddenGroupKeys: [], order: [], showEmpty: true };
  const property = source?.properties?.find((candidate) => candidate.id === grouping.primaryPropertyId);
  const items = Array.isArray(scopedItems) ? scopedItems : projectViewItems(workspace, view);
  const groups = groupItemsByProperty(workspace, source, property, items, grouping);
  const dateGroups = property?.type === "date";
  const optionKeys = groupOptionsInDisplayOrder(property).map(option => String(option.id));
  const savedOrder = (grouping.order || []).map(String);
  if (property && grouping.showEmpty !== false) {
    const emptyKeys = dateGroups ? savedOrder.filter(key => key === UNASSIGNED_GROUP_KEY || dateGroupPeriod(key, grouping))
      : savedOrder.includes(UNASSIGNED_GROUP_KEY) ? [...optionKeys, UNASSIGNED_GROUP_KEY] : optionKeys;
    for (const key of emptyKeys) if (!groups.has(key)) groups.set(key, []);
  }
  const hidden = new Set((grouping.hiddenGroupKeys || []).map(String));
  const statusOrder = property?.type === "status" ? [...optionKeys, UNASSIGNED_GROUP_KEY] : [];
  const rankedKeys = statusOrder.length ? savedOrder.filter(key => statusOrder.includes(key)) : savedOrder;
  const order = new Map((rankedKeys.length ? rankedKeys : statusOrder).map((key, index) => [key, index]));
  const secondary = source?.properties?.find((candidate) => candidate.id === grouping.secondaryPropertyId);
  const chronological = (a, b) => {
    if (a === b) return 0;
    if (a === UNASSIGNED_GROUP_KEY) return 1;
    if (b === UNASSIGNED_GROUP_KEY) return -1;
    return a.localeCompare(b) * (grouping.dateSort === "asc" ? 1 : -1);
  };
  return [...groups].filter(([key]) => !hidden.has(key)).map(([key, items]) => ({ key, items,
    secondaryGroups: secondary ? Array.from(groupItemsByProperty(workspace, source, secondary, items), ([key, items]) => ({ key, items })) : [],
  }))
    .sort((a, b) => (order.get(a.key) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.key) ?? Number.MAX_SAFE_INTEGER)
      || (dateGroups ? chronological(a.key, b.key) : a.key.localeCompare(b.key)));
}

export function updateDatabaseItemValue(item, propertyId, value, updatedAt = nowIso()) {
  return {
    ...item,
    values: { ...(item.values || {}), [propertyId]: clone(value) },
    updatedAt,
  };
}

export function applyRelationChange(workspace, { itemId, propertyId, nextIds, now = nowIso() }) {
  const item = databaseItemById(workspace, itemId);
  if (!item) return workspace;
  const source = dataSourceById(workspace, item.sourceId);
  const property = source?.properties?.find(entry => entry.id === propertyId);
  const relation = relationDefinition(workspace, item.sourceId, property);
  if (!relation) return workspace;
  const previousIds = normalizeIdValues(item.values?.[propertyId]);
  const requestedIds = normalizeIdValues(nextIds);
  if (requestedIds.length === previousIds.length && requestedIds.every((id, index) => previousIds[index] === id)) return workspace;
  const previous = new Set(previousIds);
  const records = new Map((workspace.databaseItems || []).map(entry => [entry.id, entry]));
  const pages = new Map((workspace.pages || []).map(page => [page.id, page]));
  const isTarget = target => Boolean(relation.targetSourceId && target?.sourceId === relation.targetSourceId);
  const ids = [];
  for (const id of requestedIds) {
    const target = records.get(id);
    // Keep unresolved legacy values until the edit explicitly removes them.
    if (!previous.has(id)) {
      if (!target) continue;
      if (!isTarget(target) || target.trashedAt || pages.get(target.pageId)?.trashedAt) return workspace;
    }
    ids.push(id);
  }
  if (requestedIds.length && !ids.length) return workspace;
  const added = ids.filter(id => !previous.has(id));
  if (property.config?.relationLimit === 1 && ids.length > 1 && added.length) return workspace;
  if (ids.length === previousIds.length && ids.every((id, index) => previousIds[index] === id)) return workspace;

  const changed = new Map([[item.id, updateDatabaseItemValue(item, propertyId, ids, now)]]);
  const reciprocalId = relation.reciprocalPropertyId;
  if (reciprocalId) {
    const targetSource = dataSourceById(workspace, relation.targetSourceId);
    const reciprocal = targetSource?.properties?.find(entry => entry.id === reciprocalId);
    const reverse = relationDefinition(workspace, targetSource?.id, reciprocal);
    const validReciprocal = !reciprocal || (reverse
      && (!reverse.targetSourceId || reverse.targetSourceId === source.id)
      && (!reverse.reciprocalPropertyId || reverse.reciprocalPropertyId === propertyId));
    if (!validReciprocal && added.length) return workspace;
    if (validReciprocal) {
      const nextSet = new Set(ids);
      const removed = previousIds.filter(id => !nextSet.has(id));
      for (const targetId of [...removed, ...added]) {
        const target = changed.get(targetId) || records.get(targetId);
        if (!isTarget(target)) continue;
        // Some existing workspaces have the reciprocal field in row values only.
        if (!reciprocal && !Object.hasOwn(target.values || {}, reciprocalId)) continue;
        const value = normalizeIdValues(target.values?.[reciprocalId]);
        const add = nextSet.has(targetId);
        if (value.includes(itemId) === add) continue;
        if (pages.get(target.pageId)?.settings?.locked || (add && reciprocal?.config?.relationLimit === 1 && value.length)) return workspace;
        const next = add ? [...value, itemId] : value.filter(id => id !== itemId);
        changed.set(targetId, updateDatabaseItemValue(target, reciprocalId, next, now));
      }
    }
  }
  return { ...workspace, databaseItems: (workspace.databaseItems || []).map((entry) => changed.get(entry.id) || entry) };
}

export function updateDatabaseView(view, patch) {
  const next = { ...view, ...clone(patch || {}) };
  if (!DATABASE_VIEW_TYPES.includes(next.type)) next.type = "table";
  next.config = normalizeViewConfig(next.type, next.config);
  next.sourceId = view.sourceId;
  return next;
}

export function makeDatabaseItemPage({
  itemId,
  pageId,
  source,
  folderId,
  title = "无标题",
  sortIndex = 0,
  parentDatabaseItemId = null,
  now,
  idFactory,
} = {}) {
  const time = now || nowIso();
  return {
    id: pageId || `dbpage-${slug(itemId || databaseId("item"))}`,
    folderId,
    title,
    icon: "icon:file-description",
    iconColor: "#7f8ea3",
    cover: null,
    settings: { ...defaultPageSettings },
    trashedAt: null,
    summary: `${source?.title || "数据库"}中的条目`,
    contentRevision: 0,
    summarySourceRevision: 0,
    summaryUpdatedAt: time,
    tags: [],
    sortIndex,
    createdAt: time,
    updatedAt: time,
    parentDatabaseItemId,
    databaseSourceId: source?.id || null,
    content: [{ ...(idFactory ? { id: idFactory("block") } : {}), type: "paragraph", content: "" }],
  };
}

export function duplicateDatabaseItem(workspace, { itemId, now, idFactory }) {
  const item = databaseItemById(workspace, itemId);
  const source = item && dataSourceById(workspace, item.sourceId);
  const page = item && databaseItemPage(workspace, item);
  if (!item || !source || !page || page.trashedAt || page.settings?.locked) return workspace;
  const nextItemId = idFactory("item"), nextPageId = idFactory("page");
  const allocated = allocateUniqueIds(workspace, { sourceId: source.id, values: item.values });
  const relationValues = source.properties.filter((property) => property.type === "relation").map((property) => [property.id, normalizeIdValues(item.values?.[property.id])]);
  const values = allocated.values;
  for (const [propertyId] of relationValues) values[propertyId] = [];
  const siblingIndexes = workspace.pages.filter((candidate) => candidate.folderId === page.folderId && candidate.parentPageId === page.parentPageId && candidate.sortIndex > page.sortIndex).map((candidate) => candidate.sortIndex);
  const nextSortIndex = siblingIndexes.length ? (page.sortIndex + Math.min(...siblingIndexes)) / 2 : (Number(page.sortIndex) || 0) + 10;
  const nextPage = { ...copyJson(page), id: nextPageId, sortIndex: nextSortIndex, createdAt: now, updatedAt: now, summaryUpdatedAt: now, content: cloneBlockDocument(page.content, idFactory) };
  const nextItem = { ...copyJson(item), id: nextItemId, pageId: nextPageId, values, createdAt: now, updatedAt: now };
  detachWorkflowHistory(nextItem, source, item.id);
  let next = { ...allocated.workspace, pages: [...allocated.workspace.pages, nextPage], databaseItems: [...allocated.workspace.databaseItems, nextItem] };
  for (const [propertyId, nextIds] of relationValues) next = applyRelationChange(next, { itemId: nextItemId, propertyId, nextIds, now });
  return next;
}

export function createStarterDatabase({ title = "知识库", ownerPageId = null, folderId = null } = {}) {
  const source = createDataSource({ title, ownerPageId });
  const view = createDatabaseView({ sourceId: source.id, name: "表格", type: "table", visiblePropertyIds: source.properties.map((property) => property.id) });
  const itemSpecs = [
    { title: "第一条记录", status: "todo", done: false },
    { title: "进行中的记录", status: "doing", done: false },
    { title: "已完成记录", status: "done", done: true },
  ];
  const pages = [];
  const items = itemSpecs.map((spec, index) => {
    const itemId = databaseId("item");
    const page = makeDatabaseItemPage({ itemId, source, folderId, title: spec.title, sortIndex: (index + 1) * 10 });
    pages.push(page);
    return createDatabaseItem({
      id: itemId,
      sourceId: source.id,
      pageId: page.id,
      values: { title: spec.title, status: spec.status, done: spec.done, date: "" },
    });
  });
  return { source, view, items, pages };
}
