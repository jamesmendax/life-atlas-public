const dateAggregations = Object.freeze({ earliest_date: "最早日期", latest_date: "最晚日期", date_range: "日期范围" });
const checkboxAggregations = Object.freeze({
  checked: "已勾选数量", unchecked: "未勾选数量",
  percent_checked: "已勾选百分比", percent_unchecked: "未勾选百分比",
});
const countAggregations = Object.freeze({
  count_all: "全部计数", count_values: "值计数", unique: "唯一值计数",
  empty: "空值记录计数", not_empty: "非空记录计数", percent_empty: "空值百分比", percent_not_empty: "非空百分比",
});
const numberAggregations = Object.freeze({ sum: "总和", average: "平均值", median: "中位数", min: "最小值", max: "最大值", range: "范围" });
const priorRollupIds = Object.freeze({ show_original: "show", count: "not_empty", count_unique: "unique" });

export const isDateRollupAggregation = aggregation => Object.hasOwn(dateAggregations, aggregation);
export const isCheckboxRollupAggregation = aggregation => Object.hasOwn(checkboxAggregations, aggregation);
export const isCountRollupAggregation = aggregation => Object.hasOwn(countAggregations, aggregation);
export const isListRollupAggregation = aggregation => !aggregation || aggregation === "show" || aggregation === "show_unique";
export const isPercentRollupAggregation = aggregation =>
  ["percent_empty", "percent_not_empty", "percent_checked", "percent_unchecked", "percent_complete"].includes(aggregation);
export const isNumericRollupAggregation = aggregation => Object.hasOwn(numberAggregations, aggregation) ||
  isCountRollupAggregation(aggregation) || isCheckboxRollupAggregation(aggregation) || aggregation === "percent_complete";

export function rollupAggregationOptions(targetProperty) {
  const options = { show: "显示原值", show_unique: "显示唯一值", ...countAggregations };
  const type = targetProperty?.type;
  const computed = type === "formula" || type === "rollup";
  if (computed || type === "number" || type === "converted_amount") {
    Object.assign(options, numberAggregations);
  }
  if (computed || type === "checkbox") Object.assign(options, checkboxAggregations);
  if (type === "status") options.percent_complete = "完成百分比";
  if (computed || ["date", "created_time", "modified_time"].includes(type)) Object.assign(options, dateAggregations);
  return options;
}

export function rollupRelationTargetId(workspace, source, relation) {
  if (relation?.type !== "relation") return null;
  const metadata = workspace?.relations?.find(entry => entry.sourceId === source?.id && entry.propertyId === relation.id);
  return metadata?.targetSourceId || relation.config?.targetSourceId;
}

export function normalizeRollupConfig(config) {
  const id = config?.aggregation;
  return Object.hasOwn(priorRollupIds, id) ? { ...config, aggregation: priorRollupIds[id] } : config;
}

export function normalizeRollupDefinitions(dataSources) {
  if (!Array.isArray(dataSources)) return;
  for (const source of dataSources) {
    if (!Array.isArray(source?.properties)) continue;
    for (const property of source.properties) {
      if (property?.type === "rollup" && property.config) property.config = normalizeRollupConfig(property.config);
    }
  }
}

export function resolveRollupTarget(workspace, property, source) {
  const owner = source || workspace?.dataSources?.find(candidate => candidate.properties?.includes(property));
  if (!owner) return null;
  const { relationPropertyId, targetPropertyId } = property.config || {};
  const relation = owner.properties.find(candidate => candidate.id === relationPropertyId);
  const targetId = rollupRelationTargetId(workspace, owner, relation);
  const target = workspace?.dataSources?.find(candidate => candidate.id === targetId);
  const field = target?.properties?.find(candidate => candidate.id === targetPropertyId);
  return field ? { source: target, property: field } : null;
}
