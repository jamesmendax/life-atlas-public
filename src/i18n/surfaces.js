import { createTranslator, getActiveLocale } from "./core.js";
import { LOCALE_METADATA, SUPPORTED_LOCALES } from "./locales.js";
import { I18nProvider, useI18n } from "./react.jsx";
import * as format from "./format.js";
import { commonCatalog } from "./catalogs/common.js";
import { setupCatalog } from "./catalogs/setup.js";
import { markdownPreviewCatalog } from "./catalogs/markdownPreview.js";

function mergeCatalogs(...list) {
  const merged = {};
  for (const code of SUPPORTED_LOCALES) {
    const bucket = {};
    for (const entry of list) {
      Object.assign(bucket, entry[code] || {});
    }
    merged[code] = bucket;
  }
  return merged;
}

export const setupTranslator = createTranslator(mergeCatalogs(commonCatalog, setupCatalog));
export const previewTranslator = createTranslator(mergeCatalogs(commonCatalog, markdownPreviewCatalog));

export function createSurfaceTranslator(...extraCatalogs) {
  return createTranslator(mergeCatalogs(commonCatalog, ...extraCatalogs));
}

export { I18nProvider, useI18n, format, getActiveLocale, LOCALE_METADATA, SUPPORTED_LOCALES };
