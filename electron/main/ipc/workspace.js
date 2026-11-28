import { ok, errorResult, fail } from "./result.js";
import { isTrustedSender, acceptsNoArguments } from "./validate.js";
import { validateChangeset } from "../storage/workspaceDb.js";

export function registerWorkspaceIpc({ ipcMain, service, getWorkspaceWindow, testHooks } = {}) {
  ipcMain.handle("la:workspace:load", async (event, args) => {
    if (!isTrustedSender(event, getWorkspaceWindow())) return fail("E_FORBIDDEN", "只接受工作区窗口的调用");
    if (!acceptsNoArguments(args)) return fail("E_INVALID_ARGUMENT", "此操作不接受参数");
    try { return ok(await service.load()); } catch (error) { return errorResult(error, "工作区无法读取"); }
  });
  ipcMain.handle("la:workspace:apply-changes", async (event, changeset) => {
    if (!isTrustedSender(event, getWorkspaceWindow())) return fail("E_FORBIDDEN", "只接受工作区窗口的调用");
    try {
      validateChangeset(changeset);
      const value = await service.applyChanges(changeset);
      if (testHooks) testHooks.lastChangeset = { upserts: changeset.upserts.length, deletes: changeset.deletes.length, hasUi: changeset.ui !== null };
      return ok(value);
    } catch (error) { return errorResult(error, "保存失败，请重试"); }
  });
  if (testHooks) testHooks.storageTimings = service.timings;
  return () => { ipcMain.removeHandler("la:workspace:load"); ipcMain.removeHandler("la:workspace:apply-changes"); };
}
