import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { crc32 } from "node:zlib";
import { createTripOfflineRouter, TRIP_OFFLINE_SEGMENTS_URL } from "../electron/main/tripOfflineRouter.js";
import { isRd5TileName, planRd5Corridor } from "../src/domain/tripOfflineRegions.js";

const shortTrip = [[39.907, 116.391], [39.931, 116.428]];
const coastTrip = [[29.87819, 121.54945], [37.50914, 122.11356]];
const tileName = "E115_N35.rd5";

async function temporary(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "life-atlas-offline-router-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

// Minimal shape of an RD5 container. This has no real routable road graph.
function emptySegmentHeader() {
  const bytes = Buffer.alloc(313);
  for (let i = 0; i < 200; i += 8) bytes.writeUIntBE(200, i + 2, 6);
  bytes.writeUInt16BE(11, 0);
  bytes.writeUInt32BE(((~crc32(bytes.subarray(0, 200))) ^ 2) >>> 0, 208);
  return bytes;
}

test("offline corridors cover all crossed five-degree tiles and preserve a short local corridor", () => {
  assert.deepEqual(planRd5Corridor(shortTrip), [tileName]);
  assert.deepEqual(planRd5Corridor(coastTrip), ["E120_N25.rd5", "E120_N30.rd5", "E120_N35.rd5"]);
  const extended = planRd5Corridor(coastTrip, true);
  assert.ok(extended.includes("E115_N30.rd5"));
  assert.ok(extended.includes("E115_N35.rd5"));
  const westward = planRd5Corridor([[31.2, 121.4], [43.8, 87.6]]);
  assert.ok(westward.includes("E110_N35.rd5"));
  assert.ok(westward.includes("E95_N35.rd5"));
  assert.ok(westward.includes("E85_N40.rd5"));
  assert.deepEqual(planRd5Corridor([[10, 179.7], [10, -179.8]]), ["E175_N10.rd5", "W180_N10.rd5"]);
  assert.equal(isRd5TileName("W180_S5.rd5"), true);
  for (const name of ["../E115_N35.rd5", "E114_N35.rd5", "E180_N90.rd5", "W0_S0.rd5", "E115_N35.RD5"]) assert.equal(isRd5TileName(name), false);
});

test("unconfigured offline routes report coverage without accessing a remote provider", async t => {
  const root = await temporary(t);
  const service = createTripOfflineRouter({ dataDir: root, fetchSegment: () => assert.fail("unexpected network call") });
  const status = await service.status({ coords: coastTrip });
  assert.equal(status.ready, false);
  assert.equal(status.configured, false);
  assert.deepEqual(status.missingTiles, status.requiredTiles);
  assert.ok(status.missingRecommendedTiles.includes("E115_N35.rd5"));
  await assert.rejects(service.route({ mode: "drive", coords: coastTrip }), {
    code: "E_NOT_FOUND", details: { requiredTiles: status.requiredTiles, missingTiles: status.requiredTiles, missingRecommendedTiles: status.missingRecommendedTiles },
  });
  await assert.rejects(service.route({ mode: "transit", coords: coastTrip }), { code: "E_FORBIDDEN" });
  await assert.rejects(service.configure(root), { code: "E_IO" });
});

test("manual import rejects corrupt tiles and copies a valid container to dedicated road storage", async t => {
  const root = await temporary(t);
  const dataDir = path.join(root, "data");
  const source = path.join(root, "chosen");
  await fs.mkdir(source);
  const chosenFile = path.join(source, tileName);
  await fs.writeFile(chosenFile, Buffer.alloc(313));
  const service = createTripOfflineRouter({ dataDir });
  await assert.rejects(service.importSegments(source), { code: "E_IO" });
  assert.deepEqual((await service.status({ coords: shortTrip })).missingTiles, [tileName]);
  const bytes = emptySegmentHeader();
  await fs.writeFile(chosenFile, bytes);
  const imported = await service.importSegments(source);
  assert.deepEqual(imported.importedTiles, [tileName]);
  assert.deepEqual(await fs.readFile(chosenFile), bytes);
  assert.deepEqual(await fs.readFile(path.join(dataDir, "segments4", tileName)), bytes);
  assert.deepEqual((await service.status({ coords: shortTrip })).missingTiles, []);
});

test("on-demand downloads only contact the pinned tile URL, ignore repeats and reject truncated data", async t => {
  const root = await temporary(t);
  const requests = [], progress = [];
  const bytes = emptySegmentHeader();
  let payload = bytes.subarray(0, 200);
  const service = createTripOfflineRouter({ dataDir: root, fetchSegment: async (url, options) => {
    requests.push(url);
    assert.equal(options.redirect, "error");
    assert.equal(options.credentials, "omit");
    return new Response(payload, { headers: { "content-length": bytes.length } });
  } });
  await assert.rejects(service.downloadSegments({ coords: shortTrip }), { code: "E_IO" });
  assert.deepEqual((await service.status({ coords: shortTrip })).missingTiles, [tileName]);
  payload = bytes;
  const downloaded = await service.downloadSegments({ coords: shortTrip }, { onProgress: event => progress.push(event) });
  assert.deepEqual(downloaded.downloadedTiles, [tileName]);
  assert.deepEqual(downloaded.missingTiles, []);
  assert.equal(progress.at(-1).bytes, bytes.length);
  assert.deepEqual((await service.downloadSegments({ coords: shortTrip })).downloadedTiles, []);
  assert.deepEqual(requests, [new URL(tileName, TRIP_OFFLINE_SEGMENTS_URL).toString(), new URL(tileName, TRIP_OFFLINE_SEGMENTS_URL).toString()]);
});

test("cancelling a road download prevents incomplete installation and leaves it eligible to retry", async t => {
  const root = await temporary(t);
  const controller = new AbortController();
  const service = createTripOfflineRouter({ dataDir: root, fetchSegment: async () => new Response(new ReadableStream({ start(stream) {
    stream.enqueue(Buffer.alloc(200));
  } })) });
  await assert.rejects(service.downloadSegments({ coords: shortTrip }, {
    signal: controller.signal, onProgress: () => controller.abort(),
  }), { code: "E_CANCELLED", details: { downloadedTiles: [], unavailableTiles: [], missingTiles: [tileName] } });
  assert.deepEqual((await service.status({ coords: shortTrip })).missingTiles, [tileName]);
  assert.deepEqual(await fs.readdir(path.join(root, "segments4")), []);
});
