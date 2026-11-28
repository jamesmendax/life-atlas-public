import fs from "node:fs";
import path from "node:path";
import { DEFAULT_LEGACY_LOCALE, SUPPORTED_LOCALES, matchSystemLocale } from "../../src/i18n/locales.js";
import { assertPhysicalPath, writeAtomicJson } from "./storage/dataRoot.js";
import { tMain } from "./i18n/index.js";
import { fail, ok } from "./ipc/result.js";
import { isPlainObject, isTrustedSender } from "./ipc/validate.js";

function readConfig(file) {
  try {
    return JSON.parse(fs.readFileSync(assertPhysicalPath(file, { allowMissing: false }), "utf8"));
  } catch {
    return null;
  }
}

export function createLocalePreferences({ bootstrapFile, getPreferredSystemLanguages = () => [], testHooksEnabled = false, env = process.env }) {
  const file = path.join(path.dirname(bootstrapFile), "locale.json");
  const savedValue = readConfig(file)?.locale;
  let savedLocale = SUPPORTED_LOCALES.includes(savedValue) ? savedValue : undefined;
  let locale = savedLocale;
  if (!locale) {
    const legacyDataRoot = readConfig(bootstrapFile)?.dataRoot;
    const testLanguages = testHooksEnabled === true && env.LIFE_ATLAS_TEST_SYSTEM_LOCALES;
    locale = typeof legacyDataRoot === "string" && legacyDataRoot.trim()
      ? DEFAULT_LEGACY_LOCALE
      : matchSystemLocale(testLanguages ? testLanguages.split(",") : getPreferredSystemLanguages());
  }
  const listeners = new Set();
  return {
    get: () => ({ locale }),
    subscribe(callback) {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    set(value) {
      if (!SUPPORTED_LOCALES.includes(value)) throw new TypeError(tMain("语言设置无效"));
      if (value !== savedLocale) {
        writeAtomicJson(file, { locale: value });
        savedLocale = value;
      }
      if (locale !== value) {
        locale = value;
        const preference = Object.freeze({ locale });
        for (const callback of listeners) callback(preference);
      }
      return { locale };
    },
  };
}

export function registerLocaleIpc({ ipcMain, preferences, getWindows, getWritableWindows }) {
  ipcMain.handle("la:locale:get", (event, ...args) => {
    if (!getWindows().some((window) => isTrustedSender(event, window))) return fail("E_FORBIDDEN", "只接受应用窗口的调用");
    if (args.length !== 0) return fail("E_INVALID_ARGUMENT", "语言读取不接受参数");
    return ok(preferences.get());
  });
  ipcMain.handle("la:locale:set", (event, ...args) => {
    if (!getWritableWindows().some((window) => isTrustedSender(event, window))) return fail("E_FORBIDDEN", "只允许在工作区或首次启动向导更改语言");
    const [input] = args;
    if (args.length !== 1 || !isPlainObject(input) || Reflect.ownKeys(input).length !== 1 || !Object.hasOwn(input, "locale") || !SUPPORTED_LOCALES.includes(input.locale)) {
      return fail("E_INVALID_ARGUMENT", "语言设置无效");
    }
    try {
      return ok(preferences.set(input.locale));
    } catch {
      return fail("E_IO", "无法保存语言设置，请重试");
    }
  });
}
