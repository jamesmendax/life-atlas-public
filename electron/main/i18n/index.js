import { DEFAULT_LEGACY_LOCALE, SUPPORTED_LOCALES } from "../../../src/i18n/locales.js";
import { nativeMessages } from "./nativeMessages.js";
import { serviceMessages } from "./serviceMessages.js";
import { startupMessages } from "./startupMessages.js";

const messages = { ...nativeMessages, ...serviceMessages, ...startupMessages };
const languageKeys = { "zh-SG": "zh-SG", "ja-JP": "ja", "en-SG": "en", "en-US": "en" };
let locale = DEFAULT_LEGACY_LOCALE;

export function getMainLocale() {
  return locale;
}

export function setMainLocale(value) {
  if (!SUPPORTED_LOCALES.includes(value)) throw new TypeError("Unsupported main process locale");
  locale = value;
}

export function tMain(source, params = {}) {
  const translation = Object.hasOwn(messages, source) ? messages[source] : undefined;
  const message = translation?.[languageKeys[locale]] ?? source;
  return message.replace(/\{(\w+)\}/g, (token, key) => Object.hasOwn(params, key) ? String(params[key]) : token);
}
