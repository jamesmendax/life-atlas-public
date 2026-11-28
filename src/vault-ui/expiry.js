export function localDateString(time = Date.now()) {
  const date = new Date(time);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function expiryState(expiresAt, todayString) {
  if (!expiresAt) return "none";
  const expiry = Date.parse(expiresAt.slice(0, 10));
  const today = Date.parse(todayString);
  if (!Number.isFinite(expiry) || !Number.isFinite(today)) return "none";
  const days = (expiry - today) / 86400000;
  return days < 0 ? "expired" : days <= 30 ? "soon" : "none";
}
