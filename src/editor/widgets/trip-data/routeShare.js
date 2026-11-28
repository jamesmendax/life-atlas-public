import { TRIP_MODES, VALID_POINT, directionsLink } from "../../../domain/tripRoutes.js";
import { amapDisplayPoint, amapEmbedRoute, amapMarkerGroup, amapName, amapStopLink, coveredByAmap } from "./amapLinks.js";

// Bound the encoded URL as well as the number of waypoints. Google documents
// a 2,048-character limit; this also keeps copied links usable by the host.
const maxUrl = 2048;
const shortName = (value) => Array.from(String(value || "未命名站点")).slice(0, 64).join("");
const stopLabel = (stop, index) => [String(index + 1) + ".", stop.time, stop.name || "未命名站点"].filter(Boolean).join(" ");
const range = (a, b) => a === b ? "第 " + (a + 1) + " 站" : "第 " + (a + 1) + "–" + (b + 1) + " 站";
const titleFor = (day) => [day?.day ? "第 " + day.day + " 天" : "", day?.title || "旅行行程"].filter(Boolean).join(" · ");

function directions(provider, mode, stops) {
  const locations = stops.map((s) => ({ ...s, name: shortName(s.name) }));
  const url = new URL(directionsLink(provider, mode, locations[0], locations.at(-1)));
  const middle = locations.slice(1, -1).map((s) => VALID_POINT(s.point) ? s.point.join(",") : s.name);
  if (provider === "apple") {
    for (const location of middle) url.searchParams.append("waypoint", location);
  } else if (middle.length) {
    url.searchParams.set("waypoints", middle.map((name) => name.replaceAll("|", "｜")).join("|"));
  }
  return url.href;
}

function placeLink(provider, stop) {
  const point = VALID_POINT(stop.point) ? stop.point.join(",") : "";
  const name = shortName(stop.name);
  if (provider === "google") return "https://www.google.com/maps/search/?" + new URLSearchParams({ api: "1", query: point || name });
  if (point) return "https://maps.apple.com/place?" + new URLSearchParams({ coordinate: point, name });
  return "https://maps.apple.com/search?" + new URLSearchParams({ query: name });
}

function routeGroups(stops, maxStops, makeUrl, label) {
  const links = [];
  for (let start = 0; start < stops.length - 1;) {
    let end = Math.min(start + maxStops - 1, stops.length - 1);
    let url = makeUrl(stops.slice(start, end + 1));
    while ((!url || url.length > maxUrl) && end > start + 1) {
      end--;
      url = makeUrl(stops.slice(start, end + 1));
    }
    if (url && url.length <= maxUrl) links.push({ label: label + " · " + range(start, end), url });
    start = end;
  }
  return links;
}

function amapLinks(stops, mode) {
  const links = [];
  for (let start = 0; start < stops.length;) {
    const entries = [];
    let url = "";
    for (let i = start; i < Math.min(start + 10, stops.length); i++) {
      if (!amapDisplayPoint(stops[i])) break;
      const next = { stop: stops[i], label: stopLabel({ ...stops[i], name: shortName(stops[i].name) }, i) };
      const candidate = amapMarkerGroup([...entries, next]);
      if (candidate.length > maxUrl) break;
      entries.push(next);
      url = candidate;
    }
    if (entries.length >= 2) {
      links.push({ label: (entries.length === stops.length ? "高德全天地点" : "高德地点") + " · " + range(start, start + entries.length - 1), url });
      start += entries.length;
    } else {
      const stop = { ...stops[start], name: shortName(stops[start].name) };
      links.push({ label: "高德" + (VALID_POINT(stop.point) ? "地点" : "搜索") + " · " + range(start, start),
        url: amapStopLink(stop, stopLabel(stop, start)) });
      start++;
    }
  }
  const sites = stops.map((s) => ({ ...s, name: shortName(s.name) }));
  const routes = routeGroups(sites, mode === "drive" ? sites.length : 2, (group) => amapEmbedRoute(group, mode), "高德网页路线");
  // A share must include every stop. A single driving link can do this only
  // when both endpoints and every intermediate point fit in the same URL.
  const fullDrive = mode === "drive" && stops.length > 1 && amapEmbedRoute(sites, mode);
  const shareLinks = fullDrive && fullDrive.length <= maxUrl ? [{ label: "高德驾车路线", url: fullDrive }] : links;
  return { links: [...links, ...routes], shareLinks };
}

// Mobile app schemes are copied as plain text, never launched by Windows.
function nativeAmapLinks(stops, mode) {
  if (mode !== "drive" || stops.length < 2 || !stops.every((s) => coveredByAmap(s.point))) return [];
  const links = [];
  for (const [platform, base] of [["iOS", "iosamap://path"], ["Android", "amapuri://route/plan/"]]) {
    const makeUrl = (group) => {
      const verified = group.every((s) => amapDisplayPoint(s));
      // AMap documents dev for origin/destination. Avoid assuming it converts
      // intermediate points; use dev=1 only for two WGS84 endpoints.
      if (!verified && group.length > 2) return null;
      const points = group.map((s) => verified ? amapDisplayPoint(s) : s.point);
      const first = points[0], last = points.at(-1);
      const params = new URLSearchParams({ sourceApplication: "LifeAtlas", slat: first[0], slon: first[1],
        sname: shortName(group[0].name), dlat: last[0], dlon: last[1], dname: shortName(group.at(-1).name), dev: verified ? "0" : "1", t: "0", m: "0" });
      if (group.length > 2) {
        params.set("vian", String(group.length - 2));
        params.set("vialats", points.slice(1, -1).map((p) => p[0]).join("|"));
        params.set("vialons", points.slice(1, -1).map((p) => p[1]).join("|"));
        params.set("vianames", group.slice(1, -1).map((s) => amapName(shortName(s.name))).join("|"));
      }
      return base + "?" + params;
    };
    links.push(...routeGroups(stops, stops.length, makeUrl, "高德 App 驾车（" + platform + "）"));
  }
  return links;
}

const escapeXml = (value) => String(value ?? "").toWellFormed().replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/gu, "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
// KML viewers may render description as HTML after parsing the XML layer.
const descriptionText = (value) => escapeXml(escapeXml(value));

function kmlFile(title, date, stops) {
  if (!stops.some((s) => VALID_POINT(s.point))) return null;
  const labels = stops.map(stopLabel);
  const features = stops.map((stop, i) => {
    const p = stop.point;
    const geometry = VALID_POINT(p) ? "<Point><coordinates>" + p[1] + "," + p[0] + "</coordinates></Point>" : "";
    return "<Placemark><name>" + escapeXml(labels[i]) + "</name><description>" + descriptionText([date, stop.time, stop.name, stop.tag, geometry ? "" : "待定位"].filter(Boolean).join(" · ")) + "</description>" + geometry + "</Placemark>";
  });
  // AMap's PC importer reads LineString. Keep gaps where stops have no point
  // and name the geometry explicitly so it cannot be mistaken for navigation.
  let segment = [];
  for (const stop of [...stops, null]) {
    if (VALID_POINT(stop?.point)) segment.push(stop.point[1] + "," + stop.point[0]);
    else {
      if (segment.length >= 2) features.push("<Placemark><name>站点顺序连线（非道路轨迹）</name><LineString><coordinates>" + segment.join(" ") + "</coordinates></LineString></Placemark>");
      segment = [];
    }
  }
  const content = '<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>' + escapeXml(title)
    + "</name><description>" + descriptionText([date, ...labels].filter(Boolean).join("\n")) + "</description>\n" + features.join("\n") + "\n</Document></kml>";
  const basename = Array.from([date, title].filter(Boolean).join(" ").replace(/[<>:"/\\|?*\u0000-\u001f]/gu, "-")).slice(0, 88).join("").replace(/[. ]+$/u, "");
  return { filename: "Life Atlas " + basename + ".kml", mimeType: "application/vnd.google-earth.kml+xml", content };
}

export function buildTripShare({ day, mode = "drive", date = day?.date || "", provider = "amap" } = {}) {
  const stops = Array.isArray(day?.stops) ? day.stops : [];
  const settings = TRIP_MODES.find((m) => m.id === mode) || TRIP_MODES[0];
  const title = titleFor(day);
  let links, shareLinks = [], mobileLinks = [], hint;
  if (provider === "apple" || provider === "google") {
    const maxStops = provider === "apple" ? (settings.id === "drive" ? 14 : 2) : (settings.id === "transit" ? 2 : 5);
    links = stops.length === 1 ? [{ label: "打开地点", url: placeLink(provider, stops[0]) }]
      : routeGroups(stops, maxStops, (group) => directions(provider, settings.id, group), provider === "apple" ? "Apple 地图路线" : "Google 地图路线");
    hint = provider === "apple" ? "在 Apple 地图中打开路线；要保留为指南，可将各地点加入自己的指南。" : "在 Google 地图中打开路线；在电脑端 Google 我的地图的新图层中导入 KML，可保存站点。";
  } else {
    ({ links, shareLinks } = amapLinks(stops, settings.id));
    mobileLinks = nativeAmapLinks(stops, settings.id);
    hint = "高德链接可转发，接收者可在地图中收藏地点。含相邻已定位站点的 KML 可在高德网页版「新功能 → KML/GPX 轨迹导入」查看站点连线。";
  }
  const lines = [title, [date, settings.label].filter(Boolean).join(" · "), ...stops.map(stopLabel)];
  const plan = [title, date, ...stops.map((s, i) => stopLabel(s, i) +
    (Number.isSafeInteger(s.dwellMinutes) && s.dwellMinutes >= 0 ? " · 停留 " + s.dwellMinutes + " 分钟" : "")),
    day?.lodging && "当晚住宿 · " + day.lodging].filter(Boolean).join("\n");
  for (const link of [...links, ...mobileLinks]) lines.push(link.label + "\n" + link.url);
  return { text: lines.join("\n"), plan, shareLinks, links, mobileLinks, hint, file: kmlFile(title, date, stops) };
}
