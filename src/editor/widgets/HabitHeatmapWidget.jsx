import { useId, useMemo, useRef, useState } from "react";
import { isComposingKeyboardEvent } from "../../ui/keyboard.js";

const THEMES = [
  { id: "emerald", label: "翡翠绿" },
  { id: "cobalt", label: "钴海蓝" },
  { id: "amber", label: "琥珀橙" },
  { id: "violet", label: "紫罗兰" },
];
const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];

function formatDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function buildDemoLogs() {
  const logs = {};
  const today = new Date();
  for (let i = 0; i < 110; i += 1) {
    const dt = new Date(today);
    dt.setDate(today.getDate() - i);
    const seed = (i * 17 + 5) % 11;
    if (i < 6) logs[formatDateKey(dt)] = (i % 3) + 1;
    else if (seed >= 4) logs[formatDateKey(dt)] = (seed % 3) + 1;
  }
  return logs;
}

function createDefaultState(demonstration) {
  return {
    theme: "emerald",
    activeHabitId: "focus",
    habits: [
      { id: "focus", name: "深度专注学习", target: 3, unit: "番茄", logs: demonstration ? buildDemoLogs() : {} },
      { id: "read", name: "每日阅读 30 分", target: 2, unit: "节", logs: {} },
      { id: "sport", name: "规律运动打卡", target: 1, unit: "次", logs: {} },
    ],
  };
}

function normalizeState(raw, demonstration) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.habits) || !raw.habits.length) {
    return createDefaultState(demonstration);
  }
  return {
    theme: THEMES.some((t) => t.id === raw.theme) ? raw.theme : "emerald",
    activeHabitId: raw.habits.some((h) => h.id === raw.activeHabitId) ? raw.activeHabitId : raw.habits[0].id,
    habits: raw.habits.map((h) => ({
      id: String(h.id || "habit"),
      name: String(h.name || "每日习惯"),
      target: Math.max(1, Math.min(10, Number(h.target) || 1)),
      unit: String(h.unit || "次"),
      logs: h.logs && typeof h.logs === "object" ? h.logs : {},
    })),
  };
}

export function HabitHeatmapWidget({ state: rawState, onChange, locked = false, compact = false, demonstration = false }) {
  const data = useMemo(() => normalizeState(rawState, demonstration), [rawState, demonstration]);
  const formId = useId();
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [hoveredDate, setHoveredDate] = useState(null);
  const [focusedDate, setFocusedDate] = useState(null);
  const [gridFocused, setGridFocused] = useState(false);
  const grid = useRef(null);
  const addButton = useRef(null);

  const habit = data.habits.find((h) => h.id === data.activeHabitId) || data.habits[0];
  const todayKey = formatDateKey(new Date());
  const todayCount = Number(habit.logs[todayKey] || 0);
  const inspectedDate = hoveredDate || (gridFocused ? focusedDate : todayKey) || todayKey;
  const inspectedCount = Number(habit.logs[inspectedDate] || 0);

  const weeks = useMemo(() => {
    const cols = compact ? 18 : 26;
    const end = new Date();
    end.setHours(0, 0, 0, 0);
    const start = new Date(end);
    start.setDate(end.getDate() - (cols * 7 - 1));
    // Align to Monday
    const day = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - day);
    const columns = [];
    const cursor = new Date(start);
    while (cursor <= end) {
      const col = [];
      for (let d = 0; d < 7; d += 1) {
        const key = formatDateKey(cursor);
        const inFuture = cursor > end;
        const count = inFuture ? 0 : Number(habit.logs[key] || 0);
        const ratio = count / Math.max(1, habit.target);
        const level = count <= 0 ? 0 : ratio >= 1 ? 4 : ratio >= 0.66 ? 3 : ratio >= 0.33 ? 2 : 1;
        col.push({ key, count, level, inFuture, month: cursor.getMonth() + 1, dayOfMonth: cursor.getDate() });
        cursor.setDate(cursor.getDate() + 1);
      }
      columns.push(col);
    }
    return columns;
  }, [habit, compact, todayKey]);

  const entryDate = focusedDate >= weeks[0][0].key && focusedDate <= todayKey ? focusedDate : todayKey;

  function moveOnGrid(event, week, weekday) {
    if (event.altKey || event.metaKey || event.shiftKey || isComposingKeyboardEvent(event)
      || event.ctrlKey && event.key !== "Home" && event.key !== "End") return;
    const lastWeek = weeks.length - 1;
    const lastWeekday = weeks[lastWeek].findLastIndex((cell) => !cell.inFuture);
    switch (event.key) {
      case "ArrowLeft": week--; break;
      case "ArrowRight": week++; break;
      case "ArrowUp": weekday--; break;
      case "ArrowDown": weekday++; break;
      case "Home":
        week = 0;
        if (event.ctrlKey) weekday = 0;
        break;
      case "End":
        if (event.ctrlKey) weekday = lastWeekday;
        week = weekday <= lastWeekday ? lastWeek : lastWeek - 1;
        break;
      default: return;
    }
    event.preventDefault();
    const next = weeks[week]?.[weekday];
    if (next && !next.inFuture) grid.current.querySelector(`[data-date="${next.key}"]`)?.focus();
  }

  const metrics = useMemo(() => {
    let streak = 0;
    let best = 0;
    let running = 0;
    let streakOpen = true;
    let recent30 = 0;
    let total = 0;
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    for (const v of Object.values(habit.logs)) total += Number(v || 0);
    for (let i = 0; i < 365; i += 1) {
      const dt = new Date(now);
      dt.setDate(now.getDate() - i);
      const count = Number(habit.logs[formatDateKey(dt)] || 0);
      if (i < 30 && count > 0) recent30 += 1;
      if (count > 0) {
        running += 1;
        if (streakOpen) streak += 1;
        if (running > best) best = running;
      } else {
        if (i === 0) continue;
        streakOpen = false;
        running = 0;
      }
    }
    return { streak, best, rate30: Math.round((recent30 / 30) * 100), total };
  }, [habit.logs, todayKey]);

  function patch(next) {
    if (locked) return;
    onChange?.({ ...data, ...next });
  }

  function setDayCount(key, nextCount) {
    if (locked) return;
    const logs = { ...habit.logs };
    if (nextCount <= 0) delete logs[key];
    else logs[key] = Math.min(habit.target + 2, nextCount);
    patch({ habits: data.habits.map((h) => (h.id === habit.id ? { ...h, logs } : h)) });
  }

  function addHabit(event) {
    event.preventDefault();
    const title = newName.trim();
    if (!title || locked) return;
    const id = `h-${Date.now().toString(36)}`;
    patch({
      activeHabitId: id,
      habits: [...data.habits, { id, name: title, target: 1, unit: "次", logs: { [todayKey]: 1 } }],
    });
    setNewName("");
    setAdding(false);
    addButton.current?.focus();
  }

  return (
    <section
      className={`mw-card mw-heatmap${compact ? " is-compact" : ""}`}
      data-hm-theme={data.theme}
      contentEditable={false}
      aria-label="习惯打卡热力日历图"
      onMouseDown={(e) => e.stopPropagation()}
      onDragStart={(e) => e.preventDefault()}
    >
      <header className="mw-head">
        <div className="mw-head-title">
          <strong>习惯打卡</strong>
        </div>
        {!locked && <button ref={addButton} type="button" className="mw-btn" aria-expanded={adding}
          aria-controls={adding ? formId : undefined} onClick={() => setAdding((v) => !v)}>
          {adding ? "取消" : "+ 新习惯"}
        </button>}
      </header>

      <div className="mw-chip-list mw-hm-habits" role="group" aria-label="选择习惯">
        {data.habits.map((item) => (
          <button key={item.id} type="button"
            className={`mw-chip${item.id === habit.id ? " is-active" : ""}`}
            aria-pressed={item.id === habit.id} disabled={locked}
            onClick={() => patch({ activeHabitId: item.id })}>
            {item.name}
          </button>
        ))}
      </div>

      {adding && !locked && (
        <form id={formId} className="mw-hm-form" onSubmit={addHabit}>
          <label>
            <span>习惯名称</span>
            <input type="text" className="mw-input" autoFocus required value={newName}
              maxLength={24} onChange={(e) => setNewName(e.target.value)} />
          </label>
          <button type="submit" className="mw-btn mw-btn-primary" disabled={!newName.trim()}>添加并打卡</button>
        </form>
      )}

      <div className="mw-hm-today">
        <div className="mw-hm-progress">
          <div><span>今日进度</span><strong>{todayCount} / {habit.target} {habit.unit}</strong></div>
          <progress aria-label="今天的打卡进度" value={Math.min(todayCount, habit.target)} max={habit.target} />
        </div>
        {!locked && <div className="mw-foot-actions">
          <button type="button" className="mw-btn mw-btn-primary" disabled={todayCount >= habit.target + 2}
            onClick={() => setDayCount(todayKey, todayCount + 1)}>+ 今日打卡</button>
          <button type="button" className="mw-btn" disabled={todayCount <= 0}
            onClick={() => setDayCount(todayKey, todayCount - 1)}>撤销今日</button>
        </div>}
      </div>

      <div className="mw-hm-report">
        <div className="mw-hm-wrap">
          <div className="mw-hm-scroll">
            <div ref={grid} className="mw-hm-grid" role="grid" aria-label={`${habit.name}热力图`}
              style={{ "--mw-hm-weeks": weeks.length }} onFocus={() => setGridFocused(true)}
              onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setGridFocused(false); }}>
              <div className="mw-hm-row" aria-hidden="true">
                <span />
                {weeks.map(([first]) => (
                  <span key={first.key} className="mw-hm-month">
                    {first.dayOfMonth <= 7 && <span>{first.month}月</span>}
                  </span>
                ))}
              </div>
              {WEEKDAYS.map((day, weekday) => (
                <div key={day} className="mw-hm-row" role="row">
                  <span aria-hidden="true" className="mw-hm-weekday">{day}</span>
                  {weeks.map((week, weekIndex) => {
                    const cell = week[weekday];
                    const action = cell.count >= habit.target ? "清除此日打卡" : "增加一次打卡";
                    return <div key={cell.key} role="gridcell"><button
                      type="button"
                      disabled={cell.inFuture}
                      aria-disabled={!cell.inFuture && locked || undefined}
                      data-date={cell.key}
                      tabIndex={cell.key === entryDate ? 0 : -1}
                      className={`mw-hm-cell lv-${cell.level}${cell.key === todayKey ? " is-today" : ""}${cell.inFuture ? " is-future" : ""}`}
                      title={`${cell.key}：${cell.count} ${habit.unit}`}
                      aria-label={`${cell.key}，${cell.count} / ${habit.target} ${habit.unit}${locked || cell.inFuture ? "" : `，${action}`}`}
                      onFocus={() => setFocusedDate(cell.key)}
                      onKeyDown={(event) => moveOnGrid(event, weekIndex, weekday)}
                      onMouseEnter={() => { if (!cell.inFuture) setHoveredDate(cell.key); }}
                      onMouseLeave={() => setHoveredDate(null)}
                      onClick={() => setDayCount(cell.key, cell.count >= habit.target ? 0 : cell.count + 1)}
                    /></div>;
                  })}
                </div>
              ))}
            </div>
          </div>
          <div className="mw-hm-foot">
            <small><time dateTime={inspectedDate}>{inspectedDate}</time> · {inspectedCount} / {habit.target} {habit.unit}</small>
            <div className="mw-hm-legend" aria-label="图例：由未打卡到达标">
              未打卡
              {[0, 1, 2, 3, 4].map((level) => <span key={level} className={`mw-hm-cell lv-${level}`} aria-hidden="true" />)}
              达标
            </div>
          </div>
          {!locked && <div className="mw-hm-chart-controls">
            <small>选日期补卡，达标后再选可清空。</small>
            <div className="mw-hm-themes" role="group" aria-label="颜色主题">
              {THEMES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={`mw-swatch mw-hm-swatch-${t.id}${data.theme === t.id ? " is-active" : ""}`}
                  title={t.label}
                  aria-label={t.label}
                  aria-pressed={data.theme === t.id}
                  onClick={() => patch({ theme: t.id })}
                />
              ))}
            </div>
          </div>}
        </div>

        <div className="mw-kpi-row">
          <div className="mw-kpi"><b>{metrics.streak} 天</b><span>当前连续</span></div>
          <div className="mw-kpi"><b>{metrics.best} 天</b><span>最长连续</span></div>
          <div className="mw-kpi"><b>{metrics.rate30}%</b><span>近 30 天打卡率</span></div>
          <div className="mw-kpi"><b>{metrics.total} {habit.unit}</b><span>累计打卡</span></div>
        </div>
      </div>
    </section>
  );
}
