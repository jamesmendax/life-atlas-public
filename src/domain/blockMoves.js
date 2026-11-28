import { copyJson } from "./blockDocument.js";

export function appendBlocksToPage(workspace, { pageId, blocks, now }) {
  const target = workspace.pages?.find((page) => page.id === pageId);
  if (!target || target.trashedAt) throw new Error("目标页面不存在或已在回收站");
  const appended = copyJson(blocks);
  return {
    ...workspace,
    pages: workspace.pages.map((page) => page.id === pageId ? {
      ...page,
      content: [...(page.content || []), ...appended],
      updatedAt: now,
      contentRevision: (Number(page.contentRevision) || 0) + 1,
    } : page),
  };
}
