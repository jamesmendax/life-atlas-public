const MONTHS = new Map([
  ["january", 1], ["jan", 1], ["february", 2], ["feb", 2], ["march", 3], ["mar", 3], ["april", 4], ["apr", 4],
  ["may", 5], ["june", 6], ["jun", 6], ["july", 7], ["jul", 7], ["august", 8], ["aug", 8],
  ["september", 9], ["sep", 9], ["sept", 9], ["october", 10], ["oct", 10], ["november", 11], ["nov", 11], ["december", 12], ["dec", 12],
]);

export function parseNotionName(name) {
  const match = /^(.*?)(?:\s+([0-9a-f]{32}))?(_all)?(\.[A-Za-z0-9]+)?$/.exec(String(name ?? ""));
  return { title: match[1], notionId: match[2] || null, all: Boolean(match[3]), extension: (match[4] || "").toLowerCase() };
}

function dateEndpoint(text) {
  const value = String(text).trim();
  const english = /^([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})(?:\s+(.+))?$/.exec(value);
  const numeric = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:\s+(.+))?$/.exec(value);
  const chinese = /^(\d{4})年(\d{1,2})月(\d{1,2})日(?:\s+(.+))?$/.exec(value);
  const match = numeric || chinese;
  const year = Number(english?.[3] ?? match?.[1]);
  const month = english ? MONTHS.get(english[1].toLowerCase()) : Number(match?.[2]);
  const day = Number(english?.[2] ?? match?.[3]);
  if (!Number.isInteger(year) || year < 1 || !month || day < 1) return null;
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  let result = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const clock = english?.[4] ?? match?.[4];
  if (clock) {
    const time = /^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?$/i.exec(clock.trim());
    if (!time) return null;
    let hour = Number(time[1]);
    const minute = Number(time[2]);
    if (minute > 59 || time[3] && (hour < 1 || hour > 12) || !time[3] && hour > 23) return null;
    if (time[3]) hour = hour % 12 + (time[3].toUpperCase() === "PM" ? 12 : 0);
    result += `T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }
  return { value: result, includeTime: Boolean(clock) };
}

export function parseNotionDate(text) {
  const endpoints = String(text ?? "").trim().split(/\s*→\s*/);
  if (!endpoints[0] || endpoints.length > 2) return null;
  const start = dateEndpoint(endpoints[0]);
  const end = endpoints.length === 2 ? dateEndpoint(endpoints[1]) : null;
  if (!start || endpoints.length === 2 && !end) return null;
  return { start: start.value, end: end?.value || null, includeTime: start.includeTime || Boolean(end?.includeTime), timeZone: null };
}

export function splitNotionMulti(text) {
  return [...new Set(String(text ?? "").split(",").map((value) => value.trim()).filter(Boolean))];
}

export function looksMultiSelect(values) {
  const split = values.map(splitNotionMulti);
  return split.some((parts) => parts.length > 1) && new Set(split.flat()).size <= 30;
}
