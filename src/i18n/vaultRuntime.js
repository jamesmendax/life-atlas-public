import { I18nProvider, useI18n } from "./react.jsx";
import {
  format,
  getActiveLocale,
  LOCALE_METADATA,
  SUPPORTED_LOCALES,
  tVault,
  vaultTranslator,
} from "./vaultTranslator.js";

export function VaultI18nProvider({ bridge, initialLocale, children }) {
  return I18nProvider({ bridge, translator: vaultTranslator, initialLocale, children });
}

export {
  I18nProvider,
  useI18n,
  format,
  getActiveLocale,
  LOCALE_METADATA,
  SUPPORTED_LOCALES,
  tVault,
  vaultTranslator,
};
