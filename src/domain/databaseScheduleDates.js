import { dateMillis, normalizeDate, normalizeDateTimeZone } from "./databaseProperties.js";
import { DAY, dayMs, isoDay } from "./databaseDateRange.js";
import { databaseScheduleError } from "./databaseSubitems.js";

const TIMESTAMP = /^(\d{4}-\d\d-\d\d)(?:T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?([zZ]|[+-](?:[01]\d|2[0-3]):?[0-5]\d)?)?$/;
const MINUTE = 60000;
const MONDAY = 4 * DAY;
const formatters = new Map();

function timed(date, stamp) {
  return date.includeTime && stamp.length > 10;
}

function explicitOffset(suffix) {
  if (suffix.toUpperCase() === "Z") return 0;
  const digits = suffix.slice(1).replace(":", "");
  return (suffix[0] === "-" ? -1 : 1) * (60 * Number(digits.slice(0, 2)) + Number(digits.slice(2))) * MINUTE;
}

function wallTime(date, stamp, instant) {
  const suffix = TIMESTAMP.exec(stamp)?.[2];
  if (!timed(date, stamp)) return instant;
  if (suffix) return instant + explicitOffset(suffix);
  const zone = normalizeDateTimeZone(date.timeZone);
  if (!zone) return instant;
  if (/^[+-]\d\d:\d\d$/.test(zone)) return instant + explicitOffset(zone);
  try {
    if (!formatters.has(zone)) formatters.set(zone, new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }));
    const fields = Object.fromEntries(formatters.get(zone).formatToParts(instant).map((field) => [field.type, field.value]));
    return dayMs(`${fields.year.padStart(4, "0")}-${fields.month}-${fields.day}`) + (3600 * Number(fields.hour) + 60 * Number(fields.minute) + Number(fields.second)) * 1000 + ((instant % 1000) + 1000) % 1000;
  } catch { return NaN; }
}

function instantFor(date, stamp) {
  const match = TIMESTAMP.exec(stamp);
  if (!match || !Number.isFinite(dayMs(match[1])) || isoDay(dayMs(match[1])) !== match[1]) return NaN;
  if (!timed(date, stamp)) return dateMillis({ ...date, start: stamp });
  const fraction = /\.(\d+)/.exec(stamp)?.[1];
  const withoutFraction = fraction ? stamp.replace(`.${fraction}`, "") : stamp;
  const millis = fraction ? Number(fraction.slice(0, 3).padEnd(3, "0")) : 0;
  const zone = normalizeDateTimeZone(date.timeZone);
  const hasNamedZone = zone && !/^[+-]\d\d:\d\d$/.test(zone) && !match[2];
  const instant = dateMillis({ ...date, start: withoutFraction }) + millis;
  if (!hasNamedZone) return instant;
  const wall = dateMillis({ ...date, timeZone: null, start: stamp });
  return wallTime(date, stamp, instant) === wall ? instant : NaN;
}

export function scheduleDate(value) {
  if (value == null || value === "") return null;
  const date = normalizeDate(value);
  const start = date ? instantFor(date, date.start) : NaN;
  const end = date?.end ? instantFor(date, date.end) : start;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    throw databaseScheduleError("invalid-dependency-date", "请输入有效日期，结束时间不能早于开始时间。");
  }
  return { date, start, end };
}

function wallToStamp(date, stamp, wall) {
  if (!Number.isFinite(wall)) return null;
  const year = new Date(wall).getUTCFullYear();
  if (year < 1 || year > 9999) return null;
  const iso = new Date(wall).toISOString();
  if (!timed(date, stamp)) return iso.slice(0, 10) + stamp.slice(10);
  const suffix = TIMESTAMP.exec(stamp)?.[2] || "";
  const sourcePrecision = stamp.length - suffix.length;
  const fractionalPrecision = sourcePrecision > 19 ? sourcePrecision - 20 : 0;
  const milliseconds = ((wall % 1000) + 1000) % 1000;
  const neededFractional = milliseconds ? String(milliseconds).padStart(3, "0").replace(/0+$/, "").length : 0;
  const fraction = Math.max(fractionalPrecision, neededFractional);
  const precision = fraction ? 20 + fraction : sourcePrecision >= 19 || wall % MINUTE ? 19 : 16;
  return iso.slice(0, precision) + (fraction > 3 ? stamp.slice(23, sourcePrecision) : "") + suffix;
}

function dayFloor(tick) {
  return Math.floor(tick / DAY) * DAY;
}

function workTime(wall) {
  const week = Math.floor((wall - MONDAY) / (7 * DAY));
  return week * 5 * DAY + Math.min((wall - MONDAY) - week * 7 * DAY, 5 * DAY);
}

function workWall(tick) {
  const week = Math.floor(tick / (5 * DAY));
  return MONDAY + tick + week * 2 * DAY;
}

function scheduleBoundary(next, previous, localClock) {
  const last = previous.date.end || previous.date.start;
  const endTimed = timed(previous.date, last);
  const startTimed = timed(next.date, next.date.start);
  if (!startTimed) return dayMs(last) + DAY;
  if (endTimed) return localClock ? wallTime(next.date, next.date.start, previous.end) : previous.end;
  const dayAfter = dayMs(last) + DAY;
  if (localClock) return dayAfter;
  const stamp = wallToStamp(next.date, next.date.start, dayAfter);
  return stamp ? instantFor(next.date, stamp) : NaN;
}

export function scheduleSuccessor(current, predecessors, mode, skipWeekends) {
  const first = current.date.start;
  const toClock = skipWeekends ? workTime : (tick) => tick;
  const toWall = skipWeekends ? workWall : (tick) => tick;
  const initial = skipWeekends ? wallTime(current.date, first, current.start) : current.start;
  const initialClock = toClock(initial);
  let targetClock = -Infinity;
  for (const { before, after, changed } of predecessors) {
    const oldBoundary = scheduleBoundary(current, before, skipWeekends);
    const boundary = scheduleBoundary(current, after, skipWeekends);
    if (!Number.isFinite(oldBoundary) || !Number.isFinite(boundary)) throw databaseScheduleError("invalid-dependency-date", "无法转换前置记录的结束时间。");
    if (mode === "overlap" && boundary <= initial) continue;
    const gap = mode === "preserve-gap" && changed ? Math.max(0, initialClock - toClock(oldBoundary)) : 0;
    targetClock = Math.max(targetClock, toClock(boundary) + gap);
  }
  if (targetClock === -Infinity) return current;
  const target = toWall(targetClock);
  if (target === initial) return current;
  const targetWall = skipWeekends ? target : wallTime(current.date, first, target);
  const shiftedStart = wallToStamp(current.date, first, targetWall);
  const start = shiftedStart ? instantFor(current.date, shiftedStart) : NaN;
  const last = current.date.end;
  let shiftedEnd = null;
  if (last && Number.isFinite(start)) {
    const endWall = wallTime(current.date, last, current.end);
    const duration = toClock(endWall) - initialClock;
    const endpoint = skipWeekends ? toWall(toClock(targetWall) + duration) : wallTime(current.date, last, start + current.end - current.start);
    shiftedEnd = wallToStamp(current.date, last, timed(current.date, last) ? endpoint : dayFloor(endpoint));
  }
  if (!Number.isFinite(start) || (!skipWeekends && start !== target) || (last && !shiftedEnd)) throw databaseScheduleError("invalid-dependency-date", "自动排期超出可用日期或遇到无效的当地时间。");
  return scheduleDate({ ...current.date, start: shiftedStart, end: shiftedEnd });
}
