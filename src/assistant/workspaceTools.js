import { coverWithPosition } from "../components/coverPosition.js";
import { coverGallery, coverGalleryItem, normalizeCoverChoice } from "../data/coverGallery.js";
import { blockContext, cloneBlockDocument, mapBlocks, newEntityId, walkBlocks } from "../domain/blockDocument.js";
import { normalizeSearchText } from "../domain/content.js";
import { duplicateDatabaseItem } from "../domain/database.js";
import { normalizeIdValues } from "../domain/databaseProperties.js";
import { childFolders, folderAncestors, moveFolder, renameFolder, topLevelPages } from "../domain/navigation.js";
import { newNotePage } from "../domain/newPage.js";
import { duplicatePage, isTrashExpired, normalizePageSettings } from "../domain/pageActions.js";
import { moveOwnedPage } from "../domain/pageMoves.js";
import { ownedDescendantPageIds, restoreTrashGroup, trashFolder, trashPage } from "../domain/trash.js";
import { workspaceToolParameters } from "./toolCatalog.js";
import { databaseAssistantReadTools, databaseAssistantTools } from "./databaseTools.js";
import { assistantBodyDocument, assistantMediaAsset, collectPageImageUrls } from "./pageContent.js";
import { pageBlockExcerpt } from "./pageReadExcerpt.js";
import {
  availableFolder, editedPage, getPage, labelOf, nextSortIndex, pageById, pageIdentity, resolveCreationFolder,
  toolError as error, toolResult as result, WorkspaceToolError,
} from "./workspaceToolSupport.js";

const textBlockTypes = new Set([
  "paragraph", "heading", "bulletListItem", "numberedListItem", "checkListItem", "toggleListItem", "quote", "codeBlock", "callout",
]);
const replaceableBlockTypes = new Set([
  ...textBlockTypes, "table", "divider", "equation", "image", "video", "audio", "file", "columnList", "column",
  "tableOfContents", "breadcrumb",
]);
const objects = [Object.prototype, null];

function argumentMatches(value, rule) {
  if (rule.anyOf) return rule.anyOf.some((branch) => argumentMatches(value, branch));
  if (rule.type === "array") return Array.isArray(value)
    && value.length >= (rule.minItems ?? 0) && value.length <= rule.maxItems
    && value.every((entry) => argumentMatches(entry, rule.items));
  if (rule.type === "object") return matchesObject(value, rule);
  if (rule.type === "null") return value === null;
  if (rule.type === "boolean") return typeof value === "boolean";
  if (rule.type === "integer") return Number.isInteger(value) && value >= rule.minimum && value <= rule.maximum;
  if (rule.type === "number") return Number.isFinite(value) && value >= (rule.minimum ?? -Infinity) && value <= (rule.maximum ?? Infinity);
  return typeof value === "string" && !value.includes("\0") && (rule.enum ? rule.enum.includes(value)
    : value.length <= rule.maxLength && value.trim().length >= rule.minLength);
}

function matchesObject(value, schema) {
  return Boolean(value && typeof value === "object" && objects.includes(Object.getPrototypeOf(value))
    && schema.required.every((key) => Object.hasOwn(value, key))
    && Object.entries(value).every(([key, entry]) => Object.hasOwn(schema.properties, key) && argumentMatches(entry, schema.properties[key])));
}

function validateArguments(name, args) {
  const schema = workspaceToolParameters(name);
  if (!schema) error("此工具不可用。");
  if (!matchesObject(args, schema)) error("工具参数不完整或超出允许范围。");
  if (!Object.hasOwn(handlers, name)) error("此工具不可用。");
}

export function collectAssistantMediaUrls(name, args) {
  const writesImages = ["create_page", "update_page", "update_page_display"].includes(name)
    || (name === "edit_block" && args?.operation === "replace_blocks");
  if (!writesImages || !matchesObject(args, workspaceToolParameters(name))
    || (args.cover_id !== undefined && args.cover_url !== undefined)) return [];
  try {
    return collectPageImageUrls(args);
  } catch {
    return [];
  }
}

function folderPath(workspace, id) {
  return folderAncestors(workspace.folders, id).map((folder) => folder.name).join(" / ").slice(0, 360);
}

function searchWorkspace(workspace, { query = "", kind = "page", offset = 0, limit = 5 }, { time }) {
  const needle = normalizeSearchText(query).trim();
  const entries = kind === "folder" || kind === "trashed_folder"
    ? workspace.folders.filter((folder) => kind === "folder" ? availableFolder(workspace, folder.id)
      : folder.trashedAt && !folder.trashedByFolderId && !isTrashExpired(folder, time)).map((folder) => ({
      folder_id: folder.id, title: folder.name, path: folderPath(workspace, folder.parentId),
    }))
    : workspace.pages.filter((page) => kind === "trashed_page"
      ? page.trashedAt && !page.trashedByFolderId && !page.trashedByPageId && !isTrashExpired(page, time)
      : !page.trashedAt).map((page) => ({
      ...pageIdentity(page), path: folderPath(workspace, page.folderId),
    }));
  const matchRank = ({ title, path }) => {
    const normalized = normalizeSearchText(title);
    if (!needle) return 1;
    if (normalized === needle) return 3;
    if (normalized.includes(needle)) return 2;
    return Number(normalizeSearchText(path).includes(needle));
  };
  const ranked = entries.map((entry) => ({ entry, rank: matchRank(entry) })).filter(({ rank }) => rank > 0)
    .sort((left, right) => right.rank - left.rank);
  const matches = ranked.slice(offset, offset + limit).map(({ entry }) => ({ ...entry, title: entry.title.slice(0, 240) }));
  return result(workspace, { matches, next_offset: offset + limit < ranked.length ? offset + limit : null });
}

function readPage(workspace, args, { currentPageId }) {
  const page = getPage(workspace, args.page_id, currentPageId);
  const cover = normalizeCoverChoice(page.cover);
  const metadata = {
    ...pageIdentity(page), folder_id: page.folderId, settings: normalizePageSettings(page.settings),
    kind: page.pageType === "database" ? "database" : page.databaseSourceId ? "database_record" : "page",
    cover: cover ? {
      kind: cover.kind === "gallery" ? "gallery" : "custom",
      ...(cover.kind === "gallery" ? { cover_id: cover.value } : {}),
      position: cover.position ?? 50,
    } : null,
  };
  if (args.metadata_only) return result(workspace, metadata);
  const parents = new Map();
  const blocks = walkBlocks(page.content, (block, parent) => { if (parent) parents.set(block.id, parent); });
  const offset = args.offset ?? 0;
  const slice = blocks.slice(offset, offset + 24);
  let budget = 7998;
  const excerpt = [];
  for (const block of slice) {
    const entry = pageBlockExcerpt(block, parents.get(block.id), Math.min(budget, 2400));
    if (!entry) break;
    excerpt.push(entry);
    budget -= JSON.stringify(entry).length + 1;
  }
  const end = offset + excerpt.length;
  return result(workspace, { ...metadata, blocks: excerpt, next_offset: end < blocks.length ? end : null });
}

function blankDocument(idFactory) {
  return [{ id: idFactory("block"), type: "paragraph", content: "" }];
}

function appendedDocument(page, added) {
  const existing = page.content || [];
  const [first] = existing;
  const blank = existing.length === 1 && first.type === "paragraph" && !first.children?.length
    && (first.content === "" || (Array.isArray(first.content) && !first.content.length));
  return blank ? added : [...existing, ...added];
}

function createPage(workspace, args, context) {
  const { currentPageId, now, idFactory } = context;
  if (args.parent_page_id && args.folder_id) error("新页面只能指定一个上级页面或文件夹。");
  const parent = args.parent_page_id ? getPage(workspace, args.parent_page_id, currentPageId, { edit: true }) : null;
  const destination = parent ? { workspace, folder: workspace.folders.find((entry) => entry.id === parent.folderId && !entry.trashedAt) }
    : resolveCreationFolder(workspace, args.folder_id, context);
  const { folder } = destination;
  let next = destination.workspace;
  if (!folder) error("目标文件夹已不可用。");
  const page = newNotePage({
    folderId: folder.id, title: args.title.trim(), now, fontFamily: workspace.ui?.preferences?.defaultFont, idFactory,
    sortIndex: nextSortIndex(parent ? workspace.pages.filter((entry) => entry.parentPageId === parent.id) : topLevelPages(workspace.pages, folder.id)),
    content: assistantBodyDocument(args, context),
  });
  if (parent) {
    page.parentPageId = parent.id;
    const link = { id: idFactory("block"), type: "pageLink", props: { pageId: page.id, label: page.title } };
    next = editedPage(next, parent, { content: appendedDocument(parent, [link]) }, context);
  }
  return result({ ...next, pages: [...next.pages, page] }, { ...pageIdentity(page), message: "已新建页面。" });
}

function updatePage(workspace, args, context) {
  const page = getPage(workspace, args.page_id, context.currentPageId, { edit: true });
  const hasBody = args.markdown !== undefined || args.blocks !== undefined;
  if (args.title === undefined && !hasBody) error("请指定要更改的标题或正文。");
  if (args.mode && !hasBody) error("请提供正文。");
  const patch = {};
  if (typeof args.title === "string") patch.title = args.title.trim();
  const replaces = args.mode === "replace";
  if (hasBody) {
    if (replaces && (page.pageType === "database" || walkBlocks(page.content).some((block) => !replaceableBlockTypes.has(block.type)))) {
      error("此页含有受保护的引用区块。可以追加正文或编辑指定区块。");
    }
    const blocks = assistantBodyDocument(args, { ...context, page });
    if (replaces) patch.content = blocks.length ? blocks : blankDocument(context.idFactory);
    else if (blocks.length) patch.content = appendedDocument(page, blocks);
  }
  const next = editedPage(workspace, page, patch, context, replaces);
  const updated = pageById(next, page.id);
  return result(next, { ...pageIdentity(updated), changed: next !== workspace, message: next === workspace ? "页面无需更改。" : "已更新页面。" });
}

function editBlock(workspace, args, context) {
  const page = getPage(workspace, args.page_id, context.currentPageId, { edit: true });
  const found = blockContext(page.content, args.block_id)?.block;
  let replacement;
  if (args.operation === "replace_blocks") {
    if (!found || found.type === "column" || walkBlocks([found]).some((block) => !replaceableBlockTypes.has(block.type))) error("请指定可以替换的正文区块。");
    if (args.text !== undefined) error("请用 Markdown 或结构化区块替换原区块。");
    replacement = assistantBodyDocument(args, { ...context, page });
    if (!replacement.length) error("请提供用于替换的正文区块。");
    if (replacement.some((block) => block.type === "columnList")) {
      const parents = new Map();
      walkBlocks(page.content, (block, parent) => parents.set(block.id, parent));
      for (let parent = parents.get(found.id); parent; parent = parents.get(parent.id)) {
        if (parent.type === "column") error("正文栏中无法再插入分栏布局。");
      }
    }
    replacement[0] = { ...replacement[0], id: found.id };
  } else {
    if (!found || !textBlockTypes.has(found.type)) error("请指定可编辑的文本区块。");
    if (args.markdown !== undefined || args.blocks !== undefined) error("此操作只接受纯文本。");
    if (args.operation === "replace_text" && typeof args.text !== "string") error("请输入替换文字。");
    if (args.operation === "remove" && found.children?.length) error("只能移除没有子区块的文本区块。");
    replacement = args.operation === "remove" ? [] : [{ ...found, content: args.text }];
  }
  const rewrite = (blocks) => blocks.flatMap((block) => {
    if (block === found) return replacement;
    if (block.type === "column" && block.children?.length) {
      const children = rewrite(block.children);
      return [{ ...block, children: children.length ? children : blankDocument(context.idFactory) }];
    }
    return [block.children?.length ? { ...block, children: rewrite(block.children) } : block];
  });
  const content = rewrite(page.content);
  const next = editedPage(workspace, page, { content: content.length ? content : blankDocument(context.idFactory) }, context, true);
  return result(next, { ...pageIdentity(page), message: next === workspace ? "区块无需更改。" : "已更新区块。" });
}

function emojiOrNull(value) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parts = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(trimmed)];
  if (parts.length !== 1 || !/[\p{Extended_Pictographic}\p{Regional_Indicator}\u20e3]/u.test(trimmed)) error("图标须为一个 emoji。");
  return trimmed;
}

function searchCovers(workspace, { query = "", limit = 5 }) {
  const needle = normalizeSearchText(query).trim();
  const matches = coverGallery.filter((cover) => normalizeSearchText(
    [cover.id, cover.title, cover.artist, cover.category, cover.categoryLabel, ...(cover.tags || [])].join(" "),
  ).includes(needle)).slice(0, limit).map((cover) => ({
    cover_id: cover.id, title: cover.title, category: cover.categoryLabel, artist: cover.artist,
  }));
  return result(workspace, { matches });
}

function updatePageDisplay(workspace, args, context) {
  const page = getPage(workspace, args.page_id, context.currentPageId);
  if (Object.keys(args).length < 2) error("请指定要更改的页面显示设置。");
  if (page.settings?.locked && !(args.locked === false && Object.keys(args).length === 2)) error("页面已锁定，请先单独解锁。");
  const patch = {};
  if (args.icon !== undefined) Object.assign(patch, { icon: emojiOrNull(args.icon), iconColor: null });
  if (args.font !== undefined || args.small_text !== undefined || args.presentation !== undefined || args.locked !== undefined) patch.settings = normalizePageSettings({
    ...page.settings,
    ...(args.font !== undefined ? { fontFamily: args.font } : {}),
    ...(args.small_text !== undefined ? { smallText: args.small_text } : {}),
    ...(args.presentation !== undefined ? { presentationMode: args.presentation } : {}),
    ...(args.locked !== undefined ? { locked: args.locked } : {}),
  });
  if (args.cover_id !== undefined) {
    if (args.cover_url !== undefined) error("请选择内置封面或图片附件。");
    const cover = args.cover_id.trim() ? coverGalleryItem(args.cover_id.trim()) : null;
    if (args.cover_id.trim() && !cover) error("内置图集中没有找到此封面。");
    patch.cover = cover ? { kind: "gallery", value: cover.id, position: cover.defaultPosition ?? 50 } : null;
  }
  if (args.cover_url !== undefined) {
    const asset = assistantMediaAsset(args.cover_url, "image", { ...context, page });
    patch.cover = { kind: "upload", value: asset.url, position: 50 };
  }
  if (args.cover_position !== undefined) {
    const cover = Object.hasOwn(patch, "cover") ? patch.cover : page.cover;
    if (!cover) error("页面还没有可调整位置的封面。");
    patch.cover = coverWithPosition(cover, args.cover_position);
  }
  const next = editedPage(workspace, page, patch, context);
  return result(next, { ...pageIdentity(page), message: next === workspace ? "页面显示无需更改。" : "已更新页面显示。" });
}

function checkOwnedPagesUnlocked(workspace, pageId) {
  const children = ownedDescendantPageIds(workspace, [pageId]);
  if (workspace.pages.some((page) => children.has(page.id) && !page.trashedAt && page.settings?.locked)) {
    error("页面包含已锁定的子页面或数据库记录。");
  }
}

function copiedInlineReferences(value, pageIds) {
  if (Array.isArray(value)) return value.map((entry) => copiedInlineReferences(entry, pageIds));
  if (!value || typeof value !== "object") return value;
  if (value.type === "pageMention" && pageIds.has(value.props?.pageId)) {
    return { ...value, props: { ...value.props, pageId: pageIds.get(value.props.pageId) } };
  }
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, copiedInlineReferences(entry, pageIds)]));
}

function pageLink(page, idFactory) {
  return { id: idFactory("block"), type: "pageLink", props: { pageId: page.id, label: labelOf(page) } };
}

function duplicateRecord(workspace, item, title, context) {
  const source = workspace.dataSources?.find((entry) => entry.id === item.sourceId);
  if (!source || source.trashedAt) error("数据库不可用。");
  const linked = new Set((workspace.relations || []).filter((relation) => relation.sourceId === source.id && relation.reciprocalPropertyId)
    .flatMap((relation) => normalizeIdValues(item.values?.[relation.propertyId])));
  if (workspace.databaseItems.some((record) => linked.has(record.id) && pageById(workspace, record.pageId)?.settings?.locked)) {
    error("复制此记录会更改已锁定记录的关联。");
  }
  const next = duplicateDatabaseItem(workspace, { itemId: item.id, now: context.now, idFactory: context.idFactory });
  if (next === workspace) error("数据库记录不可复制。");
  const page = pageById(next, next.databaseItems.at(-1)?.pageId);
  return result(editedPage(next, page, { title }, context), { ...pageIdentity({ ...page, title }), message: "已复制数据库记录。" });
}

function copyPage(workspace, args, context) {
  const page = getPage(workspace, args.page_id, context.currentPageId, { edit: true });
  const title = args.title?.trim() || `${labelOf(page)} 副本`;
  const record = workspace.databaseItems?.find((item) => item.pageId === page.id);
  if (record) return duplicateRecord(workspace, record, title, context);
  const ownedIds = ownedDescendantPageIds(workspace, [page.id]);
  const originalPages = [page, ...workspace.pages.filter((entry) => ownedIds.has(entry.id) && !entry.trashedAt)];
  const copyIds = new Map(originalPages.map((entry) => [entry.id, context.idFactory("page")]));
  if (originalPages.some((entry) => entry.pageType === "database" || entry.databaseSourceId)
    || workspace.dataSources?.some((source) => copyIds.has(source.ownerPageId) && !source.trashedAt)) {
    error("此页包含独有数据库，请在桌面界面使用数据库的复制操作。");
  }
  const siblings = workspace.pages.filter((entry) => !entry.trashedAt && entry.folderId === page.folderId && (entry.parentPageId || null) === (page.parentPageId || null));
  const copies = originalPages.map((entry) => {
    const root = entry === page;
    const copy = duplicatePage(entry, { id: copyIds.get(entry.id), now: context.now, sortIndex: root ? nextSortIndex(siblings) : entry.sortIndex });
    const content = mapBlocks(cloneBlockDocument(entry.content, context.idFactory), (block) => {
      if (["pageLink", "subPage"].includes(block.type) && copyIds.has(block.props?.pageId)) {
        block.props = { ...block.props, pageId: copyIds.get(block.props.pageId) };
      }
      if (Object.hasOwn(block, "content")) block.content = copiedInlineReferences(block.content, copyIds);
      return block;
    });
    return { ...copy, ...(root ? { title } : { title: entry.title, parentPageId: copyIds.get(entry.parentPageId) }), content };
  });
  const [copy] = copies;
  let next = { ...workspace, pages: [...workspace.pages, ...copies] };
  if (page.parentPageId) {
    const parent = getPage(workspace, page.parentPageId, context.currentPageId, { edit: true });
    next = editedPage(next, parent, { content: appendedDocument(parent, [pageLink(copy, context.idFactory)]) }, context);
  }
  return result(next, { ...pageIdentity(copy), message: "已复制页面。" });
}

function movePage(workspace, args, context) {
  const page = getPage(workspace, args.page_id, context.currentPageId, { edit: true });
  if ((page.databaseSourceId && page.pageType !== "database") || workspace.databaseItems?.some((item) => item.pageId === page.id)) {
    error("数据库记录须留在其数据库中。");
  }
  if (Boolean(args.folder_id) === Boolean(args.parent_page_id)) error("请指定一个目标文件夹或上级页面。");
  const parent = args.parent_page_id ? getPage(workspace, args.parent_page_id, context.currentPageId, { edit: true }) : null;
  const movedPageIds = new Set([page.id, ...ownedDescendantPageIds(workspace, [page.id])]);
  if (movedPageIds.has(parent?.id)) error("不能将页面移动到自身或子页面下面。");
  const folder = availableFolder(workspace, parent ? parent.folderId : args.folder_id);
  if (!folder) error("目标文件夹已不可用。");
  if (page.folderId === folder.id && (page.parentPageId || null) === (parent?.id ?? null)) {
    return result(workspace, { ...pageIdentity(page), message: "页面已在指定位置。" });
  }
  checkOwnedPagesUnlocked(workspace, page.id);
  const siblings = parent ? workspace.pages.filter((entry) => entry.parentPageId === parent.id && !entry.trashedAt) : topLevelPages(workspace.pages, folder.id);
  const moved = moveOwnedPage(workspace, page.id, {
    folderId: folder.id, now: context.now, sortIndex: nextSortIndex(siblings),
  });
  const destination = new Set(folderAncestors(workspace.folders, folder.id).map((entry) => entry.id));
  let next = {
    ...moved,
    pages: moved.pages.map((entry) => entry.id === page.id ? { ...entry, parentPageId: parent?.id ?? null, inboxedAt: null } : entry),
    folders: moved.folders.map((entry) => entry.id === folder.id ? { ...entry, lastOpenedPageId: page.id }
      : movedPageIds.has(entry.lastOpenedPageId) && !destination.has(entry.id) ? { ...entry, lastOpenedPageId: null } : entry),
  };
  if (parent && !walkBlocks(parent.content).some((block) => ["pageLink", "subPage"].includes(block.type) && block.props?.pageId === page.id)) {
    next = editedPage(next, parent, { content: appendedDocument(parent, [pageLink(page, context.idFactory)]) }, context);
  }
  return result(next, { ...pageIdentity(page), folder_id: folder.id, ...(parent ? { parent_page_id: parent.id } : {}), message: "已移动页面。" });
}

function recyclePage(workspace, args, { currentPageId, now }) {
  const page = getPage(workspace, args.page_id, currentPageId, { edit: true });
  checkOwnedPagesUnlocked(workspace, page.id);
  const next = trashPage(workspace, page.id, now);
  return result(next, { ...pageIdentity(page), message: "已将页面移到回收站。" });
}

function restorePage(workspace, args, { currentPageId, now, idFactory }) {
  const page = getPage(workspace, args.page_id, currentPageId, { trashed: true });
  if (page.trashedByFolderId || page.trashedByPageId || isTrashExpired(page, now)) error("此页不能单独恢复。");
  const restored = restoreTrashGroup(workspace, { kind: "page", id: page.id }, { now, idFactory });
  if (!restored.restored) error("未找到可恢复的页面。");
  return result(restored.workspace, { ...pageIdentity(page), folder_id: restored.restored.folderId, message: "已恢复页面。" });
}

function createFolder(workspace, args, { idFactory, now }) {
  const parent = args.parent_folder_id ? availableFolder(workspace, args.parent_folder_id) : null;
  if (args.parent_folder_id && !parent) error("上级文件夹不可用。");
  const parentId = parent?.id ?? null;
  const folder = {
    id: idFactory("folder"), parentId, name: args.name.trim(), color: "purple",
    sortIndex: nextSortIndex(childFolders(workspace.folders, parentId)), lastOpenedPageId: null,
    trashedAt: null, trashedByFolderId: null, createdAt: now, updatedAt: now,
  };
  return result({ ...workspace, folders: [...workspace.folders, folder] }, { folder_id: folder.id, title: folder.name, message: "已新建文件夹。" });
}

function updateFolder(workspace, args, { now }) {
  const folder = availableFolder(workspace, args.folder_id);
  if (!folder) error("文件夹不可用。");
  if (!args.name && args.parent_folder_id === undefined) error("请指定文件夹名称或新位置。");
  const parentId = args.parent_folder_id || null;
  if (parentId && !availableFolder(workspace, parentId)) error("目标文件夹已不可用。");
  if (parentId && folderAncestors(workspace.folders, parentId).some((entry) => entry.id === folder.id)) error("不能将文件夹移入自身或子文件夹。");
  let next = workspace;
  if (args.parent_folder_id !== undefined && parentId !== folder.parentId) next = moveFolder(next, folder.id, parentId, now);
  if (args.name && args.name.trim() !== folder.name) next = renameFolder(next, folder.id, args.name.trim(), now);
  return result(next, { folder_id: folder.id, title: args.name?.trim() || folder.name, message: next === workspace ? "文件夹无需更改。" : "已更新文件夹。" });
}

function recycleFolder(workspace, args, { now }) {
  const folder = availableFolder(workspace, args.folder_id);
  if (!folder) error("文件夹不可用。");
  const next = trashFolder(workspace, folder.id, now);
  if (next.pages.some((page) => page.trashedByFolderId === folder.id && page.settings?.locked)) error("文件夹下包含已锁定的页面。");
  return result(next, { folder_id: folder.id, message: "已将文件夹移到回收站。" });
}

function restoreFolder(workspace, args, { now, idFactory }) {
  const folder = workspace.folders.find((entry) => entry.id === args.folder_id && entry.trashedAt && !entry.trashedByFolderId && !entry.system);
  if (!folder || isTrashExpired(folder, now)) error("未找到可恢复的文件夹。");
  const restored = restoreTrashGroup(workspace, { kind: "folder", id: folder.id }, { now, idFactory });
  if (!restored.restored) error("未找到可恢复的文件夹。");
  return result(restored.workspace, { folder_id: folder.id, message: "已恢复文件夹。" });
}

function readWorkspaceSettings(workspace) {
  const { preferences = {}, workspaceName, workspaceIcon, sidebarCollapsed, sidebarWidth } = workspace.ui || {};
  return result(workspace, {
    theme: preferences.theme || "system", default_font: preferences.defaultFont || "default", start_page: preferences.startPage || "last",
    workspace_name: workspaceName || "medax的工作空间", workspace_icon: workspaceIcon || null, sidebar_collapsed: Boolean(sidebarCollapsed),
    sidebar_width: sidebarWidth ?? 248,
  });
}

function updateWorkspaceSettings(workspace, args) {
  if (!Object.keys(args).length) error("请指定要更改的工作区设置。");
  const ui = { ...workspace.ui };
  if (args.theme !== undefined || args.default_font !== undefined || args.start_page !== undefined) {
    ui.preferences = {
      ...ui.preferences,
      ...(args.theme !== undefined ? { theme: args.theme } : {}),
      ...(args.default_font !== undefined ? { defaultFont: args.default_font } : {}),
      ...(args.start_page !== undefined ? { startPage: args.start_page } : {}),
    };
  }
  if (args.workspace_name !== undefined) {
    const name = args.workspace_name.trim();
    if (Array.from(name).length > 60) error("工作区名称最多 60 个字符。");
    ui.workspaceName = name;
  }
  if (args.workspace_icon !== undefined) ui.workspaceIcon = emojiOrNull(args.workspace_icon);
  if (args.sidebar_collapsed !== undefined) ui.sidebarCollapsed = args.sidebar_collapsed;
  if (args.sidebar_width !== undefined) ui.sidebarWidth = args.sidebar_width;
  return result({ ...workspace, ui }, { message: "已更新工作区设置。" });
}

const handlers = {
  search_workspace: searchWorkspace,
  read_page: readPage,
  create_page: createPage,
  update_page: updatePage,
  edit_block: editBlock,
  search_covers: searchCovers,
  update_page_display: updatePageDisplay,
  duplicate_page: copyPage,
  move_page: movePage,
  trash_page: recyclePage,
  restore_page: restorePage,
  create_folder: createFolder,
  update_folder: updateFolder,
  trash_folder: recycleFolder,
  restore_folder: restoreFolder,
  read_workspace_settings: readWorkspaceSettings,
  update_workspace_settings: updateWorkspaceSettings,
  ...databaseAssistantTools,
};

export const assistantReadTools = new Set(["search_workspace", "read_page", "search_covers", "read_workspace_settings", ...databaseAssistantReadTools]);

export function executeWorkspaceTool(name, args, { workspace, currentPageId, currentFolderId, mediaByUrl, attachments, time = Date.now(), idFactory = newEntityId }) {
  try {
    validateArguments(name, args);
    return handlers[name](workspace, args, { currentPageId, currentFolderId, mediaByUrl, attachments, time, idFactory, now: new Date(time).toISOString() });
  } catch (failure) {
    return { workspace, result: { ok: false, error: failure instanceof WorkspaceToolError ? failure.message : "工作区操作失败。" } };
  }
}
