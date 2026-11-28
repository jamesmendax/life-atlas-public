import { createDatabaseView, createProperty } from "../../src/domain/database.js";
import { BASE_BACKUP_COLLECTIONS } from "../../src/backup/format.js";
import { FIXTURE_TIME } from "./full-workspace.mjs";

export function bigWorkspace({ pages = 5000, records = 20000 } = {}) {
  if (!Number.isSafeInteger(pages) || pages < 0 || !Number.isSafeInteger(records) || records < 0) throw new TypeError("夹具数量必须是非负整数");
  let sequence = 0;
  const time = () => new Date(Date.parse(FIXTURE_TIME) + sequence++ * 1000).toISOString();
  const workspace = Object.fromEntries(BASE_BACKUP_COLLECTIONS.map((collection) => [collection, []]));
  workspace.schemaVersion = 10;
  workspace.workspaceId = "ws-big-fixture";
  workspace.savedAt = FIXTURE_TIME;
  const folder = (id, parentId, name, sortIndex) => {
    const createdAt = time();
    return { id, parentId, name, color: "stone", sortIndex, lastOpenedPageId: null, createdAt, updatedAt: createdAt };
  };
  for (let topIndex = 0; topIndex < 10; topIndex += 1) {
    workspace.folders.push(folder(`big-f-${topIndex}`, null, `项目 ${topIndex}`, topIndex * 10));
    for (let childIndex = 0; childIndex < 50; childIndex += 1) workspace.folders.push(folder(`big-f-${topIndex}-${childIndex}`, `big-f-${topIndex}`, `资料 ${topIndex}-${childIndex}`, childIndex * 10));
  }
  const page = (id, folderId, title, content, extras = {}) => {
    const createdAt = time();
    return {
      id, folderId, title, icon: "📄", iconColor: null, cover: null,
      settings: { fontFamily: "default", smallText: false, fullWidth: false, presentationMode: "default", locked: false },
      trashedAt: null, summary: "", contentRevision: 0, summarySourceRevision: 0, summaryUpdatedAt: createdAt,
      tags: [], sortIndex: sequence * 10, createdAt, updatedAt: createdAt, content, ...extras,
    };
  };
  const paragraph = "本地数据完整安全可靠".repeat(4);
  for (let pageIndex = 0; pageIndex < pages; pageIndex += 1) {
    const folderIndex = pageIndex % 500;
    workspace.pages.push(page(`big-p-${pageIndex}`, `big-f-${Math.floor(folderIndex / 50)}-${folderIndex % 50}`, `资料页面 ${pageIndex}`, Array.from({ length: 5 }, (_, blockIndex) => ({ id: `big-b-${pageIndex}-${blockIndex}`, type: "paragraph", content: paragraph }))));
  }
  workspace.pages.push(page("big-db-page", "big-f-0", "性能测试数据库", [], { pageType: "database", databaseSourceId: "big-ds", databaseViewId: "big-view" }));
  const properties = [
    createProperty({ id: "title", name: "标题", type: "title" }),
    createProperty({ id: "status", name: "状态", type: "status", options: [{ id: "todo", name: "未开始", color: "gray" }, { id: "doing", name: "进行中", color: "blue" }, { id: "done", name: "已完成", color: "green" }] }),
    createProperty({ id: "amount", name: "数字", type: "number" }),
    createProperty({ id: "due", name: "日期", type: "date" }),
  ];
  const sourceTime = time();
  workspace.dataSources.push({ id: "big-ds", title: "性能测试数据库", ownerPageId: "big-db-page", properties, createdAt: sourceTime, updatedAt: sourceTime });
  const viewTime = time();
  workspace.databaseViews.push({ ...createDatabaseView({ id: "big-view", sourceId: "big-ds", name: "表格", type: "table" }), createdAt: viewTime, updatedAt: viewTime });
  for (let recordIndex = 0; recordIndex < records; recordIndex += 1) {
    const title = `记录 ${recordIndex}`;
    const createdAt = time();
    workspace.databaseItems.push({ id: `big-i-${recordIndex}`, sourceId: "big-ds", pageId: `big-r-${recordIndex}`, parentItemId: null, values: { title, status: ["todo", "doing", "done"][recordIndex % 3], amount: recordIndex, due: { start: createdAt.slice(0, 10), end: null, includeTime: false, timeZone: null } }, createdAt, updatedAt: createdAt });
    workspace.pages.push(page(`big-r-${recordIndex}`, "big-f-0", title, [{ id: `big-r-b-${recordIndex}`, type: "paragraph", content: `记录正文 ${recordIndex}` }], { databaseSourceId: "big-ds" }));
  }
  workspace.people.push({ id: "person-local", displayName: "我", local: true, createdAt: FIXTURE_TIME, updatedAt: FIXTURE_TIME });
  workspace.ui = { selectedFolderId: "big-f-0", selectedPageId: "big-db-page", expandedFolderIds: ["big-f-0"], privateExpanded: true, currentPersonId: "person-local", assetPreferences: { recentEmojiIds: [], recentIconIds: [], recentCoverIds: [], favoriteCoverIds: [] } };
  return workspace;
}
