import { BACKUP_COLLECTIONS, requiredCollections } from "./format.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const reservedFields = new Set([...BACKUP_COLLECTIONS, "schemaVersion", "workspaceId", "savedAt", "ui"]);

export const jsonBytes = (value) => encoder.encode(JSON.stringify(value, null, 2));
export const parseJsonBytes = (bytes) => JSON.parse(decoder.decode(bytes));

export function parseJsonl(bytes, filePath = "JSONL") {
  const text = decoder.decode(bytes);
  if (!text) return [];
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  const ids = new Set();
  return lines.map((line, index) => {
    let entity;
    try { entity = JSON.parse(line); } catch { throw new Error(`${filePath}:${index + 1} 不是有效 JSON`); }
    if (!entity || Array.isArray(entity) || typeof entity !== "object" || typeof entity.id !== "string" || !entity.id) {
      throw new Error(`${filePath}:${index + 1} 缺少字符串 id`);
    }
    if (ids.has(entity.id)) throw new Error(`${filePath}:${index + 1} 含重复 id`);
    ids.add(entity.id);
    return entity;
  });
}

export function readCollectionOrder(meta, collections) {
  if (!Object.hasOwn(meta, "collectionOrder")) return null;
  const order = meta.collectionOrder;
  if (!order || typeof order !== "object" || Array.isArray(order)) throw new Error("工作区集合顺序必须是对象");
  for (const collection of Object.keys(order)) {
    if (!collections.includes(collection)) throw new Error(`工作区集合顺序包含未知集合 ${collection}`);
  }
  for (const collection of collections) {
    if (!Object.hasOwn(order, collection)) throw new Error(`工作区集合顺序缺少 ${collection}`);
    const ids = order[collection];
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string" || !id)) throw new Error(`集合 ${collection} 的顺序 ID 无效`);
    if (new Set(ids).size !== ids.length) throw new Error(`集合 ${collection} 的顺序包含重复 ID`);
  }
  return order;
}

export function restoreCollectionOrder(entities, ids, collection) {
  if (ids === undefined) return entities;
  if (ids.length !== entities.length) throw new Error(`集合 ${collection} 的顺序与实体数量不符`);
  const entries = new Map(entities.map((entity) => [entity.id, entity]));
  return ids.map((id) => {
    if (!entries.has(id)) throw new Error(`集合 ${collection} 的顺序包含未知 ID`);
    return entries.get(id);
  });
}

export function workspaceToFiles(workspace) {
  const extras = Object.fromEntries(Object.entries(workspace).filter(([key]) => !reservedFields.has(key)));
  const collections = requiredCollections(workspace.schemaVersion);
  const collectionOrder = Object.fromEntries(collections.map((collection) => [collection, (workspace[collection] ?? []).map((entity) => entity.id)]));
  const files = [{ path: "workspace/meta.json", bytes: jsonBytes({
    schemaVersion: workspace.schemaVersion,
    workspaceId: workspace.workspaceId,
    savedAt: workspace.savedAt,
    ui: workspace.ui ?? {},
    extras,
    collectionOrder,
  }) }];
  for (const collection of collections) {
    const entities = [...(workspace[collection] ?? [])].sort((left, right) => String(left.id) < String(right.id) ? -1 : String(left.id) > String(right.id) ? 1 : 0);
    files.push({ path: `workspace/entities/${collection}.jsonl`, bytes: encoder.encode(entities.map((entity) => JSON.stringify(entity) + "\n").join("")) });
  }
  return files;
}

export function filesToWorkspace(readFile) {
  const meta = parseJsonBytes(readFile("workspace/meta.json"));
  if (!meta || Array.isArray(meta) || typeof meta !== "object") throw new Error("工作区元数据无效");
  const extras = meta.extras && typeof meta.extras === "object" && !Array.isArray(meta.extras) ? meta.extras : {};
  const workspace = { ...extras, schemaVersion: meta.schemaVersion, workspaceId: meta.workspaceId, savedAt: meta.savedAt, ui: meta.ui ?? {} };
  const required = requiredCollections(meta.schemaVersion);
  const order = readCollectionOrder(meta, required);
  for (const collection of BACKUP_COLLECTIONS) {
    const filePath = `workspace/entities/${collection}.jsonl`;
    const bytes = readFile(filePath);
    if (bytes == null && required.includes(collection)) throw new Error(`缺少 ${filePath}`);
    const entities = bytes == null ? [] : parseJsonl(bytes, filePath);
    workspace[collection] = restoreCollectionOrder(entities, order?.[collection], collection);
  }
  return workspace;
}
