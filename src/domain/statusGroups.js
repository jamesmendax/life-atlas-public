import { copyJson } from "./blockDocument.js";

export const STATUS_GROUPS = ["todo", "inProgress", "complete"];

export function statusOptionGroup(option) {
  if (STATUS_GROUPS.includes(option?.group)) return option.group;
  if (option?.id === "done" || String(option?.name || "").includes("完成")) return "complete";
  if (option?.id === "doing" || String(option?.name || "").includes("进行")) return "inProgress";
  return "todo";
}

export function statusDefaultOptionId(property) {
  const id = property?.config?.defaultOptionId;
  return property?.type === "status" && id && property.options?.some(option => option.id === id) ? id : null;
}

export function resolveStatusValue(item, property) {
  if (!item) return null;
  if (!Object.hasOwn(item.values ?? {}, property.id)) return statusDefaultOptionId(property);
  const value = item.values[property.id];
  return property.options?.some(option => option.id === value) ? value : null;
}

export function migrateStatusGroups(input) {
  const workspace = copyJson(input || {});
  if (Number(workspace.schemaVersion) >= 13) return workspace;
  for (const source of workspace.dataSources || []) {
    for (const property of source.properties || []) {
      if (property.type === "status" && Array.isArray(property.options)) property.options = property.options.map((option) => ({ ...option, group: statusOptionGroup(option) }));
    }
  }
  workspace.schemaVersion = 13;
  return workspace;
}
