import L from "leaflet";
import { REAL_GEO_CHINA, REAL_GEO_WORLD } from "../footprint-data/geoData.js";
import { REAL_CHINA_CITIES_BY_PROV } from "../footprint-data/chinaCitiesData.js";
import reliefUrl from "./world-relief.webp";

// The shared footprint data encodes longitude first, separately rounded per layer.
function ringPoints(text, precision) {
  const points = [], xy = [0, 0];
  let offset = 0;
  while (offset < text.length) {
    for (let axis = 0; axis < 2; axis++) {
      let value = 0, shift = 0, byte;
      do {
        byte = text.charCodeAt(offset++) - 63;
        value |= (byte & 31) << shift;
        shift += 5;
      } while (byte >= 32);
      xy[axis] += value & 1 ? ~(value >> 1) : value >> 1;
    }
    points.push([xy[1] / precision, xy[0] / precision]);
  }
  return points;
}

function territory(feature, parent) {
  const rings = feature.g.rings.map((r) => ringPoints(r, 10 ** feature.g.p));
  return { name: feature.name, parent, point: [feature.c[1], feature.c[0]], rings, bounds: L.latLngBounds(rings.flat()) };
}

let geography;
function atlas() {
  if (!geography) geography = {
    world: REAL_GEO_WORLD.map((feature) => territory(feature, "")),
    provinces: REAL_GEO_CHINA.map((feature) => territory(feature, "")),
    districts: Object.values(REAL_CHINA_CITIES_BY_PROV).flatMap((p) => p.cities.map((d) => territory(d, p.provName))),
  };
  return geography;
}

// Drawing individual raster tiles avoids stretching an entire world image into
// a multi-million-pixel DOM element over a street-scale viewport.
export function addRelief(map) {
  const image = new Image();
  let ready = false;
  const layer = L.gridLayer({ pane: "trip-relief", maxNativeZoom: 5, maxZoom: 9, noWrap: true, keepBuffer: 0 });
  layer.createTile = ({ x, y, z }) => {
    const tile = document.createElement("canvas");
    tile.width = tile.height = 256;
    if (ready) {
      const side = image.naturalWidth / 2 ** z;
      tile.getContext("2d").drawImage(image, x * side, y * side, side, side, 0, 0, 256, 256);
    }
    return tile;
  };
  image.onload = () => { ready = true; if (map.hasLayer(layer)) layer.redraw(); };
  image.src = reliefUrl;
  layer.addTo(map);
  return () => { image.onload = null; };
}

function inRing(lat, lng, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [y, x] = ring[i], [previousY, previousX] = ring[j];
    if ((y > lat) !== (previousY > lat) && lng < (previousX - x) * (lat - y) / (previousY - y) + x) inside = !inside;
  }
  return inside;
}

function containing(items, center) {
  return items.find((item) => item.bounds.contains(center) && item.rings.some((ring) => inRing(center.lat, center.lng, ring)));
}

export function regionalContext(map) {
  const { districts, provinces, world } = atlas();
  const center = map.getCenter().wrap();
  const district = containing(districts, center);
  return district ? [district.parent, district.name].filter((name, i, names) => names.indexOf(name) === i).join(" · ")
    : (containing(provinces, center) || containing(world, center))?.name || "";
}

function geographicLabel(layer, name, point, className) {
  const label = document.createElement("span");
  label.textContent = name;
  const icon = L.divIcon({ html: label, className: "trip-cart-label " + className, iconSize: [0, 0], iconAnchor: [0, 0] });
  L.marker(point, { icon, pane: "trip-labels", interactive: false, keyboard: false }).addTo(layer);
}

function graticule(map, lines, renderer, labels) {
  const bounds = map.getBounds();
  const { x, y } = map.getSize();
  if (!x || !y) return;
  const longitudeSpan = bounds.getEast() - bounds.getWest();
  const target = longitudeSpan * 110 / x;
  const unit = 10 ** Math.floor(Math.log10(Math.max(target, 0.00001)));
  const step = [1, 2, 5, 10].find((factor) => factor * unit >= target) * unit;
  const digits = Math.max(0, -Math.floor(Math.log10(step)));
  const left = map.containerPointToLatLng([6, 0]).lng;
  const bottom = map.containerPointToLatLng([0, y - 9]).lat;
  const paths = [];
  for (let lng = Math.ceil(bounds.getWest() / step) * step; lng < bounds.getEast(); lng += step) {
    paths.push([[bounds.getSouth(), lng], [bounds.getNorth(), lng]]);
    if (lng > left + step * .32) geographicLabel(labels, Math.abs(lng).toFixed(digits) + (lng >= 0 ? "°E" : "°W"), [bottom, lng], "trip-grid-longitude");
  }
  for (let lat = Math.ceil(bounds.getSouth() / step) * step; lat < bounds.getNorth(); lat += step) {
    paths.push([[lat, bounds.getWest()], [lat, bounds.getEast()]]);
    if (lat > bottom + step * .12) geographicLabel(labels, Math.abs(lat).toFixed(digits) + (lat >= 0 ? "°N" : "°S"), [lat, left], "trip-grid-latitude");
  }
  L.polyline(paths, { renderer, className: "trip-coordinate-grid", interactive: false }).addTo(lines);
}

export function drawAtlas(map, lines, labels, renderer, stops, localRegion) {
  const { world, provinces, districts } = atlas();
  const zoom = map.getZoom(), bounds = map.getBounds().pad(.1);
  const visible = (items) => items.filter((item) => bounds.intersects(item.bounds));
  const borders = (items, style) => {
    const paths = items.flatMap((f) => f.rings);
    if (paths.length) L.polyline(paths, { renderer, className: style, interactive: false, smoothFactor: .8 }).addTo(lines);
  };
  const countries = visible(world), states = visible(provinces), cities = zoom >= 6 ? visible(districts) : [];
  borders(countries, "trip-country-line");
  if (zoom >= 3) borders(states, "trip-province-line");
  if (zoom >= 6) borders(cities, "trip-district-line");
  if (zoom >= 9 && !localRegion) graticule(map, lines, renderer, labels);
  if (localRegion && zoom >= 10) return;
  const { x, y } = map.getSize();
  const occupied = stops.filter((s) => s.point).map((s) => map.latLngToContainerPoint(s.point));
  const names = zoom < 3 ? countries : zoom < 6 ? [...states, ...countries.filter((f) => f.name !== "中国")]
    : [...cities, ...states, ...countries];
  for (const feature of names) {
    const xy = map.latLngToContainerPoint(feature.point);
    const halfWidth = Math.min(62, 5 + feature.name.length * 6);
    if (xy.x < halfWidth || xy.x > x - halfWidth || xy.y < 12 || xy.y > y - 14) continue;
    if (occupied.some((p) => Math.abs(xy.x-p.x) < (p.halfWidth ?? 14) + halfWidth + 6 && Math.abs(xy.y-p.y) < 19)) continue;
    geographicLabel(labels, feature.name, feature.point, "trip-region-name");
    occupied.push({ ...xy, halfWidth });
  }
}
