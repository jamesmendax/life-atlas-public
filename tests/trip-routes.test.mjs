import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { decodeLine, directionsLink, encodeLine, readRoadResponse, roadEndpointGaps, routeKey, routingUrl, usableRoute } from "../src/domain/tripRoutes.js";
import { SAMPLE_TRIP, dateForDay, legSchedule, normalizeTrip, parseInputPoint, tripStopLetter } from "../src/editor/widgets/trip-data/itineraryState.js";
import { serializeState } from "../src/domain/marketFrameProtocol.js";
import { registerTripRoutesIpc } from "../electron/main/ipc/tripRoutes.js";
import { amapLink } from "../src/editor/widgets/trip-data/amapLinks.js";
import { chengduTransitRoute, isChengduSample } from "../src/editor/widgets/trip-data/chengduTransit.js";

test("road geometry exposes endpoint gaps without inventing connectors", () => {
  const from=[23.04893,112.46091],to=[24.36959,114.48962];
  const leg={line:encodeLine([from,[24.31941,114.4776]])};
  const gap=roadEndpointGaps(leg,from,to);
  assert.ok(gap.endMeters>5600 && gap.endMeters<5800);
  assert.equal(gap.endFar,true);assert.equal(gap.startFar,false);
  const start=roadEndpointGaps({line:encodeLine([[23.04,112.46],to])},from,to);
  assert.equal(start.startFar,true);assert.equal(start.endFar,false);
  const near=roadEndpointGaps({line:encodeLine([from,to])},from,to);
  assert.equal(near.startFar,false);assert.equal(near.endFar,false);
  assert.equal(near.breaks.length,0);
  const split=roadEndpointGaps({sections:[encodeLine([from,[23.3,112.5]]),encodeLine([[23.31,112.5],to])]},from,to);
  assert.equal(split.startFar,false);assert.equal(split.endFar,false);assert.ok(split.breaks[0]>1000);
  assert.equal(roadEndpointGaps({},from,to),null);
  assert.equal(roadEndpointGaps(leg,null,to),null);
});

const samples = JSON.parse(fs.readFileSync(new URL("../src/editor/widgets/trip-data/example-routes.json", import.meta.url)));
const points = SAMPLE_TRIP.days[1].stops.map((s) => s.point);
const chengduStops = normalizeTrip({ days: [{ stops: [
  { name: "大熊猫繁育研究基地", done: true },
  { name: "春熙路 · 太古里午餐" },
  { name: "宽窄巷子 & 人民公园喝茶" },
  { name: "玉林路老火锅夜景" },
] }] }).days[0].stops;
const chengduPoints = chengduStops.map((stop) => stop.point);

test("plan stops retain dwell and nightly lodging independently from navigation", () => {
  const point = [30.65, 104.07];
  const raw = { days: [{ lodging: "当晚酒店", lodgingPoint: point, stops: [
    { name: "A", time: "09:30", dwellMinutes: 90 }, { name: "B", time: "13:00" },
  ] }, { stops: [{ name: "跨夜", time: "23:45", dwellMinutes: 10 }] }] };
  const [day, nextDay] = normalizeTrip(raw).days;
  assert.equal(day.lodging, "当晚酒店");
  assert.deepEqual(day.lodgingPoint, point);
  assert.equal(nextDay.lodging, ""); assert.equal(nextDay.lodgingPoint, null);
  const persisted = JSON.parse(serializeState(normalizeTrip(raw)));
  assert.equal(Object.hasOwn(persisted.days[0].stops[1], "dwellMinutes"), false);
  assert.deepEqual(legSchedule(day.stops[0], 4002), { departure: "11:00", arrival: "12:07" });
  assert.deepEqual(legSchedule(day.stops[1], 1800), { departure: "", arrival: "" });
  assert.deepEqual(legSchedule(nextDay.stops[0], 3600), { departure: "23:55", arrival: "次日 00:55" });
  assert.deepEqual(legSchedule({ time: "23:50", dwellMinutes: 20 }, null), { departure: "次日 00:10", arrival: "" });
  assert.deepEqual([0, 4, 25, 26, 51, 52].map(tripStopLetter), ["A", "E", "Z", "AA", "AZ", "BA"]);
});

test("bundled Kyoto routes follow recorded streets with separate distances and durations for each transport mode", () => {
  const routes = ["drive", "bike", "walk"].map((mode) => samples[routeKey(mode, points)]);
  for (const route of routes) {
    assert.ok(usableRoute(route, points.length));
    for (const leg of route.legs) assert.ok(decodeLine(leg.line).length > 2);
  }
  assert.equal(new Set(routes.map((r) => r.legs[1].meters)).size, 3);
  assert.ok(routes[2].legs[1].seconds > routes[0].legs[1].seconds);
  assert.equal(samples[routeKey("transit", points)], undefined);
  assert.equal(samples[routeKey("drive", [...points].reverse())], undefined);
  assert.equal(dateForDay(SAMPLE_TRIP, SAMPLE_TRIP.days[1]), "2026-12-13");
});

test("legacy Chengdu stops map only by matching landmark; ungeocoded user stops remain unlocated", () => {
  const trip = normalizeTrip({ mode: "walk", days: [{ day: 1, stops: [
    { id: "s1", name: "大熊猫繁育研究基地", done: true, kmNext: 14.5 }, { id: "s2", name: "自己的某个地点", kmNext: 4 },
  ] }] });
  assert.equal(trip.days[0].stops[0].done, true);
  assert.deepEqual(trip.days[0].stops[0].point, [30.73335, 104.14409]);
  assert.equal(trip.days[0].stops[1].point, null);
  assert.equal(routeKey("walk", trip.days[0].stops.map((s) => s.point)), "");
  assert.deepEqual(parseInputPoint("35.0， 135.7"), [35,135.7]);
  for (const value of ["", "0, ", "35,181", "90,0", "0x12,4", "35,N"]) assert.equal(parseInputPoint(value), null);
});

test("Chengdu screenshot stops retain three mode-specific OSRM segments in order", () => {
  assert.ok(isChengduSample(chengduStops));
  assert.equal(isChengduSample(chengduStops.map((stop) => ({ ...stop, name: "我的站点" }))), false);
  for (const [mode, distances, durations] of [
    ["drive", [13592, 4386, 7274], [840, 342, 504]],
    ["bike", [12778, 4234, 7159], [3139, 1166, 1729]],
    ["walk", [14073, 3866, 6717], [11261, 3094, 5375]],
  ]) {
    const route = samples[routeKey(mode, chengduPoints)];
    assert.ok(usableRoute(route, chengduPoints.length));
    assert.deepEqual(route.legs.map((leg) => leg.meters), distances);
    assert.deepEqual(route.legs.map((leg) => leg.seconds), durations);
    for (const [index, leg] of route.legs.entries()) {
      const path = decodeLine(leg.line);
      assert.ok(path.length > 2);
      for (const [point, stop] of [[path[0], chengduPoints[index]], [path.at(-1), chengduPoints[index + 1]]]) {
        assert.ok(Math.hypot(point[0] - stop[0], point[1] - stop[1]) < 0.006);
      }
    }
  }
});

test("Chengdu transit has source-backed rides, transfers and route geometry for each leg", () => {
  const { legs, at } = chengduTransitRoute(chengduPoints);
  assert.equal(at, "2026-11-25");
  assert.deepEqual(legs.map((leg) => leg.meters), [15389, 3710, 9435]);
  assert.deepEqual(legs.map((leg) => leg.seconds), [3522, 1324, 2059]);
  const rides = (leg) => leg.steps.filter((step) => step.type === "metro" || step.type === "bus");
  assert.deepEqual(legs.map((leg) => rides(leg).map((step) => step.name)), [
    ["87路公交", "地铁3号线"], ["地铁2号线"], ["地铁4号线", "地铁5号线"],
  ]);
  assert.equal(rides(legs[0])[0].towards, "昭觉寺公交站");
  assert.ok(legs[0].steps.some((step) => step.transfer && step.type === "walk" && step.to === "动物园站"));
  assert.ok(legs[2].steps.some((step) => step.type === "transfer" && step.from === "中医大·省医院站" && !step.sections));
  for (const { steps } of legs) {
    for (const step of steps.filter(({ type }) => type !== "transfer")) {
      assert.ok(step.sections.length);
      assert.ok(step.sections.every((line) => decodeLine(line, 200).length >= 2));
    }
  }
});

test("Chengdu transit recombines known stations with independent reverse tracks and preserves partial coverage", () => {
  const [panda, chunxi, lanes, yulin] = chengduPoints;
  const forward = chengduTransitRoute(chengduPoints).legs;
  const reverse = chengduTransitRoute([yulin, lanes, chunxi, panda]).legs;
  assert.deepEqual(reverse.map((leg) => leg.meters), [9448, 3716, 15639]);
  const reverseBus = reverse[2].steps.find((step) => step.type === "bus");
  assert.equal(reverseBus.towards, "丛荟路公交站");
  const originalBus = forward[0].steps.find((step) => step.type === "bus");
  assert.notDeepEqual(decodeLine(reverseBus.sections[0]), decodeLine(originalBus.sections[0]).reverse());
  const newLeg = chengduTransitRoute([panda, [30.61250, 104.04559]]).legs[0];
  assert.equal(newLeg.steps.at(-1).to, "神仙树站");
  assert.ok(newLeg.steps.some((step) => step.type === "transfer" && step.from === "市二医院站"));
  const unsupported = [30.65446, 104.08156];
  assert.equal(chengduTransitRoute([panda, unsupported]), null);
  assert.equal(chengduTransitRoute([panda, panda]), null);
  assert.deepEqual(chengduTransitRoute([panda, chunxi, unsupported, lanes, yulin]).legs, [forward[0], null, null, forward[2]]);
});

test("OSRM curves, route modes and addresses produce distinct validated outputs", () => {
  const curve = [[35,135], [35.001,135], [35.001,135.002]];
  assert.deepEqual(decodeLine(encodeLine(curve)), curve);
  const result = readRoadResponse({ code: "Ok", routes: [{ legs: [{ distance: 510, duration: 105, steps: [
    { geometry: encodeLine(curve.slice(0,2)) }, { geometry: encodeLine(curve.slice(1)) },
  ] }] }] }, 2);
  assert.deepEqual(decodeLine(result[0].line), curve);
  assert.equal(routingUrl("transit", curve), null);
  assert.equal(routingUrl("walk", [[0,0], [35,181]]), null);
  assert.equal(routingUrl("drive", Array(17).fill([0,0])), null);
  assert.match(routingUrl("bike", curve), /routed-bike\/route\/v1\/driving\/135\.00000,35\.00000/);
  assert.throws(() => readRoadResponse({ code: "NoRoute" }, 2));
  assert.equal(usableRoute({ legs: [{ line: "???", seconds: 1, meters: 1 }] }, 2), false);
  assert.equal(new URL(directionsLink("google", "transit", { name: "起点 & A" }, { name: "终点" })).searchParams.get("origin"), "起点 & A");
  assert.equal(new URL(directionsLink("apple", "transit", { point: curve[0] }, { point: curve[1] })).searchParams.get("mode"), "transit");
});

test("AMap navigation uses verified GCJ-02 coordinates, and WGS84-only places open as destination markers", () => {
  const from = { point: [30.65445,104.08156] }, to = { name: "宽窄巷子", point: [30.66697,104.05089] };
  const direct = new URL(amapLink("transit", from, to).url);
  assert.equal(direct.pathname, "/navigation");
  assert.equal(direct.searchParams.get("from"), "104.084096,30.652049");
  assert.equal(direct.searchParams.get("mode"), "bus");
  const marker = new URL(amapLink("drive", {}, { name: "上海", point: [31.23,121.47] }).url);
  assert.equal(marker.pathname, "/marker");
  assert.equal(marker.searchParams.get("coordinate"), "wgs84");
  assert.equal(new URL(amapLink("bike", from, to).url).searchParams.get("type"), "ride");
  const manual = new URL(amapLink("walk", {point:[30.65701,104.06612]}, { point:[30.65845,104.0552] }).url);
  assert.equal(manual.pathname, "/navigation");
  assert.notEqual(manual.searchParams.get("from"), "104.06612,30.65701");
  assert.equal(manual.searchParams.has("key"), false);
  assert.equal(amapLink("transit", from, { point: [35.0,135.7] }), null);
});

test("dedicated trip IPC rejects other windows, invalid inputs and throttles repeated network calls", async () => {
  const handlers = new Map();
  const mainFrame = { routingId: 2, processId: 12 };
  const contents = { id: 37, mainFrame };
  const event = { sender: contents, senderFrame: mainFrame };
  const requests = [];
  const routeFixture = { code: "Ok", routes: [{ legs: [{ distance: 2200, duration: 460, steps: [{ geometry: encodeLine(points.slice(0,2)) }] }] }] };
  registerTripRoutesIpc({
    ipcMain: { handle: (name, cb) => handlers.set(name, cb) }, getWorkspaceWindow: () => ({ webContents: contents }), now: () => 2000,
    fetchRoute: async (url, options) => { requests.push({ url, options }); return Response.json(routeFixture); },
    fetchTile: async () => { throw new Error("offline"); },
  });
  const route = handlers.get("la:trip:route"), tile = handlers.get("la:trip:tile");
  const args = { points: points.slice(0,2), mode: "drive" };
  assert.equal((await route({ senderFrame: mainFrame }, args)).error.code, "E_FORBIDDEN");
  assert.equal((await route(event, { ...args, mode: "transit" })).error.code, "E_INVALID_ARGUMENT");
  assert.equal(requests.length, 0);
  assert.ok((await route(event, args)).ok);
  assert.equal(requests[0].options.redirect, "error");
  assert.equal(requests[0].options.credentials, "omit");
  assert.equal((await route(event, args)).error.code, "E_THROTTLED");
  assert.equal((await tile(event, { x: -1, y: 0, z: 4 })).error.code, "E_INVALID_ARGUMENT");
  assert.equal((await tile(event, { x: 1, y: 0, z: 4 })).error.code, "E_IO");
});
