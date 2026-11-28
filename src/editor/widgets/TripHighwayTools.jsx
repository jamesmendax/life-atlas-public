import { useEffect, useRef, useState } from "react";
import { VALID_POINT } from "../../domain/tripRoutes.js";
import { normalizeRoadRef } from "../../domain/tripRoadRef.js";

export default function TripHighwayTools({ highwayRef, route, center, locked, onApply, onLocate, onAdd }) {
  const [input, setInput] = useState(highwayRef);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const request = useRef(0);
  const code = normalizeRoadRef(input);
  const valid = Boolean(code);
  useEffect(() => () => { request.current++; }, []);
  async function nearby() {
    if (!route || !valid || !VALID_POINT(center) || busy) return;
    const current = ++request.current;
    setBusy(true); setResult(null);
    try {
      const reply = await route({ kind: "highway-nearby", ref: code, point: center });
      if (current !== request.current) return;
      const places = reply?.value?.places?.filter(place => VALID_POINT(place.point)) || [];
      setResult({ places, message: places.length ? "" : reply?.error?.message || "附近没有标注此路号的道路。请移到沿线城镇后再查。" });
    } catch { if (current === request.current) setResult({ message: "公路地图暂时不可用，可以在地图上手选途经点。" }); }
    finally { if (current === request.current) setBusy(false); }
  }
  return <details className="trip-highway">
    <summary>{highwayRef ? highwayRef + " · 公路行程" : "沿国道规划"}</summary>
    <div className="trip-highway-body">
      <label>国道路号<input aria-label="国道路号" className="mw-input" maxLength={12} placeholder="如 G318" value={input} disabled={locked} onChange={event => {
        request.current++; setInput(event.target.value); setBusy(false); setResult(null);
      }}/></label>
      {!locked && <button type="button" className="mw-btn" disabled={!valid || code === highwayRef} onClick={() => onApply(code)}>用于当天驾车</button>}
      {highwayRef && !locked && <button type="button" className="mw-btn-ghost" onClick={() => { setInput(""); setResult(null); request.current++; setBusy(false); onApply(""); }}>清除路号</button>}
      <button type="button" className="mw-btn" disabled={!route || !valid || busy || !VALID_POINT(center)} onClick={nearby}>{busy ? "正在查找道路…" : "找地图中心附近的途经点"}</button>
      <small>{input.trim() && !valid ? "输入 G 开头的道路编号，例如 G109 或 G4218。" : "将地图移到沿线地区，按路号查找实际道路上的途经点。地图中心会发送给 OpenFreeMap。"}</small>
      {result?.message && <small role="status">{result.message}</small>}
      {result?.places?.map(place => <div key={place.id} className="trip-highway-place">
        <button type="button" className="trip-stop-title" onClick={() => onLocate(place)}><b>{place.name}</b><small>{place.address} · {place.point.map(n => n.toFixed(4)).join(", ")}</small></button>
        {!locked && <button type="button" className="mw-btn" onClick={() => { onAdd(place); setResult(null); }}>加入途经点</button>}
      </div>)}
    </div>
  </details>;
}
