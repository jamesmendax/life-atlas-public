import { CONTRAST_PREFERENCES } from "./devicePreferences.js";

export const CONTRAST_LABELS = { system: "跟随系统", standard: "标准", high: "高对比" };

export function getContrastLabels(t) {
  return {
    system: t("common.contrast.system"),
    standard: t("common.contrast.standard"),
    high: t("common.contrast.high"),
  };
}

export function applyContrast(preference, root = document.documentElement) {
  const value = CONTRAST_PREFERENCES.includes(preference) ? preference : "system";
  root.dataset.contrast = value;
  root.dataset.resolvedContrast = value === "high" || (value === "system" && globalThis.matchMedia?.("(prefers-contrast: more)").matches) ? "high" : "standard";
}

export const THEME_STYLES = ["mobai"];
export const DEFAULT_STYLE = "mobai";
export const THEME_PREFERENCES = ["system", "light", "dark"];
export const DEFAULT_THEME_PREFERENCE = "system";
export const THEME_CACHE_KEY = "life-atlas.theme-preference";
export const THEME_LABELS = { system: "跟随系统", light: "白天", dark: "夜间" };

export function getThemeLabels(t) {
  return {
    system: t("common.theme.system"),
    light: t("common.theme.light"),
    dark: t("common.theme.dark"),
  };
}

export function normalizeThemePreference(value) {
  return THEME_PREFERENCES.includes(value) ? value : DEFAULT_THEME_PREFERENCE;
}

export function resolveTheme(preference, prefersDark) {
  const value = normalizeThemePreference(preference);
  return value === "system" ? prefersDark ? "dark" : "light" : value;
}

export function nextThemePreference(preference) {
  const index = THEME_PREFERENCES.indexOf(normalizeThemePreference(preference));
  return THEME_PREFERENCES[(index + 1) % THEME_PREFERENCES.length];
}

export function applyTheme(resolved, root = document.documentElement, style = DEFAULT_STYLE) {
  root.dataset.style = THEME_STYLES.includes(style) ? style : DEFAULT_STYLE;
  root.dataset.theme = resolved === "dark" ? "dark" : "light";
}

export function systemPrefersDark() {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function watchMedia(queryText, callback) {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const query = window.matchMedia(queryText);
  const listener = (event) => callback(event.matches);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}

export function watchSystemTheme(callback) {
  return watchMedia("(prefers-color-scheme: dark)", callback);
}

export function watchSystemContrast(callback) {
  return watchMedia("(prefers-contrast: more)", callback);
}

export function readCachedPreference(storage = globalThis.localStorage) {
  try { return normalizeThemePreference(storage?.getItem(THEME_CACHE_KEY)); } catch { return DEFAULT_THEME_PREFERENCE; }
}

export function writeCachedPreference(preference, storage = globalThis.localStorage) {
  try { storage?.setItem(THEME_CACHE_KEY, normalizeThemePreference(preference)); } catch { return; }
}
