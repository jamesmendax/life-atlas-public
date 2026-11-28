import { createDatabaseView, createProperty } from "../../src/domain/database.js";
import { normalizePropertyValue } from "../../src/domain/databaseProperties.js";
import { createTabsDocument } from "../../src/domain/blockDocument.js";

export function coreParityWorkspace() {
  const time = "2026-09-01T09:00:00.000Z";
  const prop = (id, name, type, extra = {}) => createProperty({ id, name, type, ...extra });
  const properties = [
    prop("title", "名称", "title"), prop("status", "状态", "status", { options: [{ id: "todo", name: "待办" }, { id: "doing", name: "进行中" }, { id: "done", name: "完成" }] }),
    prop("amount", "金额", "number"), prop("date", "日期", "date"), prop("checked", "确认", "checkbox"),
    prop("people", "负责人", "people"), prop("url", "链接", "url"), prop("email", "邮箱", "email"), prop("phone", "电话", "phone"), prop("files", "附件", "files"), prop("place", "地点", "place"),
    prop("notes", "说明", "text"), prop("labels", "标签", "multi_select", { options: [{ id: "design", name: "设计" }, { id: "launch", name: "发布" }] }),
    prop("formula", "双倍金额", "formula", { config: { expression: "{{amount}} * 2" } }),
    prop("relation", "供应方", "relation", { config: { targetSourceId: "partners" } }),
    prop("rollup", "供应方评分", "rollup", { config: { relationPropertyId: "relation", targetPropertyId: "rating", aggregation: "average" } }),
  ];
  const source = { id: "projects", title: "项目数据库", ownerPageId: "database-page", properties, createdAt: time, updatedAt: time };
  const views = ["table", "board", "list", "gallery", "calendar", "timeline", "chart", "form", "dashboard", "map"].map((type) => createDatabaseView({
    id: `view-${type}`, sourceId: source.id, type, name: `${type} view`, visiblePropertyIds: properties.map((property) => property.id),
    groupBy: type === "board" ? "status" : null,
    config: type === "chart" ? { chart: { kind: "bar", xPropertyId: "status", aggregation: "sum", valuePropertyId: "amount" } }
      : type === "map" ? { map: { placePropertyId: "place", labelPropertyId: "title", center: [0, 0], zoom: 1 } }
      : type === "form" ? { form: { title: "项目登记", description: "输入项目资料并保存到同一数据库。", open: true, anonymous: false, successMessage: "项目已登记", fields: properties.filter((property) => !["formula", "rollup"].includes(property.type)).map((property) => ({ propertyId: property.id, required: property.id === "title", hidden: ["relation", "labels", "files", "place", "phone", "date"].includes(property.id) })) } } : {},
  }));
  const definitions = [
    { id: "alpha", title: "Alpha 项目", status: "doing", amount: 120, start: "2026-09-18", end: "2026-09-21", place: { name: "柏林", address: "Berlin", latitude: 52.52, longitude: 13.405 } },
    { id: "beta", title: "Beta 项目", status: "todo", amount: 80, start: "2026-09-19", end: "2026-09-19", place: { name: "东京", address: "Tokyo", latitude: 35.676, longitude: 139.65 } },
    { id: "gamma", title: "Gamma 项目", status: "done", amount: -20, start: "2026-09-24", end: "2026-09-26", place: { name: "零坐标", address: "Origin", latitude: 0, longitude: 0 } },
  ];
  const items = definitions.map((entry, index) => ({ id: entry.id, sourceId: source.id, pageId: `${entry.id}-page`, parentItemId: null, createdAt: time, updatedAt: time, values: {
    title: entry.title, status: entry.status, amount: entry.amount, date: normalizePropertyValue("date", { start: entry.start, end: entry.end, includeTime: false, timeZone: null }), checked: false,
    people: index ? ["person-b"] : ["person-a"], url: "https://example.com/project", email: "team@example.com", phone: "+49 30 123456", files: ["attachment-reference"], place: entry.place, notes: `项目正文摘要 ${entry.id}`, labels: ["design"], relation: ["partner-one"],
  } }));
  const tabs = createTabsDocument(["计划", "任务", "资料"]);
  tabs.children[0].children = [{ id: "tab-p", type: "paragraph", content: "计划正文可被搜索" }, { id: "tab-callout", type: "callout", props: { icon: "💡" }, content: "重要提醒" }];
  tabs.children[1].children = [{ id: "tab-check", type: "checkListItem", props: { checked: false }, content: "核对验收清单" }, { id: "tab-sync", type: "syncedBlock", props: { sourceId: "shared-source" } }];
  tabs.children[2].children = [{ id: "tab-db", type: "databaseView", props: { sourceId: source.id, viewId: "view-table" } }];
  const page = (id, title, content, extra = {}) => ({ id, folderId: "work", title, content, icon: "📄", settings: { fontFamily: "default", smallText: false, fullWidth: false, locked: false }, createdAt: time, updatedAt: time, ...extra });
  return {
    schemaVersion: 7, folders: [{ id: "work", name: "项目工作区", parentId: null, createdAt: time, updatedAt: time }],
    pages: [page("database-page", "项目数据库", [], { pageType: "database", databaseSourceId: source.id, databaseViewId: "view-table" }),
      page("editor-page", "编辑器验收", [tabs, { id: "sync-main", type: "syncedBlock", props: { sourceId: "shared-source" } }, { id: "sync-second", type: "syncedBlock", props: { sourceId: "shared-source" } }, { id: "mention-line", type: "paragraph", content: [{ type: "pageMention", props: { pageId: "alpha-page", labelSnapshot: "Alpha 项目" } }, { type: "text", text: " / ", styles: {} }, { type: "userMention", props: { personId: "person-a", labelSnapshot: "林初" } }, { type: "text", text: " / ", styles: {} }, { type: "dateMention", props: { value: "2026-09-19", kind: "date" } }] }, { id: "insert-line", type: "paragraph", content: "" }, { id: "column-check", type: "columnList", props: { columns: 2 }, children: [{ id: "column-check-a", type: "column", props: { width: 50, index: 0, count: 2 }, children: [{ id: "column-check-a-text", type: "paragraph", content: "第一栏" }] }, { id: "column-check-b", type: "column", props: { width: 50, index: 1, count: 2 }, children: [{ id: "column-check-b-text", type: "paragraph", content: "第二栏" }] }] }]),
      ...definitions.map((entry) => page(`${entry.id}-page`, entry.title, [{ id: `${entry.id}-body`, type: "paragraph", content: `${entry.title}的文档正文和交付说明。` }], { databaseSourceId: source.id })),
      page("partner-page", "供应方一", [{ id: "partner-body", type: "paragraph", content: "供应方资料" }], { databaseSourceId: "partners" }),
    ],
    dataSources: [source, { id: "partners", title: "供应方", properties: [prop("title", "名称", "title"), prop("rating", "评分", "number")], createdAt: time, updatedAt: time }],
    databaseItems: [...items, { id: "partner-one", sourceId: "partners", pageId: "partner-page", values: { title: "供应方一", rating: 4.5 }, createdAt: time, updatedAt: time }],
    databaseViews: views, relations: [{ id: "relation-one", sourceId: source.id, propertyId: "relation", targetSourceId: "partners" }],
    people: [{ id: "person-local", displayName: "我", local: true }, { id: "person-a", displayName: "林初", local: true }, { id: "person-b", displayName: "周宁", local: true }],
    attachments: [{ id: "attachment-reference", name: "设计说明.pdf", provider: "external", externalUrl: "https://example.com/design.pdf", storageKey: "https://example.com/design.pdf", mimeType: "application/pdf", size: null, createdAt: time }],
    syncedSources: [{ id: "shared-source", revision: 0, blocks: [{ id: "shared-p", type: "paragraph", content: "共享交付说明" }], createdAt: time, updatedAt: time }],
    ui: { selectedPageId: "database-page", selectedFolderId: "work", expandedFolderIds: ["work"], currentPersonId: "person-local" },
  };
}
