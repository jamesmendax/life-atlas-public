// Reads only the transportation_name LineStrings from Mapbox Vector Tiles.
// https://github.com/mapbox/vector-tile-spec/tree/master/2.1
import { VALID_POINT } from "../../src/domain/tripRoutes.js";
import { normalizeRoadRef } from "../../src/domain/tripRoadRef.js";
import { boundedBytes } from "./boundedResponse.js";

const zoom = 10;
const scale = 2 ** zoom;
const radiusMeters = 12000;
const source = "© OpenStreetMap contributors · OpenFreeMap / OpenMapTiles";
const roadClasses = new Set(["motorway", "trunk", "primary", "secondary", "tertiary", "minor", "service", "track"]);

function varint(bytes, cursor) {
  let value = 0;
  for (let shift = 0; shift < 70 && cursor.offset < bytes.length; shift += 7) {
    const octet = bytes[cursor.offset++];
    value += (octet & 127) * 2 ** shift;
    if (octet < 128) return value;
  }
  throw new Error("道路瓦片编码无效");
}

function* fields(bytes) {
  const cursor = { offset: 0 };
  while (cursor.offset < bytes.length) {
    const tag = varint(bytes, cursor), wire = tag & 7;
    if (wire === 0) { yield [tag >>> 3, varint(bytes, cursor)]; continue; }
    const length = wire === 2 ? varint(bytes, cursor) : wire === 1 ? 8 : wire === 5 ? 4 : -1;
    if (length < 0 || length > bytes.length - cursor.offset) throw new Error("道路瓦片字段无效");
    const start = cursor.offset;
    cursor.offset += length;
    yield [tag >>> 3, bytes.subarray(start, cursor.offset)];
  }
}

function tilePoint([lat, lon]) {
  return [(lon + 180) / 360 * scale, (1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * scale];
}
function geographic(x, y) {
  return [Math.atan(Math.sinh(Math.PI * (1 - 2 * y / scale))) * 180 / Math.PI, x / scale * 360 - 180];
}
const roundedPoint = point => point.map(n => Number(n.toFixed(6)));
const zigzag = value => value % 2 ? -(value + 1) / 2 : value / 2;

function nearestOnLine(bytes, target) {
  let x = 0, y = 0, moved = false, nearest = null, best = Infinity;
  const cursor = { offset: 0 };
  while (cursor.offset < bytes.length) {
    const command = varint(bytes, cursor), op = command % 8, count = Math.floor(command / 8);
    if ((op !== 1 && op !== 2) || count < 1 || count > (bytes.length - cursor.offset) / 2) throw new Error("道路线几何无效");
    for (let i = 0; i < count; i++) {
      const dx = zigzag(varint(bytes, cursor)), dy = zigzag(varint(bytes, cursor));
      if (op === 2 && moved && (dx || dy)) {
        const fraction = Math.max(0, Math.min(1, ((target[0] - x) * dx + (target[1] - y) * dy) / (dx * dx + dy * dy)));
        const candidate = [x + fraction * dx, y + fraction * dy];
        const distance = Math.hypot(target[0] - candidate[0], target[1] - candidate[1]);
        if (distance < best) { best = distance; nearest = candidate; }
      }
      x += dx; y += dy; moved = true;
    }
  }
  return nearest;
}

function roadCandidates(bytes, tx, ty, near, ref) {
  const places = [], [mx, my] = tilePoint(near);
  for (const [tag, layer] of fields(bytes)) {
    if (tag !== 3) continue;
    let layerName;
    for (const [field, value] of fields(layer)) if (field === 1) { layerName = value.toString("utf8"); break; }
    if (layerName !== "transportation_name") continue;
    const keys = [], values = [], features = [];
    let extent = 4096;
    for (const [field, value] of fields(layer)) {
      if (field === 2) features.push(value);
      if (field === 3) keys.push(value.toString("utf8"));
      if (field === 4) {
        let string = "";
        for (const [type, data] of fields(value)) if (type === 1) string = data.toString("utf8");
        values.push(string);
      }
      if (field === 5) extent = value;
    }
    if (extent <= 0 || extent > 65536) throw new Error("道路瓦片范围无效");
    for (const feature of features) {
      let tags, geometry, type;
      for (const [field, value] of fields(feature)) {
        if (field === 2) tags = value;
        if (field === 3) type = value;
        if (field === 4) geometry = value;
      }
      if (type !== 2 || !tags || !geometry) continue;
      let matches = false, name = "", roadClass;
      const cursor = { offset: 0 };
      while (cursor.offset < tags.length) {
        const key = keys[varint(tags, cursor)], value = values[varint(tags, cursor)] || "";
        if (key === "name" || key === "name:zh") name = value.slice(0, 80);
        if (key === "class") roadClass = value;
        if ((key === "ref" || /^route_[1-6]_ref$/u.test(key)) && value.toUpperCase().split(/[;,/\s]+/u).includes(ref)) matches = true;
      }
      if (!matches || !roadClasses.has(roadClass)) continue;
      const p = nearestOnLine(geometry, [(mx - tx) * extent, (my - ty) * extent]);
      if (p) places.push({ point: roundedPoint(geographic(tx + p[0] / extent, ty + p[1] / extent)), name: name || ref });
    }
  }
  return places;
}

function meters(a, b) {
  return 111195 * Math.hypot(a[0] - b[0], (a[1] - b[1]) * Math.cos(a[0] * Math.PI / 180));
}

export function createHighwayLookup({ fetchBytes, now = Date.now }) {
  const tiles = new Map();
  let planet, expiry = 0;
  async function template(owner) {
    if (planet && now() < expiry) return planet;
    const response = await fetchBytes("https://tiles.openfreemap.org/planet", owner);
    const url = JSON.parse((await boundedBytes(response, 128 * 1024)).toString("utf8")).tiles?.[0];
    if (typeof url !== "string" || !/^https:\/\/tiles\.openfreemap\.org\/planet\/[\w-]+\/\{z\}\/\{x\}\/\{y\}\.pbf$/u.test(url)) throw new Error("道路数据源无效");
    planet = url;
    expiry = now() + 86400000;
    return planet;
  }
  async function tile(url, owner) {
    if (tiles.has(url)) return tiles.get(url);
    const response = await fetchBytes(url, owner);
    const bytes = await boundedBytes(response, 1024 * 1024);
    if (tiles.size >= 20) tiles.delete(tiles.keys().next().value);
    tiles.set(url, bytes);
    return bytes;
  }
  return async (near, ref, owner) => {
    if (!VALID_POINT(near) || !normalizeRoadRef(ref)) throw new Error("道路参数无效");
    const pattern = await template(owner);
    const dLat = radiusMeters / 111195, dLon = dLat / Math.cos(near[0] * Math.PI / 180);
    const [x0, y0] = tilePoint([near[0] + dLat, near[1] - dLon]).map(Math.floor);
    const [x1, y1] = tilePoint([near[0] - dLat, near[1] + dLon]).map(Math.floor);
    const positions = [];
    for (let y = Math.max(0, y0); y <= Math.min(scale - 1, y1); y++) for (let x = Math.max(0, x0); x <= Math.min(scale - 1, x1); x++) positions.push([x, y]);
    if (positions.length > 12) throw new Error("该纬度的道路查询范围过大");
    const candidates = [];
    for (let i = 0; i < positions.length; i += 4) {
      const results = await Promise.all(positions.slice(i, i + 4).map(async ([x, y]) => {
        const url = pattern.replace("{z}", zoom).replace("{x}", x).replace("{y}", y);
        return roadCandidates(await tile(url, owner), x, y, near, ref);
      }));
      candidates.push(...results.flat());
    }
    const places = [];
    for (const item of candidates.map(p => ({ ...p, distance: meters(near, p.point) })).sort((a, b) => a.distance - b.distance)) {
      if (item.distance > radiusMeters || places.some(p => meters(p.point, item.point) < 500)) continue;
      const name = item.name.includes(ref) ? item.name : ref + " · " + item.name;
      places.push({ id: "road:" + ref + ":" + item.point.join(","), point: item.point, name,
        address: "距所选位置 " + (item.distance / 1000).toFixed(1) + " 公里 · 道路途经点", source: "OpenStreetMap" });
      if (places.length >= 5) break;
    }
    return { places, ref, source, radiusMeters };
  };
}
