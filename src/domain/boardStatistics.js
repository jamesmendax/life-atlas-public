import { resolvePropertyValue } from "./database.js";
import { availableCalculations, CALCULATIONS, computeColumnStat } from "./databaseStats.js";

export const BOARD_NUMBER_CALCULATIONS = ["sum", "average", "min", "max"];

export function boardStatisticProperties(source) {
  return source.properties.filter(property => availableCalculations(property).includes("sum"));
}

export function resolveBoardStatistic(source, config) {
  const property = source.properties.find(candidate => candidate.id === config?.propertyId);
  if (!property || !BOARD_NUMBER_CALCULATIONS.includes(config?.calculation) || !availableCalculations(property).includes(config.calculation)) {
    return { property: null, calculation: "count_all", label: "项目数" };
  }
  return { property, calculation: config.calculation, label: `${property.name} · ${CALCULATIONS[config.calculation]}` };
}

export function computeBoardStatistic(workspace, source, items, { property, calculation }, pendingCount = 0) {
  if (!property) {
    const value = items.length + pendingCount;
    return { value, text: String(value) };
  }
  // Table totals return zero for an empty column. In board headers an empty
  // group or property is distinct from a real zero or a sum that cancels out.
  const result = computeColumnStat(workspace, source, items, property, calculation);
  if (result.error) return result;
  if (calculation === "sum" && !items.some(item => Number.isFinite(resolvePropertyValue(workspace, source, item, property)))) {
    return { value: null, text: "—" };
  }
  return Number.isFinite(result.value) ? result : { value: null, text: "—" };
}
