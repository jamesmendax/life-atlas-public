import { copyJson, newEntityId } from "../domain/blockDocument.js";
import { checkWorkspaceIntegrity } from "../domain/integrity.js";

function collectIds(value, ids) {
  if (Array.isArray(value)) for (const entry of value) collectIds(entry, ids);
  else if (value && typeof value === "object") for (const [key, entry] of Object.entries(value)) {
    if (["id", "tabId"].includes(key) && typeof entry === "string") ids.add(entry);
    else collectIds(entry, ids);
  }
}

export function instantiateTemplate(workspace, template, { now = Date.now(), idFactory = newEntityId, projectName = "新项目", folderId, includeSampleData = true } = {}) {
  if (typeof template?.build !== "function") throw new TypeError("模板不可用");
  const name = String(projectName).trim();
  if (!name || name.length > 100) throw new TypeError("项目名称须为 1–100 个字符");
  if (!(workspace.folders || []).some((folder) => folder.id === folderId && !folder.trashedAt)) throw new TypeError("请选择可用的文件夹");
  if (!Number.isFinite(new Date(now).getTime())) throw new TypeError("日期无效");
  const usedIds = new Set();
  collectIds(workspace, usedIds);
  const allocate = (prefix) => {
    const id = idFactory(prefix);
    if (typeof id !== "string" || !id || usedIds.has(id)) throw new Error("模板 ID 必须是全新且唯一的字符串");
    usedIds.add(id);
    return id;
  };
  const built = template.build({ now, idFactory: allocate, projectName: name, folderId, includeSampleData: Boolean(includeSampleData) });
  const next = copyJson(workspace);
  for (const collection of ["pages", "dataSources", "databaseViews", "databaseItems", "relations"]) {
    if (!Array.isArray(built?.[collection])) throw new Error(`模板缺少 ${collection}`);
    next[collection] = [...(next[collection] || []), ...copyJson(built[collection])];
  }
  const integrity = checkWorkspaceIntegrity(next);
  if (!integrity.ok) throw new Error(`模板完整性检查失败：${integrity.problems.filter((problem) => problem.severity === "error").map((problem) => problem.code).join("、")}`);
  if (!built.pages[0]?.id) throw new Error("模板没有项目页面");
  return { workspace: next, rootPageId: built.pages[0].id };
}
