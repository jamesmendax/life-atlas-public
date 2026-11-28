const base = "https://www.amap.com/ssr/embed/";
export const TRIP_EMBED_PATHS = ["view", "place", "dir"].map(kind => base + kind);
const coordinate = (value, max) => typeof value === "string" && /^-?\d{1,3}(?:\.\d{1,8})?$/.test(value) && Math.abs(Number(value)) <= max;
const label = value => typeof value === "string" && value.length <= 160 && !/[\u0000-\u001f\u007f]/u.test(value);
function position(value) {
  if (!value) return false;
  const [lon, lat, name, ...extra] = value.split(",");
  return coordinate(lon, 180) && coordinate(lat, 85) && !extra.length && (name === undefined || label(name));
}

// Recheck the signed widget's request at the host and navigation boundaries.
export function checkedTripEmbed(value) {
  if (typeof value !== "string" || value.length > 6500) return null;
  let url;
  try { url = new URL(value); } catch { return null; }
  if (!TRIP_EMBED_PATHS.includes(url.origin + url.pathname) || url.username || url.password || url.hash) return null;
  const params = url.searchParams;
  const kind = url.pathname.split("/").at(-1);
  const permitted = kind === "dir" ? ["from", "to", "via", "type"] : ["lng", "lat", "zoom", ...(kind === "place" ? ["name"] : [])];
  permitted.push("platform", "src");
  if ([...params.keys()].some(k => !permitted.includes(k) || params.getAll(k).length !== 1)
    || params.get("platform") !== "pc" || params.get("src") !== "LifeAtlas") return null;
  if (kind === "dir") {
    if (!["car", "bus", "walk", "ride"].includes(params.get("type")) || !position(params.get("from")) || !position(params.get("to"))) return null;
    if (params.has("via")) {
      const via = params.get("via").split(";");
      if (params.get("type") !== "car" || via.length > 16 || !via.every(position)) return null;
    }
  } else if (!coordinate(params.get("lng"), 180) || !coordinate(params.get("lat"), 85)
    || !/^(?:[3-9]|1\d|20)$/.test(params.get("zoom")) || (params.has("name") && !label(params.get("name")))) return null;
  return url.href;
}
