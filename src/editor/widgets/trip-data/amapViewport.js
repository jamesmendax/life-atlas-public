import { VALID_POINT } from "../../../domain/tripRoutes.js";
import { toAmapPoint } from "../../../domain/transitProviders.js";
import { amapDisplayPoint, coveredByAmap } from "./amapLinks.js";

function displayPoint(stop) {
  if (!VALID_POINT(stop?.point)) return null;
  return amapDisplayPoint(stop) || (coveredByAmap(stop.point) ? toAmapPoint(stop.point) : null);
}

export function amapViewportUrl(stops = [], focusStop = null) {
  const focused = displayPoint(focusStop);
  const points = focused ? [focused] : stops.map(displayPoint).filter(Boolean);
  if (!points.length) return "https://www.amap.com/ssr/embed/view?lng=104&lat=35&zoom=4&platform=pc&src=LifeAtlas";
  const lats = points.map(([lat]) => lat);
  const lons = points.map(([, lon]) => lon);
  const lat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const lon = (Math.min(...lons) + Math.max(...lons)) / 2;
  const span = Math.max(Math.max(...lons) - Math.min(...lons), (Math.max(...lats) - Math.min(...lats)) / Math.cos(lat * Math.PI / 180));
  const zoom = Math.max(3, Math.min(16, Math.floor(Math.log2(300 / Math.max(span, 0.001)))));
  const pin = focusStop || (stops.length === 1 ? stops[0] : null);
  const params = new URLSearchParams({ lng: lon.toFixed(6), lat: lat.toFixed(6), zoom: String(zoom), platform: "pc", src: "LifeAtlas" });
  if (pin?.name) params.set("name", String(pin.name).slice(0, 140));
  return "https://www.amap.com/ssr/embed/" + (pin ? "place" : "view") + "?" + params;
}
