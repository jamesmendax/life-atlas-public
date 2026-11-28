import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { marketHash, validateMarketCatalog, validateMarketPng } from "../electron/main/market/package.js";
import { assertPhysicalPath } from "../electron/main/storage/dataRoot.js";
import { MAX_THUMBNAIL_BYTES, MAX_THUMBNAIL_EDGE } from "./market-thumbnails.mjs";

const { listPackage } = createRequire(import.meta.url)("@electron/asar");
const thumbnailPath = /^previews\/thumbs\/[a-f0-9]{64}\.png$/u;

function directoryContents(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).map((entry) => {
    assert.ok(entry.isFile() || entry.isDirectory(), `Market resource must be a regular file or directory: ${entry.name}`);
    return entry.isDirectory() ? `${entry.name}/` : entry.name;
  }).sort();
}

export function checkMarketDistribution(appDirectory) {
  const resources = path.resolve(appDirectory, "resources");
  const market = path.join(resources, "market");
  const metadata = ["catalog-v2.json", "catalog.json", "trusted-keys.json"];
  const catalogue = assertPhysicalPath(path.join(market, "catalog-v2.json"), { allowMissing: false });
  assert.ok(fs.lstatSync(catalogue).isFile(), "The packaged v2 Market catalogue must be a regular file");
  const entries = validateMarketCatalog(fs.readFileSync(catalogue));
  const thumbnails = [...new Set(entries.map(({ previewPath }) => previewPath).filter(Boolean))];
  for (const thumbnail of thumbnails) {
    assert.match(thumbnail, thumbnailPath, "The packaged v2 Market catalogue must use content-addressed thumbnails");
  }
  const contents = directoryContents(market);
  const hasPreviews = contents.includes("previews/");
  const expectedContents = [...metadata, ...(hasPreviews ? ["previews/"] : [])].sort();
  assert.deepEqual(contents, expectedContents, "Unexpected resources in the packaged Market directory");
  const bundled = new Set();
  let thumbnailBytes = 0;
  if (hasPreviews) {
    const previews = path.join(market, "previews");
    assert.deepEqual(directoryContents(previews), ["thumbs/"], "Unexpected resources in the packaged Market previews directory");
    for (const name of directoryContents(path.join(previews, "thumbs"))) {
      const thumbnail = `previews/thumbs/${name}`;
      assert.match(thumbnail, thumbnailPath, "Unexpected file in the packaged Market thumbnails directory");
      const file = path.join(market, thumbnail);
      assert.ok(fs.statSync(file).size <= MAX_THUMBNAIL_BYTES, `Packaged Market thumbnail exceeds the size limit: ${thumbnail}`);
      const bytes = fs.readFileSync(file);
      validateMarketPng(bytes);
      assert.ok(Math.max(bytes.readUInt32BE(16), bytes.readUInt32BE(20)) <= MAX_THUMBNAIL_EDGE,
        `Packaged Market thumbnail exceeds the dimensions limit: ${thumbnail}`);
      assert.equal(thumbnail, `previews/thumbs/${marketHash(bytes)}.png`, "Packaged Market thumbnail digest does not match its path");
      bundled.add(thumbnail);
      thumbnailBytes += bytes.length;
    }
  }
  assert.deepEqual(thumbnails.filter((thumbnail) => !bundled.has(thumbnail)), [], "Missing packaged v2 Market thumbnails");

  const forbidden = /(?:\.atlaspack$|(?:^|\/)(?:market\/(?:packages|official|community|widget-ui)|licenses\/travel-maps|assets\/pomodoro|src\/editor\/widgets|footprint-data|trip-data|node_modules\/leaflet)(?:\/|$))/iu;
  const marketPreviews = /(?:^|\/)market\/(?:public\/)?previews(?:\/|$)/iu;
  const normalize = (name) => name.replaceAll("\\", "/");
  const diskFiles = fs.readdirSync(appDirectory, { recursive: true }).map(normalize);
  const archiveFiles = listPackage(path.join(resources, "app.asar")).map(normalize);
  const unexpected = [
    ...diskFiles.filter((name) => forbidden.test(name) || (!name.startsWith("resources/market/") && marketPreviews.test(name))),
    ...archiveFiles.filter((name) => forbidden.test(name) || marketPreviews.test(name)),
  ];
  assert.deepEqual(unexpected, [], "Optional Market resources in the desktop distribution");
  const metadataBytes = metadata.reduce((size, name) => size + fs.statSync(path.join(market, name)).size, 0);
  return { metadata, metadataBytes, bundledThumbnails: bundled.size, thumbnailBytes, bundledPackages: 0 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(checkMarketDistribution(path.resolve(process.argv[2]))));
}
