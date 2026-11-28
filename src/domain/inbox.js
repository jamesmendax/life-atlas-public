export function inboxPages(workspace) {
  const inboxId = workspace.folders?.find((folder) => folder.system === "inbox")?.id;
  return (workspace.pages || []).filter((page) => page.folderId === inboxId && !page.trashedAt).sort((first, second) => String(second.inboxedAt || second.createdAt).localeCompare(String(first.inboxedAt || first.createdAt)));
}

export function archivePages(workspace, pageIds, targetFolderId, now) {
  const target = workspace.folders?.find((folder) => folder.id === targetFolderId);
  if (!target || target.trashedAt || target.system) throw new Error("请选择可用的普通文件夹");
  const selected = new Set(pageIds);
  const pending = new Set(inboxPages(workspace).map((page) => page.id));
  if ([...selected].some((pageId) => !pending.has(pageId))) throw new Error("只能归档待整理的收件箱页面");
  return { ...workspace, pages: (workspace.pages || []).map((page) => selected.has(page.id) ? { ...page, folderId: targetFolderId, inboxedAt: null, updatedAt: now } : page) };
}

export function markRemindersRead(ui, pageId, now) {
  return { ...ui, reminderLog: (ui?.reminderLog || []).map((entry) => !entry.readAt && (!pageId || entry.pageId === pageId) ? { ...entry, readAt: now } : entry) };
}
