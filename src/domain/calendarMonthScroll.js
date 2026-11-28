import { calendarDays } from "./databaseProperties.js";
import { dayMs, isoDay } from "./databaseDateRange.js";

export function calendarMonth(anchor, delta = 0) {
  const ms = dayMs(anchor);
  if (!Number.isFinite(ms) || isoDay(ms) !== String(anchor).slice(0, 10)) return null;
  const date = new Date(ms);
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + delta);
  return isoDay(date);
}

export function openCalendarMonthWindow(month) {
  return { start: month, end: calendarMonth(month, 1) };
}

export function appendCalendarMonth(window) {
  const end = calendarMonth(window.end, 1);
  const start = end > calendarMonth(window.start, 2) ? calendarMonth(window.start, 1) : window.start;
  return { start, end };
}

export function monthWindowDays(window, startOfWeek) {
  const days = new Set();
  for (let month = window.start; month <= window.end; month = calendarMonth(month, 1)) {
    for (const day of calendarDays(month, startOfWeek, "month")) days.add(day);
  }
  return [...days];
}
