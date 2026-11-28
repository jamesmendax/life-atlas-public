import { VALID_POINT } from "../../../domain/tripRoutes.js";
import rail from "./chengdu-rail.json" with { type: "json" };
import pois from "./chengdu-pois.json" with { type: "json" };
import labels from "./place-labels.json" with { type: "json" };
import chinaPlaces from "./china-places.json" with { type: "json" };
import { knownPlaces } from "./itineraryState.js";

const fold = value => String(value || "").normalize("NFKC").toLowerCase().replace(/[\s·、&/「」-]+/gu, "");
const categories = {
  railway: "铁路站点", bus: "公交站", attraction: "景点", park: "公园", museum: "博物馆",
  garden: "园林", restaurant: "餐厅", cafe: "咖啡馆", library: "图书馆", shop: "商店",
  place_of_worship: "宗教场所", lodging: "住宿", hospital: "医院", school: "学校",
};
const entries = [];
const areaZoom = { 地级行政区: 9, 城市: 10, 县城驻地: 11, 县级行政区: 11 };

function add(name, point, aliases, address, citycode, source, id, priority = 1, prefixes = [], zoom = 16) {
  const place = { id: id || "local:" + name + ":" + point.join(","), name, point, address, citycode, source, zoom };
  const area = fold(address) + (address.includes("成都") ? "成都四川chengdu028510100" : /京都|关西/u.test(address) ? "日本关西京都大阪奈良japankyotoosaka" : "");
  entries.push({ place, title: fold(name), terms: [name, ...aliases].map(fold), area, priority, prefixes });
}

for (const [id, name, lat, lon, parent, kind, aliases] of chinaPlaces) {
  const areas = [...new Set(parent.split(" ").filter(area => area && area !== "不统计"))];
  const prefixes = [...new Set(areas.flatMap(area => [area, area.replace(/(?:省|市|地区|自治区)$/u, "")]))].filter(Boolean);
  if (areas.length > 1) prefixes.push(areas.join(""));
  const isSeat = kind === "城市" || kind === "县城驻地";
  const county = typeof id === "string" && id.startsWith("cn:");
  const municipality = areas[0]?.endsWith("市");
  const zoom = kind === "省级行政区" ? (municipality ? 8 : 6) : kind === "城市" && municipality ? 9 : areaZoom[kind] ?? 16;
  const priority = isSeat ? 0 : (kind === "地级行政区" || county) ? 2 : 1;
  const short = /行政区|城市|县城驻地/u.test(kind) ? name.replace(/(?:市|县|区|旗)$/u, "") : "";
  add(name, [lat, lon], [...aliases, short].filter(Boolean), [...areas, kind].join(" · "), undefined,
    county ? "CTAmap 2026" : "GeoNames", county ? id : "geonames:" + id, priority, prefixes, zoom);
}

for (const [name, point] of knownPlaces) {
  const chengdu = point[1] < 120;
  const citycode = chengdu && name !== "三星堆博物馆新馆" ? "028" : undefined;
  add(name, point, name.split(/[·&]/u), chengdu ? "成都及周边" : "日本关西", citycode, "内置行程地点");
}
for (const { name, point, lines } of rail.stations) {
  if (!lines.length) continue;
  const base = name.replace(/站$/u, "");
  add(base + "站", point, [name, base + "地铁站"], "成都轨道交通 · " + lines.join("、"), "028", "成都离线轨道站点");
}
for (const [name, lat, lon, aliases, kind] of pois) {
  // The source gives some bus stops the exact same name as the adjacent attraction.
  const title = kind === "bus" && !name.includes("公交站") ? name + "（公交站）" : name;
  const category = categories[kind] || "地图地点";
  add(title, [lat, lon], [name, ...aliases], "成都及周边 · " + category, undefined, "OpenStreetMap");
}
for (const [region, rows] of Object.entries(labels)) {
  const address = region === "chengdu" ? "成都及周边" : region === "kyoto" ? "京都" : "关西";
  for (const [name, lat, lon] of rows) add(name, [lat, lon], name.split(" / "), address, undefined, "OpenStreetMap");
}

function matchRank(entry, term) {
  if (entry.title === term) return 0;
  if (entry.terms.includes(term)) return 1;
  if (entry.terms.some(name => name.startsWith(term))) return 2;
  if (entry.terms.some(name => name.includes(term))) return 3;
  return Infinity;
}

export function searchTripPlaces(query, { near, region, limit = 12 } = {}) {
  if (typeof query !== "string" || query.length > 80) return [];
  const term = fold(query), area = fold(region);
  if (!term) return [];
  const found = [];
  const useDistance = VALID_POINT(near);
  const longitudeScale = useDistance ? Math.cos(near[0] * Math.PI / 180) : 0;
  for (const entry of entries) {
    let rank = matchRank(entry, term);
    if (rank > 1) for (const prefix of entry.prefixes) {
      if (!term.startsWith(prefix) || term.length <= prefix.length) continue;
      const suffix = term.slice(prefix.length);
      rank = Math.min(rank, matchRank(entry, suffix));
      const withoutLevel = suffix.replace(/^(?:省|市)/u, "");
      if (withoutLevel !== suffix && withoutLevel) rank = Math.min(rank, matchRank(entry, withoutLevel));
    }
    if (!Number.isFinite(rank)) continue;
    const { point } = entry.place;
    const distance = useDistance ? Math.hypot(point[0] - near[0], (point[1] - near[1]) * longitudeScale) : 0;
    found.push({ place: entry.place, rank, regional: entry.area.includes(area), distance, priority: entry.priority });
  }
  found.sort((a, b) => a.rank - b.rank || Number(b.regional) - Number(a.regional)
    || a.priority - b.priority || a.distance - b.distance || a.place.name.length - b.place.name.length);
  const result = [];
  const count = Math.min(25, Math.max(1, Number.isInteger(limit) ? limit : 12));
  for (const { place } of found) {
    const duplicate = result.some(item => item.name === place.name
      && Math.abs(item.point[0] - place.point[0]) + Math.abs(item.point[1] - place.point[1]) < 0.001);
    if (duplicate) continue;
    result.push({ ...place, point: [...place.point] });
    if (result.length >= count) break;
  }
  return result;
}
