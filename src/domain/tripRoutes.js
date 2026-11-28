export const TRIP_MODES = [
  { id: "drive", label: "驾车", profile: "car", google: "driving", apple: "driving" },
  { id: "transit", label: "公交地铁", google: "transit", apple: "transit" },
  { id: "bike", label: "骑行", profile: "bike", google: "bicycling", apple: "cycling" },
  { id: "walk", label: "步行", profile: "foot", google: "walking", apple: "walking" },
];

export const MAX_ROUTE_STOPS = 16;
export const MAX_ROUTE_POINTS = 100_000;
export const MAX_ROUTE_SECTION_POINTS = 20_000;
export const ROAD_GEOMETRY_SIZE_ERROR = "E_ROUTE_GEOMETRY_TOO_LARGE";

// Stored paths can include a shared point at each chunk boundary and a
// repeated point on each zero-length leg.
const MAX_STORED_ROAD_POINTS = MAX_ROUTE_POINTS
  + Math.floor((MAX_ROUTE_POINTS - 1) / (MAX_ROUTE_SECTION_POINTS - 1))
  + MAX_ROUTE_STOPS - 1;

export const VALID_POINT = (p) => Array.isArray(p) && p.length === 2
  && Number.isFinite(p[0]) && Math.abs(p[0]) <= 85
  && Number.isFinite(p[1]) && Math.abs(p[1]) <= 180;

export function routeKey(mode, points) {
  if (!TRIP_MODES.some((entry) => entry.id === mode) || points.length < 2 || points.length > MAX_ROUTE_STOPS || !points.every(VALID_POINT)) return "";
  return mode + "|" + points.map(([lat, lon]) => lat.toFixed(5) + "," + lon.toFixed(5)).join(";");
}

export function routingUrl(mode, points) {
  const profile = TRIP_MODES.find((entry) => entry.id === mode)?.profile;
  if (!profile || !routeKey(mode, points)) return null;
  const path = points.map(([lat, lon]) => lon.toFixed(5) + "," + lat.toFixed(5)).join(";");
  return "https://routing.openstreetmap.de/routed-" + profile + "/route/v1/driving/" + path + "?geometries=polyline&steps=true&overview=false";
}

// Google's encoded polyline format, precision 5, also used by OSRM.
function decodePolyline(text, limit) {
  const invalid = () => new Error("无效的路线编码");
  const tooLarge = () => Object.assign(new Error("路线轨迹超过可处理的点数，请拆分路线后重试"), {
    code: ROAD_GEOMETRY_SIZE_ERROR,
  });
  if (typeof text !== "string") throw invalid();
  if (text.length > limit * 12) throw tooLarge();
  let index = 0;
  function readDelta() {
    let result = 0;
    for (let shift = 0; shift <= 25 && index < text.length; shift += 5) {
      const next = text.charCodeAt(index++) - 63;
      if (next < 0 || next > 63) throw invalid();
      result |= (next & 31) << shift;
      if (next < 32) return result & 1 ? ~(result >>> 1) : result >>> 1;
    }
    throw invalid();
  }
  const points = [];
  let lat = 0, lon = 0;
  while (index < text.length) {
    if (points.length >= limit) throw tooLarge();
    lat += readDelta();
    lon += readDelta();
    const point = [lat / 1e5, lon / 1e5];
    if (!VALID_POINT(point)) throw invalid();
    points.push(point);
  }
  return points;
}

export function decodeLine(text, limit = MAX_ROUTE_SECTION_POINTS) {
  try { return decodePolyline(text, limit); }
  catch { return []; }
}

export function decodeRoadGeometry(text, limit = MAX_ROUTE_POINTS) {
  return decodePolyline(text, limit);
}

export function encodeLine(points) {
  let text = "";
  let previous = [0, 0];
  for (const point of points) {
    const current = point.map((n) => Math.round(n * 1e5));
    for (let axis = 0; axis < 2; axis++) {
      const delta = current[axis] - previous[axis];
      let value = (delta << 1) ^ (delta >> 31);
      while (value >= 32) {
        text += String.fromCharCode((value & 31) + 95);
        value >>>= 5;
      }
      text += String.fromCharCode(value + 63);
    }
    previous = current;
  }
  return text;
}

// Retain provider geometry at polyline precision; never force a point-count
// reduction that moves roads at street zoom.
export function compactLine(points) { return points; }

export function encodeRoadSections(points) {
  const sections = [];
  for (let start = 0; start < points.length - 1; start += MAX_ROUTE_SECTION_POINTS - 1) {
    // The last point of one chunk is also the first point of the next.
    sections.push(encodeLine(points.slice(start, start + MAX_ROUTE_SECTION_POINTS)));
  }
  return sections;
}

export const ROUTE_GEOMETRY_VERSION = 2;

function samePoint(a, b) {
  return a[0] === b[0] && a[1] === b[1];
}

export function readRoadResponse(payload, stopCount) {
  const route = payload?.routes?.[0];
  if (payload?.code !== "Ok" || !Array.isArray(route?.legs) || route.legs.length !== stopCount - 1) throw new Error("没有可用的道路路线");
  let totalPoints = 0;
  return route.legs.map((leg) => {
    if (!Number.isFinite(leg?.distance) || leg.distance < 0 || !Number.isFinite(leg.duration) || leg.duration < 0 || !Array.isArray(leg.steps)) throw new Error("路线数据不完整");
    const sections = [];
    let points = [];
    const finish = () => {
      sections.push(...encodeRoadSections(points));
      points = [];
    };
    for (const step of leg.steps) {
      const line = decodeRoadGeometry(step?.geometry, MAX_ROUTE_POINTS - totalPoints);
      if (!line.length) throw new Error("缺少道路轨迹");
      totalPoints += line.length;
      const last = points.at(-1);
      if (last && !samePoint(last, line[0])) finish();
      for (const point of line) {
        const previous = points.at(-1);
        if (!previous || !samePoint(previous, point)) points.push(point);
      }
    }
    if (points.length === 1 && leg.distance === 0) points.push(points[0]);
    finish();
    if (!sections.length) throw new Error("缺少道路轨迹");
    return { meters: Math.round(leg.distance), seconds: Math.round(leg.duration),
      ...(sections.length === 1 ? { line: sections[0] } : { sections }) };
  });
}

function readStoredRoadSections(leg, limit) {
  const lines = Array.isArray(leg?.sections) ? leg.sections : [leg?.line];
  if (lines.length * 2 > limit) return [];
  const paths = [];
  let remaining = limit;
  for (const line of lines) {
    const path = decodeLine(line, Math.min(MAX_ROUTE_SECTION_POINTS, remaining));
    if (path.length < 2) return [];
    paths.push(path);
    remaining -= path.length;
  }
  return paths;
}

export function roadSections(leg) {
  return readStoredRoadSections(leg, MAX_STORED_ROAD_POINTS);
}

// Distances are straight-line separations, not a route or an estimate of the
// time needed to reach the road. Stored geometry remains unchanged.
export function roadEndpointGaps(leg, from, to) {
  if (!VALID_POINT(from) || !VALID_POINT(to)) return null;
  const sections = roadSections(leg);
  if (!sections.length) return null;
  const distance = (a, b) => {
    const radians = Math.PI / 180;
    const lat = (a[0] - b[0]) * radians, lon = (a[1] - b[1]) * radians;
    const h = Math.sin(lat / 2) ** 2 + Math.cos(a[0] * radians) * Math.cos(b[0] * radians) * Math.sin(lon / 2) ** 2;
    return 12742000 * Math.asin(Math.min(1, Math.sqrt(h)));
  };
  const threshold = 250;
  const startMeters = distance(from, sections[0][0]);
  const endMeters = distance(to, sections.at(-1).at(-1));
  const breaks = sections.slice(1).map((section, i) => distance(sections[i].at(-1), section[0])).filter(meters => meters > threshold);
  return { startMeters, endMeters, startFar: startMeters > threshold, endFar: endMeters > threshold, breaks };
}

export function legSections(leg, transit) {
  if (!leg) return [];
  if (!transit) return roadSections(leg).map(path => ({ path }));
  return (leg.steps ?? []).flatMap(step => step.geometryEstimated ? [] : (step.sections ?? [])
    .map(line => decodeLine(line)).filter(path => path.length >= 2).map(path => ({ path, type: step.type })));
}

export function usableRoute(route, stopCount) {
  if (!Array.isArray(route?.legs) || route.legs.length !== stopCount - 1) return false;
  let remaining = MAX_STORED_ROAD_POINTS;
  return route.legs.every((leg) => {
    if (!Number.isFinite(leg?.meters) || leg.meters < 0 || !Number.isFinite(leg.seconds) || leg.seconds < 0) return false;
    const sections = readStoredRoadSections(leg, remaining);
    for (const path of sections) remaining -= path.length;
    return sections.length > 0;
  });
}

export function directionsLink(provider, mode, from, to) {
  const settings = TRIP_MODES.find((item) => item.id === mode);
  const location = (stop) => VALID_POINT(stop?.point) ? stop.point.join(",") : stop?.name;
  if (!settings || !location(from) || !location(to)) return "";
  const url = new URL(provider === "apple" ? "https://maps.apple.com/directions" : "https://www.google.com/maps/dir/");
  if (provider === "apple") {
    url.search = new URLSearchParams({ source: location(from), destination: location(to), mode: settings.apple }).toString();
  } else {
    url.search = new URLSearchParams({ api: "1", origin: location(from), destination: location(to), travelmode: settings.google }).toString();
  }
  return url.href;
}
