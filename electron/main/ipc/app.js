import { ok, fail, errorResult } from "./result.js";
import { isPlainObject, isNonEmptyString, isTrustedSender, acceptsNoArguments } from "./validate.js";
import { validateExternalUrl } from "../externalLinks.js";
import { validateSettingsPatch } from "../vault/itemModel.js";

export function registerAppIpc({ ipcMain, getWorkspaceWindow, getInfo, confirmAndOpenExternal, dialogs, nativeTheme, flushController, getDataRoot, openVaultWindow, getVaultStatus, requestVaultPreferences, notify, getQuickCaptureShortcutStatus, changeDataRoot, setContrastPreference } = {}) {
  const register = (action, validate, operation) => {
    ipcMain.handle(`la:app:${action}`, async (event, args) => {
      if (!isTrustedSender(event, getWorkspaceWindow())) return fail("E_FORBIDDEN", "只接受工作区窗口的调用");
      try {
        if (!validate(args)) return fail("E_INVALID_ARGUMENT", "应用参数无效");
        return ok(await operation(args));
      } catch (error) { return errorResult(error, "应用操作失败"); }
    });
  };
  register("get-info", acceptsNoArguments, () => getInfo());
  register("open-external", (args) => { if (!isPlainObject(args)) return false; validateExternalUrl(args.url); return true; }, (args) => confirmAndOpenExternal(getWorkspaceWindow(), args.url));
  register("set-theme-source", (args) => isPlainObject(args) && ["light", "dark", "system"].includes(args.source), (args) => { nativeTheme.themeSource = args.source; return {}; });
  if (setContrastPreference) register("set-contrast-preference", (args) => isPlainObject(args) && Object.keys(args).length === 1 && ["system", "standard", "high"].includes(args.preference), (args) => setContrastPreference(args.preference));
  register("flush-done", acceptsNoArguments, () => { flushController.acknowledge(); return {}; });
  register("open-data-folder", acceptsNoArguments, async () => {
    const error = await dialogs.openPath(getDataRoot());
    if (error) throw Object.assign(new Error("无法打开数据目录"), { code: "E_IO" });
    return {};
  });
  if (openVaultWindow) register("open-vault-window", (args) => args === undefined || isPlainObject(args) && (args.section === undefined || ["main", "settings"].includes(args.section)), (args) => openVaultWindow(args || {}));
  if (getVaultStatus) register("get-vault-status", acceptsNoArguments, () => { const status = getVaultStatus(); return { exists: Boolean(status.exists), locked: Boolean(status.locked) }; });
  if (requestVaultPreferences) register("request-vault-preferences", (args) => {
    if (!isPlainObject(args) || Object.keys(args).length !== 1 || !Object.hasOwn(args, "patch") || !isPlainObject(args.patch)) return false;
    validateSettingsPatch(args.patch, { requireValues: true });
    return true;
  }, requestVaultPreferences);
  if (notify) register("notify", (args) => isPlainObject(args) && isNonEmptyString(args.title, 200) && typeof args.body === "string" && args.body.length <= 2000 && isNonEmptyString(args.pageId, 200), notify);
  if (getQuickCaptureShortcutStatus) register("get-quick-capture-shortcut-status", acceptsNoArguments, getQuickCaptureShortcutStatus);
  if (changeDataRoot) register("change-data-root", acceptsNoArguments, changeDataRoot);
}
