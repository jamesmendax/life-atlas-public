import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compactLine, decodeLine, decodeRoadGeometry, encodeLine, legSections, MAX_ROUTE_POINTS, MAX_ROUTE_SECTION_POINTS,
  readRoadResponse, roadEndpointGaps, roadSections, ROAD_GEOMETRY_SIZE_ERROR, ROUTE_GEOMETRY_VERSION, usableRoute,
} from '../src/domain/tripRoutes.js';
import { parseState, serializeState } from '../src/domain/marketFrameProtocol.js';
import { normalizeTrip } from '../src/editor/widgets/trip-data/itineraryState.js';
import { selectRoadCandidate } from '../electron/main/tripRoadCandidates.js';

function pointsAt(count, latitude = 40) {
  return Array.from({length: count}, (_, index) => [(latitude * 100000 + index) / 100000, (11500000 + index % 19 * 3) / 100000]);
}

function roadLeg(...paths) {
  return {distance: 4483105, duration: 195953, steps: paths.map(path => ({geometry: encodeLine(path)}))};
}

function routePayload(...legs) {
  return {code: 'Ok', routes: [{legs}]};
}

test('long roads retain all points and disconnected steps do not gain a fabricated bridge', () => {
  const points = Array.from({length: 500}, (_, i) => [40 + i / 100000, 115 + Math.sin(i / 5) / 1000]);
  assert.equal(compactLine(points).length, points.length);
  const pieces = [points.slice(0, 250), points.slice(300)];
  const [leg] = readRoadResponse({code:'Ok',routes:[{legs:[{distance:10000,duration:500,steps:pieces.map(p => ({geometry:encodeLine(p)}))}]}]}, 2);
  assert.deepEqual(leg.sections.map(x => decodeLine(x)), pieces.map(p => decodeLine(encodeLine(p))));
});


test('missing and estimated geometry draws no line or hit path, while real sections stay separate', () => {
  assert.deepEqual(legSections(null, false), []);
  assert.deepEqual(legSections({steps: [{type:'walk', geometryEstimated:true, sections: []}]}, true), []);
  const a = [[40,115],[40.01,115.01]], b = [[41,116],[41.01,116.01]];
  const leg = {meters: 100, seconds: 20, sections: [encodeLine(a), encodeLine(b)]};
  assert.deepEqual(legSections(leg, false).map(s => s.path), [a,b]);
  assert.equal(usableRoute({legs:[leg]},2), true);
});


test('a 27,593-point response survives storage and draws bounded paths with the original segments', () => {
  const connected = pointsAt(26000);
  const afterGap = pointsAt(1592, 41);
  const inputSteps = [connected.slice(0, 23001), connected.slice(23000), afterGap];
  assert.equal(inputSteps.reduce((sum, path) => sum + path.length, 0), 27593);

  const [leg] = readRoadResponse(routePayload(roadLeg(...inputSteps)), 2);
  assert.equal(leg.meters, 4483105);
  assert.equal(leg.seconds, 195953);
  const route = {geometryVersion: ROUTE_GEOMETRY_VERSION, legs: [leg]};
  const stops = [{name: '起点', point: connected[0]}, {name: '终点', point: afterGap.at(-1)}];
  const state = serializeState(normalizeTrip({days: [{stops, routes: {direct: route}}]}));
  const reopened = normalizeTrip(parseState(state)).days[0].routes.direct;
  assert.equal(usableRoute(reopened, 2), true);

  const paths = legSections(reopened.legs[0], false).map(section => section.path);
  assert.deepEqual(paths, [
    connected.slice(0, MAX_ROUTE_SECTION_POINTS),
    connected.slice(MAX_ROUTE_SECTION_POINTS - 1),
    afterGap,
  ]);
  assert.deepEqual(paths[0].at(-1), paths[1][0]);
  assert.notDeepEqual(paths[1].at(-1), paths[2][0]);
  const gaps = roadEndpointGaps(reopened.legs[0], connected[0], afterGap.at(-1));
  assert.equal(gaps.startFar, false);
  assert.equal(gaps.endFar, false);
  assert.equal(gaps.breaks.length, 1);
  assert.ok(gaps.breaks[0] > 80000);
});

test('the route vertex budget accepts its boundary and distinguishes excess from malformed geometry', () => {
  const points = pointsAt(MAX_ROUTE_POINTS + 1);
  const exact = roadLeg(points.slice(0, MAX_ROUTE_POINTS));
  const [leg] = readRoadResponse(routePayload(exact), 2);
  const paths = roadSections(leg);
  assert.deepEqual(paths.flatMap((path, index) => index ? path.slice(1) : path), points.slice(0, MAX_ROUTE_POINTS));
  assert.equal(usableRoute({legs: [leg]}, 2), true);
  assert.ok(paths.every(path => path.length <= MAX_ROUTE_SECTION_POINTS));

  const oversized = roadLeg(points);
  assert.throws(() => readRoadResponse(routePayload(oversized), 2), {code: ROAD_GEOMETRY_SIZE_ERROR});
  assert.throws(() => decodeRoadGeometry(oversized.steps[0].geometry), {code: ROAD_GEOMETRY_SIZE_ERROR});
  assert.throws(() => readRoadResponse(routePayload(roadLeg(points.slice(0, 2), points.slice(1, MAX_ROUTE_POINTS))), 2), {code: ROAD_GEOMETRY_SIZE_ERROR});
  const split = MAX_ROUTE_POINTS / 2;
  assert.equal(readRoadResponse(routePayload(roadLeg(points.slice(0, split)), roadLeg(points.slice(split, MAX_ROUTE_POINTS))), 3).length, 2);
  assert.throws(() => readRoadResponse(routePayload(roadLeg(points.slice(0, split)), roadLeg(points.slice(split - 1, MAX_ROUTE_POINTS))), 3), {code: ROAD_GEOMETRY_SIZE_ERROR});
  assert.throws(() => decodeRoadGeometry('bad!'), error => error.code !== ROAD_GEOMETRY_SIZE_ERROR);

  assert.deepEqual(roadSections({...leg, sections: [...leg.sections, leg.sections[0]]}), []);
  assert.equal(usableRoute({legs: [leg, leg]}, 3), false);
});

test('a legacy single polyline and a provider zero-length leg remain usable', () => {
  const [point, next] = pointsAt(2);
  const [zero] = readRoadResponse(routePayload({...roadLeg([point]), distance: 0, duration: 0}), 2);
  const legacy = {meters: 2, seconds: 1, line: encodeLine([point, next])};
  assert.equal(usableRoute({legs: [legacy, zero]}, 3), true);
  assert.deepEqual(roadSections(legacy), [[point, next]]);
  assert.deepEqual(roadSections(zero), [[point, point]]);
});

test('a long highlighted highway and a different connecting highway preserve separate render paths', () => {
  const connected = pointsAt(26000);
  const connector = [connected.at(-1), [40.27, 115.01], [40.28, 115.03]];
  const afterGap = pointsAt(17, 41);
  const leg = roadLeg(connected.slice(0, 23001), connected.slice(23000), connector, afterGap);
  const refs = ['G15;G1503', 'G15', 'G45', 'G15'];
  const distances = [2_300_000, 1_350_000, 60_000, 773_105];
  leg.steps.forEach((step, index) => Object.assign(step, {ref: refs[index], distance: distances[index]}));
  const payload = routePayload(leg);

  const [first] = selectRoadCandidate(payload, 2, 'G15');
  const [second] = selectRoadCandidate(payload, 2, 'G45');
  assert.equal(first.highwayMeters, 4_423_105);
  assert.equal(second.highwayMeters, 60_000);
  assert.deepEqual(first.highwaySections.map(line => decodeLine(line)), [
    connected.slice(0, MAX_ROUTE_SECTION_POINTS),
    connected.slice(MAX_ROUTE_SECTION_POINTS - 1),
    afterGap,
  ]);
  assert.deepEqual(second.highwaySections.map(line => decodeLine(line)), [connector]);
  const paths = legSections(first, false).map(section => section.path);
  assert.deepEqual(paths[1].slice(-connector.length), connector);
  assert.deepEqual(paths[2], afterGap);
});
