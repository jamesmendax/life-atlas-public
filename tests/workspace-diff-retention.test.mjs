import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";
import { types as utilTypes } from "node:util";
import { fullWorkspace, FIXTURE_TIME } from "./fixtures/full-workspace.mjs";
import { upgradeWorkspace } from "../src/persistence/migrations.js";
import { createPageVersion } from "../src/domain/pageHistory.js";
import { BACKUP_COLLECTIONS } from "../src/backup/format.js";
import * as currentDb from "../electron/main/storage/workspaceDb.js";
import { createIsolatedDirectory, removeIsolatedDirectory } from "./desktop/helpers.mjs";

const NEXT_TIME = "2026-10-01T08:00:01.000Z";
const MAP_GET = Map.prototype.get;
const GET_DESCRIPTOR = Object.getOwnPropertyDescriptor;
const DEFINE_PROPERTY = Object.defineProperty;

// Exact UTF-8 source from the parent's pre-repair snapshot. Other storage
// dependencies are shared and unchanged; ignored QA files are not required.
const FROZEN_DB = {
  sha256: "BDE83C039DF69CDDDB063B75814E5DE7641FDBBCA505B8160D5843CB64B7A351",
  source: "import fs from \"node:fs\";\nimport path from \"node:path\";\nimport { DatabaseSync } from \"node:sqlite\";\nimport { pathToFileURL } from \"node:url\";\nimport { BACKUP_COLLECTIONS, requiredCollections } from \"../../../src/backup/format.js\";\nimport { CURRENT_SCHEMA_VERSION } from \"../../../src/persistence/migrations.js\";\nimport { isPlainObject, isNonEmptyString } from \"../ipc/validate.js\";\nimport { assertPhysicalPath } from \"./dataRoot.js\";\n\nexport const MAX_ENTITY_BYTES = 20 * 1024 * 1024;\nconst COLLECTIONS = new Set(BACKUP_COLLECTIONS);\nconst CORE_FIELDS = new Set([...BACKUP_COLLECTIONS, \"schemaVersion\", \"workspaceId\", \"savedAt\", \"ui\"]);\n\nexport class StorageError extends Error {\n  constructor(code, message) {\n    super(message);\n    this.name = \"StorageError\";\n    this.code = code;\n  }\n}\n\nfunction corrupt(message) {\n  return new StorageError(\"E_CORRUPT\", message);\n}\n\nfunction invalid(message) {\n  return new StorageError(\"E_INVALID_ARGUMENT\", message);\n}\n\nfunction parseJson(value, label, code = \"E_CORRUPT\") {\n  try {\n    return JSON.parse(value);\n  } catch {\n    throw new StorageError(code, `${label}的 JSON 无效`);\n  }\n}\n\nfunction serialize(value, label) {\n  try {\n    const json = JSON.stringify(value);\n    if (typeof json !== \"string\") throw invalid(`${label}无法序列化`);\n    return json;\n  } catch (error) {\n    if (error instanceof StorageError) throw error;\n    throw invalid(`${label}无法序列化`);\n  }\n}\n\nfunction validateEntity(collection, id, json, code = \"E_INVALID_ARGUMENT\") {\n  const reject = (message) => { throw new StorageError(code, message); };\n  if (!COLLECTIONS.has(collection) || !isNonEmptyString(id, 200)) reject(\"实体集合或 ID 无效\");\n  if (typeof json !== \"string\" || Buffer.byteLength(json, \"utf8\") > MAX_ENTITY_BYTES) reject(\"单个实体不能超过 20 MB\");\n  const entity = parseJson(json, \"实体\", code);\n  if (!isPlainObject(entity) || entity.id !== id) reject(\"实体必须是对象，且 ID 必须一致\");\n  return entity;\n}\n\nfunction transaction(db, operation) {\n  db.exec(\"BEGIN IMMEDIATE\");\n  try {\n    const result = operation();\n    db.exec(\"COMMIT\");\n    return result;\n  } catch (error) {\n    try { db.exec(\"ROLLBACK\"); } catch {}\n    throw error;\n  }\n}\n\nfunction coreMeta(workspace, generation) {\n  if (!isPlainObject(workspace) || !Number.isSafeInteger(workspace.schemaVersion) || workspace.schemaVersion < 1 || !isPlainObject(workspace.ui)) throw invalid(\"工作区元数据无效\");\n  if (workspace.workspaceId !== undefined && !isNonEmptyString(workspace.workspaceId, 200)) throw invalid(\"工作区 ID 无效\");\n  if (!isNonEmptyString(generation, 200)) throw invalid(\"工作区代次无效\");\n  const extras = Object.fromEntries(Object.entries(workspace).filter(([key]) => !CORE_FIELDS.has(key)));\n  return new Map([\n    [\"schemaVersion\", serialize(workspace.schemaVersion, \"版本\")],\n    [\"workspaceId\", serialize(workspace.workspaceId ?? null, \"工作区 ID\")],\n    ...(Object.prototype.hasOwnProperty.call(workspace, \"savedAt\") ? [[\"savedAt\", serialize(workspace.savedAt, \"保存时间\")]] : []),\n    [\"ui\", serialize(workspace.ui, \"工作区设置\")],\n    [\"generation\", serialize(generation, \"工作区代次\")],\n    [\"extras\", serialize(extras, \"附加字段\")],\n    [\"collectionOrder\", serialize(Object.fromEntries(BACKUP_COLLECTIONS.map((collection) => [collection, (workspace[collection] || []).map((entity) => entity.id)])), \"集合顺序\")],\n  ]);\n}\n\nfunction workspaceEntities(workspace) {\n  const entities = new Map();\n  for (const collection of BACKUP_COLLECTIONS) {\n    const values = workspace[collection];\n    if (values === undefined && !requiredCollections(workspace.schemaVersion).includes(collection)) continue;\n    if (!Array.isArray(values)) throw invalid(`集合 ${collection} 必须是数组`);\n    const entries = new Map();\n    for (const entity of values) {\n      const json = serialize(entity, \"实体\");\n      validateEntity(collection, entity?.id, json);\n      if (entries.has(entity.id)) throw invalid(\"同一集合不能出现重复 ID\");\n      entries.set(entity.id, json);\n    }\n    entities.set(collection, entries);\n  }\n  return entities;\n}\n\nfunction writeMeta(db, entries) {\n  const statement = db.prepare(\"INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value\");\n  for (const [key, value] of entries) statement.run(key, value);\n}\n\nfunction writeEntities(db, entries, now) {\n  const statement = db.prepare(\"INSERT INTO entities(collection, id, json, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(collection, id) DO UPDATE SET json=excluded.json, updated_at=excluded.updated_at\");\n  for (const [collection, entities] of entries) {\n    for (const [id, json] of entities) {\n      const entity = JSON.parse(json);\n      statement.run(collection, id, json, typeof entity.updatedAt === \"string\" ? entity.updatedAt : now);\n    }\n  }\n}\n\nexport function openWorkspaceDatabase(file, { readOnly = false, immutable } = {}) {\n  const filePath = assertPhysicalPath(file, { allowMissing: !readOnly });\n  if (!readOnly) fs.mkdirSync(path.dirname(filePath), { recursive: true });\n  const walPath = `${filePath}-wal`;\n  if (readOnly && fs.existsSync(walPath)) assertPhysicalPath(walPath, { root: path.dirname(filePath), allowMissing: false });\n  const useImmutable = readOnly && (immutable ?? (!fs.existsSync(walPath) || fs.statSync(walPath).size === 0));\n  const db = new DatabaseSync(useImmutable ? `${pathToFileURL(filePath).href}?immutable=1` : filePath, { readOnly });\n  try {\n    db.exec(\"PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;\");\n    return db;\n  } catch (error) {\n    db.close();\n    throw error;\n  }\n}\n\nexport function quickCheck(db) {\n  try {\n    const problems = db.prepare(\"PRAGMA quick_check\").all().map((row) => Object.values(row)[0]);\n    return problems.length === 1 && problems[0] === \"ok\" ? \"ok\" : problems.join(\"; \") || \"数据库检查没有返回结果\";\n  } catch (error) {\n    return error.message;\n  }\n}\n\nexport function prepareWritable(db) {\n  db.exec(`PRAGMA journal_mode=WAL;\n    PRAGMA synchronous=FULL;\n    CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);\n    CREATE TABLE IF NOT EXISTS entities(collection TEXT NOT NULL, id TEXT NOT NULL, json TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(collection, id)) WITHOUT ROWID;\n    CREATE TABLE IF NOT EXISTS assets(sha256 TEXT PRIMARY KEY, size INTEGER NOT NULL, mime TEXT NOT NULL, original_name TEXT, created_at TEXT NOT NULL);`);\n}\n\nexport function readAllRows(db) {\n  try {\n    const meta = new Map();\n    for (const row of db.prepare(\"SELECT key, value FROM meta\").all()) {\n      if (typeof row.key !== \"string\" || typeof row.value !== \"string\" || meta.has(row.key)) throw corrupt(\"数据库元数据无效\");\n      meta.set(row.key, row.value);\n    }\n    const entities = new Map(BACKUP_COLLECTIONS.map((collection) => [collection, new Map()]));\n    for (const row of db.prepare(\"SELECT collection, id, json FROM entities\").all()) {\n      const collection = entities.get(row.collection);\n      if (!collection || collection.has(row.id)) throw corrupt(\"数据库实体集合无效\");\n      if (!isNonEmptyString(row.id, 200) || typeof row.json !== \"string\") throw corrupt(\"数据库实体无效\");\n      collection.set(row.id, row.json);\n    }\n    if (meta.has(\"collectionOrder\")) {\n      const order = parseJson(meta.get(\"collectionOrder\"), \"集合顺序\");\n      if (!isPlainObject(order)) throw corrupt(\"集合顺序无效\");\n      for (const [collection, ids] of Object.entries(order)) {\n        const values = entities.get(collection);\n        if (!values || !Array.isArray(ids) || new Set(ids).size !== ids.length || ids.length !== values.size || ids.some((id) => !isNonEmptyString(id, 200) || !values.has(id))) throw corrupt(\"集合顺序与数据库内容不一致\");\n        entities.set(collection, new Map(ids.map((id) => [id, values.get(id)])));\n      }\n    }\n    return { meta, entities };\n  } catch (error) {\n    if (error instanceof StorageError) throw error;\n    throw corrupt(\"数据库数据无法读取\");\n  }\n}\n\nexport function assembleWorkspace(rows) {\n  const parsed = new Map([...rows.meta].map(([key, value]) => [key, parseJson(value, `元数据 ${key}`)]));\n  const schemaVersion = parsed.get(\"schemaVersion\");\n  if (!Number.isSafeInteger(schemaVersion) || schemaVersion < 1 || !isPlainObject(parsed.get(\"ui\"))) throw corrupt(\"工作区元数据无效\");\n  if (!isNonEmptyString(parsed.get(\"generation\"), 200)) throw corrupt(\"工作区代次无效\");\n  const workspaceId = parsed.get(\"workspaceId\");\n  if (workspaceId !== null && workspaceId !== undefined && !isNonEmptyString(workspaceId, 200)) throw corrupt(\"工作区 ID 无效\");\n  const extras = parsed.get(\"extras\") ?? {};\n  if (!isPlainObject(extras) || Object.keys(extras).some((key) => CORE_FIELDS.has(key))) throw corrupt(\"工作区附加字段无效\");\n  const workspace = { ...extras, schemaVersion };\n  if (parsed.has(\"savedAt\")) workspace.savedAt = parsed.get(\"savedAt\");\n  if (workspaceId !== null && workspaceId !== undefined) workspace.workspaceId = workspaceId;\n  for (const collection of BACKUP_COLLECTIONS) {\n    const values = rows.entities.get(collection) || new Map();\n    if (values.size || requiredCollections(schemaVersion).includes(collection)) workspace[collection] = [...values].map(([id, json]) => validateEntity(collection, id, json, \"E_CORRUPT\"));\n  }\n  workspace.ui = parsed.get(\"ui\");\n  return workspace;\n}\n\nexport function initializeWorkspace(db, workspace, { generation, now }) {\n  const meta = coreMeta(workspace, generation);\n  const entities = workspaceEntities(workspace);\n  if (db.prepare(\"SELECT COUNT(*) AS count FROM entities\").get().count || db.prepare(\"SELECT COUNT(*) AS count FROM meta\").get().count) throw invalid(\"只能初始化空数据库\");\n  transaction(db, () => {\n    writeMeta(db, meta);\n    writeEntities(db, entities, now);\n  });\n}\n\nexport function writeWorkspaceDiff(db, rows, workspace, { now }) {\n  const generation = parseJson(rows.meta.get(\"generation\"), \"工作区代次\");\n  const meta = coreMeta(workspace, generation);\n  const next = workspaceEntities(workspace);\n  const changed = new Map();\n  const removed = [];\n  for (const collection of BACKUP_COLLECTIONS) {\n    const previous = rows.entities.get(collection) || new Map();\n    const following = next.get(collection) || new Map();\n    const changedCollection = new Map([...following].filter(([id, json]) => previous.get(id) !== json));\n    if (changedCollection.size) changed.set(collection, changedCollection);\n    for (const id of previous.keys()) if (!following.has(id)) removed.push({ collection, id });\n  }\n  const changedMeta = new Map([...meta].filter(([key, value]) => rows.meta.get(key) !== value));\n  if (!changed.size && !removed.length && !changedMeta.size) return { changed: false, savedAt: workspace.savedAt };\n  changedMeta.set(\"savedAt\", serialize(now, \"保存时间\"));\n  transaction(db, () => {\n    writeEntities(db, changed, now);\n    const remove = db.prepare(\"DELETE FROM entities WHERE collection=? AND id=?\");\n    for (const entry of removed) remove.run(entry.collection, entry.id);\n    writeMeta(db, changedMeta);\n  });\n  return { changed: true, savedAt: now };\n}\n\nexport function validateChangeset(changeset, { currentSchemaVersion = CURRENT_SCHEMA_VERSION } = {}) {\n  if (!isPlainObject(changeset) || !isNonEmptyString(changeset.generation, 200) || !Number.isSafeInteger(changeset.schemaVersion) || changeset.schemaVersion < 1 || changeset.schemaVersion > currentSchemaVersion) throw invalid(\"保存批次元数据无效\");\n  if (!Array.isArray(changeset.upserts) || !Array.isArray(changeset.deletes) || changeset.ui !== null && !isPlainObject(changeset.ui)) throw invalid(\"保存批次格式无效\");\n  const touched = new Set();\n  for (const entry of changeset.upserts) {\n    if (!isPlainObject(entry)) throw invalid(\"实体格式无效\");\n    validateEntity(entry.collection, entry.id, entry.json);\n    const key = `${entry.collection}\\0${entry.id}`;\n    if (touched.has(key)) throw invalid(\"一个批次不能重复操作同一实体\");\n    touched.add(key);\n  }\n  for (const entry of changeset.deletes) {\n    if (!isPlainObject(entry) || !COLLECTIONS.has(entry.collection) || !isNonEmptyString(entry.id, 200)) throw invalid(\"删除条目无效\");\n    const key = `${entry.collection}\\0${entry.id}`;\n    if (touched.has(key)) throw invalid(\"一个批次不能重复操作同一实体\");\n    touched.add(key);\n  }\n  if (changeset.ui !== null) serialize(changeset.ui, \"工作区设置\");\n  return changeset;\n}\n\nexport function applyChangeset(db, changeset, { now, expectedGeneration, currentSchemaVersion = CURRENT_SCHEMA_VERSION }) {\n  validateChangeset(changeset, { currentSchemaVersion });\n  if (changeset.generation !== expectedGeneration) throw new StorageError(\"E_CONFLICT\", \"工作区已被恢复，请重新打开后再编辑\");\n  return transaction(db, () => {\n    const currentGeneration = parseJson(db.prepare(\"SELECT value FROM meta WHERE key='generation'\").get()?.value, \"工作区代次\");\n    if (changeset.generation !== currentGeneration) throw new StorageError(\"E_CONFLICT\", \"工作区已被恢复，请重新打开后再编辑\");\n    const previousSchema = parseJson(db.prepare(\"SELECT value FROM meta WHERE key='schemaVersion'\").get()?.value, \"工作区版本\");\n    if (changeset.schemaVersion < previousSchema) throw new StorageError(\"E_CONFLICT\", \"不能使用旧版本覆盖工作区\");\n    const existingOrderJson = db.prepare(\"SELECT value FROM meta WHERE key='collectionOrder'\").get()?.value;\n    const existingOrder = existingOrderJson ? parseJson(existingOrderJson, \"集合顺序\") : Object.fromEntries([...readAllRows(db).entities].map(([collection, values]) => [collection, [...values.keys()]]));\n    const entries = new Map();\n    for (const entry of changeset.upserts) {\n      if (!entries.has(entry.collection)) entries.set(entry.collection, new Map());\n      entries.get(entry.collection).set(entry.id, entry.json);\n    }\n    writeEntities(db, entries, now);\n    const remove = db.prepare(\"DELETE FROM entities WHERE collection=? AND id=?\");\n    for (const entry of changeset.deletes) remove.run(entry.collection, entry.id);\n    const meta = new Map([[\"savedAt\", serialize(now, \"保存时间\")], [\"schemaVersion\", serialize(changeset.schemaVersion, \"版本\")]]);\n    if (changeset.ui !== null) meta.set(\"ui\", serialize(changeset.ui, \"工作区设置\"));\n    const touchedCollections = new Set([...changeset.upserts, ...changeset.deletes].map((entry) => entry.collection));\n    const order = { ...existingOrder };\n    for (const collection of touchedCollections) {\n      const upsertIds = changeset.upserts.filter((entry) => entry.collection === collection).map((entry) => entry.id);\n      const deleted = new Set(changeset.deletes.filter((entry) => entry.collection === collection).map((entry) => entry.id));\n      const retained = (order[collection] || []).filter((id) => !deleted.has(id));\n      const already = new Set(retained);\n      const added = upsertIds.filter((id) => !already.has(id));\n      const live = new Set([...retained, ...added]);\n      if (upsertIds.length === live.size && upsertIds.every((id) => live.has(id))) order[collection] = upsertIds;\n      else order[collection] = [...retained, ...added];\n    }\n    const orderJson = serialize(order, \"集合顺序\");\n    if (orderJson !== existingOrderJson) meta.set(\"collectionOrder\", orderJson);\n    writeMeta(db, meta);\n    return { savedAt: now };\n  });\n}\n\nexport function replaceDatabaseWorkspace(db, workspace, { generation, now }) {\n  const meta = coreMeta(workspace, generation);\n  const entities = workspaceEntities(workspace);\n  transaction(db, () => {\n    db.exec(\"DELETE FROM entities\");\n    if (!meta.has(\"savedAt\")) db.prepare(\"DELETE FROM meta WHERE key='savedAt'\").run();\n    writeEntities(db, entities, now);\n    writeMeta(db, meta);\n  });\n  return { savedAt: workspace.savedAt, generation };\n}\n\nfunction validateAssetRow(row) {\n  if (!isPlainObject(row) || !/^[a-f0-9]{64}$/.test(row.sha256 ?? \"\") || !Number.isSafeInteger(row.size) || row.size < 0\n    || typeof row.mime !== \"string\" || row.mime.length > 200 || /[\\r\\n\\0]/.test(row.mime)\n    || row.originalName !== null && (typeof row.originalName !== \"string\" || row.originalName.length > 255 || /[\\r\\n\\0]/.test(row.originalName))\n    || ![\"string\", \"number\"].includes(typeof row.createdAt)) throw new StorageError(\"E_CORRUPT\", \"附件元数据无效\");\n  return row;\n}\n\nexport function readAssetRows(db) {\n  if (!db) throw new StorageError(\"E_IO\", \"附件数据库尚未就绪\");\n  return db.prepare(\"SELECT sha256, size, mime, original_name, created_at FROM assets\").all().map((row) => validateAssetRow({ sha256: row.sha256, size: row.size, mime: row.mime, originalName: row.original_name, createdAt: row.created_at }));\n}\n\nexport function deleteAssetRows(db, sha256s) {\n  if (!Array.isArray(sha256s) || sha256s.some((sha256) => typeof sha256 !== \"string\" || !/^[a-f0-9]{64}$/.test(sha256))) throw invalid(\"附件标识无效\");\n  return transaction(db, () => {\n    const statement = db.prepare(\"DELETE FROM assets WHERE sha256=?\");\n    return sha256s.reduce((count, sha256) => count + Number(statement.run(sha256).changes), 0);\n  });\n}\n\nexport function restoreAssetRows(db, rows) {\n  if (!Array.isArray(rows)) throw invalid(\"附件元数据无效\");\n  rows.forEach(validateAssetRow);\n  return transaction(db, () => {\n    const existing = db.prepare(\"SELECT size FROM assets WHERE sha256=?\");\n    const statement = db.prepare(\"INSERT OR IGNORE INTO assets(sha256, size, mime, original_name, created_at) VALUES (?, ?, ?, ?, ?)\");\n    for (const row of rows) {\n      const previous = existing.get(row.sha256);\n      if (previous && previous.size !== row.size) throw new StorageError(\"E_CORRUPT\", \"现有附件元数据与回收站不一致\");\n      statement.run(row.sha256, row.size, row.mime, row.originalName, row.createdAt);\n    }\n  });\n}\n\nexport function vacuumInto(db, targetFile) {\n  const target = assertPhysicalPath(targetFile);\n  if (fs.existsSync(target)) throw invalid(\"快照目标文件已存在\");\n  fs.mkdirSync(path.dirname(target), { recursive: true });\n  db.prepare(\"VACUUM INTO ?\").run(target);\n  return target;\n}\n",
};

assert.equal(createHash("sha256").update(FROZEN_DB.source, "utf8").digest("hex").toUpperCase(), FROZEN_DB.sha256, "Frozen workspaceDb source hash");
const frozenUrl = `${new URL("../electron/main/storage/workspaceDb.js", import.meta.url).href}?workspace-diff-retention-before01`;
const oracleHooks = registerHooks({
  load(url, context, nextLoad) {
    if (url === frozenUrl) return { format: "module", source: FROZEN_DB.source, shortCircuit: true };
    return nextLoad(url, context);
  },
});
let beforeDb;
try {
  const results = await Promise.allSettled([import(frozenUrl)]);
  if (results[0].status === "rejected") throw new AggregateError([results[0].reason], "Frozen workspaceDb import failed");
  beforeDb = results[0].value;
} finally {
  oracleHooks.deregister();
}

function fixtureWorkspace() {
  const workspace = { ...upgradeWorkspace(fullWorkspace()), workspaceId: "ws-diff-retention" };
  workspace.pageVersions = [createPageVersion(workspace.pages[0], { id: "pv-retention", reason: "before-edit", now: FIXTURE_TIME })];
  workspace.extensionData = { version: 0, nested: ["keep"] };
  return workspace;
}

function withPair(makeInitial, exercise) {
  const directory = createIsolatedDirectory("workspace-diff-retention");
  const sides = [];
  let result;
  let failure;
  try {
    for (const [name, api] of [["before", beforeDb], ["current", currentDb]]) {
      const file = path.join(directory, `${name}.db`);
      const db = api.openWorkspaceDatabase(file);
      const side = { name, api, db, file };
      sides.push(side);
      side.workspace = makeInitial();
      api.prepareWritable(db);
      api.initializeWorkspace(db, side.workspace, { generation: "gen-retention", now: FIXTURE_TIME });
      db.prepare("INSERT INTO meta(key,value) VALUES (?,?)").run("unrelatedMeta", JSON.stringify({ retained: true }));
    }
    result = exercise({ directory, sides });
  } catch (error) {
    failure = error;
  }
  const cleanupErrors = [];
  for (const side of sides) {
    if (!side.db) continue;
    try { side.db.close(); side.db = undefined; } catch (error) { cleanupErrors.push(error); }
  }
  if (failure || cleanupErrors.length) {
    console.log(`LIFE_ATLAS_WORKSPACE_DIFF_RETAINED ${JSON.stringify({ directory })}`);
    if (cleanupErrors.length) throw new AggregateError([...(failure ? [failure] : []), ...cleanupErrors], "Workspace diff test or connection cleanup failed");
    throw failure;
  }
  removeIsolatedDirectory(directory);
  return result;
}

function snapshotGraph(value, copies = new Map()) {
  if (!value || typeof value !== "object") return value;
  if (copies.has(value)) return copies.get(value);
  const result = value instanceof Date ? new Date(value.getTime()) : Array.isArray(value) ? [] : Object.create(Object.getPrototypeOf(value));
  copies.set(value, result);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (Object.hasOwn(descriptor, "value")) descriptor.value = snapshotGraph(descriptor.value, copies);
    Object.defineProperty(result, key, descriptor);
  }
  return result;
}

function freezeGraph(value, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (Object.hasOwn(descriptor, "value")) freezeGraph(descriptor.value, seen);
  }
  Object.freeze(value);
}

function snapshotRows(rows) {
  return { meta: [...rows.meta], entities: [...rows.entities].map(([collection, entities]) => [collection, [...entities]]) };
}

function sqlSnapshot(db) {
  return {
    meta: db.prepare("SELECT key,value FROM meta ORDER BY key").all().map((row) => ({ ...row })),
    entities: db.prepare("SELECT collection,id,json,updated_at FROM entities ORDER BY collection,id").all().map((row) => ({ ...row })),
    assets: db.prepare("SELECT sha256,size,mime,original_name,created_at FROM assets ORDER BY sha256").all().map((row) => ({ ...row })),
  };
}

function capture(operation) {
  try { return { ok: true, value: operation() }; }
  catch (error) { return { ok: false, error: { name: error.name, code: error.code, message: error.message } }; }
}

function observedDatabase(db) {
  const exec = [];
  const proxy = new Proxy(db, {
    get(target, key) {
      const value = Reflect.get(target, key, target);
      if (key === "exec") return (sql) => { exec.push(sql); return target.exec(sql); };
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { db: proxy, exec };
}

function compareDiff(pair, makeCandidate = (workspace) => ({ workspace: structuredClone(workspace) })) {
  const runs = pair.sides.map((side) => {
    const storedRows = side.api.readAllRows(side.db);
    const data = makeCandidate(side.workspace, storedRows, side);
    const rows = data.rows ?? storedRows;
    const workspace = data.workspace;
    const inputBefore = snapshotGraph(workspace);
    const rowsBefore = data.opaqueRows ? null : snapshotRows(rows);
    const sqlBefore = sqlSnapshot(side.db);
    const countBefore = side.db.prepare("SELECT total_changes() AS count").get().count;
    if (!data.allowInputMutation) freezeGraph(workspace);
    const observed = observedDatabase(side.db);
    const trace = data.trace ?? [];
    trace.length = 0;
    const operation = () => side.api.writeWorkspaceDiff(observed.db, rows, workspace, { now: Object.hasOwn(data, "now") ? data.now : NEXT_TIME });
    const outcome = capture(() => data.invoke ? data.invoke(operation) : operation());
    const callTrace = snapshotGraph(trace);
    if (!data.allowInputMutation) assert.deepStrictEqual(workspace, inputBefore, `${side.name}: input purity`);
    if (!data.allowRowsMutation && !data.opaqueRows) assert.deepStrictEqual(snapshotRows(rows), rowsBefore, `${side.name}: rows purity`);
    return {
      side, data, rows, workspace, outcome, trace: callTrace, exec: observed.exec,
      sqlBefore, sqlAfter: sqlSnapshot(side.db),
      changes: side.db.prepare("SELECT total_changes() AS count").get().count - countBefore,
    };
  });
  const [expected, actual] = runs;
  assert.deepStrictEqual(actual.outcome, expected.outcome, "Frozen diff return/error contract");
  assert.deepStrictEqual(actual.exec, expected.exec, "Transaction boundaries");
  assert.deepStrictEqual(actual.trace, expected.trace, "Getter and toJSON order");
  assert.deepStrictEqual(actual.sqlBefore, expected.sqlBefore, "Identical starting SQL rows");
  assert.deepStrictEqual(actual.sqlAfter, expected.sqlAfter, "Identical final raw SQL rows/meta");
  assert.equal(actual.changes, expected.changes, "Identical SQL write count");
  return { expected, actual };
}

function reopenPair(pair) {
  const outcomes = pair.sides.map((side) => {
    side.db.close();
    side.db = undefined;
    side.db = side.api.openWorkspaceDatabase(side.file);
    return capture(() => side.api.assembleWorkspace(side.api.readAllRows(side.db)));
  });
  assert.deepStrictEqual(outcomes[1], outcomes[0], "Reopened workspace or corruption error");
  return outcomes[1];
}

function versionHook(next, callback) {
  const payload = structuredClone(next.pageVersions[0]);
  next.pageVersions[0].toJSON = function (key) { callback(key); return payload; };
}

function readonlyMap(map) {
  return new Proxy(map, {
    get(target, key) {
      if (["set", "delete", "clear"].includes(key)) return () => { throw new Error("Rows Map must remain immutable"); };
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

test("Stage2 no-op preserves SQL, savedAt, readonly rows and WAL/FULL", () => withPair(fixtureWorkspace, (pair) => {
  const { actual } = compareDiff(pair);
  assert.deepStrictEqual(actual.outcome, { ok: true, value: { changed: false, savedAt: FIXTURE_TIME } });
  assert.deepStrictEqual(actual.exec, []);
  assert.equal(actual.changes, 0);
  for (const side of pair.sides) {
    assert.equal(side.db.prepare("PRAGMA journal_mode").get().journal_mode, "wal");
    assert.equal(side.db.prepare("PRAGMA synchronous").get().synchronous, 2);
    assert.equal(side.db.prepare("PRAGMA foreign_keys").get().foreign_keys, 1);
  }
  assert.equal(reopenPair(pair).ok, true);
}));

test("Stage2 changed JSON, deletion, order, UI, extras and unrelated meta round-trip exactly", () => withPair(fixtureWorkspace, (pair) => {
  const { actual } = compareDiff(pair, (workspace) => {
    const next = structuredClone(workspace);
    next.pages = [{ ...next.pages[0], id: "prepended-retention", title: "最前", updatedAt: NEXT_TIME }, ...next.pages.slice(0, -1).reverse()];
    next.pages.find((page) => page.id === workspace.pages[0].id).title = "changed";
    next.ui.extension = { selected: ["prepended-retention"] };
    next.extensionData = { version: 1, nested: ["keep", "new"] };
    next.collectionOrder = "user-owned-extra";
    return { workspace: next };
  });
  assert.deepStrictEqual(actual.outcome, { ok: true, value: { changed: true, savedAt: NEXT_TIME } });
  const reopened = reopenPair(pair);
  assert.equal(reopened.ok, true);
  assert.deepStrictEqual(reopened.value.pages, actual.workspace.pages);
  assert.equal(reopened.value.savedAt, NEXT_TIME);
  assert.equal(reopened.value.collectionOrder, "user-owned-extra");
  assert.deepStrictEqual(reopened.value.extensionData, { version: 1, nested: ["keep", "new"] });
  assert.equal(actual.sqlAfter.meta.find((row) => row.key === "unrelatedMeta").value, JSON.stringify({ retained: true }));
}));

test("Stage2 savedAt-only writes and omitted savedAt preserve the old contract", () => {
  withPair(fixtureWorkspace, (pair) => {
    const { actual } = compareDiff(pair, (workspace) => ({ workspace: { ...structuredClone(workspace), savedAt: "caller-time" } }));
    assert.deepStrictEqual(actual.outcome, { ok: true, value: { changed: true, savedAt: NEXT_TIME } });
    assert.deepStrictEqual(actual.sqlAfter.entities, actual.sqlBefore.entities);
    assert.equal(actual.sqlAfter.meta.find((row) => row.key === "savedAt").value, JSON.stringify(NEXT_TIME));
  });
  withPair(fixtureWorkspace, (pair) => {
    const { actual } = compareDiff(pair, (workspace) => { const next = structuredClone(workspace); delete next.savedAt; return { workspace: next }; });
    assert.deepStrictEqual(actual.outcome, { ok: true, value: { changed: false, savedAt: undefined } });
    assert.deepStrictEqual(actual.sqlAfter, actual.sqlBefore);
  });
});

test("Stage2 optional omitted collections delete old rows while required omissions reject before BEGIN", () => {
  withPair(() => ({ ...fixtureWorkspace(), schemaVersion: 15 }), (pair) => {
    const { actual } = compareDiff(pair, (workspace) => { const next = structuredClone(workspace); delete next.pageVersions; return { workspace: next }; });
    assert.equal(actual.outcome.value.changed, true);
    assert.equal(actual.sqlAfter.entities.some((row) => row.collection === "pageVersions"), false);
    const reopened = reopenPair(pair);
    assert.equal(reopened.ok, true);
    assert.equal(Object.hasOwn(reopened.value, "pageVersions"), false);
  });
  for (const collection of ["comments", "pageVersions"]) withPair(fixtureWorkspace, (pair) => {
    const { actual } = compareDiff(pair, (workspace) => { const next = structuredClone(workspace); delete next[collection]; return { workspace: next }; });
    assert.equal(actual.outcome.error.code, "E_INVALID_ARGUMENT");
    assert.deepStrictEqual(actual.exec, []);
    assert.deepStrictEqual(actual.sqlAfter, actual.sqlBefore);
  });
});

test("Stage2 identical IDs in different collections remain independent", () => withPair(fixtureWorkspace, (pair) => {
  const { actual } = compareDiff(pair, (workspace) => {
    const next = structuredClone(workspace);
    next.pages.push({ ...next.pages[0], id: "shared-retention-id" });
    next.folders.push({ ...next.folders[0], id: "shared-retention-id" });
    return { workspace: next };
  });
  assert.equal(actual.outcome.value.changed, true);
  assert.equal(actual.sqlAfter.entities.filter((row) => row.id === "shared-retention-id").length, 2);
  assert.equal(reopenPair(pair).ok, true);
}));

test("Stage2 generation, UI and extras failures keep metadata-first error priority", () => {
  for (const kind of ["generation", "ui", "extras", "null-entity"]) withPair(fixtureWorkspace, (pair) => {
    const { actual } = compareDiff(pair, (workspace, rows) => {
      const trace = [];
      const next = structuredClone(workspace);
      versionHook(next, () => trace.push("entity-toJSON"));
      if (kind === "generation") { rows.meta.set("generation", "{"); delete next.ui; }
      if (kind === "ui") { delete next.ui; next.pages.push({ ...next.pages[0] }); }
      if (kind === "extras") { next.extensionData = 1n; next.pages[0] = null; }
      if (kind === "null-entity") next.pages[0] = null;
      return { workspace: next, trace };
    });
    assert.equal(actual.outcome.ok, false);
    assert.equal(actual.outcome.error.code, kind === "generation" ? "E_CORRUPT" : kind === "null-entity" ? undefined : "E_INVALID_ARGUMENT");
    assert.deepStrictEqual(actual.trace, []);
    assert.deepStrictEqual(actual.exec, []);
    assert.deepStrictEqual(actual.sqlAfter, actual.sqlBefore);
  });
});

test("Stage2 late invalid, duplicate and serialization failures reject every write before BEGIN", () => {
  for (const kind of ["invalid-id", "duplicate", "invalid-duplicate", "throws", "undefined-json"]) withPair(fixtureWorkspace, (pair) => {
    const { actual } = compareDiff(pair, (workspace) => {
      const next = structuredClone(workspace);
      next.pages[0].title = "must-not-write";
      const trace = [];
      let last;
      if (kind === "invalid-id") last = { id: "", pageId: next.pages[0].id };
      if (kind === "duplicate") last = { ...next.pageVersions[0] };
      if (kind === "invalid-duplicate") last = { ...next.pageVersions[0], toJSON() { trace.push("invalid-duplicate"); return { id: "mismatch" }; } };
      if (kind === "throws") last = { id: "late-throw", toJSON() { trace.push("throws"); throw new Error("caller serialization failure"); } };
      if (kind === "undefined-json") last = { id: "late-undefined", toJSON() { trace.push("undefined"); return undefined; } };
      next.pageVersions.push(last);
      return { workspace: next, trace };
    });
    assert.equal(actual.outcome.error.code, "E_INVALID_ARGUMENT");
    if (kind === "invalid-duplicate") assert.equal(actual.outcome.error.message, "实体必须是对象，且 ID 必须一致");
    assert.deepStrictEqual(actual.exec, []);
    assert.deepStrictEqual(actual.sqlAfter, actual.sqlBefore);
    assert.equal(actual.changes, 0);
  });
});

test("Stage2 a late entity exceeding 20 MiB rejects the whole batch before BEGIN", () => withPair(fixtureWorkspace, (pair) => {
  const { actual } = compareDiff(pair, (workspace) => {
    const next = structuredClone(workspace);
    next.pages[0].title = "must-not-write";
    next.pageVersions.push({ id: "late-large", body: "x".repeat(currentDb.MAX_ENTITY_BYTES) });
    return { workspace: next };
  });
  assert.equal(actual.outcome.error.code, "E_INVALID_ARGUMENT");
  assert.equal(actual.outcome.error.message, "单个实体不能超过 20 MB");
  assert.deepStrictEqual(actual.exec, []);
  assert.deepStrictEqual(actual.sqlAfter, actual.sqlBefore);
}));

test("Stage2 now serializes only after a non-noop request and before BEGIN", () => {
  withPair(fixtureWorkspace, (pair) => {
    const { actual } = compareDiff(pair, (workspace) => ({ workspace: structuredClone(workspace), now: 1n }));
    assert.deepStrictEqual(actual.outcome, { ok: true, value: { changed: false, savedAt: FIXTURE_TIME } });
    assert.deepStrictEqual(actual.exec, []);
  });
  for (const now of [1n, undefined]) withPair(fixtureWorkspace, (pair) => {
    const { actual } = compareDiff(pair, (workspace) => {
      const next = structuredClone(workspace);
      next.pages[0].title = "must-not-write";
      const trace = [];
      versionHook(next, () => trace.push("last-serialized"));
      return { workspace: next, now, trace };
    });
    assert.equal(actual.outcome.error.code, "E_INVALID_ARGUMENT");
    assert.deepStrictEqual(actual.trace, ["last-serialized"]);
    assert.deepStrictEqual(actual.exec, []);
    assert.deepStrictEqual(actual.sqlAfter, actual.sqlBefore);
  });
});

test("Stage2 duplicate checks preserve ID accessor read order and last captured key overwrite", () => withPair(fixtureWorkspace, (pair) => {
  const { actual } = compareDiff(pair, (workspace) => {
    const next = structuredClone(workspace);
    const trace = [];
    const payload = { ...next.pages[0], title: "last-captured-json" };
    let reads = 0;
    const plan = ["order-only-id", payload.id, "duplicate-probe-only-id", payload.id];
    const entity = { ...payload, toJSON(key) { trace.push(["toJSON", key]); return payload; } };
    Object.defineProperty(entity, "id", { enumerable: true, configurable: true, get() { const value = plan[reads++]; trace.push(["id", value]); return value; } });
    next.pages.push(entity);
    return { workspace: next, trace, allowInputMutation: true };
  });
  assert.equal(actual.outcome.ok, true);
  assert.deepStrictEqual(actual.trace, [["id", "order-only-id"], ["toJSON", ""], ["id", actual.workspace.pages[0].id], ["id", "duplicate-probe-only-id"], ["id", actual.workspace.pages[0].id]]);
  assert.equal(JSON.parse(actual.sqlAfter.entities.find((row) => row.collection === "pages" && row.id === actual.workspace.pages[0].id).json).title, "last-captured-json");
  // The old contract accepts the unusual key overwrite, then detects the
  // inconsistent caller collectionOrder on reopen. Preserve that outcome too.
  assert.equal(reopenPair(pair).error.code, "E_CORRUPT");
}));

test("Stage2 schema accessor and undefined collection retain requiredCollections read order", () => withPair(fixtureWorkspace, (pair) => {
  const { actual } = compareDiff(pair, (workspace) => {
    const next = structuredClone(workspace);
    const trace = [];
    Object.defineProperty(next, "schemaVersion", { enumerable: true, configurable: true, get() { trace.push("schema"); return 16; } });
    delete next.pageVersions;
    return { workspace: next, trace, allowInputMutation: true };
  });
  assert.equal(actual.outcome.error.code, "E_INVALID_ARGUMENT");
  assert.deepStrictEqual(actual.exec, []);
  assert.deepStrictEqual(actual.sqlAfter, actual.sqlBefore);
}));

test("Stage2 later toJSON changes early rows and preserves the final changed/noop decision", () => {
  for (const becomesEqual of [false, true]) withPair(fixtureWorkspace, (pair) => {
    const { actual } = compareDiff(pair, (workspace, rows) => {
      const next = structuredClone(workspace);
      if (becomesEqual) next.pages[0].title = "captured-candidate";
      const capturedPage = JSON.stringify(next.pages[0]);
      const trace = [];
      versionHook(next, (key) => {
        trace.push(["later-toJSON", key]);
        rows.entities.get("pages").set(next.pages[0].id, becomesEqual ? capturedPage : JSON.stringify({ ...next.pages[0], title: "rows-late-change" }));
      });
      return { workspace: next, rows, trace, allowRowsMutation: true };
    });
    assert.equal(actual.outcome.value.changed, !becomesEqual);
    assert.equal(JSON.parse(actual.sqlAfter.entities.find((row) => row.collection === "pages" && row.id === actual.workspace.pages[0].id).json).title, pair.sides[1].workspace.pages[0].title);
    assert.equal(reopenPair(pair).ok, true);
  });
});

test("Stage2 later caller mutation never changes an already captured candidate JSON", () => withPair(fixtureWorkspace, (pair) => {
  const { actual } = compareDiff(pair, (workspace) => {
    const next = structuredClone(workspace);
    next.pages[0].title = "at-serialization-boundary";
    const trace = [];
    versionHook(next, () => { trace.push("later-caller-mutation"); next.pages[0].title = "after-serialization-boundary"; });
    return { workspace: next, trace, allowInputMutation: true };
  });
  assert.equal(actual.outcome.value.changed, true);
  assert.equal(actual.workspace.pages[0].title, "after-serialization-boundary");
  assert.equal(JSON.parse(actual.sqlAfter.entities.find((row) => row.collection === "pages" && row.id === actual.workspace.pages[0].id).json).title, "at-serialization-boundary");
  assert.equal(reopenPair(pair).ok, true);
}));

test("Stage2 later outer Map replacement or getter is read only at the original final point", () => {
  for (const useGetter of [false, true]) withPair(fixtureWorkspace, (pair) => {
    const { actual } = compareDiff(pair, (workspace, rows) => {
      const next = structuredClone(workspace);
      const trace = [];
      versionHook(next, () => {
        trace.push("last-serialized");
        const replacement = new Map(rows.entities);
        const pages = new Map(replacement.get("pages"));
        pages.set(next.pages[0].id, JSON.stringify({ ...next.pages[0], title: "replacement-rows" }));
        replacement.set("pages", pages);
        if (useGetter) Object.defineProperty(rows, "entities", { configurable: true, get() { trace.push("entities-getter"); return replacement; } });
        else rows.entities = replacement;
      });
      return { workspace: next, rows, trace, allowRowsMutation: true };
    });
    assert.equal(actual.outcome.value.changed, true);
    assert.equal(actual.trace[0], "last-serialized");
    assert.equal(actual.trace.filter((entry) => entry === "entities-getter").length, useGetter ? BACKUP_COLLECTIONS.length : 0);
    assert.equal(reopenPair(pair).ok, true);
  });
});

test("Stage2 a Map.get override installed during serialization is never called early", () => withPair(fixtureWorkspace, (pair) => {
  const { actual } = compareDiff(pair, (workspace, rows) => {
    const next = structuredClone(workspace);
    const trace = [];
    const payload = structuredClone(next.pages[1]);
    next.pages[1].toJSON = function () {
      trace.push("installed-get");
      const pages = rows.entities.get("pages");
      Object.defineProperty(pages, "get", { configurable: true, value(id) { trace.push(["pages-get", id]); return MAP_GET.call(this, id); } });
      return payload;
    };
    versionHook(next, () => trace.push("last-serialized"));
    return { workspace: next, rows, trace, allowRowsMutation: true };
  });
  assert.equal(actual.outcome.value.changed, false);
  assert.deepStrictEqual(actual.trace.slice(0, 2), ["installed-get", "last-serialized"]);
  assert.deepStrictEqual(actual.trace.slice(2), actual.workspace.pages.map((page) => ["pages-get", page.id]));
  assert.deepStrictEqual(actual.exec, []);
}));

test("Stage2 initial rows getters, proxies, subclasses and method accessors keep the old fallback timing", () => {
  for (const kind of ["rows-proxy", "entities-getter", "map-proxy", "map-subclass", "method-getter", "readonly"]) withPair(fixtureWorkspace, (pair) => {
    const { actual } = compareDiff(pair, (workspace, originalRows) => {
      const next = structuredClone(workspace);
      const trace = [];
      let rows = originalRows;
      const original = originalRows.entities;
      if (kind === "rows-proxy") rows = new Proxy(originalRows, { get(target, key) { trace.push(["rows-get", String(key)]); return Reflect.get(target, key, target); } });
      if (kind === "entities-getter") Object.defineProperty(rows, "entities", { configurable: true, get() { trace.push("entities-getter"); return original; } });
      if (kind === "map-proxy") rows.entities = new Proxy(original, { get(target, key) { const value = Reflect.get(target, key, target); if (key === "get") return (collection) => { trace.push(["outer-get", collection]); return MAP_GET.call(target, collection); }; return typeof value === "function" ? value.bind(target) : value; } });
      if (kind === "map-subclass") {
        class ObservedMap extends Map { get(collection) { trace.push(["outer-get", collection]); return super.get(collection); } }
        rows.entities = new ObservedMap(original);
      }
      if (kind === "method-getter") Object.defineProperty(original, "get", { configurable: true, get() { trace.push("method-getter"); return function (collection) { trace.push(["outer-get", collection]); return MAP_GET.call(this, collection); }; } });
      if (kind === "readonly") rows = { meta: readonlyMap(rows.meta), entities: readonlyMap(new Map([...original].map(([collection, entities]) => [collection, readonlyMap(entities)]))) };
      versionHook(next, () => trace.push("last-serialized"));
      return { workspace: next, rows, trace };
    });
    assert.equal(actual.outcome.value.changed, false);
    assert.deepStrictEqual(actual.exec, []);
    if (kind !== "rows-proxy" && kind !== "readonly") assert.equal(actual.trace[0], "last-serialized");
    if (kind === "method-getter") assert.equal(actual.trace.filter((entry) => entry === "method-getter").length, BACKUP_COLLECTIONS.length);
  });
});

test("Stage2 exotic row accessors remain untouched on a late validation failure", () => withPair(fixtureWorkspace, (pair) => {
  const { actual } = compareDiff(pair, (workspace, rows) => {
    const next = structuredClone(workspace);
    next.pages[0].title = "must-not-write";
    next.pageVersions.push({ id: "" });
    const trace = [];
    const original = rows.entities;
    Object.defineProperty(rows, "entities", { configurable: true, get() { trace.push("entities-getter"); return original; } });
    return { workspace: next, rows, trace };
  });
  assert.equal(actual.outcome.error.code, "E_INVALID_ARGUMENT");
  assert.deepStrictEqual(actual.trace, []);
  assert.deepStrictEqual(actual.exec, []);
  assert.deepStrictEqual(actual.sqlAfter, actual.sqlBefore);
}));

test("Stage2 bound Map.get override cannot pass as a safe native intrinsic", () => withPair(fixtureWorkspace, (pair) => {
  const { actual } = compareDiff(pair, (workspace, rows) => {
    const next = structuredClone(workspace);
    const trace = [];
    versionHook(next, () => trace.push("last-serialized"));
    const fixed = rows.meta;
    return {
      workspace: next, rows, trace,
      invoke(operation) {
        const descriptor = Object.getOwnPropertyDescriptor(Map.prototype, "get");
        const bound = function (key) { trace.push(["bound-get", key]); return MAP_GET.call(fixed, key); }.bind(undefined);
        assert.match(Function.prototype.toString.call(bound), /\[native code\]/);
        try { Object.defineProperty(Map.prototype, "get", { ...descriptor, value: bound }); return operation(); }
        finally { Object.defineProperty(Map.prototype, "get", descriptor); }
      },
    };
  });
  const boundary = actual.trace.indexOf("last-serialized");
  assert.equal(boundary, 1, "Only generation is read through the override before full serialization");
  assert.deepStrictEqual(actual.trace[0], ["bound-get", "generation"]);
  assert.equal(actual.outcome.ok, true);
}));

test("Stage2 an own call getter on Map.get is never read by an early hint", () => {
  for (const installLater of [false, true]) withPair(fixtureWorkspace, (pair) => {
    const { actual } = compareDiff(pair, (workspace, rows) => {
      const next = structuredClone(workspace);
      const trace = [];
      const install = () => Object.defineProperty(MAP_GET, "call", {
        configurable: true,
        get() { trace.push("unexpected-get-call"); throw new Error("Map.get.call must not be inspected"); },
      });
      if (installLater) {
        const payload = structuredClone(next.pages[1]);
        next.pages[1].toJSON = function () { trace.push("installed-call"); install(); return payload; };
      }
      versionHook(next, () => trace.push("last-serialized"));
      return {
        workspace: next, rows, trace,
        invoke(operation) {
          const descriptor = Object.getOwnPropertyDescriptor(MAP_GET, "call");
          try { if (!installLater) install(); return operation(); }
          finally { if (descriptor) Object.defineProperty(MAP_GET, "call", descriptor); else delete MAP_GET.call; }
        },
      };
    });
    assert.equal(actual.outcome.value.changed, false);
    assert.equal(actual.trace.includes("unexpected-get-call"), false);
    assert.deepStrictEqual(actual.exec, []);
  });
});

test("Stage2 Map prototypes without internal slots keep the old late TypeError boundary", () => {
  for (const replaceOuter of [true, false]) withPair(fixtureWorkspace, (pair) => {
    const { actual } = compareDiff(pair, (workspace, rows) => {
      const next = structuredClone(workspace);
      const trace = [];
      const fake = Object.create(Map.prototype);
      if (replaceOuter) rows.entities = fake;
      else rows.entities.set("pages", fake);
      versionHook(next, () => trace.push("last-serialized"));
      return { workspace: next, rows, trace, opaqueRows: true };
    });
    assert.equal(actual.outcome.error.name, "TypeError");
    assert.deepStrictEqual(actual.trace, ["last-serialized"]);
    assert.deepStrictEqual(actual.exec, []);
    assert.deepStrictEqual(actual.sqlAfter, actual.sqlBefore);
  });
});

test("Stage2 coreMeta hooks cannot introduce extra public inspection callbacks", () => withPair(fixtureWorkspace, (pair) => {
  const { actual } = compareDiff(pair, (workspace, rows) => {
    const next = structuredClone(workspace);
    const trace = [];
    const payload = structuredClone(next.ui);
    const publicHelpers = [[Object, "getOwnPropertyDescriptor"], [Object, "getPrototypeOf"], [Object, "hasOwn"], [Reflect, "ownKeys"], [process, "getBuiltinModule"], [utilTypes, "isMap"], [utilTypes, "isProxy"]];
    const descriptors = publicHelpers.map(([target, key]) => [target, key, GET_DESCRIPTOR(target, key)]);
    next.ui.toJSON = function () {
      trace.push("coreMeta-hook");
      for (const [target, key, descriptor] of descriptors) {
        const original = descriptor.value;
        DEFINE_PROPERTY(target, key, { ...descriptor, value(...args) { trace.push(["public-inspection", key]); return original(...args); } });
      }
      return payload;
    };
    versionHook(next, () => trace.push("last-serialized"));
    return {
      workspace: next, rows, trace,
      invoke(operation) {
        try { return operation(); }
        finally { for (const [target, key, descriptor] of descriptors) DEFINE_PROPERTY(target, key, descriptor); }
      },
    };
  });
  assert.equal(actual.outcome.value.changed, false);
  assert.equal(actual.trace.some((entry) => Array.isArray(entry) && ["getOwnPropertyDescriptor", "hasOwn", "ownKeys", "getBuiltinModule", "isMap", "isProxy"].includes(entry[1])), false);
  assert.deepStrictEqual(actual.exec, []);
}));

test("Stage2 real SQLite failure after entity, deletion and meta writes rolls back every row", () => withPair(fixtureWorkspace, (pair) => {
  const makeNext = (workspace) => {
    const next = structuredClone(workspace);
    next.pages[0].title = "staged-update";
    next.pages = [...next.pages.slice(0, -1), { ...next.pages[0], id: "staged-insert", title: "staged-insert" }];
    next.ui.extension = { rollback: "staged" };
    next.extensionData = { version: 1, nested: ["staged"] };
    return next;
  };
  const sqlLiteral = (value) => `'${value.replaceAll("'", "''")}'`;
  for (const side of pair.sides) {
    const next = makeNext(side.workspace);
    const uiJson = sqlLiteral(JSON.stringify(next.ui));
    const extrasJson = sqlLiteral(JSON.stringify({ extensionData: next.extensionData }));
    const removedId = sqlLiteral(side.workspace.pages.at(-1).id);
    side.db.exec(`CREATE TRIGGER retention_saved_at_failure BEFORE UPDATE ON meta WHEN NEW.key='savedAt'
      BEGIN
        SELECT CASE WHEN EXISTS(SELECT 1 FROM entities WHERE collection='pages' AND id='staged-insert')
          AND NOT EXISTS(SELECT 1 FROM entities WHERE collection='pages' AND id=${removedId})
          AND (SELECT value FROM meta WHERE key='ui')=${uiJson}
          AND (SELECT value FROM meta WHERE key='extras')=${extrasJson}
          THEN RAISE(ABORT, 'retention-after-entity-delete-meta')
          ELSE RAISE(ABORT, 'retention-order-not-reached') END;
      END;`);
  }
  const { actual } = compareDiff(pair, (workspace) => ({ workspace: makeNext(workspace) }));
  assert.equal(actual.outcome.ok, false);
  assert.match(actual.outcome.error.message, /retention-after-entity-delete-meta/);
  assert.deepStrictEqual(actual.exec, ["BEGIN IMMEDIATE", "ROLLBACK"]);
  assert.deepStrictEqual(actual.sqlAfter, actual.sqlBefore);
  assert.equal(reopenPair(pair).ok, true);
}));

// BEGIN WORKSPACE_DIFF_REGRESSION_REVIEW_V4_01_ARRAY_ITERATOR
test("Stage2 coreMeta-installed array iterator retains original collection callbacks and error priority", () => {
  const iteratorDescriptor = GET_DESCRIPTOR(Array.prototype, Symbol.iterator);
  for (const scenario of ["noop", "final-iterator-error", "late-invalid"]) withPair(fixtureWorkspace, (pair) => {
    const { actual } = compareDiff(pair, (workspace, rows) => {
      const next = structuredClone(workspace);
      const trace = [];
      const uiPayload = structuredClone(next.ui);
      let collectionPasses = 0;
      next.ui.toJSON = function () {
        trace.push("coreMeta-hook");
        DEFINE_PROPERTY(Array.prototype, Symbol.iterator, {
          ...iteratorDescriptor,
          value() {
            if (this === BACKUP_COLLECTIONS) {
              collectionPasses += 1;
              trace.push(["collections-iterator", collectionPasses]);
              if (scenario !== "noop" && collectionPasses === 2) throw new Error("caller collection iterator failure");
            }
            return iteratorDescriptor.value.call(this);
          },
        });
        return uiPayload;
      };
      versionHook(next, () => trace.push("last-serialized"));
      if (scenario === "late-invalid") next.pageVersions.push({ id: "" });
      return {
        workspace: next, rows, trace,
        invoke(operation) {
          try { return operation(); }
          finally { DEFINE_PROPERTY(Array.prototype, Symbol.iterator, iteratorDescriptor); }
        },
      };
    });
    assert.deepStrictEqual(GET_DESCRIPTOR(Array.prototype, Symbol.iterator), iteratorDescriptor, "Array iterator descriptor restored before harness inspection");
    const expectedTrace = ["coreMeta-hook", ["collections-iterator", 1], "last-serialized"];
    if (scenario !== "late-invalid") expectedTrace.push(["collections-iterator", 2]);
    assert.deepStrictEqual(actual.trace, expectedTrace, "Only the original candidate/final collection loops invoke the custom iterator");
    if (scenario === "noop") assert.deepStrictEqual(actual.outcome, { ok: true, value: { changed: false, savedAt: FIXTURE_TIME } });
    else if (scenario === "final-iterator-error") assert.deepStrictEqual(actual.outcome, { ok: false, error: { name: "Error", code: undefined, message: "caller collection iterator failure" } });
    else {
      assert.equal(actual.outcome.error.code, "E_INVALID_ARGUMENT");
      assert.equal(actual.outcome.error.message, "实体集合或 ID 无效");
    }
    assert.deepStrictEqual(actual.exec, []);
    assert.deepStrictEqual(actual.sqlAfter, actual.sqlBefore);
    assert.equal(actual.changes, 0);
  });
});
// END WORKSPACE_DIFF_REGRESSION_REVIEW_V4_01_ARRAY_ITERATOR
