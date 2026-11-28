export const SUPPORTED_LOCALES = ["zh-CN", "zh-SG", "ja-JP", "en-SG", "en-US"];
export const DEFAULT_LEGACY_LOCALE = "zh-CN";
export const FALLBACK_LOCALE = "zh-CN";

export const LOCALE_METADATA = Object.freeze({
  "zh-CN": Object.freeze({
    code: "zh-CN",
    htmlLang: "zh-CN",
    country: "CN",
    nativeName: "简体中文（中国大陆）",
    shortLabel: "简体中文 · CN",
    selectorLabel: "简体中文（中国大陆 · CNY · zh-CN）",
    currency: "CNY",
    fallback: null,
    hour12: false,
  }),
  "zh-SG": Object.freeze({
    code: "zh-SG",
    htmlLang: "zh-SG",
    country: "SG",
    nativeName: "简体中文（新加坡）",
    shortLabel: "简体中文 · SG",
    selectorLabel: "简体中文（新加坡 · SGD · zh-SG）",
    currency: "SGD",
    fallback: "zh-CN",
    hour12: false,
  }),
  "ja-JP": Object.freeze({
    code: "ja-JP",
    htmlLang: "ja",
    country: "JP",
    nativeName: "日本語（日本）",
    shortLabel: "日本語 · JP",
    selectorLabel: "日本語（日本 · JPY · ja-JP）",
    currency: "JPY",
    fallback: "zh-CN",
    hour12: false,
  }),
  "en-SG": Object.freeze({
    code: "en-SG",
    htmlLang: "en-SG",
    country: "SG",
    nativeName: "English (Singapore)",
    shortLabel: "English · SG",
    selectorLabel: "English (Singapore · SGD · en-SG)",
    currency: "SGD",
    fallback: "en-US",
    hour12: true,
  }),
  "en-US": Object.freeze({
    code: "en-US",
    htmlLang: "en-US",
    country: "US",
    nativeName: "English (United States)",
    shortLabel: "English · US",
    selectorLabel: "English (United States · USD · en-US)",
    currency: "USD",
    fallback: "zh-CN",
    hour12: true,
  }),
});

const CANONICAL_MAP = new Map(SUPPORTED_LOCALES.map((code) => [code.toLowerCase(), code]));

export function isSupportedLocale(value) {
  return typeof value === "string" && CANONICAL_MAP.has(value.trim().toLowerCase());
}

export function normalizeLocale(value, fallback = DEFAULT_LEGACY_LOCALE) {
  if (typeof value === "string") {
    const canonical = CANONICAL_MAP.get(value.trim().toLowerCase());
    if (canonical) return canonical;
  }
  return CANONICAL_MAP.get(String(fallback || "").toLowerCase()) || DEFAULT_LEGACY_LOCALE;
}

export function matchSystemLocale(preferredLanguages = []) {
  const candidates = Array.isArray(preferredLanguages) ? preferredLanguages : [preferredLanguages];
  for (const entry of candidates) {
    if (typeof entry !== "string" || !entry.trim()) continue;
    const normalized = entry.trim().replace(/_/g, "-").toLowerCase();
    const parts = normalized.split("-").filter(Boolean);
    const language = parts[0];
    const region = parts.find((part, index) => index > 0 && part.length === 2) || "";
    if (language === "zh") {
      if (region === "sg") return "zh-SG";
      return "zh-CN";
    }
    if (language === "ja") return "ja-JP";
    if (language === "en") {
      if (region === "sg") return "en-SG";
      return "en-US";
    }
  }
  return "en-US";
}
