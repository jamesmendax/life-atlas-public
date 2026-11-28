import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { assertPhysicalPath, isPathInside, isSyncDrivePath, ensureDataRootMarker, acquireDataRootLock, releaseDataRootLock, writeAtomicJson } from "./storage/dataRoot.js";
import { StorageError } from "./storage/workspaceDb.js";
import { createAssetStore } from "./storage/assetStore.js";
import { createSnapshotService } from "./storage/snapshots.js";
import { createVaultService } from "./vault/index.js";
import { backupDate, logBackup } from "./backup/files.js";
import { tMain } from "./i18n/index.js";

const result = (level, kind, message) => ({ level, kind, message: tMain(message) });
const processIsAlive = (pid) => { try { process.kill(pid, 0); return true; } catch (error) { return error.code === "EPERM"; } };

export function validateFolder({ path: folder } = {}, { isPackaged = false, installDir = path.dirname(process.execPath) } = {}) {
  if (typeof folder !== "string" || !path.isAbsolute(folder)) return result("error", "not-writable", "请选择一个完整的文件夹路径");
  let directory;
  try { directory = assertPhysicalPath(folder); } catch { return result("error", "not-writable", "请选择没有链接且可以写入的文件夹"); }
  if (isPackaged && isPathInside(installDir, directory, { allowRoot: true })) return result("error", "inside-install", "数据目录不能放在程序安装目录里");
  if (fs.existsSync(directory)) {
    if (!fs.statSync(directory).isDirectory()) return result("error", "not-writable", "这个位置不是文件夹");
    if (fs.existsSync(assertPhysicalPath(path.join(directory, "life-atlas.root.json"), { root: directory }))) return result("ok", "existing-data-root", "这里已经是 Life Atlas 数据目录，将直接打开它");
    if (fs.readdirSync(directory).length) return result("error", "not-empty", "这个文件夹里已有其他文件，请选择空文件夹或新建一个");
  }
  if (isSyncDrivePath(directory)) return result("warning", "sync-drive", "同步盘可能损坏正在使用的数据库，建议只把备份放到同步盘");
  if (!fs.existsSync(directory)) return result("ok", "missing", "将创建这个文件夹");
  const probe = assertPhysicalPath(path.join(directory, `.life-atlas-write-${randomBytes(8).toString("hex")}`), { root: directory });
  try {
    const descriptor = fs.openSync(probe, "wx");
    try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); fs.unlinkSync(probe); }
  } catch { return result("error", "not-writable", "这个文件夹不能写入"); }
  return result("ok", "empty", "这个空文件夹可以使用");
}

export function createSetupService({ bootstrapFile, setupTempDir, appVersion = "0.0.0", isPackaged = false, installDir = path.dirname(process.execPath), now = Date.now, idFactory, dialogs, getSetupWindow = () => undefined, createWorkspaceService, createBackupService, persistInitialLocale, exit = () => {}, relaunch = () => {}, testHooksEnabled = false, logger } = {}) {
  const temporaryRoot = assertPhysicalPath(setupTempDir);
  const bootstrap = assertPhysicalPath(bootstrapFile);
  const suggestedDataRoot = testHooksEnabled ? path.join(path.dirname(temporaryRoot), `life-atlas-test-data-${randomUUID()}`) : fs.existsSync("D:\\") ? "D:\\LifeAtlas" : path.join(os.homedir(), "Documents", "LifeAtlas");
  // A retry must still save the locale if the first attempt already created the database.
  const createdBlankRoots = new Set();
  let importer;
  let finishing;
  let completed = false;
  let resources;
  const importerService = () => {
    if (!importer) importer = createBackupService({ dataRoot: temporaryRoot, appVersion, now, idFactory, dialogs, getWindow: getSetupWindow, logger });
    return importer;
  };
  const validate = (input) => validateFolder(input, { isPackaged, installDir });
  const closeResources = async () => {
    if (!resources) return;
    await resources.snapshotService?.stop();
    await resources.vaultService?.lock("app-quit");
    resources.vaultService?.closeDatabase();
    resources.workspaceService?.close();
    if (resources.lockHeld) releaseDataRootLock(resources.dataRoot, process.pid);
    resources = undefined;
  };
  const finish = (input) => {
    if (completed) return Promise.resolve({});
    if (finishing) return Promise.reject(new StorageError("E_IO", tMain("首次启动正在完成，请稍候")));
    finishing = (async () => {
      if (!input || !["blank", "restore"].includes(input.start) || input.start === "restore" && (typeof input.token !== "string" || !input.token)) throw new StorageError("E_INVALID_ARGUMENT", tMain("请选择开始方式"));
      const validation = validate({ path: input.dataRoot });
      if (validation.level === "error") throw new StorageError("E_INVALID_ARGUMENT", validation.message);
      const dataRoot = assertPhysicalPath(input.dataRoot);
      if (isPathInside(temporaryRoot, dataRoot, { allowRoot: true })) throw new StorageError("E_INVALID_ARGUMENT", tMain("数据目录不能放在向导临时目录中"));
      const instant = backupDate(now).toISOString();
      ensureDataRootMarker(dataRoot, { appVersion, now: instant });
      const lock = acquireDataRootLock(dataRoot, { pid: process.pid, appVersion, now: instant, isProcessAlive: processIsAlive });
      if (!lock.ok) throw new StorageError("E_IO", tMain("数据目录已在另一个 Life Atlas 实例中打开"));
      resources = { dataRoot, lockHeld: true };
      try {
        if (input.start === "restore" || !fs.existsSync(path.join(dataRoot, "workspace.db"))) {
          let snapshotService;
          const workspaceService = createWorkspaceService({ dataRoot, appVersion, now: () => backupDate(now).toISOString(), idFactory, beforeMigration: (args) => snapshotService.beforeMigration(args), beforeUpgrade: (args) => snapshotService.beforeUpgrade(args) });
          resources.workspaceService = workspaceService;
          const assetStore = createAssetStore({ assetsDir: path.join(dataRoot, "assets"), db: () => workspaceService.db, now: () => backupDate(now).toISOString() });
          const vaultService = createVaultService({ dataRoot, appVersion, clock: { now: () => backupDate(now).getTime() }, logger: (event, fields) => logBackup(logger, event, fields) });
          resources.vaultService = vaultService;
          snapshotService = createSnapshotService({ dataRoot, workspaceService, vaultService, appVersion, now, logger });
          resources.snapshotService = snapshotService;
          if (input.start === "restore") await importerService().restoreToken(input.token, { dataRoot, workspaceService, assetStore, vaultService, snapshotService, initialSetup: true });
          else {
            await workspaceService.load();
            createdBlankRoots.add(dataRoot);
          }
        }
        await importer?.stop();
        await closeResources();
        if (input.start === "blank" && createdBlankRoots.has(dataRoot)) await persistInitialLocale?.();
        writeAtomicJson(bootstrap, { dataRoot });
        completed = true;
        if (!testHooksEnabled) relaunch();
        exit(0);
        return {};
      } catch (error) {
        try { await closeResources(); } catch {}
        throw error?.code?.startsWith("E_") ? error : new StorageError("E_IO", tMain("首次启动未完成，未切换数据目录"));
      }
    })();
    finishing.finally(() => { finishing = undefined; }).catch(() => {});
    return finishing;
  };
  return {
    getDefaults: () => ({ suggestedDataRoot }),
    chooseFolder: async () => { const response = await dialogs?.showOpenDialog(getSetupWindow(), { title: tMain("选择 Life Atlas 数据目录"), properties: ["openDirectory", "createDirectory"] }); return response?.canceled || !response?.filePaths?.[0] ? { cancelled: true } : { path: response.filePaths[0] }; },
    validateFolder: validate,
    inspectBackup: () => importerService().inspect(),
    inspectBackupWithPassword: (args) => importerService().inspectWithPassword(args),
    finish,
    async stop() { await finishing?.catch(() => {}); await importer?.stop(); await closeResources(); },
  };
}
