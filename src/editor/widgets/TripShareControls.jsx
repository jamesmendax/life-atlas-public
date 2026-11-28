import { useEffect, useMemo, useRef, useState } from "react";
import { dateForDay } from "./trip-data/itineraryState.js";
import { VALID_POINT } from "../../domain/tripRoutes.js";
import AmapImportCode from "./AmapImportCode.jsx";
import { buildTripShare } from "./trip-data/routeShare.js";

function copyInFrame(text) {
  const focus = document.activeElement;
  const selection = window.getSelection();
  const ranges = Array.from({ length: selection?.rangeCount ?? 0 }, (_, i) => selection.getRangeAt(i).cloneRange());
  const input = document.createElement("textarea");
  input.style.cssText = "position:fixed;top:0;left:-10000px";
  input.value = text;
  document.body.append(input);
  try {
    input.focus({ preventScroll: true });
    input.select();
    return document.execCommand("copy");
  } catch { return false; }
  finally {
    input.remove();
    focus?.focus?.({ preventScroll: true });
    selection?.removeAllRanges();
    for (const range of ranges) selection.addRange(range);
  }
}

function placeBinding(value) {
  const location = value?.location;
  if (typeof value?.poiId !== "string" || !value.poiId.trim() || value.poiId.length > 128 || !Array.isArray(location) || location.length !== 2 || !VALID_POINT([location[1], location[0]])) return undefined;
  return { poiId: value.poiId.trim(), location: [location[0], location[1]] };
}

function exportPlan(data) {
  return {
    ...(typeof data.title === "string" && data.title.trim() && { title: data.title.trim() }),
    date: data.date,
    days: data.days.map(day => {
      const lodgingAmap = day.lodging && placeBinding(day.lodgingAmap);
      return {
        day: day.day, title: day.title, date: dateForDay(data, day),
        stops: day.stops.map(stop => {
          const amap = placeBinding(stop.amap);
          return { name: stop.name, time: stop.time,
            ...(Number.isFinite(stop.dwellMinutes) && { dwellMinutes: stop.dwellMinutes }), ...(amap && { amap }) };
        }),
        lodging: day.lodging || "", ...(lodgingAmap && { lodgingAmap }),
      };
    }),
  };
}

export function TripPlanImport({ data, dayNumber, trip, configured }) {
  const plan = useMemo(() => exportPlan(data), [data]);
  const identity = useMemo(() => JSON.stringify([plan, dayNumber, configured, Boolean(trip?.personalMap),
    data.days.map(day => day.stops.map(stop => [stop.id, stop.point, stop.done])),
  ]), [data, plan, dayNumber, configured, trip?.personalMap]);
  return <details className="trip-plan-import">
    <summary>导入高德 App</summary>
    <PlanImportBody key={identity} plan={plan} configured={configured} trip={trip}/>
  </details>;
}

function PlanImportBody({ plan, configured, trip }) {
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState("");
  const [message, setMessage] = useState("");
  const request = useRef(0);
  const input = useRef(null);
  useEffect(() => () => { request.current++; }, []);
  const stops = plan.days.reduce((n, day) => n + day.stops.length, 0);
  const nights = plan.days.filter(day => day.lodging).length;
  const freeDays = plan.days.filter(day => !day.stops.length && !day.lodging);
  const missing = plan.days.map(day => ({
    day: day.day,
    names: [...day.stops.filter(stop => !stop.amap).map(stop => stop.name),
      ...(day.lodging && !day.lodgingAmap ? ["住宿 · " + day.lodging] : [])],
  })).filter(day => day.names.length);
  const supported = Boolean(trip?.personalMap);
  const ready = supported && configured === true && (stops > 0 || nights > 0) && !missing.length;
  async function generate() {
    if (!ready || busy) return;
    const id = ++request.current;
    setBusy(true); setMessage(""); setUrl("");
    try {
      const result = await trip.personalMap({ plan });
      if (request.current !== id) return;
      if (result?.ok && typeof result.value?.url === "string" && result.value.url) setUrl(result.value.url);
      else setMessage(result?.error?.message || "高德未返回整趟行程链接。");
    } catch { if (request.current === id) setMessage("高德服务暂不可用，请稍后重试。"); }
    finally { if (request.current === id) setBusy(false); }
  }
  async function copy() {
    const id = request.current;
    try {
      const copied = trip?.copy ? (await trip.copy({ text: url }))?.ok : copyInFrame(url);
      if (request.current !== id) return;
      if (copied) { setMessage("已复制链接，可发送到手机并在高德 App 中打开。"); return; }
    } catch { if (request.current !== id) return; }
    input.current?.focus({ preventScroll: true }); input.current?.select();
    setMessage("请复制已选中的链接，发送到手机后打开。");
  }
  return <div className="trip-import-body">
      <strong>高德专属地图 · 整趟 {plan.days.length} 天 · {stops} 个目的地 · {nights} 晚住宿</strong>
      {!url && freeDays.length > 0 && stops + nights > 0 && <p>{freeDays.map(day => "第 " + day.day + " 天").join("、")}尚无目的地或住宿，导入时将作为自由日记在相邻日期的路线说明中。</p>}
      {!supported || configured !== true ? <>
        <p>{!supported ? "这个版本只能预览导入范围。生成整趟专属地图需要支持此功能的桌面版和高德 Web 服务 Key。" : configured === false
          ? "本机未配置高德 Web 服务 Key，无法生成整趟 App 行程链接。" : "尚未取得本机高德服务的配置状态。"}</p>
        <p>在桌面版「设置 → 地图服务」接入高德后，可一次生成整趟旅行的专属地图，用手机扫码打开。</p>
      </> : !stops && !nights ? <p>先添加目的地或当晚住宿，再生成整趟行程链接。</p> : missing.length ? <>
        <p>请用高德地点搜索结果绑定以下目的地或住宿。</p>
        <ul className="trip-import-missing">{missing.map(day => <li key={day.day}>第 {day.day} 天：{day.names.join("、")}</li>)}</ul>
      </> : !url && <>
        <p>将各天的日期、地点、计划到达时间、停留和住宿发送给高德。生成的链接可在手机高德 App 中打开。</p>
        <button type="button" className="mw-btn" disabled={busy} onClick={generate}>{busy ? "正在生成…" : "生成整趟行程链接"}</button>
      </>}
      {url && <div className="trip-import-result"><AmapImportCode url={url}/><label>高德返回的行程链接<input ref={input} className="mw-input" readOnly value={url} onFocus={event => event.target.select()}/></label>
        <button type="button" className="mw-btn" onClick={copy}>复制到手机</button></div>}
      {message && <small role="status">{message}</small>}
    </div>;
}

export default function TripShareControls({ day, mode, date, trip }) {
  const [message, setMessage] = useState("");
  const [manual, setManual] = useState(null);
  const share = (provider) => buildTripShare({ day, mode, date, provider });
  const amap = share("amap");
  const primary = amap.shareLinks[0];
  const otherLinks = amap.links.filter((link) => link.url !== primary?.url);
  async function copy(text, title, success) {
    setManual(null);
    if (trip?.copy) {
      try {
        if ((await trip.copy({ text }))?.ok) { setMessage(success); return; }
      } catch { /* Native clipboard unavailable. Show the selectable trip below. */ }
    } else if (copyInFrame(text)) { setMessage(success); return; }
    setManual({ title, content: text });
    setMessage("请复制下方已选中的内容");
  }
  function copyMap() {
    if (amap.shareLinks.length === 1) {
      return copy(primary.url, "高德地图链接", "已复制高德链接，可发给同行人");
    }
    const text = amap.shareLinks.map((link) => link.label + "\n" + link.url).join("\n");
    return copy(text, "分组高德链接", "已按站点顺序复制 " + amap.shareLinks.length + " 个高德链接");
  }
  async function exportFile() {
    const file = amap.file;
    if (!file) return;
    setManual(null);
    if (trip?.exportKml) {
      try {
        const result = await trip.exportKml({ filename: file.filename, content: file.content });
        if (result?.ok) { setMessage(result.value?.cancelled || result.value?.canceled ? "已取消导出" : "KML 已导出"); return; }
        setMessage(result?.error?.message || "无法导出 KML");
      } catch { setMessage("无法导出 KML"); }
    } else {
      setManual({ title: file.filename, content: file.content });
      setMessage("复制下方内容并以 .kml 扩展名保存，即可导入高德");
    }
  }
  function mapLink(link, primaryLink = false) {
    return <a key={link.url} className={primaryLink ? "trip-primary-map" : undefined} href={link.url} target="_blank" rel="noreferrer"
      onClick={async (event) => {
        if (!trip?.open) return;
        event.preventDefault();
        try {
          const open = link.url.startsWith("https://www.amap.com/ssr/embed/dir?") && trip.map ? trip.map : trip.open;
          const result = await open({ url: link.url });
          if (!result?.ok) setMessage(result?.error?.message || "地图链接未打开");
        } catch { setMessage("地图链接未打开"); }
      }}>{link.label} ↗</a>;
  }
  if (!day.stops.length) return null;
  return <div className="trip-share">
    <div className="trip-share-actions">
      {primary && <button type="button" className="mw-btn" onClick={copyMap}>复制高德链接</button>}
      {primary && mapLink(primary, true)}
      <details className="trip-share-more"><summary>更多地图与导出</summary>
        <div className="trip-share-menu">
          <button type="button" className="mw-btn" onClick={() => copy(amap.plan, "行程文字", "已复制站点、停留和住宿")}>复制行程文字</button>
          {otherLinks.length > 0 && <details><summary>其他高德链接</summary>{otherLinks.map((link) => mapLink(link))}</details>}
          {[["apple", "Apple 地图"], ["google", "Google 地图"]].map(([provider, label]) => {
            const links = share(provider).links;
            return links.length > 0 && <details key={provider}><summary>{label}</summary>{links.map((link) => mapLink(link))}</details>;
          })}
          {amap.file && <button type="button" className="mw-btn" onClick={exportFile}>导出高德可导入的 KML</button>}
          {amap.file && mapLink({label:"在高德网页导入 KML", url:"https://www.amap.com/ssr/track-import"})}
          {amap.hint && <small>{amap.hint}</small>}
        </div>
      </details>
    </div>
    {message && <small role="status">{message}</small>}
    {manual && <label className="trip-share-manual">{manual.title}<textarea readOnly value={manual.content} ref={(el) => { if (el) { el.focus({ preventScroll: true }); el.select(); } }} /></label>}
  </div>;
}
