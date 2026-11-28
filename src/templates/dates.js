export function localDateString(milliseconds) {
  const date = new Date(milliseconds);
  if (!Number.isFinite(date.getTime())) throw new TypeError("日期无效");
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function addDays(dateString, days) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString) || !Number.isInteger(days)) throw new TypeError("日期和天数无效");
  const [year, month, day] = dateString.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}
