import { ok, fail, errorResult } from "./result.js";
import { isPlainObject, isTrustedSender } from "./validate.js";
import { validateMarkdownExportPayload, writeMarkdownFolder } from "../exports/markdownFolder.js";
import { tMain } from "../i18n/index.js";

export function registerExportsIpc({ ipcMain, assetStore, dialogs, getWorkspaceWindow, now } = {}) {
  const channel = "la:exports:write-markdown-folder";
  ipcMain.handle(channel, async (event, payload) => {
    const window = getWorkspaceWindow();
    if (!isTrustedSender(event, window)) return fail("E_FORBIDDEN", "只接受工作区窗口的调用");
    if (!isPlainObject(payload)) return fail("E_INVALID_ARGUMENT", "导出参数无效");
    try {
      validateMarkdownExportPayload(payload);
      const selected = await dialogs.showOpenDialog(window, { title: tMain("选择导出文件夹"), properties: ["openDirectory", "createDirectory"] });
      if (selected.canceled || !selected.filePaths?.length) return fail("E_CANCELLED", "已取消导出");
      return ok(await writeMarkdownFolder(payload, { directory: selected.filePaths[0], assetStore, now }));
    } catch (error) { return errorResult(error, "导出失败"); }
  });
  return () => ipcMain.removeHandler(channel);
}
