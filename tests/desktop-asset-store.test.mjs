import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createAssetStore, MAX_ASSET_BYTES } from "../electron/main/storage/assetStore.js";
import { openWorkspaceDatabase, prepareWritable } from "../electron/main/storage/workspaceDb.js";
import { parseAssetUrl, parseRangeHeader, createAssetResponse, ASSET_CSP } from "../electron/main/assetProtocol.js";
import { createIsolatedDirectory, removeIsolatedDirectory } from "./desktop/helpers.mjs";

function fixture(context) {
  const directory = createIsolatedDirectory("asset-store");
  const db = openWorkspaceDatabase(path.join(directory, "workspace.db"));
  prepareWritable(db);
  context.after(() => { db.close(); removeIsolatedDirectory(directory); });
  return { store: createAssetStore({ assetsDir: path.join(directory, "assets"), db, now: "2026-10-01T08:00:00.000Z" }), directory, db };
}

test("put stores the file under its sha256 once", (context) => {
  const { store, directory } = fixture(context);
  const bytes = new Uint8Array(Buffer.from("attachment bytes", "utf8"));
  const hash = createHash("sha256").update(bytes).digest("hex");
  const first = store.put({ bytes, mime: "text/plain", name: "first.txt" });
  assert.deepEqual(first, { assetId: hash, url: `life-asset://${hash}`, created: true });
  assert.equal(store.filePath(hash), path.join(directory, "assets", hash.slice(0, 2), hash));
  assert.deepEqual(fs.readFileSync(store.filePath(hash)), Buffer.from(bytes));
  assert.equal(store.put({ bytes, mime: "text/plain", name: "again.txt" }).created, false);
  assert.equal(store.get(hash).originalName, "first.txt");
  assert.equal(store.list().length, 1);
  assert.deepEqual(fs.readdirSync(path.dirname(store.filePath(hash))), [hash]);
});

test("put rejects files over 1 GB", (context) => {
  const { store } = fixture(context);
  assert.throws(() => store.put({ bytes: { byteLength: MAX_ASSET_BYTES + 1 }, mime: "application/octet-stream", name: "large.bin" }), { code: "E_INVALID_ARGUMENT" });
});

test("parseAssetUrl accepts only 64 lowercase hex digits", () => {
  const valid = "a1".repeat(32);
  assert.equal(parseAssetUrl(`life-asset://${valid}`), valid);
  assert.equal(parseAssetUrl(`life-asset://${valid}/`), valid);
  for (const url of ["life-asset://xyz", `life-asset://${valid.toUpperCase()}`, `life-asset://${valid}/x`, `life-asset://${valid}?x`, `life-asset://${valid}#x`, `life-asset://user@${valid}`, `life-asset://${valid}:80`, `life-asset://../${valid}`, `https://${valid}`]) assert.equal(parseAssetUrl(url), null);
});

test("opaque asset URLs preserve numeric hashes and reject host aliases", (context) => {
  const { store } = fixture(context);
  for (const hash of ["0".repeat(64), "1".repeat(64), "9".repeat(64)]) {
    assert.equal(parseAssetUrl(`life-asset://${hash}`), hash);
    assert.equal(createAssetResponse(new Request(`life-asset://${hash}`), { assetStore: store }).status, 404);
  }
  for (const url of ["life-asset://0.0.0.0/", "life-asset://0/", "life-asset://0x0/", "life-asset://127.0.0.1/", `life-asset://${"0".repeat(63)}`, `life-asset://${"0".repeat(65)}`]) {
    assert.equal(parseAssetUrl(url), null);
    assert.equal(createAssetResponse(new Request(url), { assetStore: store }).status, 400);
  }
});

test("parseRangeHeader handles the three single-range forms and rejects the rest", () => {
  assert.equal(parseRangeHeader(null, 20), null);
  assert.deepEqual(parseRangeHeader("bytes=0-9", 20), { start: 0, end: 9 });
  assert.deepEqual(parseRangeHeader("bytes=10-", 20), { start: 10, end: 19 });
  assert.deepEqual(parseRangeHeader("bytes=-5", 20), { start: 15, end: 19 });
  assert.deepEqual(parseRangeHeader("bytes=-50", 20), { start: 0, end: 19 });
  for (const range of ["", "bytes=-", "bytes=20-", "bytes=10-5", "bytes=0-20", "bytes=-0", "bytes=0-1,3-5", "Bytes=0-1", "bytes=0.5-1", "bytes=9007199254740992-", "items=0-1"]) assert.equal(parseRangeHeader(range, 20), "invalid");
  assert.equal(parseRangeHeader("bytes=0-0", 0), "invalid");
});

test("asset responses stream ranges with safe MIME and headers", async (context) => {
  const { store } = fixture(context);
  const html = new Uint8Array(Buffer.from("<script>alert(1)</script>", "utf8"));
  const result = store.put({ bytes: html, mime: "text/html;charset=utf-8", name: "unsafe.html" });
  const response = createAssetResponse(new Request(result.url, { headers: { Range: "bytes=0-9" } }), { assetStore: store });
  assert.equal(response.status, 206);
  assert.equal(response.headers.get("content-type"), "text/plain; charset=utf-8");
  assert.equal(response.headers.get("content-security-policy"), ASSET_CSP);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("content-range"), `bytes 0-9/${html.byteLength}`);
  assert.equal((await response.arrayBuffer()).byteLength, 10);
  assert.equal(createAssetResponse(new Request("life-asset://xyz"), { assetStore: store }).status, 400);
  assert.equal(createAssetResponse(new Request(`life-asset://${"0".repeat(64)}`), { assetStore: store }).status, 404);
  assert.equal(createAssetResponse(new Request(result.url, { headers: { Range: "bytes=100-" } }), { assetStore: store }).status, 416);
  const head = createAssetResponse(new Request(result.url, { method: "HEAD" }), { assetStore: store });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("content-length"), String(html.length));
  assert.equal((await head.arrayBuffer()).byteLength, 0);
});

test("asset paths reject traversal and invalid metadata without writing", (context) => {
  const { store, directory } = fixture(context);
  for (const value of ["../outside", "A".repeat(64), "a".repeat(64) + ":stream"]) assert.throws(() => store.filePath(value), { code: "E_INVALID_ARGUMENT" });
  assert.throws(() => store.put({ bytes: new ArrayBuffer(1), mime: "text/plain\r\nX-Evil: yes", name: "test" }), { code: "E_INVALID_ARGUMENT" });
  assert.equal(fs.existsSync(path.join(directory, "assets")), false);
});

test("asset responses expose safe range headers only to the workspace origin", async (context) => {
  const { store } = fixture(context);
  const uploaded = store.put({ bytes: new Uint8Array(Buffer.from("local asset bytes")), mime: "text/plain", name: "local.txt" });
  const request = (url, options = {}) => new Request(url, { ...options, headers: { Origin: "app://bundle", ...options.headers } });
  const response = createAssetResponse(request(uploaded.url, { headers: { Range: "bytes=0-9" } }), { assetStore: store });
  assert.equal(response.status, 206);
  assert.equal(response.headers.get("access-control-allow-origin"), "app://bundle");
  assert.equal(response.headers.get("vary"), "Origin");
  assert.equal(response.headers.get("access-control-allow-credentials"), null);
  for (const header of ["Accept-Ranges", "Content-Range", "Content-Security-Policy", "X-Content-Type-Options"]) assert.ok(response.headers.get("access-control-expose-headers").split(", ").includes(header));
  for (const [url, status] of [["life-asset://xyz", 400], [`life-asset://${"0".repeat(64)}`, 404]]) {
    const failed = createAssetResponse(request(url), { assetStore: store });
    assert.equal(failed.status, status);
    assert.equal(failed.headers.get("access-control-allow-origin"), "app://bundle");
  }
  const preflight = createAssetResponse(request(uploaded.url, { method: "OPTIONS", headers: { "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "range" } }), { assetStore: store });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-methods"), "GET, HEAD");
  assert.equal(preflight.headers.get("access-control-allow-headers"), "Range");
  for (const origin of ["app://evil", "https://example.com", "null", "http://127.0.0.1:4173"]) {
    const blocked = createAssetResponse(request(uploaded.url, { headers: { Origin: origin } }), { assetStore: store });
    assert.equal(blocked.status, 403);
    assert.equal(blocked.headers.get("access-control-allow-origin"), null);
    assert.equal(await blocked.text(), "Asset origin forbidden");
  }
  const dev = createAssetResponse(request(uploaded.url, { headers: { Origin: "http://127.0.0.1:5199" } }), { assetStore: store, allowedOrigin: "http://127.0.0.1:5199" });
  assert.equal(dev.status, 200);
  assert.equal(dev.headers.get("access-control-allow-origin"), "http://127.0.0.1:5199");
});
