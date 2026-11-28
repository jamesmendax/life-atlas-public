import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { assertPhysicalPath, resolveDataRoot, bootstrapFilePath, ensureDataRootMarker, acquireDataRootLock, releaseDataRootLock, isSyncDrivePath } from "../electron/main/storage/dataRoot.js";
import { createLogger } from "../electron/main/logger.js";
import { resolveAppFile } from "../electron/main/appPaths.js";
import { shouldBlockRequest, validatedDevOrigin } from "../electron/main/networkPolicy.js";
import { resolveFlavor, areTestHooksEnabled } from "../electron/main/flavor.js";
import { createIsolatedDirectory, removeIsolatedDirectory } from "./desktop/helpers.mjs";

function fixture(context, label = "main-unit") {
  const directory = createIsolatedDirectory(label);
  context.after(() => removeIsolatedDirectory(directory));
  return directory;
}

test("resolveDataRoot prefers env, then bootstrap, then the dev default", (context) => {
  const directory = fixture(context);
  const dataRoot = path.join(directory, "data");
  const bootstrapFile = path.join(directory, "bootstrap.json");
  fs.writeFileSync(bootstrapFile, JSON.stringify({ dataRoot: path.join(directory, "other") }));
  assert.deepEqual(resolveDataRoot({ env: { LIFE_ATLAS_DATA_ROOT: dataRoot }, bootstrapFile, flavor: "dev", repoRoot: directory }), { dataRoot, source: "env" });
  assert.equal(resolveDataRoot({ env: {}, bootstrapFile, flavor: "dev", repoRoot: directory }).source, "bootstrap");
  assert.deepEqual(resolveDataRoot({ env: {}, flavor: "dev", repoRoot: directory }), { dataRoot: path.join(directory, ".devdata"), source: "dev-default" });
  assert.deepEqual(resolveDataRoot({ env: {}, flavor: "release", repoRoot: directory }), { dataRoot: null, source: null });
});

test("bootstrapFilePath uses LIFE_ATLAS_BOOTSTRAP_DIR only when test hooks are enabled", (context) => {
  const directory = fixture(context);
  const env = { LIFE_ATLAS_BOOTSTRAP_DIR: path.join(directory, "bootstrap") };
  assert.equal(bootstrapFilePath({ appDataDir: directory, env, testHooksEnabled: true }), path.join(env.LIFE_ATLAS_BOOTSTRAP_DIR, "bootstrap.json"));
  assert.equal(bootstrapFilePath({ appDataDir: directory, env, testHooksEnabled: false }), path.join(directory, "Life Atlas", "bootstrap.json"));
});

test("ensureDataRootMarker creates the marker once and rejects a foreign marker", (context) => {
  const directory = fixture(context);
  const data = path.join(directory, "data");
  const first = ensureDataRootMarker(data, { appVersion: "0.1.0", now: "2026-11-07T00:00:00.000Z" });
  assert.deepEqual(ensureDataRootMarker(data, { appVersion: "0.2.0", now: "2026-11-08T00:00:00.000Z" }), first);
  fs.writeFileSync(path.join(data, "life-atlas.root.json"), JSON.stringify({ kind: "other", formatVersion: 1 }));
  assert.throws(() => ensureDataRootMarker(data, { appVersion: "0.1.0", now: "2026-11-07T00:00:00.000Z" }), { code: "E_INVALID_ARGUMENT" });
});

test("acquireDataRootLock reports a live holder and recovers a stale lock", (context) => {
  const directory = fixture(context);
  const args = { pid: 100, appVersion: "0.1.0", now: "2026-11-07T00:00:00.000Z", isProcessAlive: () => true };
  assert.deepEqual(acquireDataRootLock(directory, args), { ok: true });
  assert.deepEqual(acquireDataRootLock(directory, { ...args, pid: 200 }), { ok: false, heldByPid: 100 });
  assert.deepEqual(acquireDataRootLock(directory, { ...args, pid: 200, isProcessAlive: () => false }), { ok: true, staleRecovered: true });
});

test("releaseDataRootLock removes only its own lock", (context) => {
  const directory = fixture(context);
  acquireDataRootLock(directory, { pid: 100, appVersion: "0.1.0", now: "2026-11-07T00:00:00.000Z", isProcessAlive: () => false });
  assert.equal(releaseDataRootLock(directory, 200), false);
  assert.equal(fs.existsSync(path.join(directory, ".lock")), true);
  assert.equal(releaseDataRootLock(directory, 100), true);
  assert.equal(fs.existsSync(path.join(directory, ".lock")), false);
});

test("isSyncDrivePath detects the five sync folder names", () => {
  for (const name of ["ONEDRIVE", "Dropbox", "Google Drive", "iCloud", "坚果云"]) assert.equal(isSyncDrivePath(`D:/${name}/Backup`), true);
  assert.equal(isSyncDrivePath("D:/LifeAtlas"), false);
});

test("logger writes one json line per event and drops content fields", (context) => {
  const directory = fixture(context);
  fs.writeFileSync(path.join(directory, "2026-10-23.log"), "old");
  fs.writeFileSync(path.join(directory, "2026-10-24.log"), "retain");
  const logger = createLogger({ logsDir: directory, now: "2026-11-07T08:00:00.000Z" });
  logger.log("storage.saved", { pageId: "p-1", count: 2, ok: true, errorCode: "E_IO", title: "private", password: "private", body: "private", url: "https://secret.example", unsafe: { hidden: true } });
  const records = fs.readFileSync(path.join(directory, "2026-11-07.log"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(records, [{ at: "2026-11-07T08:00:00.000Z", event: "storage.saved", pageId: "p-1", count: 2, ok: true, errorCode: "E_IO" }]);
  assert.equal(fs.existsSync(path.join(directory, "2026-10-23.log")), false);
  assert.equal(fs.existsSync(path.join(directory, "2026-10-24.log")), true);
});

test("resolveAppFile refuses traversal and maps the root to index.html", (context) => {
  const directory = fixture(context);
  fs.writeFileSync(path.join(directory, "index.html"), "hello");
  assert.equal(resolveAppFile(directory, "app://bundle/"), path.join(directory, "index.html"));
  for (const url of ["app://bundle/../index.html", "app://bundle/%2e%2e/index.html", "app://bundle/%2f..%2findex.html", "app://bundle/%5c..%5cindex.html", "app://bundle/index.html:stream", "app://other/index.html", "app://user@bundle/index.html", "app://bundle:80/index.html", "app://bundle/missing.html"]) assert.equal(resolveAppFile(directory, url), null);
});

test("shouldBlockRequest blocks the web and allows only the dev server", () => {
  for (const url of ["https://example.com", "http://example.com", "ws://example.com", "wss://example.com", "http://127.0.0.1:5178", "http://localhost:5199", "http://127.0.0.1:5199.evil"]) assert.equal(shouldBlockRequest(url), true);
  assert.equal(shouldBlockRequest("http://127.0.0.1:5199/assets/main.js", { devOrigin: "http://127.0.0.1:5199" }), false);
  assert.equal(shouldBlockRequest("ws://127.0.0.1:5199/", { devOrigin: "http://127.0.0.1:5199" }), false);
  assert.equal(shouldBlockRequest("https://127.0.0.1:5199/", { devOrigin: "http://127.0.0.1:5199" }), true);
  assert.throws(() => validatedDevOrigin("http://127.0.0.1:4173"));
});

test("physical data paths reject junctions, reserved names and alternate streams", (context) => {
  const directory = fixture(context);
  const target = path.join(directory, "physical");
  const link = path.join(directory, "junction");
  fs.mkdirSync(target);
  fs.symlinkSync(target, link, "junction");
  try { assert.throws(() => assertPhysicalPath(path.join(link, "file")), { code: "E_INVALID_ARGUMENT" }); } finally { fs.rmdirSync(link); }
  for (const name of ["file:stream", "NUL.txt", "aux", "trailing.", "trailing "]) assert.throws(() => assertPhysicalPath(path.join(directory, name)), { code: "E_INVALID_ARGUMENT" });
  assert.throws(() => assertPhysicalPath(path.join(directory, "..", "outside"), { root: directory }), { code: "E_INVALID_ARGUMENT" });
});

test("packaged release flavor cannot enable test hooks through environment variables", () => {
  assert.equal(resolveFlavor({ isPackaged: false }), "dev");
  assert.equal(resolveFlavor({ isPackaged: true, packageJson: { lifeAtlasFlavor: "test" } }), "test");
  assert.equal(resolveFlavor({ isPackaged: true, packageJson: { lifeAtlasFlavor: "dev" } }), "release");
  assert.equal(areTestHooksEnabled("release", { LIFE_ATLAS_TEST: "1" }), false);
  assert.equal(areTestHooksEnabled("unknown", { LIFE_ATLAS_TEST: "1" }), false);
  assert.equal(areTestHooksEnabled("test", { LIFE_ATLAS_TEST: "1" }), true);
});
