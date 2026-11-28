import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import land from "../assets/ne_110m_land.json";
import { normalizeViewConfig } from "../domain/viewRegistry.js";
import { mapProjection } from "../domain/viewProjections.js";
import { formatPropertyValue } from "../domain/databaseProperties.js";
import { DATABASE_MAP_LAYERS, displayLatitude, mapLayer, mapViewport, recordBounds, storeMapViewport } from "../domain/databaseMapViewport.js";
import { attachDatabaseTiles } from "./databaseMapTiles.js";
import { DatabaseMapSearch } from "./DatabaseMapSearch.jsx";
import { currentDeviceLocation } from "./databaseMapLocation.js";

const emptyTiles = { ready: 0, failed: 0, loading: 0, noCoverage: 0 };
const locationMessage = {
  requesting: "正在请求设备位置…",
  denied: "定位权限未授予。可在 Windows 的隐私与安全性设置中检查位置服务。",
  timeout: "定位超时。请重试或手动浏览地图。",
  unavailable: "当前无法取得设备位置。请检查设备位置服务或手动浏览地图。",
  located: "已在地图显示设备位置。",
};
const leafletPoint = place => [displayLatitude(place.latitude), place.longitude];
function fitRecords(map, records) {
  const bounds = recordBounds(records);
  if (!bounds) map.setView([16, 0], 2, { animate: false });
  else if (bounds[0][0] === bounds[1][0] && bounds[0][1] === bounds[1][1]) map.setView(bounds[0], Math.min(15, map.getMaxZoom()), { animate: false });
  else map.fitBounds(bounds, { padding: [34, 34], maxZoom: Math.min(16, map.getMaxZoom()), animate: false });
}
function dataCredit(layer, zoom) {
  if (layer === "street") return { title: "© OpenStreetMap contributors", href: "https://www.openstreetmap.org/copyright" };
  if (layer === "satellite" && zoom < 8) return { title: "NASA Blue Marble / NASA GIBS · 全球卫星概览", href: "https://earthobservatory.nasa.gov/features/BlueMarble" };
  if (layer === "satellite") return { title: "© ESA WorldCover project 2021 · Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium", href: "https://esa-worldcover.org/en" };
  return { title: "Natural Earth · 1:110m 离线陆地轮廓", href: "https://www.naturalearthdata.com/" };
}
function tileMessage(layer, zoom, counts, hasTileService) {
  if (layer === "offline") return "离线世界概览 · 仅显示陆地轮廓和本地记录";
  if (!hasTileService) return "当前环境无在线底图服务，已显示离线轮廓";
  if (counts.failed && !counts.ready && !counts.loading) return counts.noCoverage === counts.failed
    ? "此区域暂无该图层覆盖，已显示离线轮廓" : "当前底图未能载入，已显示离线轮廓";
  if (counts.failed) return "部分底图未载入，缺少区域显示离线轮廓";
  if (!counts.ready) return "正在加载" + DATABASE_MAP_LAYERS[layer].label + "底图…";
  return layer === "satellite" ? (zoom < 8 ? "全球卫星概览 · 约 500 米" : "2021 年真彩色合成影像 · 约 10 米") : "街道地图";
}

export function DatabaseMap(props) {
  return <DatabaseMapSurface key={props.view.id} {...props}/>;
}

function DatabaseMapSurface({ workspace, source, view, items, runtime, onUpdateView, onOpenItemPage, onUpdateItemValue }) {
  const config = useMemo(() => normalizeViewConfig("map", view.config).map, [view.config]);
  const projection = useMemo(() => mapProjection(workspace, source, items, config), [workspace, source, items, config]);
  const { located, unlocated, placeProperty, relatedPlaceProperty } = projection;
  const [layer, setLayer] = useState(() => mapLayer(config.layer));
  const [zoom, setZoom] = useState(() => mapViewport(config)?.zoom || 2);
  const [selected, setSelected] = useState(null), [picking, setPicking] = useState(null), [draft, setDraft] = useState(null);
  const [map, setMap] = useState(null), [visible, setVisible] = useState(false);
  const [devicePosition, setDevicePosition] = useState(null), [locationStatus, setLocationStatus] = useState(null);
  const activeLocation = useRef(null);
  const [counts, setCounts] = useState(emptyTiles), [retry, setRetry] = useState(0);
  const host = useRef(null), markers = useRef(new Map()), state = useRef(null), activeLayer = useRef(layer);
  const sync = useRef(false), autoFit = useRef(!mapViewport(config)), previousRequest = useRef("");
  const api = window.lifeAtlas?.databaseMap;
  const hasTileService = typeof api?.tile === "function";
  const effectiveLayer = hasTileService ? layer : "offline";
  const maxZoom = DATABASE_MAP_LAYERS[effectiveLayer].maxZoom;
  const pages = useMemo(() => new Map((workspace.pages || []).map(page => [page.id, page])), [workspace.pages]);
  const readOnly = Boolean(runtime?.locked || pages.get(source.ownerPageId)?.settings?.locked);
  const chosen = located.find(entry => entry.item.id === selected);
  const target = unlocated.find(entry => entry.item.id === picking);
  const mayLocate = entry => Boolean(placeProperty && onUpdateItemValue && !readOnly && !pages.get(entry.item.pageId)?.settings?.locked);
  const recordKey = JSON.stringify(located.map(({ item, place, label }) => [item.id, place.latitude, place.longitude, label]));
  const configKey = JSON.stringify([config.center, config.tileZoom, config.zoom, config.layer]);
  state.current = { view, config, located, readOnly, onUpdateView, onOpenItemPage, target, mayLocate, effectiveLayer };

  function persist(instance) {
    const current = state.current;
    const viewport = { ...storeMapViewport(instance.getCenter(), instance.getZoom()), layer: activeLayer.current };
    const key = JSON.stringify([viewport.center, viewport.tileZoom, viewport.zoom, viewport.layer]);
    if (sync.current || current.readOnly || previousRequest.current === key) return;
    previousRequest.current = key;
    current.onUpdateView?.(current.view.id, { config: { ...current.view.config, map: { ...current.config, ...viewport } } });
  }
  function changeLayer(next) {
    if (!map || layer === next) return;
    activeLayer.current = next; setLayer(next); setCounts(emptyTiles);
    map.setMaxZoom(DATABASE_MAP_LAYERS[hasTileService ? next : "offline"].maxZoom);
    persist(map);
  }
  function locatePoint(point, remember = true) {
    if (!map || !Array.isArray(point) || !point.every(Number.isFinite)) return;
    autoFit.current = false;
    const wasSyncing = sync.current;
    if (!remember) sync.current = true;
    try { map.setView([displayLatitude(point[0]), point[1]], Math.min(map.getMaxZoom(), 16), { animate: false }); }
    finally { sync.current = wasSyncing; }
  }
  async function locateDevice() {
    if (!map || activeLocation.current) return;
    const request = Symbol();
    activeLocation.current = request;
    setDevicePosition(null);
    setLocationStatus("requesting");
    const result = await currentDeviceLocation(navigator.geolocation, api);
    if (activeLocation.current !== request) return;
    activeLocation.current = null;
    setLocationStatus(result.status);
    if (result.status === "located") {
      setDevicePosition(result.point);
      locatePoint(result.point, false);
    }
  }
  useEffect(() => () => { activeLocation.current = null; }, []);
  function newPoint(latlng) {
    const { target, mayLocate } = state.current;
    if (!target || !mayLocate(target)) return;
    const { lat, lng } = latlng.wrap();
    setDraft({ latitude: Number(lat.toFixed(6)), longitude: Number(lng.toFixed(6)) });
  }
  function cancelPick() { setPicking(null); setDraft(null); }
  useEffect(() => {
    if (picking && (!target || !mayLocate(target))) cancelPick();
  }, [picking, target?.item.id, readOnly, placeProperty?.id, target && pages.get(target.item.pageId)?.settings?.locked]);
  useEffect(() => {
    const element = host.current, init = state.current;
    const inline = Boolean(element.closest(".database-view.is-inline"));
    const instance = L.map(element, { attributionControl: false, zoomControl: false, minZoom: 1,
      maxZoom: DATABASE_MAP_LAYERS[init.effectiveLayer].maxZoom, scrollWheelZoom: !inline, keyboard: true,
      zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false, worldCopyJump: true });
    const focusMap = () => { if (inline) instance.scrollWheelZoom.enable(); };
    const leaveMap = (event) => { if (inline && !element.contains(event.relatedTarget)) instance.scrollWheelZoom.disable(); };
    element.addEventListener("focusin", focusMap); element.addEventListener("focusout", leaveMap);
    L.DomEvent.disableClickPropagation(element);
    instance.createPane("db-local-land").classList.add("db-geo-land-pane");
    const renderer = L.svg({ pane: "db-local-land", padding: 0.2 }).addTo(instance);
    L.geoJSON(land, { renderer, interactive: false, className: "db-geo-land" }).addTo(instance);
    const saved = mapViewport(init.config);
    if (saved) instance.setView([saved.center[1],saved.center[0]], Math.min(saved.zoom, instance.getMaxZoom()), { animate: false });
    else fitRecords(instance, init.located);
    setZoom(instance.getZoom());
    instance.on("movestart", () => { if (!sync.current) autoFit.current = false; });
    instance.on("moveend", () => { setZoom(instance.getZoom()); if (!sync.current) persist(instance); });
    instance.on("click", event => newPoint(event.latlng));
    const resize = new ResizeObserver(() => {
      sync.current = true;
      instance.invalidateSize({ pan: false });
      if (autoFit.current) fitRecords(instance, state.current.located);
      sync.current = false;
    });
    resize.observe(element);
    const observer = new IntersectionObserver(entries => setVisible(Boolean(entries.at(-1)?.isIntersecting)));
    observer.observe(element);
    setMap(instance);
    return () => { observer.disconnect(); resize.disconnect(); element.removeEventListener("focusin", focusMap); element.removeEventListener("focusout", leaveMap); instance.remove(); };
  }, []);

  // Changes from another occurrence, undo or reload may target this same view.
  useEffect(() => {
    if (!map || previousRequest.current === configKey) return;
    const next = mapLayer(config.layer), saved = mapViewport(config);
    sync.current = true;
    activeLayer.current = next; setLayer(next);
    map.setMaxZoom(DATABASE_MAP_LAYERS[hasTileService ? next : "offline"].maxZoom);
    if (saved) {
      autoFit.current = false;
      map.setView([saved.center[1], saved.center[0]], Math.min(saved.zoom, map.getMaxZoom()), { animate: false });
    } else if (!readOnly) {
      autoFit.current = true; fitRecords(map, state.current.located);
    }
    setZoom(map.getZoom());
    sync.current = false;
  }, [map, configKey]);

  useEffect(() => {
    setCounts(emptyTiles);
    if (!map || !visible || layer === "offline" || !hasTileService) return;
    return attachDatabaseTiles(map, api, layer, setCounts);
  }, [map, visible, api, layer, retry]);

  useEffect(() => {
    if (!map) return;
    const overlay = L.layerGroup().addTo(map), pins = new Map();
    const relocateMarkers = () => {
      const middle = map.getCenter().lng;
      for (const { marker, point } of pins.values()) marker.setLatLng([point[0], point[1] + 360 * Math.round((middle - point[1]) / 360)]);
    };
    for (const { item, place, label } of state.current.located) {
      const point = leafletPoint(place);
      const text = document.createElement("span"); text.textContent = label;
      const marker = L.marker(point, { icon: L.divIcon({ className: "db-geo-marker", iconSize: [22, 22], iconAnchor: [11, 11] }), title: label,
        keyboard: true, autoPanOnFocus: false }).bindTooltip(text, { direction: "top", offset: [0, -12] }).addTo(overlay);
      const element = marker.getElement();
      element.dataset.mapMarker = item.id; element.setAttribute("role", "button");
      const activate = () => {
        if (state.current.target) { newPoint(marker.getLatLng()); return; }
        setSelected(item.id);
        state.current.onOpenItemPage?.(item.pageId, element);
      };
      marker.on("click", activate);
      element.addEventListener("keydown", event => {
        if (event.key === " " || event.key === "Enter") { event.preventDefault(); event.stopPropagation(); activate(); }
      });
      pins.set(item.id, { marker, point, label });
    }
    markers.current = pins;
    if (autoFit.current) {
      sync.current = true; fitRecords(map, state.current.located); sync.current = false;
    }
    relocateMarkers();
    map.on("moveend", relocateMarkers);
    return () => { map.off("moveend", relocateMarkers); overlay.remove(); };
  }, [map, recordKey]);
  useEffect(() => {
    for (const [id, { marker, label }] of markers.current) {
      marker.getElement()?.classList.toggle("is-selected", id === selected);
      marker.getElement()?.setAttribute("aria-label", (target ? "选择标记位置 " : "打开记录 ") + label);
      if (id === selected) marker.openTooltip();
      else marker.closeTooltip();
    }
  }, [map, selected, target, recordKey]);
  useEffect(() => {
    if (!draft || !map || !target) return;
    const pin = L.circleMarker([draft.latitude, draft.longitude], { radius: 9, className: "db-geo-proposal", interactive: false }).addTo(map);
    return () => { pin.remove(); };
  }, [map, draft, target?.item.id]);
  useEffect(() => {
    if (!devicePosition || !map) return;
    const [lat, lng] = devicePosition;
    const wrap = () => lng + 360 * Math.round((map.getCenter().lng - lng) / 360);
    const pin = L.circleMarker([displayLatitude(lat), wrap()], { radius: 7, interactive: false, className: "db-geo-device-location" })
      .bindTooltip("设备位置", { permanent: true, direction: "top", offset: [0, -6] }).addTo(map);
    const relocate = () => pin.setLatLng([displayLatitude(lat), wrap()]);
    map.on("moveend", relocate);
    return () => { map.off("moveend", relocate); pin.remove(); };
  }, [map, devicePosition]);

  const credit = dataCredit(effectiveLayer, zoom);
  const status = tileMessage(layer, zoom, counts, hasTileService);
  return <section className="db-map-surface db-geo-surface" aria-label="数据库地点地图" data-map-layer={layer} data-map-zoom={zoom}>
    <div className="db-map-toolbar db-geo-toolbar">
      <DatabaseMapSearch onLocate={({ point }) => locatePoint(point)} offlineLayer={layer === "offline"}/>
      <span>{located.length} 个标记 · {unlocated.length} 条未定位</span>
      <div className="db-geo-layers" role="group" aria-label="地图图层">{["street", "satellite", "offline"].map(id =>
        <button type="button" key={id} aria-pressed={layer === id} onClick={() => changeLayer(id)}>{DATABASE_MAP_LAYERS[id].label}</button>)}</div>
    </div>
    <div className="db-geo-frame">
      <div ref={host} className="db-offline-map db-geographic-canvas" role="region" tabIndex={0} aria-label="地点地图；方向键平移，加减键缩放" data-picking={Boolean(target) || undefined}/>
      <div className="db-geo-controls" role="group" aria-label="地图视野">
        <button type="button" disabled={!map || locationStatus === "requesting"} onClick={locateDevice}>我的位置</button>
        <button type="button" aria-label="地图放大" disabled={!map || zoom >= maxZoom} onClick={() => map.zoomIn()}>＋</button>
        <button type="button" aria-label="地图缩小" disabled={!map || zoom <= 1} onClick={() => map.zoomOut()}>−</button>
        <button type="button" disabled={!map || !located.length} onClick={() => { sync.current = true; fitRecords(map, located); sync.current = false; autoFit.current = true; persist(map); }}>适配记录</button>
        <button type="button" disabled={!map} onClick={() => { autoFit.current = false; map.setView([0,0],1,{animate:false}); persist(map); }}>重置地图</button>
      </div>
    </div>
    <div className="db-geo-map-meta">
      <span role="status" data-tile-ready={counts.ready} data-tile-failed={counts.failed}>{status} · 第 {zoom} 级</span>
      {(counts.failed > 0 && layer !== "offline") && <button type="button" onClick={() => setRetry(n => n + 1)}>重试底图</button>}
      <a className="db-map-attribution" href={credit.href} target="_blank" rel="noreferrer" onClick={event => {
        if (window.lifeAtlas?.app?.openExternal) { event.preventDefault(); void window.lifeAtlas.app.openExternal({ url: credit.href }); }
      }}>{credit.title}</a>
    </div>
    {locationStatus && <p className="db-geo-location-status" role="status">{locationMessage[locationStatus]}</p>}
    {target && <div className="db-geo-pick" role="group" aria-label="选择记录坐标">
      <strong>为「{target.label}」地图选点</strong><span>{draft ? draft.latitude + ", " + draft.longitude : "点击地图选择位置，或移动地图后使用中心点。"}</span>
      <button type="button" onClick={() => map && newPoint(map.getCenter())}>使用地图中心</button>
      <button type="button" disabled={!draft} onClick={() => {
        if (!draft || !mayLocate(target)) return;
        onUpdateItemValue(target.item.id, placeProperty.id, { ...target.place, ...draft });
        setSelected(target.item.id); cancelPick();
      }}>保存位置</button><button type="button" onClick={cancelPick}>取消选点</button>
    </div>}
    {!placeProperty && !relatedPlaceProperty && <div className="db-geo-empty"><span>添加地点属性后可在地图上标记记录。</span>{!readOnly && runtime?.addDatabaseProperty && <button type="button" onClick={() => runtime.addDatabaseProperty(source.id, "place", { name: "地点" })}>添加地点属性</button>}</div>}
    {chosen && <div className="db-map-selection" role="status"><strong>{chosen.label}</strong><span>{formatPropertyValue(workspace, chosen.placeProperty, chosen.place)}</span><button type="button" onClick={event => onOpenItemPage?.(chosen.item.pageId, event.currentTarget)}>打开记录</button></div>}
    <div className="db-map-location-list" aria-label="地点记录列表">
      {items.length === 0 && <p className="db-geo-empty">当前视图没有记录，仍可浏览地图。</p>}
      {[...located, ...unlocated].map(entry => {
        const { item, place, label } = entry;
        const mapped = Number.isFinite(place?.latitude) && Number.isFinite(place?.longitude) && Math.abs(place.latitude) <= 90 && Math.abs(place.longitude) <= 180;
        const text = place && entry.placeProperty ? formatPropertyValue(workspace, entry.placeProperty, place) : "";
        return <div key={item.id}><button type="button" onClick={event => onOpenItemPage?.(item.pageId, event.currentTarget)}>{label}</button>
          <span>{mapped ? text : [text, "未定位"].filter(Boolean).join(" · ")}</span>
          {mapped ? <button type="button" aria-label={"居中到 " + label} onClick={() => { setSelected(item.id); locatePoint(leafletPoint(place)); }}>定位</button>
            : mayLocate(entry) && <button type="button" aria-label={"地图选点 " + label} onClick={() => { setPicking(item.id); setDraft(null); host.current?.focus({ preventScroll: true }); }}>地图选点</button>}
        </div>;
      })}
    </div>
  </section>;
}
