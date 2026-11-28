import fs from "node:fs";
import { assertPhysicalPath, writeAtomicJson } from "./storage/dataRoot.js";
import { errorResult, fail, ok } from "./ipc/result.js";
import { acceptsNoArguments, isPlainObject, isTrustedSender } from "./ipc/validate.js";

const keyPattern = /^[a-f0-9]{32}$/i;

export function createTripProvider({ file, safeStorage }) {
  let revision = 0;
  let active = new AbortController();
  const location = () => assertPhysicalPath(file);
  function read() {
    try {
      const path = location();
      const stat = fs.lstatSync(path);
      if (!stat.isFile() || stat.size > 8192) throw new Error("invalid");
      const value = JSON.parse(fs.readFileSync(path, "utf8"));
      if (value.version !== 1 || typeof value.encryptedKey !== "string" ||
          !/^[A-Za-z0-9+/]+={0,2}$/.test(value.encryptedKey)) throw new Error("invalid");
      return value.encryptedKey;
    } catch (error) {
      if (error.code === "ENOENT") return "";
      throw Object.assign(new Error("高德凭据配置无法读取。"), { code: "E_CORRUPT" });
    }
  }
  function secureStorage() {
    if (!safeStorage?.isEncryptionAvailable() || safeStorage.getSelectedStorageBackend?.() === "basic_text") {
      throw Object.assign(new Error("系统密钥保护服务不可用。"), { code: "E_IO" });
    }
    return safeStorage;
  }
  function status() {
    const configured = Boolean(read());
    return { configured, searchProvider: configured ? "amap" : "nominatim", transitProvider: configured ? "amap" : "offline" };
  }
  return {
    status,
    access() {
      const value = read();
      const key = value ? secureStorage().decryptString(Buffer.from(value, "base64")) : "";
      return { key, revision, signal: active.signal };
    },
    set(input) {
      if (!isPlainObject(input) || Object.keys(input).length !== 1) throw Object.assign(new Error("地图设置无效。"), { code: "E_INVALID_ARGUMENT" });
      if (input.clear === true) fs.rmSync(location(), { force: true });
      else if (typeof input.key === "string" && keyPattern.test(input.key)) {
        writeAtomicJson(location(), { version: 1, encryptedKey: secureStorage().encryptString(input.key).toString("base64") });
      } else throw Object.assign(new Error("请输入高德开放平台的 32 位 Web 服务 Key。"), { code: "E_INVALID_ARGUMENT" });
      active.abort();
      active = new AbortController();
      revision++;
      return status();
    },
  };
}

export function registerTripProviderIpc({ ipcMain, getWindow, provider }) {
  ipcMain.handle("la:trip:provider-status", (event, args) => {
    if (!isTrustedSender(event, getWindow())) return fail("E_FORBIDDEN", "只接受工作区窗口的调用");
    if (!acceptsNoArguments(args)) return fail("E_INVALID_ARGUMENT", "地图设置无效");
    try { return ok(provider.status()); } catch (error) { return errorResult(error, "无法读取地图设置"); }
  });
  ipcMain.handle("la:trip:set-provider", (event, args) => {
    if (!isTrustedSender(event, getWindow())) return fail("E_FORBIDDEN", "只接受工作区窗口的调用");
    try { return ok(provider.set(args)); } catch (error) { return errorResult(error, "无法安全保存地图设置"); }
  });
}
