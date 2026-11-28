import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ROUTE_GEOMETRY_VERSION, TRIP_MODES, VALID_POINT, roadEndpointGaps, routeKey, usableRoute } from "../../domain/tripRoutes.js";
import { serializeState } from "../../domain/marketFrameProtocol.js";
import { dateForDay, legSchedule, normalizeTrip, parseInputPoint, tripStopLetter } from "./trip-data/itineraryState.js";
import { isChengduSample } from "./trip-data/chengduTransit.js";
import { amapEmbeddedRoute, amapLink, coveredByAmap } from "./trip-data/amapLinks.js";
import { amapViewportUrl } from "./trip-data/amapViewport.js";
import { tripPlaceDetails, withTravelEntrance } from "./trip-data/placeChoices.js";
import TripOfficialMapSurface from "./TripOfficialMapSurface.jsx";
import TripPlaceSearch from "./TripPlaceSearch.jsx";
import "../../ui/themes/mobai/trip-plan-map.css";
import { useTripTransit } from "./useTripTransit.js";
import TripShareControls, { TripPlanImport } from "./TripShareControls.jsx";
import TripHighwayTools from "./TripHighwayTools.jsx";
import TripStopPlaceInput from "./TripStopPlaceInput.jsx";
import TripOfflineControls from "./TripOfflineControls.jsx";
import sampleRoutes from "./trip-data/example-routes.json";

const TripRouteMap = lazy(() => import("./TripRouteMap.jsx"));
const distanceLabel = (meters) => meters < 1000 ? meters + " 米" : (meters / 1000).toFixed(1) + " 公里";
function timeLabel(seconds) {
  const minutes = Math.max(seconds ? 1 : 0, Math.round(seconds / 60));
  const hours = Math.floor(minutes / 60);
  return "约 " + (hours ? hours + " 小时" + (minutes % 60 ? " " + minutes % 60 + " 分钟" : "") : minutes + " 分钟");
}
const briefing = ({ meters, seconds }) => [
  meters == null ? "距离待查" : distanceLabel(meters),
  seconds == null ? "耗时待查" : timeLabel(seconds),
].join(" · ");

function TransitSteps({ steps }) {
  return <ol className="trip-transit-steps" aria-label="公交地铁乘车步骤">{steps.map((step, index) => {
    const ride = step.type === "bus" || step.type === "metro" || step.type === "rail";
    const title = step.type === "wait" ? "候车" : step.type === "transfer" ? "站内换乘" :
      step.type === "walk" ? (step.transfer ? "换乘步行" : "步行") : step.name || "乘车";
    return <li key={index} data-type={step.type}>
      <div className="trip-step-heading"><strong>{title}</strong><small>{step.seconds == null ? "耗时未提供" : timeLabel(step.seconds)}</small></div>
      <div>{[step.from && step.from + (ride ? "上车" : ""), step.to && step.to !== step.from && step.to + (ride ? "下车" : "")].filter(Boolean).join(" → ")}
        {step.towards && <span>（往{step.towards}）</span>}
        {step.type === "walk" && step.meters != null && <span> · {distanceLabel(step.meters)}</span>}
      </div>
      {(step.departureTime || step.arrivalTime) && <div>{[step.departureTime && step.departureTime + " 发车", step.arrivalTime && step.arrivalTime + " 到站"].filter(Boolean).join(" · ")}</div>}
    </li>;
  })}</ol>;
}

export function TripItineraryWidget({ state: rawState, onChange, locked = false, demonstration = false, api }) {
  const data = useMemo(() => normalizeTrip(rawState, demonstration), [rawState, demonstration]);
  const [view, setView] = useState({});
  const [selected, setSelected] = useState("");
  const [activeLeg, setActiveLeg] = useState(null);
  const listRef = useRef(null);
  const mapColumnRef = useRef(null);
  const planScroll = useRef(0);
  const returnLeg = useRef(null);
  const stopToReveal = useRef("");
  const [form, setForm] = useState(null);
  const [picking, setPicking] = useState(false);
  const [mapLayer, setMapLayer] = useState(null);
  const [mapPreview, setMapPreview] = useState(null);
  const [connected, setConnected] = useState(() => navigator.onLine);
  useEffect(() => {
    const changed = () => setConnected(navigator.onLine);
    window.addEventListener("offline", changed);
    window.addEventListener("online", changed);
    return () => { window.removeEventListener("offline", changed); window.removeEventListener("online", changed); };
  }, []);
  const offline = mapLayer === "offline" || !connected;
  const [focusRequest, setFocusRequest] = useState(null);
  const [searchRequest, setSearchRequest] = useState(null);
  const [mapCenter, setMapCenter] = useState(null);
  const [locatingId, setLocatingId] = useState("");
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [roadFailure, setRoadFailure] = useState("");
  const [alternateRoad, setAlternateRoad] = useState("");
  const [offlineAvailable, setOfflineAvailable] = useState(false);
  const [formError, setFormError] = useState("");
  const [readingCache, setReadingCache] = useState({});
  const [service, setService] = useState(undefined);
  const statusRef = useRef();
  statusRef.current = api?.trip?.status;
  const sdkStatusRef = useRef();
  sdkStatusRef.current = api?.trip?.sdkStatus;
  const canCheckSdk = Boolean(sdkStatusRef.current);
  const canCheckService = Boolean(statusRef.current);
  useEffect(() => {
    let active = true, revision = 0;
    const refresh = async () => {
      const current = ++revision;
      try {
        const [result, sdk] = await Promise.allSettled([statusRef.current?.(), sdkStatusRef.current?.()]);
        if (active && current === revision) {
          const providers = result.value?.ok ? result.value.value : null;
          setService({ ...providers, sdkConfigured: sdk.value?.ok && Boolean(sdk.value.value.configured) });
        }
      } catch { if (active && current === revision) setService(null); }
    };
    void refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener("lifeatlas-map-provider-changed", refresh);
    return () => { active = false; window.removeEventListener("focus", refresh); window.removeEventListener("lifeatlas-map-provider-changed", refresh); };
  }, [canCheckService, canCheckSdk]);
  const stopPlaceRef = useRef(null);
  const stopFormCurrent = useRef(null);
  const requestId = useRef(0);
  const latest = useRef(null);
  const currentDay = data.days.find((d) => d.day === (locked ? view.activeDay ?? data.activeDay : data.activeDay)) || data.days[0];
  stopFormCurrent.current = { form, day: currentDay.day };
  const mode = (locked ? view.mode : null) ?? data.mode;
  const modeInfo = TRIP_MODES.find((item) => item.id === mode);
  const stops = currentDay.stops;
  const nextDay = stops.length ? data.days.slice(data.days.indexOf(currentDay) + 1).find(day => day.stops.length) : null;
  const travelStops = useMemo(() => nextDay ? [...stops, nextDay.stops[0]] : stops, [stops, nextDay]);
  const selectedLeg = Number.isInteger(activeLeg) && activeLeg >= 0 && activeLeg < travelStops.length - 1 ? activeLeg : null;
  const crossing = selectedLeg !== null && selectedLeg === stops.length - 1;
  const mapStart = selectedLeg === null ? null : travelStops[selectedLeg], mapEnd = mapStart && travelStops[selectedLeg + 1];
  const legLabel = crossing ? "第 " + currentDay.day + " 天末站 → 第 " + nextDay.day + " 天首站" : tripStopLetter(selectedLeg) + " → " + tripStopLetter(selectedLeg + 1);
  const segmentMap = mapStart && mapEnd && (api?.trip?.map ? amapEmbeddedRoute(mode, mapStart, mapEnd) : null);
  const segmentExternal = mapStart && mapEnd && amapLink(mode, mapStart, mapEnd);
  const points = stops.map((s) => s.point);
  const key = routeKey(mode, points);
  const geometryId = JSON.stringify([currentDay.day, travelStops.map(stop => stop.point)]);
  const highwayRef = mode === "drive" ? currentDay.highwayRef || "" : "";
  const overviewUrl = useMemo(() => amapViewportUrl(stops, focusRequest), [stops, focusRequest]);
  const officialUrl = selectedLeg === null ? overviewUrl : segmentMap?.url;
  const hasOfficial = Boolean(officialUrl && api?.trip?.embedMap);
  const layer = offline ? "offline" : mapLayer === "amap" && hasOfficial && !picking ? "amap" : "network";
  const saved = currentDay.routes?.[key] ?? readingCache[key];
  const example = demonstration || isChengduSample(stops) ? sampleRoutes[key] : null;
  const savedDayRoad = useMemo(() => saved?.geometryVersion === ROUTE_GEOMETRY_VERSION && usableRoute(saved, stops.length) ? saved
    : demonstration && usableRoute(example, stops.length) ? example : null, [saved, example, stops.length, demonstration]);
  const roadRoute = useMemo(() => {
    const legs = travelStops.slice(1).map((to, i) => {
      let segment = routeKey(mode, [travelStops[i].point, to.point]);
      if (highwayRef) segment += "|" + highwayRef;
      const fresh = readingCache[segment] ?? currentDay.routes?.[segment];
      return fresh?.geometryVersion === ROUTE_GEOMETRY_VERSION && usableRoute(fresh, 2)
        ? { ...fresh.legs[0], source: fresh.source || fresh.legs[0].source, requestKey: fresh.requestKey, highwayVerified: fresh.highwayVerified }
        : highwayRef ? null : savedDayRoad?.legs[i] ?? null;
    });
    return legs.some(Boolean) ? { at: savedDayRoad?.at, legs } : null;
  }, [mode, travelStops, currentDay.routes, readingCache, savedDayRoad, highwayRef]);
  const date = dateForDay(data, currentDay);
  const transitDay = useMemo(() => crossing ? { ...currentDay, stops: travelStops } : currentDay, [crossing, currentDay, travelStops]);
  const transit = useTripTransit({ day: transitDay, mode, date, trip: api?.trip });
  const route = mode === "transit" ? transit.route : roadRoute;
  const isExample = savedDayRoad && savedDayRoad === example && !currentDay.routes && !Object.keys(readingCache).length;
  const sourceLabel = mode === "transit" ? (transit.onlineCount ? "高德公交规划" : route ? "成都离线公交地铁" : "暂无公交轨迹") : route
    ? (isExample ? "示例道路快照" : "已保存的道路路线") + " · " + modeInfo.label
    : "尚未取得道路轨迹";
  const nativeRoute = api?.trip?.route;
  const segmentKey = mapStart && mapEnd && routeKey(mode, [mapStart.point, mapEnd.point]);
  const segmentCacheKey = segmentKey && (highwayRef ? segmentKey + "|" + highwayRef : segmentKey);
  const prefersAmap = service?.configured && coveredByAmap(mapStart?.point) && coveredByAmap(mapEnd?.point);
  const roadProvider = offline ? "offline" : prefersAmap && alternateRoad !== segmentCacheKey ? "amap" : "osrm";
  const roadRequestKey = JSON.stringify([roadProvider, roadProvider === "amap" && [mapStart, mapEnd].map(stop => [stop?.amap?.poiId, stop?.amap?.selected])]);
  const canRequestRoad = roadProvider !== "offline" || offlineAvailable;
  latest.current = { data, onChange, locked, geometryId, day: currentDay.day, segmentCacheKey, roadRequestKey };
  const roadQueue = useRef(Promise.resolve());
  const nextRoadAt = useRef(0);
  useEffect(() => () => { requestId.current++; }, []);
  useEffect(() => {
    setRoadFailure("");
    setAlternateRoad(previous => previous === segmentCacheKey ? previous : "");
  }, [segmentCacheKey]);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    list.scrollTop = selectedLeg === null ? planScroll.current : 0;
    let focusTarget;
    if (selectedLeg !== null) {
      focusTarget = list.closest(".trip-day-column")?.querySelector(".trip-return");
    } else if (returnLeg.current !== null) {
      focusTarget = list.querySelectorAll(".trip-open-leg")[returnLeg.current];
      returnLeg.current = null;
    }
    focusTarget?.focus({ preventScroll: true });
    focusTarget?.scrollIntoView({ block: "nearest" });
  }, [selectedLeg, currentDay.day]);
  const formKey = form ? (form.id ?? "new") : "";
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list || selectedLeg !== null) return;
    const target = formKey ? list.querySelector(".trip-stop-form") :
      stopToReveal.current && Array.from(list.querySelectorAll("[data-stop-id]")).find((el) => el.dataset.stopId === stopToReveal.current)?.querySelector(".mw-stop-main");
    if (!target) return;
    const viewport = list.getBoundingClientRect(), item = target.getBoundingClientRect();
    if (item.bottom > viewport.bottom - 6) list.scrollTop += item.bottom - viewport.bottom + 6;
    if (item.top < viewport.top + 6 || item.height > viewport.height) list.scrollTop += target.getBoundingClientRect().top - viewport.top - 6;
    if (formKey) {
      target.querySelector(".trip-stop-place input")?.focus({ preventScroll: true });
      target.scrollIntoView({ block: "nearest" });
    }
    stopToReveal.current = "";
  }, [formKey, stops.length, selected]);
  function openLeg(index) {
    if (!Number.isInteger(index) || index < 0 || index >= travelStops.length - 1) return;
    if (selectedLeg === null) planScroll.current = listRef.current?.scrollTop ?? 0;
    requestId.current++; setPending(false); returnLeg.current = index;
    setMapPreview(null);
    if (mapLayer !== "offline") setMapLayer(null);
    setActiveLeg(index); setForm(null); setPicking(false); setLocatingId(""); setSearchRequest(null); setFeedback("");
  }
  function showPlan() {
    requestId.current++; setPending(false);
    if (mapLayer !== "offline") setMapLayer(null);
    setActiveLeg(null); setFeedback(""); setSelected("");
  }
  function patchDay(update) {
    if (locked) return;
    onChange?.({ ...data, days: data.days.map((day) => day.day === currentDay.day ? update(day) : day) });
  }
  function changeView(patch) {
    if (patch.mode === mode && !("activeDay" in patch)) return;
    if ("activeDay" in patch) { planScroll.current = 0; returnLeg.current = null; setActiveLeg(null); setFocusRequest(null); }
    setSelected(""); setFeedback(""); setPicking(false); setLocatingId(""); setSearchRequest(null); setForm(null); setFormError("");
    setMapPreview(null);
    requestId.current++; setPending(false);
    if (locked) setView((previous) => ({ ...previous, ...patch }));
    else onChange?.({ ...data, ...patch });
  }
  function edit(stop) {
    setForm({ id: stop?.id ?? null, name: stop?.name ?? "", time: stop?.time ?? "", dwell: stop?.dwellMinutes ?? "", place: stop?.point?.join(", ") ?? "" });
    setFormError(""); setPicking(false); setLocatingId(""); setSearchRequest(null);
  }
  function focusPlace(place) {
    if (VALID_POINT(place.point)) {
      setFocusRequest({ ...place, zoom: place.zoom || 14, id: crypto.randomUUID() });
      setMapCenter(place.point);
    }
  }
  function locateStop(stop) {
    setForm(null); setLocatingId(stop.id); setPicking(true);
    setSearchRequest({ id: crypto.randomUUID(), query: stop.name });
    setFeedback("为「" + stop.name + "」搜索地点，或直接在地图上选点。");
    mapColumnRef.current?.querySelector(".trip-search-row")?.scrollIntoView({ block: "nearest" });
  }
  function acceptPoint(point, match) {
    if (locked || !VALID_POINT(point)) return;
    if (locatingId) {
      const id = locatingId;
      patchDay(day => ({ ...day, stops: day.stops.map(stop => {
        if (stop.id !== id) return stop;
        const next = { ...stop, point };
        for (const field of ["amap", "address", "citycode", "adcode", "type", "typecode", "province", "city", "district"]) {
          if (match?.[field]) next[field] = match[field];
          else delete next[field];
        }
        return next;
      }) }));
      stopToReveal.current = id; setSelected(id); setLocatingId(""); setSearchRequest(null); setFeedback("已保存站点位置");
    } else if (form) {
      setForm(previous => previous && ({ ...previous, place: point.join(", "), match }));
      listRef.current?.querySelector(".trip-stop-form")?.scrollIntoView({ block: "nearest" });
    }
    else {
      setForm({ id: null, name: match?.name || "", time: "", dwell: "", place: point.join(", "), match });
      setFormError("");
    }
    setPicking(false);
  }
  function addPlace(place) {
    if (locked || !VALID_POINT(place.point)) return;
    const id = crypto.randomUUID();
    patchDay((day) => ({ ...day, stops: [...day.stops, {
      id, name: place.name.trim(), time: "", point: place.point, done: false, tag: "自定义",
      ...(place.citycode && { citycode: place.citycode }), ...(place.adcode && { adcode: place.adcode }),
      ...(place.address && { address: place.address }), ...(place.amap && { amap: place.amap }),
      ...(place.type && { type: place.type }), ...(place.typecode && { typecode: place.typecode }),
    }] }));
    stopToReveal.current = id; setActiveLeg(null); setSelected(id); setFeedback("已加入第 " + currentDay.day + " 天：" + place.name);
  }
  function setLodging(place) {
    if (locked || !VALID_POINT(place.point)) return;
    patchDay(day => {
      const next = { ...day, lodging: place.name, lodgingPoint: place.point };
      if (place.amap) next.lodgingAmap = place.amap;
      else delete next.lodgingAmap;
      return next;
    });
    setFeedback("已设为当晚住宿：" + place.name);
  }
  async function saveStop(event, allowUnlocated = false) {
    event.preventDefault();
    if (!form || locked) return;
    const name = form.name.trim();
    if (!name) { setFormError("请填写站点名称"); return; }
    let match = form.match;
    let point = form.place.trim() ? parseInputPoint(form.place) : null;
    if (form.place.trim() && !point) { setFormError("请输入十进制度的纬度、经度，例如 35.0037, 135.7751"); return; }
    if (!point && !allowUnlocated) {
      const savedForm = form, savedDay = currentDay.day;
      match = await stopPlaceRef.current?.resolve();
      if (stopFormCurrent.current.form !== savedForm || stopFormCurrent.current.day !== savedDay) return;
      if (!match) { setFormError("尚未定位：请选择搜索结果、填写坐标或从地图选点；也可以选择暂不定位保存。"); return; }
      point = match.point;
      focusPlace(match);
    }
    const original = stops.find((s) => s.id === form.id);
    const samePoint = point && original?.point && point[0] === original.point[0] && point[1] === original.point[1];
    const binding = match || (samePoint ? original : null);
    const dwell = form.dwell === "" ? undefined : Number(form.dwell);
    if (dwell !== undefined && (!Number.isSafeInteger(dwell) || dwell < 0)) { setFormError("停留时长请输入非负整数分钟"); return; }
    const values = { ...original, name, time: form.time, point };
    if (dwell === undefined) delete values.dwellMinutes;
    else values.dwellMinutes = dwell;
    const id = form.id ?? crypto.randomUUID();
    for (const field of ["amap", "address", "citycode", "adcode", "type", "typecode", "province", "city", "district"]) {
      if (binding?.[field]) values[field] = binding[field];
      else delete values[field];
    }
    patchDay((day) => ({ ...day, stops: form.id === null
      ? [...day.stops, { ...values, id, done: false, tag: "自定义" }]
      : day.stops.map((s) => s.id === form.id ? values : s) }));
    stopToReveal.current = id; setSelected(id); setForm(null); setPicking(false); setFormError(""); setFeedback("");
  }
  function requestRoute() {
    if (!segmentCacheKey || !nativeRoute || !canRequestRoad || mode === "transit") return;
    const id = ++requestId.current, day = currentDay.day;
    const args = { mode, points: [mapStart.point, mapEnd.point], ...(highwayRef && { highwayRef }), provider: roadProvider,
      ...(roadProvider === "amap" && { places: [mapStart.amap || null, mapEnd.amap || null] }) };
    const currentRequest = () => {
      const current = latest.current;
      return id === requestId.current && current.day === day &&
        current.segmentCacheKey === segmentCacheKey && current.roadRequestKey === roadRequestKey && current.geometryId === geometryId;
    };
    setPending(true); setFeedback(""); setRoadFailure("");
    async function calculate() {
      if (!currentRequest()) return;
      const wait = nextRoadAt.current - Date.now();
      if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
      if (!currentRequest()) return;
      if (roadProvider !== "offline") nextRoadAt.current = Date.now() + 1150;
      try {
        const result = await nativeRoute(args);
        if (!currentRequest()) return;
        if (!result?.ok || result.value?.geometryVersion !== ROUTE_GEOMETRY_VERSION || !usableRoute(result.value, 2)) {
          setFeedback(result?.error?.message || "未取得道路轨迹，可重试。");
          setRoadFailure(roadProvider);
          return;
        }
        const received = { ...result.value, requestKey: roadRequestKey }, current = latest.current;
        const next = { ...current.data, days: current.data.days.map(entry => entry.day === day
          ? { ...entry, routes: { ...entry.routes, [segmentCacheKey]: received } } : entry) };
        let keepForSession = current.locked;
        if (!keepForSession) {
          try { serializeState(next); }
          catch { keepForSession = true; }
        }
        if (keepForSession) {
          setReadingCache(previous => Object.fromEntries([...Object.entries(previous).filter(([k]) => k !== segmentCacheKey).slice(-15), [segmentCacheKey, received]]));
          setFeedback(current.locked ? "此段路线仅在本次查看期间保留。" : "路线已显示。这个组件的记录已满，此段仅在本次查看期间保留。");
        } else {
          current.onChange?.(next);
          setReadingCache(previous => {
            if (!Object.hasOwn(previous, segmentCacheKey)) return previous;
            const copy = { ...previous }; delete copy[segmentCacheKey]; return copy;
          });
          setFeedback("此段道路轨迹已存入行程，断网可以重看。");
        }
      } catch {
        if (currentRequest()) { setRoadFailure(roadProvider); setFeedback("道路服务暂不可用，请重试。"); }
      }
      finally { if (currentRequest()) setPending(false); }
    }
    roadQueue.current = roadQueue.current.then(calculate, calculate);
  }
  const leg = selectedLeg === null ? null : route?.legs[selectedLeg];
  const autoQuery = useRef(null);
  autoQuery.current = () => {
    if (mode === "transit") {
      if (!offline && service?.transitProvider === "amap" && leg?.provider !== "amap") void transit.query(selectedLeg);
    } else if (!leg || ((roadProvider === "amap" || alternateRoad === segmentCacheKey) && leg.requestKey !== roadRequestKey)) requestRoute();
  };
  useEffect(() => {
    if (!segmentCacheKey || !canRequestRoad || (canCheckService && service === undefined)) return;
    autoQuery.current();
    return () => { requestId.current++; setPending(false); };
  }, [currentDay.day, segmentCacheKey, geometryId, offline, canCheckService, service === undefined, roadRequestKey, canRequestRoad, service?.transitProvider]);
  const roadGaps = useMemo(() => mode !== "transit" && leg ? roadEndpointGaps(leg, mapStart?.point, mapEnd?.point) : null,
    [mode, leg, mapStart?.point, mapEnd?.point]);
  const incompleteRoad = Boolean(roadGaps && (roadGaps.startFar || roadGaps.endFar || roadGaps.breaks.length));
  const schedule = mapStart ? legSchedule(mapStart, incompleteRoad ? null : leg?.seconds) : null;
  const canPlan = mapStart && mapEnd && VALID_POINT(mapStart.point) && VALID_POINT(mapEnd.point);
  const sdkSections = !leg ? [] : mode === "transit" ? leg.steps.flatMap(step => step.sections || [])
    : leg.sections || (leg.line ? [leg.line] : []);
  async function openSdk() {
    try {
      const result = await api.trip.sdkOpen({ sections: sdkSections });
      if (!result?.ok) setFeedback(result?.error?.message || "未能打开高德底图。");
    } catch { setFeedback("未能打开高德底图。"); }
  }
  function useEntrance(stop) {
    const entrance = withTravelEntrance(stop);
    if (!entrance || locked) return;
    const day = stop === mapEnd && crossing ? nextDay.day : currentDay.day;
    onChange?.({ ...data, days: data.days.map(entry => entry.day !== day ? entry : { ...entry,
      stops: entry.stops.map(item => item.id === stop.id ? { ...item, ...entrance, id: item.id } : item),
    }) });
  }
  async function openMapSettings() {
    try { if ((await api?.trip?.openSettings?.())?.ok) return; } catch {}
    setFeedback("请在桌面版「设置 → 地图服务」管理高德和离线路网。");
  }
  const stopForm = !locked && form && <form className="trip-stop-form" onSubmit={saveStop}>
      <TripStopPlaceInput key={currentDay.day + ":" + (form.id ?? "new")} ref={stopPlaceRef} name={form.name} trip={api?.trip} provider={offline ? null : service?.searchProvider} near={mapCenter}
        onName={name => { setForm(previous => previous && ({ ...previous, name })); setFormError(""); }}
        onChoose={place => { setForm(previous => previous && ({ ...previous, name: place.name, place: place.point.join(", "), match: place })); setFormError(""); focusPlace(place); }}/>
      <label>计划到达<input className="mw-input" type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })}/></label>
      <label>停留（分钟）<input className="mw-input" type="number" min="0" step="1" placeholder="未安排" value={form.dwell} onChange={(e) => setForm({ ...form, dwell: e.target.value })}/></label>
      <label>纬度，经度（WGS84）<input className="mw-input" placeholder="纬度，经度" value={form.place} onChange={(e) => setForm({ ...form, place: e.target.value, match: null })}/></label>
      <button type="button" className="mw-btn" aria-pressed={picking} onClick={() => {
        setPicking(!picking);
        if (!picking) mapColumnRef.current?.querySelector(".trip-map-shell")?.scrollIntoView({ block: "nearest" });
      }}>{picking ? "取消填写坐标" : "从地图填写坐标"}</button>
      {form.id && stops.length > 1 && <div className="trip-order-stop">{[-1, 1].map(delta => {
        const from = stops.findIndex(stop => stop.id === form.id), to = from + delta;
        return <button type="button" key={delta} className="mw-btn-ghost" disabled={to < 0 || to >= stops.length} onClick={() => patchDay(day => {
          const reordered = [...day.stops]; [reordered[from], reordered[to]] = [reordered[to], reordered[from]];
          return { ...day, stops: reordered };
        })}>{delta < 0 ? "↑ 提前一站" : "↓ 延后一站"}</button>;
      })}</div>}
      <div className="trip-stop-form-actions"><button type="submit" className="mw-btn mw-btn-primary">保存站点</button>
      <button type="button" className="mw-btn-ghost" onClick={() => { setForm(null); setFormError(""); setPicking(false); }}>取消</button>
      {formError.startsWith("尚未定位") && <button type="button" className="mw-btn-ghost" onClick={event => void saveStop(event, true)}>暂不定位保存</button>}</div>
      {formError && <small role="alert">{formError}</small>}
    </form>;

  const mapColumn = <div ref={mapColumnRef} className="trip-map-column trip-live-column" data-layer={layer}>
    <div className="trip-provider-bar" role="group" aria-label="地图来源">
      {[["amap","高德地图"],["network","行程路网"],["offline","离线"]].filter(([id]) => id !== "amap" || hasOfficial).map(([id,label]) =>
        <button type="button" key={id} aria-pressed={id === layer} disabled={id !== "offline" && !connected} onClick={() => {
          setMapLayer(id); setMapPreview(null); setPicking(false); setLocatingId(""); setSearchRequest(null);
        }}>{label}</button>)}
    </div>
    {layer === "amap" ? <div className="trip-map-shell trip-live-official">
      {selectedLeg === null && <TripPlaceSearch trip={api?.trip} provider={service?.searchProvider} near={focusRequest?.point}
        preview={mapPreview} onPreview={setMapPreview} onChoose={place => { setMapPreview(place); focusPlace(place); }}
        onLocate={place => { setMapPreview(null); focusPlace(place); }} onPick={() => { setMapLayer("network"); setPicking(true); }}
        locked={locked} picking={false}/>}
      <div className="trip-official-viewport"><TripOfficialMapSurface trip={api?.trip} url={officialUrl}/></div>
      {mapPreview && <div className="trip-place-preview"><div><strong>{mapPreview.name}</strong><small>{tripPlaceDetails(mapPreview)}</small></div>
        {!locked && <><button type="button" className="mw-btn mw-btn-primary" onClick={() => { addPlace(mapPreview); setMapPreview(null); }}>加入当日行程</button>
          <button type="button" className="mw-btn" onClick={() => { setLodging(mapPreview); setMapPreview(null); }}>设为住宿</button></>}
        <button type="button" className="mw-btn-ghost" aria-label="关闭地点预览" onClick={() => setMapPreview(null)}>×</button></div>}
    </div> : <Suspense fallback={<div className="trip-map-loading" role="status">正在加载行程地图…</div>}>
      <TripRouteMap key={currentDay.day} trip={api?.trip} searchProvider={offline ? null : service?.searchProvider} stops={crossing ? travelStops : stops} allDays={data.days} mode={mode}
        focusRequest={focusRequest} searchRequest={searchRequest} onViewPoint={setMapCenter}
        route={route} transit={mode === "transit"} sourceLabel={sourceLabel} online={layer === "network"}
        picking={picking && !locked} locked={locked} onAdd={addPlace} onCancelPick={() => { setPicking(false); setLocatingId(""); setSearchRequest(null); setFeedback(""); }}
        activeLegIndex={selectedLeg} onSelectLeg={openLeg} lodging={currentDay.lodging ? { name: currentDay.lodging, point: currentDay.lodgingPoint } : null}
        onSetLodging={setLodging}
        selectedId={selected} onSelect={(id) => { stopToReveal.current = id; setSelected(id); }} onPick={acceptPoint} />
    </Suspense>}
  </div>;

  return <section className="mw-card mw-itinerary" contentEditable={false} aria-label="旅行计划" onMouseDown={(e) => e.stopPropagation()} onDragStart={(e) => e.preventDefault()}>
    <div className="trip-heading">
      <div className="trip-heading-title"><h3>{selectedLeg === null ? currentDay.title || data.title || "旅行计划" : "分段导航"}</h3>
        <span>{[selectedLeg === null ? (currentDay.title ? "旅行计划" : "") : currentDay.title, "共 " + data.days.length + " 天", [data.fromCode, data.toCode].filter(Boolean).join(" → ")].filter(Boolean).join(" · ")}</span></div>
      <div className="trip-heading-actions">
        {(api?.trip?.openSettings || api?.trip?.offlineStatus) && <div className="trip-map-actions">
          {api?.trip?.openSettings && <button type="button" className="mw-btn trip-map-settings" onClick={openMapSettings}>地图服务设置</button>}
          <TripOfflineControls trip={api?.trip} stops={selectedLeg === null ? data.days.flatMap(day => day.stops) : [mapStart, mapEnd]}
            connected={connected} onReady={setOfflineAvailable}/>
        </div>}
        {selectedLeg === null && <TripPlanImport data={data} dayNumber={currentDay.day} trip={api?.trip} configured={service?.configured}/>}
      </div>
      {data.flight && <details className="trip-ticket"><summary>登机牌</summary>
        <div className="mw-boarding-pass"><div className="mw-bp-route"><div><b className="mw-bp-code">{data.fromCode}</b><small>{data.fromCity}</small></div><div className="mw-bp-mid"><b>{data.flight}</b><span aria-hidden="true">✈</span></div><div><b className="mw-bp-code">{data.toCode}</b><small>{data.toCity}</small></div></div><div className="mw-bp-meta"><span>{data.date}</span><span>登机口 {data.gate}</span></div></div>
      </details>}
    </div>
    {selectedLeg === null && <div className="trip-plan-tools">
      <div className="mw-seg" role="group" aria-label="选择行程天数">{data.days.map((day) => <button key={day.day} type="button" aria-pressed={currentDay.day === day.day} className={currentDay.day === day.day ? "is-active" : ""} onClick={() => changeView({ activeDay: day.day })}>第 {day.day} 天</button>)}
        {!locked && <button type="button" aria-label="添加一天" onClick={() => {
          const day = Math.max(...data.days.map((entry) => entry.day)) + 1;
          changeView({ activeDay: day, days: [...data.days, { day, title: "", stops: [] }] });
        }}>＋</button>}</div>
    <TripHighwayTools key={currentDay.day} highwayRef={currentDay.highwayRef || ""} route={api?.trip?.route} center={mapCenter}
      locked={locked} onLocate={focusPlace} onAdd={addPlace} onApply={ref => {
        if (locked) return;
        onChange?.({ ...data, ...(ref && { mode: "drive" }), days: data.days.map(day => day.day === currentDay.day ? { ...day, highwayRef: ref } : day) });
        setFeedback(ref ? "当天驾车将核对 " + ref + " 的路段。" : "已切换到普通驾车规划。");
      }}/>
    {!locked && <details className="trip-plan-edit"><summary>编辑行程信息</summary>
      <form className="trip-stop-form" key={currentDay.day} onSubmit={(event) => {
        event.preventDefault();
        const values = new FormData(event.currentTarget);
        const fields = {};
        for (const key of ["date", "flight", "fromCity", "toCity", "fromCode", "toCode", "gate"]) fields[key] = String(values.get(key) || "").trim().slice(0, 80);
        const title = String(values.get("title") || "").trim().slice(0, 100);
        const lodging = String(values.get("lodging") || "").trim().slice(0, 100);
        onChange?.({ ...data, ...fields, days: data.days.map((day) => {
          if (day.day !== currentDay.day) return day;
          const next = { ...day, title, lodging };
          if (lodging !== day.lodging) { delete next.lodgingPoint; delete next.lodgingAmap; }
          return next;
        }) });
        event.currentTarget.closest("details").open = false;
      }}>
        {[["title", "当日标题", currentDay.title], ["lodging", "当晚住宿", currentDay.lodging], ["date", "出发日期", data.date], ["flight", "航班号", data.flight],
          ["fromCity", "出发城市", data.fromCity], ["toCity", "到达城市", data.toCity], ["fromCode", "出发机场代码", data.fromCode],
          ["toCode", "到达机场代码", data.toCode], ["gate", "登机口", data.gate]].map(([name, label, value]) =>
          <label key={name}>{label}<input name={name} className="mw-input" type={name === "date" ? "date" : "text"} maxLength={100} defaultValue={value}/></label>)}
        <button type="submit" className="mw-btn">保存行程信息</button>
      </form></details>}
    </div>}
    <div className="trip-workspace">
    {mapColumn}
    <section className="trip-day-column" aria-label={selectedLeg === null ? "当日目的地" : "单段路线详情"} data-screen={selectedLeg === null ? "plan" : "leg"}>
    {selectedLeg === null ? <header className="trip-plan-overview">
      <div className="trip-plan-headline">
        <div><h4>当日目的地</h4><span>{date || "日期未安排"} · {stops.length} 站</span></div>
        {!locked && <button type="button" className="mw-btn trip-add" onClick={() => edit(null)}>＋ 添加站点</button>}
      </div>
      {currentDay.lodging && <div className="trip-lodging"><small>当晚住宿</small><strong>{currentDay.lodging}</strong></div>}
    </header> : <header className="trip-leg-overview">
      <button type="button" className="trip-return" onClick={showPlan}>‹ 返回旅行计划</button>
      <h4>{legLabel} 路线</h4>
      <dl className="trip-leg-endpoints">
        <div><dt>起点</dt><dd>{mapStart.name}</dd></div>
        <div><dt>终点</dt><dd>{mapEnd.name}</dd></div>
      </dl>
      <div className="mw-seg" role="group" aria-label="出行方式">{TRIP_MODES.map((item) => <button key={item.id} type="button" aria-pressed={mode === item.id} className={mode === item.id ? "is-active" : ""} onClick={() => changeView({ mode: item.id })}>{item.label}</button>)}</div>
    </header>}
    <div className="trip-timeline-scroll" ref={listRef} role="region" aria-label={selectedLeg === null ? "当日站点列表" : "分段路线步骤"} tabIndex={0} onKeyDown={(event) => {
      if (event.target !== event.currentTarget || event.altKey || event.metaKey || event.ctrlKey) return;
      const list = event.currentTarget;
      const offsets = { Home: -list.scrollHeight, End: list.scrollHeight, PageDown: list.clientHeight, PageUp: -list.clientHeight, ArrowDown: 42, ArrowUp: -42 };
      if (Object.hasOwn(offsets, event.key)) { event.preventDefault(); event.stopPropagation(); list.scrollTop += offsets[event.key]; }
    }}>
    {selectedLeg === null ? <>
    <ol className="mw-timeline">{stops.map((stop, index) => <li key={stop.id} data-stop-id={stop.id} data-selected={selected === stop.id || undefined} className={"mw-stop" + (stop.done ? " is-done" : "")}>
      <button type="button" className="mw-stop-check" disabled={locked} aria-label={"标记 " + stop.name} aria-pressed={stop.done} onClick={() => patchDay((day) => ({ ...day, stops: day.stops.map((s) => s.id === stop.id ? { ...s, done: !s.done } : s) }))}>{tripStopLetter(index)}</button>
      <div className="mw-stop-body"><div className="mw-stop-main">
        <div className="trip-stop-identity">
          <button type="button" className="trip-stop-title" disabled={!stop.point && locked} onClick={() => {
            if (stop.point) { setSelected(stop.id); focusPlace(stop); }
            else locateStop(stop);
          }}>{stop.name}</button>
          <div className="mw-stop-time">
            <span>计划到达 {stop.time || "未安排"}</span>
            <span>停留 {Number.isFinite(stop.dwellMinutes) ? stop.dwellMinutes + " 分钟" : "未安排"}</span>
            {!stop.point && <span>待定位</span>}
          </div>
        </div>
        {!locked && <div className="trip-stop-actions">{!stop.point && <button type="button" className="trip-locate-result" aria-label={"定位 " + stop.name} onClick={() => locateStop(stop)}>定位</button>}
          <button type="button" className="mw-btn-ghost" aria-label={"编辑 " + stop.name} onClick={() => edit(stop)}>编辑</button>
          <button type="button" className="mw-btn-ghost" aria-label={"移除 " + stop.name} onClick={() => patchDay((day) => ({ ...day, stops: day.stops.filter((s) => s.id !== stop.id) }))}>×</button></div>}
      </div>{form?.id === stop.id && stopForm}
      {index < stops.length - 1 && <button type="button" className="trip-open-leg" aria-label={tripStopLetter(index) + " → " + tripStopLetter(index + 1) + " 路线 ›"} onClick={() => openLeg(index)}>
        <span>{tripStopLetter(index)} → {tripStopLetter(index + 1)} 路线 ›</span>
        {route?.legs[index] && <small>{briefing(route.legs[index])}</small>}
      </button>}
      {nextDay && index === stops.length - 1 && <button type="button" className="trip-open-leg" onClick={() => openLeg(index)}>到第 {nextDay.day} 天首站 · {nextDay.stops[0].name} ›</button>}
      </div></li>)}</ol>
      {!stops.length && !form && <div className="trip-empty"><h5>今天去哪里？</h5><p>{locked ? "这一天还没有目的地。" : "搜索目的地或在地图上选点，加入当天行程。"}</p></div>}
      {form && form.id === null && stopForm}
    </> : <div className="trip-route-info" data-mode={mode}>
      <strong>{leg ? briefing(leg) : pending || transit.busy ? "正在计算路线…" : "尚未取得路线"}</strong>
      <div className="trip-leg-schedule" aria-label="此段出发与预计抵达"><span>计划出发 <b>{schedule?.departure || "未确定"}</b></span><span aria-hidden="true">→</span><span>预计抵达 <b>{incompleteRoad ? "未计算" : schedule?.arrival || "待估算"}</b></span></div>
      {mode === "transit" ? <>
        <small>{leg?.provider === "amap" ? "高德公交规划 · 预计耗时" : leg ? "成都离线线网 · 估算，含候车及换乘" : "暂无此段公交方案"}</small>
        {transit.alternatives?.[selectedLeg]?.length > 1 && <label>换乘方案
          <select className="mw-input" value={transit.selected(selectedLeg)} onChange={event => transit.select(selectedLeg, Number(event.target.value))}>
            {transit.alternatives[selectedLeg].map((option, index) => <option key={index} value={index}>方案 {index + 1} · {briefing(option)}</option>)}
          </select></label>}
        {leg && <TransitSteps steps={leg.steps}/>}
        {service?.transitProvider === "amap" && api?.trip?.transit
          ? <button type="button" className="mw-btn" disabled={!canPlan || transit.busy || offline} onClick={() => transit.query(selectedLeg)}>{transit.busy && transit.busyIndex === selectedLeg ? "正在查询公交…" : "查询高德公交"}</button>
          : <small>{service?.transitProvider === "offline" ? "未配置高德 Web 服务 Key，当前使用离线规划。" : "高德公交联网规划未启用"}</small>}
        {transit.failureByLeg?.[selectedLeg] && <small role="status">{transit.failureByLeg[selectedLeg]}</small>}
      </> : <>
        <small>{leg ? (leg.source || sourceLabel) + " · 规划耗时" + (incompleteRoad ? "，不含接驳" : "") : !canPlan ? "请先为起点和终点定位。" : pending
          ? "正在按道路和通行方向规划。" : offline && !offlineAvailable ? "请先在「离线路网」中准备本段数据。" : "可以查询两个站点之间的道路。"}</small>
        {roadGaps?.startFar && <small>行程起点「{mapStart.name}」距道路起点直线约 {distanceLabel(Math.round(roadGaps.startMeters))}。接驳未计算。</small>}
        {roadGaps?.endFar && <small>道路终点距目的地「{mapEnd.name}」直线约 {distanceLabel(Math.round(roadGaps.endMeters))}。接驳未计算。</small>}
        {Boolean(roadGaps?.breaks.length) && <small>道路轨迹中有不连续的路段。连接距离与耗时未计算。</small>}
        {!locked && roadGaps?.startFar && withTravelEntrance(mapStart) && <button type="button" className="mw-btn" onClick={() => useEntrance(mapStart)}>改用起点入口</button>}
        {!locked && roadGaps?.endFar && withTravelEntrance(mapEnd) && <button type="button" className="mw-btn" onClick={() => useEntrance(mapEnd)}>改用目的地入口</button>}
        {highwayRef && <div className="trip-road-coverage"><b>{highwayRef}</b><span>{leg?.highwayVerified === false ? "普通驾车路线，未核实经过 " + highwayRef :
          leg && Number.isFinite(leg.highwayMeters) ? "已核实 " + distanceLabel(leg.highwayMeters) + " · 占本段 " + Math.round(leg.highwayCoverage * 100) + "%" : "根据道路编号核对经过的路段"}</span></div>}
        {leg?.highwaySections?.length > 0 && <div className="trip-road-key" aria-label="路线图例">
          <span><i className="trip-key-matched" aria-hidden="true"/>{highwayRef} 路段</span>
          {leg.highwayMeters < leg.meters && <span><i className="trip-key-connector" aria-hidden="true"/>其余驾车路段</span>}
        </div>}
        {nativeRoute && canRequestRoad && <button type="button" className="mw-btn" disabled={!canPlan || pending} onClick={requestRoute}>
          {pending ? "正在算路…" : offline ? "用离线路网计算" : leg ? "更新道路路线" : "重试路线查询"}</button>}
        {!offline && roadFailure === "amap" && roadProvider === "amap" && <button type="button" className="mw-btn"
          onClick={() => setAlternateRoad(segmentCacheKey)}>改用 OpenStreetMap 算路</button>}
        {layer === "amap" && <small>高德网页显示此段起终点。「行程路网」显示已计算的道路轨迹。</small>}
      </>}
      {connected && service?.sdkConfigured && api?.trip?.sdkOpen && sdkSections.length > 0 &&
        <button type="button" className="mw-btn" onClick={openSdk}>在高德底图上查看此段</button>}
    </div>}
    </div>
    <footer className="trip-panel-footer">
      {feedback && <small className="trip-status" role="status">{feedback}</small>}
      {selectedLeg === null ? <TripShareControls key={[currentDay.day, mode, date, key].join("|")} day={currentDay} mode={mode} date={date} trip={api?.trip}/>
      : (segmentMap || segmentExternal) && <a className="trip-primary-map" href={(segmentMap || segmentExternal).url} target="_blank" rel="noreferrer" onClick={async (event) => {
        const open = segmentMap ? api?.trip?.map : api?.trip?.open;
        if (!open) return;
        event.preventDefault();
        try { const result = await open({ url: (segmentMap || segmentExternal).url }); if (!result?.ok) setFeedback(result?.error?.message || "未能打开高德地图"); }
        catch { setFeedback("未能打开高德地图"); }
      }}>{segmentMap || segmentExternal.label === "高德路线" ? "高德查看此段" : segmentExternal.label} ↗</a>}
    </footer>
    </section>
    </div>
  </section>;
}
