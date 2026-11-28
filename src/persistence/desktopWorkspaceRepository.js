import { createChangeTracker } from "./changeset.js";
import { CURRENT_SCHEMA_VERSION } from "./migrations.js";

function failure(error) {
  return { ok: false, error: { code: error?.code || "E_IO", message: error?.message || "工作区操作失败" } };
}

function unwrap(result) {
  if (!result?.ok) {
    const error = new Error(result?.error?.message || "工作区操作失败");
    error.code = result?.error?.code || "E_IO";
    throw error;
  }
  return result.value;
}

export function createDesktopWorkspaceRepository(api, { fallbackWorkspace, now, idFactory } = {}) {
  let generation;
  let tracker;
  let loadError;
  let suspended = false;
  let pending = Promise.resolve();
  let savedSchemaVersion;
  const performSave = async (workspace) => {
    if (loadError) return failure(loadError);
    if (!tracker || !generation) return failure({ code: "E_IO", message: "工作区尚未加载，不能保存" });
    if (suspended) return { ok: true, value: null };
    try {
      const diff = tracker.diff(workspace);
      if (tracker.isEmpty(diff) && workspace.schemaVersion === savedSchemaVersion) return { ok: true, value: null };
      const value = unwrap(await api.workspace.applyChanges({ generation, schemaVersion: CURRENT_SCHEMA_VERSION, ...diff }));
      tracker.commit(workspace);
      savedSchemaVersion = workspace.schemaVersion;
      return { ok: true, value };
    } catch (error) {
      return failure(error);
    }
  };
  return {
    kind: "desktop",
    async load() {
      await pending;
      try {
        const value = unwrap(await api.workspace.load());
        if (!value?.workspace || typeof value.generation !== "string" || !value.generation) throw Object.assign(new Error("工作区返回数据无效"), { code: "E_CORRUPT" });
        generation = value.generation;
        tracker = createChangeTracker(value.workspace);
        savedSchemaVersion = value.workspace.schemaVersion;
        loadError = null;
        return value.workspace;
      } catch (error) {
        loadError = error;
        tracker = null;
        throw error;
      }
    },
    save(workspace) {
      pending = pending.then(() => performSave(workspace));
      return pending;
    },
    suspendSaves() { suspended = true; },
    resumeSaves() { suspended = false; },
  };
}
