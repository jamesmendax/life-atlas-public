import fs from "node:fs";
import path from "node:path";
import { fail, ok } from "./ipc/result.js";
import { acceptsNoArguments, isTrustedSender } from "./ipc/validate.js";

export function createContrastPreferences(file, notify = () => {}) {
  let preference = "system";
  try { const value = JSON.parse(fs.readFileSync(file, "utf8")); if (["system", "standard", "high"].includes(value.preference)) preference = value.preference; } catch { /* A first launch follows the system. */ }
  return {
    get: () => ({ preference }),
    set(value) {
      if (!["system", "standard", "high"].includes(value)) throw new TypeError("对比度设置无效");
      if (value !== preference) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const pending = file + ".pending";
        try { fs.writeFileSync(pending, JSON.stringify({ preference: value }), "utf8"); fs.renameSync(pending, file); }
        finally { if (fs.existsSync(pending)) fs.unlinkSync(pending); }
        preference = value;
      }
      notify({ preference });
      return { preference };
    },
  };
}

export function registerContrastReadIpc({ ipcMain, getWindows, preferences }) {
  ipcMain.handle("la:appearance:get-contrast", (event, args) => {
    if (!getWindows().some((window) => isTrustedSender(event, window))) return fail("E_FORBIDDEN", "只接受应用窗口的调用");
    if (!acceptsNoArguments(args)) return fail("E_INVALID_ARGUMENT", "对比度读取不接受参数");
    return ok(preferences.get());
  });
}
