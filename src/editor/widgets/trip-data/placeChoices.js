import { VALID_POINT } from "../../../domain/tripRoutes.js";
import { fromAmapPoint } from "../../../domain/transitProviders.js";

const types = {
  railway: "铁路", station: "车站", subway: "地铁", bus_stop: "公交站", bus_station: "公交车站",
  attraction: "景点", museum: "博物馆", park: "公园", hotel: "酒店", aerodrome: "机场",
  administrative: "行政区", city: "城市", county: "区县", village: "村庄",
};
const railType = /铁路|火车站|高铁站|\brailway\b|\btrain_station\b/u;
const transportType = /站[）)]?$|公交|地铁|机场|客运|\b(?:station|bus_stop|bus_station|subway|aerodrome)\b/u;
const attractionType = /景[区点]|风景|旅游|古城|博物馆|公园|遗址|\b(?:tourism|attraction|park|museum)\b/u;
const attractionQuery = /(?:景[区点]|风景区|古城|博物馆|公园|遗址|故宫|山)$/u;
const fold = value => String(value ?? "").normalize("NFKC").trim().toLowerCase();

function placeKind(place) {
  const category = [place.type, place.category, place.addressType].filter(Boolean).join(" ").toLowerCase();
  if (railType.test(category)) return "铁路站";
  if (transportType.test(category)) return types[place.type] || category.split(/[;|]/u).at(-1).trim();
  const sourceType = place.type || place.addressType;
  if (!sourceType) return "";
  return types[sourceType] || (/[\p{Script=Han}]/u.test(sourceType) ? sourceType.split(/[;|]/u).at(-1).trim() : "");
}

export function tripPlaceDetails(place) {
  const area = [...new Set([place.province, place.city, place.district].filter(Boolean))].join(" ");
  const address = place.address || area;
  return [placeKind(place), address, place.source].filter(Boolean).join(" · ");
}

export function travelPlaceChoices(query, remote, local, limit = 25) {
  const choices = [...remote, ...local.filter(place => !remote.some(other => other.name === place.name &&
    Math.abs(other.point[0] - place.point[0]) + Math.abs(other.point[1] - place.point[1]) < 0.001))];
  const raw = fold(query);
  const intent = transportType.test(raw) ? "transport" : attractionQuery.test(raw) ? "attraction" : "";
  function rank(place) {
    const category = [place.type, place.category, place.addressType].filter(Boolean).join(" ").toLowerCase();
    const kind = railType.test(category) || transportType.test(category) || transportType.test(place.name) ? "transport"
      : attractionType.test(category) ? "attraction" : "";
    return (kind && intent ? (kind === intent ? -2 : 4) : 0) + (fold(place.name) === raw ? -1 : 0);
  }
  if (intent) choices.sort((left, right) => rank(left) - rank(right));
  return choices.slice(0, limit);
}

export function localExactTravelPlace(query, places) {
  const name = fold(query);
  const exact = places.filter(place => fold(place.name) === name);
  if (!exact.length) return null;
  const first = exact[0];
  const same = exact.every(place => Math.abs(first.point[0] - place.point[0]) + Math.abs(first.point[1] - place.point[1]) < 0.001);
  if (!same || attractionQuery.test(name) && (railType.test(first.category || "") || transportType.test(placeKind(first)))) return null;
  return first;
}

export function withTravelEntrance(place) {
  const coord = place.amap?.entrance;
  if (!Array.isArray(coord) || coord.length !== 2) return null;
  const [lng, lat] = coord;
  if (!VALID_POINT([lat, lng])) return null;
  const point = fromAmapPoint([lat, lng]);
  if (Math.hypot(point[0] - place.point[0], point[1] - place.point[1]) < 0.00015) return null;
  return { ...place, id: place.id + ":entrance", name: place.name + "（入口）", point,
    amap: { ...place.amap, selected: "entrance" } };
}
