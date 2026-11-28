import { dateMillis, normalizeDate } from "./databaseProperties.js";
import { rollupAtoms } from "./databasePropertyValues.js";
import { plainFormulaValue } from "./formula/values.js";
import { isDateRollupAggregation, isNumericRollupAggregation } from "./rollupConfiguration.js";

export function filterGroup(filter) {
  if (filter?.kind === "group") return { op: filter.op === "or" ? "or" : "and", children: Array.isArray(filter.children) ? filter.children : [] };
  if (Array.isArray(filter?.and)) return { op: "and", children: filter.and };
  if (Array.isArray(filter?.or)) return { op: "or", children: filter.or };
  return null;
}

export function filterUsesRelativeDate(filter) {
  const group = filterGroup(filter);
  return group ? group.children.some(filterUsesRelativeDate) : filter?.operator === "relative_date";
}

const numberComparisons = new Set(["greater_than", "greater_than_or_equal", "less_than", "less_than_or_equal"]);
const dateComparisons = new Set(["before", "after", "on_or_before", "on_or_after"]);
const noValueOperators = new Set(["is_empty", "is_not_empty", "checked", "unchecked", "any_checked", "any_unchecked"]);

const listTextRules = Object.freeze({
  equals: ["等于", (item, value) => item === value],
  not_equals: ["不等于", (item, value) => item !== value],
  contains: ["包含", (item, value) => item.toLocaleLowerCase().includes(value.toLocaleLowerCase())],
  not_contains: ["不包含", (item, value) => !item.toLocaleLowerCase().includes(value.toLocaleLowerCase())],
});
const listQuantifiers = Object.freeze({
  any: ["任一项", (items, test) => items.some(test)],
  every: ["每一项", (items, test) => items.every(test)],
  none: ["没有一项", (items, test) => !items.some(test)],
});
const computedListTextRules = Object.freeze(Object.fromEntries(
  Object.entries(listQuantifiers).flatMap(([quantifier, [quantifierLabel, evaluate]]) =>
    Object.entries(listTextRules).map(([operator, [ruleLabel, test]]) =>
      [`${quantifier}_text_${operator}`, { label: `${quantifierLabel}文本${ruleLabel}`, evaluate, test }])),
));

export const computedListTextOptions = Object.entries(computedListTextRules).map(([id, { label }]) => [id, label]);
export const isComputedListTextOperator = operator => Object.hasOwn(computedListTextRules, operator);

export function matchesComputedListText(value, filter) {
  if (!Array.isArray(value) || typeof filter.value !== "string") return false;
  const { evaluate, test } = computedListTextRules[filter.operator];
  return evaluate(rollupAtoms(value), item => {
    const label = plainFormulaValue(item, { pageTitles: true });
    return typeof label === "string" && test(label, filter.value);
  });
}

export const isNumberComparison = operator => numberComparisons.has(operator);
export const isDateComparison = operator => dateComparisons.has(operator);
export const isEqualityFilter = operator => operator === "equals" || operator === "not_equals";
export const isComputedFilterProperty = property => property?.type === "formula" || property?.type === "rollup";
export const filterHasNoValue = operator => noValueOperators.has(operator);
export const isNumberFilterProperty = property => property?.type === "number" || property?.type === "converted_amount" ||
  (property?.type === "rollup" && isNumericRollupAggregation(property.config?.aggregation));
export const isDateFilterProperty = property => ["date", "created_time", "modified_time"].includes(property?.type) ||
  (property?.type === "rollup" && isDateRollupAggregation(property.config?.aggregation));

export function isComputedNumberEquality(property, filter) {
  return isComputedFilterProperty(property) && isEqualityFilter(filter?.operator) &&
    (filter.valueType === "number" || typeof filter.value === "number");
}

export function numericFilterValue(value) {
  if (typeof value !== "number" && !(typeof value === "string" && value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function matchesNumberFilter(property, value, filter) {
  const actual = isComputedFilterProperty(property) ? (Number.isFinite(value) ? value : null) : numericFilterValue(value);
  const expected = numericFilterValue(filter.value);
  if (actual === null || expected === null) return false;
  switch (filter.operator) {
    case "equals": return actual === expected;
    case "not_equals": return actual !== expected;
    case "greater_than": return actual > expected;
    case "greater_than_or_equal": return actual >= expected;
    case "less_than": return actual < expected;
    case "less_than_or_equal": return actual <= expected;
    default: return false;
  }
}

function filterDatePosition(date, timed) {
  const start = date.start;
  if (!/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(start)) return NaN;
  const day = start.slice(0, 10);
  const dayPosition = Date.parse(day + "T00:00:00Z");
  if (!Number.isFinite(dayPosition) || new Date(dayPosition).toISOString().slice(0, 10) !== day) return NaN;
  return timed ? dateMillis({ ...date, includeTime: start.length > 10 }) : dayPosition;
}

export function matchesFixedDateFilter(value, filter) {
  const actual = normalizeDate(value);
  const expected = normalizeDate(filter.value);
  if (!actual || !expected) return false;
  const timed = expected.start.length > 10;
  const left = filterDatePosition(actual, timed);
  const right = filterDatePosition(expected, timed);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
  switch (filter.operator) {
    case "equals": return left === right;
    case "not_equals": return left !== right;
    case "before": return left < right;
    case "after": return left > right;
    case "on_or_before": return left <= right;
    case "on_or_after": return left >= right;
    default: return false;
  }
}

// Each entry is a record ID required in every successful branch of the filter.
// An OR branch without that requirement cannot supply a creation default.
function requiredRecords(filter, relationIds) {
  const group = filterGroup(filter);
  if (!group) {
    if (filter?.operator !== "equals" || !relationIds.has(filter.propertyId) || typeof filter.value !== "string" || !filter.value) return new Map();
    return new Map([[filter.propertyId, new Set([filter.value])]]);
  }
  const [first = new Map(), ...others] = group.children.map(child => requiredRecords(child, relationIds));
  for (const branch of others) {
    if (group.op === "or") {
      for (const [id, values] of first) {
        const otherValues = branch.get(id);
        for (const value of values) if (!otherValues?.has(value)) values.delete(value);
        if (!values.size) first.delete(id);
      }
    } else {
      for (const [id, values] of branch) {
        if (!first.has(id)) first.set(id, new Set());
        for (const value of values) first.get(id).add(value);
      }
    }
  }
  return first;
}

export function relationFilterDefaults(workspace, source, filter) {
  if (!filter) return {};
  const relations = source.properties.filter(property => property.type === "relation");
  if (!relations.length) return {};
  const required = requiredRecords(filter, new Set(relations.map(property => property.id)));
  if (!required.size) return {};
  const items = new Map((workspace.databaseItems || []).map(item => [item.id, item]));
  const trashedPages = new Set((workspace.pages || []).filter(page => page.trashedAt).map(page => page.id));
  return Object.fromEntries(relations.flatMap(property => {
    const ids = [...(required.get(property.id) || [])];
    if (!ids.length || (property.config?.relationLimit === 1 && ids.length > 1)) return [];
    const targetId = workspace.relations?.find(relation => relation.sourceId === source.id && relation.propertyId === property.id)?.targetSourceId || property.config?.targetSourceId;
    if (!targetId || !ids.every(id => items.get(id)?.sourceId === targetId && !trashedPages.has(items.get(id).pageId))) return [];
    return [[property.id, ids]];
  }));
}
