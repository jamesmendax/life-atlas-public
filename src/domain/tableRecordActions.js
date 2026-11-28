import { stableJson } from "./blockDocument.js";
import { archivedPageIds } from "./archive.js";
import { applyRelationChange, databaseId, dataSourceById, relationDefinition, updateDatabaseItemValue } from "./database.js";
import { normalizeIdValues, normalizePropertyValue, READ_ONLY_PROPERTY_TYPES, validatePropertyValue } from "./databaseProperties.js";
import { applyTrackedPageEdit } from "./pageHistoryCapture.js";
import { applyStatusChanges, captureStatusChange, hasStatusWorkflow } from "./statusWorkflows.js";

export function batchWritableProperty(property) {
  return Boolean(property && !READ_ONLY_PROPERTY_TYPES.includes(property.type));
}

export function updateTableItemsProperty(workspace, { sourceId, itemIds, propertyId, value, now = Date.now(), beforeEditIds } = {}) {
  const source = dataSourceById(workspace, sourceId);
  const property = source?.properties.find(entry => entry.id === propertyId);
  const pages = new Map((workspace.pages || []).map(page => [page.id, page]));
  const archived = archivedPageIds(workspace);
  const editable = page => page && !page.trashedAt && !page.settings?.locked && !archived.has(page.id);
  const ownerUnavailable = source?.ownerPageId && !editable(pages.get(source.ownerPageId));
  if (!batchWritableProperty(property) || !Array.isArray(itemIds)
    || value === undefined || ownerUnavailable
    || property.type === "number" && value !== null && value !== "" && !Number.isFinite(Number(value))
    || validatePropertyValue(property, value)) return workspace;
  const selected = new Set(itemIds);
  const nextValue = normalizePropertyValue(property, value);
  const matching = workspace.databaseItems.filter(item => item.sourceId === sourceId && selected.has(item.id) && editable(pages.get(item.pageId)));
  if (!matching.length) return workspace;

  if (property.type === "title") {
    return matching.reduce((next, item) => applyTrackedPageEdit(next, {
      pageId: item.pageId, patch: { title: String(value ?? "") }, now, beforeEditId: beforeEditIds?.get(item.pageId),
    }), workspace);
  }

  const time = new Date(now).toISOString();
  if (hasStatusWorkflow(property)) {
    const operationId = databaseId("workflow-batch");
    const commands = matching.map(item => captureStatusChange(source, item, property, nextValue, operationId, time));
    return applyStatusChanges(workspace, commands).workspace;
  }
  if (property.type === "relation") {
    const relation = relationDefinition(workspace, sourceId, property);
    const targetSourceId = relation?.targetSourceId;
    const records = new Map(workspace.databaseItems.map(item => [item.id, item]));
    if (nextValue.some(id => {
      const target = records.get(id);
      return !target || targetSourceId && target.sourceId !== targetSourceId || !pages.get(target.pageId) || pages.get(target.pageId).trashedAt;
    })) return workspace;
    const nextIds = new Set(nextValue);
    return matching.reduce((next, item) => {
      const current = next.databaseItems.find(entry => entry.id === item.id);
      const previous = normalizeIdValues(current.values?.[propertyId]);
      if (stableJson(previous) === stableJson(nextValue)) return next;
      if (relation?.reciprocalPropertyId) {
        const previousIds = new Set(previous);
        const changed = [...previous.filter(id => !nextIds.has(id)), ...nextValue.filter(id => !previousIds.has(id))];
        if (changed.some(id => {
          const target = records.get(id);
          return target && target.sourceId === targetSourceId && !editable(pages.get(target.pageId));
        })) return next;
      }
      return applyRelationChange(next, { itemId: current.id, propertyId, nextIds: nextValue, now: time });
    }, workspace);
  }

  const changes = new Map(matching.filter(item => {
    const stored = item.values?.[propertyId];
    return property.type === "status" ? stored !== nextValue : stableJson(stored ?? null) !== stableJson(nextValue);
  })
    .map(item => [item.id, updateDatabaseItemValue(item, propertyId, nextValue, time)]));
  if (!changes.size) return workspace;
  return { ...workspace, databaseItems: workspace.databaseItems.map(item => changes.get(item.id) || item) };
}
