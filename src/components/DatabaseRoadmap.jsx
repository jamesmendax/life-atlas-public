import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { downloadBlob } from "../domain/pageExport.js";
import IconDownload from "@tabler/icons-react/dist/esm/icons/IconDownload.mjs";
import IconMinus from "@tabler/icons-react/dist/esm/icons/IconMinus.mjs";
import IconPlus from "@tabler/icons-react/dist/esm/icons/IconPlus.mjs";
import IconRocket from "@tabler/icons-react/dist/esm/icons/IconRocket.mjs";
import { formatPropertyValue, normalizeDate } from "../domain/databaseProperties.js";
import { resolvePropertyValue } from "../domain/database.js";
import { normalizeViewConfig } from "../domain/viewRegistry.js";
import { layoutRoadmap, ROADMAP_DEFAULTS, ROADMAP_ZOOMS, splitTickLabel } from "../domain/roadmapLayout.js";
import { roadmapEntries, shiftRoadmapDate } from "../domain/roadmapEntries.js";
import { buildRoadmapSvg, roadmapExportFileName, svgToPngBlob } from "../domain/roadmapExport.js";

const DAY = 86400000;
const shortDate = (time) => {
  const date = new Date(time);
  return `${date.getUTCMonth() + 1}月${date.getUTCDate()}日`;
};
const isoDate = (time) => new Date(time).toISOString().slice(0, 10);
const compareEntries = (first, second) => first.start - second.start || (String(first.id) < String(second.id) ? -1 : String(first.id) > String(second.id) ? 1 : 0);
const userColor = (color) => ["gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"].includes(color) ? color : null;

function phaseColors(phase) {
  const color = userColor(phase.color);
  if (color) return { complete: `var(--mb-u-${color})`, remainder: `var(--mb-tag-${color})` };
  if (phase.fill >= 1) return { complete: "var(--mb-u-green)", remainder: "var(--mb-u-green)" };
  if (phase.fill > 0) return { complete: "var(--mb-accent)", remainder: "var(--mb-tag-blue)" };
  return { complete: "var(--mb-tag-gray)", remainder: "var(--mb-tag-gray)" };
}

function MilestoneMarker({ milestone, y }) {
  const color = userColor(milestone.color);
  const stroke = color ? `var(--mb-u-${color})` : "var(--mb-ink)";
  const fill = milestone.past ? stroke : "var(--mb-paper)";
  const common = { fill, stroke, strokeWidth: 1.5 };
  if (milestone.marker === "major") return <><circle cx={milestone.x} cy={y} r={14} fill="var(--mb-accent)" stroke="var(--mb-paper)" strokeWidth={3}/><IconRocket x={milestone.x - 7} y={y - 7} width={14} height={14} stroke={1.8} color="var(--mb-tooltip-text)"/></>;
  if (milestone.marker === "circle") return <circle cx={milestone.x} cy={y} r={6} {...common}/>;
  if (milestone.marker === "ring") return <circle cx={milestone.x} cy={y} r={7} fill="var(--mb-paper)" stroke={stroke} strokeWidth={3}/>;
  const size = milestone.marker === "square" ? 11 : 12;
  return <rect x={milestone.x - size / 2} y={y - size / 2} width={size} height={size} rx={2} transform={milestone.marker === "square" ? undefined : `rotate(45 ${milestone.x} ${y})`} {...common}/>;
}

function PhaseDrawing({ phase, clipId }) {
  const colors = phaseColors(phase);
  return <>
    <defs><clipPath id={clipId}><rect x={phase.x} y={phase.y} width={phase.width} height={8} rx={4}/></clipPath><clipPath id={`${clipId}-label`}><rect x={phase.x} y={phase.y + 8} width={phase.width} height={36}/></clipPath></defs>
    <g className="db-roadmap-drag-handle" data-drag-handle="phase">
      <rect x={phase.x} y={phase.y - 8} width={phase.width} height={24} fill="transparent"/>
      <rect className="db-roadmap-phase-track" x={phase.x} y={phase.y} width={phase.width} height={8} rx={4} fill={colors.remainder}/>
      {phase.fill > 0 && <rect x={phase.x} y={phase.y} width={phase.width * phase.fill} height={8} fill={colors.complete} clipPath={`url(#${clipId})`}/>}
    </g>
    {phase.labelVisible && <text className="db-roadmap-phase-title" x={phase.x} y={phase.y + 27} clipPath={`url(#${clipId}-label)`}><tspan>{phase.label}</tspan>{phase.subtitleVisible && phase.subtitle && <tspan className="db-roadmap-phase-subtitle" dx={8}>{phase.subtitle}</tspan>}</text>}
  </>;
}

function MilestoneDrawing({ milestone, axisY }) {
  const anchor = milestone.align === "end" ? "end" : "start";
  const cardX = milestone.align === "end" ? milestone.card.x + milestone.card.width : milestone.card.x;
  const compact = milestone.card.height === 48;
  const titleWidth = milestone.card.width;
  const maxCharacters = Math.floor(titleWidth / (milestone.marker === "major" ? 16 : 15));
  const title = [...milestone.title].length > maxCharacters ? `${[...milestone.title].slice(0, maxCharacters - 1).join("")}…` : milestone.title;
  return <>
    <line className="db-roadmap-connector" x1={milestone.x} x2={milestone.x} y1={milestone.card.y} y2={axisY - 6}/>
    <text className="db-roadmap-card-date" x={cardX} y={milestone.card.y + 12} textAnchor={anchor}>{shortDate(milestone.start)}</text>
    <text className={`db-roadmap-card-title${milestone.marker === "major" ? " is-major" : ""}`} x={cardX} y={milestone.card.y + (compact ? 30 : 34)} textAnchor={anchor}>{title}</text>
    {milestone.subtitle && <text className="db-roadmap-card-subtitle" x={cardX} y={milestone.card.y + (compact ? 46 : 54)} textAnchor={anchor}>{milestone.subtitle}</text>}
    <g className="db-roadmap-drag-handle" data-drag-handle="milestone"><circle className="db-roadmap-node-hit" cx={milestone.x} cy={axisY} r={18}/><MilestoneMarker milestone={milestone} y={axisY}/></g>
  </>;
}

export function DatabaseRoadmap({ workspace, source, view, items = [], onOpenItemPage, onCreateItem, onUpdateItemValue, onUpdateView, runtime }) {
  const rootRef = useRef(null);
  const scrollRef = useRef(null);
  const dragRef = useRef(null);
  const lockedRef = useRef(Boolean(runtime?.locked));
  const suppressClickRef = useRef(null);
  const exportButtonRef = useRef(null);
  const downloadButtonRef = useRef(null);
  const clipPrefix = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const [width, setWidth] = useState(1200);
  const [now, setNow] = useState(() => Date.now());
  const [highlight, setHighlight] = useState(null);
  const [drag, setDrag] = useState(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [background, setBackground] = useState("white");
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState("");
  const config = useMemo(() => normalizeViewConfig("roadmap", view.config), [view.config]);
  const settings = useMemo(() => ({ ...ROADMAP_DEFAULTS, ...config.roadmap }), [config]);
  const entries = useMemo(() => roadmapEntries(workspace, source, items, settings), [workspace, source, items, settings]);
  const layout = useMemo(() => layoutRoadmap({ entries, width, now, config: settings }), [entries, width, now, settings]);
  const nodes = useMemo(() => [...layout.phases.map((entry) => ({ ...entry, kind: "phase" })), ...layout.milestones.map((entry) => ({ ...entry, kind: "milestone" }))].sort(compareEntries), [layout]);
  const itemMap = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const entryMap = useMemo(() => new Map(entries.map((entry) => [entry.id, entry])), [entries]);
  const dateProperty = source.properties.find((property) => property.id === settings.datePropertyId && property.type === "date");
  const locked = Boolean(runtime?.locked);
  lockedRef.current = locked;
  const zoom = ROADMAP_ZOOMS.includes(settings.zoom) ? settings.zoom : 1;
  const chartWidth = width * zoom;
  const changeConfig = (patch) => onUpdateView?.(view.id, { config: { ...config, roadmap: { ...settings, ...patch } } });

  useLayoutEffect(() => {
    if (exportBusy) return;
    const button = downloadButtonRef.current;
    downloadButtonRef.current = null;
    if (button?.isConnected && document.activeElement === document.body) button.focus({ preventScroll: true });
  }, [exportBusy]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const measure = () => { if (element.clientWidth > 0) setWidth(element.clientWidth); };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => () => dragRef.current?.cleanup(), []);
  useEffect(() => { if (locked) dragRef.current?.finish(false); }, [locked]);

  const dateLabel = (entry) => {
    const item = itemMap.get(entry.id);
    return dateProperty && item ? formatPropertyValue(workspace, dateProperty, resolvePropertyValue(workspace, source, item, dateProperty)) : `${isoDate(entry.start)}${entry.end ? ` → ${isoDate(entry.end)}` : ""}`;
  };
  const showDetails = (entry, event) => {
    if (dragRef.current) return;
    const root = rootRef.current?.getBoundingClientRect();
    const target = event.currentTarget.getBoundingClientRect();
    if (!root) return;
    const clientX = Number.isFinite(event.clientX) ? event.clientX : target.left;
    const clientY = Number.isFinite(event.clientY) ? event.clientY : target.bottom;
    setHighlight({ id: entry.id, x: Math.max(8, Math.min(root.width - 292, clientX - root.left + 12)), y: Math.max(36, clientY - root.top + 12) });
  };
  const openEntry = (entry, event) => {
    if (suppressClickRef.current?.id === entry.id && suppressClickRef.current.until >= performance.now()) {
      suppressClickRef.current = null;
      event?.preventDefault();
      return;
    }
    onOpenItemPage?.(entry.pageId);
  };
  const beginDrag = (event, entry) => {
    if (event.button !== 0 || locked || !dateProperty || !event.target.closest("[data-drag-handle]")) return;
    const item = itemMap.get(entry.id);
    const originalDate = item && normalizeDate(resolvePropertyValue(workspace, source, item, dateProperty));
    const pixelsPerDay = (layout.axis.x1 - layout.axis.x0) / ((layout.domain.end - layout.domain.start) / DAY);
    if (!originalDate?.start || !(pixelsPerDay > 0)) return;
    event.preventDefault();
    event.currentTarget.focus();
    setHighlight(null);
    const target = event.currentTarget;
    const active = { id: entry.id, pointerId: event.pointerId, originX: event.clientX, pixelsPerDay, deltaDays: 0, moved: false, originalDate };
    const move = (pointerEvent) => {
      if (pointerEvent.pointerId !== active.pointerId) return;
      pointerEvent.preventDefault();
      active.moved ||= Math.abs(pointerEvent.clientX - active.originX) > 2;
      active.deltaDays = Math.round((pointerEvent.clientX - active.originX) / active.pixelsPerDay);
      setDrag({ id: active.id, deltaDays: active.deltaDays, deltaX: active.deltaDays * active.pixelsPerDay });
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", keydown);
      if (target.hasPointerCapture?.(active.pointerId)) target.releasePointerCapture(active.pointerId);
    };
    const finish = (commit, pointerEvent) => {
      if (dragRef.current !== active || pointerEvent && pointerEvent.pointerId !== active.pointerId) return;
      if (pointerEvent) {
        active.moved ||= Math.abs(pointerEvent.clientX - active.originX) > 2;
        active.deltaDays = Math.round((pointerEvent.clientX - active.originX) / active.pixelsPerDay);
      }
      active.moved ||= active.deltaDays !== 0;
      cleanup();
      dragRef.current = null;
      setDrag(null);
      if (active.moved || !commit) suppressClickRef.current = { id: active.id, until: performance.now() + 400 };
      if (commit && !lockedRef.current && active.deltaDays !== 0) {
        const next = shiftRoadmapDate(active.originalDate, active.deltaDays);
        if (next) onUpdateItemValue?.(active.id, dateProperty.id, next);
      }
    };
    const release = (pointerEvent) => finish(true, pointerEvent);
    const cancel = () => finish(false);
    const keydown = (keyEvent) => { if (keyEvent.key === "Escape") { keyEvent.preventDefault(); finish(false); } };
    active.cleanup = cleanup;
    active.finish = finish;
    dragRef.current = active;
    setDrag({ id: active.id, deltaDays: 0, deltaX: 0 });
    target.setPointerCapture?.(active.pointerId);
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", keydown);
  };
  const closeExport = () => { downloadButtonRef.current = null; setExportOpen(false); exportButtonRef.current?.focus(); };
  const exportFile = async (extension, button) => {
    downloadButtonRef.current = button;
    setExportBusy(true);
    setExportError("");
    try {
      const exportLayout = layoutRoadmap({ entries, width: 1760, now, config: { ...settings, zoom: 1 } });
      const dated = entries.filter((entry) => Number.isFinite(entry.start));
      const rangeLabel = dated.length ? `${isoDate(Math.min(...dated.map((entry) => entry.start)))} → ${isoDate(Math.max(...dated.map((entry) => entry.end ?? entry.start)))}` : "";
      const svg = buildRoadmapSvg({ layout: exportLayout, title: source.title, rangeLabel, background, mode: document.documentElement.dataset.theme === "dark" ? "dark" : "light" });
      const blob = extension === "svg" ? new Blob([svg], { type: "image/svg+xml;charset=utf-8" }) : await svgToPngBlob(svg, { scale: 2 });
      await downloadBlob(blob, roadmapExportFileName(source.title, extension, Date.now()));
    } catch (error) {
      setExportError(error?.message || "导出失败，请重试");
    } finally {
      setExportBusy(false);
    }
  };
  const zoomIndex = ROADMAP_ZOOMS.indexOf(zoom);
  const pastRatio = Number.isFinite(layout.domain.start) ? Math.max(0, Math.min(1, (now - layout.domain.start) / (layout.domain.end - layout.domain.start))) : 0;
  const highlightedEntry = highlight ? entryMap.get(highlight.id) : null;
  const highlightedPhase = highlight ? layout.phases.find((entry) => entry.id === highlight.id) : null;
  const todayLabel = shortDate(now);
  const todayPillWidth = 38 + todayLabel.length * 12;

  return <div ref={rootRef} className="db-roadmap" data-testid="roadmap-view" data-locked={locked ? "true" : "false"} data-domain-start={layout.domain.start ?? ""} data-domain-end={layout.domain.end ?? ""} data-axis-x0={layout.axis.x0} data-axis-x1={layout.axis.x1} data-axis-y={layout.axis.y} data-dragging-entry={drag?.id || ""} data-drag-delta={drag?.deltaDays ?? 0}>
    <div className="db-roadmap-tools" role="toolbar" aria-label="时间脉络工具">
      <button type="button" disabled={locked} onClick={() => { changeConfig({ zoom: 1 }); scrollRef.current?.scrollTo({ left: 0 }); }}>适应全部</button>
      <button type="button" aria-label="放大" disabled={locked || zoomIndex === ROADMAP_ZOOMS.length - 1} onClick={() => changeConfig({ zoom: ROADMAP_ZOOMS[zoomIndex + 1] })}><IconPlus size={14}/></button>
      <button type="button" aria-label="缩小" disabled={locked || zoomIndex === 0} onClick={() => changeConfig({ zoom: ROADMAP_ZOOMS[zoomIndex - 1] })}><IconMinus size={14}/></button>
      <span className="db-roadmap-zoom">{Math.round(zoom * 100)}%</span>
      <button type="button" disabled={!layout.today} onClick={() => scrollRef.current?.scrollTo({ left: Math.max(0, layout.today.x - width / 2), behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" })}>今天</button>
      <button ref={exportButtonRef} type="button" aria-haspopup="dialog" aria-expanded={exportOpen} disabled={!nodes.length} onClick={() => { setExportOpen(!exportOpen); setExportError(""); }}><IconDownload size={14}/>导出</button>
    </div>
    {exportOpen && <div className="db-roadmap-export ui-popover" role="dialog" aria-label="导出时间脉络" onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); closeExport(); } }}>
      <strong>导出时间脉络</strong><label>背景<select aria-label="时间脉络导出背景" value={background} onChange={(event) => setBackground(event.target.value)}><option value="white">白色</option><option value="transparent">透明</option><option value="theme">跟随主题</option></select></label>
      <small>16:9 · PNG 3840 × 2160 · SVG 1920 × 1080</small>
      <div className="db-roadmap-export-actions"><button type="button" disabled={exportBusy} onClick={(event) => exportFile("png", event.currentTarget)}>下载 PNG</button><button type="button" disabled={exportBusy} onClick={(event) => exportFile("svg", event.currentTarget)}>下载 SVG</button><button type="button" onClick={closeExport}>关闭</button></div>
      {exportError && <p role="alert">{exportError}</p>}
    </div>}
    <div ref={scrollRef} className="db-roadmap-scroll">
      {!dateProperty ? <div className="db-roadmap-empty"><p>选择一个日期属性来生成时间脉络</p><select aria-label="时间脉络日期属性" value="" disabled={locked} onChange={(event) => changeConfig({ datePropertyId: event.target.value || null })}><option value="">选择日期属性</option>{source.properties.filter((property) => property.type === "date").map((property) => <option key={property.id} value={property.id}>{property.name}</option>)}</select></div> : !nodes.length ? <div className="db-roadmap-empty"><p>还没有带日期的记录</p><button type="button" disabled={locked} onClick={() => onCreateItem?.(source.id, {})}>新建记录</button></div> : <svg className="db-roadmap-svg" width={chartWidth} height={layout.height} viewBox={`0 0 ${chartWidth} ${layout.height}`} aria-label={`${source.title} 时间脉络`}>
        {layout.ticks.map((tick) => {
          const label = splitTickLabel(tick.label);
          return <g key={tick.t} aria-hidden="true"><line className="db-roadmap-tick-line" x1={tick.x} x2={tick.x} y1={0} y2={layout.height}/><text className={`db-roadmap-tick-label${label.small ? " is-year" : ""}`} x={tick.x + 10} y={label.small ? 26 : 30}><tspan>{label.numeral}</tspan><tspan className="db-roadmap-tick-unit" dx={2}>{label.unit}</tspan></text>{label.note && <text className="db-roadmap-tick-note" x={tick.x + 10} y={48}>{label.note}</text>}</g>;
        })}
        <line className="db-roadmap-axis" x1={layout.axis.x0} x2={layout.axis.x1} y1={layout.axis.y} y2={layout.axis.y}/>
        {pastRatio > 0 && <line className="db-roadmap-axis-past" x1={layout.axis.x0} x2={layout.axis.x0 + pastRatio * (layout.axis.x1 - layout.axis.x0)} y1={layout.axis.y} y2={layout.axis.y}/>}
        {nodes.map((entry, index) => <g key={entry.id} className={`db-roadmap-entry${highlight?.id === entry.id ? " is-highlighted" : ""}${drag?.id === entry.id ? " is-dragging" : ""}`} data-entry-id={entry.id} data-kind={entry.kind} tabIndex={0} role="button" aria-label={`${entry.title}，${dateLabel(entry)}`} aria-describedby={highlight?.id === entry.id ? `${clipPrefix}-details` : undefined} style={{ opacity: highlight && highlight.id !== entry.id ? 0.4 : 1 }} transform={drag?.id === entry.id ? `translate(${drag.deltaX} 0)` : undefined} onPointerEnter={(event) => showDetails(entry, event)} onPointerLeave={() => setHighlight(null)} onFocus={(event) => showDetails(entry, event)} onBlur={() => setHighlight(null)} onPointerDown={(event) => beginDrag(event, entry)} onClick={(event) => openEntry(entry, event)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpenItemPage?.(entry.pageId); } }}>
          <title>{`${entry.title}，${dateLabel(entry)}`}</title>
          {entry.kind === "phase" ? <PhaseDrawing phase={entry} clipId={`${clipPrefix}-phase-${index}`}/> : <MilestoneDrawing milestone={entry} axisY={layout.axis.y}/>}
        </g>)}
        {layout.today && <g aria-hidden="true" className="db-roadmap-today"><line x1={layout.today.x} x2={layout.today.x} y1={64} y2={layout.height - 26}/><circle cx={layout.today.x} cy={64} r={5}/><rect x={layout.today.x + 8} y={layout.height - 38} width={todayPillWidth} height={20} rx={10}/><text x={layout.today.x + 15} y={layout.height - 24}>今天 <tspan fontWeight={600}>{todayLabel}</tspan></text></g>}
      </svg>}
    </div>
    {dateProperty && layout.unscheduled.length > 0 && <details className="db-roadmap-unscheduled"><summary>未排期 {layout.unscheduled.length} 条</summary><div>{layout.unscheduled.map((id) => { const entry = entryMap.get(id); return <button key={id} type="button" onClick={() => onOpenItemPage?.(entry.pageId)}>{entry.title}</button>; })}</div></details>}
    {highlightedEntry && <div className="db-roadmap-details" role="tooltip" id={`${clipPrefix}-details`} aria-label="时间脉络详情" style={{ left: highlight.x, top: highlight.y }}><strong>{highlightedEntry.title}</strong><dl><div><dt>日期</dt><dd>{dateLabel(highlightedEntry)}</dd></div><div><dt>状态</dt><dd>{highlightedEntry.statusLabel || "未设置"}</dd></div><div><dt>进度</dt><dd>{highlightedEntry.progress !== null ? `${Math.round(highlightedEntry.progress * 100)}%` : highlightedPhase ? `${Math.round(highlightedPhase.fill * 100)}%（按时间）` : "未设置"}</dd></div></dl></div>}
  </div>;
}
