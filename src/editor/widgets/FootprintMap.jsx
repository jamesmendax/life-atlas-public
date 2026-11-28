import { useEffect, useMemo, useRef, useState } from "react";
import { recordFor } from "./footprint-data/footprintMap.js";
import { listenForFootprintTouch } from "./footprintTouch.js";

const anchors = new Set(["city-110101", "city-310101", "city-510100", "city-440100", "city-420100", "city-650100", "city-540100", "city-230100"]);
const statusText = { visited: "已点亮", planned: "计划中", wishlist: "心愿单", unvisited: "未点亮" };
const fit = { zoom: 1, x: 0.5, y: 0.5 };
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function mapLabels(map, records, active) {
  const ordered = map.regions.map((region) => {
    const status = recordFor(records, region.id).status;
    const priority = region.id === active ? 4 : status !== "unvisited" ? 3 : anchors.has(region.id) ? 2 : 1;
    const name = region.name.replace(/市$/u, "");
    const label = map.key === "china" && ["city-110101", "city-310101"].includes(region.id) ? region.parent : name;
    return { ...region, label, priority };
  }).filter((region) => region.priority > 1 || map.regions.length < 55).sort((a, b) => b.priority - a.priority);
  const placed = [];
  for (const candidate of ordered) {
    const [x, y] = candidate.point;
    const half = Math.min(86, candidate.label.length * 6.6);
    if (placed.some((other) => Math.abs(other.point[1] - y) < 21 && Math.abs(other.point[0] - x) < other.half + half + 8)) continue;
    placed.push({ ...candidate, half });
  }
  return placed;
}

export function FootprintMap({ map, records, onSelect, view, setView, returnRegionId, pickingProvince, onProvince }) {
  const [hover, setHover] = useState("");
  const [focused, setFocused] = useState(returnRegionId || "");
  const svg = useRef(null);
  const drag = useRef(null);
  const ignoreClick = useRef(false);
  useEffect(() => listenForFootprintTouch(svg.current, map, setView, ignoreClick), [map, setView]);
  const active = hover || focused;
  const labels = useMemo(() => pickingProvince
    ? mapLabels({ ...map, regions: map.provinces }, {}, active)
    : mapLabels(map, records, active), [map, records, active, pickingProvince]);
  const tabId = map.regions.some((r) => r.id === focused) ? focused : map.regions[0]?.id;
  const boxWidth = map.width / view.zoom;
  const boxHeight = map.height / view.zoom;
  function zoomTo(zoom) {
    const half = 0.5 / zoom;
    setView({ zoom, x: clamp(view.x, half, 1 - half), y: clamp(view.y, half, 1 - half) });
  }
  function pan(event) {
    const origin = drag.current;
    if (!origin || event.pointerId !== origin.id) return;
    const dx = event.clientX - origin.clientX;
    const dy = event.clientY - origin.clientY;
    if (Math.abs(dx) + Math.abs(dy) < 5 && !ignoreClick.current) return;
    if (!ignoreClick.current) svg.current.setPointerCapture(event.pointerId);
    ignoreClick.current = true;
    const half = 0.5 / view.zoom;
    setView({ zoom: view.zoom, x: clamp(origin.x - dx / origin.scale / map.width, half, 1 - half),
      y: clamp(origin.y - dy / origin.scale / map.height, half, 1 - half) });
  }
  function keyboard(event, region, index) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      event.stopPropagation();
      onSelect(region);
      return;
    }
    const offset = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (!offset) return;
    event.preventDefault();
    event.stopPropagation();
    const next = map.regions[(index + offset + map.regions.length) % map.regions.length];
    svg.current.querySelector('[data-region="' + next.id + '"]')?.focus({ preventScroll: true });
  }
  return <div className="mw-fp-map-stage">
    <svg ref={svg} className="mw-fp-svg" data-zoomed={view.zoom > 1}
      viewBox={[(view.x * map.width) - boxWidth / 2, (view.y * map.height) - boxHeight / 2, boxWidth, boxHeight].join(" ")}
      aria-label={map.name + "足迹地图"} role="group"
      onPointerDown={(event) => {
        if (event.pointerType === "touch") return;
        ignoreClick.current = false;
        if (view.zoom <= 1 || event.button !== 0) return;
        drag.current = { id: event.pointerId, x: view.x, y: view.y, clientX: event.clientX, clientY: event.clientY, scale: svg.current.getScreenCTM().a };
      }}
      onPointerMove={pan} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
      onPointerLeave={() => { setHover(""); if (!ignoreClick.current) drag.current = null; }}>
      {map.inset && <g pointerEvents="none" aria-hidden="true" fill="var(--mb-muted)">
        <rect {...map.inset} fill="none" stroke="currentColor" strokeOpacity=".35" strokeWidth=".9"/>
        <text x={map.inset.x + 6} y={map.inset.y + 13} fontSize="10">南海诸岛</text>
      </g>}
      {map.regions.map((region, index) => {
        const status = recordFor(records, region.id).status;
        const name = region.full || region.name;
        return <path key={region.id} d={region.path} data-region={region.id} data-status={status} role="button"
          aria-hidden={pickingProvince || undefined} aria-label={name + " · " + statusText[status]} tabIndex={!pickingProvince && tabId === region.id ? 0 : -1}
          className={"mw-fp-path is-" + status + (active === region.id ? " is-selected" : "")}
          fillRule="evenodd" onPointerEnter={(event) => { if (!drag.current && event.pointerType !== "touch") setHover(region.id); }}
          onFocus={() => setFocused(region.id)} onKeyDown={(event) => keyboard(event, region, index)}
          onClick={(event) => { event.stopPropagation(); if (event.detail === 0 || !ignoreClick.current) onSelect(region); }}>
          <title>{name + " · " + statusText[status]}</title>
        </path>;
      })}
      {map.provinces.map((province) => pickingProvince
        ? <path key={province.id} className="mw-fp-province-pick" d={province.path} fillRule="evenodd"
          role="button" tabIndex={0} aria-label={"放大" + province.name + "地图"}
          onClick={(event) => { if (event.detail === 0 || !ignoreClick.current) onProvince(province.id); }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); onProvince(province.id); }
          }} />
        : <path key={province.id} className="mw-fp-province-lines" aria-hidden="true" d={province.path} />)}
      <g className="mw-fp-label-layer" aria-hidden="true">
        {labels.map(({ id, label, point }) => <text key={id} x={point[0]} y={point[1]}>{label}</text>)}
      </g>
    </svg>
    <div className="mw-fp-map-tools" role="group" aria-label="地图缩放">
      <button type="button" aria-label="缩小地图" disabled={view.zoom <= 1} onClick={() => zoomTo(Math.max(1, view.zoom / 1.6))}>−</button>
      <button type="button" aria-label="地图恢复原始大小" onClick={() => setView(fit)}>{Math.round(view.zoom * 100)}%</button>
      <button type="button" aria-label="放大地图" disabled={view.zoom >= 6} onClick={() => zoomTo(Math.min(6, view.zoom * 1.6))}>＋</button>
    </div>
  </div>;
}
