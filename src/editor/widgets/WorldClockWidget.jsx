import { useEffect, useMemo, useState } from "react";

const CITY_CATALOG = [
  { id: "Asia/Shanghai", label: "北京 / 上海" },
  { id: "Asia/Tokyo", label: "东京" },
  { id: "Europe/London", label: "伦敦" },
  { id: "America/New_York", label: "纽约" },
  { id: "Australia/Sydney", label: "悉尼" },
  { id: "Europe/Paris", label: "巴黎" },
  { id: "Asia/Singapore", label: "新加坡" },
  { id: "America/Los_Angeles", label: "旧金山" },
];

const DEFAULT_CITIES = ["Asia/Shanghai", "Asia/Tokyo", "Europe/London", "America/New_York"];

function normalizeState(raw) {
  const cities = Array.isArray(raw?.cities) && raw.cities.length
    ? raw.cities.filter((id) => CITY_CATALOG.some((c) => c.id === id))
    : DEFAULT_CITIES;
  return { cities: cities.length ? cities : DEFAULT_CITIES };
}

function getZoneParts(date, timeZone) {
  try {
    const parts = new Intl.DateTimeFormat("zh-CN", {
      timeZone,
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
      timeZoneName: "shortOffset",
    }).formatToParts(date);
    const get = (type) => parts.find((p) => p.type === type)?.value || "00";
    const hour = Number(get("hour")) % 24;
    const minute = Number(get("minute"));
    return {
      hour,
      minute,
      time: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
      dateText: `${get("month")}/${get("day")} ${get("weekday")}`,
      isDay: hour >= 6 && hour < 19,
      offset: get("timeZoneName").replace("GMT", "UTC"),
    };
  } catch {
    return { hour: 12, minute: 0, time: "12:00", dateText: "--/--", isDay: true, offset: "" };
  }
}

export function WorldClockWidget({ state: rawState, onChange, locked = false }) {
  const data = useMemo(() => normalizeState(rawState), [rawState]);
  const [now, setNow] = useState(() => Date.now());
  const [offsetHours, setOffsetHours] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const displayDate = useMemo(() => new Date(now + offsetHours * 3600_000), [now, offsetHours]);
  const offsetLabel = offsetHours === 0 ? "现在" : `${Math.abs(offsetHours)} 小时${offsetHours < 0 ? "前" : "后"}`;

  function toggleCity(id) {
    if (locked) return;
    const exists = data.cities.includes(id);
    if (exists && data.cities.length <= 1) return;
    const next = exists ? data.cities.filter((c) => c !== id) : [...data.cities, id];
    onChange?.({ ...data, cities: next });
  }

  return (
    <section
      className="mw-card mw-clock"
      contentEditable={false}
      aria-label="世界时钟与跨区换算"
      onMouseDown={(e) => e.stopPropagation()}
      onDragStart={(e) => e.preventDefault()}
    >
      <header className="mw-head">
        <div className="mw-head-title">
          <strong>世界时钟</strong>
        </div>
        {!locked && <small className="mw-clock-count">{data.cities.length} 个城市</small>}
      </header>

      <ul className="mw-clock-grid" aria-label={`各地时间 · ${offsetLabel}`}>
        {data.cities.map((tz) => {
          const city = CITY_CATALOG.find((c) => c.id === tz);
          const parts = getZoneParts(displayDate, tz);
          const hourAngle = (parts.hour % 12) * 30 + parts.minute * 0.5;
          const minAngle = parts.minute * 6;
          return (
            <li key={tz} className={`mw-clock-tile${parts.isDay ? " is-day" : " is-night"}`}>
              <div className="mw-clock-tile-head">
                <strong className="mw-clock-city">{city.label}</strong>
                <small className="mw-clock-offset">{parts.offset}</small>
              </div>
              <svg className="mw-clock-dial" viewBox="0 0 48 48" aria-hidden="true">
                <circle cx="24" cy="24" r="21" className="mw-dial-ring" />
                <path d="M24 5.5v3m18.5 15.5h-3M24 42.5v-3M5.5 24h3" className="mw-dial-ticks" />
                <line x1="24" y1="24" x2="24" y2="13" className="mw-dial-hour" transform={`rotate(${hourAngle} 24 24)`} />
                <line x1="24" y1="24" x2="24" y2="8" className="mw-dial-min" transform={`rotate(${minAngle} 24 24)`} />
                <circle cx="24" cy="24" r="2" className="mw-dial-dot" />
              </svg>
              <div className="mw-clock-meta">
                <time className="mw-clock-time" dateTime={displayDate.toISOString()}>{parts.time}</time>
                <small>{parts.dateText} · {parts.isDay ? "白天" : "夜晚"}</small>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="mw-clock-travel">
        <label className="mw-clock-slider">
          <span className="mw-clock-slider-head"><strong>时间换算</strong><b>{offsetLabel}</b></span>
          <input
            type="range"
            min="-12"
            max="12"
            step="1"
            value={offsetHours}
            style={{ "--mw-clock-position": `${((offsetHours + 12) / 24) * 100}%` }}
            aria-label="跨时区时间偏移"
            aria-valuetext={offsetLabel}
            onChange={(e) => setOffsetHours(Number(e.target.value))}
          />
          <span aria-hidden="true" className="mw-clock-slider-ticks"><span>−12 小时</span><span>现在</span><span>+12 小时</span></span>
        </label>
        <button type="button" className="mw-btn" disabled={offsetHours === 0} onClick={() => setOffsetHours(0)}>回到现在</button>
      </div>

      {!locked && (
        <details className="mw-clock-cities">
          <summary>选择显示的城市</summary>
          <div className="mw-chip-list" role="group" aria-label="城市">
            {CITY_CATALOG.map((city) => {
              const active = data.cities.includes(city.id);
              return (
                <button key={city.id} type="button" className={`mw-chip${active ? " is-active" : ""}`}
                  aria-pressed={active} disabled={active && data.cities.length === 1}
                  onClick={() => toggleCity(city.id)}>
                  {active && <span aria-hidden="true">✓ </span>}{city.label}
                </button>
              );
            })}
          </div>
        </details>
      )}
    </section>
  );
}
