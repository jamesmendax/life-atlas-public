import { chartBucket, dataSourceById, itemDisplayTitle, relationDefinition, resolvePropertyValue } from "./database.js";
import { READ_ONLY_PROPERTY_TYPES, formatPropertyValue, isEmptyProperty, normalizeIdValues, normalizePropertyValue, validatePropertyValue } from "./databaseProperties.js";
import { chartDateInterval } from "./chartDates.js";
import { currencyAggregationIssue, reportedCurrency } from "./currencyConversion.js";
import { canAccumulateChart, chartAxisKey, chartOptionEntries, chartStableBucketKey, cumulativeChartPoints } from "./chartCategories.js";

const chartCategoryCollator = new Intl.Collator("zh-CN", { numeric: true });
const compareNumbers = (left, right) => left < right ? -1 : left > right ? 1 : 0;

function compareChartCategories(left, right) {
  if (left.order != null && right.order != null) return compareNumbers(left.order, right.order);
  return Number(left.order == null) - Number(right.order == null)
    || chartCategoryCollator.compare(left.label, right.label);
}

export function aggregateNumbers(values, aggregation = "count", count = values.length, emptySum = 0) {
  if (aggregation === "count") return count;
  const numbers = values.filter((value) => typeof value === "number" && Number.isFinite(value));
  if (!numbers.length) return aggregation === "sum" ? emptySum : null;
  const sum = numbers.reduce((total, value) => total + value, 0);
  if (aggregation === "sum") return sum;
  if (aggregation === "average") return sum / numbers.length;
  if (aggregation === "min") return Math.min(...numbers);
  if (aggregation === "max") return Math.max(...numbers);
  return null;
}

// Pure projections: every returned point retains the IDs of its original rows.
// Grouping, chart changes and dashboard widgets never construct database items.
export function chartProjection(workspace, source, items, config = {}) {
  const x = source.properties.find((property) => property.id === config.xPropertyId);
  const group = source.properties.find((property) => property.id === config.groupPropertyId);
  const value = source.properties.find((property) => property.id === config.valuePropertyId);
  const aggregation = config.aggregation || "count";
  const interval = chartDateInterval(x, config.dateInterval);
  const sort = config.sort || "source";
  const valueSort = sort === "value_asc" || sort === "value_desc";
  const categorySort = sort === "category_asc" || sort === "category_desc" || interval !== "exact";
  const direction = sort === "category_desc" || sort === "value_desc" ? -1 : 1;
  const isNumber = config.kind === "number";
  const hiddenCategories = new Set(!isNumber && Array.isArray(config.hiddenCategories) ? config.hiddenCategories : []);
  const hiddenSeries = new Set(!isNumber && Array.isArray(config.hiddenSeries) ? config.hiddenSeries : []);
  const categories = new Map();
  const seriesEntries = new Map();
  const visibleItems = [];
  for (const item of items) {
    const point = chartBucket(workspace, source, item, x, group, interval);
    if (!seriesEntries.has(point.seriesKey)) seriesEntries.set(point.seriesKey, { key: point.seriesKey, label: point.group });
    if (!categories.has(point.categoryKey)) {
      categories.set(point.categoryKey, { key: point.categoryKey, label: point.label, order: point.order, missing: point.missing,
        count: 0, values: [], buckets: new Map() });
    }
    const category = categories.get(point.categoryKey);
    if (!category.buckets.has(point.seriesKey)) category.buckets.set(point.seriesKey, { ...point, values: [], itemIds: [], contributorIds: [] });
    const bucket = category.buckets.get(point.seriesKey);
    bucket.itemIds.push(item.id);
    const visible = !hiddenCategories.has(point.categoryKey) && !hiddenSeries.has(point.seriesKey);
    if (visible) {
      category.count++;
      visibleItems.push(item);
    }
    if (value) {
      const raw = resolvePropertyValue(workspace, source, item, value);
      bucket.values.push(raw);
      if (Number.isFinite(raw)) bucket.contributorIds.push(item.id);
      if (visible) category.values.push(raw);
    }
  }
  const optionCategories = chartOptionEntries(x);
  const optionSeries = chartOptionEntries(group);
  const catalogue = new Map([...optionCategories.map(entry => [entry.key, entry]), ...categories]);
  const seriesCatalogue = new Map([...optionSeries.map(entry => [entry.key, entry]), ...seriesEntries]);
  if (!isNumber && config.showEmptyCategories === true) {
    for (const entry of optionCategories) if (!categories.has(entry.key)) categories.set(entry.key, { ...entry, count: 0, values: [], buckets: new Map() });
  }
  if (!isNumber && config.showEmptySeries === true) {
    for (const entry of optionSeries) if (!seriesEntries.has(entry.key)) seriesEntries.set(entry.key, entry);
  }
  if (!seriesEntries.size && (!group || config.showEmptyCategories === true)) {
    const key = chartAxisKey(group, null);
    seriesEntries.set(key, { key, label: group ? "未设置" : "" });
  }
  const availableCategories = [...categories.values()].filter(category => !hiddenCategories.has(category.key));
  const ordered = availableCategories.filter(category => category.count > 0 || (!category.buckets.size && config.showEmptyCategories === true));
  const series = [...seriesEntries.values()].filter(entry => !hiddenSeries.has(entry.key));
  const allGroupColors = new Map(optionSeries.map(entry => [entry.key, entry.color]));
  const allCategoryColors = new Map(optionCategories.map(entry => [entry.key, entry.color]));
  const seriesWithColors = series.map((entry, rank) => ({ ...entry, rank, color: allGroupColors.get(entry.key) }));
  const displayedSeries = new Map(seriesWithColors.map(entry => [entry.key, entry]));
  if (valueSort) {
    for (const category of ordered) category.value = aggregateNumbers(category.values, aggregation, category.count, null);
    ordered.sort((left, right) => Number(left.value == null) - Number(right.value == null)
      || direction * compareNumbers(left.value, right.value));
  } else if (categorySort) {
    ordered.sort((left, right) => Number(left.missing) - Number(right.missing)
      || direction * compareChartCategories(left, right));
  }
  const seenKeys = new Map();
  for (const category of ordered) for (const bucket of category.buckets.values()) seenKeys.set(bucket.key, (seenKeys.get(bucket.key) || 0) + 1);
  const pointFor = (category, entry) => {
    const bucket = category.buckets.get(entry.key);
    const stableKey = chartStableBucketKey(category.key, entry.key);
    return {
      key: bucket && seenKeys.get(bucket.key) === 1 ? bucket.key : stableKey, stableKey, categoryKey: category.key,
      label: category.label, group: entry.label, seriesKey: entry.key, categoryColor: allCategoryColors.get(category.key), seriesColor: entry.color,
      itemIds: bucket?.itemIds || [], contributorIds: bucket?.contributorIds || [],
      value: bucket ? aggregateNumbers(bucket.values, aggregation, bucket.itemIds.length, null) : aggregation === "count" &&
        (!category.buckets.size || config.showEmptySeries === true) ? 0 : null,
    };
  };
  const cumulative = config.cumulative === true && canAccumulateChart(config);
  const points = cumulative ? cumulativeChartPoints(ordered, seriesWithColors, pointFor, aggregation === "count") :
    ordered.flatMap(category => {
      const entries = !category.buckets.size || config.showEmptySeries === true ? seriesWithColors :
        [...category.buckets.keys()].map(key => displayedSeries.get(key)).filter(Boolean).sort((a, b) => a.rank - b.rank);
      return entries.map(entry => pointFor(category, entry));
    });
  const visibleCount = ordered.reduce((total, category) => total + category.count, 0);
  const visibleValues = ordered.flatMap(category => category.values);
  const currencyIssue = aggregation === "count" ? null : currencyAggregationIssue(source, value, visibleItems, visibleValues);
  const currency = aggregation === "count" ? null : reportedCurrency(workspace, value, source);
  const total = currencyIssue ? null : aggregateNumbers(visibleValues, aggregation, visibleCount, null);
  return {
    points: currencyIssue ? [] : points,
    currencyIssue: currencyIssue?.error.message,
    currency,
    categories: ordered.map(({ key, label }) => ({ key, label })),
    series: seriesWithColors.map(entry => entry.label),
    categoryOptions: [...catalogue.values()].map(({ key, label }) => ({ key, label, hidden: hiddenCategories.has(key) })),
    seriesOptions: [...seriesCatalogue.values()].map(({ key, label }) => ({ key, label, hidden: hiddenSeries.has(key) })),
    visibleCount,
    cumulative,
    cumulativeMissingCategories: cumulative && ordered.some(category => category.missing),
    dateInterval: interval,
    total,
    valueLabel: aggregation === "count" ? "记录数" : currency ? `${value.name} (${currency})` : value?.name || "请选择数值属性",
    missingValueProperty: aggregation !== "count" && !value,
  };
}

export function formFields(source, form = {}, visiblePropertyIds) {
  const editable = source.properties.filter((property) => !READ_ONLY_PROPERTY_TYPES.includes(property.type));
  const properties = new Map(editable.map((property) => [property.id, property]));
  const ordered = [];
  const seen = new Set();
  for (const field of Array.isArray(form.fields) ? form.fields : []) {
    if (!properties.has(field.propertyId) || seen.has(field.propertyId)) continue;
    seen.add(field.propertyId);
    ordered.push({ ...field, property: properties.get(field.propertyId) });
  }
  for (const property of editable) if (!seen.has(property.id)) ordered.push({ propertyId: property.id, required: property.type === "title", hidden: false, property });
  return ordered.map(field => Array.isArray(visiblePropertyIds) && !visiblePropertyIds.includes(field.propertyId) ? { ...field, hidden: true } : field);
}

export function formForView(source, view, form = view.config?.form || {}) {
  const fields = formFields(source, form, view.visiblePropertyIds).map(({ property, ...field }) => field);
  return { ...form, fields };
}

// Conditions only read earlier visible answers. Reordering or deleting a trigger
// cannot expose a stale answer or create a circular dependency.
export function activeFormFields(source, form, values) {
  const available = new Map();
  return formFields(source, form).filter(field => {
    const rule = field.showWhen;
    if (rule) {
      const trigger = available.get(rule.propertyId);
      if (!trigger) return false;
      const value = values[rule.propertyId];
      const matches = trigger.type === "checkbox" ? Boolean(value) === (rule.value === true || rule.value === "true")
        : Array.isArray(value) ? value.includes(rule.value) : value === rule.value;
      if (!matches) return false;
    }
    if (!field.hidden) available.set(field.propertyId, field.property);
    return true;
  });
}

export function formDefaults(source, form) {
  return Object.fromEntries(formFields(source, form).filter((field) => field.defaultValue !== undefined)
    .map((field) => [field.propertyId, normalizePropertyValue(field.property, field.defaultValue)]));
}

export function changeFormAnswer(source, form, previous, propertyId, value) {
  const answers = { ...previous, [propertyId]: value };
  const defaults = formDefaults(source, form);
  const visible = activeFormFields(source, form, { ...defaults, ...answers }).filter(f => !f.hidden);
  // Dropping a whole inactive branch also resets its nested questions. Entering
  // it again starts with the form author's default, not an abandoned answer.
  return Object.fromEntries(visible.filter(f => answers[f.propertyId] !== undefined || defaults[f.propertyId] !== undefined)
    .map(f => [f.propertyId, Object.hasOwn(answers, f.propertyId) ? answers[f.propertyId] : defaults[f.propertyId]]));
}

export function validateFormValues(source, form, input) {
  const defaults = formDefaults(source, form);
  const answers = { ...defaults, ...input };
  const values = {};
  const errors = {};
  for (const field of activeFormFields(source, form, answers)) {
    const value = field.hidden ? defaults[field.propertyId] : answers[field.propertyId];
    if (field.required && isEmptyProperty(value)) errors[field.propertyId] = `${field.property.name}为必填项${field.hidden ? "，请在表单设置中提供默认值" : ""}`;
    else {
      const error = validatePropertyValue(field.property, value);
      if (error) errors[field.propertyId] = error;
    }
    if (value !== undefined) values[field.propertyId] = normalizePropertyValue(field.property, value);
  }
  return { values, errors, valid: !Object.keys(errors).length };
}

export function mapRelatedPlaceSource(workspace, source, relationProperty) {
  const relation = relationDefinition(workspace, source.id, relationProperty);
  const target = dataSourceById(workspace, relation?.targetSourceId);
  if (!target || target.trashedAt || (target.ownerPageId && workspace.pages?.some(page => page.id === target.ownerPageId && page.trashedAt))) return null;
  return target;
}

function mapHasCoordinates(place) {
  return Number.isFinite(place?.latitude) && Number.isFinite(place?.longitude)
    && Math.abs(place.latitude) <= 90 && Math.abs(place.longitude) <= 180;
}

export function mapProjection(workspace, source, items, config = {}) {
  const placeProperty = source.properties.find((property) => property.id === config.placePropertyId && property.type === "place")
    || source.properties.find((property) => property.type === "place");
  const labelProperty = source.properties.find((property) => property.id === config.labelPropertyId);
  const relationProperty = source.properties.find(property => property.id === config.relationPropertyId && property.type === "relation");
  const relatedSource = relationProperty && config.relatedPlacePropertyId ? mapRelatedPlaceSource(workspace, source, relationProperty) : null;
  const relatedPlaceProperty = relatedSource?.properties.find(property => property.id === config.relatedPlacePropertyId && property.type === "place");
  const relatedItems = new Map();
  if (relatedPlaceProperty) {
    const trashedPages = new Set((workspace.pages || []).filter(page => page.trashedAt).map(page => page.id));
    for (const record of workspace.databaseItems || []) {
      if (record.sourceId !== relatedSource.id || record.trashedAt || trashedPages.has(record.pageId)) continue;
      const place = record.values?.[relatedPlaceProperty.id];
      if (mapHasCoordinates(place)) relatedItems.set(record.id, place);
    }
  }
  const located = [], unlocated = [];
  for (const item of items) {
    const direct = placeProperty ? resolvePropertyValue(workspace, source, item, placeProperty) : null;
    let relatedPlace = null;
    if (!mapHasCoordinates(direct) && relatedItems.size) {
      for (const id of normalizeIdValues(item.values?.[relationProperty.id])) {
        if (relatedItems.has(id)) { relatedPlace = relatedItems.get(id); break; }
      }
    }
    const place = relatedPlace || direct;
    const label = labelProperty ? formatPropertyValue(workspace, labelProperty, resolvePropertyValue(workspace, source, item, labelProperty)) : itemDisplayTitle(workspace, source, item);
    const entry = { item, place, label: label || "未命名地点", placeProperty: relatedPlace ? relatedPlaceProperty : placeProperty };
    if (mapHasCoordinates(place)) located.push(entry);
    else unlocated.push(entry);
  }
  return { placeProperty, relatedPlaceProperty, located, unlocated };
}
