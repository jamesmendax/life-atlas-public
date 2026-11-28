import { HISTORICAL_CHINA_DISTRICTS, REAL_CHINA_CITIES_BY_PROV } from "./chinaCitiesData.js";
import { CHINA_CITY_LANDMARKS } from "./chinaLandmarks.js";
import { REAL_GEO_CHINA, REAL_GEO_JAPAN, REAL_GEO_WORLD } from "./geoData.js";
import macauLayer from "./macau-parishes.json" with { type: "json" };

export const provinces = REAL_GEO_CHINA.map(({ id, name }) => ({ id, name }));
const cityRegions = [];
const cityGroups = new Map();
const macau = macauLayer.features.map(({ id, properties, geometry }) => ({
  id, adcode: properties.adcode, name: properties.name, full: properties.name, c: properties.point, g: geometry,
}));
for (const [provinceId, province] of Object.entries(REAL_CHINA_CITIES_BY_PROV)) {
  const regions = (provinceId === "cn-820000" ? macau : province.cities).map((city) => ({
    ...city, mode: "china", provinceId, parent: province.provName, landmarks: CHINA_CITY_LANDMARKS[city.id] || [],
  }));
  cityGroups.set(provinceId, regions);
  cityRegions.push(...regions);
}
const historicDistricts = HISTORICAL_CHINA_DISTRICTS.map((city) => ({ ...city, mode: "china",
  parent: REAL_CHINA_CITIES_BY_PROV[city.provinceId].provName, landmarks: CHINA_CITY_LANDMARKS[city.id] || [] }));
const japan = REAL_GEO_JAPAN.map((item) => ({ ...item, mode: "japan", parent: "日本" }));
const world = REAL_GEO_WORLD.map((item) => ({ ...item, mode: "world", parent: "世界" }));
const regions = [...cityRegions, ...japan, ...world, ...historicDistricts];
export const regionById = new Map(regions.map((region) => [region.id, region]));
export const modeNames = { china: "中国", japan: "日本", world: "世界" };

export function macauGeoJsonText() {
  return JSON.stringify(macauLayer);
}

const overviews = {
  china: { bounds: [73, 135.4, 17.7, 54], width: 840, height: 535, regions: cityRegions },
  japan: { bounds: [122.5, 146.8, 24, 46.2], width: 800, height: 550, regions: japan },
  world: { bounds: [-180, 180, -58, 84], width: 920, height: 455, regions: world },
};
const projectedMaps = new Map();

function makeProjection([west, east, south, north], width, height) {
  const cosine = Math.cos((north + south) / 2 * Math.PI / 180);
  const scale = Math.min((width - 32) / ((east - west) * cosine || 1), (height - 32) / (north - south || 1));
  const centerX = (east + west) / 2;
  const centerY = (north + south) / 2;
  return ([lon, lat]) => [
    Math.round((width / 2 + (lon - centerX) * scale * cosine) * 10) / 10,
    Math.round((height / 2 + (centerY - lat) * scale) * 10) / 10,
  ];
}

function decodeRing(encoded, precision) {
  const points = [];
  const coords = [0, 0];
  const scale = 10 ** precision;
  let offset = 0;
  while (offset < encoded.length) {
    for (let axis = 0; axis < 2; axis++) {
      let bits = 0, shift = 0, byte;
      do {
        byte = encoded.charCodeAt(offset++) - 63;
        bits |= (byte & 31) << shift;
        shift += 5;
      } while (byte >= 32);
      coords[axis] += bits & 1 ? ~(bits >> 1) : bits >> 1;
    }
    points.push([coords[0] / scale, coords[1] / scale]);
  }
  return points;
}

function ringsOf(geometry) {
  if (geometry.rings) return geometry.rings.map((ring) => decodeRing(ring, geometry.p));
  return geometry.type === "MultiPolygon" ? geometry.coordinates.flat() : geometry.coordinates;
}

function pathOf(rings, project) {
  return rings.filter((ring) => ring.length >= 3).map((ring) =>
    "M" + ring.map((point) => project(point).join(",")).join("L") + "Z"
  ).join(" ");
}

export function historicalDistrictPath(region) {
  const rings = ringsOf(region.g);
  const points = rings.flat(), xs = points.map(([x]) => x), ys = points.map(([,y]) => y);
  return pathOf(rings, makeProjection([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)], 240, 130));
}

export function footprintMap(mode, provinceId = "") {
  const province = mode === "china" && REAL_CHINA_CITIES_BY_PROV[provinceId];
  const key = province ? provinceId : mode;
  if (projectedMaps.has(key)) return projectedMaps.get(key);
  const { width, height, bounds, regions: items } = province
    ? { width: 800, height: 530, bounds: province.bounds, regions: cityGroups.get(provinceId) }
    : overviews[mode];
  const hainan = provinceId === "cn-460000";
  const inset = (mode === "china" && !province) ? { x: 38, y: 360, width: 98, height: 137 }
    : hainan ? { x: 644, y: 295, width: 134, height: 200 } : null;
  const mainland = hainan ? makeProjection([108.5, 111.3, 18.05, 20.3], 640, height) : makeProjection(bounds, width, height);
  const islands = inset && makeProjection([108, 118.4, 3.5, 17.8], inset.width, inset.height - 13);
  const project = (p) => {
    if (!islands || p[1] >= 17.7) return mainland(p);
    const [x, y] = islands(p);
    return [Math.round((x + inset.x) * 10) / 10, Math.round((y + inset.y + 13) * 10) / 10];
  };
  const map = {
    width, height, inset, key, mode, name: province ? province.provName : modeNames[mode],
    regions: items.map((item) => ({ ...item, path: pathOf(ringsOf(item.g), project), point: project(item.c) })),
    provinces: mode === "china" && !province ? REAL_GEO_CHINA.map((p) => ({
      id: p.id, name: p.name, path: pathOf(ringsOf(p.g), project), point: project(p.c),
    })) : [],
  };
  projectedMaps.set(key, map);
  return map;
}

export function findRegions(query) {
  const fold = (value) => value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const q = fold(query.trim());
  if (!q) return [];
  const matches = [];
  for (const region of regions) {
    const name = region.name.toLowerCase();
    const landmark = region.landmarks?.find((spot) => spot.toLowerCase().includes(q));
    const alias = fold(region.sub || "");
    let rank = 4;
    if (name === q || name === q + "市" || alias === q || region.id.toLowerCase() === q || region.adcode === q) rank = 0;
    else if (name.startsWith(q) || landmark) rank = 1;
    else if (name.includes(q) || alias.includes(q) || region.full?.includes(q)) rank = 2;
    else if (!region.parent.includes(q)) continue;
    matches.push({ region, rank, landmark });
  }
  return matches.sort((a, b) => a.rank - b.rank).slice(0, 10);
}

export const emptyRecord = { status: "unvisited", note: "", date: "", spots: [] };
const statuses = new Set(["visited", "planned", "wishlist", "unvisited"]);
export function recordFor(records, id) {
  // Early sandbox packages wrote a city under cn-<adcode>. A newer entry wins.
  const stored = records[id] ?? (id.startsWith("city-") ? records["cn-" + id.slice(5)] : undefined);
  if (!stored || typeof stored !== "object") return emptyRecord;
  return { ...stored, status: statuses.has(stored.status) ? stored.status : "unvisited",
    note: typeof stored.note === "string" ? stored.note : "", date: typeof stored.date === "string" ? stored.date : "",
    spots: Array.isArray(stored.spots) ? stored.spots.filter((spot) => typeof spot === "string") : [] };
}
