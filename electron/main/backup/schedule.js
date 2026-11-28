import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { isBackupDestination } from "../../../src/backup/scheduleDestinations.js";
import { isNonEmptyString, isPlainObject } from "../ipc/validate.js";
import { assertPhysicalPath, isPathInside, writeAtomicJson } from "../storage/dataRoot.js";
import { StorageError } from "../storage/workspaceDb.js";
import { checkMasterPassword } from "../vault/passwordPolicy.js";
import { backupDate, logBackup } from "./files.js";
import { tMain } from "../i18n/index.js";

const AUTOMATIC_NAME = /^Life-Atlas-自动备份-\d{8}-\d{4}\.lifeatlas$/;
const HOUR = 3600000;
const DEFAULTS = Object.freeze({ destination: "local", enabled: false, folder: null, weekday: 0, hour: 20, keepLast: 8, includeVault: false, encrypt: false, lastRunAt: null, lastResult: null });
const publicSchedule = (value) => {
  const schedule = Object.fromEntries(Object.keys(DEFAULTS).map((key) => [key, structuredClone(value[key])]));
  if (schedule.lastResult) schedule.lastResult.message = tMain(schedule.lastResult.message);
  return schedule;
};
const validDate = (value) => value === null || typeof value === "string" && Number.isFinite(Date.parse(value));
const inRange = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
const workspaceScheduleFields = {
  enabled: (value) => typeof value === "boolean",
  folder: (value) => isNonEmptyString(value, 4096),
  weekday: (value) => inRange(value, 0, 6),
  hour: (value) => inRange(value, 0, 23),
  keepLast: (value) => inRange(value, 1, 52),
};

export function acceptsWorkspaceSchedulePatch(input) {
  if (!isPlainObject(input)) return false;
  const fields = Object.entries(input);
  return fields.length > 0 && fields.every(([key, value]) => Object.hasOwn(workspaceScheduleFields, key) && workspaceScheduleFields[key](value));
}

export function checkBackupPassword(value) {
  if (typeof value !== "string" || value.length > 1024 || value.includes("\0")) throw new StorageError("E_INVALID_ARGUMENT", "备份密码无效");
  const result = checkMasterPassword(value);
  if (!result.ok) {
    const rules = { length: "至少 12 个字符", distinct: "至少 5 种不同字符", common: "不能使用常见密码", pattern: "不能使用重复或连续字符" };
    const description = result.failures.map((rule) => tMain(rules[rule] ?? rule)).join(tMain("；"));
    throw new StorageError("E_INVALID_ARGUMENT", tMain("备份密码未通过规则：{rules}", { rules: description }));
  }
  return value;
}

export function validateScheduleFolder(folder, dataRoot) {
  let directory;
  try {
    directory = assertPhysicalPath(folder, { allowMissing: false });
    if (isPathInside(dataRoot, directory, { allowRoot: true }) || !fs.statSync(directory).isDirectory()) throw new Error("invalid folder");
    const probe = assertPhysicalPath(path.join(directory, `.life-atlas-write-${randomBytes(8).toString("hex")}`), { root: directory });
    const descriptor = fs.openSync(probe, "wx");
    try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); fs.unlinkSync(probe); }
  } catch { throw new StorageError("E_INVALID_ARGUMENT", "定期备份要放在数据目录以外的可写文件夹"); }
  return directory;
}

export function automaticBackupName(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `Life-Atlas-自动备份-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}.lifeatlas`;
}

function cloudBackupPattern(id) {
  return new RegExp(`^Life-Atlas-云盘备份-${id}-\\d{8}T\\d{9}-[a-f0-9]{12}\\.lifeatlas$`);
}

function cloudBackupName(date, id) {
  const time = date.toISOString().replace(/[-:.Z]/g, "");
  return `Life-Atlas-云盘备份-${id}-${time}-${randomBytes(6).toString("hex")}.lifeatlas`;
}

export function latestWeeklySlot(date, weekday, hour) {
  const slot = new Date(date.getTime());
  slot.setHours(hour, 0, 0, 0);
  slot.setDate(slot.getDate() - (slot.getDay() - weekday + 7) % 7);
  if (slot.getTime() > date.getTime()) slot.setDate(slot.getDate() - 7);
  return slot;
}

export function createBackupSchedule({ dataRoot, now = Date.now, safeStorage, requestConfirmation, exportBackup, logger, timers = globalThis } = {}) {
  const root = assertPhysicalPath(dataRoot);
  const file = assertPhysicalPath(path.join(root, "backup-schedule.json"), { root });
  let state = { ...DEFAULTS, encryptedPasswordB64: null, enabledAt: null, cloudBackupId: null };
  let revision = 0;
  let pending;
  let startupTimer;
  let intervalTimer;
  let stopped = false;
  if (fs.existsSync(file)) {
    try {
      const stored = JSON.parse(fs.readFileSync(file, "utf8"));
      if (!stored || typeof stored.enabled !== "boolean" || typeof stored.includeVault !== "boolean" || typeof stored.encrypt !== "boolean" || !Number.isInteger(stored.weekday) || stored.weekday < 0 || stored.weekday > 6 || !Number.isInteger(stored.hour) || stored.hour < 0 || stored.hour > 23 || !Number.isInteger(stored.keepLast) || stored.keepLast < 1 || stored.keepLast > 52 || stored.folder !== null && typeof stored.folder !== "string" || !validDate(stored.lastRunAt) || !validDate(stored.enabledAt ?? null) || stored.encrypt && (typeof stored.encryptedPasswordB64 !== "string" || !stored.encryptedPasswordB64 || Buffer.from(stored.encryptedPasswordB64, "base64").toString("base64") !== stored.encryptedPasswordB64) || stored.lastResult !== null && (!stored.lastResult || typeof stored.lastResult.ok !== "boolean" || !validDate(stored.lastResult.at) || typeof stored.lastResult.message !== "string")) throw new Error("invalid schedule");
      const destination = stored.destination === undefined ? "local" : stored.destination;
      if (!isBackupDestination(destination)) throw new Error("invalid destination");
      if ((destination !== "local" || stored.cloudBackupId != null) && (typeof stored.cloudBackupId !== "string" || !/^[a-f0-9]{16}$/.test(stored.cloudBackupId))) throw new Error("invalid cloud backup ID");
      state = { ...state, ...Object.fromEntries(Object.keys(state).filter((key) => Object.hasOwn(stored, key)).map((key) => [key, stored[key]])) };
    } catch {
      state.lastResult = { ok: false, at: backupDate(now).toISOString(), message: "定期备份设置无法读取，请重新设置" };
      logBackup(logger, "backup.schedule.invalid", { code: "E_CORRUPT" });
    }
  }
  const save = (next) => { writeAtomicJson(file, next); state = next; };
  const ensureSafeStorage = () => {
    if (!safeStorage?.isEncryptionAvailable?.()) throw new StorageError("E_IO", "这台电脑无法安全保存备份密码");
  };
  const saveSchedule = (patch) => {
    const next = { ...state, ...patch };
    const destinationChanged = state.folder !== next.folder || state.destination !== next.destination;
    const reconfigured = next.enabled && (!state.enabled || state.weekday !== next.weekday || state.hour !== next.hour || destinationChanged);
    if (reconfigured) next.enabledAt = backupDate(now).toISOString();
    if (destinationChanged) { next.lastRunAt = null; next.lastResult = null; }
    save(next);
    revision += 1;
    return { schedule: publicSchedule(state) };
  };
  const updateWorkspaceSchedule = (patch) => {
    if (!acceptsWorkspaceSchedulePatch(patch)) throw new StorageError("E_INVALID_ARGUMENT", "定期备份参数无效");
    if (state.includeVault || state.destination !== "local") throw new StorageError("E_FORBIDDEN", "请在应用的备份设置中管理这项计划。");
    const folder = patch.folder ?? state.folder;
    const enabled = patch.enabled ?? state.enabled;
    const destination = folder === null && !enabled ? null : validateScheduleFolder(folder, root);
    return saveSchedule({ ...patch, folder: destination });
  };
  const setSchedule = async (input) => {
    if (!input || typeof input.enabled !== "boolean" || typeof input.includeVault !== "boolean" || !Number.isInteger(input.weekday) || input.weekday < 0 || input.weekday > 6 || !Number.isInteger(input.hour) || input.hour < 0 || input.hour > 23 || !Number.isInteger(input.keepLast) || input.keepLast < 1 || input.keepLast > 52 || input.encryptPassword !== null && typeof input.encryptPassword !== "string" || (input.destination !== undefined && !isBackupDestination(input.destination))) throw new StorageError("E_INVALID_ARGUMENT", "定期备份参数无效");
    const destination = input.destination ?? state.destination;
    const keepingFolderWhileDisabled = !input.enabled && input.folder === state.folder;
    const folder = keepingFolderWhileDisabled || (input.folder === null && !input.enabled) ? input.folder : validateScheduleFolder(input.folder, root);
    const encrypt = input.encryptPassword !== null;
    if (encrypt) { checkBackupPassword(input.encryptPassword); ensureSafeStorage(); }
    if (input.includeVault && !state.includeVault) {
      if (typeof requestConfirmation !== "function" || await requestConfirmation({
        kind: "schedule-backup",
        title: tMain("开启定期备份（包含密钥库）"),
        description: tMain("自动备份将包含仍由主密码加密的密钥库。之后每次计划备份不再询问。"),
      }) !== "confirmed") throw new StorageError("E_CANCELLED", "开启定期备份已取消");
    }
    return saveSchedule({
      destination, cloudBackupId: destination === "local" ? state.cloudBackupId : state.cloudBackupId ?? randomBytes(8).toString("hex"),
      enabled: input.enabled, folder, weekday: input.weekday, hour: input.hour, keepLast: input.keepLast,
      includeVault: input.includeVault, encrypt, encryptedPasswordB64: encrypt ? Buffer.from(safeStorage.encryptString(input.encryptPassword)).toString("base64") : null,
    });
  };
  const retainAutomaticBackups = (folder, keepLast, fileName, pattern) => {
    const older = fs.readdirSync(folder, { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name !== fileName && pattern.test(entry.name)).map((entry) => entry.name).sort().reverse();
    for (const name of older.slice(keepLast - 1)) fs.unlinkSync(assertPhysicalPath(path.join(folder, name), { root: folder, allowMissing: false }));
  };
  const runCheck = async (force) => {
    const cloud = state.destination !== "local";
    if (stopped || (force ? !cloud || !state.folder : !state.enabled)) return { ran: false, filePath: null };
    const date = backupDate(now);
    const slot = latestWeeklySlot(date, state.weekday, state.hour);
    const lastRunAt = Date.parse(state.lastRunAt);
    const retryAfterFailure = cloud && state.lastResult?.ok === false && date.getTime() - lastRunAt >= HOUR;
    if (!force && ((state.enabledAt && slot.getTime() < Date.parse(state.enabledAt)) || (lastRunAt >= slot.getTime() && !retryAfterFailure))) return { ran: false, filePath: null };
    const current = structuredClone(state);
    const currentRevision = revision;
    const at = date.toISOString();
    let filePath = null;
    let lastResult;
    try {
      const folder = validateScheduleFolder(current.folder, root);
      let encryptPassword = null;
      if (current.encrypt) {
        ensureSafeStorage();
        encryptPassword = safeStorage.decryptString(Buffer.from(current.encryptedPasswordB64, "base64"));
        checkBackupPassword(encryptPassword);
      }
      const fileName = cloud ? cloudBackupName(date, current.cloudBackupId) : automaticBackupName(date);
      const targetPath = assertPhysicalPath(path.join(folder, fileName), { root: folder });
      const result = await exportBackup({ targetPath, includeVault: current.includeVault, encryptPassword });
      encryptPassword = null;
      filePath = result.filePath;
      lastResult = { ok: true, at, message: "已写入本机备份目录" };
      if (revision === currentRevision) {
        try { retainAutomaticBackups(folder, current.keepLast, fileName, cloud ? cloudBackupPattern(current.cloudBackupId) : AUTOMATIC_NAME); }
        catch (error) {
          lastResult.message = "已写入本机备份目录，未能清理部分旧备份";
          logBackup(logger, "backup.schedule.retention", { ok: false, code: error.code || "E_IO" });
        }
      }
      logBackup(logger, "backup.schedule", { ok: true, source: path.basename(filePath) });
    } catch (error) {
      lastResult = { ok: false, at, message: "定期备份失败，请检查备份文件夹与安全存储设置" };
      logBackup(logger, "backup.schedule", { ok: false, code: error.code || "E_IO" });
    }
    if (revision === currentRevision) save({ ...state, lastRunAt: at, lastResult });
    return { ran: true, filePath };
  };
  const checkNow = (force = false) => {
    if (!pending) pending = runCheck(force).finally(() => { pending = undefined; });
    return pending;
  };
  const stop = () => {
    stopped = true;
    if (startupTimer !== undefined) timers.clearTimeout(startupTimer);
    if (intervalTimer !== undefined) timers.clearInterval(intervalTimer);
    startupTimer = undefined;
    intervalTimer = undefined;
    return pending ? Promise.allSettled([pending]) : Promise.resolve([]);
  };
  return {
    getSchedule: () => ({ schedule: publicSchedule(state) }),
    setSchedule,
    updateWorkspaceSchedule,
    checkNow,
    async runNow() {
      const result = pending ? await pending : { ran: false };
      const outcome = result.ran ? result : await checkNow(true);
      if (!outcome.ran) throw new StorageError("E_INVALID_ARGUMENT", "请先保存第三方备份位置");
      return { filePath: outcome.filePath, schedule: publicSchedule(state) };
    },
    start() {
      if (startupTimer !== undefined || intervalTimer !== undefined) return;
      stopped = false;
      const check = () => checkNow().catch((error) => logBackup(logger, "backup.schedule", { ok: false, code: error.code || "E_IO" }));
      startupTimer = timers.setTimeout(check, 120000);
      intervalTimer = timers.setInterval(check, HOUR);
      startupTimer?.unref?.();
      intervalTimer?.unref?.();
    },
    stop,
  };
}
