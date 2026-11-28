import { cloneBlockDocument, copyJson, newEntityId, walkBlocks } from "./blockDocument.js";
import { CURRENT_SCHEMA_VERSION, upgradeWorkspace } from "../persistence/migrations.js";
import { visitBundleReferences } from "./pageBundleReferences.js";
import { createRelationValueValidator } from "./relationValidation.js";

const COLLECTIONS = ["pages", "dataSources", "databaseItems", "databaseViews", "relations", "syncedSources", "people", "attachments", "databaseTemplates"];
const BODY = { pages: "content", syncedSources: "blocks", databaseTemplates: "pageContent" };
const byId = rows => new Map((rows || []).map(row => [row.id, row]));
const perCollection = make => Object.fromEntries(COLLECTIONS.map(key => [key, make(key)]));

function byOwner(rows, key) {
  const index = new Map();
  for (const row of rows || []) {
    if (!row[key]) continue;
    if (!index.has(row[key])) index.set(row[key], []);
    index.get(row[key]).push(row.id);
  }
  return index;
}

function attachmentAssets(attachments) {
  const assets = new Map();
  for (const attachment of attachments || []) {
    const hash = attachment.checksum || (attachment.provider === "asset" && attachment.storageKey);
    if (hash && !assets.has(hash)) assets.set(hash, attachment);
  }
  return assets;
}

// Follow explicit references and owned children. Parent folders, unrelated
// siblings, history, and other occurrences of a synced block are not dependencies.
export function createPageBundle(page, workspace) {
  if (!workspace || !page?.id) return { kind: "life-atlas-page", version: 2, schemaVersion: CURRENT_SCHEMA_VERSION, page: copyJson(page), related: {} };
  const lookup = perCollection(key => byId(workspace[key]));
  lookup.pages.set(page.id, page);
  const selected = perCollection(() => new Map());
  const pending = [];
  const ref = (collection, id) => {
    if (id && !selected[collection].has(id) && lookup[collection].has(id)) {
      const entity = copyJson(lookup[collection].get(id));
      selected[collection].set(id, entity);
      pending.push([collection, entity]);
    }
    return id;
  };
  const owned = [
    ["pages", "pages", "parentPageId"],
    ["pages", "dataSources", "ownerPageId"],
    ["pages", "databaseItems", "pageId"],
    ["dataSources", "databaseViews", "sourceId"],
    ["dataSources", "databaseItems", "sourceId"],
    ["dataSources", "relations", "sourceId"],
    ["dataSources", "databaseTemplates", "sourceId"],
  ].map(([from, to, key]) => ({ from, to, index: byOwner(workspace[to], key) }));
  const context = { ref, sources: lookup.dataSources, assets: attachmentAssets(workspace.attachments) };
  ref("pages", page.id);
  for (let cursor = 0; cursor < pending.length; cursor++) {
    if (pending.length > 50000) throw new Error("页面依赖超过安全导出上限");
    const [collection, entity] = pending[cursor];
    visitBundleReferences(collection, entity, context);
    for (const { from, to, index } of owned) {
      if (collection === from) for (const id of index.get(entity.id) || []) ref(to, id);
    }
  }
  const root = selected.pages.get(page.id);
  selected.pages.delete(page.id);
  return {
    kind: "life-atlas-page", version: 2, schemaVersion: workspace.schemaVersion || CURRENT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(), page: root, related: perCollection(key => [...selected[key].values()]),
  };
}

// Allocate document IDs before rewriting links. BlockNote addresses are scoped
// by page, so two ordinary page copies may legitimately contain the same old block ID.
function prepareDocuments(input, idFactory) {
  const documents = new Map();
  const blockIds = new Map();
  for (const [collection, key] of Object.entries(BODY)) {
    for (const entity of input[collection] || []) {
      const blocks = cloneBlockDocument(entity[key], idFactory);
      documents.set(entity, blocks);
      if (collection === "pages") {
        const cloned = walkBlocks(blocks);
        const addresses = new Map();
        walkBlocks(entity[key]).forEach((block, index) => { if (block.id) addresses.set(block.id, cloned[index].id); });
        blockIds.set(entity.id, addresses);
      }
    }
  }
  return { documents, blockIds };
}

export function importPageBundle(current, bundle, targetPageId, idFactory = newEntityId) {
  if (!bundle?.page || !Array.isArray(bundle.page.content)) throw new Error("页面备份结构无效");
  const target = current.pages?.find(page => page.id === targetPageId);
  if (!target) throw new Error("找不到目标页面");
  if (Number(bundle.schemaVersion) > CURRENT_SCHEMA_VERSION) throw new Error("备份版本高于当前应用，请先升级应用");
  const related = bundle.related || {};
  for (const key of COLLECTIONS) if (related[key] != null && !Array.isArray(related[key])) throw new Error(`备份集合无效：${key}`);
  const root = { ...bundle.page, id: bundle.page.id || "legacy-page-bundle-root" };
  const input = upgradeWorkspace({
    schemaVersion: bundle.schemaVersion || 6, folders: [], ...perCollection(key => related[key] || []),
    pages: [root, ...(related.pages || []).filter(page => page.id !== root.id)],
  });
  const maps = perCollection(() => new Map());
  for (const key of COLLECTIONS) {
    const reserved = new Set([...(current[key] || []), ...(input[key] || [])].map(entity => entity.id));
    for (const entity of input[key] || []) {
      if (!entity || typeof entity.id !== "string" || !entity.id || maps[key].has(entity.id)) throw new Error(`备份包含无效或重复标识：${key}`);
      let id = targetPageId;
      if (key !== "pages" || entity.id !== root.id) {
        id = idFactory(key);
        if (typeof id !== "string" || !id || reserved.has(id)) throw new Error(`生成的新标识发生冲突：${key}`);
        reserved.add(id);
      }
      maps[key].set(entity.id, id);
    }
  }
  const ref = (key, id) => maps[key].get(id) || id;
  const { documents, blockIds } = prepareDocuments(input, idFactory);
  const context = { ref, blockIds, sources: byId(input.dataSources), assets: attachmentAssets(input.attachments), importing: true };
  const imported = perCollection(key => (input[key] || []).map(entity => {
    const next = copyJson(entity);
    if (BODY[key]) next[BODY[key]] = documents.get(entity);
    visitBundleReferences(key, next, context);
    next.id = ref(key, entity.id);
    if (key === "pages") {
      next.folderId = target.folderId;
      next.contentRevision = (next.contentRevision || 0) + 1;
      // The receiving root keeps its position. A linked page may come from a
      // different hierarchy whose ancestors were deliberately not exported.
      if (entity.id === root.id) next.parentPageId = target.parentPageId || null;
      else if (entity.parentPageId) next.parentPageId = maps.pages.get(entity.parentPageId) || null;
      if (next.trashedByPageId) next.trashedByPageId = maps.pages.get(next.trashedByPageId) || null;
      if (next.trashedByFolderId) next.trashedByFolderId = null;
    }
    if (key === "attachments" && next.provider === "local-ref" && !next.storageKey) next.storageKey = entity.id;
    return next;
  }));
  const checkRelations = createRelationValueValidator(imported.dataSources, imported.relations, imported.databaseItems);
  for (const entity of [...imported.databaseItems, ...imported.databaseTemplates]) {
    const [issue] = checkRelations(entity, entity.values || entity.defaultValues);
    if (issue) throw new Error(`无法导入页面依赖。 ${issue.message}`);
  }
  const importedPage = imported.pages.find(page => page.id === targetPageId);
  const page = { ...target, ...importedPage, id: targetPageId, folderId: target.folderId, updatedAt: new Date().toISOString() };
  const workspace = { ...current };
  for (const key of COLLECTIONS) workspace[key] = key === "pages"
    ? [...current.pages.map(entry => entry.id === targetPageId ? page : entry), ...imported.pages.filter(entry => entry.id !== targetPageId)]
    : [...(current[key] || []), ...imported[key]];
  return { workspace, page, importedCounts: perCollection(key => imported[key].length) };
}

export function duplicatePageIndependently(current, sourceId, { id = newEntityId("page"), sortIndex, now = new Date().toISOString() } = {}, idFactory = newEntityId) {
  const source = current.pages?.find(page => page.id === sourceId);
  if (!source) throw new Error("找不到要复制的页面");
  if (current.pages.some(page => page.id === id)) throw new Error("新页面标识发生冲突");
  const bundle = createPageBundle(source, current);
  const target = { id, folderId: source.folderId, parentPageId: source.parentPageId || null };
  const result = importPageBundle({ ...current, pages: [...current.pages, target] }, bundle, id, idFactory);
  Object.assign(result.page, {
    title: `${source.title || "无标题页面"} 独立副本`, sortIndex: sortIndex ?? source.sortIndex,
    createdAt: now, updatedAt: now, trashedAt: null, trashedByPageId: null, trashedByFolderId: null,
  });
  return result;
}
