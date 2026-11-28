import { resolvePropertyValue } from "./database.js";
import { dateMillis, formatDateLabel, formatPropertyValue, isEmptyProperty, normalizeDate } from "./databaseProperties.js";
import { formatNumber } from "./numberFormat.js";
import { currencyAggregationIssue, formatCurrencyAmount, isMoneyAggregation, reportedCurrency } from "./currencyConversion.js";
export { CALCULATIONS } from "./viewRegistry.js";

export function availableCalculations(property) {
  if (property?.type === "checkbox") return ["none", "count_all", "checked", "unchecked", "percent_checked", "percent_unchecked"];
  const result = ["none", "count_all", "count_values", "count_unique", "count_empty", "count_not_empty", "percent_empty", "percent_not_empty"];
  if (["number", "converted_amount", "formula", "rollup"].includes(property?.type)) result.push("sum", "average", "median", "min", "max", "range");
  if (["date", "created_time", "modified_time"].includes(property?.type)) result.push("earliest", "latest", "date_range");
  return result;
}

export function computeColumnStat(workspace, source, items, property, calculation) {
  if (calculation === "none" || !availableCalculations(property).includes(calculation)) return { value: null, text: "" };
  const values = items.map((item) => resolvePropertyValue(workspace, source, item, property));
  if (isMoneyAggregation(calculation)) {
    const issue = currencyAggregationIssue(source, property, items, values);
    if (issue) return { value: null, text: issue.error.message, error: issue.error };
  }
  const present = values.filter((value) => !isEmptyProperty(value) && !value?.error);
  const emptyCount = values.filter(isEmptyProperty).length;
  const numbers = present.filter((value) => typeof value === "number" && Number.isFinite(value)).sort((left, right) => left - right);
  const percent = (value) => ({ value, text: formatNumber(value, { format: "percent" }) });
  const count = (value) => ({ value, text: String(value) });
  if (calculation === "count_all") return count(items.length);
  if (calculation === "count_values") return count(present.reduce((total, value) => total + (Array.isArray(value) ? value.length : 1), 0));
  if (calculation === "count_unique") {
    const scalarProperty = property.type === "multi_select" ? { ...property, type: "select" } : property;
    return count(new Set(present.flatMap((value) => Array.isArray(value) ? value : [value]).map((value) => formatPropertyValue(workspace, scalarProperty, ["people", "files", "relation"].includes(property.type) ? [value] : value))).size);
  }
  if (calculation === "count_empty") return count(emptyCount);
  if (calculation === "count_not_empty") return count(items.length - emptyCount);
  if (calculation === "percent_empty") return percent(items.length ? emptyCount / items.length : 0);
  if (calculation === "percent_not_empty") return percent(items.length ? (items.length - emptyCount) / items.length : 0);
  const checked = values.filter((value) => value === true).length;
  if (calculation === "checked") return count(checked);
  if (calculation === "unchecked") return count(items.length - checked);
  if (calculation === "percent_checked") return percent(items.length ? checked / items.length : 0);
  if (calculation === "percent_unchecked") return percent(items.length ? (items.length - checked) / items.length : 0);
  if (["earliest", "latest", "date_range"].includes(calculation)) {
    const dates = present.map(normalizeDate).filter((date) => date && Number.isFinite(dateMillis(date)));
    if (!dates.length) return { value: null, text: "" };
    const starts = dates.map((date) => ({ text: date.start, ms: dateMillis(date) })).sort((left, right) => left.ms - right.ms);
    const ends = dates.map((date) => ({ text: date.end || date.start, ms: dateMillis({ ...date, start: date.end || date.start }) })).filter((date) => Number.isFinite(date.ms)).sort((left, right) => left.ms - right.ms);
    if (calculation === "earliest") return { value: starts[0].text, text: formatDateLabel(starts[0].text) };
    if (calculation === "latest") return { value: ends.at(-1).text, text: formatDateLabel(ends.at(-1).text) };
    const value = (ends.at(-1).ms - starts[0].ms) / 86400000;
    return { value, text: `${value} 天` };
  }
  if (!numbers.length && calculation !== "sum") return { value: null, text: "" };
  const total = numbers.reduce((sum, value) => sum + value, 0);
  const middle = Math.floor(numbers.length / 2);
  const results = {
    sum: total, average: numbers.length ? total / numbers.length : null,
    median: numbers.length % 2 ? numbers[middle] : (numbers[middle - 1] + numbers[middle]) / 2,
    min: numbers[0], max: numbers.at(-1), range: numbers.at(-1) - numbers[0],
  };
  const value = results[calculation];
  const currency = reportedCurrency(workspace, property, source);
  return { value, text: currency ? formatCurrencyAmount(value, currency) : formatNumber(value, property.config?.numberFormat) };
}
