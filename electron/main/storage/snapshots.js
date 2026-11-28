import fs from "node:fs";
import path from "node:path";
import { backup as backupDatabase } from "node:sqlite";
import { assertPhysicalPath, isPathInside, writeAtomicJson } from "./dataRoot.js";
import { openWorkspaceDatabase, StorageError } from "./workspaceDb.js";
import { COUNT_COLLECTIONS } from "../../../src/backup/manifest.js";
import { selectSnapshotsToDelete } from "../../../src/backup/snapshotRetention.js";
import { backupDate, sha256File, logBackup } from "../backup/files.js";

export { selectSnapshotsToDelete };
const reasons = new Set(["daily", "pre-upgrade", "pre-migration", "pre-restore", "manual", "vault-reset"]);
const names = new Set(["workspace.db", "vault.db"]);
const validId = (id) => typeof id === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(id);

export function snapshotDirectory(dataRoot, id) {
  if (!validId(id)) throw new StorageError("E_INVALID_ARGUMENT", "快照 ID 无效");
  const root = assertPhysicalPath(path.join(assertPhysicalPath(dataRoot), "snapshots"));
  return assertPhysicalPath(path.join(root, id), { root });
}

export function readSnapshotMetadata(dataRoot, id) {
  const directory = snapshotDirectory(dataRoot, id);
  const file = assertPhysicalPath(path.join(directory, "snapshot.json"), { root: directory, allowMissing: false });
  const metadata = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!metadata || !reasons.has(metadata.reason) || !Number.isFinite(Date.parse(metadata.createdAt)) || typeof metadata.appVersion !== "string"
    || metadata.schemaVersion !== null && (!Number.isSafeInteger(metadata.schemaVersion) || metadata.schemaVersion < 1)
    || !metadata.counts || typeof metadata.counts !== "object" || Array.isArray(metadata.counts)
    || !Array.isArray(metadata.files) || !metadata.files.length || ![undefined, null, "ok", "failed"].includes(metadata.integrity)) {
    throw new StorageError("E_CORRUPT", "快照记录无效");
  }
  const seen = new Set();
  for (const entry of metadata.files) {
    if (!names.has(entry?.name) || seen.has(entry.name) || !Number.isSafeInteger(entry.size) || entry.size < 0 || !/^[a-f0-9]{64}$/.test(entry.sha256 ?? "")) throw new StorageError("E_CORRUPT", "快照文件记录无效");
    const target = assertPhysicalPath(path.join(directory, entry.name), { root: directory, allowMissing: false });
    if (!fs.statSync(target).isFile() || fs.statSync(target).size !== entry.size) throw new StorageError("E_CORRUPT", "快照文件大小不符");
    seen.add(entry.name);
  }
  return metadata;
}

function snapshotEntry(id, metadata) {
  return {
    id, createdAt: metadata.createdAt, reason: metadata.reason, appVersion: metadata.appVersion, schemaVersion: metadata.schemaVersion,
    sizeBytes: metadata.files.reduce((total, entry) => total + entry.size, 0),
    includesWorkspace: metadata.files.some((entry) => entry.name === "workspace.db"),
    includesVault: metadata.files.some((entry) => entry.name === "vault.db"),
    integrity: metadata.integrity ?? null,
  };
}

export function listSnapshots(dataRoot, { logger } = {}) {
  const directory = assertPhysicalPath(path.join(assertPhysicalPath(dataRoot), "snapshots"));
  if (!fs.existsSync(directory)) return [];
  const snapshots = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || !validId(entry.name)) continue;
    try { snapshots.push(snapshotEntry(entry.name, readSnapshotMetadata(dataRoot, entry.name))); }
    catch { logBackup(logger, "snapshot.skipped", { id: entry.name, code: "E_CORRUPT" }); }
  }
  return snapshots.sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt) || (left.id < right.id ? 1 : left.id > right.id ? -1 : 0));
}

export async function writeSnapshotMetadata({ directory, createdAt, reason, appVersion, schemaVersion, counts = {}, integrity = null }) {
  const target = assertPhysicalPath(directory, { allowMissing: false });
  if (!reasons.has(reason)) throw new StorageError("E_INVALID_ARGUMENT", "快照原因无效");
  const files = [];
  for (const name of names) {
    const file = assertPhysicalPath(path.join(target, name), { root: target });
    if (fs.existsSync(file)) files.push({ name, ...await sha256File(file) });
  }
  if (!files.length) throw new StorageError("E_INVALID_ARGUMENT", "快照中没有数据库");
  const metadata = { createdAt: backupDate(createdAt).toISOString(), reason, appVersion, schemaVersion: schemaVersion ?? null, counts, files, integrity };
  writeAtomicJson(path.join(target, "snapshot.json"), metadata);
  return snapshotEntry(path.basename(target), metadata);
}

function integrityOf(file) {
  let db;
  try {
    db = openWorkspaceDatabase(file, { readOnly: true, immutable: true });
    const result = db.prepare("PRAGMA integrity_check").all();
    return result.length === 1 && Object.values(result[0])[0] === "ok" ? "ok" : "failed";
  } catch { return "failed"; }
  finally { db?.close(); }
}

export async function createSnapshot({ dataRoot, reason, databases, appVersion, schemaVersion, counts = {}, now, logger }) {
  if (!reasons.has(reason) || !Array.isArray(databases) || !databases.length) throw new StorageError("E_INVALID_ARGUMENT", "快照参数无效");
  const unique = new Set();
  for (const entry of databases) {
    if (!names.has(entry?.name) || unique.has(entry.name) || !entry.db && typeof entry.snapshotTo !== "function") throw new StorageError("E_INVALID_ARGUMENT", "快照数据库无效");
    unique.add(entry.name);
  }
  const root = assertPhysicalPath(path.join(assertPhysicalPath(dataRoot), "snapshots"));
  fs.mkdirSync(root, { recursive: true });
  const createdAt = backupDate(now).toISOString();
  const base = `${createdAt.replace(/[:.]/g, "-")}-${reason}`;
  let id = base;
  for (let suffix = 1; fs.existsSync(snapshotDirectory(dataRoot, id)); suffix += 1) id = `${base}-${String(suffix).padStart(3, "0")}`;
  const directory = snapshotDirectory(dataRoot, id);
  fs.mkdirSync(directory);
  let snapshot;
  try {
    for (const entry of databases) {
      const target = assertPhysicalPath(path.join(directory, entry.name), { root: directory });
      if (entry.db) await backupDatabase(entry.db, target);
      else await entry.snapshotTo(target);
    }
    const integrity = reason === "daily" && unique.has("workspace.db") ? integrityOf(path.join(directory, "workspace.db")) : null;
    snapshot = await writeSnapshotMetadata({ directory, createdAt, reason, appVersion, schemaVersion, counts, integrity });
  } catch (error) {
    const target = assertPhysicalPath(directory, { root });
    if (isPathInside(root, target)) fs.rmSync(target, { recursive: true, force: true });
    throw error instanceof StorageError ? error : new StorageError("E_IO", "无法创建快照，当前数据未修改");
  }
  if (snapshot.integrity === "failed") {
    logBackup(logger, "snapshot.integrity-failed", { id, reason, fileCount: databases.length, code: "E_CORRUPT" });
    throw new StorageError("E_CORRUPT", "快照完整性检查未通过");
  }
  logBackup(logger, "snapshot.created", { id, reason, fileCount: databases.length });
  return snapshot;
}

export function applyRetention(dataRoot, now, { logger } = {}) {
  const deleted = selectSnapshotsToDelete(listSnapshots(dataRoot, { logger }), now);
  const root = assertPhysicalPath(path.join(dataRoot, "snapshots"));
  for (const id of deleted) {
    const target = snapshotDirectory(dataRoot, id);
    if (!isPathInside(root, target)) throw new StorageError("E_IO", "快照清理路径无效");
    fs.rmSync(target, { recursive: true, force: true });
  }
  return deleted;
}

export async function checkDailySnapshot(options) {
  const { dataRoot, now, logger } = options;
  const latest = listSnapshots(dataRoot, { logger }).find((snapshot) => snapshot.reason === "daily" && snapshot.integrity !== "failed");
  if (latest && backupDate(now).getTime() - Date.parse(latest.createdAt) < 20 * 3600000) return { created: false, id: latest.id };
  const snapshot = await createSnapshot({ ...options, reason: "daily" });
  applyRetention(dataRoot, backupDate(now).toISOString(), { logger });
  return { created: true, id: snapshot.id };
}

export function createSnapshotService({ dataRoot, workspaceService, vaultService, appVersion, now = Date.now, logger, timers = globalThis, onDailyCheck }) {
  let startupTimer;
  let intervalTimer;
  let pending;
  const running = new Set();
  const track = (operation) => {
    const promise = Promise.resolve().then(operation);
    running.add(promise);
    promise.then(() => running.delete(promise), () => running.delete(promise));
    return promise;
  };
  const currentOptions = (options = {}) => {
    const workspace = options.workspace ?? (workspaceService?.status().loaded ? workspaceService.readWorkspace() : null);
    const databases = options.databases ?? [
      ...(options.restoreWorkspace !== false && workspaceService?.db ? [{ name: "workspace.db", db: workspaceService.db }] : []),
      ...(options.restoreVault !== false && vaultService?.status().exists ? [{ name: "vault.db", snapshotTo: (file) => vaultService.snapshotTo(file) }] : []),
    ];
    return { dataRoot, appVersion, now, logger, schemaVersion: workspace?.schemaVersion ?? null, counts: Object.fromEntries(COUNT_COLLECTIONS.map((name) => [name, workspace?.[name]?.length ?? 0])), ...options, databases };
  };
  const checkNow = () => {
    if (!pending) pending = track(async () => {
      try { await onDailyCheck?.(); } catch (error) { logBackup(logger, "asset-trash.cleanup-failed", { errorCode: error.code || "E_IO" }); }
      return checkDailySnapshot(currentOptions());
    }).finally(() => { pending = undefined; });
    return pending;
  };
  const stop = () => {
    if (startupTimer !== undefined) timers.clearTimeout(startupTimer);
    if (intervalTimer !== undefined) timers.clearInterval(intervalTimer);
    startupTimer = undefined;
    intervalTimer = undefined;
    return Promise.allSettled([...running]);
  };
  return {
    createSnapshot: (options = {}) => track(() => createSnapshot(currentOptions({ reason: "manual", ...options }))),
    beforeMigration: (input) => track(() => createSnapshot(currentOptions({ ...input, reason: "pre-migration" }))),
    beforeUpgrade: (input) => track(() => createSnapshot(currentOptions({ ...input, reason: "pre-upgrade", databases: [...input.databases, ...(vaultService?.status().exists ? [{ name: "vault.db", snapshotTo: (file) => vaultService.snapshotTo(file) }] : [])] }))),
    checkNow,
    listSnapshots: () => listSnapshots(dataRoot, { logger }),
    applyRetention: () => applyRetention(dataRoot, backupDate(now).toISOString(), { logger }),
    start() {
      stop();
      const check = () => checkNow().catch((error) => logBackup(logger, "snapshot.failed", { code: error.code || "E_IO" }));
      startupTimer = timers.setTimeout(check, 60000);
      intervalTimer = timers.setInterval(check, 3600000);
      startupTimer?.unref?.();
      intervalTimer?.unref?.();
    },
    stop,
  };
}
