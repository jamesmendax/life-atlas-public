import { itemDisplayTitle, resolvePropertyValue } from "./database.js";
import { dateMillis, formatPropertyValue, normalizeDate } from "./databaseProperties.js";
import { ROADMAP_DEFAULTS, ROADMAP_MARKERS } from "./roadmapLayout.js";

const COLORS = new Set(["gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"]);

export function shiftRoadmapDate(value, deltaDays) {
  const date = normalizeDate(value);
  if (!date?.start || !Number.isFinite(deltaDays) || !Number.isInteger(deltaDays)) return null;
  const shift = (raw) => {
    if (!raw) return null;
    const time = /^\d{4}-\d{2}-\d{2}/.test(raw) ? Date.parse(`${raw.slice(0, 10)}T00:00:00Z`) : NaN;
    return Number.isFinite(time) ? `${new Date(time + deltaDays * 86400000).toISOString().slice(0, 10)}${raw.slice(10)}` : raw;
  };
  return { ...date, start: shift(date.start), end: shift(date.end) };
}

function dateInstant(date, value) {
  if (!value) return null;
  const time = dateMillis({ ...date, start: value, includeTime: value.length > 10 || date.includeTime });
  return Number.isFinite(time) ? time : null;
}

export function roadmapEntries(workspace, source, items, config = {}) {
  const settings = { ...ROADMAP_DEFAULTS, ...(config?.roadmap || config || {}) };
  const properties = new Map((source?.properties || []).map((property) => [property.id, property]));
  const pages = new Map((workspace?.pages || []).map((page) => [page.id, page]));
  const dateProperty = properties.get(settings.datePropertyId);
  const colorProperty = properties.get(settings.colorPropertyId);
  const markerProperty = properties.get(settings.markerPropertyId);
  const subtitleProperty = properties.get(settings.subtitlePropertyId);
  const progressProperty = properties.get(settings.progressPropertyId);
  return (items || []).filter((item) => !pages.get(item.pageId)?.trashedAt).map((item) => {
    const value = dateProperty?.type === "date" ? normalizeDate(resolvePropertyValue(workspace, source, item, dateProperty)) : null;
    let start = value ? dateInstant(value, value.start) : null;
    let end = value ? dateInstant(value, value.end) : null;
    if (start !== null && end !== null && end < start) [start, end] = [end, start];
    const colorOption = ["select", "status"].includes(colorProperty?.type) ? colorProperty.options?.find((option) => option.id === resolvePropertyValue(workspace, source, item, colorProperty)) : null;
    const markerValue = markerProperty?.type === "select" ? resolvePropertyValue(workspace, source, item, markerProperty) : null;
    const marker = settings.markerMap?.[markerValue];
    const progressValue = ["number", "rollup", "formula"].includes(progressProperty?.type) ? resolvePropertyValue(workspace, source, item, progressProperty) : null;
    const progress = typeof progressValue === "number" && Number.isFinite(progressValue) ? Math.max(0, Math.min(1, progressValue > 1 ? progressValue / 100 : progressValue)) : null;
    return {
      id: item.id,
      pageId: item.pageId,
      title: itemDisplayTitle(workspace, source, item),
      start,
      end,
      color: COLORS.has(colorOption?.color) ? colorOption.color : "default",
      marker: ROADMAP_MARKERS.includes(marker) ? marker : "diamond",
      subtitle: subtitleProperty ? formatPropertyValue(workspace, subtitleProperty, resolvePropertyValue(workspace, source, item, subtitleProperty)) : "",
      progress,
      statusLabel: colorOption?.name || "",
    };
  });
}
