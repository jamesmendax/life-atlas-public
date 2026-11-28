import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { addRelief, drawAtlas, regionalContext } from "./trip-data/tripAtlas.js";
import { attachTripClusters } from "./trip-data/tripMapClusters.js";
import { decodeLine, legSections, routeKey, VALID_POINT } from "../../domain/tripRoutes.js";
import cartography from "./trip-data/regional-streets.json";
import labels from "./trip-data/place-labels.json";
import TripPlaceSearch from "./TripPlaceSearch.jsx";
import { tripPlaceDetails } from "./trip-data/placeChoices.js";
import { tripStopLetter } from "./trip-data/itineraryState.js";
import "../../ui/themes/mobai/trip-plan-map.css";

const regionNames = { kyoto: "京都街道", kansai: "关西道路", chengdu: "成都道路" };
const regionPaths = new Map();
const layerOrder = ["green", "water", "river", "minor", "rail", "street", "arterial"];

function localRegion(map) {
  const { lat, lng } = map.getCenter().wrap();
  const zoom = map.getZoom();
  if (zoom < 7) return null;
  return [...cartography.regions].reverse().find(({ name, bounds: [west, south, east, north] }) =>
    (name !== "kyoto" || zoom >= 11) && lat >= south && lat <= north && lng >= west && lng <= east);
}

function drawRegion(region, layer, renderer) {
  if (!region) return;
  if (!regionPaths.has(region.name)) {
    regionPaths.set(region.name, Object.fromEntries(Object.entries(region.layers).map(([name, lines]) => [name, lines.map((line) => decodeLine(line)).filter((p) => p.length >= 2)])));
  }
  const paths = regionPaths.get(region.name);
  for (const name of layerOrder) {
    if (!paths[name]) continue;
    const options = { renderer, className: "trip-geo-" + name, interactive: false, smoothFactor: 1.1 };
    if (name === "green" || name === "water") L.polygon(paths[name], options).addTo(layer);
    else L.polyline(paths[name], options).addTo(layer);
  }
}

const chinaBounds = [[18, 73.5], [53.6, 135.1]];

function fit(map, points) {
  if (!map) return;
  const size = map.getSize();
  if (!size.x || !size.y) return;
  const inset = points.length ? Math.max(8, Math.min(32, size.x / 9, size.y / 8)) : 4;
  const bounds = L.latLngBounds(points.length ? points : chinaBounds);
  if (bounds.getSouthWest().equals(bounds.getNorthEast())) map.setView(bounds.getCenter(), 14, { animate: false });
  else map.fitBounds(bounds, { padding: [inset, inset], maxZoom: 16, animate: false });
}

function focusPlace(map, place) {
  if (!map || !VALID_POINT(place?.point)) return;
  map.setView(place.point, Number.isFinite(place.zoom) ? Math.max(1, Math.min(18, place.zoom)) : 14, { animate: false });
}

function savedSegment(day, mode, from, to) {
  let key = routeKey(mode, [from.point, to.point]);
  if (mode === "drive" && day.highwayRef) key += "|" + day.highwayRef;
  const saved = day.routes?.[key];
  return saved?.geometryVersion === 2 ? saved.legs?.[0] : null;
}

function legDrawing(leg, transit, from, to, index) {
  const sections = legSections(leg, transit);
  const highway = transit ? [] : (leg?.highwaySections ?? []).map((line) => decodeLine(line)).filter((p) => p.length >= 2);
  return { index, from, to, sections, highway, letters: tripStopLetter(index) + " → " + tripStopLetter(index + 1) };
}

function drawLeg(drawing, layer, selectable, onSelect) {
  const { index, sections, letters, from, to } = drawing;
  if (!sections.length) return;
  const paths = sections.map((s) => s.path);
  const [lat, lon] = paths[0][0];
  const coincident = paths.every((p) => p.every(([a, b]) => a === lat && b === lon));
  const pathLayer = (path, options) => coincident
    ? L.circleMarker([lat, lon], { ...options, radius: 20, fill: false })
    : L.polyline(path, options);
  for (const { path, type } of sections) {
    pathLayer(path, { className: "trip-path-outline", interactive: false, weight: 7, smoothFactor: 0 }).addTo(layer);
    const className = "trip-path" + (type ? " trip-path-" + type : "");
    const line = pathLayer(path, { className, weight: 4, smoothFactor: 0, interactive: false }).addTo(layer);
    line.getElement().dataset.legIndex = String(index);
  }
  for (const path of drawing.highway) {
    const marked = L.polyline(path, { className: "trip-highway-match", weight: 5, interactive: false, smoothFactor: 0 }).addTo(layer);
    marked.getElement().dataset.legIndex = String(index);
  }
  if (!selectable) return;
  const description = letters + " · " + from.name + " → " + to.name;
  const text = document.createElement("span");
  text.textContent = description;
  const hit = pathLayer(paths, { className: "trip-leg-hit", weight: 20, opacity: 0, interactive: true,
    bubblingMouseEvents: false, smoothFactor: 0, fill: false }).addTo(layer).bindTooltip(text, { sticky: true, direction: "top" });
  const element = hit.getElement();
  element.dataset.legIndex = String(index);
  element.setAttribute("role", "button");
  element.setAttribute("tabindex", "0");
  element.setAttribute("aria-label", "查看路段 " + description);
  hit.on("click", () => onSelect(index));
  element.addEventListener("focus", () => hit.openTooltip());
  element.addEventListener("blur", () => hit.closeTooltip());
  element.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    event.stopPropagation();
    onSelect(index);
  });
}

function drawLabels(map, layer, region, stops) {
  if (!region) return;
  const size = map.getSize();
  const occupied = stops.filter((s) => VALID_POINT(s.point)).map((s) => map.latLngToContainerPoint(s.point));
  let shown = 0;
  for (const [text, lat, lon] of labels[region.name] ?? []) {
    const xy = map.latLngToContainerPoint([lat, lon]);
    if (xy.x < 35 || xy.x > size.x - 35 || xy.y < 23 || xy.y > size.y - 15) continue;
    if (occupied.some((p) => Math.abs(p.x - xy.x) < 62 && Math.abs(p.y - xy.y) < 24)) continue;
    const label = document.createElement("span");
    label.textContent = text.split(" / ")[0];
    const icon = L.divIcon({ html: label, className: "trip-cart-label", iconSize: null, iconAnchor: [0, 0] });
    L.marker([lat, lon], { icon, pane: "trip-labels", interactive: false, keyboard: false }).addTo(layer);
    occupied.push(xy);
    if (++shown >= 17) break;
  }
}

const streetProblems = {
  "rate-limited": "街图服务限流", blocked: "街图服务拒绝访问", timeout: "街图连接超时",
  network: "街图服务连接失败", http: "街图服务未返回图片", busy: "街图请求繁忙",
  "payload-type": "街图响应格式有误", "invalid-png": "街图图片数据损坏", decode: "街图图片无法解码",
  "payload-too-large": "街图图片超过大小上限", "cache-unavailable": "街图缓存暂不可用",
};

function streetTiles(api, map, report) {
  const layer = L.gridLayer({ minZoom: 1, maxZoom: 18, keepBuffer: 0, noWrap: true, updateWhenIdle: true, updateWhenZooming: false });
  let frame = 0, active = true;
  const summarize = () => {
    if (!active || frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const viewport = map.getContainer().getBoundingClientRect();
      const zoom = Math.round(map.getZoom());
      const tiles = Array.from(layer.getContainer()?.querySelectorAll("canvas") ?? []).filter((tile) => {
        if (Number(tile.dataset.zoom) !== zoom) return false;
        const box = tile.getBoundingClientRect();
        return box.right > viewport.left && box.left < viewport.right && box.bottom > viewport.top && box.top < viewport.bottom;
      });
      const loaded = tiles.filter((tile) => tile.dataset.status === "ready").length;
      const failures = tiles.filter((tile) => tile.dataset.status === "failed");
      const reason = Object.keys(streetProblems).find(kind => failures.some(tile => tile.dataset.reason === kind));
      const retryAt = Math.max(0, ...failures.map(tile => Number(tile.dataset.retryAt) || 0));
      const state = failures.length ? (loaded ? "partial" : "failed") : tiles.length && loaded === tiles.length ? "ready" : "loading";
      report({ state, reason, retryAt });
    });
  };
  layer.createTile = (coords, done) => {
    const tile = document.createElement("canvas");
    tile.width = tile.height = 256;
    tile.dataset.zoom = String(coords.z);
    tile.dataset.status = "loading";
    const finish = (reason, retryMs = 0) => {
      if (!active) return;
      tile.dataset.status = reason ? "failed" : "ready";
      if (reason) tile.dataset.reason = reason;
      if (Number.isFinite(retryMs) && retryMs > 0) tile.dataset.retryAt = String(Date.now() + Math.min(retryMs, 300000));
      done(reason ? new Error(streetProblems[reason] || "街图暂不可用") : null, tile);
      summarize();
    };
    api({ x: coords.x, y: coords.y, z: coords.z }).then((result) => {
      if (!active) return;
      if (!result?.ok) {
        const details = result?.error?.details;
        finish(Object.hasOwn(streetProblems, details?.reason) ? details.reason : "network", details?.retryAfterMs);
        return;
      }
      const image = new Image();
      image.onload = () => { tile.getContext("2d").drawImage(image, 0, 0, 256, 256); finish(null); };
      image.onerror = () => finish("decode");
      image.src = result.value.dataUrl;
    }).catch(() => finish("network"));
    return tile;
  };
  layer.on("loading load tileunload", summarize).addTo(map);
  map.on("moveend resize", summarize);
  return () => { active = false; cancelAnimationFrame(frame); map.off("moveend resize", summarize); layer.remove(); };
}

export default function TripRouteMap({ trip, searchProvider, stops, route, transit, online, picking, onPick, selectedId, onSelect, sourceLabel, locked, onAdd, onCancelPick, activeLegIndex = null, onSelectLeg, lodging, onSetLodging, focusRequest, allDays, mode = "drive", onViewPoint, onEnableStreetMap, onToggleStreetMap, searchRequest }) {
  const host = useRef(null);
  const mapRef = useRef(null);
  const viewMode = useRef("day");
  const [scope, setScope] = useState("day");
  const markerById = useRef(new Map());
  const clusterControl = useRef(null);
  const callbacks = useRef();
  const [preview, setPreview] = useState(null);
  const [manualPick, setManualPick] = useState(false);
  const [clusterList, setClusterList] = useState(null);
  const [near, setNear] = useState();
  const detail = Number.isInteger(activeLegIndex) && activeLegIndex >= 0 && activeLegIndex < stops.length - 1;
  const visibleStops = useMemo(() => detail ? stops.slice(activeLegIndex, activeLegIndex + 2) : stops, [detail, activeLegIndex, stops]);
  const drawings = useMemo(() => {
    if (detail) return [legDrawing(route?.legs?.[activeLegIndex], transit, stops[activeLegIndex], stops[activeLegIndex + 1], activeLegIndex)];
    return stops.slice(1).map((to, index) => legDrawing(route?.legs?.[index], transit, stops[index], to, index));
  }, [detail, activeLegIndex, stops, route, transit]);
  const lodgingPoint = !detail && VALID_POINT(lodging?.point) ? lodging.point : null;
  const extent = useMemo(() => [...visibleStops.map((s) => s.point).filter(VALID_POINT),
    ...drawings.flatMap((d) => d.sections.flatMap((section) => section.path)), ...(lodgingPoint ? [lodgingPoint] : [])], [visibleStops, drawings, lodgingPoint]);
  const otherDays = useMemo(() => (allDays ?? []).filter((day) => day.stops !== stops).map((day) => {
    const candidate = mode === "drive" && day.highwayRef ? null : day.routes?.[routeKey(mode, day.stops.map((s) => s.point))];
    const fullRoute = candidate?.geometryVersion === 2 ? candidate : null;
    const legs = day.stops.slice(1).map((to, index) => {
      const from = day.stops[index];
      return legDrawing(savedSegment(day, mode, from, to) ?? fullRoute?.legs?.[index], transit, from, to, index);
    });
    return { ...day, legs };
  }), [allDays, stops, mode, transit]);
  const overnightLegs = useMemo(() => {
    const days = (allDays ?? []).filter((day) => day.stops.length);
    return days.slice(1).map((next, i) => {
      const day = days[i], from = day.stops.at(-1), to = next.stops[0], index = day.stops.length - 1;
      const current = day.stops === stops ? route?.legs?.[index] : null;
      return legDrawing(current ?? savedSegment(day, mode, from, to), transit, from, to, index);
    });
  }, [allDays, stops, route, mode, transit]);
  const allExtent = useMemo(() => [...extent, ...overnightLegs.flatMap((leg) => leg.sections.flatMap((s) => s.path)), ...otherDays.flatMap((day) => [
    ...day.stops.map((s) => s.point).filter(VALID_POINT),
    ...day.legs.flatMap((d) => d.sections.flatMap((section) => section.path)),
    ...(VALID_POINT(day.lodgingPoint) ? [day.lodgingPoint] : []),
  ])], [extent, otherDays, overnightLegs]);
  const choosing = !detail && !locked && (picking || manualPick);
  callbacks.current = { choosing, picking: !detail && picking, cluster: !detail && !choosing, onPick, onCancelPick, onSelect, onSelectLeg, visibleStops, extent, allExtent, onViewPoint };
  const [region, setRegion] = useState("");
  const [mapInfo, setMapInfo] = useState(null);
  const [tileResult, setTileResult] = useState({ state: "loading" });
  const { state: tileStatus, reason: tileReason, retryAt } = tileResult;
  const [cooled, setCooled] = useState(0);
  const [retry, setRetry] = useState(0);
  function changeScope(value) {
    setClusterList(null);
    viewMode.current = value;
    setScope(value);
    if (value !== "manual") fit(mapRef.current, value === "china" ? [] : value === "all" ? callbacks.current.allExtent : callbacks.current.extent);
  }
  function locate(place) {
    if (!VALID_POINT(place?.point)) return;
    changeScope("manual");
    focusPlace(mapRef.current, place);
  }
  const geometryKey = useMemo(() => JSON.stringify([detail ? activeLegIndex : "all", extent]), [detail, activeLegIndex, extent]);
  function external(event) {
    event.preventDefault();
    event.stopPropagation();
    void trip?.open({ url: event.currentTarget.href });
  }

  useEffect(() => {
    const map = L.map(host.current, { attributionControl: false, zoomControl: false, minZoom: 1, maxZoom: 18,
      maxBounds: [[-85, -180], [85, 180]], maxBoundsViscosity: 1, scrollWheelZoom: true,
      zoomSnap: .25, zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false });
    mapRef.current = map;
    map.createPane("trip-relief").classList.add("trip-relief-pane");
    map.createPane("trip-paper").classList.add("trip-paper-pane");
    map.createPane("trip-labels").classList.add("trip-label-pane");
    const renderer = L.svg({ pane: "trip-paper", padding: .15 }).addTo(map);
    const paper = L.layerGroup().addTo(map);
    const localLabels = L.layerGroup().addTo(map);
    const regionalLayers = L.layerGroup().addTo(map);
    let previous, previousPoint;
    const updateRegion = () => {
      const center = map.getCenter().wrap();
      const zoom = map.getZoom();
      const coordinates = [Number(center.lat.toFixed(5)), Number(center.lng.toFixed(5))];
      if (String(previousPoint) !== String(coordinates)) {
        previousPoint = coordinates;
        callbacks.current.onViewPoint?.(coordinates);
      }
      setNear(zoom >= 7 ? coordinates : undefined);
      setMapInfo({ point: coordinates, zoom, place: zoom >= 6 ? regionalContext(map) : "" });
      const next = localRegion(map);
      const name = next?.name ?? "";
      paper.clearLayers();
      localLabels.clearLayers();
      drawAtlas(map, paper, localLabels, renderer, callbacks.current.visibleStops, next);
      drawLabels(map, localLabels, next, callbacks.current.visibleStops);
      if (previous !== name) {
        previous = name;
        regionalLayers.clearLayers();
        drawRegion(next, regionalLayers, renderer);
        setRegion(name);
      }
    };
    map.on("moveend", updateRegion);
    function manualView() { viewMode.current = "manual"; setScope((old) => old === "all" ? old : "manual"); }
    map.on("dragstart boxzoomstart dblclick", manualView);
    const keyboardView = (event) => {
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "+", "-", "="].includes(event.key)) manualView();
      if (!callbacks.current.choosing || event.target !== map.getContainer()) return;
      if (event.key === "Enter") { event.preventDefault(); map.fire("click", { latlng: map.getCenter() }); }
      if (event.key === "Escape") {
        if (callbacks.current.picking) callbacks.current.onCancelPick?.();
        setManualPick(false);
      }
    };
    const container = map.getContainer();
    container.addEventListener("keydown", keyboardView);
    container.addEventListener("wheel", manualView, { passive: true });
    container.addEventListener("touchstart", manualView, { passive: true });
    map.on("click", ({ latlng }) => {
      const { choosing, picking, onPick } = callbacks.current;
      if (choosing) {
        const point = latlng.wrap();
        const coordinates = [Number(point.lat.toFixed(5)), Number(point.lng.toFixed(5))];
        if (!VALID_POINT(coordinates)) return;
        if (picking) onPick(coordinates);
        else setPreview({ name: "", point: coordinates, source: "地图选点", manual: true });
        setManualPick(false);
      }
    });
    map.setView([36, 104], 3, { animate: false });
    fit(map, callbacks.current.extent);
    const releaseRelief = addRelief(map);
    const clusters = attachTripClusters(map, () => callbacks.current.cluster, (markers) => {
      manualView();
      const points = markers.map((marker) => marker.getLatLng());
      fit(map, points);
      setClusterList(markers.map((marker) => ({
        label: marker.options.title, point: [marker.getLatLng().lat, marker.getLatLng().lng], marker,
      })));
    });
    clusterControl.current = clusters;
    const observer = new ResizeObserver(() => {
      // Search results and previews change the height of this flex viewport.
      // Keep the geographic centre under its crosshair while the controls reflow.
      map.invalidateSize({ pan: true, animate: false });
      if (viewMode.current !== "manual") changeScope(viewMode.current);
    });
    observer.observe(host.current);
    return () => {
      observer.disconnect(); releaseRelief(); clusters.remove(); clusterControl.current = null;
      container.removeEventListener("keydown", keyboardView);
      container.removeEventListener("wheel", manualView);
      container.removeEventListener("touchstart", manualView);
      map.remove(); mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (detail || viewMode.current === "day") changeScope(extent.length ? "day" : "china");
    else if (viewMode.current === "all") changeScope("all");
  }, [geometryKey, detail]);
  useEffect(() => { if (focusRequest) locate(focusRequest); }, [focusRequest?.id, focusRequest?.point?.[0], focusRequest?.point?.[1], focusRequest?.zoom]);

  const previewPoint = !detail && preview?.point;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !previewPoint) return;
    const marker = L.circleMarker(previewPoint, { className: "trip-preview-point", radius: 9, weight: 3, interactive: false }).addTo(map);
    return () => { map.removeLayer(marker); };
  }, [previewPoint]);
  useEffect(() => { if (picking || detail) { setManualPick(false); setPreview(null); } }, [picking, detail]);
  useEffect(() => {
    clusterControl.current?.update();
    if (detail || choosing) setClusterList(null);
  }, [detail, choosing]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !lodgingPoint) return;
    const text = document.createElement("span");
    text.textContent = "当晚住宿 · " + (lodging.name || "住宿地点");
    const face = document.createElement("span");
    face.textContent = "宿";
    const marker = L.marker(lodgingPoint, {
      tripLocation: true, title: text.textContent, alt: text.textContent, keyboard: !choosing, interactive: !choosing,
      icon: L.divIcon({ className: "trip-map-lodging", html: face, iconSize: [26, 24], iconAnchor: [13, 39] }),
    }).bindTooltip(text, { direction: "top", offset: [0, -38] }).addTo(map);
    return () => { marker.remove(); };
  }, [lodgingPoint, lodging?.name, choosing]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const overlays = L.layerGroup().addTo(map);
    const markers = new Map();
    for (const drawing of drawings) drawLeg(drawing, overlays, !detail && !choosing && Boolean(callbacks.current.onSelectLeg),
      (index) => callbacks.current.onSelectLeg?.(index));
    visibleStops.forEach((stop, localIndex) => {
      if (!VALID_POINT(stop.point)) return;
      const index = detail ? activeLegIndex + localIndex : localIndex;
      const pin = document.createElement("span");
      pin.textContent = tripStopLetter(index);
      const label = document.createElement("span");
      label.textContent = pin.textContent + " · " + stop.name;
      const marker = L.marker(stop.point, {
        tripLocation: true, title: label.textContent, alt: label.textContent, keyboard: true,
        icon: L.divIcon({ className: "trip-map-pin" + (stop.done ? " is-done" : ""), html: pin, iconSize: [25, 25], iconAnchor: [12, 12] }),
      }).bindTooltip(label, { direction: "top", offset: [0, -12] }).addTo(overlays);
      marker.getElement().dataset.stopIndex = String(index);
      marker.on("click", () => {
        const current = callbacks.current;
        if (current.picking) current.onPick(stop.point);
        else if (current.choosing) { setPreview({ name: stop.name, point: stop.point, source: "地图选点", manual: true }); setManualPick(false); }
        else if (detail) marker.openTooltip();
        else current.onSelect?.(stop.id);
      });
      markers.set(stop.id, marker);
    });
    markerById.current = markers;
    return () => { map.removeLayer(overlays); markers.clear(); };
  }, [drawings, visibleStops, detail, activeLegIndex, choosing]);

  useEffect(() => {
    markerById.current.forEach((marker, id) => {
      marker.getElement()?.classList.toggle("is-selected", selectedId === id);
      if (selectedId === id) {
        mapRef.current?.panInside(marker.getLatLng(), { padding: [28, 28], animate: false });
        marker.openTooltip();
      }
      else marker.closeTooltip();
    });
  }, [selectedId, drawings, visibleStops, choosing]);

  useEffect(() => {
    const map = mapRef.current;
    if (!online || !map || !trip?.tile) return;
    setTileResult({ state: "loading" });
    return streetTiles(trip.tile, map, setTileResult);
  }, [online, trip?.tile, retry]);
  useEffect(() => {
    if (!retryAt) return;
    const timer = setTimeout(() => setCooled(retryAt), Math.max(0, retryAt - Date.now()));
    return () => clearTimeout(timer);
  }, [retryAt]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || scope !== "all" || detail) return;
    const overlay = L.layerGroup().addTo(map);
    for (const leg of overnightLegs) drawLeg(leg, overlay, false);
    for (const day of otherDays) {
      for (const leg of day.legs) drawLeg(leg, overlay, false);
      const locations = [...day.stops, { point: day.lodgingPoint, name: day.lodging }];
      locations.forEach(({ point, name }, i) => {
        if (!VALID_POINT(point)) return;
        const text = document.createElement("span");
        text.textContent = "第 " + day.day + " 天 · " + name;
        const face = document.createElement("span");
        face.textContent = i < day.stops.length ? String(day.day) + tripStopLetter(i) : "宿";
        L.marker(point, { tripLocation: true, title: text.textContent, alt: text.textContent, interactive: !choosing, keyboard: !choosing,
          icon: L.divIcon({ html: face, className: "trip-map-day-marker", iconSize: [26, 22], iconAnchor: [13, 11] }),
        }).bindTooltip(text).addTo(overlay);
      });
    }
    return () => overlay.remove();
  }, [scope, otherDays, overnightLegs, detail, choosing]);

  const leg = detail ? route?.legs?.[activeLegIndex] : null;
  const legSource = transit && leg?.source ? leg.source : sourceLabel;
  const caption = detail ? drawings[0].letters + " · " + (drawings[0].sections.length ? legSource : "暂无路线轨迹") : sourceLabel;
  const offlineText = region ? "离线 · " + regionNames[region] : mapInfo?.zoom >= 9 ? "离线坐标网 · 此处无街图" : "离线地形与区划";
  const tileIssue = streetProblems[tileReason];
  const networkText = online ? ({
    loading: "正在加载街道", ready: "在线街道", partial: "部分街图未加载", failed: "街图未加载 · " + offlineText,
  }[tileStatus]) : offlineText;
  function choosePlace(place) {
    setManualPick(false); setPreview(place);
    if (place) locate(place);
  }
  function zoomBy(delta) {
    viewMode.current = "manual";
    setScope((old) => old === "all" ? old : "manual");
    mapRef.current?.setZoom(mapRef.current.getZoom() + delta);
  }
  return <div className="trip-map-shell" data-view={detail ? "leg" : "overview"} data-scope={scope} data-leg-index={detail ? activeLegIndex : undefined}>
    {!detail && <TripPlaceSearch key={searchProvider || "offline"} trip={trip} provider={searchProvider} near={near} preview={preview} locked={locked} picking={choosing} searchRequest={searchRequest}
      onPick={() => { if (picking) onCancelPick(); else setManualPick(!manualPick); setPreview(null); }}
      onLocate={locate} onChoose={(place) => { if (picking) { locate(place); onPick(place.point, place); setPreview(null); } else choosePlace(place); }}
      onPreview={choosePlace}/>}
    <div className="trip-map-bar">
      <div className="trip-map-scopes" role="group" aria-label="地图范围">
        <button type="button" aria-pressed={scope === "china"} onClick={() => changeScope("china")}>全国</button>
        {!!extent.length && <button type="button" aria-pressed={scope === "day"} aria-label={detail ? "显示整个选中路段" : "显示当日全部站点"} onClick={() => changeScope("day")}>{detail ? "本段" : "当日"}</button>}
        {!detail && otherDays.some((d) => d.stops.some((s) => VALID_POINT(s.point)) || VALID_POINT(d.lodgingPoint)) && <button type="button" aria-pressed={scope === "all"} onClick={() => changeScope("all")}>全程</button>}
      </div>
      {trip?.tile && (onEnableStreetMap || onToggleStreetMap) && <div className="trip-map-layers" role="group" aria-label="地图图层">
        <button type="button" aria-pressed={!online} aria-label={online ? "关闭街道底图" : "离线地形"} title="浏览本地地形与行政区划"
          onClick={() => { if (online) onToggleStreetMap?.(false); }}>地形</button>
        <button type="button" aria-pressed={Boolean(online)} aria-label="开启全国街道" title="从 OpenStreetMap 加载当前视野的街道，不需要 Key"
          onClick={() => { if (!online) (onEnableStreetMap || onToggleStreetMap)(true); }}>街道</button>
      </div>}
      <div className="trip-map-zoom" role="group" aria-label="地图缩放">
        <button type="button" disabled={mapInfo?.zoom <= 1} onClick={() => zoomBy(-1)} aria-label="缩小路线地图">−</button>
        <button type="button" disabled={mapInfo?.zoom >= 18} onClick={() => zoomBy(1)} aria-label="放大路线地图">+</button>
      </div>
    </div>
    {clusterList && <section className="trip-map-cluster-list" aria-label="相邻行程地点">
      <header><strong>{clusterList.length} 个相邻地点</strong><button type="button" aria-label="关闭相邻地点" onClick={() => setClusterList(null)}>×</button></header>
      <div>{clusterList.map(({ label, point, marker }, index) => <button key={index} type="button" onClick={() => {
        viewMode.current = "manual";
        focusPlace(mapRef.current, { point, zoom: 16 });
        if (mapRef.current?.hasLayer(marker)) { marker.fire("click"); marker.openTooltip(); }
        setClusterList(null);
      }}>{label}</button>)}</div>
    </section>}
    <div className="trip-map-viewport">
      <div className="trip-map" data-picking={choosing || undefined} ref={host} aria-label={detail ? drawings[0].letters + " 路段地图" : "可缩放的旅行路线地图"} />
      {choosing && <span className="trip-map-crosshair" aria-hidden="true"/>}
    </div>
    <div className="trip-map-readout" data-network={online ? tileStatus : "offline"} data-tile-issue={online ? tileReason : undefined}>
      <span className="trip-map-network">{networkText}</span>
      {online && tileIssue && <small>{tileIssue}</small>}
      {online && ["partial", "failed"].includes(tileStatus) && <button type="button"
        disabled={retryAt > cooled && retryAt > Date.now()} onClick={() => setRetry((value) => value + 1)}>重试街图</button>}
      {choosing && <b>点击选点，或在地图按 Enter 选取中心</b>}
    </div>
    {mapInfo && <div className="trip-map-position"><span>{mapInfo.place || "地图中心"}</span><output aria-label="地图中心坐标">{mapInfo.point.map((v) => v.toFixed(4)).join(", ")}</output></div>}
    {!detail && preview && <div className="trip-place-preview">
      <div>{preview.manual ? <label>站点名称<input className="mw-input" value={preview.name} maxLength={120} placeholder="给选中的位置命名" onChange={(event) => setPreview({ ...preview, name: event.target.value })}/></label>
        : <strong>{preview.name}</strong>}
        <small>{tripPlaceDetails(preview) || preview.point.map((n) => n.toFixed(5)).join(", ")}</small></div>
      {!locked && <button type="button" className="mw-btn mw-btn-primary" disabled={!preview.name.trim()} onClick={() => {
        if (picking) onPick(preview.point, preview);
        else onAdd(preview);
        setPreview(null);
      }}>{picking ? "使用此坐标" : "加入当日行程"}</button>}
      {!locked && !picking && onSetLodging && <button type="button" className="mw-btn" disabled={!preview.name.trim()} onClick={() => {
        onSetLodging(preview);
        setPreview(null);
      }}>设为住宿</button>}
      <button type="button" className="mw-btn-ghost" aria-label="关闭地点预览" onClick={() => setPreview(null)}>×</button>
    </div>}
    <div className="trip-map-attribution">
      {(drawings.length > 0 || detail) && <span>{scope === "all" ? "跨日站点" : caption}</span>}
      <span>Natural Earth · CTAmap（Cheng 等，CC BY 4.0）</span>
      {region ? <><a href="https://openfreemap.org/" target="_blank" rel="noreferrer" onClick={external}>OpenFreeMap</a><a href="https://openmaptiles.org/" target="_blank" rel="noreferrer" onClick={external}>© OpenMapTiles</a></> : null}
      <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" onClick={external}>© OpenStreetMap contributors</a>
      {transit && route?.legs.some((leg) => leg?.estimated && leg.steps.some((step) => step.type === "bus")) && <span>公交线网 CPTOND-2025（Wang 等，CC BY 4.0）</span>}
      <a href="https://www.openstreetmap.org/fixthemap" target="_blank" rel="noreferrer" onClick={external}>地图纠错</a>
    </div>
  </div>;
}
