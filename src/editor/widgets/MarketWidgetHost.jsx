import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { frameAddress, parseState, serializeState, WIDGET_CHANNEL } from "../../domain/marketFrameProtocol.js";
import { blockContext } from "../../domain/blockDocument.js";
import { createFrameAudio } from "../MarketFrameAudio.js";
import { downloadBlob } from "../../domain/pageExport.js";
import { safeExportFileName } from "../../domain/pageActions.js";
import { checkedTripEmbed } from "../../domain/tripEmbed.js";

const mapPaths = {
  "www.google.com": ["/maps/dir/", "/maps/search/"], "maps.apple.com": ["/directions", "/search", "/place"],
  "uri.amap.com": ["/navigation", "/marker", "/search"], "www.amap.com": ["/ssr/embed/dir", "/ssr/track-import"], "www.openstreetmap.org": ["/copyright", "/fixthemap"],
  "openfreemap.org": ["/"], "openmaptiles.org": ["/"],
};
const mapParameters = {
  "www.google.com": ["api", "origin", "destination", "travelmode", "waypoints", "query"],
  "maps.apple.com": ["source", "destination", "mode", "waypoint", "coordinate", "name", "query"],
  "uri.amap.com": ["from", "to", "via", "mode", "src", "position", "name", "coordinate", "markers", "callnative", "keyword"],
  "www.amap.com": ["from", "to", "via", "type", "policy", "platform", "src", "ride_type"],
};
function mapUrl(value) {
  if (typeof value !== "string" || value.length > 3200) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.port || url.username || url.password || url.hash
      || !Object.hasOwn(mapPaths, url.hostname) || !mapPaths[url.hostname].includes(url.pathname)) return null;
    const allowed = mapParameters[url.hostname] || [];
    return [...url.searchParams.keys()].every((key) => allowed.includes(key)) ? url.href : null;
  } catch { return null; }
}

function validTripKml(content) {
  if (typeof content !== "string" || !content.length || content.length > 500000 || /<!DOCTYPE/i.test(content)) return false;
  const xml = new DOMParser().parseFromString(content, "application/xml");
  const namespace = "http://www.opengis.net/kml/2.2";
  if (xml.documentElement.localName !== "kml" || xml.documentElement.namespaceURI !== namespace) return false;
  const names = new Set(["kml", "Document", "Folder", "name", "description", "Placemark", "Point", "coordinates",
    "LineString", "MultiGeometry", "tessellate", "altitudeMode", "TimeStamp", "when", "TimeSpan", "begin", "end",
    "ExtendedData", "Data", "value", "Style", "LineStyle", "color", "width", "styleUrl"]);
  return [...xml.getElementsByTagName("*")].every((node) => node.namespaceURI === namespace && names.has(node.localName)
    && (node.localName !== "styleUrl" || /^#[\w.-]+$/.test(node.textContent)));
}

function WidgetFrame({ resolution, title, read, write, editable, alarmScope, state, locked = false, compact = false, preview = false, onPreviewEscape }) {
  const frame = useRef(null);
  const publish = useRef(null);
  const latest = useRef(null);
  const [height, setHeight] = useState(180);
  const [error, setError] = useState("");
  const [mapSurface, setMapSurface] = useState(null);
  latest.current = { read, write, editable, locked, compact, onPreviewEscape };
  const src = frameAddress(resolution?.frameUrl);
  const heightMessage = resolution?.intrinsicHeight ? "content-height" : "height";
  const allowed = Array.isArray(resolution?.capabilities) ? resolution.capabilities.join(",") : "";
  useLayoutEffect(() => {
    if (!src) return;
    const element = frame.current;
    const capabilities = new Set(allowed.split(",").filter(Boolean));
    let active = true, revision = 0, previous;
    const inflight = new Set();
    function send(type, body) {
      if (active) element.contentWindow?.postMessage({ channel: WIDGET_CHANNEL, type, ...body }, "*");
    }
    const audio = capabilities.has("widget-audio") ? createFrameAudio({
      read: () => latest.current.read(), editable: () => latest.current.editable(), preview,
      notify: (type) => send(type, {}), alarmScope,
    }) : null;
    function sync() {
      const current = latest.current.read();
      if (current !== previous) { previous = current; revision++; if (current) audio?.acceptFromEditor(current); }
      return current;
    }
    function context(ack) {
      const current = sync();
      send("context", { state: parseState(current), revision, locked: !latest.current.editable(),
        compact: latest.current.compact, demonstration: preview, capabilities: [...capabilities],
        tripPlanner: capabilities.has("trip-routing") && Boolean(window.lifeAtlas?.trip?.search),
        tripEmbed: capabilities.has("trip-routing"),
        tripOffline: capabilities.has("trip-routing") && Boolean(window.lifeAtlas?.trip?.offlineStatus),
        tripAmapSdk: capabilities.has("trip-routing") && Boolean(window.lifeAtlas?.trip?.sdkStatus),
        tripSettings: capabilities.has("trip-routing") && Boolean(window.lifeAtlas?.trip?.setProvider),
        viewportHeight: window.innerHeight, theme: document.documentElement.dataset.theme === "dark" ? "dark" : "light", ack });
    }
    async function request(method, args) {
      if (audio && method.startsWith("audio.")) return { ok: true, value: await audio.call(method, args) };
      if (!capabilities.has("trip-routing")) throw new Error("此组件未获得地图权限。");
      const trip = window.lifeAtlas?.trip;
      if (method === "trip.tile" && trip?.tile) return trip.tile({ frameUrl: src, x: args.x, y: args.y, z: args.z });
      if (method === "trip.offlineStatus" && trip?.offlineStatus) return trip.offlineStatus({ frameUrl: src, points: args.points });
      if (method === "trip.offlineDownload" && trip?.offlineDownload && navigator.userActivation?.isActive) {
        return trip.offlineDownload({ frameUrl: src, points: args.points });
      }
      if (method === "trip.sdkStatus" && trip?.sdkStatus) return trip.sdkStatus();
      if (method === "trip.sdkOpen" && trip?.sdkOpen && navigator.userActivation?.isActive) {
        return trip.sdkOpen({ frameUrl: src, sections: args.sections });
      }
      if (method === "trip.route" && trip?.route) {
        if (args.kind === "highway-nearby") {
          if (!navigator.userActivation?.isActive) throw new Error("请点击地图中的公路途经点查询按钮。");
          return trip.route({ frameUrl: src, kind: args.kind, ref: args.ref, point: args.point });
        }
        return trip.route({ frameUrl: src, mode: args.mode, points: args.points, places: args.places, highwayRef: args.highwayRef, provider: args.provider });
      }
      if (method === "trip.status" && trip?.status) return trip.status();
      if (method === "trip.openSettings" && trip?.setProvider && navigator.userActivation?.isActive) {
        window.dispatchEvent(new Event("lifeatlas-open-map-settings"));
        return { ok: true };
      }
      if (method === "trip.search" && trip?.search && navigator.userActivation?.isActive) {
        return trip.search({ frameUrl: src, query: args.query, region: args.region, cityLimit: args.cityLimit, types: args.types,
          limit: args.limit, requestId: args.requestId, provider: args.provider, userInitiated: args.userInitiated === true });
      }
      if (method === "trip.transit" && trip?.transit) return trip.transit({ frameUrl: src, points: args.points, citycodes: args.citycodes,
        places: args.places, date: args.date, time: args.time, requestId: args.requestId });
      if (method === "trip.cancel" && trip?.cancel) return trip.cancel({ frameUrl: src, requestId: args.requestId });
      if (method === "trip.map" && trip?.map && navigator.userActivation?.isActive) {
        const url = mapUrl(args.url);
        if (url) return trip.map({ frameUrl: src, url });
      }
      if (method === "trip.personalMap" && trip?.personalMap && navigator.userActivation?.isActive) {
        const itinerary = Object.hasOwn(args, "plan") ? { plan: args.plan } : { day: args.day, date: args.date };
        return trip.personalMap({ frameUrl: src, ...itinerary });
      }
      if (method === "trip.copy" && navigator.userActivation?.isActive && typeof args.text === "string" && args.text.length > 0 && args.text.length <= 64000) {
        await navigator.clipboard.writeText(args.text);
        return { ok: true };
      }
      if (method === "trip.exportKml" && navigator.userActivation?.isActive && validTripKml(args.content)) {
        const name = safeExportFileName(String(args.filename || "旅行行程").replace(/\.kml$/i, "")) + ".kml";
        const saved = await downloadBlob(new Blob([args.content], { type: "application/vnd.google-earth.kml+xml" }), name);
        return saved ? { ok: true, value: { saved: true } } : { ok: false, error: { code: "E_CANCELLED", message: "已取消保存" } };
      }
      if (method === "trip.open") {
        const url = mapUrl(args.url);
        if (url && navigator.userActivation?.isActive && window.lifeAtlas?.app?.openExternal) return window.lifeAtlas.app.openExternal({ url });
      }
      throw new Error("仅支持此组件获准的地图操作。");
    }
    function receive(event) {
      if (event.source !== element.contentWindow || event.origin !== "null" || event.data?.channel !== WIDGET_CHANNEL) return;
      const message = event.data;
      if (message.type === "trip-embed" && capabilities.has("trip-routing")) {
        const rect = message.surface?.rect;
        const url = checkedTripEmbed(message.surface?.url);
        if (!url || !rect || ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)
          || rect.width < 1 || rect.height < 1 || rect.width > 8192 || rect.height > 3200) setMapSurface(null);
        else setMapSurface({ src, url, x: rect.x, y: rect.y, width: rect.width, height: rect.height, hidden: rect.hidden === true });
        return;
      }
      if (message.type === "preview-escape") {
        if (preview && element.ownerDocument.activeElement === element) latest.current.onPreviewEscape?.();
        return;
      }
      if (message.type === "ready") { context(); return; }
      if (message.type === heightMessage && Number.isFinite(message.height)) {
        setHeight(Math.min(3200, Math.max(72, Math.ceil(message.height)))); return;
      }
      if (!Number.isSafeInteger(message.id) || message.id < 1) return;
      if (message.type === "commit") {
        try {
          const before = sync();
          if (before === null || !latest.current.editable() || message.base !== revision) {
            context({ id: message.id, accepted: false }); return;
          }
          const next = serializeState(message.state);
          audio?.checkWrite(next);
          const accepted = before === next || latest.current.write(before, next);
          setError("");
          context({ id: message.id, accepted: Boolean(accepted) });
        } catch (failure) { setError(failure.message); context({ id: message.id, accepted: false }); }
      }
      if (message.type !== "request" || typeof message.method !== "string" || inflight.has(message.id)) return;
      if (inflight.size >= 48) { send("reply", { id: message.id, result: { ok: false, error: { message: "请稍后重试。" } } }); return; }
      inflight.add(message.id);
      void request(message.method, message.args || {}).then(
        (result) => send("reply", { id: message.id, result }),
        (failure) => send("reply", { id: message.id, result: { ok: false, error: { message: failure.message } } }),
      ).finally(() => inflight.delete(message.id));
    }
    publish.current = context;
    window.addEventListener("message", receive);
    const updateEnvironment = () => context();
    const providerChanged = () => { if (capabilities.has("trip-routing")) send("trip-provider-changed", {}); };
    window.addEventListener("lifeatlas-map-provider-changed", providerChanged);
    window.addEventListener("resize", updateEnvironment);
    const theme = new MutationObserver(updateEnvironment);
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => { active = false; publish.current = null; window.removeEventListener("message", receive); window.removeEventListener("resize", updateEnvironment); window.removeEventListener("lifeatlas-map-provider-changed", providerChanged); theme.disconnect(); audio?.dispose(); };
  }, [src, allowed, heightMessage, preview, alarmScope.key]);
  useEffect(() => { publish.current?.(); }, [state, locked, compact]);
  if (!src) return <p className="market-component-status" role="status">无法打开组件，请重新选择软件包。</p>;
  return <div className="market-widget-frame" style={{ position: "relative", overflow: "clip", isolation: "isolate" }}
    contentEditable={false} onMouseDown={(e) => e.stopPropagation()} onDragStart={(e) => e.preventDefault()}>
    <iframe ref={frame} src={src} sandbox="allow-scripts" allow="autoplay" title={title || "互动组件"}
      onLoad={() => publish.current?.()} style={{ display: "block", width: "100%", height, border: 0, background: "transparent" }} />
    {mapSurface?.src === src && <iframe title="高德官方互动地图" src={mapSurface.url} sandbox="allow-scripts allow-same-origin"
      referrerPolicy="strict-origin-when-cross-origin" allow="geolocation 'none'; camera 'none'; microphone 'none'; clipboard-read 'none'; clipboard-write 'none'"
      style={{ position: "absolute", left: mapSurface.x, top: mapSurface.y, width: mapSurface.width, height: mapSurface.height, border: 0,
        visibility: mapSurface.hidden ? "hidden" : "visible" }} />}
    {error && <p className="market-component-status" role="alert">{error}</p>}
  </div>;
}

export function PersistentMarketWidget({ resolution, block, editor, locked, runtime }) {
  const { id, props: { url, state, title } } = block;
  function current() {
    const item = editor.getBlock(id);
    return item?.type === "marketComponent" && item.props.url === url ? item : null;
  }
  const editable = () => !locked && editor.isEditable && Boolean(current());
  const { pageId, getWorkspace } = runtime;
  const alarmScope = { key: pageId + "/" + id + "/" + url, packageUrl: url, readSaved() {
    const page = getWorkspace?.()?.pages?.find((item) => item.id === pageId && !item.trashedAt);
    const saved = page && blockContext(page.content, id)?.block;
    return saved?.type === "marketComponent" && saved.props.url === url ? saved.props.state || "{}" : null;
  } };
  function write(before, next) {
    const item = current();
    if (!item || !editable() || (item.props.state || "{}") !== before) return false;
    editor.updateBlock(id, { props: { ...item.props, state: next } });
    return true;
  }
  return <WidgetFrame resolution={resolution} title={title} state={state} locked={locked} alarmScope={alarmScope}
    read={() => { const item = current(); return item ? item.props.state || "{}" : null; }} write={write} editable={editable} />;
}

function PreviewFrame({ resolution, title, compact, onPreviewEscape }) {
  const local = useRef("{}");
  const alarmScope = useRef(null);
  if (!alarmScope.current) alarmScope.current = { key: Symbol(), readSaved: () => local.current };
  return <WidgetFrame resolution={resolution} title={title || "组件试玩"} compact={compact} preview onPreviewEscape={onPreviewEscape} alarmScope={alarmScope.current}
    read={() => local.current} editable={() => true}
    write={(before, next) => { if (local.current !== before) return false; local.current = next; return true; }} />;
}

export function MarketWidgetSandbox({ resolution, title, compact = false, onPreviewEscape }) {
  return <PreviewFrame key={resolution?.frameUrl} resolution={resolution} title={title} compact={compact} onPreviewEscape={onPreviewEscape} />;
}
