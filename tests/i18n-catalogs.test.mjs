import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { createTranslator, resolveCatalogChain } from "../src/i18n/core.js";
import {
  SUPPORTED_LOCALES,
  isSupportedLocale,
  matchSystemLocale,
  normalizeLocale,
} from "../src/i18n/locales.js";
import {
  formatCurrency,
  formatDate,
  formatDateTime,
  formatFileSize,
  formatNumber,
  formatWeekday,
} from "../src/i18n/format.js";
import { formatDateTime as formatContentDateTime } from "../src/domain/content.js";

const CATALOG_DIR = path.resolve(import.meta.dirname, "../src/i18n/catalogs");
const PRIMARY_LOCALES = ["zh-CN", "ja-JP", "en-US"];
const REGIONAL_LOCALES = [
  ["zh-SG", "zh-CN"],
  ["en-SG", "en-US"],
];

function extractPlaceholders(value) {
  const matches = String(value).match(/\{([a-zA-Z0-9_]+)\}/g) || [];
  return [...new Set(matches)].sort();
}

async function loadAllCatalogs() {
  const files = fs
    .readdirSync(CATALOG_DIR)
    .filter((name) => name.endsWith(".js"))
    .sort();
  assert.ok(files.length >= 14, `expected at least 14 catalogs, got ${files.length}`);
  const entries = [];
  for (const file of files) {
    const mod = await import(pathToFileURL(path.join(CATALOG_DIR, file)).href);
    const catalog = Object.values(mod).find((value) => value && typeof value === "object" && "zh-CN" in value);
    assert.ok(catalog, `catalog ${file} must export an object with "zh-CN"`);
    entries.push({ file, catalog });
  }
  return entries;
}

test("all i18n catalogs have complete primary parity, clean regional overlays, and placeholder consistency", async (t) => {
  const entries = await loadAllCatalogs();
  for (const { file, catalog } of entries) {
    await t.test(file, () => {
      const baseKeys = Object.keys(catalog["zh-CN"] || {});
      assert.ok(baseKeys.length > 0, `${file} must define keys in zh-CN`);
      const baseKeySet = new Set(baseKeys);

      for (const locale of PRIMARY_LOCALES) {
        const dict = catalog[locale];
        assert.ok(dict && typeof dict === "object", `${file} is missing primary locale ${locale}`);
        const keys = Object.keys(dict);
        const missing = baseKeys.filter((key) => !(key in dict));
        const extra = keys.filter((key) => !baseKeySet.has(key));
        assert.deepEqual(missing, [], `${file} [${locale}] missing keys`);
        assert.deepEqual(extra, [], `${file} [${locale}] extra keys`);
        for (const key of keys) {
          assert.equal(typeof dict[key], "string", `${file} [${locale}].${key} must be a string`);
          assert.notEqual(dict[key].length, 0, `${file} [${locale}].${key} must be non-empty`);
          assert.deepEqual(
            extractPlaceholders(dict[key]),
            extractPlaceholders(catalog["zh-CN"][key]),
            `${file} [${locale}].${key} placeholder mismatch`,
          );
        }
      }

      for (const [regional, parent] of REGIONAL_LOCALES) {
        const dict = catalog[regional] || {};
        for (const [key, value] of Object.entries(dict)) {
          assert.ok(baseKeySet.has(key), `${file} [${regional}] stale extra key: ${key}`);
          assert.equal(typeof value, "string", `${file} [${regional}].${key} must be a string`);
          assert.notEqual(value.length, 0, `${file} [${regional}].${key} must be non-empty`);
          assert.deepEqual(
            extractPlaceholders(value),
            extractPlaceholders(catalog[parent][key]),
            `${file} [${regional}].${key} placeholder mismatch`,
          );
        }
      }

      const translator = createTranslator(catalog);
      for (const locale of SUPPORTED_LOCALES) {
        for (const key of baseKeys) {
          assert.equal(translator.has(locale, key), true, `${file} missing resolved key ${key} for ${locale}`);
          const resolved = translator.raw(locale, key);
          assert.equal(typeof resolved, "string");
          assert.ok(resolved.length > 0, `${file} empty resolved value for ${locale}.${key}`);
        }
      }
    });
  }
});

test("locale matching, normalization, and catalog fallback chains work for all 5 locales", () => {
  assert.deepEqual(SUPPORTED_LOCALES, ["zh-CN", "zh-SG", "ja-JP", "en-SG", "en-US"]);
  assert.equal(isSupportedLocale("ja-jp"), true);
  assert.equal(isSupportedLocale("fr-FR"), false);
  assert.equal(normalizeLocale("EN_sg"), "zh-CN");
  assert.equal(normalizeLocale("en-sg"), "en-SG");
  assert.deepEqual(resolveCatalogChain("zh-SG"), ["zh-SG", "zh-CN"]);
  assert.deepEqual(resolveCatalogChain("en-SG"), ["en-SG", "en-US", "zh-CN"]);
  assert.deepEqual(resolveCatalogChain("ja-JP"), ["ja-JP", "zh-CN"]);
  assert.deepEqual(resolveCatalogChain("en-US"), ["en-US", "zh-CN"]);
  assert.deepEqual(resolveCatalogChain("zh-CN"), ["zh-CN"]);

  assert.equal(matchSystemLocale(["zh-Hans-CN"]), "zh-CN");
  assert.equal(matchSystemLocale(["zh-Hans-SG", "en-US"]), "zh-SG");
  assert.equal(matchSystemLocale(["ja-JP"]), "ja-JP");
  assert.equal(matchSystemLocale(["en-SG"]), "en-SG");
  assert.equal(matchSystemLocale(["en-US"]), "en-US");
  assert.equal(matchSystemLocale(["de-DE"]), "en-US");
});

test("locale formatters handle dates, numbers, currencies, weekdays, file sizes, and legacy zh-CN content timestamps", () => {
  const sampleIso = "2026-04-05T09:08:00Z";
  for (const locale of SUPPORTED_LOCALES) {
    assert.ok(formatDate(sampleIso, locale).length >= 8);
    assert.ok(formatDateTime(sampleIso, locale).length >= 10);
    assert.ok(formatNumber(12345.6, locale).includes("12"));
    assert.ok(formatCurrency(1200, undefined, locale).length >= 3);
    assert.ok(formatWeekday(1, locale, "short").length >= 1);
    assert.equal(formatFileSize(512, locale), "512 B");
    assert.ok(formatFileSize(2048, locale).endsWith("KB"));
  }
  assert.match(formatContentDateTime(new Date(2026, 3, 5, 9, 8, 0).toISOString(), "zh-CN"), /^2026-04-05 09:08$/);
  assert.ok(formatContentDateTime(sampleIso, "en-US").length >= 10);
  assert.equal(formatDate(null, "en-US"), "—");
});
