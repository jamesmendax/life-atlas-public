import { useEffect, useId, useMemo, useRef, useState } from "react";

const TONES = ["blue", "green", "orange", "purple"];
const DAY = 86_400_000;

function localDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function futureDate(days) {
  const dt = new Date();
  dt.setDate(dt.getDate() + days);
  return localDateKey(dt);
}

function defaultEvents() {
  return [
    { id: "e1", title: "国庆川西自驾之旅", date: futureDate(42), tone: "orange" },
    { id: "e2", title: "阶段性能力复盘", date: futureDate(14), tone: "blue" },
    { id: "e3", title: "今年目标收官日", date: `${new Date().getFullYear()}-12-31`, tone: "green" },
  ];
}

function normalizeState(raw, demonstration) {
  const events = Array.isArray(raw?.events) ? raw.events : demonstration ? defaultEvents() : [];
  return { events };
}

function timeProgress(now) {
  const yearStart = new Date(now.getFullYear(), 0, 1).getTime();
  const yearEnd = new Date(now.getFullYear() + 1, 0, 1).getTime();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
  const weekday = (now.getDay() + 6) % 7;
  const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - weekday).getTime();
  const weekEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() - weekday + 7).getTime();
  const pct = (a, b) => Math.max(0, Math.min(100, ((now.getTime() - a) / (b - a)) * 100));
  return [
    { id: "year", label: `${now.getFullYear()} 年`, value: pct(yearStart, yearEnd) },
    { id: "month", label: `${now.getMonth() + 1} 月`, value: pct(monthStart, monthEnd) },
    { id: "week", label: "本周", value: pct(weekStart, weekEnd) },
    { id: "day", label: "今日", value: pct(dayStart, dayEnd) },
  ];
}

export function LifeCountdownWidget({ state: rawState, onChange, locked = false, demonstration = false }) {
  const data = useMemo(() => normalizeState(rawState, demonstration), [rawState, demonstration]);
  const formId = useId();
  const addButton = useRef(null);
  const [now, setNow] = useState(() => new Date());
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(() => futureDate(30));

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const bars = useMemo(() => timeProgress(now), [now]);
  const today = localDateKey(now);
  const sortedEvents = useMemo(() => {
    const todayTime = Date.parse(today);
    const entries = data.events.map((event) => ({ ...event, days: (Date.parse(event.date) - todayTime) / DAY }));
    const rank = (days) => Number.isNaN(days) ? 2 : days < 0 ? 1 : 0;
    return entries.sort((a, b) => rank(a.days) - rank(b.days) || Math.abs(a.days) - Math.abs(b.days));
  }, [data.events, today]);

  function addEvent(event) {
    event.preventDefault();
    const label = title.trim();
    if (!label || !date || locked) return;
    const tone = TONES[data.events.length % TONES.length];
    onChange?.({ events: [...data.events, { id: `cd-${Date.now().toString(36)}`, title: label, date, tone }] });
    setTitle("");
    setAdding(false);
    addButton.current?.focus();
  }

  function removeEvent(id) {
    if (locked) return;
    onChange?.({ events: data.events.filter((e) => e.id !== id) });
  }

  return (
    <section
      className="mw-card mw-countdown"
      contentEditable={false}
      aria-label="时光进度条与重要倒计时"
      onMouseDown={(e) => e.stopPropagation()}
      onDragStart={(e) => e.preventDefault()}
    >
      <header className="mw-head">
        <div className="mw-head-title">
          <strong>时光进度与倒计时</strong>
          <time dateTime={today}>{now.toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric", weekday: "short" })}</time>
        </div>
        {!locked && <button type="button" ref={addButton} className="mw-btn mw-btn-primary"
          aria-expanded={adding} aria-controls={adding ? formId : undefined} onClick={() => setAdding((value) => !value)}>
          {adding ? "取消" : "+ 添加倒计时"}
        </button>}
      </header>

      <div className="mw-time-bars" role="group" aria-label="时间进度">
        {bars.map((b) => (
          <div key={b.id} className="mw-time-bar">
            <div className="mw-time-bar-head">
              <span>{b.label}</span>
              <b>{b.value.toFixed(1)}%</b>
            </div>
            <progress className="mw-bar-track" max="100" value={Number(b.value.toFixed(1))} aria-label={`${b.label}进度`} />
          </div>
        ))}
      </div>

      {adding && !locked && (
        <form id={formId} className="mw-cd-form" onSubmit={addEvent}>
          <label>
            <span>目标名称</span>
            <input type="text" className="mw-input" autoFocus required value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label>
            <span>目标日期</span>
            <input type="date" className="mw-input" required value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <button type="submit" className="mw-btn mw-btn-primary" disabled={!title.trim() || !date}>保存倒计时</button>
        </form>
      )}

      {sortedEvents.length ? <ul className="mw-cd-cards" aria-label="倒计时目标">
        {sortedEvents.map((item) => (
          <li key={item.id} className={`mw-cd-card is-${item.tone || "blue"}`}>
            <div className="mw-cd-meta">
              <strong>{item.title}</strong>
              <time dateTime={item.date}>{item.date}</time>
            </div>
            <div className="mw-cd-days">
              {item.days === 0 ? <b className="mw-cd-relative">今天</b> : Number.isFinite(item.days) ?
                <><b>{Math.abs(item.days)}</b><span>{item.days < 0 ? "天前" : "天后"}</span></> :
                <span>日期无效</span>}
            </div>
            {!locked && <button type="button" className="mw-btn-ghost" aria-label={`删除 ${item.title}`} title={`删除 ${item.title}`}
              onClick={() => removeEvent(item.id)}><span aria-hidden="true">×</span></button>}
          </li>
        ))}
      </ul> : <p className="mw-cd-empty">暂无倒计时目标。</p>}
    </section>
  );
}
