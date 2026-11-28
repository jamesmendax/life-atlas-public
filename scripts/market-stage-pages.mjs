import assert from "node:assert/strict";
import { appendFile, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { marketHash, validateMarketCatalog } from "../electron/main/market/package.js";
import { assertPhysicalPath } from "../electron/main/storage/dataRoot.js";
import { copyMarketArchives, preserveFile, readCatalogues, readDistributionFile } from "./market-archives.mjs";

async function stageArchivesAndPreviews(release, market, catalogues, version) {
  const legacyPath = "previews/travel-footprint.png";
  const footprint = catalogues.legacy.entries.find((entry) => entry.previewPath === legacyPath);
  if (!footprint) return copyMarketArchives(release, market, catalogues, version);

  assert.equal(footprint.id, "life-atlas.travel-footprint");
  const current = catalogues.rich?.entries.find((entry) => entry.id === footprint.id && entry.type === "component");
  const thumbnail = current?.previewPath;
  assert.ok(thumbnail?.startsWith("previews/") && thumbnail !== legacyPath && current.version !== footprint.version,
    "Publishing the legacy footprint URL requires the updated footprint's approved thumbnail");

  // Keep the v1 catalogue bytes and URL. The Pages artifact uses the current
  // footprint artwork there, without copying the retired artwork into staging.
  const previewsForPages = (catalogue) => ({ ...catalogue, entries: catalogue.entries.map((entry) =>
    entry.previewPath === legacyPath ? { ...entry, previewPath: thumbnail } : entry) });
  await copyMarketArchives(release, market, {
    ...catalogues, legacy: previewsForPages(catalogues.legacy), rich: previewsForPages(catalogues.rich),
  }, version);
  const bytes = await readDistributionFile(market, thumbnail, 80 * 1024);
  assert.ok(Math.max(bytes.readUInt32BE(16), bytes.readUInt32BE(20)) <= 640, "Footprint preview exceeds the thumbnail dimensions");
  if (thumbnail.startsWith("previews/thumbs/")) assert.equal(thumbnail, "previews/thumbs/" + marketHash(bytes) + ".png");
  await preserveFile(market, legacyPath, bytes);
}

export async function stageMarketPages({ releaseDirectory, stagingDirectory, version }) {
  const release = assertPhysicalPath(path.resolve(releaseDirectory), { allowMissing: false });
  const market = assertPhysicalPath(path.resolve(stagingDirectory, "market"));
  const catalogues = await readCatalogues(release);
  const current = catalogues.rich || catalogues.legacy;
  assert.ok(current.entries.length, "The approved release has no packages");
  const browserScript = await readDistributionFile(release, "catalog-data.js", 1024 * 1024);
  const browserData = /^globalThis\.lifeAtlasMarketCatalog = ([^\r\n]+);\r?\n?$/u.exec(browserScript.toString("utf8"));
  assert.ok(browserData, "Invalid website catalogue");
  assert.deepEqual(validateMarketCatalog(Buffer.from(browserData[1])), current.entries);
  const lightCatalogue = JSON.parse(current.bytes);
  assert.deepEqual(lightCatalogue, { formatVersion: 1, entries: JSON.parse(JSON.stringify(current.entries)) });
  if (catalogues.rich) assert.deepEqual(JSON.parse(browserData[1]), lightCatalogue, "Website must contain only catalogue metadata");

  await mkdir(market);
  await stageArchivesAndPreviews(release, market, catalogues, version);
  await writeFile(path.join(market, "catalog.json"), catalogues.legacy.bytes);
  if (catalogues.rich) await writeFile(path.join(market, "catalog-v2.json"), current.bytes);
  await writeFile(path.join(market, "catalog-data.js"), "globalThis.lifeAtlasMarketCatalog = " + JSON.stringify(lightCatalogue) + ";\n");
  const site = catalogues.rich ? release : fileURLToPath(new URL("../market/site/", import.meta.url));
  for (const name of ["index.html", "market.css", "market.js", "theme.css", "app-icon.png"]) {
    const source = ["theme.css", "app-icon.png"].includes(name) ? release : site;
    await writeFile(path.join(market, name), await readDistributionFile(source, name, 2 * 1024 * 1024));
  }
}

if (import.meta.main) {
  const { version } = JSON.parse(await readFile("package.json", "utf8"));
  assert.match(process.env.MARKET_VERSION, /^\d+\.\d+\.\d+$/u);
  assert.equal(process.env.MARKET_VERSION, version, "Select the version of the approved release commit");
  const staging = await mkdtemp(path.join(process.env.RUNNER_TEMP, "life-atlas-market-pages-"));
  await stageMarketPages({ releaseDirectory: "market/public", stagingDirectory: staging, version });
  await appendFile(process.env.GITHUB_OUTPUT, "directory=" + staging + "\n");
}
