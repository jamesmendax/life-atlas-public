/**
 * Resolve an exact (Page ID, database block ID) without changing workspace state.
 * Omitted/null/empty block IDs mean ordinary Page navigation. Other block failures
 * retain the requested Page; page failures clear both IDs. `block` is the original
 * document object, so callers must treat it as read-only. Problem codes are listed
 * in .qa/LOCAL-NOTION-001/v14-wiki-real133/navigation155/report.md.
 */
export function resolveDatabaseOccurrenceLocation(workspace, { pageId, blockId } = {}) {
  const unavailable = (problem) => ({ pageId: null, blockId: null, block: null, problem });
  if (typeof pageId !== "string" || !pageId.trim()) return unavailable("page-id-invalid");
  const page = Array.isArray(workspace?.pages)
    ? workspace.pages.find((entry) => entry?.id === pageId)
    : null;
  if (!page) return unavailable("page-not-found");
  if (page.trashedAt) return unavailable("page-trashed");

  const pageOnly = (problem = null) => ({ pageId: page.id, blockId: null, block: null, problem });
  if (blockId === undefined || blockId === null || blockId === "") return pageOnly();
  if (typeof blockId !== "string" || !blockId.trim()) return pageOnly("block-id-invalid");

  let match = null;
  let count = 0;
  const visit = (blocks) => {
    if (!Array.isArray(blocks)) return;
    for (const block of blocks) {
      if (!block || typeof block !== "object") continue;
      if (block.id === blockId) {
        match = block;
        count += 1;
      }
      if (count > 1) return;
      visit(block.children);
      if (count > 1) return;
    }
  };
  visit(page.content);
  if (!match) return pageOnly("block-not-found");
  if (count > 1) return pageOnly("block-id-ambiguous");
  if (match.type !== "databaseView") return pageOnly("block-not-database-view");
  return { pageId: page.id, blockId: match.id, block: match, problem: null };
}
