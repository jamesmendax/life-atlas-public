import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { marketHash, validateMarketCatalog } from "../electron/main/market/package.js";
import { checkMarketDistribution } from "../scripts/check-market-distribution.mjs";
import { createIsolatedDirectory, removeIsolatedDirectory } from "./desktop/helpers.mjs";

const require = createRequire(import.meta.url);
const { createPackage, uncache } = require("@electron/asar");
const { getConfig } = require("app-builder-lib/out/util/config/config.js");
const { copyFiles, getFileMatchers } = require("app-builder-lib/out/fileMatcher.js");
const PROJECT = fileURLToPath(new URL("../", import.meta.url));

test("desktop Market resources copy published thumbnails and enforce the offline catalogue contract", async (t) => {
  const directory = createIsolatedDirectory("market-distribution");
  t.after(() => removeIsolatedDirectory(directory));
  const app = path.join(directory, "win-unpacked");
  const resources = path.join(app, "resources");
  const market = path.join(resources, "market");
  const source = path.join(PROJECT, "market", "public");
  const config = await getConfig(PROJECT, "electron-builder.yml");
  const matchers = getFileMatchers(config, "extraResources", resources, {
    macroExpander: (value) => value,
    customBuildOptions: config.win,
    globalOutDir: directory,
    defaultSrc: PROJECT,
  });
  await copyFiles(matchers, null, false);

  const archiveSource = path.join(directory, "app-source");
  const asar = path.join(resources, "app.asar");
  fs.mkdirSync(archiveSource);
  fs.writeFileSync(path.join(archiveSource, "package.json"), "{}");
  await createPackage(archiveSource, asar);

  const catalogue = path.join(market, "catalog-v2.json");
  const catalogueBytes = fs.readFileSync(catalogue);
  const reference = validateMarketCatalog(catalogueBytes).find((entry) => entry.previewPath).previewPath;
  const thumbnail = path.join(market, reference);
  const thumbBytes = fs.readFileSync(thumbnail);
  const { bundledThumbnails, bundledPackages } = checkMarketDistribution(app);
  assert.equal(bundledPackages, 0);
  assert.equal(bundledThumbnails, fs.readdirSync(path.join(source, "previews", "thumbs")).length);

  await t.test("rejects a missing catalogue thumbnail", (subtest) => {
    fs.unlinkSync(thumbnail);
    subtest.after(() => fs.writeFileSync(thumbnail, thumbBytes));
    assert.throws(() => checkMarketDistribution(app), /Missing packaged v2 Market thumbnails/u);
  });

  await t.test("rejects a valid PNG swapped under a different digest", (subtest) => {
    const other = fs.readdirSync(path.dirname(thumbnail)).find((name) => name !== path.basename(thumbnail));
    fs.copyFileSync(path.join(path.dirname(thumbnail), other), thumbnail);
    subtest.after(() => fs.writeFileSync(thumbnail, thumbBytes));
    assert.throws(() => checkMarketDistribution(app), /thumbnail digest does not match its path/u);
  });

  await t.test("rejects an extra unhashed PNG in the thumbnails directory", (subtest) => {
    const extra = path.join(path.dirname(thumbnail), "extra.png");
    fs.writeFileSync(extra, thumbBytes);
    subtest.after(() => fs.unlinkSync(extra));
    assert.throws(() => checkMarketDistribution(app), /Unexpected file in the packaged Market thumbnails directory/u);
  });

  await t.test("rejects an extra non-PNG named after its digest", (subtest) => {
    const invalid = Buffer.from("file contents do not match the PNG extension");
    const extra = path.join(path.dirname(thumbnail), `${marketHash(invalid)}.png`);
    fs.writeFileSync(extra, invalid);
    subtest.after(() => fs.unlinkSync(extra));
    assert.throws(() => checkMarketDistribution(app), { code: "E_CORRUPT" });
  });

  await t.test("rejects legacy and traversal paths in the packaged v2 catalogue", (subtest) => {
    const edited = JSON.parse(catalogueBytes);
    const entry = edited.entries.find(({ previewPath }) => previewPath === reference);
    subtest.after(() => fs.writeFileSync(catalogue, catalogueBytes));
    entry.previewPath = "previews/focus-study.png";
    fs.writeFileSync(catalogue, JSON.stringify(edited));
    assert.throws(() => checkMarketDistribution(app), /must use content-addressed thumbnails/u);
    entry.previewPath = "previews/thumbs/../../focus-study.png";
    fs.writeFileSync(catalogue, JSON.stringify(edited));
    assert.throws(() => checkMarketDistribution(app), { code: "E_CORRUPT" });
  });

  await t.test("rejects an original preview leaked next to the thumbnails", (subtest) => {
    const original = path.join("previews", "focus-study.png");
    fs.copyFileSync(path.join(source, original), path.join(market, original));
    subtest.after(() => fs.unlinkSync(path.join(market, original)));
    assert.throws(() => checkMarketDistribution(app), /Unexpected resources in the packaged Market previews directory/u);
  });

  await t.test("rejects an optional package leaked into the desktop distribution", (subtest) => {
    const extra = path.join(resources, "optional.atlaspack");
    fs.writeFileSync(extra, "synthetic archive");
    subtest.after(() => fs.unlinkSync(extra));
    assert.throws(() => checkMarketDistribution(app), /Optional Market resources in the desktop distribution/u);
  });

  await t.test("rejects Market previews leaked into the application archive", async () => {
    const misplaced = path.join(archiveSource, "market", "public", "previews", "focus-study.png");
    fs.mkdirSync(path.dirname(misplaced), { recursive: true });
    fs.copyFileSync(path.join(source, "previews", "focus-study.png"), misplaced);
    await createPackage(archiveSource, asar);
    uncache(asar);
    assert.throws(() => checkMarketDistribution(app), /Optional Market resources in the desktop distribution/u);
  });
});
