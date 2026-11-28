import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { calendarDays, formatDateLabel, localDay, normalizeDate, normalizeDateTimeZone, validatePropertyValue } from "../domain/databaseProperties.js";

function parsedInput(value) {
  const text = String(value).trim().replace(" ", "T");
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(text);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const instant = new Date(Date.UTC(year, month - 1, day));
  if (instant.getUTCFullYear() !== year || instant.getUTCMonth() !== month - 1 || instant.getUTCDate() !== day || Number(match[4] || 0) > 23 || Number(match[5] || 0) > 59) return null;
  return { text, includeTime: Boolean(match[4]) };
}

export function DatePicker({ value, onChange, label, disabled = false, triggerContent }) {
  const date = normalizeDate(value);
  const [open, setOpen] = useState(false);
  const [startText, setStartText] = useState(date?.start || ""), [endText, setEndText] = useState(date?.end || "");
  const [timeZoneText, setTimeZoneText] = useState(date?.timeZone || "");
  const [rangeEnabled, setRangeEnabled] = useState(Boolean(date?.end));
  const [awaitingEnd, setAwaitingEnd] = useState(false);
  const [anchor, setAnchor] = useState(date?.start?.slice(0, 10) || localDay());
  const [error, setError] = useState("");
  const [position, setPosition] = useState({ left: 8, top: 8 });
  const detailsRef = useRef(null), summaryRef = useRef(null), startRef = useRef(null), panelRef = useRef(null);
  useEffect(() => { setStartText(date?.start || ""); setEndText(date?.end || ""); if (date?.end) setRangeEnabled(true); }, [date?.start, date?.end]);
  useEffect(() => { setTimeZoneText(date?.timeZone || ""); }, [date?.timeZone]);
  useEffect(() => { if (open) { setAnchor(date?.start?.slice(0, 10) || localDay()); setAwaitingEnd(false); startRef.current?.focus(); } }, [open]);
  useLayoutEffect(() => {
    if (!open) return undefined;
    const place = () => {
      const bounds = summaryRef.current?.getBoundingClientRect(), panel = panelRef.current;
      if (!bounds || !panel) return;
      const left = Math.max(8, Math.min(bounds.left, window.innerWidth - panel.offsetWidth - 8));
      const top = window.innerHeight - bounds.bottom - 8 >= panel.offsetHeight ? bounds.bottom + 4 : Math.max(8, bounds.top - panel.offsetHeight - 4);
      setPosition((current) => current.left === left && current.top === top ? current : { left, top });
    };
    place();
    window.addEventListener("resize", place);
    document.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); document.removeEventListener("scroll", place, true); };
  }, [open, rangeEnabled, date?.includeTime, error]);
  useEffect(() => {
    if (!open) return undefined;
    const outside = (event) => { if (!detailsRef.current?.contains(event.target)) setOpen(false); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  const close = () => { setOpen(false); summaryRef.current?.focus(); };
  const update = (patch) => {
    if (disabled) return false;
    const next = { ...date, start: date?.start || "", end: date?.end || null, includeTime: date?.includeTime || false, timeZone: date?.timeZone || null, ...patch };
    if (!next.start) { onChange(null); setError(""); return true; }
    if (next.timeZone) { try { new Intl.DateTimeFormat("en", { timeZone: normalizeDateTimeZone(next.timeZone) }); } catch { setError("请输入有效的时区"); return false; } }
    const issue = validatePropertyValue({ type: "date" }, next);
    setError(issue || "");
    if (!issue) onChange(next);
    return !issue;
  };
  const changeText = (text, end = false) => {
    (end ? setEndText : setStartText)(text);
    if (!text.trim()) { update(end ? { end: null } : { start: "" }); return; }
    const parsed = parsedInput(text);
    if (!parsed) { setError("日期格式或时区无效"); return; }
    if (update({ [end ? "end" : "start"]: parsed.text, includeTime: parsed.includeTime || date?.includeTime || false })) {
      if (!end) setAnchor(parsed.text.slice(0, 10));
    }
  };
  const chooseDay = (day) => {
    const time = date?.includeTime ? `T${date?.start?.slice(11, 16) || "09:00"}` : "";
    if (!rangeEnabled || !awaitingEnd) { update({ start: `${day}${time}`, end: null }); setStartText(`${day}${time}`); setEndText(""); setAwaitingEnd(rangeEnabled); }
    else {
      const first = date?.start?.slice(0, 10) || day;
      const [start, end] = first <= day ? [first, day] : [day, first];
      update({ start: `${start}${time}`, end: `${end}${time}` });
      setStartText(`${start}${time}`); setEndText(`${end}${time}`); setAwaitingEnd(false);
    }
  };
  const shiftMonth = (delta) => { const instant = new Date(`${anchor.slice(0, 7)}-01T00:00:00Z`); instant.setUTCMonth(instant.getUTCMonth() + delta); setAnchor(instant.toISOString().slice(0, 10)); };
  const days = calendarDays(anchor, 1, "month");
  const today = localDay();
  const reminderLabel = `提醒 · ${label.includes(" · ") ? label.split(" · ").slice(1).join(" · ") : label}`;
  return <details ref={detailsRef} className="db-date-picker" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary ref={summaryRef} aria-label={`${label} 日期`} title={triggerContent ? `${label} 日期` : undefined} aria-disabled={disabled || undefined} onClick={(event) => { if (disabled) event.preventDefault(); }}>{triggerContent ?? (formatDateLabel(date) || <span className="db-empty-value">—</span>)}</summary>
    {open && <div ref={panelRef} className="db-date-panel" style={position} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); summaryRef.current?.closest("td[data-property-id]")?.focus(); } }}>
      <input ref={startRef} className="db-date-text" type="text" aria-label={`${label} 开始`} placeholder="YYYY-MM-DD" value={startText} disabled={disabled} onChange={(event) => changeText(event.target.value)} />
      {rangeEnabled && <input className="db-date-text" type="text" aria-label={`${label} 结束`} placeholder="YYYY-MM-DD" value={endText} disabled={disabled} onChange={(event) => changeText(event.target.value, true)} />}
      <div className="db-date-calendar-header"><strong>{Number(anchor.slice(0, 4))}年{Number(anchor.slice(5, 7))}月</strong><button type="button" aria-label="上个月" onClick={() => shiftMonth(-1)}>‹</button><button type="button" aria-label="下个月" onClick={() => shiftMonth(1)}>›</button></div>
      <div className="db-date-weekdays" aria-hidden="true">{["一", "二", "三", "四", "五", "六", "日"].map((day) => <span key={day}>{day}</span>)}</div>
      <div className="db-date-calendar">{days.map((day) => <button type="button" key={day} aria-label={day} aria-pressed={day === date?.start?.slice(0, 10) || day === date?.end?.slice(0, 10)} aria-current={day === today ? "date" : undefined} className={`${day.slice(0, 7) !== anchor.slice(0, 7) ? "is-outside " : ""}${date?.end && day > date.start.slice(0, 10) && day < date.end.slice(0, 10) ? "is-range" : ""}`} onClick={() => chooseDay(day)}>{Number(day.slice(8, 10))}</button>)}</div>
      <label className="db-picker-switch">结束日期<input type="checkbox" role="switch" aria-label={`${label} 结束日期`} checked={rangeEnabled} disabled={disabled} onChange={(event) => { setRangeEnabled(event.target.checked); setAwaitingEnd(false); if (!event.target.checked) { setEndText(""); update({ end: null }); } }} /></label>
      <label className="db-picker-switch">包含时间<input type="checkbox" role="switch" aria-label={`${label} 包含时间`} checked={date?.includeTime || false} disabled={!date?.start || disabled} onChange={(event) => update({ includeTime: event.target.checked, start: event.target.checked ? `${date.start.slice(0, 10)}T${date.start.slice(11, 16) || "09:00"}` : date.start.slice(0, 10), end: date.end ? event.target.checked ? `${date.end.slice(0, 10)}T${date.end.slice(11, 16) || "09:00"}` : date.end.slice(0, 10) : null })} /></label>
      {date?.includeTime && <label className="db-picker-field">时区<input aria-label={`${label} 时区`} type="text" value={timeZoneText} disabled={disabled} placeholder="Europe/Berlin" onChange={(event) => { setTimeZoneText(event.target.value); update({ timeZone: event.target.value || null }); }} /></label>}
      <label className="db-picker-field">提醒<select className="db-reminder-select" aria-label={reminderLabel} value={date?.reminder?.offset || ""} disabled={disabled || !date?.start} onChange={(event) => update({ reminder: event.target.value ? { ...date?.reminder, offset: event.target.value, id: date?.reminder?.id || `rem-${globalThis.crypto.randomUUID()}` } : null })}><option value="">无提醒</option><option value="atTime">准时</option><option value="5m">提前 5 分钟</option><option value="1h">提前 1 小时</option><option value="1d">提前 1 天</option></select></label>
      <button type="button" className="db-picker-clear" aria-label={`清除 ${label}`} onClick={() => { setStartText(""); setEndText(""); setRangeEnabled(false); update({ start: "" }); }}>清除</button>
      {error && <small role="alert" className="db-field-error">{error}</small>}
    </div>}
  </details>;
}
