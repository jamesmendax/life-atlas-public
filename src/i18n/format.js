import { LOCALE_METADATA, normalizeLocale } from "./locales.js";
import { getActiveLocale } from "./core.js";

function toValidDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDate(value, locale = getActiveLocale(), options = {}) {
  const date = toValidDate(value);
  if (!date) return "—";
  const resolved = normalizeLocale(locale);
  try {
    return new Intl.DateTimeFormat(resolved, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      ...options,
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

export function formatDateTime(value, locale = getActiveLocale(), options = {}) {
  const date = toValidDate(value);
  if (!date) return "—";
  const resolved = normalizeLocale(locale);
  const meta = LOCALE_METADATA[resolved];
  try {
    return new Intl.DateTimeFormat(resolved, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: options.includeSeconds ? "2-digit" : undefined,
      hour12: options.hour12 ?? meta?.hour12 ?? false,
      ...options,
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 16).replace("T", " ");
  }
}

export function formatNumber(value, locale = getActiveLocale(), options = {}) {
  if (typeof value !== "number" || !Number.isFinite(value)) return String(value ?? "");
  const resolved = normalizeLocale(locale);
  try {
    return new Intl.NumberFormat(resolved, options).format(value);
  } catch {
    return String(value);
  }
}

export function formatCurrency(amount, currency, locale = getActiveLocale(), options = {}) {
  if (typeof amount !== "number" || !Number.isFinite(amount)) return String(amount ?? "");
  const resolved = normalizeLocale(locale);
  const resolvedCurrency = currency || LOCALE_METADATA[resolved]?.currency || "USD";
  try {
    return new Intl.NumberFormat(resolved, {
      style: "currency",
      currency: resolvedCurrency,
      ...options,
    }).format(amount);
  } catch {
    return `${resolvedCurrency} ${amount}`;
  }
}

export function formatWeekday(weekdayIndex, locale = getActiveLocale(), width = "long") {
  const normalizedIndex = ((Number(weekdayIndex) % 7) + 7) % 7;
  const baseSunday = new Date(Date.UTC(2024, 0, 7 + normalizedIndex, 12, 0, 0));
  const resolved = normalizeLocale(locale);
  try {
    return new Intl.DateTimeFormat(resolved, { weekday: width, timeZone: "UTC" }).format(baseSunday);
  } catch {
    return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][normalizedIndex];
  }
}

export function formatFileSize(bytes, locale = getActiveLocale()) {
  const numeric = Number(bytes);
  if (!Number.isFinite(numeric) || numeric < 0) return "0 B";
  if (numeric < 1024) return `${Math.round(numeric)} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let size = numeric / 1024;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  const formatted = formatNumber(size, locale, { maximumFractionDigits: size >= 100 ? 0 : 1 });
  return `${formatted} ${units[index]}`;
}

export function compareLocaleStrings(a, b, locale = getActiveLocale()) {
  const resolved = normalizeLocale(locale);
  try {
    return new Intl.Collator(resolved, { numeric: true, sensitivity: "base" }).compare(String(a ?? ""), String(b ?? ""));
  } catch {
    return String(a ?? "").localeCompare(String(b ?? ""));
  }
}
