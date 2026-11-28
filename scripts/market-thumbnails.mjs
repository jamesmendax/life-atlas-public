import sharp from "sharp";
import { marketHash, validateMarketPng } from "../electron/main/market/package.js";
import { preserveFile, readDistributionFile } from "./market-archives.mjs";

export const MAX_THUMBNAIL_BYTES = 80 * 1024;
export const MAX_THUMBNAIL_EDGE = 640;

function fits(bytes) {
  return bytes.length <= MAX_THUMBNAIL_BYTES && Math.max(bytes.readUInt32BE(16), bytes.readUInt32BE(20)) <= MAX_THUMBNAIL_EDGE;
}

export async function makeMarketThumbnail(source) {
  validateMarketPng(source);
  if (fits(source)) return source;
  // Favor map labels and fine UI lines by retaining the resolution on the second pass.
  for (const [edge, quality] of [[640, 88], [640, 65], [560, 72], [480, 70], [384, 65], [256, 60]]) {
    const png = await resizePng(source, edge, quality);
    if (fits(png)) return png;
  }
  throw new Error("市集缩略图超过 80 KiB");
}

function resizePng(source, edge, quality) {
  return sharp(source, { limitInputPixels: 4096 * 4096 }).resize({
    width: edge, height: edge, fit: "inside", withoutEnlargement: true, kernel: sharp.kernel.lanczos3,
  }).png({ palette: true, quality, dither: 0.15, compressionLevel: 9, effort: 5 }).toBuffer();
}

async function separateFromPackage(thumbnail, packagedImageHashes) {
  if (!packagedImageHashes.has(marketHash(thumbnail))) return thumbnail;
  const longestSide = Math.max(thumbnail.readUInt32BE(16), thumbnail.readUInt32BE(20));
  for (let edge = Math.floor(longestSide / 2); edge >= 1; edge = Math.floor(edge / 2)) {
    const reduced = await resizePng(thumbnail, edge, 70);
    if (reduced.length < thumbnail.length && !packagedImageHashes.has(marketHash(reduced))) return reduced;
  }
  // A single pixel, or a PNG that cannot be made smaller, has no gallery image.
  return null;
}

export async function createThumbnailWriter(staging, prior, catalogues, packagedImageHashes) {
  const byDigest = new Map();
  const written = new Set();
  const known = [...catalogues.legacy.entries, ...(catalogues.rich?.entries || [])];
  for (const relative of new Set(known.map((entry) => entry.previewPath).filter(Boolean))) {
    if (!relative.startsWith("previews/")) throw new Error("无效的市集预览路径");
    const bytes = await readDistributionFile(prior, relative, 2 * 1024 * 1024);
    validateMarketPng(bytes);
    if (fits(bytes)) {
      const digest = marketHash(bytes);
      if (!byDigest.has(digest)) byDigest.set(digest, relative);
    }
  }
  return async (source) => {
    const bytes = await separateFromPackage(await makeMarketThumbnail(source), packagedImageHashes);
    if (!bytes) return undefined;
    const digest = marketHash(bytes);
    const relative = byDigest.get(digest) || "previews/thumbs/" + digest + ".png";
    if (!written.has(digest)) {
      await preserveFile(staging, relative, bytes);
      byDigest.set(digest, relative);
      written.add(digest);
    }
    return relative;
  };
}
