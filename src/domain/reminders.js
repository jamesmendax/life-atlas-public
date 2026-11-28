const OFFSETS = { atTime: 0, "5m": 300000, "1h": 3600000, "1d": 86400000 };

function localTime(value, defaultHour = 0) {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(String(value || ""));
  if (!match) return NaN;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4] ?? defaultHour), Number(match[5] ?? 0), Number(match[6] ?? 0));
  return date.getFullYear() === Number(match[1]) && date.getMonth() === Number(match[2]) - 1 && date.getDate() === Number(match[3]) ? date.getTime() : NaN;
}

export function collectReminders(workspace) {
  const found = new Map();
  const pages = new Map((workspace.pages || []).filter((page) => !page.trashedAt).map((page) => [page.id, page]));
  const append = (reminderId, fireAt, page, source) => {
    if (typeof reminderId !== "string" || !reminderId || !Number.isFinite(fireAt)) return;
    const key = `${reminderId}@${new Date(fireAt).toISOString()}`;
    if (!found.has(key)) found.set(key, { key, reminderId, fireAt, pageId: page.id, title: page.title || "无标题页面", source });
  };
  const visit = (value, page, depth = 0) => {
    if (depth > 128 || !value || typeof value !== "object") return;
    if (value.type === "dateMention" && value.props?.kind === "reminder") append(value.props.reminderId, localTime(value.props.value), page, "提及");
    for (const child of Array.isArray(value) ? value : Object.values(value)) visit(child, page, depth + 1);
  };
  for (const page of pages.values()) visit(page.content, page);
  const sources = new Map((workspace.dataSources || []).map((source) => [source.id, source]));
  for (const item of workspace.databaseItems || []) {
    const page = pages.get(item.pageId);
    const source = sources.get(item.sourceId);
    if (!page || !source) continue;
    for (const property of source.properties || []) {
      const date = item.values?.[property.id];
      const reminder = date?.reminder;
      if (property.type !== "date" || !reminder || !Object.hasOwn(OFFSETS, reminder.offset)) continue;
      const fireAt = localTime(date.includeTime ? date.start : date.start?.slice(0, 10), 9) - OFFSETS[reminder.offset];
      append(reminder.id, fireAt, page, `${source.title || "数据库"} · ${property.name}`);
    }
  }
  return [...found.values()].sort((first, second) => first.fireAt - second.fireAt || first.key.localeCompare(second.key));
}

export function dueReminders(reminders, { nowMs, firedKeys }) {
  const fired = new Set(firedKeys || []);
  return reminders.filter((reminder) => reminder.fireAt <= nowMs && !fired.has(reminder.key));
}

export function processReminders(workspace, { nowMs, startedAt, initial = false }) {
  const ui = workspace.ui || {};
  const due = dueReminders(collectReminders(workspace), { nowMs, firedKeys: ui.firedReminderIds });
  const entries = due.map(({ reminderId, ...entry }) => ({ ...entry, missed: initial && entry.fireAt < startedAt, readAt: null }));
  const reminderLog = [...entries, ...(ui.reminderLog || [])].sort((first, second) => second.fireAt - first.fireAt).slice(0, 500);
  const firedReminderIds = [...new Set([...(ui.firedReminderIds || []), ...entries.map((entry) => entry.key)])].slice(-1000);
  return { workspace: { ...workspace, ui: { ...ui, firedReminderIds, reminderLog, lastReminderCheckAt: new Date(nowMs).toISOString() } }, notifications: entries.filter((entry) => !entry.missed) };
}
