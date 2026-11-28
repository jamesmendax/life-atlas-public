import { computedPropertyKinds, isComputedDateValue } from "./computedPropertyKinds.js";
import { resolvePropertyValue } from "./databasePropertyValues.js";
import { dateMillis, normalizeDate } from "./databaseProperties.js";

const computed = property => ["formula", "rollup"].includes(property.type);
const timestamp = property => ["created_time", "modified_time"].includes(property.type);
export const canWriteSurfaceDate = property => property?.type === "date";
const usable = property => canWriteSurfaceDate(property) || timestamp(property) || computed(property);

export function surfaceDateProperty(source, propertyId) {
  if (!propertyId) return source.properties.find(canWriteSurfaceDate);
  return source.properties.find(property => property.id === propertyId && usable(property));
}

export function surfaceDateChoices(workspace, source, selected = []) {
  return source.properties.filter(property => {
    if (canWriteSurfaceDate(property) || timestamp(property)) return true;
    if (!computed(property)) return false;
    if (selected.includes(property.id)) return true;
    if (!workspace) return false;
    const kinds = computedPropertyKinds(workspace, source, property);
    return kinds.has("date") || (property.type === "formula" && !kinds.size);
  });
}

export function resolveSurfaceDate(workspace, source, item, property, now) {
  if (!property) return null;
  const value = resolvePropertyValue(workspace, source, item, property, undefined, { now });
  if (computed(property)) return isComputedDateValue(value) ? normalizeDate(value) : null;
  const input = timestamp(property) && typeof value === "string"
    ? { start: value, includeTime: value.includes("T") } : value;
  const date = normalizeDate(input);
  return date && Number.isFinite(dateMillis(date)) ? date : null;
}
