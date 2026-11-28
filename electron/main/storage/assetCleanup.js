import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { assertPhysicalPath, writeAtomicJson } from "./dataRoot.js";
import { StorageError, openWorkspaceDatabase, quickCheck, readAllRows, assembleWorkspace, readAssetRows, deleteAssetRows, restoreAssetRows } from "./workspaceDb.js";
import { readSnapshotMetadata } from "./snapshots.js";
import { sha256File } from "../backup/files.js";
import { createMarketArchiveRemoval, marketMimes } from "./marketArchives.js";

const SHA256 = /^[a-f0-9]{64}$/;
const TRASH_ID = /^\d{8}-\d{6}-[a-f0-9]{4}$/;
const RETENTION_MS = 30 * 86400000;

function timestampMillis(value) {
  const numeric = typeof value === "string" && /^-?\d+(?:\.\d+)?$/.test(value) ? Number(value) : value;
  const time = new Date(numeric).getTime();
  if (!["string", "number"].includes(typeof value) || !Number.isFinite(time)) throw new StorageError("E_IO", "附件时间记录无法读取");
  return time;
}

export function collectAssetReferences(jsonTexts) {
  const hashes = new Set();
  for (const text of jsonTexts) {
    for (const match of text.matchAll(/life-asset:\/\/([a-f0-9]{64})(?![a-fA-F0-9])/g)) hashes.add(match[1]);
  }
  return hashes;
}

export function collectAttachmentReferences(attachments, jsonTexts) {
  const hashes = new Set();
  for (const attachment of attachments) {
    if (attachment?.provider !== "asset" || !SHA256.test(attachment.storageKey ?? "") || typeof attachment.id !== "string") continue;
    const id = JSON.stringify(attachment.id);
    if (jsonTexts.some((text) => text.includes(id))) hashes.add(attachment.storageKey);
  }
  return hashes;
}

export function unreferencedAssets(assetRows, referenced) {
  return assetRows.filter((row) => !referenced.has(row.sha256));
}

export function trashBatchId(nowMs, randomHex4) {
  if (typeof randomHex4 !== "string" || !/^[a-f0-9]{4}$/.test(randomHex4)) throw new StorageError("E_INVALID_ARGUMENT", "附件回收站批次随机值无效");
  const iso = new Date(timestampMillis(nowMs)).toISOString();
  return `${iso.slice(0, 10).replace(/-/g, "")}-${iso.slice(11, 19).replace(/:/g, "")}-${randomHex4}`;
}

export function expiredBatches(batches, nowMs) {
  const cutoff = timestampMillis(nowMs) - RETENTION_MS;
  return batches.filter((batch) => timestampMillis(batch.createdAt) < cutoff);
}

function databaseReferences(db) {
  const rows = readAllRows(db);
  assembleWorkspace(rows);
  const texts = [...rows.entities.values()].flatMap((entities) => [...entities.values()]);
  const attachmentTexts = [...(rows.entities.get("attachments")?.values() ?? [])];
  const otherTexts = [...rows.entities].filter(([collection]) => collection !== "attachments").flatMap(([, entities]) => [...entities.values()]);
  return new Set([...collectAssetReferences(texts), ...collectAttachmentReferences(attachmentTexts.map((text) => JSON.parse(text)), otherTexts)]);
}

function operationError(error, message) {
  return error?.code?.startsWith("E_") ? error : new StorageError("E_IO", message);
}

function validateTrashIndex(index) {
  timestampMillis(index?.createdAt);
  if (!Array.isArray(index?.items) || !index.items.length) throw new StorageError("E_IO", "附件回收站记录无效");
  const hashes = new Set();
  for (const row of index.items) {
    if (!row || !SHA256.test(row.sha256 ?? "") || hashes.has(row.sha256) || !Number.isSafeInteger(row.size) || row.size < 0
      || typeof row.mime !== "string" || row.mime.length > 200 || /[\r\n\0]/.test(row.mime)
      || row.originalName !== null && (typeof row.originalName !== "string" || row.originalName.length > 255 || /[\r\n\0]/.test(row.originalName))) throw new StorageError("E_IO", "附件回收站记录无效");
    timestampMillis(row.createdAt);
    hashes.add(row.sha256);
  }
  return index;
}

export function createAssetCleanupService({ dataRoot, db, now = Date.now, randomHex4 = () => randomBytes(2).toString("hex"), requestFlush, additionalReferences, installedMarketAssets } = {}) {
  const root = assertPhysicalPath(dataRoot);
  const assetsDir = assertPhysicalPath(path.join(root, "assets"), { root });
  const trashRoot = assertPhysicalPath(path.join(root, "asset-trash"), { root });
  let suspended = false;
  let chain = Promise.resolve();
  const instant = () => timestampMillis(typeof now === "function" ? now() : now);
  const connection = () => {
    const value = typeof db === "function" ? db() : db;
    if (!value) throw new StorageError("E_IO", "附件数据库尚未就绪");
    return value;
  };
  const assertAvailable = () => { if (suspended) throw new StorageError("E_CONFLICT", "数据目录正在更换，暂时不能清理附件"); };
  const flush = async () => { if (typeof requestFlush === "function" && await requestFlush() === false) throw new StorageError("E_IO", "保存尚未完成，未扫描或移动任何附件"); };
  const enqueue = (operation) => {
    try { assertAvailable(); } catch (error) { return Promise.reject(error); }
    const pending = chain.then(operation);
    chain = pending.catch(() => {});
    return pending;
  };
  const assetFile = (sha256) => {
    if (!SHA256.test(sha256 ?? "")) throw new StorageError("E_INVALID_ARGUMENT", "附件标识无效");
    return assertPhysicalPath(path.join(assetsDir, sha256.slice(0, 2), sha256), { root: assetsDir });
  };
  const batchDirectory = (trashId) => {
    if (typeof trashId !== "string" || !TRASH_ID.test(trashId)) throw new StorageError("E_INVALID_ARGUMENT", "附件回收站批次无效");
    return assertPhysicalPath(path.join(trashRoot, trashId), { root: trashRoot });
  };
  const readBatch = (trashId) => {
    const directory = batchDirectory(trashId);
    if (!fs.existsSync(directory)) throw new StorageError("E_NOT_FOUND", "附件回收站批次不存在");
    try {
      const index = assertPhysicalPath(path.join(directory, "index.json"), { root: directory, allowMissing: false });
      return validateTrashIndex(JSON.parse(fs.readFileSync(index, "utf8")));
    } catch (error) { throw operationError(error, "附件回收站记录无法读取，未删除任何文件"); }
  };
  const visitSnapshots = (visit) => {
    const snapshotsDir = assertPhysicalPath(path.join(root, "snapshots"), { root });
    if (fs.existsSync(snapshotsDir)) {
      for (const entry of fs.readdirSync(snapshotsDir, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
        if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
        let snapshotDb;
        try {
          const directory = assertPhysicalPath(path.join(snapshotsDir, entry.name), { root: snapshotsDir, allowMissing: false });
          const file = assertPhysicalPath(path.join(directory, "workspace.db"), { root: directory });
          if (!fs.existsSync(file)) {
            const metadata = readSnapshotMetadata(root, entry.name);
            if (metadata.files.some((item) => item.name === "workspace.db")) throw new Error("missing snapshot database");
            continue;
          }
          const wal = assertPhysicalPath(`${file}-wal`, { root: directory });
          if (fs.existsSync(wal) && fs.statSync(wal).size > 0) throw new Error("snapshot contains an unexpected WAL");
          snapshotDb = openWorkspaceDatabase(file, { readOnly: true, immutable: true });
          if (quickCheck(snapshotDb) !== "ok") throw new Error("snapshot integrity failed");
          visit(snapshotDb);
        } catch {
          throw new StorageError("E_IO", `快照 ${entry.name} 无法读取，为安全起见暂不清理附件`);
        } finally { snapshotDb?.close(); }
      }
    }
  };
  const scanReferences = () => {
    assertAvailable();
    const references = databaseReferences(connection());
    for (const hash of additionalReferences?.() ?? []) references.add(hash);
    for (const hash of installedMarketAssets?.() ?? []) references.add(hash);
    for (const mime of marketMimes) {
      for (const row of connection().prepare("SELECT sha256 FROM assets WHERE mime=?").all(`${mime};installed=0`)) references.add(row.sha256);
    }
    visitSnapshots((snapshot) => { for (const hash of databaseReferences(snapshot)) references.add(hash); });
    const candidates = unreferencedAssets(readAssetRows(connection()), references);
    candidates.forEach((row) => timestampMillis(row.createdAt));
    candidates.sort((left, right) => timestampMillis(left.createdAt) - timestampMillis(right.createdAt) || left.sha256.localeCompare(right.sha256));
    return { candidates };
  };
  const verifyAsset = async (file, row) => {
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new StorageError("E_IO", "附件文件无法读取，未删除任何文件");
    const fingerprint = await sha256File(file);
    if (fingerprint.size !== row.size || fingerprint.sha256 !== row.sha256) throw new StorageError("E_CORRUPT", "附件文件校验失败，未覆盖或删除原文件");
  };
  const marketArchives = createMarketArchiveRemoval({ root, connection, assetFile, verifyAsset, visitSnapshots, additionalReferences });
  const listTrash = () => {
    assertAvailable();
    if (!fs.existsSync(trashRoot)) return { batches: [] };
    const batches = [];
    for (const entry of fs.readdirSync(trashRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      const index = readBatch(entry.name);
      const createdAt = timestampMillis(index.createdAt);
      batches.push({ trashId: entry.name, createdAt: new Date(createdAt).toISOString(), count: index.items.length, sizeBytes: index.items.reduce((size, row) => size + row.size, 0), expiresAt: new Date(createdAt + RETENTION_MS).toISOString() });
    }
    batches.sort((left, right) => timestampMillis(right.createdAt) - timestampMillis(left.createdAt) || left.trashId.localeCompare(right.trashId));
    return { batches };
  };
  const moveToTrash = ({ sha256s } = {}) => enqueue(async () => {
    if (!Array.isArray(sha256s) || !sha256s.length || new Set(sha256s).size !== sha256s.length || sha256s.some((sha256) => typeof sha256 !== "string" || !SHA256.test(sha256))) throw new StorageError("E_INVALID_ARGUMENT", "请选择有效的附件");
    await flush();
    const selected = new Set(sha256s);
    const initial = scanReferences().candidates.filter((row) => selected.has(row.sha256));
    for (const row of initial) await verifyAsset(assetFile(row.sha256), row);
    const available = new Map(scanReferences().candidates.map((row) => [row.sha256, row]));
    const items = initial.filter((row) => available.has(row.sha256));
    if (!items.length) return { trashId: null, movedCount: 0 };
    fs.mkdirSync(trashRoot, { recursive: true });
    let trashId;
    let directory;
    for (let attempt = 0; attempt < 16; attempt += 1) {
      trashId = trashBatchId(instant(), randomHex4());
      directory = batchDirectory(trashId);
      if (!fs.existsSync(directory)) break;
      directory = undefined;
    }
    if (!directory) throw new StorageError("E_IO", "无法创建附件回收站批次");
    fs.mkdirSync(directory);
    const moved = [];
    const indexFile = assertPhysicalPath(path.join(directory, "index.json"), { root: directory });
    try {
      writeAtomicJson(indexFile, { createdAt: new Date(instant()).toISOString(), items });
      for (const row of items) {
        const source = assetFile(row.sha256);
        const target = assertPhysicalPath(path.join(directory, row.sha256), { root: directory });
        fs.renameSync(source, target);
        moved.push({ source, target });
      }
      deleteAssetRows(connection(), items.map((row) => row.sha256));
      return { trashId, movedCount: items.length };
    } catch (error) {
      let rollbackError;
      for (const item of moved.reverse()) {
        try { fs.renameSync(assertPhysicalPath(item.target, { root: directory }), assertPhysicalPath(item.source, { root: assetsDir })); } catch (failure) { rollbackError = failure; }
      }
      if (!rollbackError) {
        if (fs.existsSync(indexFile)) fs.unlinkSync(indexFile);
        fs.rmdirSync(directory);
      }
      throw operationError(rollbackError || error, "附件没有完成移动，已保留可恢复的原文件");
    }
  });
  const restoreTrash = ({ trashId } = {}) => enqueue(async () => {
    connection();
    const index = readBatch(trashId);
    const directory = batchDirectory(trashId);
    const entries = index.items.map((row) => ({ row, source: assertPhysicalPath(path.join(directory, row.sha256), { root: directory }), target: assetFile(row.sha256) }));
    for (const item of entries) {
      if (fs.existsSync(item.source)) await verifyAsset(item.source, item.row);
      else if (!fs.existsSync(item.target)) throw new StorageError("E_IO", "回收站附件文件不存在，未删除批次");
      if (fs.existsSync(item.target)) await verifyAsset(item.target, item.row);
    }
    const moved = [];
    try {
      for (const item of entries) {
        if (fs.existsSync(item.target)) continue;
        fs.mkdirSync(path.dirname(item.target), { recursive: true });
        fs.renameSync(item.source, item.target);
        moved.push(item);
      }
      restoreAssetRows(connection(), index.items);
    } catch (error) {
      let rollbackError;
      for (const item of moved.reverse()) {
        try { fs.renameSync(assertPhysicalPath(item.target, { root: assetsDir }), assertPhysicalPath(item.source, { root: directory })); } catch (failure) { rollbackError = failure; }
      }
      throw operationError(rollbackError || error, "附件恢复失败，回收站副本已保留");
    }
    for (const item of entries) if (fs.existsSync(item.source)) fs.unlinkSync(assertPhysicalPath(item.source, { root: directory }));
    fs.unlinkSync(assertPhysicalPath(path.join(directory, "index.json"), { root: directory, allowMissing: false }));
    fs.rmdirSync(directory);
    return { restoredCount: index.items.length };
  });
  return {
    scanUnreferenced: async () => { assertAvailable(); await flush(); return scanReferences(); },
    moveToTrash,
    removeMarketArchive: (record) => enqueue(async () => { await flush(); return marketArchives.remove(record); }),
    listTrash,
    restoreTrash,
    purgeExpired: () => enqueue(() => {
      const expired = expiredBatches(listTrash().batches, instant());
      for (const batch of expired) {
        const directory = batchDirectory(batch.trashId);
        fs.rmSync(assertPhysicalPath(directory, { root: trashRoot, allowMissing: false }), { recursive: true, force: true });
      }
      return marketArchives.reclaim().then(() => ({ deletedCount: expired.length }));
    }),
    start() { suspended = false; },
    stop() { suspended = true; return chain; },
  };
}
