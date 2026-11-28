import { MAX_ROUTE_STOPS, VALID_POINT } from "./tripRoutes.js";

const CELL = 5;

export function rd5TileName(lon, lat) {
  if (!Number.isInteger(lon) || !Number.isInteger(lat)) return null;
  const west = ((lon + 180) % 360 + 360) % 360 - 180;
  if (west % CELL || lat % CELL || lat < -90 || lat >= 90) return null;
  return `${west < 0 ? "W" : "E"}${Math.abs(west)}_${lat < 0 ? "S" : "N"}${Math.abs(lat)}.rd5`;
}

export function isRd5TileName(name) {
  const match = typeof name === "string" && /^([EW])(\d{1,3})_([NS])(\d{1,2})\.rd5$/u.exec(name);
  if (!match) return false;
  const lon = (match[1] === "W" ? -1 : 1) * Number(match[2]);
  const lat = (match[3] === "S" ? -1 : 1) * Number(match[4]);
  return Math.abs(lon) <= 180 && rd5TileName(lon, lat) === name;
}

export function isOfflineTripCoordinates(coords) {
  return Array.isArray(coords) && coords.length >= 2 && coords.length <= MAX_ROUTE_STOPS && Array.from(coords).every(VALID_POINT);
}

function intersects(x, y, dx, dy, left, bottom, margin) {
  let start = 0, end = 1;
  for (const [value, delta, min] of [[x, dx, left], [y, dy, bottom]]) {
    const low = min - margin, high = min + CELL + margin;
    if (!delta) {
      if (value < low || value > high) return false;
      continue;
    }
    const a = (low - value) / delta, b = (high - value) / delta;
    start = Math.max(start, Math.min(a, b));
    end = Math.min(end, Math.max(a, b));
    if (start > end) return false;
  }
  return true;
}

function unwrapLon(from, to) {
  if (to - from > 180) return to - 360;
  if (from - to > 180) return to + 360;
  return to;
}

// Initial coverage from all adjacent stops, including the cells between them.
// A road detour can leave this corridor. Additional regions can be imported.
export function planRd5Corridor(coords, includeDetours = false) {
  if (!isOfflineTripCoordinates(coords)) return [];
  const names = new Set();
  for (let i = 1; i < coords.length; i++) {
    const [y, x] = coords[i - 1], [endY, rawEndX] = coords[i];
    const endX = unwrapLon(x, rawEndX);
    // Larger legs may follow highways well away from the straight corridor.
    const margin = includeDetours ? Math.min(2, Math.hypot(endX - x, endY - y) / 4) : 0;
    const xmin = Math.floor((Math.min(x, endX) - margin) / CELL) * CELL;
    const xmax = Math.floor((Math.max(x, endX) + margin) / CELL) * CELL;
    const ymin = Math.floor((Math.min(y, endY) - margin) / CELL) * CELL;
    const ymax = Math.floor((Math.max(y, endY) + margin) / CELL) * CELL;
    for (let left = xmin; left <= xmax; left += CELL) {
      for (let bottom = ymin; bottom <= ymax; bottom += CELL) {
        if (intersects(x, y, endX - x, endY - y, left, bottom, margin)) {
          const name = rd5TileName(left, bottom);
          if (name) names.add(name);
        }
      }
    }
  }
  return [...names].sort();
}

export function rd5TilesAtPoints(coords) {
  return [...new Set(coords.map(([lat, lon]) => rd5TileName(Math.floor(lon / CELL) * CELL, Math.floor(lat / CELL) * CELL)).filter(Boolean))].sort();
}
