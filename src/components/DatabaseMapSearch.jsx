import { useCallback, useEffect, useRef, useState } from "react";
import IconSearch from "@tabler/icons-react/dist/esm/icons/IconSearch.mjs";

const coordinates = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*[,，]\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))$/u;

const networkNotice = "搜索地名需要联网。离线时可输入纬度、经度定位。";

export function DatabaseMapSearch({ onLocate, offlineLayer }) {
  const [query, setQuery] = useState("");
  const [places, setPlaces] = useState([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [online, setOnline] = useState(() => navigator.onLine);
  const request = useRef(null);
  const input = useRef(null);
  const api = window.lifeAtlas?.databaseMap;

  const cancel = useCallback(() => {
    const id = request.current;
    request.current = null;
    if (id) void api?.cancelSearch?.({ requestId: id }).catch(() => {});
  }, [api]);
  useEffect(() => {
    setPlaces([]); setMessage(""); setBusy(false); setOpen(false);
    return cancel;
  }, [offlineLayer, cancel]);
  useEffect(() => {
    const changed = () => {
      setOnline(navigator.onLine);
      setMessage("");
      if (!navigator.onLine) {
        cancel(); setBusy(false); setPlaces([]);
      }
    };
    window.addEventListener("online", changed);
    window.addEventListener("offline", changed);
    changed();
    return () => {
      window.removeEventListener("online", changed);
      window.removeEventListener("offline", changed);
    };
  }, [cancel]);

  function edit(value) {
    cancel();
    setQuery(value); setPlaces([]); setMessage(""); setBusy(false); setOpen(true);
  }
  function locate(place) {
    input.current?.focus({ preventScroll: true });
    setQuery(place.name); setPlaces([]); setMessage(""); setOpen(false);
    onLocate(place);
  }
  async function search(event) {
    event.preventDefault();
    const term = query.trim();
    if (!term || busy) return;
    // A focused submit button losing focus while disabled would dismiss its own results.
    input.current?.focus({ preventScroll: true });
    setOpen(true); setPlaces([]); setMessage("");
    const pair = term.match(coordinates);
    if (pair) {
      const point = pair.slice(1).map(Number);
      if (Math.abs(point[0]) > 85.051129 || Math.abs(point[1]) > 180) {
        setMessage("请输入可显示的纬度（−85.05 至 85.05）和经度（−180 至 180）。");
        return;
      }
      locate({ name: term, point });
      return;
    }
    if (!navigator.onLine) {
      setMessage(networkNotice);
      return;
    }
    if (offlineLayer || !api?.search) {
      setMessage(offlineLayer ? "当前图层支持经纬度定位。切到街道或卫星可搜索地名。" : "桌面版支持联网搜索地名，也可直接输入纬度, 经度。");
      return;
    }
    const id = crypto.randomUUID();
    request.current = id;
    setBusy(true);
    try {
      const response = await api.search({ query: term, requestId: id });
      if (request.current !== id || !navigator.onLine) return;
      if (!response?.ok) throw new Error(response?.error?.message || "地点服务暂时无法连接，请重试。");
      const results = response.value.places || [];
      setPlaces(results);
      if (!results.length) setMessage("没有找到这个地点。试试加上城市名，或输入经纬度。");
    } catch (error) {
      if (request.current === id) setMessage(error.message || "地点搜索失败，请重试。");
    } finally {
      if (request.current === id) { request.current = null; setBusy(false); }
    }
  }

  const notice = !online && query.trim() && !coordinates.test(query.trim()) ? networkNotice : message;
  const coordinatesOnly = !online || offlineLayer;
  return <div className="db-map-search" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}
    onKeyDown={(event) => { if (event.key === "Escape" && open) { event.stopPropagation(); cancel(); setBusy(false); setOpen(false); input.current?.focus(); } }}>
    <form role="search" aria-label="查找地图地点" onSubmit={search}>
      <input type="search" ref={input} aria-label="搜索地名或经纬度" maxLength={80} placeholder={coordinatesOnly ? "定位经纬度…" : "搜索地点或经纬度…"}
        value={query} onFocus={() => setOpen(true)} onChange={(event) => edit(event.target.value)} />
      <button type="submit" aria-label="查找地点" title={coordinatesOnly ? "定位坐标" : "查找地点 · OpenStreetMap"} disabled={!query.trim()} aria-disabled={busy || !query.trim()}><IconSearch size={16} aria-hidden="true" /></button>
    </form>
    {open && (busy || notice || places.length > 0) && <div className="db-map-search-results">
      {(busy || notice) && <span role="status">{busy ? "正在查找地点…" : notice}</span>}
      {places.map((place) => <button type="button" key={place.id} onClick={() => locate(place)}><strong>{place.name}</strong><small>{place.address}</small></button>)}
      {places.length > 0 && <small>地点数据 © OpenStreetMap 贡献者</small>}
    </div>}
  </div>;
}
