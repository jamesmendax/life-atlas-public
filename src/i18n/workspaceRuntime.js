import { createTranslator, getActiveLocale } from "./core.js";
import { LOCALE_METADATA, SUPPORTED_LOCALES } from "./locales.js";
import { I18nProvider, useI18n } from "./react.jsx";
import * as format from "./format.js";
import { commonCatalog } from "./catalogs/common.js";
import { shellCatalog } from "./catalogs/shell.js";
import { settingsCatalog } from "./catalogs/settings.js";
import { backupCatalog } from "./catalogs/backup.js";
import { marketCatalog } from "./catalogs/market.js";
import { databaseCatalog } from "./catalogs/database.js";
import { editorCatalog } from "./catalogs/editor.js";
import { assistantCatalog } from "./catalogs/assistant.js";
import { dialogsCatalog } from "./catalogs/dialogs.js";
import { shellExtraCatalog } from "./catalogs/shellExtra.js";
import { databaseExtraCatalog } from "./catalogs/databaseExtra.js";

const SOURCES = [
  commonCatalog,
  shellCatalog,
  settingsCatalog,
  backupCatalog,
  marketCatalog,
  databaseCatalog,
  databaseExtraCatalog,
  editorCatalog,
  assistantCatalog,
  dialogsCatalog,
  shellExtraCatalog,
];

function buildWorkspaceCatalogs() {
  const merged = {};
  for (const code of SUPPORTED_LOCALES) {
    const bucket = {};
    for (const source of SOURCES) {
      Object.assign(bucket, source[code] || {});
    }
    merged[code] = bucket;
  }
  return merged;
}

export const workspaceCatalogs = buildWorkspaceCatalogs();
export const workspaceTranslator = createTranslator(workspaceCatalogs);

export function tWorkspace(key, params, locale = getActiveLocale()) {
  return workspaceTranslator.t(locale, key, params);
}

export function WorkspaceI18nProvider({ bridge, initialLocale, children }) {
  return I18nProvider({ bridge, translator: workspaceTranslator, initialLocale, children });
}

export { I18nProvider, useI18n, format, getActiveLocale, LOCALE_METADATA, SUPPORTED_LOCALES };
