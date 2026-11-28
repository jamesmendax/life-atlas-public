import { pageToMarkdown } from "../domain/pageExport.js";
import { expandSyncedBlocks, walkBlocks } from "../domain/blockDocument.js";
import { attachmentIdFromUrl } from "../domain/attachments.js";
import { attachmentReferences } from "../domain/trash.js";
import { itemDisplayTitle, projectViewItems, resolvePropertyValue } from "../domain/database.js";
import { formatPropertyValue } from "../domain/databaseProperties.js";

const RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?=\.|$)/i;

export function safeFileName(title) {
  let name = Array.from(String(title ?? "").replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, "_").trim()).slice(0, 80).join("").replace(/[. ]+$/, "");
  if (!name) return "无标题";
  name = name.replace(RESERVED_NAME, "$1_");
  return Array.from(name).slice(0, 80).join("").replace(/[. ]+$/, "") || "无标题";
}

export function dedupeName(title, extension, used) {
  const base = safeFileName(title);
  let number = 1;
  let name = `${base}${extension}`;
  while (used.has(name.toLowerCase())) {
    number += 1;
    const suffix = ` (${number})`;
    name = `${Array.from(base).slice(0, 80 - suffix.length).join("")}${suffix}${extension}`;
  }
  used.add(name.toLowerCase());
  return name;
}

export function relativeExportPath(currentFile, target) {
  const from = currentFile.split("/");
  from.pop();
  const to = target.split("/");
  let common = 0;
  while (common < from.length && common < to.length && from[common] === to[common]) common += 1;
  return [...Array.from({ length: from.length - common }, () => ".."), ...to.slice(common)].join("/") || to.at(-1);
}

const joinPath = (directory, name) => directory ? `${directory}/${name}` : name;
const yamlString = (value) => JSON.stringify(String(value ?? ""));
const csvValue = (value) => /[",\r\n]/.test(String(value)) ? `"${String(value).replaceAll('"', '""')}"` : String(value);
const sorted = (entries) => [...entries].sort((left, right) => (Number(left.sortIndex) || 0) - (Number(right.sortIndex) || 0) || String(left.title || left.name || left.id).localeCompare(String(right.title || right.name || right.id)));

function exportableWorkspace(workspace) {
  const folderMap = new Map((workspace.folders || []).map((folder) => [folder.id, folder]));
  const pageMap = new Map((workspace.pages || []).map((page) => [page.id, page]));
  const validFolder = (id, seen = new Set()) => {
    const folder = folderMap.get(id);
    if (!folder || folder.trashedAt || seen.has(id)) return false;
    if (!folder.parentId) return true;
    seen.add(id);
    return validFolder(folder.parentId, seen);
  };
  const validPage = (page, seen = new Set()) => {
    if (!page || page.trashedAt || !validFolder(page.folderId) || seen.has(page.id)) return false;
    if (!page.parentPageId) return true;
    seen.add(page.id);
    return validPage(pageMap.get(page.parentPageId), seen);
  };
  const folders = (workspace.folders || []).filter((folder) => validFolder(folder.id));
  const pages = (workspace.pages || []).filter((page) => validPage(page));
  const pageIds = new Set(pages.map((page) => page.id));
  const dataSources = (workspace.dataSources || []).filter((source) => pageIds.has(source.ownerPageId));
  const sourceIds = new Set(dataSources.map((source) => source.id));
  const databaseItems = (workspace.databaseItems || []).filter((item) => pageIds.has(item.pageId) && sourceIds.has(item.sourceId));
  return { ...workspace, folders, pages, dataSources, databaseItems, databaseViews: (workspace.databaseViews || []).filter((view) => sourceIds.has(view.sourceId)), pageVersions: [], comments: [], discussions: [], pageTemplates: [], databaseTemplates: [] };
}

function frontMatter(page, workspace, item, source) {
  const lines = ["---", `id: ${yamlString(page.id)}`, `created: ${yamlString(page.createdAt)}`, `updated: ${yamlString(page.updatedAt)}`];
  if (typeof page.icon === "string" && page.icon && !/^(?:data:|blob:|https?:|life-asset:)/i.test(page.icon)) lines.push(`icon: ${yamlString(page.icon)}`);
  if (page.tags?.length) lines.push(`tags: [${page.tags.map(yamlString).join(", ")}]`);
  if (item && source) {
    lines.push("properties:");
    for (const property of source.properties || []) lines.push(`  ${yamlString(property.name)}: ${yamlString(formatPropertyValue(workspace, property, resolvePropertyValue(workspace, source, item, property)))}`);
  }
  lines.push("---", "");
  return lines.join("\n");
}

export function buildMarkdownExport(workspace, { now, appVersion = "0.1.0" } = {}) {
  const instant = new Date(now).toISOString();
  const scope = exportableWorkspace(workspace);
  const pageMap = new Map(scope.pages.map((page) => [page.id, page]));
  const recordMap = new Map(scope.databaseItems.map((item) => [item.pageId, item]));
  const sourceMap = new Map(scope.dataSources.map((source) => [source.id, source]));
  const ownedSources = new Map();
  const pageChildren = new Map();
  const folderChildren = new Map();
  const folderPages = new Map();
  const addGrouped = (map, key, value) => { if (!map.has(key)) map.set(key, []); map.get(key).push(value); };
  for (const source of scope.dataSources) addGrouped(ownedSources, source.ownerPageId, source);
  for (const page of scope.pages) {
    if (recordMap.has(page.id)) continue;
    if (page.parentPageId) addGrouped(pageChildren, page.parentPageId, page);
    else addGrouped(folderPages, page.folderId, page);
  }
  for (const folder of scope.folders) addGrouped(folderChildren, folder.parentId || null, folder);
  const usedNames = new Map([["", new Set(["readme.md", "_assets"])]]);
  const usedIn = (directory) => { if (!usedNames.has(directory)) usedNames.set(directory, new Set()); return usedNames.get(directory); };
  const pagePaths = new Map();
  const databasePaths = new Map();
  const plannedPages = [];
  const plannedDatabases = [];
  const orderedItems = new Map();
  const itemsFor = (source) => {
    if (orderedItems.has(source.id)) return orderedItems.get(source.id);
    const view = scope.databaseViews.find((entry) => entry.sourceId === source.id && entry.type === "table");
    const items = view?.sorts?.length ? projectViewItems(scope, { ...view, filter: null }) : scope.databaseItems.filter((item) => item.sourceId === source.id).sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)) || String(left.id).localeCompare(String(right.id)));
    orderedItems.set(source.id, items);
    return items;
  };
  const addDatabase = (source, directory, companion = null, title = source.title) => {
    if (databasePaths.has(source.id)) return;
    const csvPath = joinPath(directory, dedupeName(title, ".csv", usedIn(directory)));
    databasePaths.set(source.id, csvPath);
    plannedDatabases.push({ source, path: csvPath });
    const recordsDirectory = companion || joinPath(directory, dedupeName(title, "", usedIn(directory)));
    for (const item of itemsFor(source)) {
      const page = pageMap.get(item.pageId);
      if (page) addPage(page, recordsDirectory, item, source);
    }
  };
  const addPage = (page, directory, item = null, source = null) => {
    if (pagePaths.has(page.id)) return;
    const title = item && source ? itemDisplayTitle(scope, source, item) : page.title || "无标题页面";
    const name = dedupeName(title, ".md", usedIn(directory));
    const filePath = joinPath(directory, name);
    pagePaths.set(page.id, filePath);
    plannedPages.push({ page, title, item, source, path: filePath });
    const children = sorted(pageChildren.get(page.id) || []);
    const owned = ownedSources.get(page.id) || [];
    if (!children.length && !owned.length) return;
    const companion = joinPath(directory, dedupeName(name.slice(0, -3), "", usedIn(directory)));
    for (const child of children) addPage(child, companion);
    for (const database of owned) {
      const fullPage = page.pageType === "database" && page.databaseSourceId === database.id;
      addDatabase(database, fullPage ? directory : companion, fullPage ? companion : null, fullPage ? name.slice(0, -3) : database.title);
    }
  };
  const hasContent = (folder, seen = new Set()) => {
    if (seen.has(folder.id)) return false;
    if (folderPages.get(folder.id)?.length) return true;
    seen.add(folder.id);
    return (folderChildren.get(folder.id) || []).some((child) => hasContent(child, seen));
  };
  const addFolder = (folder, parent) => {
    if (!hasContent(folder)) return;
    const directory = joinPath(parent, dedupeName(folder.name, "", usedIn(parent)));
    for (const page of sorted(folderPages.get(folder.id) || [])) addPage(page, directory);
    for (const child of sorted(folderChildren.get(folder.id) || [])) addFolder(child, directory);
  };
  for (const folder of sorted(folderChildren.get(null) || [])) addFolder(folder, "");
  const expandedPages = plannedPages.map(({ page }) => ({ ...page, content: expandSyncedBlocks(page.content || [], scope) }));
  const references = attachmentReferences({ ...scope, pages: expandedPages, syncedSources: [] });
  for (const page of expandedPages) walkBlocks(page.content, (block) => { const id = attachmentIdFromUrl(block.props?.imageUrl); if (id) references.add(id); });
  const assets = [];
  const assetById = new Map();
  const assetByHash = new Map();
  const assetByUrl = new Map();
  for (const attachment of scope.attachments || []) {
    if (!references.has(attachment.id) || attachment.provider === "external" || attachment.externalUrl) continue;
    const sha256 = /^[a-f0-9]{64}$/.test(attachment.checksum || "") ? attachment.checksum : attachment.provider === "asset" && /^[a-f0-9]{64}$/.test(attachment.storageKey || "") ? attachment.storageKey : undefined;
    const prefix = String(sha256 || attachment.id).slice(0, 12);
    const base = `${safeFileName(prefix)}-${safeFileName(attachment.name || "附件")}`;
    const used = usedIn("_assets");
    let assetName = base;
    let number = 1;
    while (used.has(assetName.toLowerCase())) {
      const suffix = ` (${++number})`;
      assetName = `${Array.from(base).slice(0, 100 - suffix.length).join("")}${suffix}`;
    }
    used.add(assetName.toLowerCase());
    const filePath = joinPath("_assets", assetName);
    const url = attachment.provider === "asset" && sha256 ? `life-asset://${sha256}` : attachment.id;
    const asset = { path: filePath, ...(sha256 ? { sha256 } : {}), url };
    assets.push(asset);
    assetById.set(attachment.id, asset);
    if (sha256) assetByHash.set(sha256, asset);
    if (attachment.storageKey) assetByUrl.set(attachment.storageKey, asset);
  }
  const assetFor = (url) => assetById.get(attachmentIdFromUrl(url) || url) || assetByHash.get(/^life-asset:\/\/([a-f0-9]{64})/i.exec(String(url))?.[1]) || assetByUrl.get(url);
  const files = plannedPages.map(({ page, title, item, source, path: filePath }) => {
    const links = {
      pagePath: (id) => pagePaths.has(id) ? relativeExportPath(filePath, pagePaths.get(id)) : null,
      databasePath: (id) => databasePaths.has(id) ? relativeExportPath(filePath, databasePaths.get(id)) : null,
      assetPath: (url) => { const asset = assetFor(url); return asset ? relativeExportPath(filePath, asset.path) : null; },
    };
    return { path: filePath, text: `${frontMatter(page, scope, item, source)}${pageToMarkdown({ ...page, title }, { includeTitle: true, workspace: scope, links })}` };
  });
  for (const { source, path: filePath } of plannedDatabases) {
    const properties = [...source.properties.filter((property) => property.type === "title"), ...source.properties.filter((property) => property.type !== "title")];
    const rows = [properties.map((property) => property.name), ...itemsFor(source).map((item) => properties.map((property) => formatPropertyValue(scope, property, resolvePropertyValue(scope, source, item, property))))];
    files.push({ path: filePath, text: `\uFEFF${rows.map((row) => row.map(csvValue).join(",")).join("\r\n")}\r\n` });
  }
  const counts = { pages: plannedPages.filter(({ item, page }) => !item && page.pageType !== "database").length, databases: plannedDatabases.length, records: plannedPages.filter(({ item }) => item).length, attachments: assets.length, fileCount: files.length + 1 + assets.length };
  files.unshift({ path: "README.md", text: ["# Life Atlas Markdown 导出", "", `导出时间：${instant}`, `Life Atlas 版本：${appVersion}`, "", `页面：${counts.pages} · 数据库：${counts.databases} · 记录：${counts.records} · 附件：${counts.attachments}`, "", "## 目录结构", "", "文件夹对应目录；页面为 Markdown；子页面和行内数据库在同名目录中。", "数据库属性和记录导出为 CSV，记录正文在数据库同名目录内；附件保存在 _assets/。", "正文里的合并单元格按原行列展开，覆盖位置留空；Markdown 不保留跨度。", "", "评论、页面历史、密钥库不在这里；完整数据请用 .lifeatlas 备份。", ""].join("\n") });
  return { files, assets, counts };
}
