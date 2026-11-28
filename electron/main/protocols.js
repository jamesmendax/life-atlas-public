import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { contentTypeFor, resolveAppFile } from "./appPaths.js";

export function registerAppScheme(protocol) {
  protocol.registerSchemesAsPrivileged([
    { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true } },
    { scheme: "life-asset", privileges: { standard: false, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
    { scheme: "life-widget", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
  ]);
}

export function createAppResponse(request, { distDir, csp }) {
  const file = resolveAppFile(distDir, request.url);
  if (!file) return new Response("Not found", { status: 404, headers: { "X-Content-Type-Options": "nosniff" } });
  if (!["GET", "HEAD"].includes(request.method || "GET")) return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });
  const headers = { "Content-Type": contentTypeFor(file), "X-Content-Type-Options": "nosniff", "Content-Length": String(fs.statSync(file).size) };
  if (path.extname(file).toLowerCase() === ".html") headers["Content-Security-Policy"] = csp;
  return new Response(request.method === "HEAD" ? null : Readable.toWeb(fs.createReadStream(file)), { status: 200, headers });
}

export function installAppProtocol(targetSession, options) {
  targetSession.protocol.handle("app", (request) => createAppResponse(request, options));
}
