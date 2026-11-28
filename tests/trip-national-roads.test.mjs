import assert from "node:assert/strict";
import test from "node:test";
import { searchTripPlaces } from "../src/editor/widgets/trip-data/placeSearch.js";
import { normalizeRoadRef } from "../src/domain/tripRoadRef.js";
import { decodeLine, encodeLine } from "../src/domain/tripRoutes.js";
import { amapRoadCandidates, selectRoadCandidate } from "../electron/main/tripRoadCandidates.js";
import { registerTripRoutesIpc } from "../electron/main/ipc/tripRoutes.js";

const points = [[30, 101], [30.01, 101.01], [30.02, 101.02], [30.03, 101.03]];
function road(refs, distances) {
  const steps = refs.map((ref, i) => ({ ref, name: "普通道路", distance: distances[i], geometry: encodeLine(points.slice(i, i + 2)) }));
  return { legs: [{ distance: distances.reduce((sum, value) => sum + value, 0), duration: 120, steps }] };
}
test("全国索引的城市、县域、县城和地标各自使用相应地图比例尺，异地视野仍能搜索", () => {
  const find = query => searchTripPlaces(query, { near: [30.65, 104.05] })[0];
  for (const [query, expected] of [["重庆市两江新区", "两江新区"], ["延庆区", "延庆区"], ["吉林省延吉市", "延吉市"], ["云南镇雄县", "镇雄县"]]) {
    const place = find(query);
    assert.equal(place.name, expected);
    assert.equal(place.source, "CTAmap 2026");
    assert.equal(place.zoom, 11);
  }
  assert.equal(find("北京").zoom, 9);
  assert.equal(find("北京市").zoom, 8);
  assert.equal(find("青海").zoom, 6);
  assert.equal(find("北京市人民大会堂").zoom, 16);
  assert.equal(find("天安门").name, "天安门");
  assert.ok(find("喀什").point[1] < 80);
  assert.ok(find("漠河").point[0] > 50);
  assert.ok(find("三亚").point[0] < 20);
});
test("national road matching accepts exact multirefs, keeps connectors and rejects ramp names or prefix collisions", () => {
  for (const ref of ["G1", "g30", " G4218 ", "G312"]) assert.ok(normalizeRoadRef(ref));
  for (const invalid of ["G0", "G1 01", "G312x", "X312", "https://example.org"]) assert.equal(normalizeRoadRef(invalid), "");
  const route = road(["G312", "G3120", "S1; G312"], [500, 450, 50]);
  route.legs[0].steps[1].name = "G312出口";
  const other = road(["G312", "S1", "S1"], [100, 700, 200]);
  const payload = { code: "Ok", routes: [other, route] };
  const [leg] = selectRoadCandidate(payload, 2, "G312");
  assert.equal(leg.highwayMeters, 550);
  assert.equal(leg.highwayCoverage, 0.55);
  assert.deepEqual(leg.highwaySections.map(s => decodeLine(s)), [points.slice(0, 2), points.slice(2)]);
  assert.equal(selectRoadCandidate(payload, 2, "G31"), null);
  assert.equal(selectRoadCandidate(payload, 2, "")[0].highwayCoverage, undefined);
});
test("AMap route evidence comes from the road itself and retains WGS84 geometries", () => {
  const input = { status: "1", route: { paths: [{ distance: "1200", cost: { duration: "162" }, steps: [
    { road_name: "国道270线", step_distance: "900", polyline: "104.084096,30.652049;104.090000,30.651000" },
    { road_name: "辅路", instruction: "进入G270", step_distance: "300", polyline: "104.090000,30.651000;104.100000,30.650000" },
  ] }] } };
  const [leg] = selectRoadCandidate(amapRoadCandidates(input), 2, "G270");
  assert.equal(leg.highwayCoverage, 0.75);
  assert.equal(leg.seconds, 162);
  assert.ok(Math.abs(decodeLine(leg.highwaySections[0])[0][0] - 30.65445) < 0.00015);
});
function service(fetchRoute, config = {}) {
  const handlers = new Map(), frame = {}, sender = { id: 19, mainFrame: frame };
  registerTripRoutesIpc({ ipcMain: { handle: (key, callback) => handlers.set(key, callback) }, getWorkspaceWindow: () => ({ webContents: sender }), fetchRoute, ...config });
  return args => handlers.get("la:trip:route")({ sender, senderFrame: frame }, args);
}
test("nearby highway requests authorize and validate before disclosing a position", async () => {
  let fetched = 0;
  const run = service(async () => { fetched++; throw new Error("offline"); }, { capabilityOwner: (frame, capability) => frame === "ours" && capability === "trip-routing" });
  const args = { kind: "highway-nearby", point: points[0], ref: "G312" };
  assert.equal((await run(args)).error.code, "E_FORBIDDEN");
  assert.equal((await run({ ...args, frameUrl: "ours", ref: "abc" })).error.code, "E_INVALID_ARGUMENT");
  assert.equal((await run({ ...args, frameUrl: "ours", point: [100, 20] })).error.code, "E_INVALID_ARGUMENT");
  assert.equal(fetched, 0);
  assert.equal((await run({ ...args, frameUrl: "ours" })).error.code, "E_IO");
  assert.equal(fetched, 1);
});
test("self-hosted routes return a missing national ref honestly; unavailable personal credentials never request public fallbacks", async () => {
  const urls = [];
  const run = service(async url => { urls.push(new URL(url)); return Response.json({ code: "Ok", routes: [road(["G98", "G65"], [300, 300])] }); }, { osrmBaseUrl: "https://routing.example.test/service" });
  const args = { mode: "drive", points: points.slice(0, 2), highwayRef: "G4218" };
  const unmatched = await run(args);
  assert.equal(unmatched.ok, true);
  assert.equal(unmatched.value.highwayVerified, false);
  assert.equal(unmatched.value.highwayRef, "G4218");
  assert.equal(unmatched.value.geometryVersion, 2);
  assert.equal(unmatched.value.legs[0].highwayCoverage, undefined);
  assert.equal(urls[0].origin, "https://routing.example.test");
  assert.match(urls[0].pathname, /^\/service\/routed-car\//u);
  assert.equal(urls[0].searchParams.get("alternatives"), "true");
  const closed = service(async () => { throw new Error("unexpected"); }, { getAmapKey: () => "" });
  assert.equal((await closed({ ...args, provider: "amap" })).error.code, "E_FORBIDDEN");
});

test("explicit high precision AMap driving uses the personal provider only and checks the actual route names", async () => {
  const urls = [];
  const run = service(async url => {
    urls.push(new URL(url));
    return Response.json({ status: "1", route: { paths: [{ distance: "151", cost: { duration: "20" }, steps: [
      { road_name: "G4218", step_distance: "151", polyline: "104.084096,30.652049;104.090000,30.651000" },
    ] }] } });
  }, { getAmapKey: async () => "fixture-only" });
  const result = await run({ provider: "amap", mode: "drive", points: points.slice(0, 2), highwayRef: "g4218" });
  assert.ok(result.ok);
  assert.equal(result.value.highwayRef, "G4218");
  assert.equal(result.value.highwayVerified, true);
  assert.equal(result.value.source, "高德地图");
  assert.equal(result.value.legs[0].highwayCoverage, 1);
  assert.equal(urls.length, 1);
  assert.equal(urls[0].origin + urls[0].pathname, "https://restapi.amap.com/v5/direction/driving");
  assert.equal(urls[0].searchParams.get("show_fields"), "cost,polyline");
  assert.equal(JSON.stringify(result).includes("fixture-only"), false);
});

test("road lookup refuses an unexpected vector tile host before requesting a tile", async () => {
  const calls = [];
  const run = service(async url => {
    calls.push(url);
    return Response.json({ tiles: ["https://different.example/planet/{z}/{x}/{y}.pbf"] });
  });
  const result = await run({ kind: "highway-nearby", ref: "G107", point: points[0] });
  assert.equal(result.error.code, "E_IO");
  assert.deepEqual(calls, ["https://tiles.openfreemap.org/planet"]);
});
