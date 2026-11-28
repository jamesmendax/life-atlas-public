import { isBackupDestination } from "../../../src/backup/scheduleDestinations.js";
import { ok, fail, errorResult } from "./result.js";
import { acceptsNoArguments, isPlainObject, isNonEmptyString, isTrustedSender } from "./validate.js";
import { acceptsWorkspaceSchedulePatch } from "../backup/schedule.js";

const credential = (value) => typeof value === "string" && value.length > 0 && value.length <= 1024 && !value.includes("\0");
const exportArguments = (args) => isPlainObject(args) && typeof args.includeVault === "boolean" && (args.encryptPassword === null || credential(args.encryptPassword));
const inspectionArguments = (args) => isPlainObject(args) && isNonEmptyString(args.inspectId, 200) && credential(args.password);
const scheduleArguments = (args) => isPlainObject(args) && (args.destination === undefined || isBackupDestination(args.destination)) && typeof args.enabled === "boolean" && (args.folder === null || isNonEmptyString(args.folder, 4096)) && Number.isInteger(args.weekday) && args.weekday >= 0 && args.weekday <= 6 && Number.isInteger(args.hour) && args.hour >= 0 && args.hour <= 23 && Number.isInteger(args.keepLast) && args.keepLast >= 1 && args.keepLast <= 52 && typeof args.includeVault === "boolean" && (args.encryptPassword === null || credential(args.encryptPassword));

export function registerBackupIpc({ ipcMain, service, getWorkspaceWindow } = {}) {
  const channels = [];
  const register = (action, validate, operation) => {
    const channel = `la:backup:${action}`;
    channels.push(channel);
    ipcMain.handle(channel, async (event, args) => {
      if (!isTrustedSender(event, getWorkspaceWindow())) return fail("E_FORBIDDEN", "只接受工作区窗口的调用");
      try {
        if (!validate(args)) return fail("E_INVALID_ARGUMENT", "备份参数无效");
        return ok(await operation(args));
      } catch (error) { return errorResult(error, "备份操作失败，当前数据没有被丢弃"); }
    });
  };
  register("get-status", acceptsNoArguments, () => service.getStatus());
  register("export-full", exportArguments, (args) => service.exportFull(args));
  register("export-rescue", (args) => isPlainObject(args) && Object.keys(args).length === 1 && isPlainObject(args.workspace), (args) => service.exportRescue(args.workspace));
  register("cancel", (args) => isPlainObject(args) && isNonEmptyString(args.jobId, 200), (args) => service.cancel(args));
  register("inspect", acceptsNoArguments, () => service.inspect());
  register("inspect-scheduled", acceptsNoArguments, () => service.inspectScheduled());
  register("inspect-with-password", inspectionArguments, (args) => service.inspectWithPassword(args));
  register("restore", (args) => isPlainObject(args) && isNonEmptyString(args.token, 200) && typeof args.restoreVault === "boolean", (args) => service.restore(args));
  register("verify", acceptsNoArguments, () => service.verify());
  register("verify-with-password", inspectionArguments, (args) => service.verifyWithPassword(args));
  register("list-snapshots", acceptsNoArguments, () => service.listSnapshots());
  register("create-snapshot", acceptsNoArguments, () => service.createSnapshot());
  register("create-workspace-snapshot", acceptsNoArguments, () => service.createWorkspaceSnapshot());
  register("restore-snapshot", (args) => isPlainObject(args) && isNonEmptyString(args.id, 300) && typeof args.restoreWorkspace === "boolean" && typeof args.restoreVault === "boolean" && (args.restoreWorkspace || args.restoreVault), (args) => service.restoreSnapshot(args));
  register("get-schedule", acceptsNoArguments, () => service.getSchedule());
  register("choose-schedule-folder", acceptsNoArguments, () => service.chooseScheduleFolder());
  register("set-schedule", scheduleArguments, (args) => service.setSchedule(args));
  register("run-schedule-now", acceptsNoArguments, () => service.runScheduleNow());
  register("update-workspace-schedule", acceptsWorkspaceSchedulePatch, (args) => service.updateWorkspaceSchedule(args));
  const unsubscribe = service.onProgress((progress) => {
    const window = getWorkspaceWindow();
    if (window && !window.isDestroyed?.() && !window.webContents.isDestroyed?.()) window.webContents.send("la:backup:progress", progress);
  });
  return () => { unsubscribe(); for (const channel of channels) ipcMain.removeHandler(channel); };
}
