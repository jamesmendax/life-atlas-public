import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { BACKUP_COLLECTIONS, requiredCollections } from "../../../src/backup/format.js";
import { CURRENT_SCHEMA_VERSION } from "../../../src/persistence/migrations.js";
import { isPlainObject, isNonEmptyString } from "../ipc/validate.js";
import { assertPhysicalPath } from "./dataRoot.js";

export const MAX_ENTITY_BYTES = 20 * 1024 * 1024;
const COLLECTIONS = new Set(BACKUP_COLLECTIONS);
const CORE_FIELDS = new Set([...BACKUP_COLLECTIONS, "schemaVersion", "workspaceId", "savedAt", "ui"]);

export class StorageError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "StorageError";
    this.code = code;
  }
}

function corrupt(message) {
  return new StorageError("E_CORRUPT", message);
}

function invalid(message) {
  return new StorageError("E_INVALID_ARGUMENT", message);
}

function parseJson(value, label, code = "E_CORRUPT") {
  try {
    return JSON.parse(value);
  } catch {
    throw new StorageError(code, `${label}的 JSON 无效`);
  }
}

function serialize(value, label) {
  try {
    const json = JSON.stringify(value);
    if (typeof json !== "string") throw invalid(`${label}无法序列化`);
    return json;
  } catch (error) {
    if (error instanceof StorageError) throw error;
    throw invalid(`${label}无法序列化`);
  }
}

function validateEntity(collection, id, json, code = "E_INVALID_ARGUMENT") {
  const reject = (message) => { throw new StorageError(code, message); };
  if (!COLLECTIONS.has(collection) || !isNonEmptyString(id, 200)) reject("实体集合或 ID 无效");
  if (typeof json !== "string" || Buffer.byteLength(json, "utf8") > MAX_ENTITY_BYTES) reject("单个实体不能超过 20 MB");
  const entity = parseJson(json, "实体", code);
  if (!isPlainObject(entity) || entity.id !== id) reject("实体必须是对象，且 ID 必须一致");
  return entity;
}

function transaction(db, operation) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = operation();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    throw error;
  }
}

function coreMeta(workspace, generation) {
  if (!isPlainObject(workspace) || !Number.isSafeInteger(workspace.schemaVersion) || workspace.schemaVersion < 1 || !isPlainObject(workspace.ui)) throw invalid("工作区元数据无效");
  if (workspace.workspaceId !== undefined && !isNonEmptyString(workspace.workspaceId, 200)) throw invalid("工作区 ID 无效");
  if (!isNonEmptyString(generation, 200)) throw invalid("工作区代次无效");
  const extras = Object.fromEntries(Object.entries(workspace).filter(([key]) => !CORE_FIELDS.has(key)));
  return new Map([
    ["schemaVersion", serialize(workspace.schemaVersion, "版本")],
    ["workspaceId", serialize(workspace.workspaceId ?? null, "工作区 ID")],
    ...(Object.prototype.hasOwnProperty.call(workspace, "savedAt") ? [["savedAt", serialize(workspace.savedAt, "保存时间")]] : []),
    ["ui", serialize(workspace.ui, "工作区设置")],
    ["generation", serialize(generation, "工作区代次")],
    ["extras", serialize(extras, "附加字段")],
    ["collectionOrder", serialize(Object.fromEntries(BACKUP_COLLECTIONS.map((collection) => [collection, (workspace[collection] || []).map((entity) => entity.id)])), "集合顺序")],
  ]);
}

function workspaceEntities(workspace) {
  const entities = new Map();
  for (const collection of BACKUP_COLLECTIONS) {
    const values = workspace[collection];
    if (values === undefined && !requiredCollections(workspace.schemaVersion).includes(collection)) continue;
    if (!Array.isArray(values)) throw invalid(`集合 ${collection} 必须是数组`);
    const entries = new Map();
    for (const entity of values) {
      const json = serialize(entity, "实体");
      validateEntity(collection, entity?.id, json);
      if (entries.has(entity.id)) throw invalid("同一集合不能出现重复 ID");
      entries.set(entity.id, json);
    }
    entities.set(collection, entries);
  }
  return entities;
}

export function validateWorkspaceSnapshot(workspace) {
  // The restore path assigns its own generation when it initializes SQLite.
  coreMeta(workspace, "snapshot-validation");
  workspaceEntities(workspace);
}

function writeMeta(db, entries) {
  const statement = db.prepare("INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value");
  for (const [key, value] of entries) statement.run(key, value);
}

function writeEntities(db, entries, now) {
  const statement = db.prepare("INSERT INTO entities(collection, id, json, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(collection, id) DO UPDATE SET json=excluded.json, updated_at=excluded.updated_at");
  for (const [collection, entities] of entries) {
    for (const [id, json] of entities) {
      const entity = JSON.parse(json);
      statement.run(collection, id, json, typeof entity.updatedAt === "string" ? entity.updatedAt : now);
    }
  }
}

export function openWorkspaceDatabase(file, { readOnly = false, immutable } = {}) {
  const filePath = assertPhysicalPath(file, { allowMissing: !readOnly });
  if (!readOnly) fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const walPath = `${filePath}-wal`;
  if (readOnly && fs.existsSync(walPath)) assertPhysicalPath(walPath, { root: path.dirname(filePath), allowMissing: false });
  const useImmutable = readOnly && (immutable ?? (!fs.existsSync(walPath) || fs.statSync(walPath).size === 0));
  const db = new DatabaseSync(useImmutable ? `${pathToFileURL(filePath).href}?immutable=1` : filePath, { readOnly });
  try {
    db.exec("PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;");
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

export function quickCheck(db) {
  try {
    const problems = db.prepare("PRAGMA quick_check").all().map((row) => Object.values(row)[0]);
    return problems.length === 1 && problems[0] === "ok" ? "ok" : problems.join("; ") || "数据库检查没有返回结果";
  } catch (error) {
    return error.message;
  }
}

export function prepareWritable(db) {
  db.exec(`PRAGMA journal_mode=WAL;
    PRAGMA synchronous=FULL;
    CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS entities(collection TEXT NOT NULL, id TEXT NOT NULL, json TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(collection, id)) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS assets(sha256 TEXT PRIMARY KEY, size INTEGER NOT NULL, mime TEXT NOT NULL, original_name TEXT, created_at TEXT NOT NULL);`);
}

export function readAllRows(db) {
  try {
    const meta = new Map();
    for (const row of db.prepare("SELECT key, value FROM meta").all()) {
      if (typeof row.key !== "string" || typeof row.value !== "string" || meta.has(row.key)) throw corrupt("数据库元数据无效");
      meta.set(row.key, row.value);
    }
    const entities = new Map(BACKUP_COLLECTIONS.map((collection) => [collection, new Map()]));
    for (const row of db.prepare("SELECT collection, id, json FROM entities").all()) {
      const collection = entities.get(row.collection);
      if (!collection || collection.has(row.id)) throw corrupt("数据库实体集合无效");
      if (!isNonEmptyString(row.id, 200) || typeof row.json !== "string") throw corrupt("数据库实体无效");
      collection.set(row.id, row.json);
    }
    if (meta.has("collectionOrder")) {
      const order = parseJson(meta.get("collectionOrder"), "集合顺序");
      if (!isPlainObject(order)) throw corrupt("集合顺序无效");
      for (const [collection, ids] of Object.entries(order)) {
        const values = entities.get(collection);
        if (!values || !Array.isArray(ids) || new Set(ids).size !== ids.length || ids.length !== values.size || ids.some((id) => !isNonEmptyString(id, 200) || !values.has(id))) throw corrupt("集合顺序与数据库内容不一致");
        entities.set(collection, new Map(ids.map((id) => [id, values.get(id)])));
      }
    }
    return { meta, entities };
  } catch (error) {
    if (error instanceof StorageError) throw error;
    throw corrupt("数据库数据无法读取");
  }
}

export function assembleWorkspace(rows) {
  const parsed = new Map([...rows.meta].map(([key, value]) => [key, parseJson(value, `元数据 ${key}`)]));
  const schemaVersion = parsed.get("schemaVersion");
  if (!Number.isSafeInteger(schemaVersion) || schemaVersion < 1 || !isPlainObject(parsed.get("ui"))) throw corrupt("工作区元数据无效");
  if (!isNonEmptyString(parsed.get("generation"), 200)) throw corrupt("工作区代次无效");
  const workspaceId = parsed.get("workspaceId");
  if (workspaceId !== null && workspaceId !== undefined && !isNonEmptyString(workspaceId, 200)) throw corrupt("工作区 ID 无效");
  const extras = parsed.get("extras") ?? {};
  if (!isPlainObject(extras) || Object.keys(extras).some((key) => CORE_FIELDS.has(key))) throw corrupt("工作区附加字段无效");
  const workspace = { ...extras, schemaVersion };
  if (parsed.has("savedAt")) workspace.savedAt = parsed.get("savedAt");
  if (workspaceId !== null && workspaceId !== undefined) workspace.workspaceId = workspaceId;
  for (const collection of BACKUP_COLLECTIONS) {
    const values = rows.entities.get(collection) || new Map();
    if (values.size || requiredCollections(schemaVersion).includes(collection)) workspace[collection] = [...values].map(([id, json]) => validateEntity(collection, id, json, "E_CORRUPT"));
  }
  workspace.ui = parsed.get("ui");
  return workspace;
}

export function initializeWorkspace(db, workspace, { generation, now }) {
  const meta = coreMeta(workspace, generation);
  const entities = workspaceEntities(workspace);
  if (db.prepare("SELECT COUNT(*) AS count FROM entities").get().count || db.prepare("SELECT COUNT(*) AS count FROM meta").get().count) throw invalid("只能初始化空数据库");
  transaction(db, () => {
    writeMeta(db, meta);
    writeEntities(db, entities, now);
  });
}

// Capture these before any workspace callback can install inspection/Map hooks.
const WORKSPACE_DIFF_GET_DESCRIPTOR = Object.getOwnPropertyDescriptor;
const WORKSPACE_DIFF_GET_PROTOTYPE = Object.getPrototypeOf;
const WORKSPACE_DIFF_OWN_KEYS = Reflect.ownKeys;
const WORKSPACE_DIFF_HAS_OWN = Object.hasOwn;
const WORKSPACE_DIFF_OBJECT_PROTOTYPE = Object.prototype;
const WORKSPACE_DIFF_MAP_PROTOTYPE = Map.prototype;
const WORKSPACE_DIFF_MAP_GET = WORKSPACE_DIFF_GET_DESCRIPTOR(WORKSPACE_DIFF_MAP_PROTOTYPE, "get")?.value;
const WORKSPACE_DIFF_READ_MAP = Function.prototype.call.bind(WORKSPACE_DIFF_MAP_GET);
const WORKSPACE_DIFF_TYPES = process.getBuiltinModule?.("util")?.types;
const WORKSPACE_DIFF_IS_PROXY = WORKSPACE_DIFF_TYPES?.isProxy;
const WORKSPACE_DIFF_IS_MAP = WORKSPACE_DIFF_TYPES?.isMap;

export function writeWorkspaceDiff(db, rows, workspace, { now }) {
  const generation = parseJson(rows.meta.get("generation"), "工作区代次");
  const meta = coreMeta(workspace, generation);
  // Reuse retained JSON strings as hints without invoking caller-owned getters
  // or Map overrides. Exotic rows retain the original serialization boundary.
  const getDescriptor = WORKSPACE_DIFF_GET_DESCRIPTOR(WORKSPACE_DIFF_MAP_PROTOTYPE, "get");
  const nativeGet = getDescriptor && WORKSPACE_DIFF_HAS_OWN(getDescriptor, "value") ? getDescriptor.value : null;
  const canInspect = typeof WORKSPACE_DIFF_IS_PROXY === "function" && typeof WORKSPACE_DIFF_IS_MAP === "function";
  const plainMap = (value) => canInspect && !WORKSPACE_DIFF_IS_PROXY(value) && WORKSPACE_DIFF_IS_MAP(value)
    && WORKSPACE_DIFF_GET_PROTOTYPE(value) === WORKSPACE_DIFF_MAP_PROTOTYPE && WORKSPACE_DIFF_OWN_KEYS(value).length === 0;
  let retainedEntities;
  if (canInspect && typeof nativeGet === "function" && nativeGet === WORKSPACE_DIFF_MAP_GET && !WORKSPACE_DIFF_IS_PROXY(rows)
    && (WORKSPACE_DIFF_GET_PROTOTYPE(rows) === WORKSPACE_DIFF_OBJECT_PROTOTYPE || WORKSPACE_DIFF_GET_PROTOTYPE(rows) === null)) {
    const entitiesDescriptor = WORKSPACE_DIFF_GET_DESCRIPTOR(rows, "entities");
    const metaDescriptor = WORKSPACE_DIFF_GET_DESCRIPTOR(rows, "meta");
    if (entitiesDescriptor && WORKSPACE_DIFF_HAS_OWN(entitiesDescriptor, "value") && plainMap(entitiesDescriptor.value)
      && metaDescriptor && WORKSPACE_DIFF_HAS_OWN(metaDescriptor, "value") && plainMap(metaDescriptor.value)) {
      const retained = entitiesDescriptor.value;
      let ordinary = true;
      for (let collectionIndex = 0; collectionIndex < BACKUP_COLLECTIONS.length; collectionIndex += 1) {
        const collection = BACKUP_COLLECTIONS[collectionIndex];
        const previous = WORKSPACE_DIFF_READ_MAP(retained, collection);
        if (previous !== undefined && !plainMap(previous)) { ordinary = false; break; }
      }
      if (ordinary) retainedEntities = retained;
    }
  }
  let next;
  if (!retainedEntities) {
    next = workspaceEntities(workspace);
  } else {
    next = new Map();
    for (const collection of BACKUP_COLLECTIONS) {
      const values = workspace[collection];
      if (values === undefined && !requiredCollections(workspace.schemaVersion).includes(collection)) continue;
      if (!Array.isArray(values)) throw invalid(`集合 ${collection} 必须是数组`);
      const previous = WORKSPACE_DIFF_READ_MAP(retainedEntities, collection);
      const borrow = WORKSPACE_DIFF_IS_MAP(previous) && !WORKSPACE_DIFF_IS_PROXY(previous);
      const entries = new Map();
      for (const entity of values) {
        const json = serialize(entity, "实体");
        validateEntity(collection, entity?.id, json);
        if (entries.has(entity.id)) throw invalid("同一集合不能出现重复 ID");
        const id = entity.id;
        const retainedJson = borrow ? WORKSPACE_DIFF_READ_MAP(previous, id) : undefined;
        entries.set(id, retainedJson === json ? retainedJson : json);
      }
      next.set(collection, entries);
    }
  }
  // Compare at the original point: a later toJSON/ID getter can replace rows or
  // change earlier Maps. Each candidate still represents its serialized value.
  const changed = new Map();
  const removed = [];
  for (const collection of BACKUP_COLLECTIONS) {
    const previous = rows.entities.get(collection) || new Map();
    const following = next.get(collection) || new Map();
    const changedCollection = new Map([...following].filter(([id, json]) => previous.get(id) !== json));
    if (changedCollection.size) changed.set(collection, changedCollection);
    for (const id of previous.keys()) if (!following.has(id)) removed.push({ collection, id });
  }
  const changedMeta = new Map([...meta].filter(([key, value]) => rows.meta.get(key) !== value));
  if (!changed.size && !removed.length && !changedMeta.size) return { changed: false, savedAt: workspace.savedAt };
  changedMeta.set("savedAt", serialize(now, "保存时间"));
  transaction(db, () => {
    writeEntities(db, changed, now);
    const remove = db.prepare("DELETE FROM entities WHERE collection=? AND id=?");
    for (const entry of removed) remove.run(entry.collection, entry.id);
    writeMeta(db, changedMeta);
  });
  return { changed: true, savedAt: now };
}

export function validateChangeset(changeset, { currentSchemaVersion = CURRENT_SCHEMA_VERSION } = {}) {
  if (!isPlainObject(changeset) || !isNonEmptyString(changeset.generation, 200) || !Number.isSafeInteger(changeset.schemaVersion) || changeset.schemaVersion < 1 || changeset.schemaVersion > currentSchemaVersion) throw invalid("保存批次元数据无效");
  if (!Array.isArray(changeset.upserts) || !Array.isArray(changeset.deletes) || changeset.ui !== null && !isPlainObject(changeset.ui)) throw invalid("保存批次格式无效");
  const touched = new Set();
  for (const entry of changeset.upserts) {
    if (!isPlainObject(entry)) throw invalid("实体格式无效");
    validateEntity(entry.collection, entry.id, entry.json);
    const key = `${entry.collection}\0${entry.id}`;
    if (touched.has(key)) throw invalid("一个批次不能重复操作同一实体");
    touched.add(key);
  }
  for (const entry of changeset.deletes) {
    if (!isPlainObject(entry) || !COLLECTIONS.has(entry.collection) || !isNonEmptyString(entry.id, 200)) throw invalid("删除条目无效");
    const key = `${entry.collection}\0${entry.id}`;
    if (touched.has(key)) throw invalid("一个批次不能重复操作同一实体");
    touched.add(key);
  }
  if (changeset.ui !== null) serialize(changeset.ui, "工作区设置");
  return changeset;
}

export function applyChangeset(db, changeset, { now, expectedGeneration, currentSchemaVersion = CURRENT_SCHEMA_VERSION }) {
  validateChangeset(changeset, { currentSchemaVersion });
  if (changeset.generation !== expectedGeneration) throw new StorageError("E_CONFLICT", "工作区已被恢复，请重新打开后再编辑");
  return transaction(db, () => {
    const currentGeneration = parseJson(db.prepare("SELECT value FROM meta WHERE key='generation'").get()?.value, "工作区代次");
    if (changeset.generation !== currentGeneration) throw new StorageError("E_CONFLICT", "工作区已被恢复，请重新打开后再编辑");
    const previousSchema = parseJson(db.prepare("SELECT value FROM meta WHERE key='schemaVersion'").get()?.value, "工作区版本");
    if (changeset.schemaVersion < previousSchema) throw new StorageError("E_CONFLICT", "不能使用旧版本覆盖工作区");
    const existingOrderJson = db.prepare("SELECT value FROM meta WHERE key='collectionOrder'").get()?.value;
    const existingOrder = existingOrderJson ? parseJson(existingOrderJson, "集合顺序") : Object.fromEntries([...readAllRows(db).entities].map(([collection, values]) => [collection, [...values.keys()]]));
    const entries = new Map();
    for (const entry of changeset.upserts) {
      if (!entries.has(entry.collection)) entries.set(entry.collection, new Map());
      entries.get(entry.collection).set(entry.id, entry.json);
    }
    writeEntities(db, entries, now);
    const remove = db.prepare("DELETE FROM entities WHERE collection=? AND id=?");
    for (const entry of changeset.deletes) remove.run(entry.collection, entry.id);
    const meta = new Map([["savedAt", serialize(now, "保存时间")], ["schemaVersion", serialize(changeset.schemaVersion, "版本")]]);
    if (changeset.ui !== null) meta.set("ui", serialize(changeset.ui, "工作区设置"));
    const touchedCollections = new Set([...changeset.upserts, ...changeset.deletes].map((entry) => entry.collection));
    const order = { ...existingOrder };
    for (const collection of touchedCollections) {
      const upsertIds = changeset.upserts.filter((entry) => entry.collection === collection).map((entry) => entry.id);
      const deleted = new Set(changeset.deletes.filter((entry) => entry.collection === collection).map((entry) => entry.id));
      const retained = (order[collection] || []).filter((id) => !deleted.has(id));
      const already = new Set(retained);
      const added = upsertIds.filter((id) => !already.has(id));
      const live = new Set([...retained, ...added]);
      if (upsertIds.length === live.size && upsertIds.every((id) => live.has(id))) order[collection] = upsertIds;
      else order[collection] = [...retained, ...added];
    }
    const orderJson = serialize(order, "集合顺序");
    if (orderJson !== existingOrderJson) meta.set("collectionOrder", orderJson);
    writeMeta(db, meta);
    return { savedAt: now };
  });
}

export function replaceDatabaseWorkspace(db, workspace, { generation, now }) {
  const meta = coreMeta(workspace, generation);
  const entities = workspaceEntities(workspace);
  transaction(db, () => {
    db.exec("DELETE FROM entities");
    if (!meta.has("savedAt")) db.prepare("DELETE FROM meta WHERE key='savedAt'").run();
    writeEntities(db, entities, now);
    writeMeta(db, meta);
  });
  return { savedAt: workspace.savedAt, generation };
}

function validateAssetRow(row) {
  if (!isPlainObject(row) || !/^[a-f0-9]{64}$/.test(row.sha256 ?? "") || !Number.isSafeInteger(row.size) || row.size < 0
    || typeof row.mime !== "string" || row.mime.length > 200 || /[\r\n\0]/.test(row.mime)
    || row.originalName !== null && (typeof row.originalName !== "string" || row.originalName.length > 255 || /[\r\n\0]/.test(row.originalName))
    || !["string", "number"].includes(typeof row.createdAt)) throw new StorageError("E_CORRUPT", "附件元数据无效");
  return row;
}

export function readAssetRows(db) {
  if (!db) throw new StorageError("E_IO", "附件数据库尚未就绪");
  return db.prepare("SELECT sha256, size, mime, original_name, created_at FROM assets").all().map((row) => validateAssetRow({ sha256: row.sha256, size: row.size, mime: row.mime, originalName: row.original_name, createdAt: row.created_at }));
}

export function deleteAssetRows(db, sha256s) {
  if (!Array.isArray(sha256s) || sha256s.some((sha256) => typeof sha256 !== "string" || !/^[a-f0-9]{64}$/.test(sha256))) throw invalid("附件标识无效");
  return transaction(db, () => {
    const statement = db.prepare("DELETE FROM assets WHERE sha256=?");
    return sha256s.reduce((count, sha256) => count + Number(statement.run(sha256).changes), 0);
  });
}

export function restoreAssetRows(db, rows) {
  if (!Array.isArray(rows)) throw invalid("附件元数据无效");
  rows.forEach(validateAssetRow);
  return transaction(db, () => {
    const existing = db.prepare("SELECT size FROM assets WHERE sha256=?");
    const statement = db.prepare("INSERT OR IGNORE INTO assets(sha256, size, mime, original_name, created_at) VALUES (?, ?, ?, ?, ?)");
    for (const row of rows) {
      const previous = existing.get(row.sha256);
      if (previous && previous.size !== row.size) throw new StorageError("E_CORRUPT", "现有附件元数据与回收站不一致");
      statement.run(row.sha256, row.size, row.mime, row.originalName, row.createdAt);
    }
  });
}

export function vacuumInto(db, targetFile) {
  const target = assertPhysicalPath(targetFile);
  if (fs.existsSync(target)) throw invalid("快照目标文件已存在");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  db.prepare("VACUUM INTO ?").run(target);
  return target;
}
