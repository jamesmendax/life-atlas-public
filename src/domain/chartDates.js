import { normalizeDate } from "./databaseProperties.js";
import { dayMs, isoDay } from "./databaseDateRange.js";
import { axisTime } from "./timelineDateFields.js";

export const CHART_DATE_INTERVALS = ["exact", "day", "week", "month", "quarter", "year"];

export function chartDateInterval(property, interval) {
  return property?.type === "date" && CHART_DATE_INTERVALS.includes(interval) ? interval : "exact";
}

function calendarDay(value) {
  const date = normalizeDate(value);
  if (!date) return NaN;
  const day = dayMs(date.start);
  if (!Number.isFinite(day) || isoDay(day) !== date.start.slice(0, 10)) return NaN;
  // Floating times and date-only values already carry the selected civil day.
  // Offset timestamps identify an instant and use the chosen or device zone.
  if (!date.includeTime || !/(?:z|[+-]\d{2}:?\d{2})$/i.test(date.start)) return day;
  const stamp = date.start.replace(/z$/i, "Z").replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const wall = axisTime(stamp, date.timeZone, date.timeZone || undefined);
  return Number.isFinite(wall) ? dayMs(isoDay(wall)) : NaN;
}

export function chartDateBucket(value, interval) {
  const day = calendarDay(value);
  if (!Number.isFinite(day)) return null;
  const start = new Date(day);
  const year = start.getUTCFullYear();
  const month = start.getUTCMonth();
  let label;
  if (interval === "week") {
    start.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 6) % 7);
    label = isoDay(start) + " 周起";
  } else if (interval === "month") {
    start.setUTCDate(1);
    label = `${year}年${month + 1}月`;
  } else if (interval === "quarter") {
    const quarter = Math.floor(month / 3);
    start.setUTCMonth(quarter * 3, 1);
    label = `${year}年第${quarter + 1}季度`;
  } else if (interval === "year") {
    start.setUTCMonth(0, 1);
    label = `${year}年`;
  } else {
    label = isoDay(start);
  }
  return { start: isoDay(start), order: start.getTime(), label };
}
