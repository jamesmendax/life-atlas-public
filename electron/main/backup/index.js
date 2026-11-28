import fs from "node:fs";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { assertPhysicalPath } from "../storage/dataRoot.js";
import { StorageError } from "../storage/workspaceDb.js";
import { deriveKeyArgon2id, KDF_PARAMS } from "../vault/crypto.js";
import { createAssistantConversationStore } from "../assistant/conversations.js";
import { exportFullBackup, exportWorkspaceRescue, validateWorkspaceRescue } from "./desktopExport.js";
import { restoreFromToken, restoreFromSnapshot } from "./desktopRestore.js";
import { createBackupInspector } from "./inspection.js";
import { encryptFileToContainer, verifyEncryptedContainerWithKey } from "./encryptedContainer.js";
import { createBackupSchedule, checkBackupPassword } from "./schedule.js";
import { backupDate, checkCancelled, createStagingDirectory, removeScopedDirectory, sha256File, logBackup } from "./files.js";
import { tMain } from "../i18n/index.js";

const backupFilters = () => [{ name: tMain("Life Atlas 备份"), extensions: ["lifeatlas"] }];
const pad = (value) => String(value).padStart(2, "0");
const backupFileName = (date, label = "备份") => `Life-Atlas-${tMain(label)}-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}.lifeatlas`;
const isExportJob = (job) => job?.kind === "export" || job?.kind === "export-rescue";

async function cancellable(promise, signal) {
  checkCancelled(signal);
  let abort;
  const cancelled = new Promise((resolve, reject) => {
    abort = () => reject(new StorageError("E_CANCELLED", "操作已取消"));
    signal.addEventListener("abort", abort, { once: true });
  });
  try { return await Promise.race([Promise.resolve(promise), cancelled]); }
  finally { signal.removeEventListener("abort", abort); }
}

export function createBackupService({ dataRoot, workspaceService, assetStore, vaultService, snapshotService, conversations, appVersion = "0.0.0", now = Date.now, idFactory, logger, dialogs, getWindow = () => undefined, requestFlush, requestConfirmation, reloadWorkspace, injectFailure, safeStorage, timers = globalThis, deriveKey = deriveKeyArgon2id } = {}) {
  const root = assertPhysicalPath(dataRoot);
  const chatStore = conversations ?? createAssistantConversationStore({ dataRoot: root });
  const inspector = createBackupInspector({ dataRoot: root, now, timers, deriveKey });
  const listeners = new Set();
  const jobs = new Map();
  const running = new Set();
  let chain = Promise.resolve();
  let stopped = false;
  let stopPending;
  const enqueue = (operation) => {
    if (stopped) return Promise.reject(new StorageError("E_CANCELLED", "备份服务正在关闭"));
    const promise = chain.then(operation);
    chain = promise.catch(() => {});
    running.add(promise);
    promise.then(() => running.delete(promise), () => running.delete(promise));
    return promise;
  };
  const emit = (job, progress) => {
    const value = { jobId: job.id, kind: job.kind, phase: progress.phase, done: progress.done ?? 0, total: progress.total ?? 1 };
    for (const callback of listeners) { try { callback(value); } catch {} }
  };
  const runJob = (kind, operation) => {
    const job = { id: idFactory?.("backup") ?? `backup-${randomUUID()}`, kind, controller: new AbortController() };
    jobs.set(job.id, job);
    const promise = enqueue(async () => {
      checkCancelled(job.controller.signal);
      emit(job, { phase: "prepare" });
      try {
        const result = await operation(job);
        emit(job, { phase: "complete", done: 1, total: 1 });
        return result;
      } catch (error) { emit(job, { phase: error.code === "E_CANCELLED" ? "cancelled" : "failed" }); throw error; }
    });
    promise.then(() => jobs.delete(job.id), () => jobs.delete(job.id));
    return promise;
  };
  const flush = async (signal) => {
    if (typeof requestFlush !== "function") return;
    const result = signal ? await cancellable(requestFlush(), signal) : await requestFlush();
    if (result === false) throw new StorageError("E_IO", "保存尚未完成，未开始备份或恢复");
  };
  const snapshot = (options) => enqueue(async () => {
    await flush();
    if (!snapshotService) throw new StorageError("E_IO", "快照服务不可用");
    return { snapshot: await snapshotService.createSnapshot({ reason: "manual", ...options }) };
  });
  const checkedVault = () => {
    const status = vaultService?.status();
    if (!status?.exists) throw new StorageError("E_INVALID_ARGUMENT", "还没有密钥库");
    if (!status.recoveryConfirmed) throw new StorageError("E_LOCKED", "recovery-unconfirmed");
    return status;
  };
  const exportTo = async ({ targetPath, includeVault, encryptPassword }, job) => {
    const signal = job.controller.signal;
    const target = assertPhysicalPath(targetPath);
    checkCancelled(signal);
    await flush(signal);
    if (!workspaceService) throw new StorageError("E_INVALID_ARGUMENT", "工作区备份服务不可用");
    if (!workspaceService.status().loaded) await workspaceService.load();
    const workspace = workspaceService.readWorkspace();
    const vaultExport = includeVault ? (checkedVault(), vaultService.exportCiphertext()) : null;
    const onProgress = (progress) => emit(job, progress);
    let staging;
    let partial;
    let key;
    try {
      let result;
      if (encryptPassword === null) result = await exportFullBackup({ db: workspaceService.db, assetStore, workspace, conversations: chatStore, targetPath: target, appVersion, now, onProgress, signal, vaultExport });
      else {
        checkBackupPassword(encryptPassword);
        staging = createStagingDirectory(root, ".staging-export-");
        const zip = path.join(staging, "package.zip");
        result = await exportFullBackup({ db: workspaceService.db, assetStore, workspace, conversations: chatStore, targetPath: zip, appVersion, now, onProgress, signal, vaultExport });
        const fingerprint = await sha256File(zip, { signal });
        const salt = randomBytes(16);
        key = Buffer.from(await deriveKey(encryptPassword, salt, KDF_PARAMS));
        checkCancelled(signal);
        partial = assertPhysicalPath(`${target}.partial-${randomBytes(4).toString("hex")}`);
        await encryptFileToContainer({ sourceFile: zip, targetFile: partial, key, saltB64: salt.toString("base64"), noncePrefix: randomBytes(7), signal, onProgress: (progress) => onProgress({ ...progress, phase: "encrypt" }) });
        emit(job, { phase: "verify-encrypted" });
        const decrypted = await verifyEncryptedContainerWithKey({ sourceFile: partial, key, signal });
        if (decrypted.size !== fingerprint.size || decrypted.sha256 !== fingerprint.sha256) throw new StorageError("E_IO", "加密备份校验失败");
        checkCancelled(signal);
        fs.renameSync(partial, target);
        partial = undefined;
        result = { ...result, filePath: target };
      }
      workspaceService.setMeta("lastFullBackupAt", backupDate(now).toISOString());
      logBackup(logger, "backup.export", { source: path.basename(target), ok: true, encrypted: encryptPassword !== null, includeVault });
      return result;
    } catch (error) {
      logBackup(logger, "backup.export", { source: path.basename(target), ok: false, code: error.code || "E_IO" });
      throw error?.code?.startsWith("E_") ? error : new StorageError("E_IO", "导出失败，未替换目标文件");
    } finally {
      key?.fill(0);
      if (partial && fs.existsSync(assertPhysicalPath(partial))) fs.unlinkSync(partial);
      if (staging) removeScopedDirectory(staging, root);
    }
  };
  const schedule = createBackupSchedule({ dataRoot: root, now, safeStorage, requestConfirmation: async (input) => { checkedVault(); return requestConfirmation?.(input); }, exportBackup: (input) => runJob("export", (job) => exportTo(input, job)), logger, timers });
  const selectBackup = async (verifyOnly = false, scheduled = false) => {
    const options = { title: tMain(verifyOnly ? "校验 Life Atlas 备份" : "从 Life Atlas 备份恢复"), filters: backupFilters(), properties: ["openFile"] };
    if (scheduled) {
      const { schedule: { folder, destination } } = schedule.getSchedule();
      if (folder && destination !== "local") {
        try {
          const directory = assertPhysicalPath(folder, { allowMissing: false });
          if (fs.statSync(directory).isDirectory()) options.defaultPath = directory;
        } catch { /* 用户仍可从其他目录选择下载后的备份 */ }
      }
    }
    const response = await dialogs?.showOpenDialog(getWindow(), options);
    if (response?.canceled || !response?.filePaths?.[0]) return { cancelled: true };
    return inspector.inspectFile(response.filePaths[0], { verifyOnly });
  };
  const restoreToken = (token, overrides = {}) => runJob("restore", async (job) => {
    await flush();
    const restoreRoot = assertPhysicalPath(overrides.dataRoot ?? root);
    return restoreFromToken(token, { workspaceService, assetStore, vaultService, snapshotService, appVersion, now, idFactory, logger, reloadWorkspace, injectFailure, ...overrides, dataRoot: restoreRoot, conversations: overrides.conversations ?? (restoreRoot === root ? chatStore : undefined), inspector, onProgress: (progress) => emit(job, progress) });
  });
  const stop = () => {
    if (stopPending) return stopPending;
    stopped = true;
    for (const job of jobs.values()) if (isExportJob(job)) job.controller.abort();
    const scheduled = schedule.stop();
    stopPending = (async () => {
      await Promise.allSettled([...running]);
      await scheduled;
      inspector.stop();
    })();
    return stopPending;
  };
  return {
    getStatus() { return { lastFullBackupAt: workspaceService?.status().loaded && !workspaceService.status().readOnlyError ? workspaceService.getMeta("lastFullBackupAt") : null, schedule: schedule.getSchedule().schedule }; },
    exportFull(input) {
      if (!input || typeof input.includeVault !== "boolean" || input.encryptPassword !== null && typeof input.encryptPassword !== "string") return Promise.reject(new StorageError("E_INVALID_ARGUMENT", "备份参数无效"));
      if (input.encryptPassword !== null) { try { checkBackupPassword(input.encryptPassword); } catch (error) { return Promise.reject(error); } }
      return runJob("export", async (job) => {
        if (input.includeVault) {
          checkedVault();
          emit(job, { phase: "confirm-vault" });
          if (typeof requestConfirmation !== "function" || await cancellable(requestConfirmation({
            kind: "export-backup",
            title: tMain("导出完整备份（包含密钥库）"),
            description: tMain("备份中的密钥库仍由你现在的主密码加密。恢复时需要这个主密码或恢复密钥。"),
          }), job.controller.signal) !== "confirmed") throw new StorageError("E_CANCELLED", "导出备份已取消");
        }
        const folder = assertPhysicalPath(path.join(root, "backups"), { root });
        fs.mkdirSync(folder, { recursive: true });
        const response = await cancellable(dialogs?.showSaveDialog(getWindow(), { title: tMain("导出 Life Atlas 备份"), defaultPath: path.join(folder, backupFileName(backupDate(now))), filters: backupFilters() }), job.controller.signal);
        if (response?.canceled || !response?.filePath) throw new StorageError("E_CANCELLED", "导出备份已取消");
        return exportTo({ ...input, targetPath: response.filePath }, job);
      });
    },
    async exportRescue(workspace) {
      validateWorkspaceRescue(workspace);
      return runJob("export-rescue", async (job) => {
        const signal = job.controller.signal;
        const response = await cancellable(dialogs?.showSaveDialog(getWindow(), { title: tMain("保存 Life Atlas 工作区救援文件"), defaultPath: backupFileName(backupDate(now), "工作区救援"), filters: backupFilters() }), signal);
        if (response?.canceled || !response?.filePath) throw new StorageError("E_CANCELLED", "已取消导出救援文件");
        if (path.extname(response.filePath).toLowerCase() !== ".lifeatlas") throw new StorageError("E_INVALID_ARGUMENT", "救援文件名须以 .lifeatlas 结尾");
        const { filePath } = await exportWorkspaceRescue({ workspace, targetPath: response.filePath, appVersion, now, signal, onProgress: (progress) => emit(job, progress) });
        return { filePath };
      });
    },
    cancel({ jobId } = {}) {
      const job = jobs.get(jobId);
      if (!isExportJob(job)) throw new StorageError("E_INVALID_ARGUMENT", "只能取消正在进行的导出");
      job.controller.abort();
      return {};
    },
    inspect: () => enqueue(() => selectBackup()),
    inspectScheduled: () => enqueue(() => selectBackup(false, true)),
    inspectFile: (filePath, options = {}) => enqueue(() => inspector.inspectFile(filePath, options)),
    inspectWithPassword: (args) => enqueue(() => inspector.inspectWithPassword(args)),
    verify: () => enqueue(() => selectBackup(true)),
    verifyWithPassword: (args) => enqueue(() => inspector.verifyWithPassword(args)),
    restore: ({ token, restoreVault }) => restoreToken(token, { restoreVault }),
    restoreToken,
    listSnapshots: () => ({ snapshots: snapshotService?.listSnapshots() ?? [] }),
    createSnapshot: () => snapshot(),
    createWorkspaceSnapshot: () => snapshot({ restoreVault: false }),
    restoreSnapshot: ({ id, restoreWorkspace, restoreVault }) => runJob("restore", async (job) => { await flush(); return restoreFromSnapshot(id, { restoreWorkspace, restoreVault }, { dataRoot: root, workspaceService, vaultService, snapshotService, conversations: chatStore, now, idFactory, logger, reloadWorkspace, injectFailure, onProgress: (progress) => emit(job, progress) }); }),
    getSchedule: schedule.getSchedule,
    chooseScheduleFolder: () => enqueue(async () => { const response = await dialogs?.showOpenDialog(getWindow(), { title: tMain("选择定期备份文件夹"), properties: ["openDirectory"] }); return response?.canceled || !response?.filePaths?.[0] ? { cancelled: true } : { folder: response.filePaths[0] }; }),
    setSchedule: (input) => enqueue(() => schedule.setSchedule(input)),
    runScheduleNow: () => schedule.runNow(),
    updateWorkspaceSchedule: (patch) => enqueue(() => schedule.updateWorkspaceSchedule(patch)),
    schedule: { checkNow: schedule.checkNow },
    onProgress(callback) { if (typeof callback !== "function") throw new StorageError("E_INVALID_ARGUMENT", "进度订阅无效"); listeners.add(callback); return () => listeners.delete(callback); },
    start() { stopped = false; stopPending = undefined; inspector.start(); schedule.start(); },
    stop,
  };
}
