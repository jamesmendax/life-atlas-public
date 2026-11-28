import { decodeRoadGeometry, encodeLine, encodeRoadSections, readRoadResponse } from "../../src/domain/tripRoutes.js";
import { amapLine } from "../../src/domain/transitProviders.js";

function namesRoad(step, ref) {
  if (typeof step.ref === "string" && step.ref.toUpperCase().split(/[;,/\s]+/u).includes(ref)) return true;
  // AMap identifies the road using road_name. Ignore instructions and intersection/exit names.
  const numbers = ref.slice(1);
  const valid = new Set([ref, ref + "国道", numbers + "国道", "国道" + numbers, "国道" + numbers + "线", ref + "高速", ref + "高速公路"]);
  const name = typeof step.name === "string" ? step.name.toUpperCase().replace(/\s+/gu, "") : "";
  return valid.has(name) || [...name.matchAll(/[（(]([^）)]+)[）)]/gu)].some(match => valid.has(match[1]));
}

function inspectLeg(stepData, leg, ref) {
  const sections = [];
  let line = [], measured = 0;
  function finish() {
    if (line.length > 1) sections.push(...encodeRoadSections(line));
    line = [];
  }
  for (const step of stepData) {
    if (!Number.isFinite(step.distance) || step.distance < 0) throw new Error("道路分段距离无效");
    if (!step.distance) continue;
    if (!namesRoad(step, ref)) { finish(); continue; }
    const shape = decodeRoadGeometry(step.geometry);
    if (shape.length < 2) throw new Error("道路分段轨迹无效");
    const last = line.at(-1);
    if (last && (last[0] !== shape[0][0] || last[1] !== shape[0][1])) finish();
    for (const point of (line.length ? shape.slice(1) : shape)) line.push(point);
    measured += step.distance;
  }
  finish();
  return { ...leg, highwayMeters: Math.min(leg.meters, Math.round(measured)),
    highwayCoverage: leg.meters ? Math.min(1, measured / leg.meters) : 0, highwaySections: sections };
}

export function selectRoadCandidate(payload, stopCount, ref) {
  if (!ref) return readRoadResponse(payload, stopCount);
  let best = null, bestCoverage = 0;
  for (const route of payload.routes || []) {
    const base = readRoadResponse({ code: payload.code, routes: [route] }, stopCount);
    const legs = base.map((leg, index) => inspectLeg(route.legs[index].steps, leg, ref));
    const covered = legs.reduce((sum, leg) => sum + leg.highwayMeters, 0);
    const total = legs.reduce((sum, leg) => sum + leg.meters, 0);
    if (total && covered / total > bestCoverage) { best = legs; bestCoverage = covered / total; }
  }
  return best;
}

function numeric(value) {
  return (typeof value === "string" && value.trim() || typeof value === "number") && Number.isFinite(+value) && +value >= 0 ? Number(value) : NaN;
}

export function amapRoadCandidates(payload) {
  const routes = (Array.isArray(payload?.route?.paths) ? payload.route.paths : []).flatMap(path => {
    if (!Array.isArray(path?.steps) || !path.steps.length) return [];
    const steps = path.steps.flatMap(step => {
      const points = amapLine(step?.polyline);
      const distance = numeric(step?.step_distance ?? step?.distance);
      if (!points.length && distance === 0) return [];
      return [{ name: step?.road_name, distance, geometry: encodeLine(points) }];
    });
    return [{ legs: [{ distance: numeric(path.distance), duration: numeric(path.cost?.duration ?? path.duration), steps }] }];
  });
  return { code: routes.length ? "Ok" : "NoRoute", routes };
}
