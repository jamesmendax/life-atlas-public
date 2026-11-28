import { MAX_ROUTE_STOPS, VALID_POINT, routeKey } from "../../../domain/tripRoutes.js";
import network from "./chengdu-transit.json" with { type: "json" };
import { cityRailLeg, distance, estimatedAccess, timedKnownLeg } from "./transitPlanner.js";

const pointKey = ([lat, lon]) => lat.toFixed(5) + "," + lon.toFixed(5);
const nodeByPoint = new Map(Object.entries(network.nodes).map(([id, node]) => [pointKey(node.point), id]));
const outgoing = new Map();
for (const edge of network.edges) {
  const edges = outgoing.get(edge.from) ?? [];
  edges.push(edge);
  outgoing.set(edge.from, edges);
}

const sampleNodes = network.sample.map((id) => network.nodes[id]);
const chengduRoadKey = routeKey("drive", sampleNodes.map((node) => node.point));

export function isChengduSample(stops) {
  return stops.length === sampleNodes.length && stops.every((stop, index) => stop.name === sampleNodes[index].name)
    && routeKey("drive", stops.map((stop) => stop.point)) === chengduRoadKey;
}

function isRide(edge) {
  return edge.type === "bus" || edge.type === "metro";
}

function shortestRide(start, end) {
  if (!start || !end || start === end) return null;
  const frontier = [{ node: start, edges: [], meters: 0, ridden: false }];
  const visited = new Set();
  while (frontier.length) {
    frontier.sort((a, b) => b.meters - a.meters);
    const current = frontier.pop();
    const key = current.node + "|" + current.ridden;
    if (visited.has(key)) continue;
    visited.add(key);
    if (current.node === end) {
      if (current.ridden) return current.edges;
      continue;
    }
    for (const edge of outgoing.get(current.node) ?? []) {
      if (current.edges.some((item) => item.from === edge.to)) continue;
      frontier.push({
        node: edge.to, edges: [...current.edges, edge], ridden: current.ridden || isRide(edge),
        meters: current.meters + edge.meters,
      });
    }
  }
  return null;
}

function segment(from, to) {
  if (!VALID_POINT(from) || !VALID_POINT(to)) return null;
  const edges = shortestRide(nodeByPoint.get(pointKey(from)), nodeByPoint.get(pointKey(to)));
  if (!edges) return null;
  const firstRide = edges.findIndex(isRide);
  const lastRide = edges.findLastIndex(isRide);
  const steps = [];
  for (const [index, edge] of edges.entries()) {
    const { type, name, towards, meters, seconds, line } = edge;
    const from = network.nodes[edge.from].name;
    const to = network.nodes[edge.to].name;
    const previous = steps.at(-1);
    if (isRide(edge) && previous?.name === name && previous.towards === towards) {
      previous.to = to;
      previous.sections.push(line);
      previous.meters += meters;
      previous.seconds = previous.seconds == null || seconds == null ? null : previous.seconds + seconds;
      continue;
    }
    if (isRide(edge) && index > 0 && isRide(edges[index - 1])) steps.push({ type: "transfer", from });
    steps.push({ type, name, towards, from, to, meters, seconds, sections: [line], transfer: type === "walk" && firstRide < index && index < lastRide });
  }
  return {
    meters: edges.reduce((sum, edge) => sum + edge.meters, 0),
    seconds: edges.every((edge) => edge.seconds != null) ? edges.reduce((sum, edge) => sum + edge.seconds, 0) : null,
    steps,
  };
}

export function chengduTransitRoute(points) {
  if (points.length < 2 || points.length > MAX_ROUTE_STOPS) return null;
  const legs = points.slice(1).map((point, index) => segment(points[index], point));
  return legs.some(Boolean) ? { at: network.at, legs } : null;
}

function pandaBusConnector(point, outward) {
  const zoo = network.nodes.zoo3;
  const panda = network.nodes.panda;
  const station = network.nodes.panda87;
  // Use the verified park walk for the recorded point. Nearby public pins
  // can also connect to the 87 bus stop, with the access estimate disclosed.
  const officialParkPoint = distance(point, panda.point) < 10;
  const gap = distance(point, station.point);
  if (!officialParkPoint && gap > 1500) return null;
  const stop = officialParkPoint ? panda : station;
  const path = outward ? segment(stop.point, zoo.point) : segment(zoo.point, stop.point);
  if (!path) return null;
  if (officialParkPoint) return path.steps;
  return outward
    ? [...estimatedAccess(gap, "起点", station.name), ...path.steps]
    : [...path.steps, ...estimatedAccess(gap, station.name, "终点")];
}

function railAndBusLeg(from, to) {
  const direct = cityRailLeg(from, to);
  if (direct) return direct;
  const zoo = network.nodes.zoo3.point;
  for (const outward of [true, false]) {
    const bus = pandaBusConnector(outward ? from : to, outward);
    if (!bus) continue;
    const rail = outward ? cityRailLeg(zoo, to) : cityRailLeg(from, zoo);
    if (!rail) continue;
    // Recalculate the complete transfer/wait breakdown once for both parts.
    const ridesAndWalks = rail.steps.filter(step => step.type !== "wait" && step.type !== "transfer");
    const steps = outward ? [...bus, ...ridesAndWalks] : [...ridesAndWalks, ...bus];
    return timedKnownLeg({ steps });
  }
  return null;
}

export function planChengduTransit(points) {
  if (!Array.isArray(points) || points.length < 2 || points.length > MAX_ROUTE_STOPS) return null;
  const legs = points.slice(1).map((end, i) => {
    const start = points[i];
    if (!VALID_POINT(start) || !VALID_POINT(end)) return null;
    const known = segment(start, end);
    return known ? timedKnownLeg(known) : railAndBusLeg(start, end);
  });
  return legs.some(Boolean) ? { at: network.at, provider: "chengdu-offline", legs } : null;
}
