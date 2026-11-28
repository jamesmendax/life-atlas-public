import { CURRENT_SCHEMA_VERSION } from "../persistence/migrations.js";
import { requiredCollections } from "../backup/format.js";
import { normalizePageSettings } from "./pageActions.js";

export function createBlankWorkspace({ now, idFactory }) {
  if (typeof now !== "string" || !Number.isFinite(Date.parse(now)) || typeof idFactory !== "function") throw new TypeError("空白工作区需要时间和 ID 工厂");
  const folderId = idFactory("folder");
  const pageId = idFactory("page");
  const workspace = Object.fromEntries(requiredCollections(CURRENT_SCHEMA_VERSION).map((collection) => [collection, []]));
  const block = (type, content, props = {}) => ({ id: idFactory("block"), type, props, content });
  workspace.schemaVersion = CURRENT_SCHEMA_VERSION;
  workspace.workspaceId = idFactory("ws");
  workspace.savedAt = now;
  workspace.folders = [
    { id: folderId, parentId: null, name: "我的空间", color: "stone", sortIndex: 10, lastOpenedPageId: pageId, trashedAt: null, trashedByFolderId: null, createdAt: now, updatedAt: now },
    { id: "system-inbox", system: "inbox", name: "收件箱", parentId: null, color: "stone", sortIndex: -1, lastOpenedPageId: null, trashedAt: null, trashedByFolderId: null, createdAt: now, updatedAt: now },
  ];
  workspace.pages = [{
    id: pageId, folderId, title: "开始使用 Life Atlas", icon: "👋", iconColor: null, cover: null, settings: normalizePageSettings(),
    trashedAt: null, trashedByFolderId: null, trashedByPageId: null, summary: "开始使用你的本地工作空间", contentRevision: 0,
    summarySourceRevision: 0, summaryUpdatedAt: now, tags: [], sortIndex: 10, createdAt: now, updatedAt: now,
    content: [
      block("heading", "欢迎", { level: 2 }),
      block("paragraph", "这里是你的私人工作空间，所有内容只保存在这台电脑的数据目录里。"),
      block("checkListItem", "输入 / 试试添加标题、待办、表格和数据库", { checked: false }),
      block("checkListItem", "在左上角菜单里找到“备份与恢复”，导出第一份完整备份", { checked: false }),
      block("checkListItem", "打开模板库，试试“软件开发进程”模板", { checked: false }),
    ],
  }];
  workspace.people = [{ id: "person-local", displayName: "我", local: true, createdAt: now, updatedAt: now }];
  workspace.ui = {
    selectedFolderId: folderId, selectedPageId: pageId, expandedFolderIds: [folderId], privateExpanded: true, currentPersonId: "person-local",
    assetPreferences: { recentEmojiIds: [], recentIconIds: [], recentCoverIds: [], favoriteCoverIds: [] },
    preferences: { theme: "system", defaultFont: "default", startPage: "last" },
  };
  return workspace;
}
