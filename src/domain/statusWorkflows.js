import { copyJson, stableJson } from "./blockDocument.js";
import { isPageArchived } from "./archive.js";
import { dataSourceById, databaseItemById, updateDatabaseItemValue } from "./database.js";
import { executeDatabaseAction, replayDatabaseAction } from "./databaseActions.js";
import { normalizePropertyValue } from "./databaseProperties.js";
import { applyTaskRecurrence, captureRecurrenceOccurrence } from "./taskRecurrence.js";
import { resolveStatusValue } from "./statusGroups.js";

export function hasStatusWorkflow(property) {
  return property?.type === "status" && Boolean(property.config?.recurrence || property.config?.statusAction);
}

export function captureStatusChange(source, item, property, value, operationId, now) {
  return {
    itemId: item.id, propertyId: property.id, value: normalizePropertyValue(property, value), operationId, now,
    expectedStatus: resolveStatusValue(item, property),
    expectedOccurrence: captureRecurrenceOccurrence(source, item, property),
    expectedAction: copyJson(property.config?.statusAction ?? null),
  };
}

export function applyStatusChange(workspace, change) {
  if (change.expectedAction?.optionId === change.value && change.operationId) {
    try {
      const replay = replayDatabaseAction(workspace, change.itemId, change.operationId, change.expectedAction.action);
      if (replay) return { workspace, replayed: true };
    } catch (error) { return { workspace, reason: error.message }; }
  }
  const item = databaseItemById(workspace, change.itemId);
  const source = item && dataSourceById(workspace, item.sourceId);
  const property = source?.properties.find(entry => entry.id === change.propertyId);
  const page = item && workspace.pages.find(entry => entry.id === item.pageId);
  const owner = source?.ownerPageId && workspace.pages.find(entry => entry.id === source.ownerPageId);
  if (!item || property?.type !== "status" || item.trashedAt || item.locked || source.trashedAt || source.locked
    || !page || page.trashedAt || page.settings?.locked || isPageArchived(workspace, page.id)
    || source.ownerPageId && (!owner || owner.trashedAt || owner.settings?.locked || isPageArchived(workspace, owner.id))) {
    return { workspace, reason: "记录或所在数据库无法编辑。" };
  }
  const current = resolveStatusValue(item, property);
  const value = change.value;
  if (current === value && item.values?.[property.id] === value) return { workspace };
  if (current !== change.expectedStatus) return { workspace, reason: "记录状态已经变化，请重新查看。" };
  if (value !== null && !property.options?.some(entry => entry.id === value)) return { workspace, reason: "目标状态已移除。" };

  const saveStatus = () => ({
    ...workspace,
    databaseItems: workspace.databaseItems.map(entry => entry.id === item.id
      ? updateDatabaseItemValue(entry, property.id, value, change.now) : entry),
  });
  // Storing the effective default or an explicit blank does not transition status.
  if (current === value) return { workspace: saveStatus() };

  const action = property.config?.statusAction ?? null;
  const triggers = action?.optionId === value;
  const actionEdited = (triggers || change.expectedAction?.optionId === value) && stableJson(action) !== stableJson(change.expectedAction);
  if (actionEdited) return { workspace, reason: "状态动作已修改，请重新查看。" };

  const recurring = applyTaskRecurrence(workspace, change);
  if (recurring.handled && recurring.workspace === workspace) return recurring;
  const next = recurring.handled ? recurring.workspace : saveStatus();
  const recurringItem = recurring.handled && databaseItemById(next, item.id);
  const receipt = recurringItem?.recurrenceReceipts?.at(-1);
  if (!triggers) return { workspace: next, receipt };
  try {
    const applied = executeDatabaseAction(next, {
      action: action.action, sourceItemId: item.id, operationId: change.operationId, now: change.now,
    });
    return applied.updatedItemIds
      ? { workspace: applied.workspace, receipt, updatedItemIds: applied.updatedItemIds }
      : { workspace: applied.workspace, receipt, newRecord: applied.item };
  } catch (error) {
    return { workspace, reason: error instanceof Error ? error.message : "状态动作执行失败。" };
  }
}

export function applyStatusChanges(workspace, commands) {
  const failures = [];
  let applied = 0;
  let next = workspace;
  for (const command of commands) {
    const result = applyStatusChange(next, command);
    if (result.reason) failures.push(result.reason);
    if (result.workspace !== next) applied++;
    next = result.workspace;
  }
  return { workspace: next, failures, applied };
}
