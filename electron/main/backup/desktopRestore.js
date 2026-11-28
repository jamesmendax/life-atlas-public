import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { DatabaseSync } from "node:sqlite";
import { filesToWorkspace, parseJsonBytes } from "../../../src/backup/serialize.js";
import { BACKUP_COLLECTIONS } from "../../../src/backup/format.js";
import { COUNT_COLLECTIONS, WORKSPACE_RESCUE_SCOPE } from "../../../src/backup/manifest.js";
import { CURRENT_SCHEMA_VERSION } from "../../../src/persistence/migrations.js";
import { normalizeLoadedWorkspace } from "../../../src/persistence/normalize.js";
import { assertPhysicalPath } from "../storage/dataRoot.js";
import { openWorkspaceDatabase, initializeWorkspace, readAllRows, assembleWorkspace, replaceDatabaseWorkspace, StorageError } from "../storage/workspaceDb.js";
import { createAssetStore } from "../storage/assetStore.js";
import { createAssistantConversationStore } from "../assistant/conversations.js";
import { readSnapshotMetadata, snapshotDirectory } from "../storage/snapshots.js";
import { validateVaultHeader } from "../vault/index.js";
import { VAULT_FORMAT_VERSION, writeHeader, putItemBlob, setState, readHeader, listItemIds, getItemBlob, getState } from "../vault/vaultStore.js";
import { validateSettingsPatch } from "../vault/itemModel.js";
import { convertBrowserPackage } from "./legacyConversion.js";
import { openZipFileReader } from "./zipNode.js";
import { createBackupInspector, verifyBackupFile } from "./inspection.js";
import { backupDate, createStagingDirectory, removeScopedDirectory, sha256File, syncFile, logBackup } from "./files.js";
import { ASSISTANT_ARCHIVE_PATH } from "./assistantArchive.js";

const fallbackInspector = createBackupInspector();
const countsOf = (workspace) => Object.fromEntries(COUNT_COLLECTIONS.map((name) => [name, workspace[name]?.length ?? 0]));

function prepareStagingWorkspace(db) {
  db.exec(`PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;
    CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE entities(collection TEXT NOT NULL, id TEXT NOT NULL, json TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(collection,id)) WITHOUT ROWID;
    CREATE TABLE assets(sha256 TEXT PRIMARY KEY, size INTEGER NOT NULL, mime TEXT NOT NULL, original_name TEXT, created_at TEXT NOT NULL);`);
}

function stageVaultDatabase(file, vault) {
  if (!validateVaultHeader(vault.header)) throw new StorageError("E_CORRUPT", "密钥库头部无效");
  validateSettingsPatch(vault.state.settings);
  const db = new DatabaseSync(assertPhysicalPath(file));
  try {
    db.exec(`PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA secure_delete=ON;
      CREATE TABLE vault_header(id INTEGER PRIMARY KEY CHECK(id=1),json TEXT NOT NULL);
      CREATE TABLE vault_items(id TEXT PRIMARY KEY,blob BLOB NOT NULL) WITHOUT ROWID;
      CREATE TABLE vault_state(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      BEGIN IMMEDIATE;`);
    writeHeader(db, vault.header);
    for (const item of vault.items) putItemBlob(db, item.id, Buffer.from(item.blobB64, "base64"));
    setState(db, "failedAttempts", "0");
    setState(db, "lockoutUntil", "");
    setState(db, "recoveryConfirmed", "true");
    setState(db, "settings", JSON.stringify(vault.state.settings));
    db.exec("COMMIT");
    checkIntegrity(db);
  } catch (error) { try { db.exec("ROLLBACK"); } catch {} throw error; }
  finally { db.close(); }
}

function checkIntegrity(db) {
  const results = db.prepare("PRAGMA integrity_check").all();
  if (results.length !== 1 || Object.values(results[0])[0] !== "ok") throw new StorageError("E_CORRUPT", "暂存数据库完整性检查未通过");
}

async function copyAsset(reader, entry, store, db) {
  const target = store.filePath(entry.sha256);
  if (fs.existsSync(target)) {
    const existing = await sha256File(target);
    if (existing.sha256 !== entry.sha256 || existing.size !== entry.size) throw new StorageError("E_CORRUPT", "现有附件文件损坏，未覆盖原文件");
  } else {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const temporary = assertPhysicalPath(`${target}.import-${randomUUID()}`, { root: path.dirname(target) });
    const hash = createHash("sha256");
    let size = 0;
    const meter = new Transform({ transform(bytes, encoding, callback) { size += bytes.length; hash.update(bytes); callback(null, bytes); } });
    try {
      await pipeline(await reader.openStream(`assets/${entry.sha256}`), meter, fs.createWriteStream(temporary, { flags: "wx" }));
      if (size !== entry.size || hash.digest("hex") !== entry.sha256) throw new StorageError("E_CORRUPT", "附件在恢复时校验失败");
      syncFile(temporary);
      fs.renameSync(temporary, target);
    } finally { if (fs.existsSync(assertPhysicalPath(temporary))) fs.unlinkSync(temporary); }
  }
  db.prepare("INSERT OR IGNORE INTO assets(sha256,size,mime,original_name,created_at) VALUES(?,?,?,?,?)").run(entry.sha256, entry.size, entry.mime, entry.originalName, entry.createdAt);
}

async function checkedRead(reader, manifest, entryPath) {
  const descriptor = manifest.files.find((entry) => entry.path === entryPath);
  if (!descriptor) return undefined;
  const bytes = await reader.read(entryPath);
  if (bytes.length !== descriptor.size || createHash("sha256").update(bytes).digest("hex") !== descriptor.sha256) throw new StorageError("E_CORRUPT", "备份在检查后发生变化");
  return bytes;
}

function preserveCurrentMeta(db, workspaceService) {
  if (!workspaceService?.status().loaded) return;
  const statement = db.prepare("INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value");
  for (const key of ["lastFullBackupAt", "lastAppVersion"]) {
    const value = workspaceService.getMeta(key);
    if (value !== null) statement.run(key, JSON.stringify(value));
  }
}

async function loadCurrentWorkspace(context) {
  const service = context.workspaceService;
  if (!service || service.status().loaded || service.status().readOnlyError || !fs.existsSync(service.filePath)) return;
  try { await service.load(); } catch (error) { if (error.code !== "E_CORRUPT") throw error; }
}

function preserveLocalAssets(workspaceFile, workspaceService, attachmentIds, workspaceRescue) {
  const current = workspaceService?.db;
  if (!current || workspaceService.status().readOnlyError || !workspaceRescue && !attachmentIds.length) return;
  const db = openWorkspaceDatabase(workspaceFile);
  try {
    const copy = db.prepare("INSERT OR IGNORE INTO assets(sha256,size,mime,original_name,created_at) VALUES(?,?,?,?,?)");
    db.exec("BEGIN IMMEDIATE");
    if (workspaceRescue) {
      for (const row of current.prepare("SELECT sha256,size,mime,original_name,created_at FROM assets").iterate()) copy.run(row.sha256, row.size, row.mime, row.original_name, row.created_at);
    } else {
      const existing = current.prepare("SELECT sha256,size,mime,original_name,created_at FROM assets WHERE sha256=?");
      for (const id of attachmentIds) {
        const row = existing.get(id);
        if (row) copy.run(row.sha256, row.size, row.mime, row.original_name, row.created_at);
      }
    }
    db.exec("COMMIT");
  } catch (error) {
    if (db.isTransaction) db.exec("ROLLBACK");
    throw error;
  } finally { db.close(); }
}

function selectedFiles(context, { restoreWorkspace, restoreVault, conversationFile }, staging) {
  const stamp = backupDate(context.now).toISOString().replace(/[:.]/g, "-");
  return [
    ...(restoreWorkspace ? [{ name: "workspace.db", service: context.workspaceService, corrupt: context.workspaceService?.status().readOnlyError === true }] : []),
    ...(restoreVault ? [{ name: "vault.db", service: context.vaultService, vault: true }] : []),
    ...(conversationFile ? [{ name: "assistant-conversations.sqlite", file: conversationFile }] : []),
  ].map((entry) => {
    const target = assertPhysicalPath(entry.file ?? path.join(context.dataRoot, entry.name), { root: context.dataRoot });
    return { ...entry, target, staged: path.join(staging, entry.name), replaced: `${target}.${entry.corrupt ? "corrupt" : "replaced"}-${stamp}-${randomUUID()}`, original: path.join(staging, `original-${entry.name}`) };
  });
}

async function swapStagedDatabases(staging, options, context) {
  const conversations = options.restoreWorkspace ? context.conversations ?? createAssistantConversationStore({ dataRoot: context.dataRoot }) : null;
  const entries = selectedFiles(context, { ...options, conversationFile: options.assistantArchive ? conversations.databasePath : undefined }, staging);
  const changed = [];
  let frozen = false;
  let conversationsFrozen = false;
  let closed = false;
  let recoveryFailed = false;
  try {
    if (options.restoreWorkspace) { context.workspaceService?.suspendWrites(); frozen = true; }
    if (conversations) {
      conversations.suspendWrites();
      conversationsFrozen = true;
    }
    if (options.restoreWorkspace) {
      const attachmentIds = options.workspaceRescue ? [] : conversations?.listAttachmentAssetIds() ?? [];
      preserveLocalAssets(path.join(staging, "workspace.db"), context.workspaceService, attachmentIds, options.workspaceRescue);
    }
    if (conversations && options.assistantArchive) {
      const assistant = entries.find((entry) => entry.file);
      conversations.stageBackup(options.assistantArchive, assistant.staged);
      fs.mkdirSync(path.dirname(assistant.target), { recursive: true, mode: 0o700 });
    }
    if (options.restoreVault) context.vaultService?.lock("restored");
    const hasCurrentWorkspace = options.restoreWorkspace && context.workspaceService?.status().loaded && !context.workspaceService.status().readOnlyError;
    const hasCurrentVault = options.restoreVault && context.vaultService?.status().exists;
    if (hasCurrentWorkspace || hasCurrentVault) {
      const create = context.snapshotService?.createSnapshot ?? context.createSnapshot;
      if (typeof create !== "function") throw new StorageError("E_IO", "恢复前快照服务不可用，未替换当前数据");
      await create({ reason: "pre-restore", restoreWorkspace: Boolean(hasCurrentWorkspace), restoreVault: Boolean(hasCurrentVault) });
    }
    for (const entry of entries) {
      if (!fs.existsSync(entry.target)) continue;
      fs.copyFileSync(entry.target, entry.original, fs.constants.COPYFILE_EXCL);
      const wal = assertPhysicalPath(`${entry.target}-wal`, { root: context.dataRoot });
      if (fs.existsSync(wal) && fs.statSync(wal).size) fs.copyFileSync(wal, `${entry.original}-wal`, fs.constants.COPYFILE_EXCL);
    }
    closed = true;
    for (const entry of entries) {
      if (entry.vault) entry.service?.closeDatabase();
      else if (entry.service?.status().loaded) { entry.service.checkpoint(); entry.service.close(); }
      else entry.service?.close();
    }
    for (const entry of entries) {
      if (fs.existsSync(assertPhysicalPath(`${entry.target}-wal`, { root: context.dataRoot })) || fs.existsSync(assertPhysicalPath(`${entry.target}-shm`, { root: context.dataRoot }))) throw new StorageError("E_IO", "数据库仍有未关闭的连接，未交换数据文件");
      if (entry.file && fs.existsSync(assertPhysicalPath(`${entry.target}-journal`, { root: context.dataRoot }))) throw new StorageError("E_IO", "助手对话数据库仍有未关闭的连接，未交换数据文件");
    }
    for (const entry of entries) {
      if (fs.existsSync(entry.target)) { fs.renameSync(entry.target, entry.replaced); entry.hadOriginal = true; }
      changed.push(entry);
      context.injectFailure?.("restore-swap");
      fs.renameSync(entry.staged, entry.target);
      entry.installed = true;
    }
    if (options.restoreWorkspace) await context.workspaceService?.reopen();
    if (options.restoreVault) await context.vaultService?.reopenDatabase();
    for (const entry of entries) if (entry.hadOriginal && !entry.corrupt) {
      try { fs.unlinkSync(assertPhysicalPath(entry.replaced, { root: context.dataRoot })); }
      catch (error) { logBackup(context.logger, "backup.cleanup-deferred", { source: path.basename(entry.replaced), code: error.code || "E_IO" }); }
    }
    return true;
  } catch (error) {
    if (changed.length) {
      for (const entry of entries) {
        try {
          if (entry.vault) entry.service?.closeDatabase();
          else entry.service?.close();
        } catch { recoveryFailed = true; }
      }
      if (entries.some((entry) => fs.existsSync(`${entry.target}-wal`) || fs.existsSync(`${entry.target}-shm`))) recoveryFailed = true;
      if (!recoveryFailed) {
        try {
          for (const entry of [...entries].reverse()) {
            if (fs.existsSync(entry.original)) {
              fs.copyFileSync(entry.original, entry.target);
              if (fs.existsSync(`${entry.original}-wal`)) fs.copyFileSync(`${entry.original}-wal`, `${entry.target}-wal`);
            } else if (entry.installed && fs.existsSync(entry.target)) fs.unlinkSync(assertPhysicalPath(entry.target, { root: context.dataRoot }));
            if (entry.hadOriginal && fs.existsSync(entry.replaced)) fs.unlinkSync(assertPhysicalPath(entry.replaced, { root: context.dataRoot }));
          }
        } catch { recoveryFailed = true; }
      }
      if (recoveryFailed) {
        const failure = new StorageError("E_IO", "恢复回滚未完成，原始数据库与恢复文件已保留，请勿删除暂存目录");
        failure.recoveryDirectory = staging;
        throw failure;
      }
    }
    if (closed || changed.length) {
      for (const entry of entries) {
        if (entry.corrupt) continue;
        try {
          if (entry.vault) await entry.service?.reopenDatabase();
          else if (fs.existsSync(entry.target)) await entry.service?.reopen();
        } catch {
          if (changed.length) {
            recoveryFailed = true;
            const failure = new StorageError("E_IO", "原始数据库已保留，但重新打开失败，请勿删除暂存目录");
            failure.recoveryDirectory = staging;
            throw failure;
          }
        }
      }
    }
    throw error?.code?.startsWith("E_") ? error : new StorageError("E_IO", "恢复交换失败，原数据已保留");
  } finally {
    if (!recoveryFailed) {
      if (conversationsFrozen) conversations.resumeWrites();
      if (frozen) context.workspaceService?.resumeWrites();
    }
  }
}

export async function inspectBackupFile(filePath, options = {}) {
  return (options.inspector ?? fallbackInspector).inspectFile(filePath, options);
}

export async function restoreFromToken(token, context) {
  const inspector = context.inspector ?? fallbackInspector;
  const record = inspector.consumeToken(token, { now: context.now });
  let staging;
  let reader;
  let db;
  let preserveStaging = false;
  let swapped = false;
  const time = backupDate(context.now).toISOString();
  try {
    const fingerprint = await sha256File(record.filePath);
    if (fingerprint.size !== record.fingerprint.size || fingerprint.sha256 !== record.fingerprint.sha256) throw new StorageError("E_CORRUPT", "备份文件在选择后发生变化，请重新检查");
    const report = await verifyBackupFile(record.filePath, { currentSchemaVersion: CURRENT_SCHEMA_VERSION, fileName: record.fileName, encrypted: record.report.summary.encrypted });
    if (!report.ok) throw new StorageError("E_CORRUPT", "备份校验失败，当前数据未修改");
    const restoreVault = context.restoreVault === true || context.initialSetup === true && report.manifest.vault.included;
    if (restoreVault && !report.manifest.vault.included) throw new StorageError("E_INVALID_ARGUMENT", "备份中没有密钥库");
    if (restoreVault && !context.vaultService) throw new StorageError("E_INVALID_ARGUMENT", "密钥库恢复服务不可用");
    if (!context.workspaceService) throw new StorageError("E_INVALID_ARGUMENT", "工作区恢复服务不可用");
    await loadCurrentWorkspace(context);
    staging = createStagingDirectory(context.dataRoot, ".staging-");
    reader = await openZipFileReader(record.filePath);
    const files = new Map();
    for (const entry of report.manifest.files) if (entry.path === "workspace/meta.json" || entry.path.startsWith("workspace/entities/")) files.set(entry.path, await checkedRead(reader, report.manifest, entry.path));
    const source = filesToWorkspace((entryPath) => files.get(entryPath));
    let workspace = source.schemaVersion < CURRENT_SCHEMA_VERSION ? normalizeLoadedWorkspace(source, { fallbackWorkspace: source, now: time, idFactory: context.idFactory }) : source;
    db = openWorkspaceDatabase(path.join(staging, "workspace.db"));
    prepareStagingWorkspace(db);
    const store = createAssetStore({ assetsDir: path.join(context.dataRoot, "assets"), db, now: time });
    const assetIndex = parseJsonBytes(await checkedRead(reader, report.manifest, "assets/index.json"));
    let done = 0;
    for (const asset of assetIndex) {
      await copyAsset(reader, asset, store, db);
      context.onProgress?.({ phase: "assets", done: ++done, total: assetIndex.length });
    }
    let conversion = null;
    if (report.summary.platform === "browser") {
      const result = await convertBrowserPackage(workspace, assetIndex, { putAsset: (bytes, metadata) => store.put({ bytes, mime: metadata.mime, name: metadata.name }) });
      if (result.report.leftovers.length) throw new StorageError("E_CORRUPT", "浏览器备份包含无法转换的本地附件引用");
      workspace = result.workspace;
      conversion = result.report;
    }
    initializeWorkspace(db, workspace, { now: time, generation: context.idFactory?.("gen") ?? `gen-${randomUUID()}` });
    preserveCurrentMeta(db, context.workspaceService);
    checkIntegrity(db);
    const assembled = assembleWorkspace(readAllRows(db));
    for (const collection of BACKUP_COLLECTIONS) if ((assembled[collection]?.length ?? 0) !== (workspace[collection]?.length ?? 0)) throw new StorageError("E_CORRUPT", "暂存工作区的实体数量不符");
    db.close();
    db = undefined;
    if (restoreVault) stageVaultDatabase(path.join(staging, "vault.db"), parseJsonBytes(await checkedRead(reader, report.manifest, "vault/vault.json")));
    const assistantBytes = await checkedRead(reader, report.manifest, ASSISTANT_ARCHIVE_PATH);
    const assistantArchive = assistantBytes && parseJsonBytes(assistantBytes);
    reader.close();
    reader = undefined;
    context.onProgress?.({ phase: "swap", done: 0, total: 1 });
    await swapStagedDatabases(staging, { restoreWorkspace: true, restoreVault, assistantArchive, workspaceRescue: report.manifest.scope === WORKSPACE_RESCUE_SCOPE }, context);
    swapped = true;
    await context.reloadWorkspace?.();
    logBackup(context.logger, "backup.restore", { source: record.fileName, ok: true, ...countsOf(workspace), convertedAttachments: conversion?.convertedAttachments ?? 0, convertedDataUrls: conversion?.convertedDataUrls ?? 0, schemaBefore: source.schemaVersion, schemaAfter: workspace.schemaVersion });
    return { restoredAt: time };
  } catch (error) {
    preserveStaging = error.recoveryDirectory === staging;
    logBackup(context.logger, "backup.restore", { source: record.fileName, ok: swapped, reloadFailed: swapped, code: error.code || "E_IO" });
    throw error?.code?.startsWith("E_") ? error : new StorageError("E_IO", swapped ? "数据已恢复，但界面重新加载失败，请重新启动 Life Atlas" : "恢复失败，原数据未被替换");
  } finally {
    db?.close();
    reader?.close();
    if (staging && !preserveStaging) removeScopedDirectory(staging, context.dataRoot);
    inspector.release(record);
  }
}

export async function restoreFromSnapshot(snapshotId, options, context) {
  if (!options || typeof options.restoreWorkspace !== "boolean" || typeof options.restoreVault !== "boolean" || !options.restoreWorkspace && !options.restoreVault) throw new StorageError("E_INVALID_ARGUMENT", "请选择要恢复的内容");
  const metadata = readSnapshotMetadata(context.dataRoot, snapshotId);
  const selected = [options.restoreWorkspace ? "workspace.db" : null, options.restoreVault ? "vault.db" : null].filter(Boolean);
  if (metadata.reason === "vault-reset" && options.restoreWorkspace || selected.some((name) => !metadata.files.some((entry) => entry.name === name))) throw new StorageError("E_INVALID_ARGUMENT", "快照中没有所选的数据库");
  const directory = snapshotDirectory(context.dataRoot, snapshotId);
  const time = backupDate(context.now).toISOString();
  const staging = createStagingDirectory(context.dataRoot, ".staging-");
  const workspaceFile = path.join(staging, "workspace.db");
  let workspace;
  let preserveStaging = false;
  let swapped = false;
  try {
    for (const entry of metadata.files) {
      const source = assertPhysicalPath(path.join(directory, entry.name), { root: directory, allowMissing: false });
      const file = selected.includes(entry.name) ? path.join(staging, entry.name) : source;
      if (file !== source) fs.copyFileSync(source, file, fs.constants.COPYFILE_EXCL);
      const actual = await sha256File(file);
      if (actual.size !== entry.size || actual.sha256 !== entry.sha256) throw new StorageError("E_CORRUPT", "快照文件校验失败，当前数据未修改");
    }
    if (options.restoreWorkspace) {
      const db = openWorkspaceDatabase(workspaceFile, { readOnly: true });
      try {
        let schemaVersion;
        try { schemaVersion = JSON.parse(db.prepare("SELECT value FROM meta WHERE key='schemaVersion'").get()?.value ?? "null"); }
        catch { throw new StorageError("E_CORRUPT", "快照工作区版本无效"); }
        if (Number.isSafeInteger(schemaVersion) && schemaVersion > CURRENT_SCHEMA_VERSION) throw new StorageError("E_UNSUPPORTED_VERSION", "此快照需要更新版本的 Life Atlas");
        workspace = assembleWorkspace(readAllRows(db));
        const store = createAssetStore({ assetsDir: path.join(context.dataRoot, "assets"), db, now: time });
        for (const asset of db.prepare("SELECT sha256,size FROM assets").all()) {
          const actual = await sha256File(store.filePath(asset.sha256));
          if (actual.sha256 !== asset.sha256 || actual.size !== asset.size) throw new StorageError("E_CORRUPT", "快照引用的附件文件缺失或损坏");
        }
      } finally { db.close(); }
    }
    if (options.restoreVault) {
      const db = openWorkspaceDatabase(path.join(staging, "vault.db"), { readOnly: true });
      try {
        const header = readHeader(db);
        if (header?.kind === "life-atlas-vault" && Number.isSafeInteger(header.formatVersion) && header.formatVersion > VAULT_FORMAT_VERSION) {
          throw new StorageError("E_UNSUPPORTED_VERSION", "快照密钥库需要更新版本的 Life Atlas");
        }
        if (!validateVaultHeader(header)) throw new StorageError("E_CORRUPT", "快照密钥库头部无效");
        validateSettingsPatch(JSON.parse(getState(db, "settings") || "{}"));
        for (const id of listItemIds(db)) if (getItemBlob(db, id).length < 28) throw new StorageError("E_CORRUPT", "快照密钥库条目无效");
        checkIntegrity(db);
      } finally { db.close(); }
    }
    if (options.restoreWorkspace) {
      if (workspace.schemaVersion < CURRENT_SCHEMA_VERSION) workspace = normalizeLoadedWorkspace(workspace, { fallbackWorkspace: workspace, now: time, idFactory: context.idFactory });
      const db = openWorkspaceDatabase(workspaceFile);
      try {
        db.exec("PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;");
        replaceDatabaseWorkspace(db, workspace, { now: time, generation: context.idFactory?.("gen") ?? `gen-${randomUUID()}` });
        checkIntegrity(db);
        await loadCurrentWorkspace(context);
        preserveCurrentMeta(db, context.workspaceService);
      } finally { db.close(); }
    }
    await swapStagedDatabases(staging, options, context);
    swapped = true;
    if (options.restoreWorkspace) await context.reloadWorkspace?.();
    logBackup(context.logger, "backup.restore", { source: snapshotId, ok: true, ...(workspace ? countsOf(workspace) : {}), snapshot: true });
    return { restoredAt: time };
  } catch (error) {
    preserveStaging = error.recoveryDirectory === staging;
    logBackup(context.logger, "backup.restore", { source: snapshotId, ok: swapped, reloadFailed: swapped, code: error.code || "E_IO", snapshot: true });
    throw error?.code?.startsWith("E_") ? error : new StorageError("E_IO", swapped ? "快照已恢复，但界面重新加载失败，请重新启动 Life Atlas" : "快照恢复失败，原数据未被替换");
  } finally { if (!preserveStaging) removeScopedDirectory(staging, context.dataRoot); }
}
