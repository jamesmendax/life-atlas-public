import { VALID_POINT } from "../../../domain/tripRoutes.js";
import { toAmapPoint } from "../../../domain/transitProviders.js";
import coverage from "./amap-coverage.json" with { type: "json" };
// Each public sample's alternate coordinates were checked using AMap's
// documented WGS84 marker URL. Its desktop navigation URL expects GCJ-02.
const sampleGcj = new Map([
  ["30.73335,104.14409", [30.730950,104.146603]], ["30.65445,104.08156", [30.652049,104.084096]],
  ["30.66697,104.05089", [30.664531,104.053370]], ["30.61979,104.04458", [30.617317,104.047041]],
  ["30.995,104.2218", [30.992617,104.224199]], ["30.6464,104.0477", [30.643945,104.050171]],
  ["30.6385,104.0903", [30.636095,104.092841]],
]);

function inRing([lat, lon], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x, y] = ring[i], [px, py] = ring[j];
    if ((y > lat) !== (py > lat) && lon < (px - x) * (lat - y) / (py - y) + x) inside = !inside;
  }
  return inside;
}

// The bundled low-resolution mainland boundary is suitable for broad
// coverage, not for deciding a coordinate system right at a national border.
// Keep a generous half-degree buffer for which the single-marker API decides.
function nearRing([lat, lon], ring) {
  return ring.some(([x, y], i) => {
    const [a, b] = ring[(i + 1) % ring.length];
    if (lon < Math.min(x, a) - 0.5 || lon > Math.max(x, a) + 0.5 ||
        lat < Math.min(y, b) - 0.5 || lat > Math.max(y, b) + 0.5) return false;
    const dx = a - x, dy = b - y;
    const t = Math.max(0, Math.min(1, ((lon - x) * dx + (lat - y) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(lon - x - t * dx, lat - y - t * dy) <= 0.5;
  });
}

// The multi-marker and embedded-route endpoints take AMap coordinates. Unlike
// the single-marker endpoint, neither documents a WGS84 conversion switch.
export function amapDisplayPoint(stop) {
  const p = stop?.point;
  const selected = stop?.amap?.selected === "entrance" ? stop.amap.entrance : stop?.amap?.location;
  if (Array.isArray(selected) && selected.length === 2 && VALID_POINT([selected[1], selected[0]])) return [selected[1], selected[0]];
  if (!VALID_POINT(p)) return null;
  const verified = sampleGcj.get(p.join(","));
  if (verified) return verified;
  const [lat, lon] = p;
  // The official WGS84 marker service also shifts Taipei even though Taiwan
  // is outside the bundled Natural Earth mainland polygon.
  if (lat >= 21 && lat <= 26.8 && lon >= 119 && lon <= 123) return null;
  if (lat < 0 || lat > 55 || lon < 72 || lon > 136) return p;
  return coverage.some(([outer]) => inRing(p, outer) || nearRing(p, outer)) ? null : p;
}

export function amapName(name) {
  // The public URI redirects through a second URL with decoded marker names.
  // A literal "&" or "#" there can drop every waypoint that follows it.
  const delimiters = { ",": "，", "|": "｜", ";": "；", "&": "＆", "#": "＃", "+": "＋", "%": "％" };
  return String(name || "站点").replace(/[,|;&#%+]/gu, (character) => delimiters[character]);
}

function publicUri(path, params) {
  return "https://uri.amap.com/" + path + "?" + new URLSearchParams({ ...params, src: "LifeAtlas" });
}

export function amapStopLink(stop, label) {
  if (!VALID_POINT(stop.point)) return publicUri("search", { keyword: amapName(stop.name) });
  const [lat, lon] = stop.point;
  return publicUri("marker", { position: lon + "," + lat, name: amapName(label), coordinate: "wgs84" });
}

export function amapMarkerGroup(stops) {
  const markers = stops.map(({ stop, label }) => {
    const [lat, lon] = amapDisplayPoint(stop);
    return [lon, lat, amapName(label)].join(",");
  });
  return publicUri("marker", { markers: markers.join("|") });
}

export function coveredByAmap(point) {
  return VALID_POINT(point) && coverage.some(([outer, ...holes]) =>
    inRing(point, outer) && !holes.some((ring) => inRing(point, ring)));
}

function routePoint(stop) {
  if (!coveredByAmap(stop?.point)) return null;
  const known = amapDisplayPoint(stop);
  if (known) return known;
  if (coverage.some(polygon => polygon.some(ring => nearRing(stop.point, ring)))) return null;
  // A routing coordinate is not a confirmed AMap POI identity.
  return toAmapPoint(stop.point).map(value => Number(value.toFixed(6)));
}

export function amapEmbedRoute(stops, mode) {
  if (!["drive", "bike", "walk", "transit"].includes(mode) || stops.length < 2
    || (mode !== "drive" && stops.length > 2)) return null;
  const points = stops.map(routePoint);
  if (points.some(point => !point)) return null;
  const positions = points.map(([lat,lon], index) => [lon, lat, amapName(stops[index].name)].join(","));
  const params = new URLSearchParams({ from: positions[0], to: positions.at(-1),
    type: { drive: "car", bike: "ride", transit: "bus", walk: "walk" }[mode], platform: "pc", src: "LifeAtlas" });
  if (positions.length > 2) params.set("via", positions.slice(1, -1).join(";"));
  return "https://www.amap.com/ssr/embed/dir?" + params;
}

export function amapEmbeddedRoute(mode, from, to) {
  const url = amapEmbedRoute([from, to], mode);
  return url ? { url, label: "高德路线" } : null;
}

export function amapLink(mode, from, to) {
  const p = to?.point;
  if (!coveredByAmap(p)) return null;
  const start = routePoint(from);
  const end = routePoint(to);
  if (start && end && mode === "bike") return amapEmbeddedRoute(mode, from, to);
  if (start && end && ["drive", "transit", "walk"].includes(mode)) {
    const url = new URL("https://uri.amap.com/navigation");
    url.search = new URLSearchParams({ from: start[1] + "," + start[0], to: end[1] + "," + end[0],
      mode: { drive: "car", transit: "bus", walk: "walk" }[mode], src: "LifeAtlas" }).toString();
    return { url: url.href, label: "高德路线" };
  }
  const url = new URL("https://uri.amap.com/marker");
  url.search = new URLSearchParams({ position: p[1] + "," + p[0], name: to.name, coordinate: "wgs84", src: "LifeAtlas" }).toString();
  return { url: url.href, label: "高德打开终点" };
}
