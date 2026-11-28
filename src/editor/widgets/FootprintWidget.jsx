import { useEffect, useId, useMemo, useRef, useState } from "react";
import IconArrowLeft from "@tabler/icons-react/dist/esm/icons/IconArrowLeft.mjs";
import IconSearch from "@tabler/icons-react/dist/esm/icons/IconSearch.mjs";
import { FootprintMap } from "./FootprintMap.jsx";
import { findRegions, footprintMap, historicalDistrictPath, macauGeoJsonText, modeNames, provinces, recordFor, regionById } from "./footprint-data/footprintMap.js";

const palettes = { sunset: "日落珊瑚", aurora: "极光翡翠", ocean: "星海湛蓝", gold: "流金琥珀" };
const statuses = { visited: "已点亮", planned: "计划中", wishlist: "心愿单", unvisited: "未点亮" };
const emptyRecords = {};
const initialView = { zoom: 1, x: 0.5, y: 0.5 };

const previewRecords = {
  "city-510100": { status: "visited", date: "2026-04", note: "玉林路小酒馆与熊猫基地，火锅超赞", spots: ["宽窄巷子", "大熊猫繁育研究基地", "锦里古街"] },
  "city-513200": { status: "visited", date: "2026-05", note: "川西秘境彩林海子，随手出片", spots: ["九寨沟", "黄龙景区"] },
  "city-330100": { status: "visited", date: "2026-03", note: "苏堤春晓骑行与龙井问茶", spots: ["西湖", "灵隐寺"] },
  "city-110101": { status: "visited", date: "2025-10", note: "秋日故宫角楼与景山落日", spots: ["故宫博物院", "天安门广场"] },
  "city-310101": { status: "visited", date: "2025-11", note: "外滩夜景与武康路散步", spots: ["外滩", "豫园"] },
  "city-440100": { status: "visited", date: "2026-01", note: "早茶虾饺与珠江夜游", spots: ["广州塔", "沙面岛"] },
  "city-530700": { status: "planned", date: "2026-10", note: "计划去看玉龙雪山日照金山", spots: ["玉龙雪山"] },
  "city-650100": { status: "wishlist", date: "", note: "想去北疆看秋季喀纳斯", spots: [] },
  "jp-26": { status: "visited", date: "2025-11", note: "清水寺红叶季", spots: [] },
  "jp-13": { status: "visited", date: "2025-11", note: "涩谷夜景与表参道", spots: [] },
  "w-CHN": { status: "visited", date: "2026", note: "山河探索进行中", spots: [] },
  "w-JPN": { status: "visited", date: "2025", note: "关西与东京秋旅", spots: [] },
};

function RegionDetail({ region, record, locked, change, backLabel, goBack, showProvince, heading }) {
  const name = region.full || region.name;
  const country = modeNames[region.mode];
  const cityParent = region.parent === country ? country : country + " / " + region.parent;
  const landmarks = [...new Set([...(region.landmarks || []), ...record.spots])];
  return <section className="mw-fp-detail" aria-label="足迹详情">
    <button type="button" className="mw-fp-back" onClick={goBack} aria-label={backLabel}>
      <IconArrowLeft size={16} aria-hidden="true" />{backLabel.replace(/^← /u, "")}
    </button>
    <div className="mw-fp-detail-title">
      <small>{cityParent}</small>
      <h3 ref={heading} tabIndex={-1}>{name}</h3>
      {region.id === "city-710000" && <p className="mw-fp-city-notice">本地地图收录此区域的整体边界。</p>}
      {region.historicalYear && <><p className="mw-fp-city-notice">{region.historicalYear} 年历史区划 · 此手记保留在原地区。</p>
        <svg viewBox="0 0 240 130" width="240" height="130" style={{ maxWidth: "100%" }} role="img" aria-label={name + "历史边界"}>
          <path d={historicalDistrictPath(region)} fill="var(--mb-hover)" stroke="var(--mb-muted)" fillRule="evenodd" />
        </svg></>}
    </div>
    <fieldset className="mw-fp-field"><legend>足迹状态</legend>
      <div className="mw-fp-statuses">{Object.entries(statuses).map(([status, label]) =>
        <button type="button" key={status} className={"mw-status-btn is-" + status + (record.status === status ? " is-active" : "")}
          aria-pressed={record.status === status} disabled={locked} onClick={() => change({ status })}>{label}</button>
      )}</div>
    </fieldset>
    {landmarks.length > 0 && <fieldset className="mw-fp-field"><legend>景点打卡</legend>
      <div className="mw-chip-list">{landmarks.map((spot) => {
        const checked = record.spots.includes(spot);
        return <button type="button" key={spot} className={"mw-chip" + (checked ? " is-active" : "")}
          aria-pressed={checked} disabled={locked} onClick={() => change({ spots: checked ? record.spots.filter((s) => s !== spot) : [...record.spots, spot],
            status: !checked && record.status === "unvisited" ? "visited" : record.status })}>{checked ? "✓ " : "＋ "}{spot}</button>;
      })}</div>
    </fieldset>}
    <label className="mw-fp-field">旅行日期
      <input className="mw-input" readOnly={locked} value={record.date}
        placeholder="例如 2026-11" onChange={(event) => change({ date: event.target.value })} />
    </label>
    <label className="mw-fp-field">旅行备注
      <textarea rows={3} className="mw-textarea" value={record.note} readOnly={locked}
        placeholder="记下这次旅行…" onChange={(event) => change({ note: event.target.value })} />
    </label>
    {showProvince && <button type="button" className="mw-fp-local" onClick={showProvince}>查看{region.parent}地图 →</button>}
  </section>;
}

export function FootprintWidget({ state = {}, onChange, locked = false, compact = false, demonstration = false }) {
  const data = state && typeof state === "object" && !Array.isArray(state) ? state : {};
  const records = data.records && typeof data.records === "object" && !Array.isArray(data.records)
    ? data.records : demonstration ? previewRecords : emptyRecords;
  const palette = Object.hasOwn(palettes, data.palette) ? data.palette : "sunset";
  const [lockedMode, setLockedMode] = useState(null);
  const mode = (locked && lockedMode) || (Object.hasOwn(modeNames, data.mapMode) ? data.mapMode : "china");
  const [provinceId, setProvinceId] = useState("");
  const [pickingProvince, setPickingProvince] = useState(false);
  const [selected, setSelected] = useState(null);
  const [query, setQuery] = useState("");
  const [showMacauData, setShowMacauData] = useState(false);
  const [view, setView] = useState(initialView);
  const widget = useRef(null);
  const search = useRef(null);
  const heading = useRef(null);
  const focusAfter = useRef(null);
  const lastRegion = useRef("");
  const resultsId = useId();
  const map = useMemo(() => footprintMap(mode, provinceId), [mode, provinceId]);
  const region = regionById.get(selected);
  const matches = useMemo(() => findRegions(query), [query]);
  const counts = useMemo(() => {
    const totals = { visited: 0, planned: 0, wishlist: 0, unvisited: 0 };
    for (const item of map.regions) totals[recordFor(records, item.id).status] += 1;
    return totals;
  }, [map, records]);

  useEffect(() => {
    if (focusAfter.current === "detail") heading.current?.focus({ preventScroll: true });
    if (focusAfter.current === "map") {
      const target = widget.current?.querySelector('[data-region="' + lastRegion.current + '"]');
      (target || search.current)?.focus({ preventScroll: true });
    }
    focusAfter.current = null;
  }, [selected, map]);

  function patch(changes) {
    if (!locked) onChange?.({ ...data, records, palette, mapMode: mode, ...changes });
  }
  function switchMap(nextMode, nextProvince = "") {
    if (nextMode !== mode) {
      if (locked) setLockedMode(nextMode);
      else patch({ mapMode: nextMode });
    }
    setProvinceId(nextProvince);
    setPickingProvince(false);
    setSelected(null);
    setQuery("");
    setView(initialView);
  }
  function openRegion(item) {
    if (item.mode !== mode || (provinceId && item.provinceId !== provinceId)) switchMap(item.mode);
    setPickingProvince(false);
    lastRegion.current = item.id;
    focusAfter.current = "detail";
    setQuery("");
    setSelected(item.id);
  }
  function changeRecord(changes) {
    if (locked || !region) return;
    const updated = { ...recordFor(records, region.id), ...changes };
    const next = { ...records };
    if (region.id.startsWith("city-")) delete next["cn-" + region.id.slice(5)];
    if (updated.status === "unvisited" && !updated.note && !updated.date && !updated.spots.length) delete next[region.id];
    else next[region.id] = updated;
    patch({ records: next });
  }
  const backLabel = mode === "china" && !provinceId ? "← 返回中国全景" : "← 返回" + map.name + "地图";

  return <section ref={widget} className={"mw-card mw-footprint" + (compact ? " is-compact" : "")} data-palette={palette}
    contentEditable={false} aria-label="交互式足迹点亮地图" onMouseDown={(event) => event.stopPropagation()} onDragStart={(event) => event.preventDefault()}>
    <header className="mw-head">
      <h2 className="mw-fp-title">足迹地图</h2>
      <div className="mw-seg" role="group" aria-label="切换版图">
        {Object.entries(modeNames).map(([id, name]) => <button key={id} type="button"
          className={id === mode ? "is-active" : ""} aria-pressed={id === mode} onClick={() => switchMap(id)}>{name}</button>)}
      </div>
    </header>
    {region ? <RegionDetail region={region} record={recordFor(records, region.id)} locked={locked} heading={heading}
      change={changeRecord} backLabel={backLabel} goBack={() => { focusAfter.current = "map"; setSelected(null); }}
      showProvince={region.provinceId && !provinceId ? () => { focusAfter.current = "map"; switchMap("china", region.provinceId); } : null} />
    : <>
      <div className="mw-fp-atlas">
      <div className="mw-fp-bar">
        <div className="mw-fp-search-box" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setQuery(""); }}
          onKeyDown={(event) => {
            if (event.key === "Escape" && query) { event.stopPropagation(); setQuery(""); search.current?.focus(); }
          }}>
          <IconSearch size={16} aria-hidden="true" />
          <input ref={search} className="mw-input" type="text" aria-label="搜索城市或景点" autoComplete="off"
            placeholder="搜索城市、景点或国家" value={query} onChange={(event) => setQuery(event.target.value)}
            aria-controls={query.trim() ? resultsId : undefined} onKeyDown={(event) => {
              if (!matches.length) return;
              if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); openRegion(matches[0].region); }
              if (event.key === "ArrowDown") { event.preventDefault(); event.stopPropagation(); widget.current?.querySelector(".mw-fp-search-pop button")?.focus(); }
            }} />
          {query.trim() && <div className="mw-fp-search-pop" id={resultsId} role="group" aria-label="搜索结果">
            {matches.length ? matches.map(({ region: hit, landmark }) => <button type="button" key={hit.id} onClick={() => openRegion(hit)}>
              <b>{hit.full || hit.name}</b><small>{hit.parent}{hit.historicalYear ? " · " + hit.historicalYear + " 年历史区划" : ""}{landmark ? " · " + landmark : ""}</small>
            </button>) : <p role="status">没有找到匹配的地点</p>}
          </div>}
        </div>
        {mode === "china" && <label className="mw-fp-area-control"><span>地图范围</span>
          <select className="mw-fp-area" value={pickingProvince ? "pick" : provinceId}
          onChange={(event) => {
            const next = event.target.value;
            switchMap(mode, next === "pick" ? "" : next);
            setPickingProvince(next === "pick");
          }}>
          <option value="">全国</option>
          <option value="pick">在图上选省…</option>
          {provinces.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>}
      </div>
      {pickingProvince && <p className="mw-fp-map-notice" role="status">选择地图上的省级区域，打开该区域的城市与足迹。</p>}
      <FootprintMap key={map.key} map={map} records={records} view={view} setView={setView}
        onSelect={openRegion} returnRegionId={lastRegion.current} pickingProvince={pickingProvince}
        onProvince={(id) => switchMap("china", id)} />
      <div className="mw-fp-foot">
        <div className="mw-fp-legend" aria-label="当前地图的足迹统计">
          {["visited", "planned", "wishlist"].map((id) => <span key={id}><i className={"is-" + id} aria-hidden="true" />{statuses[id]} <b>{counts[id]}</b></span>)}
        </div>
        <div className="mw-palettes" role="group" aria-label="地图配色">
          {Object.entries(palettes).map(([id, label]) => <button type="button" key={id} title={label} aria-label={label}
            className={"mw-swatch mw-swatch-" + id + (palette === id ? " is-active" : "")}
            aria-pressed={palette === id} disabled={locked} onClick={() => patch({ palette: id })} />)}
        </div>
      </div>
      </div>
      {mode === "china" && <details className="mw-fp-coverage"><summary>地图范围与数据来源</summary>
        <p>以地级行政区为主，含省直辖县市、四个直辖市的区县、香港十八区、澳门七个堂区及路氹填海区。台湾显示整体边界。原重庆江北区、渝北区可按名称检索历史手记。</p>
        <p>中国边界采用 Cheng、Xiao、Wang、Hu 的 CTAmap v2.0，基于 CC BY 4.0 简化；香港采用 Natural Earth。澳门边界源自 OpenStreetMap，依 ODbL 1.0 提供。</p>
        <details onToggle={(e) => setShowMacauData(e.currentTarget.open)}><summary>查看并复制澳门边界 GeoJSON</summary>
          {showMacauData && <textarea className="mw-textarea" aria-label="澳门边界 GeoJSON" readOnly rows={4} value={macauGeoJsonText()} onFocus={(e) => e.currentTarget.select()} />}
        </details>
      </details>}
      {mode === "china" && (!provinceId || provinceId === "cn-820000") && <small className="mw-fp-coverage">澳门边界 © OpenStreetMap contributors · ODbL 1.0</small>}
    </>}
  </section>;
}
