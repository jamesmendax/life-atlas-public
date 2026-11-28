import { createTranslator, getActiveLocale } from "./core.js";
import { LOCALE_METADATA, SUPPORTED_LOCALES } from "./locales.js";
import * as format from "./format.js";
import { commonCatalog } from "./catalogs/common.js";
import { vaultCatalog } from "./catalogs/vault.js";

function mergeCatalog(base, extra) {
  const result = {};
  for (const code of SUPPORTED_LOCALES) {
    result[code] = { ...(base[code] || {}), ...(extra[code] || {}) };
  }
  return result;
}

export const vaultTranslator = createTranslator(mergeCatalog(commonCatalog, vaultCatalog));

export function tVault(key, params, locale = getActiveLocale()) {
  return vaultTranslator.t(locale, key, params);
}

export { format, getActiveLocale, LOCALE_METADATA, SUPPORTED_LOCALES };
