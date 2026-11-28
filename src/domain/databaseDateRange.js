import { dateMillis, normalizeDate } from "./databaseProperties.js";

export const DAY = 86400000;
export const isoDay = ms => new Date(ms).toISOString().slice(0, 10);
export const dayMs = value => Date.parse(String(value || "").slice(0, 10) + "T00:00:00Z");
const dated = (value, day) => day + String(value).slice(10);

export const RELATIVE_DATE_PERIODS = Object.freeze({
  yesterday: "昨天",
  today: "今天",
  tomorrow: "明天",
  after_today: "晚于今天",
  past_7_days: "过去 7 天（含今天）",
  next_7_days: "未来 7 天（含今天）",
  through_next_7_days: "截至 7 天后（含）",
  next_month: "未来一个月（含今天）",
  through_next_month: "截至一个月后（含）",
  past_12_months: "过去 12 个月（含今天）",
  this_week: "本周",
  this_month: "本月",
  this_year: "今年",
});

export const RELATIVE_DATE_TARGETS = Object.freeze({ overlap: "整个日期范围", start: "开始日期", end: "结束日期" });

export function relativeDateTarget(period, target) {
  return target ?? (period === "after_today" || period === "through_next_month" ? "start" : "overlap");
}

function shiftLocalMonths(date, count) {
  const month = new Date(date.getFullYear(), date.getMonth() + count, 1);
  const lastDay = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  month.setDate(Math.min(date.getDate(), lastDay));
  return month;
}

export function localDateWindow(period, now = new Date()) {
  if (!Object.hasOwn(RELATIVE_DATE_PERIODS, period)) return null;
  const year = now.getFullYear();
  const month = now.getMonth();
  const day = now.getDate();
  const start = new Date(year, month, day);
  if (period === "after_today") return [new Date(year, month, day + 1).getTime(), Infinity];
  if (period === "through_next_7_days") return [-Infinity, new Date(year, month, day + 8).getTime()];
  if (period === "through_next_month") {
    const cutoff = shiftLocalMonths(start, 1);
    cutoff.setDate(cutoff.getDate() + 1);
    return [-Infinity, cutoff.getTime()];
  }
  if (period === "past_12_months") return [shiftLocalMonths(start, -12).getTime(), new Date(year, month, day + 1).getTime()];
  if (period === "this_year") return [new Date(year, 0, 1).getTime(), new Date(year + 1, 0, 1).getTime()];
  if (period === "yesterday") start.setDate(start.getDate() - 1);
  if (period === "tomorrow") start.setDate(start.getDate() + 1);
  if (period === "past_7_days") start.setDate(start.getDate() - 6);
  if (period === "this_week") start.setDate(start.getDate() - (start.getDay() + 6) % 7);
  if (period === "this_month") start.setDate(1);
  if (period === "this_month" || period === "next_month") {
    return [start.getTime(), shiftLocalMonths(start, 1).getTime()];
  }
  const end = new Date(start);
  const days = ["past_7_days", "next_7_days", "this_week"].includes(period) ? 7 : 1;
  end.setDate(end.getDate() + days);
  return [start.getTime(), end.getTime()];
}

function localInstant(date, raw) {
  if (!/^\d{4}-\d\d-\d\d(?:T|$)/.test(raw)) return NaN;
  if (raw.length === 10) return new Date(raw + "T00:00:00").getTime();
  if (date.timeZone || /Z$|[+-]\d\d:?\d\d$/i.test(raw)) return dateMillis({ ...date, start: raw, includeTime: true });
  return new Date(raw).getTime();
}

export function matchesLocalDateWindow(value, window, dateTarget = "overlap") {
  const date = normalizeDate(value);
  if (!date || !window) return false;
  const start = localInstant(date, date.start);
  const end = date.end ? localInstant(date, date.end) : start;
  if (!(start <= end)) return false;
  if (dateTarget === "start") return start >= window[0] && start < window[1];
  if (dateTarget === "end") return end >= window[0] && end < window[1];
  return dateTarget === "overlap" && start < window[1] && end >= window[0];
}

export function overlapsLocalDateWindow(value, window) {
  return matchesLocalDateWindow(value, window);
}

export function shiftDate(value, delta) {
  const date = normalizeDate(value);
  if (!date?.start || !Number.isFinite(dayMs(date.start))) return date;
  const move = stamp => dated(stamp, isoDay(dayMs(stamp) + delta * DAY));
  return { ...date, start: move(date.start), end: date.end ? move(date.end) : null };
}

export function resizeDate(value, edge, day) {
  const date = normalizeDate(value);
  if (!date?.start || !Number.isFinite(dayMs(day))) return date;
  const end = date.end || date.start;
  if (edge === "start") {
    const start = dated(date.start, day > end.slice(0,10) ? end.slice(0,10) : day);
    return { ...date, start: start > end ? end : start, end };
  }
  const nextEnd = dated(end, day < date.start.slice(0,10) ? date.start.slice(0,10) : day);
  return { ...date, end: nextEnd < date.start ? date.start : nextEnd };
}

const spans = { hour:1, day:14, week:56, month:183, quarter:730, year:3653 };
export function scaleWindow(scale, center) {
  const days = spans[scale] || spans.week;
  const start = Math.floor(center / DAY - (days === 1 ? 0 : days/2)) * DAY;
  return { windowStart: isoDay(start), windowEnd: isoDay(start + (days - 1) * DAY) };
}

export function timelineWindow(ranges, config) {
  const dates = ranges.filter(d => Number.isFinite(dayMs(d?.start)));
  const first = dates.length ? Math.min(...dates.map(d => dayMs(d.start))) : Date.now();
  const last = dates.length ? Math.max(...dates.map(d => dayMs(d.end || d.start))) : first;
  const days = spans[config.scale] || spans.week;
  let start = dayMs(config.windowStart), end = dayMs(config.windowEnd);
  if (!Number.isFinite(start)) start = Number.isFinite(end) ? end - (days - 1) * DAY : dayMs(scaleWindow(config.scale, first + Math.min(last - first, days * DAY / 2) / 2).windowStart);
  if (!Number.isFinite(end)) end = start + (days - 1) * DAY;
  return { start, end: Math.max(start, end) + DAY };
}

export function timelineTicks({start, end}, scale) {
  const tick = new Date(start);
  if (scale === "year") tick.setUTCMonth(0,1);
  if (scale === "week") tick.setUTCDate(tick.getUTCDate() - (tick.getUTCDay() + 6) % 7);
  if (scale === "month" || scale === "quarter") tick.setUTCDate(1);
  if (scale === "quarter") tick.setUTCMonth(Math.floor(tick.getUTCMonth() / 3) * 3);
  const result = [];
  const nominalDays = { hour:1/24, day:1, week:7, month:30, quarter:91, year:365 }[scale] || 7;
  const stride = Math.max(1, Math.ceil((end - start) / DAY / nominalDays / 18));
  while (+tick < end) {
    const ms = +tick;
    const label = scale === "hour" ? String(tick.getUTCHours()).padStart(2,"0")+":00" : scale === "year" ? String(tick.getUTCFullYear())+"年" : scale === "quarter" ? tick.getUTCFullYear() + " Q" + (Math.floor(tick.getUTCMonth() / 3) + 1) : scale === "month" ? (tick.getUTCMonth() + 1) + "月" : (tick.getUTCMonth() + 1) + "/" + tick.getUTCDate();
    if (ms >= start) result.push({ ms, label, left: (ms - start) / (end - start) * 100 });
    if (scale === "hour") tick.setUTCHours(tick.getUTCHours()+stride);
    else if (scale === "year") tick.setUTCFullYear(tick.getUTCFullYear()+stride);
    else if (scale === "month" || scale === "quarter") tick.setUTCMonth(tick.getUTCMonth() + stride * (scale === "quarter" ? 3 : 1));
    else tick.setUTCDate(tick.getUTCDate() + stride * (scale === "week" ? 7 : 1));
  }
  return result;
}
