import assert from "node:assert/strict";
import test from "node:test";
import { registerTripRoutesIpc } from "../electron/main/ipc/tripRoutes.js";
import { fromAmapPoint } from "../src/domain/transitProviders.js";
import { MAX_ROUTE_POINTS, encodeLine, roadSections } from "../src/domain/tripRoutes.js";

// These transport fixtures follow the documented response shape. Requests use an
// injected fetch and a dummy key, and never contact the live services.
const POIS = [
  { id: "B000TEST01", name: "凤凰古城", location: "109.599384,27.946359", type: "风景名胜;风景名胜;风景名胜",
    typecode: "110202", pname: "湖南省", cityname: "湘西土家族苗族自治州", adname: "凤凰县", address: "沱江镇", citycode: "0743", adcode: "433123",
    navi: { navi_poiid: "109.601109,27.949536", entr_location: "109.601109,27.949536", exit_location: "109.600370,27.948749" } },
  { id: "B000TEST02", name: "凤凰古城", location: "109.540034,27.993054", type: "交通设施服务;火车站;火车站",
    typecode: "150200", pname: "湖南省", cityname: "湘西土家族苗族自治州", adname: "凤凰县", citycode: "0743", adcode: "433123",
    navi: { navi_poiid: "B000TEST03", entr_location: [] } },
];
function ipc({ key = "fixture-key", ...config } = {}) {
  const frame = {}, sender = { id: 45, mainFrame: frame };
  const handlers = new Map();
  registerTripRoutesIpc({ ipcMain: { handle: (name, call) => handlers.set(name, call) },
    getWorkspaceWindow: () => ({ webContents: sender }), getAmapKey: () => key, ...config });
  return (method, args) => handlers.get("la:trip:" + method)({ sender, senderFrame: frame }, args);
}

test("fixture: AMap POIs keep same-name identities, exact coordinates, administrative areas and optional filters", async () => {
  const calls = [];
  const run = ipc({ fetchRoute: async url => { calls.push(new URL(url)); return Response.json({ status: "1", pois: POIS }); } });
  const search = { provider: "amap", query: "凤凰古城", userInitiated: true };
  const nationwide = await run("search", search);
  const biased = await run("search", { ...search, region: "湘西土家族苗族自治州" });
  const filtered = await run("search", { ...search, region: "433123", cityLimit: true, types: "110202|150200" });
  assert.equal(nationwide.ok && biased.ok && filtered.ok, true);
  assert.equal(calls.length, 3);
  assert.ok(calls.every(url => url.pathname === "/v5/place/text" && url.searchParams.get("show_fields") === "navi"));
  assert.equal(calls[0].searchParams.has("region"), false);
  assert.equal(calls[1].searchParams.get("region"), "湘西土家族苗族自治州");
  assert.equal(calls[1].searchParams.has("city_limit"), false);
  assert.equal(calls[2].searchParams.get("city_limit"), "true");
  assert.equal(calls[2].searchParams.get("types"), "110202|150200");
  assert.equal((await run("search", { ...search, cityLimit: true })).error.code, "E_INVALID_ARGUMENT");
  assert.equal((await run("search", { ...search, types: "invalid" })).error.code, "E_INVALID_ARGUMENT");
  const [attraction, station] = nationwide.value.places;
  assert.notEqual(attraction.id, station.id);
  assert.equal(attraction.name, station.name);
  assert.match(attraction.type, /风景名胜/u);
  assert.match(station.type, /火车站/u);
  assert.deepEqual([attraction.province, attraction.city, attraction.district, attraction.citycode, attraction.adcode],
    ["湖南省", "湘西土家族苗族自治州", "凤凰县", "0743", "433123"]);
  assert.deepEqual(attraction.amap, { poiId: "B000TEST01", location: [109.599384, 27.946359], typecode: "110202", adcode: "433123",
    navigation: [109.601109, 27.949536], entrance: [109.601109, 27.949536], exit: [109.600370, 27.948749] });
  assert.equal(station.amap.navigation, "B000TEST03");
  assert.equal(JSON.stringify(nationwide).includes("fixture-key"), false);
});

test("fixture: Nominatim distinguishes a railway station from an attraction without sending background queries", async () => {
  let calls = 0;
  const run = ipc({ key: "", fetchRoute: async () => {
    calls++;
    return Response.json([
      { name: "丹霞山", lat: "25.120000", lon: "113.748000", category: "railway", type: "station", addresstype: "railway", osm_type: "node", osm_id: 100 },
      { name: "丹霞山", lat: "25.035000", lon: "113.741000", category: "tourism", type: "attraction", addresstype: "tourism", osm_type: "relation", osm_id: 101 },
    ]);
  } });
  const args = { query: "丹霞山", provider: "nominatim" };
  assert.equal((await run("search", args)).error.code, "E_FORBIDDEN");
  assert.equal((await run("search", { ...args, userInitiated: true, types: "110202" })).error.code, "E_INVALID_ARGUMENT");
  const response = await run("search", { ...args, userInitiated: true });
  assert.equal(calls, 1);
  assert.deepEqual(response.value.places.map(({ osmType, category, type, addressType }) => [osmType, category, type, addressType]),
    [["node", "railway", "station", "railway"], ["relation", "tourism", "attraction", "tourism"]]);
});

const points = POIS.map(poi => fromAmapPoint(poi.location.split(",").reverse().map(Number)));
const places = POIS.map(poi => ({ poiId: poi.id, location: poi.location.split(",").map(Number), typecode: poi.typecode, adcode: poi.adcode }));
const shape = POIS.map(poi => poi.location).join(";");

test("fixture: AMap drive, walk and bike use their own v5 endpoints and accept only documented POI arguments", async () => {
  const requests = [];
  let now = 10_000;
  const run = ipc({ now: () => now, fetchRoute: async url => {
    const endpoint = new URL(url);
    requests.push(endpoint);
    const duration = { driving: "900", walking: "1800", bicycling: "1050" }[endpoint.pathname.split("/").at(-1)];
    return Response.json({ status: "1", route: { paths: [{ distance: "1902", cost: { duration }, steps: [
      { road_name: "景区道路", step_distance: "1902", polyline: shape },
    ] }] } });
  } });
  for (const [mode, name, seconds] of [["drive", "driving", 900], ["walk", "walking", 1800], ["bike", "bicycling", 1050]]) {
    const result = await run("route", { provider: "amap", mode, points, places });
    assert.ok(result.ok);
    assert.equal(result.value.legs[0].seconds, seconds);
    assert.equal(result.value.legs[0].meters, 1902);
    assert.deepEqual(roadSections(result.value.legs[0])[0], points.map(p => p.map(value => Number(value.toFixed(5)))));
    const url = requests.at(-1);
    assert.equal(url.origin + url.pathname, `https://restapi.amap.com/v5/direction/${name}`);
    assert.equal(url.searchParams.get("origin"), POIS[0].location);
    assert.equal(url.searchParams.get("destination"), POIS[1].location);
    assert.equal(url.searchParams.get("origin_id"), mode === "bike" ? null : POIS[0].id);
    assert.equal(url.searchParams.get("destination_id"), mode === "bike" ? null : POIS[1].id);
    assert.equal(url.searchParams.get("destination_type"), mode === "drive" ? POIS[1].typecode : null);
    now += 1200;
  }
  const entrance = [109.601109, 27.949536];
  const result = await run("route", { provider: "amap", mode: "walk", points: [fromAmapPoint([entrance[1], entrance[0]]), points[1]],
    places: [{ ...places[0], entrance }, { ...places[1], location: [114, 28] }] });
  assert.equal(result.ok, true);
  assert.equal(requests.at(-1).searchParams.get("origin"), "109.601109,27.949536");
  assert.equal(requests.at(-1).searchParams.has("origin_id"), false);
  assert.equal(requests.at(-1).searchParams.has("destination_id"), false);
});

test("fixture: AMap transit keeps timed alternatives and no fabricated rail shape, and sends only paired POI IDs", async () => {
  const requests = [];
  const run = ipc({ fetchRoute: async url => {
    requests.push(new URL(url));
    return Response.json({ status: "1", route: { transits: [
      { distance: "5000", cost: { duration: "2400" }, segments: [{ bus: { buslines: [
        { name: "10路", type: "普通公交线路", departure_stop: { name: "凤凰古城站" }, arrival_stop: { name: "沱江镇" },
          distance: "5000", duration: "2300", polyline: shape },
      ] } }] },
      { distance: "42000", cost: { duration: "4500" }, segments: [
        { walking: { distance: "200", cost: { duration: "120" }, steps: [{ polyline: shape }] }, railway: {
          trip: "G1234", distance: "41800", type: "2011", departure_stop: { name: "凤凰古城站", time: "23:50" },
          arrival_stop: { name: "吉首东站", time: "24:20" }, via_stop: [{ name: "中间站", location: "109.67,28.15" }],
        } },
      ] },
    ] } });
  } });
  const args = { points, places, citycodes: ["0743", "0743"], time: "23:42", date: "2026-11-26" };
  const response = await run("transit", args);
  assert.equal(response.ok, true);
  assert.deepEqual(response.value.legs[0], response.value.alternatives[0]);
  assert.equal(response.value.alternatives[0].steps[0].seconds, 2300);
  const rail = response.value.alternatives[1];
  assert.equal(rail.seconds, 4500);
  assert.equal(rail.steps[0].seconds, 120);
  assert.equal(rail.steps[0].to, "凤凰古城站");
  assert.deepEqual(rail.steps[1], { type: "rail", name: "G1234", from: "凤凰古城站", to: "吉首东站", meters: 41800, seconds: 1800,
    departureTime: "23:50", arrivalTime: "24:20", sections: [] });
  assert.equal(requests[0].searchParams.get("originpoi"), POIS[0].id);
  assert.equal(requests[0].searchParams.get("destinationpoi"), POIS[1].id);
  assert.equal(requests[0].searchParams.get("ad2"), "433123");
  assert.equal(requests[0].searchParams.get("time"), "23-42");
  await run("transit", { ...args, places: [places[0], null] });
  assert.equal(requests[1].searchParams.has("originpoi"), false);
  assert.equal(requests[1].searchParams.has("destinationpoi"), false);
});

test("fixture: explicit offline dispatch never reaches online fetch or waits for the online throttle", async () => {
  let finishOnline, onlineCalls = 0;
  const run = ipc({ fetchRoute: () => { onlineCalls++; return new Promise(resolve => { finishOnline = resolve; }); },
    routeOffline: async selection => {
      assert.deepEqual(selection, { mode: "drive", points, highwayRef: "G312" });
      return { source: "BRouter / OpenStreetMap", geometryVersion: 2, legs: [{ meters: 1902, seconds: 120, line: encodeLine(points) }] };
    } });
  const online = run("route", { mode: "drive", points });
  const offline = await run("route", { mode: "drive", points, highwayRef: "g312", provider: "offline" });
  assert.equal(offline.value.source, "BRouter / OpenStreetMap");
  assert.equal(onlineCalls, 1);
  finishOnline(Response.json({ code: "NoRoute" }));
  assert.equal((await online).error.code, "E_NOT_FOUND");
  const failClosed = ipc({ fetchRoute: async () => assert.fail("offline mode must not use a network fallback"),
    routeOffline: async () => { throw Object.assign(new Error("secret path or URL"), { code: "E_NOT_FOUND",
      details: { requiredTiles: ["E105_N25.rd5", "private path"], missingTiles: ["E105_N25.rd5", "E110_N25.rd5"] } }); } });
  const error = (await failClosed("route", { mode: "bike", points, provider: "offline" })).error;
  assert.equal(error.code, "E_NOT_FOUND");
  assert.doesNotMatch(error.message, /secret/u);
  assert.deepEqual(error.details, { requiredTiles: ["E105_N25.rd5"], missingTiles: ["E105_N25.rd5"] });
});

test("fixture: route geometry size crossing the advertised budget remains machine-readable", async () => {
  const encoded = encodeLine(Array(MAX_ROUTE_POINTS + 1).fill(points[0]));
  const run = ipc({ fetchRoute: async () => Response.json({ code: "Ok", routes: [
    { legs: [{ distance: 300, duration: 28, steps: [{ geometry: encoded }] }] },
  ] }) });
  assert.equal((await run("route", { mode: "drive", points })).error.code, "E_TOO_LARGE");
});

test("fixture: a long AMap road and its verified national highway retain every provider point", async () => {
  const length = 27_593;
  const gcj = Array.from({ length }, (_, index) => [104 + index / 50_000, 30.65]);
  const polyline = gcj.map(point => point.map(value => value.toFixed(6)).join(",")).join(";");
  const endpoints = [gcj[0], gcj.at(-1)].map(([lon, lat]) => fromAmapPoint([lat, lon]));
  const run = ipc({ fetchRoute: async () => Response.json({ status: "1", route: { paths: [
    { distance: "54000", cost: { duration: "4200" }, steps: [{ road_name: "G312", step_distance: "54000", polyline }] },
  ] } }) });
  const result = await run("route", { mode: "drive", provider: "amap", points: endpoints, highwayRef: "G312" });
  assert.equal(result.ok, true);
  assert.equal(result.value.highwayVerified, true);
  const leg = result.value.legs[0];
  const sectionPoints = roadSections(leg);
  assert.deepEqual(sectionPoints.map(line => line.length), [20_000, length - 19_999]);
  assert.deepEqual(sectionPoints[0].at(-1), sectionPoints[1][0]);
  assert.deepEqual(leg.highwaySections, leg.sections);
});

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const tile = { x: 1, y: 2, z: 5 };
const image = bytes => new Response(bytes, { headers: { "content-type": "image/png" } });

test("fixture: the street tile status classifies service restrictions and honors a shared, bounded backoff", async () => {
  let now = 10_000, calls = 0;
  const run = ipc({ now: () => now, fetchTile: async (_, options) => {
    assert.equal(options.redirect, "error");
    assert.equal(options.credentials, "omit");
    calls++;
    if (calls === 1) return new Response("private server detail", { status: 429, headers: { "retry-after": "10" } });
    if (calls === 2) return new Response("private server detail", { status: 403, headers: { "retry-after": "99999999" } });
    return image(png);
  } });
  const limited = await run("tile", tile);
  assert.deepEqual(limited.error.details, { reason: "rate-limited", httpStatus: 429, retryAfterMs: 10_000 });
  now += 3000;
  assert.equal((await run("tile", { ...tile, x: 4 })).error.retryAfterMs, 7000);
  assert.equal(calls, 1);
  now += 7000;
  const blocked = await run("tile", tile);
  assert.deepEqual(blocked.error.details, { reason: "blocked", httpStatus: 403, retryAfterMs: 86_400_000 });
  assert.equal(JSON.stringify(blocked).includes("private server detail"), false);
  now += 86_400_000;
  assert.equal((await run("tile", tile)).value.dataUrl, "data:image/png;base64," + png.toString("base64"));
});

test("fixture: street tile errors distinguish status, timeout, network and invalid payloads", async () => {
  const cases = [
    [() => new Response("secret", { status: 404 }), { reason: "http", httpStatus: 404 }],
    [() => new Response("secret", { headers: { "content-type": "text/html" } }), { reason: "payload-type", httpStatus: 200 }],
    [() => image(png.subarray(0, png.length - 4)), { reason: "invalid-png", httpStatus: 200 }],
    [() => image(new Uint8Array(512 * 1024 + 1)), { reason: "payload-too-large", httpStatus: 200 }],
    [() => { throw new DOMException("secret URL", "TimeoutError"); }, { reason: "timeout" }],
    [() => { throw Object.assign(new Error("secret path"), { code: "E_CONFLICT" }); }, { reason: "cache-unavailable" }],
    [() => { throw new Error("secret key or URL"); }, { reason: "network" }],
  ];
  for (const [fetchTile, details] of cases) {
    const result = await ipc({ fetchTile })("tile", tile);
    assert.deepEqual(result.error.details, details);
    assert.equal(JSON.stringify(result).includes("secret"), false);
  }
});
