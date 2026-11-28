const importedCollections = ["folders", "pages", "dataSources", "databaseViews", "databaseItems", "relations", "attachments"];

export function mergeImportedWorkspace(current, baseline, imported) {
  let next = current;
  for (const collection of importedCollections) {
    const previousIds = new Set((baseline[collection] || []).map((entry) => entry.id));
    const existing = new Map((current[collection] || []).map((entry) => [entry.id, entry]));
    const additions = [];
    for (const entry of imported[collection] || []) {
      if (previousIds.has(entry.id)) continue;
      if (!entry.id || typeof entry.id !== "string") throw new Error("导入内容缺少实体标识");
      if (existing.has(entry.id)) {
        if (JSON.stringify(existing.get(entry.id)) !== JSON.stringify(entry)) throw new Error("导入标识与现有内容冲突，请重新导入");
        continue;
      }
      const copy = structuredClone(entry);
      additions.push(copy);
      existing.set(entry.id, copy);
    }
    if (additions.length) next = { ...next, [collection]: [...(current[collection] || []), ...additions] };
  }
  return next;
}
