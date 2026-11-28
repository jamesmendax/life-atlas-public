import { newEntityId } from "./blockDocument.js";
import { defaultPageSettings } from "./pageActions.js";
import { derivePageSummary } from "./content.js";

export function newNotePage({ folderId, title, now, content = [], sortIndex = 10, inboxedAt = null, iconColor = null, fontFamily = "default", idFactory = newEntityId }) {
  const document = content.length ? content : [{ id: idFactory("block"), type: "paragraph", content: "" }];
  return { id: idFactory("page"), folderId, title, icon: "📄", iconColor, cover: null, settings: { ...defaultPageSettings, fontFamily: ["default", "serif", "mono"].includes(fontFamily) ? fontFamily : "default" }, trashedAt: null, trashedByFolderId: null, trashedByPageId: null, inboxedAt, summary: content.length ? derivePageSummary({ content: document }) : "新建笔记，还没有足够的正文可供总结。", contentRevision: 0, summarySourceRevision: 0, summaryUpdatedAt: now, tags: [], sortIndex, createdAt: now, updatedAt: now, content: document };
}
