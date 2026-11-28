import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { CURRENT_SCHEMA_VERSION } from "../../../src/persistence/migrations.js";
import { createBlankWorkspace } from "../../../src/domain/blankWorkspace.js";
import { assertPhysicalPath, isPathInside } from "./dataRoot.js";
import { isNonEmptyString } from "../ipc/validate.js";
import { StorageError, openWorkspaceDatabase, quickCheck, prepareWritable, readAllRows, assembleWorkspace, initializeWorkspace, writeWorkspaceDiff, applyChangeset, replaceDatabaseWorkspace, vacuumInto } from "./workspaceDb.js";

export function createWorkspaceService({ dataRoot, now = () => new Date().toISOString(), idFactory = (prefix) => `${prefix}-${randomUUID()}`, normalize, beforeMigration, beforeUpgrade, createSnapshot, appVersion, currentSchemaVersion = CURRENT_SCHEMA_VERSION, logger } = {}) {
  const directory = assertPhysicalPath(dataRoot);
  const filePath = path.join(directory, "workspace.db");
  const timings = { lastLoadMs: 0, lastApplyMs: 0 };
  const instant = () => typeof now === "function" ? now() : now;
  let db;
  let readOnlyError = false;
  let loaded = false;
  let loadPending;
  let inspectionDirectory;
  let writesSuspended = false;
  const clearInspection = () => {
    if (!inspectionDirectory) return;
    const target = assertPhysicalPath(inspectionDirectory, { root: directory });
    if (!isPathInside(directory, target)) throw new StorageError("E_IO", "检查目录不在数据目录内");
    fs.rmSync(target, { recursive: true, force: true });
    inspectionDirectory = undefined;
  };
  const assertReadable = () => {
    if (readOnlyError) throw new StorageError("E_CORRUPT", "数据无法读取，请从快照或备份恢复");
    if (!db || !loaded) throw new StorageError("E_IO", "工作区尚未加载");
  };
  const closeConnection = () => {
    if (db) db.close();
    db = undefined;
    loaded = false;
    clearInspection();
  };
  const setCorrupt = () => {
    closeConnection();
    readOnlyError = true;
    logger?.log("storage.corrupt", { code: "E_CORRUPT" });
    return new StorageError("E_CORRUPT", "数据无法读取，请从快照或备份恢复");
  };
  const normalizeWorkspace = async (workspace, time) => {
    const normalizer = normalize || (await import("../../../src/persistence/normalize.js")).normalizeLoadedWorkspace;
    return normalizer(workspace, { fallbackWorkspace: workspace, now: time, idFactory });
  };
  const getMeta = (key) => {
    assertReadable();
    const value = db.prepare("SELECT value FROM meta WHERE key=?").get(key)?.value;
    if (value === undefined) return null;
    try { return JSON.parse(value); } catch { throw new StorageError("E_CORRUPT", "元数据无法读取"); }
  };
  const readWorkspace = () => {
    assertReadable();
    return assembleWorkspace(readAllRows(db));
  };
  const saveAppVersion = () => {
    if (appVersion) db.prepare("INSERT INTO meta(key,value) VALUES ('lastAppVersion', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(appVersion));
  };
  const loadInternal = async () => {
    if (readOnlyError) throw new StorageError("E_CORRUPT", "数据无法读取，请从快照或备份恢复");
    const started = performance.now();
    const time = instant();
    try {
      if (loaded) return { workspace: readWorkspace(), generation: getMeta("generation") };
      assertPhysicalPath(filePath, { root: directory });
      if (!fs.existsSync(filePath)) {
        db = openWorkspaceDatabase(filePath);
        prepareWritable(db);
        const workspace = createBlankWorkspace({ now: time, idFactory });
        initializeWorkspace(db, workspace, { generation: idFactory("gen"), now: time });
        saveAppVersion();
        loaded = true;
        return { workspace, generation: getMeta("generation") };
      }
      let rows;
      let workspace;
      try {
        const walPath = `${filePath}-wal`;
        let inspectionFile = filePath;
        if (fs.existsSync(walPath) && fs.statSync(assertPhysicalPath(walPath, { root: directory, allowMissing: false })).size > 0) {
          const inspectionRoot = assertPhysicalPath(path.join(directory, "runtime"), { root: directory });
          fs.mkdirSync(inspectionRoot, { recursive: true });
          inspectionDirectory = fs.mkdtempSync(path.join(inspectionRoot, "workspace-inspect-"));
          inspectionFile = path.join(inspectionDirectory, "workspace.db");
          fs.copyFileSync(filePath, inspectionFile, fs.constants.COPYFILE_EXCL);
          fs.copyFileSync(walPath, `${inspectionFile}-wal`, fs.constants.COPYFILE_EXCL);
        }
        db = openWorkspaceDatabase(inspectionFile, { readOnly: true });
        if (quickCheck(db) !== "ok") throw new StorageError("E_CORRUPT", "数据库检查失败");
        const schemaVersion = JSON.parse(db.prepare("SELECT value FROM meta WHERE key='schemaVersion'").get()?.value);
        if (Number.isSafeInteger(schemaVersion) && schemaVersion > currentSchemaVersion) throw new StorageError("E_UNSUPPORTED_VERSION", "这个数据目录需要更新版本的 Life Atlas");
        rows = readAllRows(db);
        workspace = assembleWorkspace(rows);
      } catch (error) {
        if (error.code === "E_INVALID_ARGUMENT" || error.code === "E_UNSUPPORTED_VERSION") throw error;
        throw setCorrupt();
      }
      const priorVersion = rows.meta.has("lastAppVersion") ? JSON.parse(rows.meta.get("lastAppVersion")) : null;
      if (priorVersion !== null && !isNonEmptyString(priorVersion, 200)) throw setCorrupt();
      if (appVersion && priorVersion !== appVersion) {
        const snapshot = beforeUpgrade || createSnapshot;
        if (typeof snapshot !== "function") throw new StorageError("E_IO", "升级前快照服务尚未就绪，未修改原始数据");
        await snapshot({ reason: "pre-upgrade", dataRoot: directory, now: time, appVersion, previousAppVersion: priorVersion, schemaVersion: workspace.schemaVersion, workspace, databases: [{ name: "workspace.db", db }] });
      }
      if (workspace.schemaVersion < currentSchemaVersion) {
        const snapshot = beforeMigration || createSnapshot;
        if (typeof snapshot !== "function") throw new StorageError("E_IO", "迁移前快照服务尚未就绪，未修改原始数据");
        await snapshot({ reason: "pre-migration", dataRoot: directory, now: time, schemaVersion: workspace.schemaVersion, workspace, databases: [{ name: "workspace.db", db }] });
      }
      const normalized = await normalizeWorkspace(workspace, time);
      db.close();
      db = undefined;
      clearInspection();
      db = openWorkspaceDatabase(filePath);
      prepareWritable(db);
      const result = writeWorkspaceDiff(db, rows, normalized, { now: time });
      saveAppVersion();
      loaded = true;
      return { workspace: result.changed ? { ...normalized, savedAt: result.savedAt } : normalized, generation: getMeta("generation") };
    } catch (error) {
      if (!readOnlyError) closeConnection();
      throw error;
    } finally {
      timings.lastLoadMs = performance.now() - started;
    }
  };
  return {
    timings,
    filePath,
    get db() { return db; },
    load() {
      if (!loadPending) loadPending = loadInternal().finally(() => { loadPending = undefined; });
      return loadPending;
    },
    async applyChanges(changeset) {
      if (writesSuspended) throw new StorageError("E_CONFLICT", "工作区正在恢复，暂时不能保存");
      assertReadable();
      const started = performance.now();
      try {
        return applyChangeset(db, changeset, { now: instant(), expectedGeneration: getMeta("generation"), currentSchemaVersion });
      } finally {
        timings.lastApplyMs = performance.now() - started;
      }
    },
    status() { return { loaded, readOnlyError }; },
    suspendWrites() { writesSuspended = true; },
    resumeWrites() { writesSuspended = false; },
    getMeta,
    setMeta(key, value) {
      assertReadable();
      if (!isNonEmptyString(key, 200)) throw new StorageError("E_INVALID_ARGUMENT", "元数据键无效");
      let json;
      try { json = JSON.stringify(value); } catch { throw new StorageError("E_INVALID_ARGUMENT", "元数据值无效"); }
      if (json === undefined) throw new StorageError("E_INVALID_ARGUMENT", "元数据值无效");
      db.prepare("INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, json);
    },
    readWorkspace,
    replaceWorkspace(workspace, options = {}) {
      assertReadable();
      const generation = options.generation || idFactory("gen");
      return replaceDatabaseWorkspace(db, workspace, { generation, now: options.now || instant() });
    },
    checkpoint() {
      assertReadable();
      const result = db.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get();
      if (result.busy !== 0) throw new StorageError("E_IO", "数据库仍被占用，不能安全关闭");
      return result;
    },
    snapshotTo(targetFile) {
      assertReadable();
      return vacuumInto(db, targetFile);
    },
    close() {
      if (db && loaded && !readOnlyError && db.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get().busy !== 0) throw new StorageError("E_IO", "数据库仍被占用，不能安全关闭");
      closeConnection();
    },
    async reopen() {
      closeConnection();
      readOnlyError = false;
      loadPending = undefined;
      return loadInternal();
    },
  };
}
