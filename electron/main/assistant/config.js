import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { assertPhysicalPath } from "../storage/dataRoot.js";
import { isNonEmptyString, isPlainObject } from "../ipc/validate.js";
import { normalizeSearchBaseUrl } from "./publicWeb.js";
import { assistantError } from "./errors.js";

export { assistantError } from "./errors.js";

const loopback = (hostname) => hostname === "localhost" || hostname === "[::1]" || /^127(?:\.\d{1,3}){3}$/.test(hostname);
const revisionPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;

export function normalizeProviderUrl(input) {
  let url;
  if (isNonEmptyString(input, 2048) && !/[\x00-\x20\\?#]/.test(input.trim()) && /^https?:\/\//i.test(input.trim())) {
    try { url = new URL(input.trim()); } catch {}
  }
  if (!url || url.username || url.password || (url.protocol !== "https:" && !(url.protocol === "http:" && loopback(url.hostname)))) {
    throw assistantError("E_INVALID_ARGUMENT", "基础网址须使用 HTTPS，或使用本机回环地址的 HTTP。");
  }
  const basePath = url.pathname.replace(/\/+$/, "");
  const baseUrl = `${url.origin}${basePath}`;
  url.pathname = basePath.endsWith("/chat/completions") ? basePath : `${basePath || "/v1"}/chat/completions`;
  // Keep HTTP traffic on loopback even if the local hostname resolver is customized.
  if (url.protocol === "http:" && url.hostname === "localhost") url.hostname = "127.0.0.1";
  return { baseUrl, endpoint: url.href };
}

function validateModel(value) {
  if (!isNonEmptyString(value, 200) || /[\x00-\x1f\x7f]/.test(value)) throw assistantError("E_INVALID_ARGUMENT", "请输入有效的模型名称。");
  return value.trim();
}

function publicConfig(config) {
  return {
    configured: Boolean(config),
    baseUrl: config?.baseUrl ?? "",
    model: config?.model ?? "",
    hasApiKey: Boolean(config?.encryptedKey),
    configurationId: config?.configurationId ?? null,
    ...(config?.searchBaseUrl ? { searchBaseUrl: config.searchBaseUrl } : {}),
  };
}

export function createAssistantConfig({ configDirectory, safeStorage }) {
  const configFile = () => assertPhysicalPath(path.join(configDirectory, "provider.json"), { root: configDirectory });

  function read() {
    const file = configFile();
    try {
      const info = fs.lstatSync(file);
      if (!info.isFile() || info.size > 16384) throw new Error();
      const config = JSON.parse(fs.readFileSync(file, "utf8"));
      if (isPlainObject(config) && Object.hasOwn(config, "formatVersion") && config.formatVersion !== 1) {
        throw assistantError("E_UNSUPPORTED_VERSION", "AI 服务配置使用了不支持的格式。原有配置和密钥已保留。");
      }
      if (!isPlainObject(config) || !revisionPattern.test(config.configurationId) || typeof config.encryptedKey !== "string"
        || config.encryptedKey.length > 10000 || !/^[a-zA-Z0-9+/]*={0,2}$/.test(config.encryptedKey)) throw new Error();
      return {
        ...normalizeProviderUrl(config.baseUrl),
        model: validateModel(config.model),
        encryptedKey: config.encryptedKey,
        configurationId: config.configurationId,
        searchBaseUrl: normalizeSearchBaseUrl(config.searchBaseUrl),
      };
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      if (error?.code === "E_UNSUPPORTED_VERSION") throw error;
      throw assistantError("E_CORRUPT", "AI 服务配置无法读取。原有配置和密钥已保留。");
    }
  }

  function requireSecureStorage() {
    if (!safeStorage?.isEncryptionAvailable() || safeStorage.getSelectedStorageBackend?.() === "basic_text") {
      throw assistantError("E_IO", "系统密钥加密服务不可用，无法使用 API Key。");
    }
  }

  function write(config) {
    const file = configFile();
    const directory = assertPhysicalPath(configDirectory);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const temporary = path.join(directory, `provider-${randomUUID()}.tmp`);
    try {
      fs.writeFileSync(temporary, JSON.stringify(config), { flag: "wx", mode: 0o600, flush: true });
      fs.renameSync(temporary, file);
    } finally {
      fs.rmSync(temporary, { force: true });
    }
  }

  return {
    getConfig() {
      return publicConfig(read());
    },
    configure(args) {
      if (!isPlainObject(args) || Object.keys(args).some((key) => !["baseUrl", "model", "apiKey", "clearApiKey", "searchBaseUrl"].includes(key))
        || (args.clearApiKey !== undefined && typeof args.clearApiKey !== "boolean")
        || (args.searchBaseUrl !== undefined && typeof args.searchBaseUrl !== "string")
        || (args.apiKey !== undefined && (typeof args.apiKey !== "string" || args.apiKey.length > 2048))) {
        throw assistantError("E_INVALID_ARGUMENT", "AI 服务配置格式无效。");
      }
      const { baseUrl, endpoint } = normalizeProviderUrl(args.baseUrl);
      const model = validateModel(args.model);
      const key = args.apiKey?.trim() || "";
      if ((key && args.clearApiKey) || (key && !/^[\x21-\x7e]+$/.test(key))) throw assistantError("E_INVALID_ARGUMENT", "API Key 格式无效。");
      const previous = read();
      if (previous?.encryptedKey && previous.endpoint !== endpoint && !key && !args.clearApiKey) {
        throw assistantError("E_INVALID_ARGUMENT", "更换服务地址时，请输入新 API Key 或明确清除原有 API Key。");
      }
      let encryptedKey = args.clearApiKey ? "" : previous?.encryptedKey || "";
      if (key) {
        requireSecureStorage();
        encryptedKey = safeStorage.encryptString(key).toString("base64");
        if (!encryptedKey || encryptedKey.length > 10000) throw assistantError("E_IO", "API Key 无法加密保存。");
      }
      const searchBaseUrl = args.searchBaseUrl === undefined ? previous?.searchBaseUrl : normalizeSearchBaseUrl(args.searchBaseUrl);
      const config = { formatVersion: 1, baseUrl, model, encryptedKey, configurationId: randomUUID(), ...(searchBaseUrl ? { searchBaseUrl } : {}) };
      write(config);
      return publicConfig(config);
    },
    getProvider(configurationId) {
      const config = read();
      if (!config) throw assistantError("E_INVALID_ARGUMENT", "请先配置 AI 服务。");
      if (configurationId !== undefined && configurationId !== config.configurationId) {
        throw assistantError("E_CONFLICT", "AI 服务配置已更改，请重新发送这条消息。");
      }
      let key = "";
      if (config.encryptedKey) {
        requireSecureStorage();
        try { key = safeStorage.decryptString(Buffer.from(config.encryptedKey, "base64")); }
        catch { throw assistantError("E_IO", "无法读取 API Key，请重新保存 AI 服务配置。"); }
        if (!key || !/^[\x21-\x7e]+$/.test(key)) throw assistantError("E_IO", "已保存的 API Key 无效。");
      }
      return { endpoint: config.endpoint, model: config.model, key, configurationId: config.configurationId };
    },
  };
}
