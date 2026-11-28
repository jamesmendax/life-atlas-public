import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createMarketTileCache } from "../electron/main/market/tileCache.js";
import { registerTripRoutesIpc } from "../electron/main/ipc/tripRoutes.js";
import { createIsolatedDirectory, removeIsolatedDirectory } from "./desktop/helpers.mjs";

const one = "a".repeat(64), two = "b".repeat(64);
const url = "https://tile.openstreetmap.org/5/1/1.png";
const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
const reply = () => new Response(png, { headers: { "content-type": "image/png" } });

function setup(t) {
  const root = createIsolatedDirectory("market-tiles");
  t.after(() => removeIsolatedDirectory(root));
  const directory = path.join(root, "index");
  const opened = [], partitions = new Map();
  const session = { fromPartition(name, options) {
    opened.push(name);
    assert.match(name, /^persist:life-atlas-market-tiles-[a-f0-9]{64}$/u);
    assert.deepEqual(options, { cache: true });
    const hash = name.slice(-64);
    if (!partitions.has(hash)) partitions.set(hash, {
      size: 0, evictions: 0, fetch: async () => reply(),
      async getCacheSize() { return this.size; },
      async clearCache() { this.evictions++; this.size = 0; },
    });
    return partitions.get(hash);
  } };
  const make = () => createMarketTileCache({ session, directory });
  return { cache: make(), directory, partitions, opened, make };
}

test("each package creates a persistent partition only on an explicit tile request, with a separate budget and accurate removal amount", async (t) => {
  const { cache, directory, partitions, opened } = setup(t);
  assert.equal(fs.existsSync(directory), false);
  assert.deepEqual(await cache.clear(one), { cacheReleasedBytes: 0, cacheCleanupPending: false });
  assert.equal(opened.length, 0);
  const request = async (hash) => assert.deepEqual(new Uint8Array(await (await cache.fetchTile(url, {}, hash)).arrayBuffer()), png);
  await request(one);
  await request(two);
  assert.equal(opened.length, 2);
  const first = partitions.get(one), second = partitions.get(two);
  first.size = 65 * 1024 * 1024;
  second.size = 512;
  for (let i = 0; i < 8; i++) await request(one);
  assert.equal(first.evictions, 1);
  assert.equal(second.evictions, 0);
  first.size = 1100;
  assert.deepEqual(await cache.clear(one), { cacheReleasedBytes: 1100, cacheCleanupPending: false });
  assert.equal(first.size, 0);
  assert.equal(second.size, 512);
  assert.deepEqual(fs.readdirSync(directory), [`${two}.json`]);
  await assert.rejects(cache.fetchTile(url, {}, "../another"), { code: "E_INVALID_ARGUMENT" });
});

test("a transfer that commits after the first cache clear is cancelled and its late bytes are cleared again", async (t) => {
  const { cache, partitions } = setup(t);
  await (await cache.fetchTile(url, {}, one)).arrayBuffer();
  const store = partitions.get(one);
  store.size = 98;
  const started = Promise.withResolvers(), resume = Promise.withResolvers(), cleared = Promise.withResolvers();
  store.clearCache = async function () { this.evictions++; this.size = 0; cleared.resolve(); };
  store.fetch = async () => { started.resolve(); await resume.promise; store.size += 11; return reply(); };
  const inflight = cache.fetchTile(url, {}, one);
  await started.promise;
  const removing = cache.clear(one);
  await cleared.promise;
  await assert.rejects(cache.fetchTile(url, {}, one), { code: "E_CONFLICT" });
  resume.resolve();
  await assert.rejects(inflight);
  assert.deepEqual(await removing, { cacheReleasedBytes: 109, cacheCleanupPending: false });
  assert.equal(store.size, 0);
  assert.equal(store.evictions, 2);
});

test("cleanup failure retains only that package's pending marker and retries it after restart", async (t) => {
  const { cache, directory, make, partitions, opened } = setup(t);
  for (const id of [one, two]) await (await cache.fetchTile(url, {}, id)).arrayBuffer();
  const store = partitions.get(one);
  store.size = 44;
  const clear = store.clearCache;
  store.clearCache = async () => { throw new Error("storage temporarily unavailable"); };
  assert.equal((await cache.clear(one)).cacheCleanupPending, true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(directory, one + ".json"))).pending, true);
  store.clearCache = clear;
  const previous = opened.length;
  await make().retryPending();
  assert.deepEqual(opened.slice(previous).map((name) => name.slice(-64)), [one]);
  assert.equal(store.size, 0);
  assert.deepEqual(fs.readdirSync(directory), [`${two}.json`]);
});

test("routing IPC checks both the trusted top frame and its live signed widget capability; the cache receives only its SHA", async () => {
  const handlers = new Map();
  const mainFrame = { routingId: 2, processId: 12 }, contents = { id: 37, mainFrame };
  const event = { sender: contents, senderFrame: mainFrame };
  const requests = [], frameUrl = "life-widget://" + "f".repeat(48) + "/index.html";
  let enabled = true;
  registerTripRoutesIpc({ ipcMain: { handle: (name, call) => handlers.set(name, call) }, getWorkspaceWindow: () => ({ webContents: contents }),
    capabilityOwner: (address, name) => enabled && address === frameUrl && name === "trip-routing" ? one : null,
    fetchTile: async (_, options, owner) => { requests.push(owner); assert.equal(options.credentials, "omit"); return reply(); },
    fetchRoute: async (_, options, owner) => { requests.push(owner); assert.equal(options.redirect, "error"); return Response.json({ code: "NoRoute" }); },
  });
  const tile = handlers.get("la:trip:tile"), route = handlers.get("la:trip:route");
  const coords = { x: 1, y: 1, z: 5 }, trip = { mode: "drive", points: [[35, 135], [34.9, 135]] };
  assert.equal((await tile(event, { ...coords, sha256: one })).error.code, "E_FORBIDDEN");
  assert.equal((await route(event, { ...trip, frameUrl: frameUrl.replace("f", "0") })).error.code, "E_FORBIDDEN");
  assert.equal((await tile({ ...event, senderFrame: { routingId: 3, processId: 12 } }, { ...coords, frameUrl })).error.code, "E_FORBIDDEN");
  assert.equal((await tile(event, { ...coords, frameUrl })).ok, true);
  assert.equal((await route(event, { ...trip, frameUrl })).error.code, "E_NOT_FOUND");
  enabled = false;
  assert.equal((await tile(event, { ...coords, frameUrl })).error.code, "E_FORBIDDEN");
  assert.deepEqual(requests, [one, one]);
});
