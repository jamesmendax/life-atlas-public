import { addDays } from "../templates/dates.js";

export function greeting(nowMs) {
  const hour = new Date(nowMs).getHours();
  return hour >= 5 && hour < 11 ? "早上好" : hour >= 11 && hour < 18 ? "下午好" : "晚上好";
}

export function upcomingRecords(workspace, todayString, days = 7) {
  const end = addDays(todayString, days);
  const pages = new Map((workspace.pages || []).map((page) => [page.id, page]));
  const sources = new Map((workspace.dataSources || []).map((source) => [source.id, source]));
  const seen = new Set();
  const entries = [];
  for (const item of workspace.databaseItems || []) {
    const page = pages.get(item.pageId);
    const source = sources.get(item.sourceId);
    if (!page || page.trashedAt || !source || source.trashedAt || pages.get(source.ownerPageId)?.trashedAt) continue;
    for (const property of source.properties || []) {
      if (property.type !== "date") continue;
      const start = item.values?.[property.id]?.start;
      if (typeof start !== "string") continue;
      const date = start.slice(0, 10);
      if (date < todayString || date >= end || seen.has(`${page.id}:${date}`)) continue;
      seen.add(`${page.id}:${date}`);
      entries.push({ date, title: page.title || "无标题页面", sourceTitle: source.title || "数据库", pageId: page.id });
    }
  }
  return entries.sort((left, right) => left.date.localeCompare(right.date) || left.title.localeCompare(right.title));
}
