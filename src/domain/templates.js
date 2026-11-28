import { cloneBlockDocument, copyJson, newEntityId, walkBlocks } from "./blockDocument.js";
import { normalizePageSettings } from "./pageActions.js";
import { inlineSemanticText } from "./databaseProperties.js";
import { compareNavigationOrder, folderAncestors } from "./navigation.js";

const nowIso = () => new Date().toISOString();

export function templateFolderChoices(workspace) {
  const folders = workspace?.folders || [];
  return folders.filter((folder) => !folder.trashedAt && folderAncestors(folders, folder.id).every((ancestor) => !ancestor.trashedAt))
    .map((folder) => ({ ...folder, path: folderAncestors(folders, folder.id).map((ancestor) => ancestor.name).join(" / ") }))
    .sort((left, right) => left.path.localeCompare(right.path) || compareNavigationOrder(left, right));
}

export function defaultTemplateFolderId(workspace, currentFolderId) {
  const choices = templateFolderChoices(workspace);
  if (choices.some((folder) => folder.id === currentFolderId)) return currentFolderId;
  return choices.filter((folder) => !folder.parentId).sort(compareNavigationOrder)[0]?.id || "";
}

export function pageTemplateDescription(template) {
  const date = new Date(template?.createdAt);
  return Number.isFinite(date.getTime()) ? `我的模板，${date.getMonth() + 1}月${date.getDate()}日保存` : "我的模板";
}

export function pageTemplatePreview(template, workspace) {
  return walkBlocks(template?.content || []).slice(0, 5).map((block) => inlineSemanticText(block.content, workspace));
}

export function createPageTemplate(page, { id = newEntityId("page-template"), name, now = nowIso() } = {}) {
  return {
    id,
    name: String(name || page?.title || "页面模板").trim().slice(0, 160) || "页面模板",
    icon: page?.icon || null,
    pageSettings: normalizePageSettings(page?.settings),
    content: copyJson(page?.content || []),
    createdAt: now,
    updatedAt: now,
  };
}

export function updatePageTemplate(template, patch, now = nowIso()) {
  return {
    ...template,
    ...(patch.name !== undefined ? { name: String(patch.name).trim().slice(0, 160) || template.name } : {}),
    ...(patch.icon !== undefined ? { icon: patch.icon || null } : {}),
    ...(patch.pageSettings !== undefined ? { pageSettings: normalizePageSettings(patch.pageSettings) } : {}),
    ...(patch.content !== undefined ? { content: copyJson(patch.content || []) } : {}),
    updatedAt: now,
  };
}

export function instantiatePageTemplate(template, { id = newEntityId("page"), folderId, sortIndex = 0, title, now = nowIso() } = {}) {
  return {
    id,
    folderId,
    title: String(title || template?.name || "无标题页面"),
    icon: template?.icon || "📄",
    iconColor: null,
    cover: null,
    settings: normalizePageSettings(template?.pageSettings),
    trashedAt: null,
    summary: "",
    contentRevision: 0,
    summarySourceRevision: 0,
    summaryUpdatedAt: now,
    tags: [],
    sortIndex,
    createdAt: now,
    updatedAt: now,
    content: cloneBlockDocument(template?.content || []),
  };
}

export function createDatabaseTemplate(sourceId, { id = newEntityId("db-template"), name = "数据库模板", defaultValues = {}, pageContent = [], pageAppearance = null, now = nowIso() } = {}) {
  return {
    id,
    sourceId,
    name: String(name).trim().slice(0, 160) || "数据库模板",
    defaultValues: copyJson(defaultValues || {}),
    pageContent: copyJson(pageContent || []),
    pageAppearance: pageAppearance ? copyJson(pageAppearance) : null,
    createdAt: now,
    updatedAt: now,
  };
}

export function updateDatabaseTemplate(template, patch, now = nowIso()) {
  return {
    ...template,
    ...(patch.name !== undefined ? { name: String(patch.name).trim().slice(0, 160) || template.name } : {}),
    ...(patch.defaultValues !== undefined ? { defaultValues: copyJson(patch.defaultValues || {}) } : {}),
    ...(patch.pageContent !== undefined ? { pageContent: copyJson(patch.pageContent || []) } : {}),
    ...(patch.pageAppearance !== undefined ? { pageAppearance: patch.pageAppearance ? copyJson(patch.pageAppearance) : null } : {}),
    updatedAt: now,
  };
}

export function applyDatabaseTemplate(template) {
  return {
    values: copyJson(template?.defaultValues || {}),
    content: cloneBlockDocument(template?.pageContent || []),
    appearance: template?.pageAppearance ? copyJson(template.pageAppearance) : null,
  };
}
