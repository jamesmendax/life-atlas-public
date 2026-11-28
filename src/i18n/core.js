import { DEFAULT_LEGACY_LOCALE, FALLBACK_LOCALE, LOCALE_METADATA, normalizeLocale } from "./locales.js";

let activeLocale = DEFAULT_LEGACY_LOCALE;
const listeners = new Set();

export function getActiveLocale() {
  return activeLocale;
}

export function applyLocaleToDocument(locale, root = globalThis.document?.documentElement) {
  const normalized = normalizeLocale(locale, activeLocale);
  if (root) {
    const meta = LOCALE_METADATA[normalized];
    root.lang = meta?.htmlLang || normalized;
    root.dataset.locale = normalized;
  }
  return normalized;
}

export function setActiveLocale(locale) {
  const next = normalizeLocale(locale, activeLocale);
  const changed = next !== activeLocale;
  activeLocale = next;
  applyLocaleToDocument(next);
  if (changed) {
    for (const listener of listeners) listener(next);
  }
  return next;
}

export function subscribeLocale(listener) {
  if (typeof listener !== "function") return () => {};
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function interpolate(template, params) {
  if (typeof template !== "string") return "";
  if (!params || typeof params !== "object") return template;
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key) => (
    Object.hasOwn(params, key) && params[key] !== undefined && params[key] !== null
      ? String(params[key])
      : match
  ));
}

export function resolveCatalogChain(locale) {
  const chain = [];
  let cursor = normalizeLocale(locale, FALLBACK_LOCALE);
  const seen = new Set();
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    chain.push(cursor);
    cursor = LOCALE_METADATA[cursor]?.fallback || null;
  }
  if (!seen.has(FALLBACK_LOCALE)) chain.push(FALLBACK_LOCALE);
  return chain;
}

export function createTranslator(catalogs) {
  const lookup = (locale, key) => {
    const chain = resolveCatalogChain(locale);
    for (const candidate of chain) {
      const table = catalogs?.[candidate];
      if (table && Object.hasOwn(table, key) && table[key] !== undefined) {
        return table[key];
      }
    }
    return undefined;
  };

  return {
    raw: lookup,
    has: (locale, key) => lookup(locale, key) !== undefined,
    t: (locale, key, params) => {
      const value = lookup(locale, key);
      if (value === undefined) return key;
      if (typeof value === "function") return value(params || {});
      return interpolate(value, params);
    },
  };
}
