import { dateMillis, formatPropertyValue, isEmptyProperty, normalizeDate, normalizeIdValues, safePropertyHref } from "./databaseProperties.js";
import { convertedAmount, currencyAggregationIssue, isMoneyAggregation } from "./currencyConversion.js";
import { createFormulaBudget, evaluateFormulaAst, formulaError, isFormulaError, parseFormula } from "./formula/engine.js";
import { EMPTY_FORMULA_NUMBER, FormulaPage, FormulaPerson, plainFormulaValue } from "./formula/values.js";
import { isCheckboxRollupAggregation, isCountRollupAggregation, isDateRollupAggregation, isListRollupAggregation, isPercentRollupAggregation, rollupRelationTargetId } from "./rollupConfiguration.js";
import { resolveStatusValue } from "./statusGroups.js";

const collectionIndexes = new WeakMap();
const parsedExpressions = new WeakMap();
const MAX_DEPENDENCY_DEPTH = 64;
const personMetadata = new Set(["created_by", "last_edited_by"]);
const dateInputs = new Set(["date", "created_time", "modified_time"]);

function indexedEntity(collection, id) {
  if (!collection) return undefined;
  let index = collectionIndexes.get(collection);
  if (!index || index.length !== collection.length) {
    index = { length: collection.length, positions: new Map(collection.map((entry, position) => [entry.id, position])) };
    collectionIndexes.set(collection, index);
  }
  const entry = collection[index.positions.get(id)];
  if (entry?.id === id) return entry;
  // A caller can replace or reorder records in place before evaluating again.
  const position = collection.findIndex(candidate => candidate.id === id);
  if (position < 0) return undefined;
  index.positions.set(id, position);
  return collection[position];
}

function formulaTree(property) {
  const expression = property.config?.expression;
  let entry = parsedExpressions.get(property);
  if (!entry || entry.expression !== expression) {
    try { entry = { expression, ast: parseFormula(expression) }; }
    catch (error) { entry = { expression, error: formulaError("PARSE", error.message) }; }
    parsedExpressions.set(property, entry);
  }
  return entry;
}

function rawValue(item, property) {
  if (!item || !property) return null;
  if (property.type === "id") return item.id;
  if (property.type === "status") return resolveStatusValue(item, property);
  if (property.type === "checkbox") return item.values?.[property.id] === true;
  if (property.type === "created_time") return item.createdAt;
  if (property.type === "modified_time") return item.updatedAt;
  if (personMetadata.has(property.type)) return "我";
  const value = item.values?.[property.id] ?? null;
  if (property.type === "select") return indexedEntity(property.options, value)?.id ?? null;
  if (property.type === "multi_select" && value !== null) {
    const active = normalizeIdValues(value).filter(id => indexedEntity(property.options, id));
    return Array.isArray(value) && active.length === value.length && active.every((id, index) => id === value[index]) ? value : active;
  }
  return value;
}

function typedDate(value) {
  const date = normalizeDate(value);
  if (!date) return null;
  if (typeof value === "string" && date.start.includes("T")) date.includeTime = true;
  return Number.isFinite(dateMillis(date)) ? date : null;
}

function dateEndpointRollup(values, latest) {
  let bestDate = null;
  let bestTime;
  for (const value of values) {
    const start = latest ? value.end || value.start : value.start;
    const candidate = {
      start,
      end: null,
      includeTime: value.includeTime && start.includes("T"),
      timeZone: value.timeZone,
    };
    const time = dateMillis(candidate);
    if (Number.isFinite(time) && (!bestDate || (latest ? time > bestTime : time < bestTime))) {
      bestDate = candidate;
      bestTime = time;
    }
  }
  return bestDate;
}

function dateRangeRollup(values) {
  const first = dateEndpointRollup(values, false);
  const last = dateEndpointRollup(values, true);
  if (!first || !last) return null;
  const includeTime = first.includeTime || last.includeTime;
  if (first.timeZone === last.timeZone) {
    return { start: first.start, end: last.start, includeTime, timeZone: first.timeZone };
  }
  // Two source time zones cannot share a single wall-clock zone in a range.
  const endpoint = date => date.includeTime ? new Date(dateMillis(date)).toISOString() : date.start;
  return { start: endpoint(first), end: endpoint(last), includeTime, timeZone: null };
}

const isEmptyRollupAtom = value => isEmptyProperty(plainFormulaValue(value, { preserveReferences: true }));

export function rollupAtoms(value) {
  const entries = Array.isArray(value) ? value.flat(Infinity) : [value];
  return entries.filter(entry => !isEmptyRollupAtom(entry));
}

function nonEmptyRollupCell(value) {
  if (!Array.isArray(value)) return isEmptyRollupAtom(value) ? null : value;
  const entries = value.map(nonEmptyRollupCell).filter(entry => entry !== null);
  return entries.length ? entries : null;
}

function distinctRollupValues(values, property) {
  const labels = ["select", "status", "multi_select"].includes(property?.type)
    ? new Map(property.options?.map(({ id, name }) => [id, name])) : new Map();
  const seen = new Set();
  return values.filter(value => {
    const raw = plainFormulaValue(value);
    const type = value instanceof FormulaPage ? "page" : value instanceof FormulaPerson ? "person" : typeof raw;
    const date = type === "object" && raw.start ? normalizeDate(raw) : null;
    const identity = date ? [date.start, date.end, date.includeTime, date.timeZone] : labels.get(raw) ?? raw;
    const key = JSON.stringify([type, identity]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function formulaChoiceLabel(property, value) {
  return indexedEntity(property.options, value)?.name ?? value;
}

function formulaPropertyAtom(property, value) {
  if (value == null || !property || isFormulaError(value)) return value;
  if (["select", "status", "multi_select"].includes(property.type)) return formulaChoiceLabel(property, value);
  if (property.type === "unique_id") return formatPropertyValue(null, property, value);
  if (dateInputs.has(property.type)) return typedDate(value);
  return value;
}

function formulaRollupValues(property, values) {
  return values.map(value => Array.isArray(value) ? formulaRollupValues(property, value) : formulaPropertyAtom(property, value));
}

function rollupTypeError(property, target, expected) {
  return formulaError("TYPE", `汇总「${property.name || property.id}」需要${expected}，请检查目标属性「${target.name || target.id}」的非空值`);
}

function numericRollup(values, aggregation, property, target) {
  if (!values.length) return aggregation === "sum" ? 0 : null;
  if (values.some(value => !Number.isFinite(value))) return rollupTypeError(property, target, "数字");
  let result;
  if (aggregation === "sum" || aggregation === "average") {
    const sum = values.reduce((total, value) => total + value, 0);
    result = aggregation === "sum" ? sum : sum / values.length;
  } else if (aggregation === "median") {
    const ordered = values.toSorted((left, right) => left - right);
    const middle = Math.floor(ordered.length / 2);
    if (ordered.length % 2) result = ordered[middle];
    else {
      const left = ordered[middle - 1], right = ordered[middle];
      const sum = left + right;
      result = Number.isFinite(sum) ? sum / 2 : left / 2 + right / 2;
    }
  } else {
    const min = values.reduce((least, value) => Math.min(least, value));
    const max = values.reduce((most, value) => Math.max(most, value));
    result = aggregation === "min" ? min : aggregation === "max" ? max : max - min;
  }
  return Number.isFinite(result) ? result : formulaError("TYPE", `汇总「${property.name || property.id}」的计算结果超出数字范围`);
}

function createEvaluation(workspace, stack, options) {
  const now = options.now ?? Date.now();
  const charge = options.consumeSteps ?? createFormulaBudget(options.maxSteps);
  const active = new Set(stack);
  const fieldsByName = new Map();
  const relationTargets = new Map();
  const calculated = new Map();
  const withRelatedPages = new Map();

  function propertyNamed(source, name) {
    if (!fieldsByName.has(source)) {
      const names = new Map();
      for (const field of source?.properties || []) if (!names.has(field.name)) names.set(field.name, field);
      fieldsByName.set(source, names);
    }
    return fieldsByName.get(source).get(name);
  }

  function relationTarget(source, property) {
    if (!relationTargets.has(source)) relationTargets.set(source, new Map());
    const targets = relationTargets.get(source);
    if (!targets.has(property)) {
      targets.set(property, indexedEntity(workspace?.dataSources, rollupRelationTargetId(workspace, source, property)));
    }
    return targets.get(property);
  }

  function relatedPages(source, item, property) {
    const value = rawValue(item, property);
    const target = relationTarget(source, property);
    if (!target) return [];
    const titleField = target.properties.find(field => field.type === "title");
    return relatedItems(target, value).flatMap(record => {
      const page = indexedEntity(workspace?.pages, record.pageId);
      if (!page) return [];
      const title = record.values?.[titleField?.id] ?? page.title ?? "";
      return [new FormulaPage(record.id, title, (name, bindings) => {
        const bound = bindings?.find(entry => entry.sourceId === target.id);
        const field = bound ? indexedEntity(target.properties, bound.propertyId) : propertyNamed(target, name);
        return field ? readFormulaInput(target, record, field) : formulaError("REF", `找不到属性：${name}`);
      }, record.pageId)];
    });
  }

  function relatedItems(target, value) {
    const ids = normalizeIdValues(value);
    charge(ids.length);
    return ids.map(id => indexedEntity(workspace?.databaseItems, id)).filter(record =>
      target && record?.sourceId === target.id && !record.trashedAt && !indexedEntity(workspace?.pages, record.pageId)?.trashedAt);
  }

  function personFor(id) {
    const person = indexedEntity(workspace?.people, id);
    if (!person || person.trashedAt) return null;
    const email = safePropertyHref("email", person.email) ? person.email.trim() : null;
    return new FormulaPerson(person.id, person.displayName || "成员", email);
  }

  function readFormulaInput(source, item, property) {
    const value = read(source, item, property, true);
    if (property?.type === "number" && value == null) return EMPTY_FORMULA_NUMBER;
    if (property?.type === "multi_select") return normalizeIdValues(value).map(id => formulaChoiceLabel(property, id));
    return formulaPropertyAtom(property, value);
  }

  function readFormula(source, item, property) {
    const tree = formulaTree(property);
    if (tree.error) return tree.error;
    return evaluateFormulaAst(tree.ast, id => {
      const field = indexedEntity(source?.properties, id);
      return field ? readFormulaInput(source, item, field) : formulaError("REF", `找不到属性：${id}`);
    }, {
      now, consumeSteps: charge, internalValues: true, pageId: item?.id,
      resolveName: name => propertyNamed(source, name)?.id,
      resolvePropertyType: id => indexedEntity(source?.properties, id)?.type,
    });
  }

  function readRollup(source, item, property, typed) {
    const { relationPropertyId, targetPropertyId } = property.config || {};
    const aggregation = property.config?.aggregation || "show";
    const countRollup = isCountRollupAggregation(aggregation);
    const percentRollup = isPercentRollupAggregation(aggregation);
    const relation = indexedEntity(source?.properties, relationPropertyId);
    if (relation?.type !== "relation") return countRollup && !percentRollup ? 0 : null;
    const targetSource = relationTarget(source, relation);
    const targetProperty = indexedEntity(targetSource?.properties, targetPropertyId);
    const targets = relatedItems(targetSource, rawValue(item, relation));
    if (aggregation === "count_all") return targets.length;
    const typedList = typed && isListRollupAggregation(aggregation);
    const checkboxRollup = isCheckboxRollupAggregation(aggregation);
    const dateRollup = isDateRollupAggregation(aggregation);
    const valueCounts = countRollup || aggregation === "show_unique";
    const numberRollup = isMoneyAggregation(aggregation);
    if ((valueCounts || checkboxRollup) && !targetProperty) return null;
    const targetType = targetProperty?.type;
    const readReferences = typedList || targetType === "relation" || targetType === "people" || personMetadata.has(targetType);
    const readDate = dateRollup && dateInputs.has(targetType);
    const values = [];
    for (const record of targets) {
      const raw = read(targetSource, record, targetProperty, readReferences);
      const value = readDate ? typedDate(raw) : raw;
      if (value?.error?.code === "CYCLE" || value?.error?.code === "EVAL") return value;
      if ((valueCounts || checkboxRollup || dateRollup) && isFormulaError(value)) return value;
      const cell = nonEmptyRollupCell(value);
      if (cell !== null) values.push(cell);
    }
    if (valueCounts) {
      const present = values.length;
      const empty = targets.length - present;
      if (aggregation === "not_empty") return present;
      if (aggregation === "empty") return empty;
      if (percentRollup) return targets.length ? (aggregation === "percent_empty" ? empty : present) / targets.length : null;
      const entries = rollupAtoms(values);
      if (aggregation === "count_values") return entries.length;
      const unique = distinctRollupValues(entries, targetProperty);
      if (aggregation === "unique") return unique.length;
      return typedList ? formulaRollupValues(targetProperty, unique) : unique;
    }
    if (numberRollup) {
      const issue = currencyAggregationIssue(targetSource, targetProperty, targets, values);
      if (issue) return issue;
      const formulaIssue = values.find(isFormulaError);
      return formulaIssue || numericRollup(values, aggregation, property, targetProperty);
    }
    if (checkboxRollup) {
      if (values.some(value => typeof value !== "boolean")) return rollupTypeError(property, targetProperty, "复选框结果");
      const checked = values.filter(value => value === true).length;
      if (aggregation === "checked") return checked;
      const unchecked = targets.length - checked;
      if (aggregation === "unchecked") return unchecked;
      return targets.length ? (aggregation === "percent_checked" ? checked : unchecked) / targets.length : null;
    }
    if (aggregation === "percent_complete") {
      const completed = new Set((targetProperty?.options || []).filter(option => option.group === "complete").map(option => option.id));
      return targets.length ? values.filter(value => completed.has(value)).length / targets.length : null;
    }
    if (dateRollup) {
      if (values.some(value => typeof value?.start !== "string" || !Number.isFinite(dateMillis(value)))) {
        return rollupTypeError(property, targetProperty, "日期");
      }
      return aggregation === "date_range" ? dateRangeRollup(values) : dateEndpointRollup(values, aggregation === "latest_date");
    }
    return typedList ? formulaRollupValues(targetProperty, values) : values;
  }

  function read(source, item, property, typed) {
    if (!property) return null;
    const { type } = property;
    const typedRelation = typed && type === "relation";
    if (type === "converted_amount") return convertedAmount(source, item, property.config);
    if (typed && type === "people") return normalizeIdValues(rawValue(item, property)).map(personFor).filter(Boolean);
    if (typed && personMetadata.has(type)) return personFor("person-local");
    if (type !== "formula" && type !== "rollup" && !typedRelation) return rawValue(item, property);
    const key = JSON.stringify([source?.id, item?.id, property.id]);
    if (active.has(key) || stack?.has(`${item?.id || "item"}:${property.id}`)) {
      return formulaError("CYCLE", `公式循环引用：${property.name || property.id}`);
    }
    const cache = typedRelation || (typed && type === "rollup") ? withRelatedPages : calculated;
    if (cache.has(key)) return cache.get(key);
    if (active.size >= MAX_DEPENDENCY_DEPTH) return formulaError("EVAL", "公式依赖层数过多");
    charge();
    active.add(key);
    try {
      const value = typedRelation ? relatedPages(source, item, property)
        : type === "formula" ? readFormula(source, item, property) : readRollup(source, item, property, typed);
      cache.set(key, value);
      return value;
    } finally {
      active.delete(key);
    }
  }

  return { read, readFormulaInput };
}

function evaluateProperty(workspace, source, item, property, stack, options, formulaInput) {
  try {
    const evaluation = createEvaluation(workspace, stack, options);
    const value = formulaInput ? evaluation.readFormulaInput(source, item, property)
      : evaluation.read(source, item, property, options.internalValues);
    return options.internalValues ? value : plainFormulaValue(value, options);
  } catch (error) {
    return formulaError(error instanceof TypeError ? "TYPE" : "EVAL", error.message);
  }
}

export function resolveFormulaPropertyValue(workspace, source, item, property, stack, internalValues = false) {
  return evaluateProperty(workspace, source, item, property, stack, { internalValues }, true);
}

export function resolveTypedPropertyValue(workspace, source, item, property, options = {}) {
  return evaluateProperty(workspace, source, item, property, undefined, { ...options, internalValues: false, preserveReferences: true }, true);
}

export function resolveDisplayPropertyValue(workspace, source, item, property, options = {}) {
  if (property?.type !== "formula" && property?.type !== "rollup") return resolvePropertyValue(workspace, source, item, property, undefined, options);
  return resolveTypedPropertyValue(workspace, source, item, property, { ...options, preserveStyles: true });
}

export function resolvePropertyValue(workspace, source, item, property, stack, options = {}) {
  if (property?.type === "converted_amount") return convertedAmount(source, item, property.config);
  if (property?.type !== "formula" && property?.type !== "rollup") return rawValue(item, property);
  return evaluateProperty(workspace, source, item, property, stack, options, false);
}

