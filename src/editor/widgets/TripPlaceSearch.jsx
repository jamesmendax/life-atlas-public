import { useEffect, useMemo, useRef, useState } from "react";
import { searchTripPlaces } from "./trip-data/placeSearch.js";
import { parseInputPoint } from "./trip-data/itineraryState.js";
import { travelPlaceChoices, tripPlaceDetails, withTravelEntrance } from "./trip-data/placeChoices.js";

export default function TripPlaceSearch({ trip, provider, near, preview, onPreview, onChoose = onPreview, onLocate, onPick, picking, locked, searchRequest }) {
  const [query, setQuery] = useState("");
  const [region, setRegion] = useState("");
  const [remote, setRemote] = useState([]);
  const [status, setStatus] = useState("");
  const [attribution, setAttribution] = useState("");
  const [busy, setBusy] = useState(false);
  const request = useRef(0);
  const input = useRef(null);
  const pendingRequest = useRef(null);
  const local = useMemo(() => {
    const point = parseInputPoint(query);
    return point ? [{ id: point.join(","), name: point.join(", "), point, source: "WGS84 坐标", zoom: 15 }]
      : searchTripPlaces(query, { near, region, limit: 8 });
  }, [query, near, region]);
  const places = travelPlaceChoices(query, remote, local, 8);
  function cancel() {
    request.current++;
    const pending = pendingRequest.current;
    pendingRequest.current = null;
    if (pending?.cancel) void pending.cancel({ requestId: pending.id }).catch(() => {});
  }
  useEffect(() => () => { cancel(); }, [provider]);
  useEffect(() => {
    if (!searchRequest) return;
    cancel();
    setQuery(searchRequest.query); setRemote([]); setAttribution(""); setStatus(""); setBusy(false);
    input.current?.focus({ preventScroll: true });
  }, [searchRequest]);

  function resetSearch() {
    cancel();
    setRemote([]); setStatus(""); setAttribution(""); setBusy(false);
  }
  function change(value) {
    setQuery(value); resetSearch();
    if (preview) onPreview(null);
  }
  async function onlineSearch() {
    if (!query.trim() || !trip?.search || !provider || busy) return;
    const current = ++request.current;
    const requestId = crypto.randomUUID();
    pendingRequest.current = { id: requestId, cancel: trip.cancel };
    setBusy(true); setStatus("");
    try {
      const city = region.trim();
      const result = await trip.search({ requestId, query: query.trim(), provider, userInitiated: true, limit: 20,
        ...(city && { region: city, cityLimit: provider === "amap" }) });
      if (current !== request.current) return;
      if (result?.ok) {
        const places = result.value?.places ?? [];
        setRemote(places);
        setAttribution(result.value?.attribution || "");
        setStatus(places.length ? "" : "未找到匹配地点");
      } else setStatus(result?.error?.message || "联网搜索暂不可用，可从离线结果选择或在地图选点");
    } catch {
      if (current === request.current) setStatus("联网搜索暂不可用，可使用离线搜索或地图选点");
    } finally { if (current === request.current) { pendingRequest.current = null; setBusy(false); } }
  }
  return <div className="trip-place-search" role="search" aria-label="地图地点搜索">
    <div className="trip-search-row">
      <input ref={input} aria-label="搜索地图地点" type="search" placeholder="搜索地名、地址或经纬度" maxLength={80} value={query}
        onChange={(event) => change(event.target.value)} onKeyDown={(event) => {
          if (event.key === "Escape" && query) { event.stopPropagation(); change(""); }
          if (event.key === "Enter") {
            event.preventDefault();
            if (trip?.search && provider) void onlineSearch();
            else event.currentTarget.closest(".trip-place-search")?.querySelector(".trip-result")?.focus();
          }
        }}/>
      {!locked && <button className="mw-btn" type="button" aria-pressed={picking} onClick={() => { change(""); onPick(); }}>{picking ? "取消选点" : "地图选点"}</button>}
    </div>
    {query.trim() && <div className="trip-search-results">
      {places.flatMap(place => [place, withTravelEntrance(place)].filter(Boolean)).map((place) => <div className="trip-result-row" key={place.source + ":" + place.id}>
        <button type="button" className="trip-result" onClick={() => { change(""); onChoose(place); }}>
          <strong>{place.name}</strong><small>{tripPlaceDetails(place)}</small>
        </button>
        {onLocate && <button type="button" className="trip-locate-result" aria-label={"地图居中到 " + place.name} onClick={() => { change(""); onLocate(place); }}>查看地图</button>}
      </div>)}
      {!places.length && <small>{trip?.search && provider ? "本地索引未找到此地点，可尝试联网搜索。" :
        locked ? "本地索引未找到此地点。" : "本地索引未找到此地点，可直接在地图选点。"}</small>}
      {trip?.search && provider ? <div className="trip-place-query-tools">
        <input className="mw-input" type="text" aria-label="联网搜索城市（可选）" placeholder="全国 · 可填城市" value={region} maxLength={40}
          onChange={event => { setRegion(event.target.value); resetSearch(); }}
          onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); void onlineSearch(); } }}/>
        <button className="mw-btn" type="button" disabled={busy} onClick={onlineSearch}>{busy ? "正在搜索…" : provider === "amap" ? "联网搜索 · 高德" : "联网搜索 · OpenStreetMap"}</button>
      </div> : null}
      {attribution && <small>{attribution}</small>}
      {status && <small role="status">{status}</small>}
    </div>}
  </div>;
}
