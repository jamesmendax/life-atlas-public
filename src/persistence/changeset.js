import { BACKUP_COLLECTIONS } from "../backup/format.js";

function entityMaps(workspace) {
  return new Map(BACKUP_COLLECTIONS.map((collection) => {
    const entities = new Map();
    for (const entity of workspace?.[collection] || []) {
      if (!entity || typeof entity.id !== "string" || !entity.id || entities.has(entity.id)) throw new TypeError(`集合 ${collection} 的 ID 无效或重复`);
      entities.set(entity.id, entity);
    }
    return [collection, entities];
  }));
}

export function createChangeTracker(savedWorkspace) {
  let savedMaps = entityMaps(savedWorkspace);
  let savedUi = JSON.stringify(savedWorkspace?.ui ?? {});
  return {
    diff(nextWorkspace) {
      const nextMaps = entityMaps(nextWorkspace);
      const upserts = [];
      const deletes = [];
      for (const collection of BACKUP_COLLECTIONS) {
        const previous = savedMaps.get(collection);
        const next = nextMaps.get(collection);
        const expectedOrder = [...previous.keys()].filter((id) => next.has(id)).concat([...next.keys()].filter((id) => !previous.has(id)));
        const actualOrder = [...next.keys()];
        const reordered = actualOrder.some((id, index) => id !== expectedOrder[index]);
        for (const [id, entity] of next) if (reordered || previous.get(id) !== entity) upserts.push({ collection, id, json: JSON.stringify(entity) });
        for (const id of previous.keys()) if (!next.has(id)) deletes.push({ collection, id });
      }
      return { upserts, deletes, ui: JSON.stringify(nextWorkspace.ui ?? {}) === savedUi ? null : nextWorkspace.ui ?? {} };
    },
    commit(nextWorkspace) {
      savedMaps = entityMaps(nextWorkspace);
      savedUi = JSON.stringify(nextWorkspace.ui ?? {});
    },
    isEmpty(diff) {
      return diff.upserts.length === 0 && diff.deletes.length === 0 && diff.ui === null;
    },
  };
}
