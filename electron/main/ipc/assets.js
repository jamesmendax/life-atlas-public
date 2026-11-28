import { ok, fail, errorResult } from "./result.js";
import { isPlainObject, isTrustedSender, acceptsNoArguments } from "./validate.js";
import { MAX_ASSET_BYTES } from "../storage/assetStore.js";
import { marketMimes } from "../storage/marketArchives.js";

export function registerAssetsIpc({ ipcMain, assetStore, getWorkspaceWindow, maintenance } = {}) {
  const register = (action, validate, operation) => {
    ipcMain.handle(`la:assets:${action}`, async (event, args) => {
      if (!isTrustedSender(event, getWorkspaceWindow())) return fail("E_FORBIDDEN", "只接受工作区窗口的调用");
      if (!validate(args)) return fail("E_INVALID_ARGUMENT", "附件参数无效");
      try { return ok(await operation(args)); } catch (error) { return errorResult(error, "附件操作失败"); }
    });
  };
  register("put", (args) => isPlainObject(args) && args.bytes instanceof ArrayBuffer && args.bytes.byteLength <= MAX_ASSET_BYTES && typeof args.mime === "string" && args.mime.length <= 200 && !/[\r\n\0]/.test(args.mime) && typeof args.name === "string" && args.name.length <= 255 && !/[\r\n\0]/.test(args.name), async (args) => {
    const baseMime = args.mime.split(";", 1)[0].trim().toLowerCase();
    const attachment = marketMimes.includes(baseMime) ? { ...args, mime: "application/octet-stream" } : args;
    const { assetId, url } = await assetStore.put(attachment);
    return { assetId, url };
  });
  if (maintenance) {
    register("scan-unreferenced", acceptsNoArguments, () => maintenance.scanUnreferenced());
    register("move-to-trash", (args) => isPlainObject(args) && Array.isArray(args.sha256s) && args.sha256s.length > 0 && args.sha256s.every((value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value)) && new Set(args.sha256s).size === args.sha256s.length, (args) => maintenance.moveToTrash(args));
    register("list-trash", acceptsNoArguments, () => maintenance.listTrash());
    register("restore-trash", (args) => isPlainObject(args) && typeof args.trashId === "string" && /^\d{8}-\d{6}-[a-f0-9]{4}$/.test(args.trashId), (args) => maintenance.restoreTrash(args));
  }
}
