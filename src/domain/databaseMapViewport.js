// View configs store [longitude, latitude]. Leaflet accepts [latitude, longitude].
const MERCATOR_LATITUDE = 85.05112878;
export const DATABASE_MAP_LAYERS = {
  street: { label: "街道", maxZoom: 19 },
  satellite: { label: "卫星", maxZoom: 14 },
  offline: { label: "离线", maxZoom: 5 },
};
export function mapLayer(value) {
  return Object.hasOwn(DATABASE_MAP_LAYERS, value) ? value : "street";
}
export const displayLatitude = (lat) => Math.min(MERCATOR_LATITUDE, Math.max(-MERCATOR_LATITUDE, lat));
export const wrapLongitude = (lon) => Math.abs(lon) <= 180 ? lon : ((lon + 180) % 360 + 360) % 360 - 180;
export function mapViewport(config) {
  const center = Array.isArray(config?.center) && config.center.length === 2 && config.center.every(Number.isFinite) ? config.center : [0, 0];
  const legacy = Number.isFinite(config?.zoom) ? Math.max(1, Math.min(12, config.zoom)) : 1;
  const hasTileZoom = Number.isInteger(config?.tileZoom);
  if (!hasTileZoom && center[0] === 0 && center[1] === 0 && legacy === 1) return null;
  const zoom = hasTileZoom ? config.tileZoom : 1 + Math.round(Math.log2(legacy));
  return { center: [wrapLongitude(center[0]), displayLatitude(center[1])], zoom: Math.max(1, Math.min(DATABASE_MAP_LAYERS[mapLayer(config?.layer)].maxZoom, zoom)) };
}
export function storeMapViewport(center, zoom) {
  const round = n => Math.round(n * 1e6) / 1e6;
  return { center: [round(wrapLongitude(center.lng)), round(displayLatitude(center.lat))], tileZoom: zoom, zoom: Math.min(12, 2 ** (zoom - 1)) };
}

// Use the short arc for records on either side of the antimeridian.
export function recordBounds(located) {
  if (!located.length) return null;
  const lons = located.map(({ place }) => place.longitude < 0 ? place.longitude + 360 : place.longitude).sort((a,b) => a - b);
  let split = 0, largest = -1, south = 90, north = -90;
  for (let i = 0; i < lons.length; i++) {
    const gap = (i + 1 === lons.length ? lons[0] + 360 : lons[i + 1]) - lons[i];
    if (gap > largest) { largest = gap; split = i; }
  }
  for (const { place } of located) {
    const lat = displayLatitude(place.latitude);
    south = Math.min(south, lat); north = Math.max(north, lat);
  }
  let west = lons[(split + 1) % lons.length], east = lons[split];
  if (east < west) east += 360;
  if (west + east > 360) { west -= 360; east -= 360; }
  return [[south,west],[north,east]];
}
