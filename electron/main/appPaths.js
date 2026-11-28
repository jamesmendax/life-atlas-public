import fs from "node:fs";
import path from "node:path";
import { assertPhysicalPath, isPathInside } from "./storage/dataRoot.js";

const MIME_TYPES = Object.freeze({
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".webp": "image/webp", ".gif": "image/gif", ".ico": "image/x-icon", ".json": "application/json; charset=utf-8",
  ".woff": "font/woff", ".woff2": "font/woff2", ".wasm": "application/wasm", ".txt": "text/plain; charset=utf-8",
});

export function resolveAppFile(distDir, requestUrl) {
  try {
    if (typeof requestUrl !== "string" || !requestUrl.startsWith("app://bundle/") || /[\0\\]/.test(requestUrl)) return null;
    const rawPath = requestUrl.slice("app://bundle".length).split(/[?#]/)[0];
    const decoded = decodeURIComponent(rawPath);
    if (/[\0\\:]/.test(decoded) || decoded.split("/").some((segment) => segment === ".." || segment === ".")) return null;
    const url = new URL(requestUrl);
    if (url.protocol !== "app:" || url.hostname !== "bundle" || url.username || url.password || url.port) return null;
    const root = path.resolve(distDir);
    const filePath = path.resolve(root, decoded === "/" ? "index.html" : decoded.slice(1));
    if (!isPathInside(root, filePath)) return null;
    const archiveMatch = /\.asar(?=[\\/]|$)/i.exec(root);
    const archivePath = archiveMatch ? root.slice(0, archiveMatch.index + 5) : null;
    if (archivePath && fs.statSync(assertPhysicalPath(archivePath, { allowMissing: false })).isFile()) {
      if (fs.lstatSync(filePath).isSymbolicLink()) return null;
    } else assertPhysicalPath(filePath, { root, allowMissing: false });
    return fs.statSync(filePath).isFile() ? filePath : null;
  } catch {
    return null;
  }
}

export function contentTypeFor(file) {
  return MIME_TYPES[path.extname(file).toLowerCase()] || "application/octet-stream";
}
