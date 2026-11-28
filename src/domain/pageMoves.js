import { movePage } from "./pageActions.js";
import { ownedDescendantPageIds } from "./trash.js";

export function moveOwnedPage(workspace, pageId, { folderId, sortIndex, now }) {
  const descendants = ownedDescendantPageIds(workspace, [pageId]);
  return {
    ...workspace,
    pages: workspace.pages.map((page) => {
      if (page.id === pageId) return movePage(page, { folderId, sortIndex, now });
      return descendants.has(page.id) ? { ...page, folderId } : page;
    }),
  };
}
