import { chartBarScale } from "./chartLayout.js";
import { dateMillis } from "./databaseProperties.js";

function categoryIdentity(point) {
  if (point.categoryKey != null) return point.categoryKey;
  // Current projections encode the category identity and series in the drilldown key.
  if (typeof point.key === "string" && point.key.startsWith("[")) {
    try {
      const key = JSON.parse(point.key);
      if (Array.isArray(key)) return key[0] ?? point.label;
    } catch { /* A legacy key may be plain text. */ }
  }
  return point.label;
}

function dateCategoryOrder(label) {
  const start = /^(\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}[^ ()]*)?)/.exec(label)?.[1];
  if (!start) return Infinity;
  const timeZone = /\(([^()]+)\)$/.exec(label)?.[1];
  const millis = dateMillis({ start: start.replace(" ", "T"), includeTime: start.length > 10, timeZone });
  return Number.isFinite(millis) ? millis : Infinity;
}

function compareOptionOrder(property) {
  const ranks = new Map((property?.options || []).map((option, index) => [option.name, index]));
  return (a, b) => (ranks.get(a) ?? ranks.size) - (ranks.get(b) ?? ranks.size);
}

export function cartesianChartLayout(points, { kind, count = false, stacked = false, categories: projectedCategories, categoryProperty, groupProperty } = {}) {
  const categories = new Map();
  const groups = new Map();
  const groupKey = point => point.seriesKey ?? (point.group || "");
  for (const point of points) {
    const id = categoryIdentity(point);
    if (!categories.has(id)) categories.set(id, { id, label: point.label, points: [] });
    categories.get(id).points.push(point);
    if (!groups.has(groupKey(point))) groups.set(groupKey(point), { key: groupKey(point), label: point.group || "", color: point.seriesColor });
  }

  const ordered = [...categories.values()];
  const isDate = ["date", "created_time", "modified_time"].includes(categoryProperty?.type) ||
    (categoryProperty?.type === "rollup" && categoryProperty.config?.aggregation === "date_range");
  if (projectedCategories?.length) {
    const ranks = new Map(projectedCategories.map(({ key }, index) => [key, index]));
    ordered.sort((a, b) => (ranks.get(a.id) ?? ranks.size) - (ranks.get(b.id) ?? ranks.size));
  } else if (isDate) {
    const times = new Map(ordered.map(({ id, label }) => [id, dateCategoryOrder(label)]));
    ordered.sort((a, b) => times.get(a.id) - times.get(b.id));
  } else if (categoryProperty?.options?.length) {
    const byOption = compareOptionOrder(categoryProperty);
    ordered.sort((a, b) => byOption(a.label, b.label));
  }

  const optionOrder = compareOptionOrder(groupProperty);
  const series = [...groups.values()].sort((a, b) => optionOrder(a.label, b.label)).map((entry, index) => ({ ...entry, index, runs: [] }));
  const byGroup = new Map(series.map(line => [line.key, line]));
  const combine = kind === "column" && stacked && series.length > 1;
  const values = [];
  let overflow = false;

  const slots = ordered.map((category, index) => {
    let positive = 0;
    let negative = 0;
    const marks = [];
    const orderedPoints = [...category.points].sort((a, b) => byGroup.get(groupKey(a)).index - byGroup.get(groupKey(b)).index);
    for (const point of orderedPoints) {
      if (!Number.isFinite(point.value)) continue;
      const line = byGroup.get(groupKey(point));
      const start = combine ? (point.value < 0 ? negative : positive) : 0;
      const end = start + point.value;
      if (!Number.isFinite(end)) { overflow = true; continue; }
      if (combine && point.value < 0) negative = end;
      else if (combine) positive = end;
      const mark = { point, index, seriesIndex: line.index, start, end };
      marks.push(mark);
      values.push(end);

      if (kind === "line") {
        const lastRun = line.runs.at(-1);
        if (!point.breakBefore && lastRun?.at(-1).index === index - 1) lastRun.push(mark);
        else line.runs.push([mark]);
      }
    }
    return { id: category.id, label: category.label, marks };
  });

  return { slots, series, combine, isDate, overflow, hasValues: values.length > 0, scale: chartBarScale(values, { count }) };
}

export function chartLinePath(coordinates, smooth) {
  return coordinates.map(([x, y], index) => {
    if (!index) return `M${x},${y}`;
    if (!smooth) return `L${x},${y}`;
    const [previousX, previousY] = coordinates[index - 1];
    const middle = (previousX + x) / 2;
    return `C${middle},${previousY} ${middle},${y} ${x},${y}`;
  }).join(" ");
}

export function chartAreaPath(coordinates, smooth, baseline) {
  return `${chartLinePath(coordinates, smooth)} L${coordinates.at(-1)[0]},${baseline} L${coordinates[0][0]},${baseline} Z`;
}
