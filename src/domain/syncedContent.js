import { copyJson, ensureBlockIds, newEntityId, sourceReferences, stableJson } from "./blockDocument.js";

function freezeDeep(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freezeDeep(child);
  }
  return value;
}

// One synchronous canonical store per workspace. React views subscribe to stable
// snapshots; local editor documents are projections, never additional sources.
export function createSyncedContentStore(initialSources = [], onPersist = () => {}) {
  let sources = new Map(initialSources.map((source) => [source.id, freezeDeep(copyJson(source))]));
  const subscribers = new Map();
  const globalSubscribers = new Set();
  let version = 0;
  const snapshot = () => [...sources.values()].map(copyJson);
  const notify = (id) => {
    version++;
    onPersist(snapshot());
    for (const listener of subscribers.get(id) || []) listener();
    for (const listener of globalSubscribers) listener();
  };
  const assertNoCycle = (id, blocks) => {
    const visit = (current, ancestry) => {
      if (ancestry.has(current)) throw new Error("Synced source cycle is not allowed");
      if (ancestry.size > 40) throw new Error("Synced source nesting limit exceeded");
      const next = new Set(ancestry);
      next.add(current);
      const document = current === id ? blocks : sources.get(current)?.blocks || [];
      for (const ref of sourceReferences(document)) visit(ref, next);
    };
    visit(id, new Set());
  };
  return {
    getSource(id) { return sources.get(id) || null; },
    getVersion() { return version; },
    listSources() { return [...sources.values()]; },
    serialize: snapshot,
    subscribe(id, listener) {
      if (!subscribers.has(id)) subscribers.set(id, new Set());
      subscribers.get(id).add(listener);
      return () => {
        subscribers.get(id)?.delete(listener);
        if (!subscribers.get(id)?.size) subscribers.delete(id);
      };
    },
    subscribeAll(listener) { globalSubscribers.add(listener); return () => globalSubscribers.delete(listener); },
    createSource(blocks = [{ type: "paragraph", content: "" }], metadata = {}) {
      const id = newEntityId("sync");
      const time = new Date().toISOString();
      const content = ensureBlockIds(blocks.length ? blocks : [{ type: "paragraph", content: "" }], id);
      assertNoCycle(id, content);
      const source = freezeDeep({ ...copyJson(metadata), id, blocks: content, revision: 0, createdAt: time, updatedAt: time });
      sources.set(id, source);
      notify(id);
      return source;
    },
    updateSource(id, blocks, expectedRevision) {
      const source = sources.get(id);
      if (!source || source.deletedAt) throw new Error("Synced source is unavailable");
      if (expectedRevision !== source.revision) throw new Error(`Synced source revision conflict: expected ${expectedRevision}, actual ${source.revision}`);
      const content = ensureBlockIds(blocks.length ? blocks : [{ type: "paragraph", content: "" }], id);
      if (stableJson(source.blocks) === stableJson(content)) return source;
      assertNoCycle(id, content);
      const next = freezeDeep({ ...source, blocks: content, revision: source.revision + 1, updatedAt: new Date().toISOString() });
      sources.set(id, next);
      notify(id);
      return next;
    },
    deleteSource(id) {
      const source = sources.get(id);
      if (!source || source.deletedAt) return;
      // Tombstones retain the content for an explicit restore. Other references
      // become visible unavailable-source notices, rather than silently vanishing.
      const time = new Date().toISOString();
      sources.set(id, freezeDeep({ ...source, deletedAt: time, updatedAt: time, revision: source.revision + 1 }));
      notify(id);
    },
    restoreSource(id) {
      const source = sources.get(id);
      if (!source?.deletedAt) return source || null;
      const next = freezeDeep({ ...source, deletedAt: null, updatedAt: new Date().toISOString(), revision: source.revision + 1 });
      sources.set(id, next);
      notify(id);
      return next;
    },
    replaceAll(nextSources, persist = false) {
      const oldIds = [...sources.keys()];
      sources = new Map(nextSources.map((source) => [source.id, freezeDeep(copyJson(source))]));
      version++;
      if (persist) onPersist(snapshot());
      for (const id of new Set([...oldIds, ...sources.keys()])) for (const listener of subscribers.get(id) || []) listener();
      for (const listener of globalSubscribers) listener();
    },
  };
}
