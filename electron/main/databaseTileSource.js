const rgbLayer = "esa-worldcover-s2rgbnir-10m-2021-v2_tcc";
const latitude = (z, y) => Math.atan(Math.sinh(Math.PI * (1 - 2 * y / 2 ** z))) * 180 / Math.PI;

// Only a visible tile address reaches these public servers. No renderer-
// supplied URL, workspace name, point coordinates or provider credentials.
export function databaseTileSource(layer, z, x, y) {
  if (layer !== "street" && layer !== "satellite") return null;
  if (!Number.isInteger(z) || z < 0 || z > (layer === "street" ? 19 : 14)) return null;
  if (![x, y].every(n => Number.isInteger(n) && n >= 0 && n < 2 ** z)) return null;
  if (layer === "street") return { provider: "osm", type: "image/png", url: `https://tile.openstreetmap.org/${z}/${x}/${y}.png` };
  if (z < 8) {
    return { provider: "nasa", type: "image/jpeg", url: "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/"
      + `BlueMarble_NextGeneration/default/GoogleMapsCompatible_Level8/${z}/${y}/${x}.jpeg` };
  }
  if (latitude(z, y + 1) >= 83 || latitude(z, y) <= -60) return { provider: "terrascope", unavailable: true };
  const params = new URLSearchParams({
    SERVICE: "WMTS", REQUEST: "GetTile", VERSION: "1.0.0", LAYER: rgbLayer, STYLE: "default", FORMAT: "image/png",
    TILEMATRIXSET: "EPSG:3857", TILEMATRIX: String(z), TILECOL: String(x), TILEROW: String(y), TIME: "2021-01-01",
  });
  return { provider: "terrascope", type: "image/png", url: "https://wmts.terrascope.be/wmts?" + params };
}
