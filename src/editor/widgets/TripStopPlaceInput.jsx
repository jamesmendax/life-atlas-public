import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { searchTripPlaces } from "./trip-data/placeSearch.js";
import { localExactTravelPlace, travelPlaceChoices, tripPlaceDetails, withTravelEntrance } from "./trip-data/placeChoices.js";

export const uniqueExactPlace = localExactTravelPlace;

const TripStopPlaceInput = forwardRef(function TripStopPlaceInput({ name, onName, onChoose, trip, provider, near }, ref) {
  const [remote, setRemote] = useState([]);
  const [status, setStatus] = useState("");
  const [attribution, setAttribution] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [region, setRegion] = useState("");
  const revision = useRef(0);
  const pending = useRef(null);
  const local = useMemo(() => searchTripPlaces(name, { near, region, limit: 25 }), [name, near, region]);
  const places = travelPlaceChoices(name, remote, local);
  function cancel() {
    revision.current++;
    const request = pending.current; pending.current = null;
    if (request && trip?.cancel) void trip.cancel({ requestId: request }).catch(() => {});
  }
  useEffect(() => () => cancel(), [provider]);
  async function search() {
    setOpen(true);
    const query = name.trim();
    if (!query || query.length > 80 || !trip?.search || !provider) {
      setStatus(query.length > 80 ? "联网关键词不能超过 80 个字。" : "联网搜索不可用，请选择本地地点、填写坐标或地图选点。");
      return null;
    }
    cancel();
    const current = revision.current, requestId = crypto.randomUUID(); pending.current = requestId;
    setBusy(true); setStatus("");
    try {
      const city = region.trim();
      const result = await trip.search({ requestId, query, provider, userInitiated: true, limit: 25,
        ...(city && { region: city, cityLimit: provider === "amap" }) });
      if (current !== revision.current) return null;
      if (!result?.ok) { setStatus(result?.error?.message || "联网搜索不可用，请重试或使用地图选点。"); return []; }
      const found = result.value?.places || [];
      setRemote(found); setAttribution(result.value?.attribution || "");
      setStatus(found.length ? "请选择匹配的地点。" : "未找到地点，可调整名称、填写坐标或地图选点。");
      return found;
    } catch { if (current === revision.current) setStatus("联网搜索不可用，请重试或使用地图选点。"); return []; }
    finally { if (current === revision.current) { pending.current = null; setBusy(false); } }
  }
  useImperativeHandle(ref, () => ({
    async resolve() {
      const exact = remote.length ? null : uniqueExactPlace(name, local);
      if (exact) return exact;
      if (places.length) {
        setOpen(true);
        setStatus("请按地区、类别和地址选择地点。");
      } else await search();
      return null;
    },
  }));
  function change(value) {
    cancel(); setRemote([]); setStatus(""); setAttribution(""); setBusy(false); setOpen(true); onName(value);
  }
  return <div className="trip-stop-place">
    <label>景点或地址<input className="mw-input" maxLength={120} required value={name} onChange={e => change(e.target.value)}
      onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void search(); } }}/></label>
    {open && name.trim() && <div className="trip-stop-results">
      {places.flatMap(place => [place, withTravelEntrance(place)].filter(Boolean)).map(place => <button type="button" className="trip-result" key={place.source + ":" + place.id} onClick={() => { cancel(); setRemote([]); setStatus(""); setOpen(false); setBusy(false); onChoose(place); }}>
        <strong>{place.name}</strong><small>{tripPlaceDetails(place)}</small>
      </button>)}
      {trip?.search && provider ? <div className="trip-place-query-tools">
        <input className="mw-input" type="text" aria-label="联网搜索城市（可选）" placeholder="全国 · 可填城市" value={region} maxLength={40}
          onChange={event => { setRegion(event.target.value); cancel(); setRemote([]); setAttribution(""); setStatus(""); setBusy(false); }}
          onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); void search(); } }}/>
        <button type="button" className="mw-btn" disabled={busy} onClick={() => void search()}>{busy ? "正在搜索…" : provider === "amap" ? "联网搜索 · 高德" : "联网搜索 · OpenStreetMap"}</button>
      </div>
        : <small>联网搜索未启用，可选择本地地点或填写坐标。</small>}
      {attribution && <small>{attribution}</small>}{status && <small role="status">{status}</small>}
    </div>}
  </div>;
});
export default TripStopPlaceInput;
