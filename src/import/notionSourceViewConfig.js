import { VIEW_TYPES } from "../domain/viewRegistry.js";
import { DATE_GROUP_INTERVALS, DATE_GROUP_SORTS, groupViewDateValue } from "../domain/database.js";
import { isComputedFilterProperty, isComputedListTextOperator } from "../domain/databaseFilters.js";
import { RELATIVE_DATE_PERIODS, RELATIVE_DATE_TARGETS } from "../domain/databaseDateRange.js";

const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const fields = ["name", "type", "filter", "sorts", "groupBy", "grouping", "visiblePropertyIds", "config"];
const fail = (reason) => { throw new Error(reason); };
const keyFor = (path, index) => JSON.stringify([path, index]);

export function normalizeNotionConfigurationPath(value) {
  if (typeof value !== "string" || !value) return null;
  let path;
  try { path = decodeURIComponent(value); } catch { return null; }
  if (/^[A-Za-z]:|^\/|[\\\u0000-\u001f\u007f]/.test(path)) return null;
  const parts = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") return null;
    parts.push(part);
  }
  return parts.join("/") || null;
}

// Index the original descriptors, not newly created Pages or same-name sources.
export function prepareNotionSourceViewConfigurations(plan, input, warnings) {
  const entries = new Map();
  const invalid = (entry, entryIndex, reason) => warnings.push({ kind: "view_configuration_invalid", path: entry?.path || "", collectionIndex: entry?.collectionIndex, entryIndex, reason });
  if (input === undefined) return { entries, invalid };
  if (!Array.isArray(input)) { invalid(null, null, "sourceViewConfigurations 必须是数组。 "); return { entries, invalid }; }
  const descriptors = [...plan.pages, ...plan.databases.flatMap((db) => [db.page, ...db.records.map((record) => record.page)].filter(Boolean))];
  const targets = input.map((entry) => object(entry) && Number.isInteger(entry.collectionIndex) && entry.collectionIndex >= 0
    ? keyFor(normalizeNotionConfigurationPath(entry.path), entry.collectionIndex) : null);
  const declarationPaths = input.filter((entry) => object(entry) && entry.pageType === "database").map((entry) => normalizeNotionConfigurationPath(entry.path));
  input.forEach((entry, entryIndex) => {
    try {
      const path = normalizeNotionConfigurationPath(entry?.path);
      if (!object(entry) || !path || !targets[entryIndex]) fail("视图配置的路径或 collectionIndex 无效。 ");
      if (Object.keys(entry).some((key) => !["path", "collectionIndex", "pageType", "sourcePath", "currentViewIndex", "views"].includes(key))) fail("来源配置含有不支持或未映射的字段。 ");
      if (targets.filter((key) => key === targets[entryIndex]).length !== 1) fail("同一导出位置存在重复配置，所有重复项均未应用。 ");
      const matches = descriptors.filter((descriptor) => normalizeNotionConfigurationPath(descriptor.path) === path);
      if (matches.length !== 1 || !matches[0].collections?.[entry.collectionIndex]) fail("无法唯一匹配原始导出页面的 collection 位置。 ");
      if (entry.pageType !== undefined && entry.pageType !== "database") fail("pageType 仅接受明确的 database 声明。 ");
      if (entry.pageType === "database" && declarationPaths.filter((candidate) => candidate === path).length !== 1) fail("同一页面的整页数据库声明不唯一。 ");
      if (!Array.isArray(entry.views) || !entry.views.length || entry.views.some((view) => !object(view))) fail("views 必须是非空的视图配置数组。 ");
      const currentViewIndex = entry.currentViewIndex === undefined ? 0 : entry.currentViewIndex;
      if (!Number.isInteger(currentViewIndex) || currentViewIndex < 0 || currentViewIndex >= entry.views.length) fail("currentViewIndex 超出给定视图列表。 ");
      let sourceDescriptor = null;
      if (entry.sourcePath !== undefined) {
        const sourcePath = normalizeNotionConfigurationPath(entry.sourcePath);
        const sources = sourcePath && plan.databases.filter((db) => [db.path, ...(db.aliases || []), db.page?.path].some((candidate) => candidate && normalizeNotionConfigurationPath(candidate) === sourcePath));
        if (!sources || sources.length !== 1) fail("sourcePath 无法唯一匹配本次导入的数据源。 ");
        sourceDescriptor = sources[0];
      }
      entries.set(targets[entryIndex], { entry, entryIndex, descriptor: matches[0], sourceDescriptor, currentViewIndex });
    } catch (error) { invalid(entry, entryIndex, error.message); }
  });
  return { entries, invalid };
}

export function notionSourceViewConfigurationFor(prepared, descriptor, index) {
  return prepared.entries.get(keyFor(normalizeNotionConfigurationPath(descriptor.path), index));
}

// Input property/option references are exact exported names. Never accept local
// IDs as aliases or search other sources for an otherwise missing name.
export function mapNotionSourceViewConfiguration(input, source) {
  const property = (name) => {
    const matches = source.properties.filter((candidate) => candidate.name === name);
    if (typeof name !== "string" || matches.length !== 1) fail(`无法唯一匹配属性名称：${String(name)}`);
    if (source.properties.filter((candidate) => candidate.id === matches[0].id).length !== 1) fail(`属性的本地 ID 不唯一：${name}`);
    return matches[0];
  };
  const option = (prop, name) => {
    const matches = prop.options.filter((candidate) => candidate.name === name);
    if (typeof name !== "string" || matches.length !== 1) fail(`无法唯一匹配“${prop.name}”的选项名称：${String(name)}`);
    if (prop.options.filter((candidate) => candidate.id === matches[0].id).length !== 1) fail(`“${prop.name}”的选项本地 ID 不唯一：${name}`);
    return matches[0].id;
  };
  const optionValue = (prop, value) => {
    if (value === null || value === undefined) return value;
    if (["relation", "people", "files"].includes(prop.type)) fail(`“${prop.name}”的值缺少记录、人员或附件的明确来源映射。`);
    if (!["select", "status", "multi_select"].includes(prop.type)) return value;
    return Array.isArray(value) ? unique(value.map((name) => option(prop, name))) : option(prop, value);
  };
  const unique = (values) => {
    if (new Set(values).size !== values.length) fail("属性或选项引用列表中存在重复目标。 ");
    return values;
  };
  const propertyList = (value) => {
    if (!Array.isArray(value)) fail("属性引用列表必须是数组。 ");
    return unique(value.map((name) => property(name).id));
  };
  const walk = (value, context = "") => {
    if (Array.isArray(value)) return value.map((entry) => walk(entry, context));
    if (!object(value)) return value;
    const result = {};
    const prop = Object.hasOwn(value, "propertyId") && value.propertyId !== null ? property(value.propertyId) : null;
    for (const [key, entry] of Object.entries(value)) {
      if (/^(?:source|view|page|item|targetSource)Ids?$/.test(key) && entry != null) fail(`不接受未映射的跨实体引用：${key}`);
      if (key === "markerMap" && object(entry) && Object.keys(entry).length) fail("markerMap 的记录引用没有明确的来源映射。 ");
      if (key === "propertyId" || /PropertyId$/.test(key) || key === "groupBy") result[key] = entry === null ? null : property(entry).id;
      else if (/PropertyIds$/.test(key)) result[key] = entry === null ? null : propertyList(entry);
      else if (["columnWidths", "calculations"].includes(key) && context === "table") {
        if (!object(entry)) fail(`${key} 必须是属性名称映射。`);
        result[key] = Object.fromEntries(Object.entries(entry).map(([name, setting]) => [property(name).id, walk(setting)]));
      } else if (prop && (key === "defaultValue" || key === "value" && (["equals", "not_equals"].includes(value.operator) ||
        prop.type === "multi_select" && ["contains", "not_contains", "does_not_contain"].includes(value.operator)))) result[key] = optionValue(prop, entry);
      else result[key] = walk(entry, key);
    }
    return result;
  };
  try {
    if (!object(input) || Object.keys(input).some((key) => !fields.includes(key))) fail("视图配置含有不支持的字段。 ");
    if (input.name !== undefined && (typeof input.name !== "string" || !input.name.trim())) fail("视图名称必须是非空字符串。 ");
    if (input.type !== undefined && !VIEW_TYPES.includes(input.type)) fail("视图布局无效。 ");
    if (input.filter !== undefined && input.filter !== null && !object(input.filter)) fail("filter 必须是对象或 null。 ");
    const validateFilter = (filter) => {
      if (filter === null) return;
      if (!object(filter)) fail("筛选节点必须是对象。 ");
      if (filter.kind !== undefined && !["group", "condition"].includes(filter.kind)) fail("筛选节点类型无效。 ");
      if (filter.kind === "group") {
        if (!["and", "or"].includes(filter.op) || !Array.isArray(filter.children)) fail("筛选组必须有 and/or 与 children。 ");
        filter.children.forEach(validateFilter);
      } else if (Array.isArray(filter.and) || Array.isArray(filter.or)) {
        if (Object.hasOwn(filter, "and") && Object.hasOwn(filter, "or")) fail("筛选节点的 and/or 不唯一。 ");
        (filter.and || filter.or).forEach(validateFilter);
      } else {
        const prop = property(filter.propertyId);
        const listText = isComputedListTextOperator(filter.operator);
        if (listText && (!isComputedFilterProperty(prop) || typeof filter.value !== "string")) fail("逐项文本筛选要求公式或汇总属性及文本值。");
        if (!listText && !["equals", "not_equals", "contains", "not_contains", "does_not_contain", "starts_with", "is_empty", "is_not_empty", "before", "after", "on_or_before", "on_or_after", "greater_than", "greater_than_or_equal", "less_than", "less_than_or_equal", "checked", "unchecked", "any_checked", "any_unchecked", "relative_date", "status_group_is"].includes(filter.operator)) fail("筛选操作符无效。 ");
        if (filter.operator === "relative_date" && !Object.hasOwn(RELATIVE_DATE_PERIODS, filter.value)) fail("相对日期范围无效。");
        if (filter.dateTarget !== undefined && (filter.operator !== "relative_date" || !Object.hasOwn(RELATIVE_DATE_TARGETS, filter.dateTarget))) fail("相对日期比对位置无效。");
      }
    };
    if (input.filter !== undefined) validateFilter(input.filter);
    if (input.sorts !== undefined && (!Array.isArray(input.sorts) || input.sorts.some((sort) => !object(sort) || !Object.hasOwn(sort, "propertyId") || !["asc", "desc"].includes(sort.direction)))) fail("sorts 必须包含属性名称和 asc/desc 方向。 ");
    if (input.grouping !== undefined && input.grouping !== null && !object(input.grouping)) fail("grouping 必须是对象或 null。 ");
    if (input.grouping?.showEmpty !== undefined && typeof input.grouping.showEmpty !== "boolean") fail("grouping.showEmpty 必须是布尔值。 ");
    if (input.config !== undefined && !object(input.config)) fail("config 必须是对象。 ");
    // The local normalizer turns every other explicit opening mode into peek.
    // Reject unsupported source semantics before that fallback can hide them.
    if (input.config?.openRecordsIn !== undefined && !["peek", "page", "side"].includes(input.config.openRecordsIn)) fail("config.openRecordsIn 仅支持 peek/page/side；未应用不支持的记录打开方式。 ");
    if (input.config?.showDataSourceTitle !== undefined && typeof input.config.showDataSourceTitle !== "boolean") fail("config.showDataSourceTitle 必须是布尔值。 ");
    if (input.config?.showPageIcon !== undefined && typeof input.config.showPageIcon !== "boolean") fail("config.showPageIcon 必须是布尔值。 ");
    if (input.config?.board !== undefined && !object(input.config.board)) fail("config.board 必须是对象。 ");
    if (input.type === "board" && input.config?.board !== undefined) {
      const board = input.config.board;
      if (board.colorColumns !== undefined && typeof board.colorColumns !== "boolean") fail("config.board.colorColumns 必须是布尔值。 ");
      if (board.wrapAllContent !== undefined && typeof board.wrapAllContent !== "boolean") fail("config.board.wrapAllContent 必须是布尔值。 ");
    }
    if (input.type === "gallery") {
      const gallery = input.config?.gallery;
      if (gallery?.preview?.kind !== undefined && !["page-cover", "page-content", "files-property", "none"].includes(gallery.preview.kind)) fail("config.gallery.preview.kind 仅支持 page-cover/page-content/files-property/none；未应用不支持的预览方式。 ");
      if (gallery?.cardSize !== undefined && !["small", "medium", "large"].includes(gallery.cardSize)) fail("config.gallery.cardSize 仅支持 small/medium/large；未应用不支持的卡片大小。 ");
      if (gallery?.imageFit !== undefined && !["cover", "contain"].includes(gallery.imageFit)) fail("config.gallery.imageFit 仅支持 cover/contain；未应用不支持的图片适配方式。 ");
    }
    const mapped = walk(input);
    if (mapped.sorts) unique(mapped.sorts.map((sort) => sort.propertyId));
    if (input.grouping) {
      const primaryName = input.grouping.primaryPropertyId ?? input.groupBy;
      const primary = primaryName == null ? null : property(primaryName);
      if (input.groupBy !== undefined && input.groupBy !== null && input.grouping.primaryPropertyId !== undefined && input.grouping.primaryPropertyId !== input.groupBy) fail("groupBy 与 grouping 的主属性不一致。 ");
      const { dateInterval, dateSort } = input.grouping;
      if (dateInterval !== undefined && (primary?.type !== "date" || !DATE_GROUP_INTERVALS.includes(dateInterval))) fail("grouping.dateInterval 仅支持日期主分组的 month/year。 ");
      if (dateSort !== undefined && (primary?.type !== "date" || !DATE_GROUP_SORTS.includes(dateSort))) fail("grouping.dateSort 仅支持日期主分组的 asc/desc。 ");
      for (const key of ["order", "hiddenGroupKeys"]) if (Object.hasOwn(input.grouping, key)) {
        if (!Array.isArray(input.grouping[key])) fail(`grouping.${key} 必须是数组。`);
        mapped.grouping[key] = unique(input.grouping[key].map((name) => {
          if (name === "未分组") {
            if (primary?.options.some((candidate) => candidate.name === name)) fail("未分组选项与空分组标记歧义。 ");
            return name;
          }
          if (!primary) fail("分组键缺少明确主属性。 ");
          if (primary.type === "date" && !groupViewDateValue(input, name)) fail("日期分组键须与分组周期匹配，并使用 YYYY-MM 或 YYYY。 ");
          return ["select", "status", "multi_select"].includes(primary.type) ? option(primary, name) : name;
        }));
      }
    }
    const missingFields = fields.filter((key) => !Object.hasOwn(input, key));
    if (input.grouping) for (const key of ["primaryPropertyId", "secondaryPropertyId", "order", "hiddenGroupKeys", "showEmpty"]) {
      if (!Object.hasOwn(input.grouping, key)) missingFields.push(`grouping.${key}`);
    }
    const defaults = {
      table: ["table.columnWidths", "table.wrapPropertyIds", "table.calculations"],
      gallery: ["gallery.preview.kind", "gallery.preview.propertyId", "gallery.cardSize", "gallery.imageFit", "gallery.visiblePropertyIds"],
      calendar: ["calendar.datePropertyId", "calendar.mode", "calendar.showWeekends", "calendar.startOfWeek", "calendar.anchorDate"],
      timeline: ["timeline.datePropertyId", "timeline.scale", "timeline.windowStart", "timeline.windowEnd", "timeline.showToday"],
      map: ["map.placePropertyId", "map.labelPropertyId", "map.zoom", "map.center"],
      chart: ["chart.kind", "chart.xPropertyId", "chart.valuePropertyId", "chart.groupPropertyId", "chart.aggregation"],
      form: ["form.title", "form.description", "form.fields", "form.open", "form.anonymous", "form.successMessage"],
      dashboard: ["dashboard.widgets", "dashboard.globalFilters"],
    };
    if (input.config && input.config.openRecordsIn === undefined) missingFields.push("config.openRecordsIn");
    if (input.config) for (const path of defaults[input.type] || []) {
      let value = input.config;
      for (const key of path.split(".")) value = object(value) && Object.hasOwn(value, key) ? value[key] : undefined;
      if (value === undefined) missingFields.push(`config.${path}`);
    }
    return { valid: true, view: mapped, missingFields };
  } catch (error) { return { valid: false, reason: error.message }; }
}
