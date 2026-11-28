// 满配工作区夹具（规格：docs/blueprint/10-测试夹具规格.md 第 2 节）。照抄，不要改动内容。
// 形状是 schema 10；测试里用 upgradeWorkspace(fullWorkspace()) 得到当前版本。
import { createHash } from "node:crypto";
import { createDatabaseView, createProperty } from "../../src/domain/database.js";

export const FIXTURE_TIME = "2026-10-01T08:00:00.000Z";
export const SOLO_TRASHED_AT = "2026-09-29T08:00:00.000Z";
export const PNG_1X1_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
export const PNG_1X1_DATA_URL = `data:image/png;base64,${PNG_1X1_BASE64}`;

const T = FIXTURE_TIME;
const settings = () => ({ fontFamily: "default", smallText: false, fullWidth: false, presentationMode: "default", locked: false });
const page = (id, folderId, title, content, extra = {}) => ({
  id, folderId, title, icon: "📄", iconColor: null, cover: null, settings: settings(), trashedAt: null,
  summary: "", contentRevision: 0, summarySourceRevision: 0, summaryUpdatedAt: T, tags: [], sortIndex: 10,
  createdAt: T, updatedAt: T, content, ...extra,
});
const folder = (id, parentId, name, sortIndex, extra = {}) => ({ id, parentId, name, color: "stone", sortIndex, lastOpenedPageId: null, createdAt: T, updatedAt: T, ...extra });
const paragraph = (id, content) => ({ id, type: "paragraph", content });
const attachment = (id, name, mime, size, sha256) => ({
  id, name, mime, size, createdAt: T, updatedAt: T, checksum: sha256, provider: "local-ref", storageKey: id, externalUrl: null, metadata: { durableStore: "indexeddb" },
});

// 确定性的“随机”字节：第 i 个 32 字节块 = SHA-256("<seed>:<i>")，最后一块截断到 size。
export function fixtureBytes(seed, size) {
  const out = new Uint8Array(size);
  for (let offset = 0, index = 0; offset < size; offset += 32, index += 1) {
    const block = createHash("sha256").update(`${seed}:${index}`).digest();
    out.set(block.subarray(0, Math.min(32, size - offset)), offset);
  }
  return out;
}

// 附件二进制：附件 id → Uint8Array
export function fullWorkspaceAttachmentBytes() {
  return new Map([
    ["att-img", new Uint8Array(Buffer.from(PNG_1X1_BASE64, "base64"))],
    ["att-file", fixtureBytes("att-file", 1024)],
    ["att-orphan", new Uint8Array(Buffer.from("hello", "utf8"))],
  ]);
}

export function fullWorkspace() {
  const inlineProperties = [
    createProperty({ id: "title", name: "名称", type: "title" }),
    createProperty({ id: "status", name: "状态", type: "status", options: [
      { id: "todo", name: "未开始", color: "gray" }, { id: "doing", name: "进行中", color: "blue" }, { id: "done", name: "已完成", color: "green" },
    ] }),
    createProperty({ id: "done", name: "完成", type: "checkbox" }),
    createProperty({ id: "due", name: "截止", type: "date" }),
    createProperty({ id: "owner", name: "负责人", type: "people" }),
    createProperty({ id: "files", name: "附件", type: "files" }),
    createProperty({ id: "rel-to-full", name: "所属项目", type: "relation", config: { targetSourceId: "ds-full" } }),
  ];
  const fullProperties = [
    createProperty({ id: "title", name: "名称", type: "title" }),
    createProperty({ id: "score", name: "评分", type: "number" }),
    createProperty({ id: "rel-back", name: "任务", type: "relation", config: { targetSourceId: "ds-inline" } }),
    createProperty({ id: "task-count", name: "任务数", type: "rollup", config: { relationPropertyId: "rel-back", targetPropertyId: "title", aggregation: "count" } }),
  ];
  const view = (id, sourceId, name, type, extra = {}) => ({ ...createDatabaseView({ id, sourceId, name, type, ...extra }), createdAt: T, updatedAt: T });
  const item = (id, sourceId, pageId, values) => ({ id, sourceId, pageId, parentItemId: null, values, createdAt: T, updatedAt: T });
  const date = (start) => ({ start, end: null, includeTime: false, timeZone: null });

  return {
    schemaVersion: 10,
    savedAt: T,
    folders: [
      folder("f-a", null, "A 项目", 10, { color: "blue", lastOpenedPageId: "p-a1" }),
      folder("f-b", "f-a", "B 资料", 10, { color: "green" }),
      folder("f-c", "f-b", "C 细节", 10, { color: "orange" }),
      folder("f-z", null, "Z 其他", 20),
      folder("f-empty", null, "空文件夹", 30),
    ],
    pages: [
      page("p-a1", "f-a", "A 概览", [
        { id: "b-a1-h", type: "heading", props: { level: 2 }, content: "概览" },
        paragraph("b-a1-p", [{ type: "text", text: "提及：", styles: {} }, { type: "pageMention", props: { pageId: "p-z1", labelSnapshot: "Z 目标页" } }]),
        { id: "b-a1-link", type: "pageLink", props: { pageId: "p-c1", label: "C 深层" } },
      ], { icon: "📘", cover: { kind: "gallery", value: "hokusai-landscape", position: 50 } }),
      page("p-a1-child", "f-a", "A 子页面", [paragraph("b-a1c-p", "子页面正文")], { parentPageId: "p-a1" }),
      page("p-b1", "f-b", "B 笔记", [
        paragraph("b-b1-p", "行内数据库如下"),
        { id: "b-b1-db", type: "databaseView", props: { sourceId: "ds-inline", viewId: "v-inline-table" } },
        { id: "b-b1-sync1", type: "syncedBlock", props: { sourceId: "sync-shared" } },
        { id: "b-b1-sync2", type: "syncedBlock", props: { sourceId: "sync-only-b1" } },
        { id: "b-b1-img", type: "image", props: { url: "blob:http://127.0.0.1:5178/fixture-img#life-attachment=att-img", name: "图.png", caption: "" } },
      ]),
      page("p-b-solo", "f-b", "B 单独删除的页", [paragraph("b-solo-p", "早就单独删除了")], { trashedAt: SOLO_TRASHED_AT, updatedAt: SOLO_TRASHED_AT }),
      page("p-c1", "f-c", "C 深层", [paragraph("b-c1-p", "深层正文")], { icon: PNG_1X1_DATA_URL }),
      page("p-z1", "f-z", "Z 目标页", [
        { id: "b-z1-sync", type: "syncedBlock", props: { sourceId: "sync-shared" } },
        { id: "b-z1-db", type: "databaseView", props: { sourceId: "ds-inline", viewId: "v-inline-linked" } },
        paragraph("b-z1-mention", [{ type: "pageMention", props: { pageId: "p-b1", labelSnapshot: "B 笔记" } }]),
      ], { cover: { kind: "upload", value: PNG_1X1_DATA_URL, position: 50 } }),
      page("p-db", "f-z", "整页项目库", [], { pageType: "database", databaseSourceId: "ds-full", databaseViewId: "v-full-table", icon: "icon:database", sortIndex: 20 }),
      page("p-rec-1", "f-b", "任务一", [paragraph("b-rec1-p", "任务一的正文")], { databaseSourceId: "ds-inline", sortIndex: 20 }),
      page("p-rec-2", "f-b", "任务二", [paragraph("b-rec2-p", "")], { databaseSourceId: "ds-inline", sortIndex: 30 }),
      page("p-rec-3", "f-z", "项目甲", [paragraph("b-rec3-p", "")], { databaseSourceId: "ds-full", sortIndex: 30 }),
      page("p-rec-4", "f-z", "项目乙", [paragraph("b-rec4-p", "")], { databaseSourceId: "ds-full", sortIndex: 40 }),
    ],
    dataSources: [
      { id: "ds-inline", title: "行内任务", ownerPageId: "p-b1", properties: inlineProperties, createdAt: T, updatedAt: T },
      { id: "ds-full", title: "整页项目库", ownerPageId: "p-db", properties: fullProperties, createdAt: T, updatedAt: T },
    ],
    databaseItems: [
      item("i-1", "ds-inline", "p-rec-1", { title: "任务一", status: "done", done: true, due: date("2026-10-05"), owner: ["person-local"], files: ["att-file"], "rel-to-full": ["i-3"] }),
      item("i-2", "ds-inline", "p-rec-2", { title: "任务二", status: "doing", done: false, "rel-to-full": ["i-3", "i-4"] }),
      item("i-3", "ds-full", "p-rec-3", { title: "项目甲", score: 5, "rel-back": ["i-1", "i-2"] }),
      item("i-4", "ds-full", "p-rec-4", { title: "项目乙", score: 3, "rel-back": ["i-2"] }),
    ],
    databaseViews: [
      view("v-inline-table", "ds-inline", "表格", "table"),
      view("v-inline-board", "ds-inline", "看板", "board", { groupBy: "status" }),
      view("v-inline-linked", "ds-inline", "关联视图", "table", { linked: true }),
      view("v-full-table", "ds-full", "表格", "table"),
    ],
    relations: [
      { id: "r-inline-full", sourceId: "ds-inline", propertyId: "rel-to-full", targetSourceId: "ds-full", reciprocalPropertyId: "rel-back" },
      { id: "r-full-inline", sourceId: "ds-full", propertyId: "rel-back", targetSourceId: "ds-inline", reciprocalPropertyId: "rel-to-full" },
    ],
    syncedSources: [
      { id: "sync-shared", revision: 0, blocks: [paragraph("sync-shared-p", "共享内容")], createdAt: T, updatedAt: T },
      { id: "sync-only-b1", revision: 0, blocks: [paragraph("sync-b1-p", "只在 B 笔记里")], createdAt: T, updatedAt: T },
    ],
    attachments: [
      attachment("att-img", "图.png", "image/png", 70, "c414cd0e204de974f73753c7e28d7638e7b3691bb8b1a2bab6b25bb7fed7ce77"),
      attachment("att-file", "说明.pdf", "application/pdf", 1024, "4b3d5f19fb987bf46482a9084c79b02b3530903cb3175323a5e35d61e9df3d67"),
      attachment("att-orphan", "未引用.txt", "text/plain", 5, "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"),
    ],
    people: [
      { id: "person-local", displayName: "我", local: true, createdAt: T, updatedAt: T },
      { id: "person-a", displayName: "林初", local: true, createdAt: T, updatedAt: T },
    ],
    pageTemplates: [
      { id: "tpl-1", name: "周记模板", icon: "📝", cover: null, content: [{ id: "tpl-1-h", type: "heading", props: { level: 2 }, content: "本周" }], createdAt: T, updatedAt: T },
    ],
    databaseTemplates: [
      { id: "dbt-1", sourceId: "ds-inline", name: "默认任务", defaultValues: { status: "todo" }, pageContent: [], pageAppearance: null, createdAt: T, updatedAt: T },
    ],
    discussions: [
      { id: "disc-c1", pageId: "p-c1", anchor: { kind: "page" }, resolvedAt: null, createdAt: T, updatedAt: T },
      { id: "disc-rec1", pageId: "p-rec-1", anchor: { kind: "page" }, resolvedAt: null, createdAt: T, updatedAt: T },
    ],
    comments: [
      { id: "cm-1", discussionId: "disc-c1", authorId: "person-local", body: "第一条评论", createdAt: T, editedAt: null, deletedAt: null },
      { id: "cm-2", discussionId: "disc-c1", authorId: "person-local", body: "第二条评论", createdAt: T, editedAt: null, deletedAt: null },
      { id: "cm-3", discussionId: "disc-rec1", authorId: "person-local", body: "记录上的评论", createdAt: T, editedAt: null, deletedAt: null },
    ],
    ui: {
      selectedPageId: "p-a1", selectedFolderId: "f-a", expandedFolderIds: ["f-a", "f-b"], privateExpanded: true, currentPersonId: "person-local",
      assetPreferences: { recentEmojiIds: [], recentIconIds: [], recentCoverIds: [], favoriteCoverIds: [] },
    },
  };
}

export const BIG_ATTACHMENT_SIZE = 21 * 1024 * 1024;
export function withLargeAttachment(workspace) {
  const next = structuredClone(workspace);
  next.attachments.push({ id: "att-big", name: "大文件.bin", mime: "application/octet-stream", size: BIG_ATTACHMENT_SIZE, createdAt: FIXTURE_TIME, updatedAt: FIXTURE_TIME,
    checksum: "59b2d8236470ac95f49928379d745005e4a1c0778c707530715e6c213cea4c17", provider: "local-ref", storageKey: "att-big", externalUrl: null, metadata: {} });
  next.pages.find((page) => page.id === "p-z1").content.push({ id: "b-z1-big", type: "file", props: { url: "blob:http://127.0.0.1:5178/fixture-big#life-attachment=att-big", name: "大文件.bin", caption: "" } });
  return next;
}
export function largeAttachmentBytes() { return fixtureBytes("att-big", BIG_ATTACHMENT_SIZE); }
