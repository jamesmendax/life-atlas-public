import { derivePageSummary, documentToPlainText, normalizeSearchText } from "../domain/content.js";
import { pageSemanticText } from "../domain/documentSemantics.js";
import { formatPropertyValue } from "../domain/databaseProperties.js";
import { dataSourceById, itemDisplayTitle, resolvePropertyValue } from "../domain/database.js";
import { isPageArchived } from "../domain/archive.js";
import { attachmentReferences } from "../domain/trash.js";

function folderPath(folders, folderId) {
  const names = [];
  const seen = new Set();
  let current = folders.find((folder) => folder.id === folderId) ?? null;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    names.unshift(current.name);
    current = current.parentId ? folders.find((folder) => folder.id === current.parentId) ?? null : null;
  }
  return names;
}

export function buildSearchDocuments(folders, pages, workspace) {
  const folderDocuments = folders.filter((folder) => !folder.trashedAt && !folder.system).map((folder) => ({
    id: `folder:${folder.id}`,
    entityId: folder.id,
    type: "folder",
    title: folder.name,
    path: folderPath(folders, folder.parentId).join(" / ") || "Private",
    summary: folder.summary || "",
    body: "",
    updatedAt: folder.updatedAt || folder.createdAt || "",
  }));

  const pageDocuments = pages.filter((page) => !page.trashedAt).map((page) => {
    const body = workspace ? pageSemanticText(page, workspace) : documentToPlainText(page.content);
    const pathNames = folderPath(folders, page.folderId);
    return {
      id: `page:${page.id}`,
      entityId: page.id,
      type: "page",
      title: page.title || "无标题页面",
      path: folders.find((folder) => folder.id === page.folderId)?.system === "inbox" ? "收件箱" : ["Private", ...pathNames].join(" / "),
      summary: page.summary || derivePageSummary(page, 96, workspace),
      body,
      updatedAt: page.updatedAt || page.createdAt || "",
    };
  });

  if (!workspace) return [...pageDocuments, ...folderDocuments].map((document) => document.type === "page" && pages.some((page) => page.id === document.entityId && page.archivedAt) ? { ...document, archived: true } : document);
  const pageMap = new Map(pages.map((page) => [page.id, page]));
  const databaseDocuments = (workspace.databaseItems || []).filter((item) => {
    const page = pageMap.get(item.pageId);
    return page && !page.trashedAt;
  }).map((item) => {
    const source = dataSourceById(workspace, item.sourceId);
    const page = pageMap.get(item.pageId);
    const values = (source?.properties || []).map((property) => {
      const resolved = resolvePropertyValue(workspace, source, item, property);
      return `${property.name}: ${formatPropertyValue(workspace, property, resolved)}`;
    }).filter(Boolean);
    return {
      id: `database_item:${item.id}`, entityId: item.id, pageId: item.pageId, type: "database_item",
      title: source ? itemDisplayTitle(workspace, source, item) : page?.title || "数据库记录",
      path: source?.title || "数据库", summary: values.slice(0, 3).join(" · "), body: values.join("\n"),
      updatedAt: page?.updatedAt || item.updatedAt || item.createdAt || "",
    };
  });
  const commentDocuments = (workspace.comments || []).filter((comment) => {
    const discussion = (workspace.discussions || []).find((entry) => entry.id === comment.discussionId);
    const page = pageMap.get(discussion?.pageId);
    return !comment.deletedAt && page && !page.trashedAt;
  }).map((comment) => {
    const discussion = (workspace.discussions || []).find((entry) => entry.id === comment.discussionId);
    const page = pageMap.get(discussion?.pageId);
    return {
      id: `comment:${comment.id}`, entityId: comment.id, pageId: discussion?.pageId || null, type: "comment",
      title: `评论 · ${page?.title || "页面"}`, path: page?.title || "页面讨论", summary: comment.body, body: comment.body,
      updatedAt: comment.editedAt || comment.createdAt || "", metadata: { discussionId: comment.discussionId, anchor: discussion?.anchor || null },
    };
  });
  const attachmentDocuments = (workspace.attachments || []).map((attachment) => {
    const item = (workspace.databaseItems || []).find((entry) => {
      const page = pageMap.get(entry.pageId);
      if (!page || page.trashedAt) return false;
      const source = dataSourceById(workspace, entry.sourceId);
      return (source?.properties || []).some((property) => property.type === "files" && Array.isArray(entry.values?.[property.id]) && entry.values[property.id].includes(attachment.id));
    });
    return {
      id: `attachment:${attachment.id}`, entityId: attachment.id, pageId: item?.pageId || null, type: "attachment",
      title: attachment.name || "附件", path: item?.pageId ? pageMap.get(item.pageId)?.title || "数据库记录" : "工作区附件",
      summary: [attachment.mime || attachment.mimeType, attachment.provider].filter(Boolean).join(" · "),
      body: [attachment.name, attachment.mime, attachment.mimeType, attachment.metadata?.description].filter(Boolean).join(" "),
      updatedAt: attachment.updatedAt || attachment.createdAt || "",
    };
  });
  const templateDocuments = [
    ...(workspace.pageTemplates || []).map((template) => ({
      id:`template:${template.id}`, entityId:template.id, type:"template", title:template.name, path:"页面模板",
      summary:"可复用页面模板", body:documentToPlainText(template.content || []), updatedAt:template.updatedAt || template.createdAt || "",
    })),
    ...(workspace.databaseTemplates || []).map((template) => {
      const source = dataSourceById(workspace, template.sourceId);
      const readable = Object.entries(template.defaultValues || {}).map(([propertyId, value]) => {
        const property = source?.properties?.find((entry) => entry.id === propertyId);
        return property ? `${property.name}: ${formatPropertyValue(workspace, property, value)}` : "";
      }).filter(Boolean);
      return {
        id:`template:${template.id}`, entityId:template.id, type:"template", title:template.name,
        path:source?.title ? `${source.title} / 数据库模板` : "数据库模板", summary:readable.join(" · "),
        body:[readable.join("\n"), documentToPlainText(template.pageContent || [])].filter(Boolean).join("\n"),
        updatedAt:template.updatedAt || template.createdAt || "",
      };
    }),
  ];
  const references = (archived) => attachmentReferences({
    pages: pages.filter((page) => !page.trashedAt && isPageArchived(workspace, page.id) === archived),
    databaseItems: (workspace.databaseItems || []).filter((item) => !pageMap.get(item.pageId)?.trashedAt && isPageArchived(workspace, item.pageId) === archived),
    dataSources: workspace.dataSources, attachments: workspace.attachments,
  });
  const activeFiles = references(false), archivedFiles = references(true);
  return [...pageDocuments, ...folderDocuments, ...databaseDocuments, ...commentDocuments, ...attachmentDocuments, ...templateDocuments].map((document) => {
    const archived = document.type === "attachment"
      ? archivedFiles.has(document.entityId) && !activeFiles.has(document.entityId)
      : isPageArchived(workspace, document.type === "page" ? document.entityId : document.pageId);
    return archived ? { ...document, archived: true } : document;
  });
}

function indexOfNormalized(haystack, needle) {
  return normalizeSearchText(haystack).indexOf(needle);
}

function scoreDocument(document, needle) {
  const titleIndex = indexOfNormalized(document.title, needle);
  const summaryIndex = indexOfNormalized(document.summary, needle);
  const bodyIndex = indexOfNormalized(document.body, needle);
  const pathIndex = indexOfNormalized(document.path, needle);

  let score = 0;
  if (titleIndex >= 0) score += 120 - Math.min(titleIndex, 40);
  if (summaryIndex >= 0) score += 65 - Math.min(summaryIndex, 30);
  if (bodyIndex >= 0) score += 48 - Math.min(bodyIndex, 28);
  if (pathIndex >= 0) score += 18 - Math.min(pathIndex, 12);
  if (score > 0 && document.type === "page") score += 4;
  return { score, titleIndex, summaryIndex, bodyIndex };
}

export function querySearch(documents, query, filter = "all", { archive = "active" } = {}) {
  const needle = normalizeSearchText(query).trim();
  const filtered = documents.filter((document) => {
    if (archive !== "all" && Boolean(document.archived) !== (archive === "archived")) return false;
    if (filter === "pages" && document.type !== "page") return false;
    if (filter === "folders" && document.type !== "folder") return false;
    if (filter === "content" && !["page","database_item","comment","attachment","template"].includes(document.type)) return false;
    if (!needle) return true;
    const scored = scoreDocument(document, needle);
    if (filter === "content") return scored.bodyIndex >= 0 || scored.summaryIndex >= 0;
    return scored.score > 0;
  });

  if (!needle) {
    return filtered
      .slice()
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
      .slice(0, 16);
  }

  return filtered
    .map((document) => ({ ...document, ...scoreDocument(document, needle) }))
    .filter((document) => document.score > 0)
    .sort((a, b) => b.score - a.score || String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .slice(0, 30);
}

export function searchSnippet(document, query, radius = 52) {
  const needle = normalizeSearchText(query).trim();
  const source = document.body || document.summary || "";
  if (!source) return document.summary || "";
  if (!needle) return source.slice(0, radius * 2);
  const normalized = normalizeSearchText(source);
  const index = normalized.indexOf(needle);
  if (index < 0) return (document.summary || source).slice(0, radius * 2);
  const start = Math.max(0, index - radius);
  const end = Math.min(source.length, index + needle.length + radius);
  return `${start > 0 ? "…" : ""}${source.slice(start, end).trim()}${end < source.length ? "…" : ""}`;
}
