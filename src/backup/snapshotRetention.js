const DAY_MS = 86400000;
const boundedReasons = new Set(["pre-upgrade", "pre-migration", "pre-restore", "manual"]);
const weekStart = (date) => {
  const midnight = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return midnight - ((date.getUTCDay() + 6) % 7) * DAY_MS;
};
const monthIndex = (date) => date.getUTCFullYear() * 12 + date.getUTCMonth();

export function selectSnapshotsToDelete(snapshots, now) {
  const date = new Date(typeof now === "function" ? now() : now);
  if (!Array.isArray(snapshots) || !Number.isFinite(date.getTime())) return [];
  const valid = snapshots.filter((snapshot) =>
    typeof snapshot?.id === "string" && snapshot.id && Number.isFinite(Date.parse(snapshot.createdAt)) && snapshot.integrity !== "failed",
  );
  const newest = [...valid].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt) || (left.id < right.id ? 1 : left.id > right.id ? -1 : 0));
  const keep = new Set();
  const daily = newest.filter((snapshot) => snapshot.reason === "daily");
  for (const snapshot of daily.slice(0, 7)) keep.add(snapshot.id);
  const weeks = new Set();
  const months = new Set();
  const currentWeek = weekStart(date);
  const currentMonth = monthIndex(date);
  for (const snapshot of daily) {
    const created = new Date(snapshot.createdAt);
    const week = weekStart(created);
    const month = monthIndex(created);
    if (week <= currentWeek && week >= currentWeek - 21 * DAY_MS && !weeks.has(week)) {
      weeks.add(week);
      keep.add(snapshot.id);
    }
    if (month <= currentMonth && month >= currentMonth - 5 && !months.has(month)) {
      months.add(month);
      keep.add(snapshot.id);
    }
  }
  for (const reason of boundedReasons) {
    for (const snapshot of newest.filter((entry) => entry.reason === reason).slice(0, 10)) keep.add(snapshot.id);
  }
  return valid.filter((snapshot) => (snapshot.reason === "daily" || boundedReasons.has(snapshot.reason)) && !keep.has(snapshot.id)).map((snapshot) => snapshot.id);
}
