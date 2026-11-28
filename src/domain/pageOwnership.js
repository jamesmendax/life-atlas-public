// Ownership, rather than links or relations, determines a page's descendants.
export function ownedDescendantPageIds(workspace, rootPageIds) {
  const roots = new Set(rootPageIds || []);
  const owned = new Set(roots);
  let changed = true;
  while (changed) {
    changed = false;
    const sources = new Set((workspace.dataSources || []).filter((source) => owned.has(source.ownerPageId)).map((source) => source.id));
    for (const pageId of [
      ...(workspace.pages || []).filter((page) => owned.has(page.parentPageId)).map((page) => page.id),
      ...(workspace.databaseItems || []).filter((item) => sources.has(item.sourceId)).map((item) => item.pageId),
    ]) {
      if (pageId && !owned.has(pageId)) { owned.add(pageId); changed = true; }
    }
  }
  for (const pageId of roots) owned.delete(pageId);
  return owned;
}
