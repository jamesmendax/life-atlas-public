import { CURRENT_SCHEMA_VERSION, upgradeWorkspace } from "./migrations.js";
import { normalizeLoadedWorkspace } from "./normalize.js";

const STORAGE_KEY = `life-atlas.workspace.v${CURRENT_SCHEMA_VERSION}`;
const LEGACY_STORAGE_KEYS = Array.from({ length: CURRENT_SCHEMA_VERSION - 1 }, (_, index) => `life-atlas.workspace.v${CURRENT_SCHEMA_VERSION - 1 - index}`);

export function createBrowserWorkspaceRepository(storage = window.localStorage, { now = () => Date.now(), idFactory = (prefix) => `${prefix}-${globalThis.crypto.randomUUID()}` } = {}) {
  let loadFailure = null;
  let savesSuspended = false;
  const time = () => typeof now === "function" ? now() : now;
  return {
    load(fallbackWorkspace) {
      loadFailure = null;
      try {
        let raw = storage.getItem(STORAGE_KEY);
        if (!raw) {
          for (const key of LEGACY_STORAGE_KEYS) {
            raw = storage.getItem(key);
            if (raw) break;
          }
        }
        if (!raw) return normalizeLoadedWorkspace(fallbackWorkspace, { fallbackWorkspace, now: time(), idFactory });
        const parsed = JSON.parse(raw);
        return normalizeLoadedWorkspace(parsed, { fallbackWorkspace, now: time(), idFactory });
      } catch (error) {
        loadFailure = error;
        console.warn("Life Atlas workspace load failed; using seed data.", error);
        return normalizeLoadedWorkspace(fallbackWorkspace, { fallbackWorkspace, now: time(), idFactory });
      }
    },

    save(workspace) {
      if (savesSuspended) return null;
      if (loadFailure) return { ok: false, error: { code: "E_CORRUPT", message: "原工作区无法读取，已停止自动保存以保护原始数据。请导入有效备份后重试。" } };
      try {
        const payload = {
          ...upgradeWorkspace(workspace),
          pageVersions: [],
          schemaVersion: CURRENT_SCHEMA_VERSION,
          savedAt: new Date(time()).toISOString(),
        };
        storage.setItem(STORAGE_KEY, JSON.stringify(payload));
        return { ok: true, workspace: payload, savedAt: payload.savedAt };
      } catch (error) {
        return { ok: false, error: { code: "E_IO", message: error.message || "工作区保存失败" } };
      }
    },

    suspendSaves() { savesSuspended = true; },
    resumeSaves() { savesSuspended = false; },

    clear() {
      storage.removeItem(STORAGE_KEY);
      loadFailure = null;
    },
  };
}

export const workspaceStorageKey = STORAGE_KEY;
export const workspaceSchemaVersion = CURRENT_SCHEMA_VERSION;
