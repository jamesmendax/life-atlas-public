import { chartDateBucket } from "./chartDates.js";
import { dateMillis, normalizeDate } from "./databaseProperties.js";

export function chartAxisKey(property, raw, interval = "exact", itemId = null) {
  let identity = raw;
  if (!property) identity = itemId;
  else if (interval !== "exact") identity = chartDateBucket(raw, interval)?.start ?? null;
  else if (property.type === "date") {
    const date = normalizeDate(raw);
    identity = date ? [date.start, date.end || null, Boolean(date.includeTime), date.timeZone || null] : null;
  } else if (Array.isArray(raw)) identity = [...new Set(raw)].sort();
  else if (identity == null || identity === "") identity = null;
  return JSON.stringify([property?.id || null, interval, identity]);
}

export const chartStableBucketKey = (categoryKey, seriesKey) => JSON.stringify([categoryKey, seriesKey]);

export function chartAxisOrder(property, value) {
  if (property?.type === "date") return dateMillis(value);
  if (["select", "status"].includes(property?.type)) {
    const index = property.options?.findIndex(option => option.id === value) ?? -1;
    return index >= 0 ? index : null;
  }
  return Number.isFinite(value) ? value : null;
}

export function chartOptionEntries(property) {
  if (!["select", "status", "multi_select"].includes(property?.type)) return [];
  return (property.options || []).map((option, order) => ({
    key: chartAxisKey(property, property.type === "multi_select" ? [option.id] : option.id), label: option.name,
    color: option.color, order, missing: false,
  }));
}

export function canAccumulateChart(config) {
  return ["bar", "line", "column"].includes(config.kind || "bar") && config.sort === "category_asc" &&
    ["count", "sum"].includes(config.aggregation || "count");
}

export function orderedDonutPoints(points, property, bySeries, sort) {
  if (sort && sort !== "source") return points;
  const ranks = new Map(chartOptionEntries(property).map(({ key, order }) => [key, order]));
  if (!ranks.size) return points;
  const rank = point => ranks.get(bySeries ? point.seriesKey : point.categoryKey) ?? ranks.size;
  return [...points].sort((a, b) => rank(a) - rank(b));
}

export function cumulativeChartPoints(categories, series, pointFor, count) {
  const totals = series.map(() => ({ value: null, ids: [], keys: [] }));
  return categories.flatMap(category => series.flatMap((group, index) => {
    const previous = totals[index];
    const bucket = pointFor(category, group);
    if (category.missing) return bucket.itemIds.length ? [{ ...bucket, breakBefore: true }] : [];
    previous.keys.push(bucket.stableKey);
    if (Number.isFinite(bucket.value)) {
      previous.value = (previous.value ?? 0) + bucket.value;
      for (const id of count ? bucket.itemIds : bucket.contributorIds) previous.ids.push(id);
    }
    if (previous.value == null && !bucket.itemIds.length && !Number.isFinite(bucket.value)) return [];
    const length = previous.ids.length;
    const keyCount = previous.keys.length;
    return [{ ...bucket, value: previous.value, itemCount: length, cumulative: true,
      get itemIds() { return previous.ids.slice(0, length); },
      get sliceBucketKeys() { return previous.keys.slice(0, keyCount); },
    }];
  }));
}
