import { copyJson } from "../domain/blockDocument.js";
import { normalizePageSettings } from "../domain/pageActions.js";
import { purgeExpiredTrashGroups } from "../domain/trash.js";
import { normalizeRollupDefinitions } from "../domain/rollupConfiguration.js";
import { CURRENT_SCHEMA_VERSION, upgradeWorkspace } from "./migrations.js";
import { normalizeThemePreference } from "../ui/theme.js";

export { CURRENT_SCHEMA_VERSION } from "./migrations.js";

const EMPTY_ASSET_PREFERENCES = {
  recentEmojiIds: [],
  recentIconIds: [],
  recentCoverIds: [],
  favoriteCoverIds: [],
};

function normalizeIdList(value, limit = 64) {
  return Array.from(new Set(Array.isArray(value) ? value.filter((item) => typeof item === "string" && item) : [])).slice(0, limit);
}

export function normalizeLoadedWorkspace(input, { fallbackWorkspace, now, idFactory } = {}) {
  const fallback = fallbackWorkspace && typeof fallbackWorkspace === "object" ? fallbackWorkspace : { folders: [], pages: [], ui: {} };
  const source = copyJson(input && typeof input === "object" ? input : fallback);
  const time = source.savedAt || source.pages?.[0]?.createdAt || "1970-01-01T00:00:00.000Z";
  const preferences = source.ui?.preferences ?? fallback.ui?.preferences ?? {};
  const folders = Array.isArray(source.folders)
    ? source.folders.map((folder) => ({
        ...folder,
        createdAt: folder.createdAt || folder.updatedAt || time,
        updatedAt: folder.updatedAt || folder.createdAt || time,
      }))
    : copyJson(fallback.folders || []);
  const pages = Array.isArray(source.pages)
    ? source.pages.map((page) => ({
        ...page,
        icon: page.icon || "📄",
        iconColor: page.iconColor || null,
        cover: page.cover ?? null,
        settings: normalizePageSettings(page.settings),
        trashedAt: page.trashedAt ?? null,
        summary: page.summary || "",
        contentRevision: Number.isFinite(page.contentRevision) ? page.contentRevision : 0,
        summarySourceRevision: Number.isFinite(page.summarySourceRevision) ? page.summarySourceRevision : 0,
        summaryUpdatedAt: page.summaryUpdatedAt || page.updatedAt || page.createdAt || time,
        tags: Array.isArray(page.tags) ? page.tags : [],
        createdAt: page.createdAt || page.updatedAt || time,
        updatedAt: page.updatedAt || page.createdAt || time,
      }))
    : copyJson(fallback.pages || []);
  const prepared = {
    ...source,
    schemaVersion: source.schemaVersion || 1,
    folders,
    pages,
    dataSources: Array.isArray(source.dataSources) ? source.dataSources : [],
    databaseItems: Array.isArray(source.databaseItems) ? source.databaseItems : [],
    databaseViews: Array.isArray(source.databaseViews) ? source.databaseViews : [],
    relations: Array.isArray(source.relations) ? source.relations : [],
    ui: {
      ...(fallback.ui || {}),
      ...(source.ui || {}),
      preferences: { ...preferences, theme: normalizeThemePreference(preferences.theme), defaultFont: ["default", "serif", "mono"].includes(preferences.defaultFont) ? preferences.defaultFont : "default", startPage: preferences.startPage === "home" ? "home" : "last" },
      assetPreferences: {
        ...EMPTY_ASSET_PREFERENCES,
        ...((source.ui || {}).assetPreferences || {}),
        recentEmojiIds: normalizeIdList(source.ui?.assetPreferences?.recentEmojiIds, 48),
        recentIconIds: normalizeIdList(source.ui?.assetPreferences?.recentIconIds, 48),
        recentCoverIds: normalizeIdList(source.ui?.assetPreferences?.recentCoverIds, 32),
        favoriteCoverIds: normalizeIdList(source.ui?.assetPreferences?.favoriteCoverIds, 150),
      },
    },
  };
  let workspace;
  if (Number(source.schemaVersion) >= CURRENT_SCHEMA_VERSION) {
    // source already owns its JSON graph. Normalize rollups in place and
    // isolate the newly merged fallback UI.
    // Keep its nested JSON key so a fallback toJSON sees the same "ui" key.
    const detached = copyJson({ ui: prepared.ui });
    workspace = prepared;
    normalizeRollupDefinitions(workspace.dataSources);
    if (Object.hasOwn(detached, "ui")) workspace.ui = detached.ui;
    else delete workspace.ui;
  } else {
    // Legacy stages retain their JSON canonicalization and property presence.
    workspace = upgradeWorkspace(prepared);
  }
  if (!workspace.workspaceId) {
    if (typeof idFactory !== "function") throw new Error("缺少工作区 ID 生成器");
    workspace.workspaceId = idFactory("ws");
  }
  const cleaned = purgeExpiredTrashGroups(workspace, now ?? time);
  return {
    ...cleaned,
    pageVersions: Array.isArray(cleaned.pageVersions) ? cleaned.pageVersions : [],
    databaseVersions: Array.isArray(cleaned.databaseVersions) ? cleaned.databaseVersions : [],
  };
}
