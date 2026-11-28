import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { emojiRegistry, emojiRegistryMeta } from "../src/data/emojiRegistry.generated.js";
import { iconCategories, iconRegistry, iconRegistryMeta } from "../src/data/iconRegistry.generated.js";
import { generatedCoverAssets, generatedCoverMeta } from "../src/data/coverAssets.generated.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

function uniqueCount(values) {
  return new Set(values).size;
}

test("emoji and icon registries are mature-scale and searchable", () => {
  assert.ok(emojiRegistryMeta.count >= 1500, `expected >=1500 emoji, got ${emojiRegistryMeta.count}`);
  assert.equal(emojiRegistry.length, emojiRegistryMeta.count);
  assert.ok(iconRegistryMeta.count >= 800, `expected >=800 icons, got ${iconRegistryMeta.count}`);
  assert.equal(iconRegistry.length, iconRegistryMeta.count);
  assert.ok(iconCategories.length >= 15);
  assert.equal(uniqueCount(emojiRegistry.map((item) => item.id)), emojiRegistry.length);
  assert.equal(uniqueCount(iconRegistry.map((item) => item.id)), iconRegistry.length);
  assert.ok(iconRegistry.some((item) => item.searchText.includes("化学")));
  assert.ok(emojiRegistry.some((item) => item.searchText.includes("阅读")));
});

test("Tabler picker uses a generated SVG sprite rather than thousands of React imports", () => {
  const spritePath = path.join(root, "public", "icons", "tabler-picker-sprite.svg");
  const source = fs.readFileSync(spritePath, "utf8");
  const symbols = source.match(/<symbol\b/g) ?? [];
  assert.ok(symbols.length >= 800, `expected >=800 sprite symbols, got ${symbols.length}`);
  assert.ok(symbols.length >= iconRegistry.length * 0.98);
});

test("cover library stays below 150 assets and covers all required categories", () => {
  assert.ok(generatedCoverMeta.count >= 50, `expected a useful local cover library, got ${generatedCoverMeta.count}`);
  assert.ok(generatedCoverMeta.count <= 150);
  assert.equal(generatedCoverAssets.length, generatedCoverMeta.count);

  const counts = Object.fromEntries(["masters", "nature", "astronomy", "patterns", "textures"].map((category) => [
    category,
    generatedCoverAssets.filter((item) => item.category === category).length,
  ]));
  assert.ok(counts.masters >= 20, JSON.stringify(counts));
  assert.ok(counts.nature >= 10, JSON.stringify(counts));
  assert.ok(counts.astronomy >= 8, JSON.stringify(counts));
  assert.ok(counts.patterns >= 8, JSON.stringify(counts));
  assert.ok(counts.textures >= 5, JSON.stringify(counts));
});

test("every generated cover is local, licensed, thumbnailed and reasonably compressed", () => {
  const allowedLicenses = new Set(["Public domain", "CC0", "CC0 1.0"]);
  for (const item of generatedCoverAssets) {
    assert.ok(allowedLicenses.has(item.license), `${item.id} has unsupported license ${item.license}`);
    assert.match(item.src, /^\/assets\/covers\//);
    assert.match(item.thumbnailSrc, /^\/assets\/covers\/thumbnails\//);
    assert.ok(item.sourceUrl);
    assert.ok(item.licenseUrl);
    assert.ok(item.checksum);

    const full = path.join(root, "public", item.src.replace(/^\//, ""));
    const thumb = path.join(root, "public", item.thumbnailSrc.replace(/^\//, ""));
    assert.ok(fs.existsSync(full), `missing full cover ${full}`);
    assert.ok(fs.existsSync(thumb), `missing thumbnail ${thumb}`);
    assert.ok(fs.statSync(full).size < 1_600_000, `${item.id} full cover is unexpectedly large`);
    assert.ok(fs.statSync(thumb).size < 300_000, `${item.id} thumbnail is unexpectedly large`);
  }
});

test("page icon and cover customization have independent entry points and picker modes", () => {
  const appSource = fs.readFileSync(path.join(root, "src", "App.jsx"), "utf8");
  const panelSource = fs.readFileSync(path.join(root, "src", "components", "PageCustomizePanel.jsx"), "utf8");
  const stylesSource = fs.readFileSync(path.join(root, "src", "styles.css"), "utf8");

  assert.match(appSource, /onChangeIcon=\{\(\) => setCustomizeTarget\(\{ pageId: selectedPage\.id, mode: "icon" \}\)\}/);
  assert.match(appSource, /onChangeCover=\{\(\) => setCustomizeTarget\(\{ pageId: selectedPage\.id, mode: "cover" \}\)\}/);
  assert.doesNotMatch(appSource, /className="page-customize-link"/);
  assert.match(panelSource, /mode = "icon"/);
  assert.match(panelSource, /isIconMode && <section className="customize-section">/);
  assert.match(panelSource, /!isIconMode && <section className="customize-section">/);
  assert.match(stylesSource, /\.page-cover:hover \.cover-action/);
  assert.match(stylesSource, /\.cover-action\s*\{[\s\S]*?opacity:\s*0;/);
});

test("dev server explicitly serves generated cover files as image assets", () => {
  const viteSource = fs.readFileSync(path.join(root, "vite.config.mjs"), "utf8");
  assert.match(viteSource, /generatedCoverDevServer/);
  assert.match(viteSource, /pathname\.startsWith\("\/assets\/covers\/"\)/);
  assert.match(viteSource, /"\.webp": "image\/webp"/);
  assert.match(viteSource, /fs\.createReadStream\(filePath\)\.pipe\(res\)/);
});

test("page main icon is shell-free, larger, and locally scoped", () => {
  const appSource = fs.readFileSync(path.join(root, "src", "App.jsx"), "utf8");
  const stylesSource = fs.readFileSync(path.join(root, "src", "styles.css"), "utf8");

  assert.match(appSource, /className="page-main-glyph"/);
  assert.match(stylesSource, /\.page-document-header\.has-cover \.page-icon-button\s*\{[\s\S]*?border:\s*0;[\s\S]*?background:\s*transparent;/);
  assert.match(stylesSource, /\.page-icon-button\s*\{[\s\S]*?width:\s*78px;[\s\S]*?height:\s*78px;[\s\S]*?background:\s*transparent;/);
  assert.match(stylesSource, /\.page-icon-button > span\.page-main-glyph\s*\{[\s\S]*?width:\s*70px;[\s\S]*?height:\s*70px;[\s\S]*?font-size:\s*61px;/);
  assert.match(stylesSource, /\.page-icon-button \.page-glyph-vector\.page-main-glyph\s*\{[\s\S]*?width:\s*66px;[\s\S]*?height:\s*66px;/);
  assert.match(stylesSource, /\.page-icon-button > \.page-glyph-image\.page-main-glyph\s*\{[\s\S]*?object-fit:\s*contain;[\s\S]*?border-radius:\s*0;/);
  assert.match(stylesSource, /\.page-icon-button:focus-visible\s*\{[\s\S]*?outline:/);
  assert.match(stylesSource, /\.page-tree-row \.page-glyph-vector\s*\{[\s\S]*?width:\s*15px;/);
});
