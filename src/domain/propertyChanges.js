import { copyJson } from "./blockDocument.js";
import { isEmptyProperty, normalizeDate } from "./databaseProperties.js";
import { availableCalculations } from "./databaseStats.js";
import { parseCsvDate, parseCsvNumber, TRUE_WORDS } from "./csv.js";
import { renameFormulaPropertyReference } from "./formula/engine.js";
import { bindRenamedRelatedProperties } from "./formula/relatedPropertyReferences.js";
import { resolveStatusValue, statusDefaultOptionId } from "./statusGroups.js";
import { normalizeRollupConfig } from "./rollupConfiguration.js";

export const CONVERTIBLE_TYPES = ["text", "number", "select", "multi_select", "status", "date", "checkbox", "url", "email", "phone"];
export const OPTION_PALETTE = ["default", "gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"];

export function propertyTypeConversionTargets(type) {
  if (!CONVERTIBLE_TYPES.includes(type)) return [];
  const targets = CONVERTIBLE_TYPES.filter((candidate) => candidate !== type);
  return type === "text" ? [...targets, "formula"] : targets;
}

const sourceFor = (workspace, sourceId) => workspace.dataSources?.find((source) => source.id === sourceId);
const optionTypes = new Set(["select", "multi_select", "status"]);

export function updatePropertyDefinition(workspace, { sourceId, propertyId, definition, now }) {
  const source = sourceFor(workspace, sourceId);
  const oldProperty = source?.properties?.find((property) => property.id === propertyId);
  const owner = source?.ownerPageId && workspace.pages?.find(page => page.id === source.ownerPageId);
  if (!oldProperty || source.locked || source.trashedAt || source.ownerPageId && (!owner || owner.trashedAt || owner.settings?.locked)) return workspace;
  const oldName = oldProperty?.name;
  const newName = definition.name ?? oldName;
  const renaming = oldProperty && typeof oldName === "string" && typeof newName === "string" && oldName !== newName;
  const rewriteNames = renaming && source.properties.find((property) => property.name === oldName)?.id === propertyId;
  const previousDestination = renaming && source.properties.find((property) => property.name === newName);
  const nextDestination = renaming && source.properties.find((property) => property.id === propertyId || property.name === newName);
  const displacedDestination = previousDestination && previousDestination.id !== nextDestination.id ? previousDestination : null;
  const affectedNames = new Map();
  if (rewriteNames) affectedNames.set(oldName, propertyId);
  if (displacedDestination) affectedNames.set(newName, displacedDestination.id);
  return {
    ...workspace,
    dataSources: workspace.dataSources.map((candidate) => {
      const local = candidate.id === sourceId;
      if (!local && !renaming) return candidate;
      const properties = candidate.properties.map((property) => {
        const updated = !local || property.id !== propertyId ? property : {
          ...property, name: definition.name ?? property.name,
          options: definition.options || property.options,
          config: { ...property.config, ...definition.config },
        };
        if (updated !== property && updated.type === "status" && updated.config.defaultOptionId && !statusDefaultOptionId(updated)) {
          updated.config.defaultOptionId = null;
        }
        if (updated !== property && updated.type === "rollup") updated.config = normalizeRollupConfig(updated.config);
        if (!renaming || updated.type !== "formula") return updated;
        let expression = bindRenamedRelatedProperties(workspace, candidate, updated.config?.expression, source, affectedNames);
        if (local && displacedDestination) expression = renameFormulaPropertyReference(expression, newName, newName, { propertyId: displacedDestination.id });
        if (local && rewriteNames) expression = renameFormulaPropertyReference(expression, oldName, newName,
          { propertyId: nextDestination.id !== propertyId ? propertyId : undefined });
        return expression === updated.config?.expression ? updated : { ...updated, config: { ...updated.config, expression } };
      });
      return local || properties.some((field, i) => field !== candidate.properties[i]) ? { ...candidate, updatedAt: now, properties } : candidate;
    }),
    relations: (workspace.relations || []).map((relation) => relation.sourceId === sourceId && relation.propertyId === propertyId && definition.config?.targetSourceId
      ? { ...relation, targetSourceId: definition.config.targetSourceId } : relation),
  };
}

export function assignUniqueIds(workspace, { sourceId, propertyId }) {
  const source = sourceFor(workspace, sourceId);
  const property = source?.properties?.find((entry) => entry.id === propertyId);
  if (property?.type !== "unique_id") return workspace;
  const records = (workspace.databaseItems || []).filter((item) => item.sourceId === sourceId).sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)) || left.id.localeCompare(right.id));
  const numbers = new Map(records.map((item, index) => [item.id, index + 1]));
  return {
    ...workspace,
    dataSources: workspace.dataSources.map((entry) => entry.id === sourceId ? { ...entry, properties: entry.properties.map((candidate) => candidate.id === propertyId ? { ...candidate, config: { ...candidate.config, nextNumber: records.length + 1 } } : candidate) } : entry),
    databaseItems: (workspace.databaseItems || []).map((item) => numbers.has(item.id) ? { ...item, values: { ...item.values, [propertyId]: numbers.get(item.id) } } : item),
  };
}

export function allocateUniqueIds(workspace, { sourceId, values = {} }) {
  const source = sourceFor(workspace, sourceId);
  if (!source) return { workspace, values: copyJson(values) };
  const nextValues = copyJson(values);
  let changed = false;
  const properties = source.properties.map((property) => {
    if (property.type !== "unique_id") return property;
    const number = property.config?.nextNumber ?? 1;
    if (!Number.isSafeInteger(number) || number < 1 || number >= Number.MAX_SAFE_INTEGER) throw new Error("ID 编号超出范围");
    nextValues[property.id] = number;
    changed = true;
    return { ...property, config: { ...property.config, nextNumber: number + 1 } };
  });
  return { workspace: changed ? { ...workspace, dataSources: workspace.dataSources.map((entry) => entry.id === sourceId ? { ...entry, properties } : entry) } : workspace, values: nextValues };
}

export function valueToText(property, value) {
  if (isEmptyProperty(value)) return "";
  if (["select", "status"].includes(property.type)) return property.options?.find((option) => option.id === value)?.name || "";
  if (property.type === "multi_select") return (Array.isArray(value) ? value : [value]).map((id) => property.options?.find((option) => option.id === id)?.name || "").filter(Boolean).join(", ");
  if (property.type === "date") {
    const date = normalizeDate(value);
    return date ? `${date.start}${date.end ? ` → ${date.end}` : ""}` : "";
  }
  if (property.type === "checkbox") return value ? "是" : "否";
  return String(value);
}

export function textToValue(property, text, { idFactory } = {}) {
  const value = String(text ?? "").trim();
  if (["text", "title", "url", "email", "phone"].includes(property.type)) return value || null;
  if (property.type === "number") return parseCsvNumber(value);
  if (property.type === "checkbox") return TRUE_WORDS.includes(value.toLowerCase());
  if (property.type === "date") {
    const start = parseCsvDate(value.split("→")[0]);
    return start ? { start, end: null, includeTime: false, timeZone: null } : null;
  }
  if (optionTypes.has(property.type)) {
    const optionFor = (name) => {
      const existing = (property.options || []).find((option) => option.name === name);
      if (existing) return existing.id;
      if (typeof idFactory !== "function") throw new Error("新增选项需要 ID 生成器");
      const options = property.options || [];
      const option = { id: idFactory("opt"), name, color: OPTION_PALETTE[options.length % OPTION_PALETTE.length], ...(property.type === "status" ? { group: "todo" } : {}) };
      property.options = [...options, option];
      return option.id;
    };
    if (property.type === "multi_select") return [...new Set(value.split(/[,，、]/).map((name) => name.trim()).filter(Boolean))].map(optionFor);
    return value ? optionFor(value) : null;
  }
  return null;
}

export function convertPropertyType(workspace, { sourceId, propertyId, nextType, now, idFactory }) {
  const source = sourceFor(workspace, sourceId);
  const property = source?.properties.find((candidate) => candidate.id === propertyId);
  if (!property) return workspace;
  if (property.type === "title" || nextType === "title") throw new Error("名称属性不能更改类型或删除");
  if (property.type === nextType && CONVERTIBLE_TYPES.includes(property.type)) return workspace;
  if (!propertyTypeConversionTargets(property.type).includes(nextType)) throw new Error("这种属性不能更改类型");
  const direct = optionTypes.has(property.type) && optionTypes.has(nextType);
  const nextProperty = { ...property, type: nextType, options: direct ? copyJson(property.options || []).map((option) => nextType === "status" && !option.group ? { ...option, group: "todo" } : option) : [], config: copyJson(property.config || {}) };
  if (property.type === "status") delete nextProperty.config.defaultOptionId;
  if (nextType === "formula") nextProperty.config.expression = "";
  const databaseItems = (workspace.databaseItems || []).map((item) => {
    if (item.sourceId !== sourceId) return item;
    const stored = item.values?.[propertyId] ?? null;
    const previous = property.type === "status" ? resolveStatusValue(item, property) : stored;
    const value = direct
      ? nextType === "multi_select" ? Array.isArray(previous) ? [...previous] : previous ? [previous] : [] : Array.isArray(previous) ? previous[0] || null : previous
      : textToValue(nextProperty, valueToText(property, previous), { idFactory });
    return JSON.stringify(stored) === JSON.stringify(value) ? item : { ...item, values: { ...item.values, [propertyId]: value }, updatedAt: now };
  });
  return {
    ...workspace, databaseItems,
    dataSources: workspace.dataSources.map((entry) => entry.id === sourceId ? { ...entry, updatedAt: now, properties: entry.properties.map((candidate) => candidate.id === propertyId ? nextProperty : candidate) } : entry),
    databaseViews: (workspace.databaseViews || []).map((view) => {
      const calculations = view.config?.table?.calculations;
      if (view.sourceId !== sourceId || !calculations || !Object.hasOwn(calculations, propertyId) || availableCalculations(nextProperty).includes(calculations[propertyId])) return view;
      const nextCalculations = { ...calculations };
      delete nextCalculations[propertyId];
      return { ...view, config: { ...view.config, table: { ...view.config.table, calculations: nextCalculations } } };
    }),
  };
}

function cleanFilter(filter, propertyId) {
  if (!filter || typeof filter !== "object") return filter;
  if (filter.propertyId === propertyId) return null;
  if (filter.kind === "group") {
    const children = (filter.children || []).map((child) => cleanFilter(child, propertyId)).filter(Boolean);
    return children.length ? { ...filter, children } : null;
  }
  for (const key of ["and", "or"]) {
    if (!Array.isArray(filter[key])) continue;
    const children = filter[key].map((child) => cleanFilter(child, propertyId)).filter(Boolean);
    return children.length ? { ...filter, [key]: children } : null;
  }
  return filter;
}

function cleanConfig(value, propertyId) {
  if (typeof value === "string") return value === propertyId ? null : value;
  if (Array.isArray(value)) return value.filter((entry) => entry !== propertyId).map((entry) => cleanConfig(entry, propertyId));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([key]) => key !== propertyId).map(([key, entry]) => [key, cleanConfig(entry, propertyId)]));
  return value;
}

export function deleteProperty(workspace, { sourceId, propertyId }) {
  const source = sourceFor(workspace, sourceId);
  const property = source?.properties.find((candidate) => candidate.id === propertyId);
  if (!property) return workspace;
  if (property.type === "title") throw new Error("名称属性不能更改类型或删除");
  return {
    ...workspace,
    dataSources: workspace.dataSources.map((entry) => entry.id === sourceId ? { ...entry, properties: entry.properties.filter((candidate) => candidate.id !== propertyId) } : entry),
    databaseItems: (workspace.databaseItems || []).map((item) => {
      if (item.sourceId !== sourceId || !Object.hasOwn(item.values || {}, propertyId)) return item;
      const values = { ...item.values };
      delete values[propertyId];
      return { ...item, values };
    }),
    databaseViews: (workspace.databaseViews || []).map((view) => view.sourceId === sourceId ? {
      ...view, visiblePropertyIds: Array.isArray(view.visiblePropertyIds) ? view.visiblePropertyIds.filter((id) => id !== propertyId) : view.visiblePropertyIds,
      sorts: (view.sorts || []).filter((sort) => sort.propertyId !== propertyId), filter: cleanFilter(view.filter, propertyId),
      groupBy: view.groupBy === propertyId ? null : view.groupBy,
      ...(view.grouping ? { grouping: { ...view.grouping, primaryPropertyId: view.grouping.primaryPropertyId === propertyId ? null : view.grouping.primaryPropertyId, secondaryPropertyId: view.grouping.secondaryPropertyId === propertyId ? null : view.grouping.secondaryPropertyId } } : {}),
      config: cleanConfig(view.config, propertyId),
    } : view),
    relations: (workspace.relations || []).filter((relation) => relation.sourceId !== sourceId || relation.propertyId !== propertyId).map((relation) => relation.targetSourceId === sourceId && relation.reciprocalPropertyId === propertyId ? { ...relation, reciprocalPropertyId: null } : relation),
  };
}
