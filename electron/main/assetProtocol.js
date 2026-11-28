import fs from "node:fs";
import { Readable } from "node:stream";

export const ASSET_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:";

export function parseAssetUrl(url) {
  if (typeof url !== "string") return null;
  return /^life-asset:\/\/([a-f0-9]{64})\/?$/.exec(url)?.[1] || null;
}

export function parseRangeHeader(value, size) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !Number.isSafeInteger(size) || size <= 0) return "invalid";
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || !match[1] && !match[2]) return "invalid";
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return "invalid";
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= size || end >= size) return "invalid";
  return { start, end };
}

export function createAssetResponse(request, { assetStore, allowedOrigin = "app://bundle" }) {
  const origin = request.headers?.get?.("origin");
  if (origin && origin !== allowedOrigin) return new Response("Asset origin forbidden", { status: 403, headers: { Vary: "Origin" } });
  const cors = { "Access-Control-Allow-Origin": allowedOrigin, "Access-Control-Expose-Headers": "Accept-Ranges, Content-Range, Content-Security-Policy, X-Content-Type-Options", Vary: "Origin" };
  const sha256 = parseAssetUrl(request.url);
  if (!sha256) return new Response("Invalid asset URL", { status: 400, headers: cors });
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...cors, "Access-Control-Allow-Methods": "GET, HEAD", "Access-Control-Allow-Headers": "Range" } });
  if (!["GET", "HEAD"].includes(request.method || "GET")) return new Response(null, { status: 405, headers: { ...cors, Allow: "GET, HEAD" } });
  let metadata;
  let file;
  try {
    metadata = assetStore.get(sha256);
    file = assetStore.filePath(sha256);
    if (!metadata || !fs.existsSync(file) || !fs.lstatSync(file).isFile()) return new Response("Asset not found", { status: 404, headers: cors });
    if (fs.statSync(file).size !== metadata.size) return new Response("Asset unavailable", { status: 404, headers: cors });
  } catch {
    return new Response("Asset not found", { status: 404, headers: cors });
  }
  const mime = String(metadata.mime || "application/octet-stream");
  const headers = {
    ...cors,
    "Content-Type": /^text\/html(?:;|$)/i.test(mime) ? "text/plain; charset=utf-8" : /^[\x20-\x7e]+$/.test(mime) ? mime : "application/octet-stream",
    "Accept-Ranges": "bytes", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": ASSET_CSP,
  };
  const range = parseRangeHeader(request.headers?.get?.("range"), metadata.size);
  if (range === "invalid") return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${metadata.size}` } });
  const start = range?.start ?? 0;
  const end = range?.end ?? metadata.size - 1;
  headers["Content-Length"] = String(metadata.size === 0 ? 0 : end - start + 1);
  if (range) headers["Content-Range"] = `bytes ${start}-${end}/${metadata.size}`;
  const body = request.method === "HEAD" || metadata.size === 0 ? null : Readable.toWeb(fs.createReadStream(file, { start, end }));
  return new Response(body, { status: range ? 206 : 200, headers });
}

export function installAssetProtocol(targetSession, options) {
  targetSession.protocol.handle("life-asset", (request) => createAssetResponse(request, options));
}
