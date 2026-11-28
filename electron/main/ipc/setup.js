import { ok, fail, errorResult } from "./result.js";
import { acceptsNoArguments, isPlainObject, isNonEmptyString, isTrustedSender } from "./validate.js";

export function registerSetupIpc({ ipcMain, service, getSetupWindow } = {}) {
  const channels = [];
  const register = (action, validate, operation) => {
    const channel = `la:setup:${action}`;
    channels.push(channel);
    ipcMain.handle(channel, async (event, args) => {
      if (!isTrustedSender(event, getSetupWindow())) return fail("E_FORBIDDEN", "只接受首次启动向导窗口的调用");
      try {
        if (!validate(args)) return fail("E_INVALID_ARGUMENT", "向导参数无效");
        return ok(await operation(args));
      } catch (error) { return errorResult(error, "首次启动未完成，未切换数据目录"); }
    });
  };
  register("get-defaults", acceptsNoArguments, () => service.getDefaults());
  register("choose-folder", acceptsNoArguments, () => service.chooseFolder());
  register("validate-folder", (args) => isPlainObject(args) && isNonEmptyString(args.path, 4096), (args) => service.validateFolder(args));
  register("inspect-backup", acceptsNoArguments, () => service.inspectBackup());
  register("inspect-backup-with-password", (args) => isPlainObject(args) && isNonEmptyString(args.inspectId, 200) && isNonEmptyString(args.password, 1024), (args) => service.inspectBackupWithPassword(args));
  register("finish", (args) => isPlainObject(args) && isNonEmptyString(args.dataRoot, 4096) && ["blank", "restore"].includes(args.start) && (args.start === "blank" ? args.token === undefined : isNonEmptyString(args.token, 200)), (args) => service.finish(args));
  return () => { for (const channel of channels) ipcMain.removeHandler(channel); };
}
