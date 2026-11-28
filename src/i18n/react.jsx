import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { LOCALE_METADATA, SUPPORTED_LOCALES, isSupportedLocale, normalizeLocale } from "./locales.js";
import { applyLocaleToDocument, createTranslator, getActiveLocale, setActiveLocale } from "./core.js";
import * as formatters from "./format.js";

const defaultCatalogTranslator = createTranslator({});

const I18nContext = createContext({
  locale: "zh-CN",
  locales: SUPPORTED_LOCALES,
  metadata: LOCALE_METADATA,
  canChangeLocale: false,
  setLocale: async () => "zh-CN",
  t: (key, params) => defaultCatalogTranslator.t(getActiveLocale(), key, params),
  format: formatters,
});

export function I18nProvider({ bridge, translator = defaultCatalogTranslator, initialLocale, children }) {
  const [locale, setLocaleState] = useState(() => setActiveLocale(initialLocale || getActiveLocale()));

  const syncLocale = useCallback((nextLocale) => {
    if (!isSupportedLocale(nextLocale)) return;
    const normalized = setActiveLocale(nextLocale);
    setLocaleState(normalized);
  }, []);

  useEffect(() => {
    applyLocaleToDocument(locale);
  }, [locale]);

  useEffect(() => {
    let active = true;
    const readInitial = async () => {
      try {
        const result = await bridge?.get?.();
        const value = result?.ok ? result.value?.locale : result?.locale;
        if (active && isSupportedLocale(value)) syncLocale(value);
      } catch {
        // Keep current in-memory locale if IPC bridge is unavailable in browser preview.
      }
    };
    void readInitial();
    const unsubscribe = bridge?.onChanged?.((payload) => {
      const value = typeof payload === "string" ? payload : payload?.locale;
      if (active && isSupportedLocale(value)) syncLocale(value);
    });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [bridge, syncLocale]);

  const setLocale = useCallback(async (nextLocale) => {
    const normalized = normalizeLocale(nextLocale, locale);
    if (typeof bridge?.set === "function") {
      const result = await bridge.set({ locale: normalized });
      if (result && result.ok === false) {
        throw new Error(result.error?.message || "Failed to update locale");
      }
      const confirmed = result?.ok ? result.value?.locale : result?.locale;
      syncLocale(confirmed || normalized);
      return confirmed || normalized;
    }
    syncLocale(normalized);
    return normalized;
  }, [bridge, locale, syncLocale]);

  const canChangeLocale = typeof bridge?.set === "function" || !bridge;

  const t = useCallback((key, params) => translator.t(locale, key, params), [locale, translator]);

  const value = useMemo(() => ({
    locale,
    locales: SUPPORTED_LOCALES,
    metadata: LOCALE_METADATA,
    canChangeLocale,
    setLocale,
    t,
    format: formatters,
  }), [canChangeLocale, locale, setLocale, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}
