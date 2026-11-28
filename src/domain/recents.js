import { folderAncestors } from "./navigation.js";
import { isPageArchived } from "./archive.js";

export function recordVisit(ui, pageId, visitedAt) {
  const timestamp = new Date(visitedAt).getTime();
  if (!pageId || !Number.isFinite(timestamp)) return ui;
  const newest = new Map();
  for (const visit of Array.isArray(ui?.recentVisits) ? ui.recentVisits : []) {
    if (!visit?.pageId || !Number.isFinite(new Date(visit.visitedAt).getTime())) continue;
    if (!newest.has(visit.pageId) || new Date(visit.visitedAt) >= new Date(newest.get(visit.pageId).visitedAt)) newest.set(visit.pageId, visit);
  }
  const previousVisit = newest.get(pageId);
  if (previousVisit && timestamp <= new Date(previousVisit.visitedAt).getTime()) return ui;
  newest.set(pageId, { pageId, visitedAt });
  const previousCount = ui?.pageOpenCounts?.[pageId];
  const count = Number.isSafeInteger(previousCount) && previousCount > 0 ? previousCount : 0;
  return { ...ui, pageOpenCounts: { ...ui?.pageOpenCounts, [pageId]: Math.min(Number.MAX_SAFE_INTEGER, count + 1) }, recentVisits: [...newest.values()].sort((left, right) => new Date(right.visitedAt) - new Date(left.visitedAt) || (right.pageId === pageId ? 1 : 0) - (left.pageId === pageId ? 1 : 0)).slice(0, 100) };
}

export function recentGroups(workspace, nowMs, { includeArchived = false } = {}) {
  const start = new Date(nowMs);
  start.setHours(0, 0, 0, 0);
  const yesterday = new Date(start);
  yesterday.setDate(yesterday.getDate() - 1);
  const week = new Date(start);
  week.setDate(week.getDate() - 7);
  const groups = ["今天", "昨天", "过去 7 天", "更早"].map((label) => ({ label, entries: [] }));
  const pages = new Map((workspace.pages || []).map((page) => [page.id, page]));
  const seen = new Set();
  const visits = [...(Array.isArray(workspace.ui?.recentVisits) ? workspace.ui.recentVisits : [])].sort((left, right) => new Date(right?.visitedAt) - new Date(left?.visitedAt));
  for (const visit of visits) {
    const page = pages.get(visit?.pageId);
    const time = new Date(visit?.visitedAt).getTime();
    if (!page || page.trashedAt || (!includeArchived && isPageArchived(workspace, page.id)) || seen.has(page.id) || !Number.isFinite(time)) continue;
    const ancestors = folderAncestors(workspace.folders, page.folderId);
    if (ancestors.some((folder) => folder.trashedAt)) continue;
    seen.add(page.id);
    const index = time >= start.getTime() ? 0 : time >= yesterday.getTime() ? 1 : time >= week.getTime() ? 2 : 3;
    groups[index].entries.push({ pageId: page.id, title: page.title || "无标题页面", icon: page.icon, iconColor: page.iconColor, path: ["Private", ...ancestors.map((folder) => folder.name)].join(" / "), visitedAt: visit.visitedAt });
  }
  return groups.filter((group) => group.entries.length);
}
