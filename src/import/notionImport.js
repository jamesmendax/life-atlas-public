import JSZip from "jszip";
import { newEntityId } from "../domain/blockDocument.js";
import { newNotePage } from "../domain/newPage.js";
import { markdownToBlocks } from "../domain/markdownBlocks.js";
import { createDataSource, createDatabaseItem, createDatabaseView, createProperty, createRelation, makeDatabaseItemPage } from "../domain/database.js";
import { inferColumnType, parseCsv, parseCsvNumber, TRUE_WORDS } from "../domain/csv.js";
import { createAttachmentMetadata } from "../domain/attachments.js";
import { derivePageSummary } from "../domain/content.js";
import { parseNotionName, parseNotionDate, looksMultiSelect, splitNotionMulti } from "./notionNames.js";
import { parseNotionHtmlPage, notionHtmlToBlocks } from "./notionHtml.js";
import { prepareNotionSourceViewConfigurations, notionSourceViewConfigurationFor, mapNotionSourceViewConfiguration } from "./notionSourceViewConfig.js";

export const MAX_NOTION_ZIP_BYTES = 1024 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 2 * MAX_NOTION_ZIP_BYTES;
const MAX_ENTRIES = 50000;
const REMOTE_LINK = /^(?:https?|mailto):/i;
const basename = (filePath) => filePath.split("/").at(-1);
const dirname = (filePath) => filePath.includes("/") ? filePath.slice(0, filePath.lastIndexOf("/")) : "";
const withoutExtension = (filePath) => filePath.replace(/\.[^/.]+$/, "");
const utf8 = new TextDecoder("utf-8", { fatal: true });
const CRC_TABLE = Uint32Array.from({ length: 256 }, (unusedValue, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ value >>> 1 : value >>> 1;
  return value >>> 0;
});

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 0xff] ^ value >>> 8;
  return (value ^ 0xffffffff) >>> 0;
}

function safeEntryPath(filePath) {
  return typeof filePath === "string" && Boolean(filePath) && !/[\\\u0000-\u001f\u007f]/.test(filePath) && !filePath.startsWith("/") && !/^[A-Za-z]:/.test(filePath)
    && filePath.split("/").every((part) => part && part !== "." && part !== "..");
}

export function resolveNotionPath(currentFile, href) {
  if (typeof href !== "string" || REMOTE_LINK.test(href) || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(href)) return null;
  let decoded;
  try { decoded = decodeURIComponent(href.split("#")[0].split("?")[0]); } catch { return null; }
  if (!decoded || decoded.startsWith("/") || /[\\\u0000-\u001f]/.test(decoded)) return null;
  const parts = dirname(currentFile).split("/").filter(Boolean);
  for (const part of decoded.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") { if (!parts.length) return null; parts.pop(); }
    else parts.push(part);
  }
  const result = parts.join("/");
  return safeEntryPath(result) ? result : null;
}

function bytesView(bytes) {
  if (bytes instanceof Uint8Array) return bytes;
  if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes);
  if (ArrayBuffer.isView(bytes)) return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  throw new Error("压缩包必须是二进制文件");
}

export async function readNotionExport(zipBytes) {
  const bytes = bytesView(zipBytes);
  if (bytes.byteLength > MAX_NOTION_ZIP_BYTES) throw new Error("文件太大，请在 Notion 里分批导出");
  const entries = new Map();
  const problems = [];
  let expandedBytes = 0;
  let entryCount = 0;
  const readZip = async (input, depth) => {
    const zip = await JSZip.loadAsync(input, { checkCRC32: false, createFolders: false });
    for (const file of Object.values(zip.files)) {
      const originalPath = file.unsafeOriginalName || file.name;
      const filePath = file.dir ? originalPath.replace(/\/$/, "") : originalPath;
      if (!safeEntryPath(filePath)) throw new Error(`压缩包含不安全的路径：${originalPath}`);
      if (file.dir) continue;
      entryCount += 1;
      if (entryCount > MAX_ENTRIES) throw new Error("压缩包里的文件过多，请在 Notion 里分批导出");
      const declaredSize = file._data?.uncompressedSize;
      if (Number.isFinite(declaredSize) && expandedBytes + declaredSize > MAX_EXPANDED_BYTES) throw new Error("压缩包展开后过大，请在 Notion 里分批导出");
      if (Number.isFinite(declaredSize) && declaredSize > MAX_NOTION_ZIP_BYTES && !/\.zip$/i.test(filePath)) {
        problems.push({ path: filePath, reason: "单个附件超过 1 GB，已跳过" });
        continue;
      }
      const content = await file.async("uint8array");
      expandedBytes += content.byteLength;
      if (expandedBytes > MAX_EXPANDED_BYTES) throw new Error("压缩包展开后过大，请在 Notion 里分批导出");
      if (Number.isFinite(file._data?.crc32) && crc32(content) !== file._data.crc32 >>> 0) throw new Error(`压缩包文件已损坏（CRC32 校验失败）：${filePath}`);
      if (/\.zip$/i.test(filePath) && depth === 0) { await readZip(content, 1); continue; }
      if (entries.has(filePath)) {
        const previous = entries.get(filePath);
        if (previous.length !== content.length || previous.some((value, index) => value !== content[index])) throw new Error(`分卷里的同名文件内容不同：${filePath}`);
      } else entries.set(filePath, content);
    }
  };
  await readZip(bytes, 0);
  const paths = [...entries.keys()];
  const common = paths[0]?.split("/")[0];
  if (common && paths.every((filePath) => filePath.includes("/") && filePath.startsWith(`${common}/`))) {
    return { entries: new Map([...entries].map(([filePath, content]) => [filePath.slice(common.length + 1), content])), problems: problems.map((problem) => ({ ...problem, path: problem.path.startsWith(`${common}/`) ? problem.path.slice(common.length + 1) : problem.path })) };
  }
  return { entries, problems };
}

function markdownPage(filePath, bytes) {
  const text = utf8.decode(bytes).replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const lines = text.split("\n");
  const heading = /^#\s+(.+)$/.exec(lines[0]);
  const parsedName = parseNotionName(basename(filePath));
  return { path: filePath, title: heading ? heading[1].trim() : parsedName.title, notionId: parsedName.notionId, body: (heading ? lines.slice(1) : lines).join("\n"), hasTitle: Boolean(heading) };
}

function relationParts(value) {
  const text = String(value ?? "").trim();
  if (!text) return [];
  const parts = text.split(/,\s*(?=[^,]+\s+\()/);
  const result = parts.map((part) => /^(.+?)\s+\(([^)]+\.md(?:#[^)]*)?)\)$/.exec(part.trim()));
  return result.every(Boolean) ? result.map((match) => ({ title: match[1], href: match[2] })) : null;
}

function stripRecordProperties(page, header) {
  const lines = page.body.split("\n");
  let index = page.hasTitle && !lines[0]?.trim() ? 1 : 0;
  while (index < lines.length) {
    const property = /^([^:]+):\s*(.*)$/.exec(lines[index]);
    if (!property || !header.includes(property[1])) break;
    index += 1;
  }
  return lines.slice(index).join("\n");
}

export function planNotionImport(entries) {
  if (!(entries instanceof Map)) throw new Error("导出文件清单无效");
  const unrecognized = [];
  const errors = [];
  const markdown = [];
  const html = [];
  const databasesByPath = new Map();
  for (const [filePath, bytes] of entries) {
    if (!safeEntryPath(filePath)) { errors.push(`压缩包含不安全的路径：${filePath}`); continue; }
    try {
      const name = parseNotionName(basename(filePath));
      if (name.extension === ".md") markdown.push(markdownPage(filePath, bytes));
      if ([".html", ".htm"].includes(name.extension) && typeof document !== "undefined") {
        const page = parseNotionHtmlPage(filePath, bytes);
        if (page.hasTitle) html.push(page);
      }
      if (name.extension === ".csv") {
        const canonical = filePath.replace(/_all(?=\.csv$)/i, "");
        const previous = databasesByPath.get(canonical);
        if (previous?.all && !name.all) continue;
        const csv = parseCsv(utf8.decode(bytes));
        if (!csv.length || !csv[0].length) throw new Error("CSV 没有列");
        databasesByPath.set(canonical, { path: filePath, canonicalPath: canonical, aliases: [canonical, canonical.replace(/\.csv$/i, "_all.csv")], title: name.title, notionId: name.notionId, all: name.all, header: csv[0], rows: csv.slice(1), records: [] });
      }
    } catch (issue) { unrecognized.push({ path: filePath, reason: issue.message || "无法解析" }); }
  }
  const databases = [...databasesByPath.values()];
  const recordPaths = new Set();
  const companionPaths = new Set();
  for (const database of databases) {
    const companions = html.filter((page) => (database.notionId && page.notionId === database.notionId) || withoutExtension(page.path) === withoutExtension(database.canonicalPath));
    if (companions.length === 1) { database.page = companions[0]; companionPaths.add(database.page.path); }
    const recordDirectories = new Set([withoutExtension(database.canonicalPath), [dirname(database.path), database.title].filter(Boolean).join("/")]);
    const candidates = markdown.filter((page) => recordDirectories.has(dirname(page.path)));
    const byTitle = new Map();
    for (const page of candidates) {
      if (!byTitle.has(page.title)) byTitle.set(page.title, []);
      byTitle.get(page.title).push(page);
      recordPaths.add(page.path);
    }
    database.records = database.rows.map((row) => {
      const title = String(row[0] || "无标题");
      const page = byTitle.get(title)?.shift() || null;
      return { title, values: row, page: page ? { ...page, body: stripRecordProperties(page, database.header) } : null };
    });
    // Flat HTML exports carry record identity in the companion collection's rows.
    // Match CSV rows within that collection, never by a global page title.
    if (database.page) {
      const collections = database.page.collections || [];
      const collection = collections.find((entry) => entry.id === database.notionId) || (collections.length === 1 ? collections[0] : collections.find((entry) => entry.title === database.title));
      database.collection = collection || null;
      const available = [...(collection?.rows || [])];
      for (const record of database.records) {
        if (record.page) continue;
        const index = available.findIndex((row) => (row.title || "无标题") === record.title || (!row.title && record.title === "Untitled"));
        if (index < 0) continue;
        const [row] = available.splice(index, 1);
        const path = row.href && resolveNotionPath(database.page.path, row.href);
        const candidates = html.filter((page) => !recordPaths.has(page.path) && !companionPaths.has(page.path) && ((row.notionId && page.notionId === row.notionId) || (path && page.path === path)));
        if (candidates.length === 1) { record.page = candidates[0]; recordPaths.add(record.page.path); }
      }
    }
    for (const pages of byTitle.values()) for (const page of pages) unrecognized.push({ path: page.path, reason: "记录页面没有对应的 CSV 行" });
  }
  const pages = [...markdown, ...html].filter((page) => !recordPaths.has(page.path) && !companionPaths.has(page.path));
  const allPagePaths = new Set([...markdown, ...html].map((page) => page.path));
  const parentFor = (filePath) => {
    let directory = dirname(filePath);
    while (directory) {
      if (allPagePaths.has(`${directory}.md`)) return `${directory}.md`;
      if (allPagePaths.has(`${directory}.html`)) return `${directory}.html`;
      directory = dirname(directory);
    }
    return null;
  };
  for (const page of pages) page.parentPath = parentFor(page.path);
  for (const database of databases) database.parentPath = parentFor(database.path);
  // Only exported child-page blocks establish flat-file ownership; ordinary links do not.
  const ownable = new Map([...pages.map((page) => [page.path, page]), ...databases.filter((db) => db.page).map((db) => [db.page.path, db])]);
  for (const owner of html) for (const href of owner.ownedPageHrefs || []) {
    const targetPath = resolveNotionPath(owner.path, href);
    const target = ownable.get(targetPath);
    if (!ownable.has(owner.path) || !target || target.parentPath || targetPath === owner.path) continue;
    let ancestor = owner.path;
    while (ancestor && ancestor !== targetPath) ancestor = ownable.get(ancestor)?.parentPath;
    if (ancestor !== targetPath) target.parentPath = owner.path;
  }
  const referencedAssets = new Set();
  for (const page of markdown) {
    for (const match of page.body.matchAll(/!?\[[^\]\n]*\]\(([^)\n]+)\)/g)) {
      const target = resolveNotionPath(page.path, match[1]);
      if (target && !/\.(?:md|csv)$/i.test(target) && entries.has(target)) referencedAssets.add(target);
    }
  }
  for (const page of html) for (const href of page.assetHrefs || []) {
    const target = resolveNotionPath(page.path, href);
    if (target && entries.has(target)) referencedAssets.add(target);
    else unrecognized.push({ path: page.path, reason: `图片未能本地化：${href}` });
  }
  const assets = [...referencedAssets].map((filePath) => ({ path: filePath, name: basename(filePath), bytes: entries.get(filePath), size: entries.get(filePath).byteLength, mime: mimeForPath(filePath) }));
  const failedPaths = new Set(unrecognized.map((entry) => entry.path));
  const recognizedHtml = new Set(html.map((page) => page.path));
  for (const filePath of entries.keys()) if (!/\.(?:md|csv)$/i.test(filePath) && !recognizedHtml.has(filePath) && !referencedAssets.has(filePath) && !failedPaths.has(filePath)) unrecognized.push({ path: filePath, reason: "未被页面引用的文件" });
  if (!markdown.length && !html.length && !databases.length && [...entries.keys()].some((filePath) => /\.html?$/i.test(filePath))) errors.push("这是 HTML 格式的导出包。请在 Notion 的导出对话框里把导出格式选为“Markdown 和 CSV”后重新导出。");
  else if (!pages.length && !databases.length) errors.push("没有找到可导入的 Markdown 和 CSV 文件。");
  return { pages, databases, assets, unrecognized, errors, counts: { pages: pages.length, databases: databases.length, records: databases.reduce((sum, database) => sum + database.rows.length, 0), attachments: assets.length, attachmentBytes: assets.reduce((sum, asset) => sum + asset.size, 0) } };
}

function mimeForPath(filePath) {
  const extension = parseNotionName(basename(filePath)).extension;
  return ({ ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml", ".pdf": "application/pdf", ".mp4": "video/mp4", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".txt": "text/plain" })[extension] || "application/octet-stream";
}

function uniqueFolderName(workspace, requested) {
  const used = new Set((workspace.folders || []).filter((folder) => !folder.parentId).map((folder) => folder.name));
  let name = requested;
  let number = 1;
  while (used.has(name)) name = `${requested} (${++number})`;
  return name;
}

function localDate(now) {
  const date = new Date(now);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

const HTML_RECORD_TYPES = { text: "text", rich_text: "text", number: "number", select: "select", multi_select: "multi_select", status: "status", date: "date", checkbox: "checkbox", url: "url", email: "email", phone: "phone", phone_number: "phone", last_edited_time: "modified_time", created_time: "created_time", formula: "formula" };
const HTML_HEADER_TYPES = { font: "title", description: "text", hashtag: "number", list: "multi_select", calendar: "date", clock: "modified_time", "checkmark-square": "checkbox", "arrow-circle-down": "select", formula: "formula" };
const NOTION_OPTION_COLORS = new Set(["gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"]);

function htmlColumnType(database, name, column) {
  if (!database.page || column === 0) return null;
  if (database.header.filter((entry) => entry === name).length !== 1) return null;
  const types = new Set(database.records.flatMap((record) => (record.page?.recordProperties || []).filter((property) => property.name === name && property.type).map((property) => HTML_RECORD_TYPES[property.type] || "unknown")));
  if (types.has("formula")) return "formula";
  if (types.size === 1) return [...types][0] === "unknown" ? "text" : [...types][0];
  if (types.size > 1) return "text";
  const collection = database.collection;
  if (collection?.propertyNames?.[column] !== name) return null;
  const icon = collection?.propertyIcons?.[column]?.split("/").at(-1)?.split("?")[0];
  const base = icon?.replace(/_(?:lightgray|gray)\.svg$/i, "");
  return HTML_HEADER_TYPES[base] || null;
}

function htmlOptionColors(database, name) {
  const colors = new Map();
  for (const record of database.records) for (const property of record.page?.recordProperties || []) {
    if (property.name !== name) continue;
    for (const option of property.options || []) {
      if (!NOTION_OPTION_COLORS.has(option.color)) continue;
      if (!colors.has(option.name)) colors.set(option.name, new Set());
      colors.get(option.name).add(option.color);
    }
  }
  return colors;
}

function htmlTime(record, name, fallback) {
  const property = record.page?.recordProperties?.find((entry) => entry.name === name);
  const candidate = property?.dateTime || parseNotionDate(fallback)?.start;
  return candidate && Number.isFinite(Date.parse(candidate)) ? candidate : null;
}

export async function buildNotionImport(workspace, plan, { now, idFactory = newEntityId, uploadAttachment, folderName, sourceViewConfigurations } = {}) {
  if (!plan || plan.errors?.length) throw new Error(plan?.errors?.[0] || "导入预览无效");
  const time = new Date(now).toISOString();
  const rootFolderId = idFactory("folder");
  const folder = { id: rootFolderId, parentId: null, name: uniqueFolderName(workspace, folderName || `从 Notion 导入 ${localDate(now)}`), color: "stone", sortIndex: (workspace.folders || []).filter((entry) => !entry.parentId).reduce((maximum, entry) => Math.max(maximum, Number(entry.sortIndex) || 0), 0) + 10, lastOpenedPageId: null, trashedAt: null, createdAt: time, updatedAt: time };
  const report = { pages: plan.pages.length, databases: plan.databases.length, records: plan.counts.records, attachments: 0, skipped: [...(plan.skipped || []), ...(plan.unrecognized || []).filter((entry) => entry.reason.startsWith("图片未能本地化"))].map((entry) => ({ ...entry })), unrecognizedValues: [], warnings: [] };
  const attachments = [];
  const assetsByPath = new Map();
  for (const asset of plan.assets) {
    if (asset.size > MAX_NOTION_ZIP_BYTES) { report.skipped.push({ path: asset.path, reason: "单个附件超过 1 GB" }); continue; }
    if (typeof uploadAttachment !== "function") throw new Error("附件保存服务不可用");
    const id = idFactory("attachment");
    const uploaded = await uploadAttachment(asset.name, asset.bytes, asset.mime, { id, now: time });
    if (!uploaded?.url) throw new Error(`附件保存失败：${asset.name}`);
    const sha256 = /^life-asset:\/\/([a-f0-9]{64})/i.exec(uploaded.url)?.[1];
    const metadata = createAttachmentMetadata({ ...uploaded.metadata, name: asset.name, mime: asset.mime, size: asset.size, ...(sha256 ? { checksum: sha256, provider: "asset", storageKey: sha256 } : uploaded.metadata ? {} : { provider: "local-ref", storageKey: id }) }, { id, now: time });
    attachments.push(metadata);
    assetsByPath.set(asset.path, { url: uploaded.url, kind: asset.mime.startsWith("image/") ? "image" : "file" });
    report.attachments += 1;
  }
  const pages = [];
  const sources = [];
  const views = [];
  const items = [];
  const relations = [];
  const pageByPath = new Map();
  const pageByNotionId = new Map();
  const recordByPath = new Map();
  const databaseBuilds = [];
  const configurations = prepareNotionSourceViewConfigurations(plan, sourceViewConfigurations, report.warnings);
  const occurrences = [];
  const warnMissingView = (path, view, collection) => report.warnings.push({
    kind: "view_configuration_missing", path, viewId: view.id,
    view: collection?.title || "", reason: "导出文件未提供原视图的名称、布局、筛选、排序、分组和属性显示设置；暂用表格显示，不代表原来的视图。",
  });
  let sortIndex = 0;
  const registerPage = (descriptor, page) => {
    if (!descriptor) return;
    pageByPath.set(descriptor.path, page);
    if (descriptor.notionId) pageByNotionId.set(descriptor.notionId.toLowerCase(), page);
  };
  for (const descriptor of plan.pages) {
    const page = newNotePage({ folderId: rootFolderId, title: descriptor.title, now: time, sortIndex: sortIndex += 10, idFactory });
    pages.push(page);
    registerPage(descriptor, page);
  }
  for (const descriptor of plan.databases) {
    const page = { ...newNotePage({ folderId: rootFolderId, title: descriptor.title, now: time, sortIndex: sortIndex += 10, idFactory }), pageType: "database", icon: "icon:database", content: [] };
    const sourceId = idFactory("source");
    const view = { ...createDatabaseView({ id: idFactory("view"), sourceId, name: "表格", type: "table" }), createdAt: time, updatedAt: time };
    page.databaseSourceId = sourceId;
    page.databaseViewId = view.id;
    pages.push(page);
    views.push(view);
    if (descriptor.page) warnMissingView(descriptor.page.path, view, descriptor.collection);
    for (const alias of descriptor.aliases) pageByPath.set(alias, page);
    registerPage(descriptor.page, page);
    if (descriptor.notionId) pageByNotionId.set(descriptor.notionId.toLowerCase(), page);
    const build = { descriptor, page, sourceId, viewId: view.id, records: [] };
    for (const record of descriptor.records) {
      const itemId = idFactory("item");
      const pageId = idFactory("page");
      const recordPage = makeDatabaseItemPage({ itemId, pageId, source: { id: sourceId, title: descriptor.title }, folderId: rootFolderId, title: record.title, sortIndex: sortIndex += 10, now: time, idFactory });
      pages.push(recordPage);
      const pending = { descriptor: record, itemId, page: recordPage, sourceId };
      build.records.push(pending);
      if (record.page) { registerPage(record.page, recordPage); recordByPath.set(record.page.path, pending); }
    }
    databaseBuilds.push(build);
  }
  for (const build of databaseBuilds) {
    const properties = build.descriptor.header.map((name, column) => {
      const values = build.descriptor.rows.map((row) => String(row[column] ?? "").trim());
      const filled = values.filter(Boolean);
      const relation = column > 0 && filled.length && filled.every((value) => relationParts(value));
      const htmlType = htmlColumnType(build.descriptor, name, column);
      const type = column === 0 ? "title" : htmlType === "formula" ? "text" : htmlType || (relation ? "relation" : filled.length && filled.every((value) => parseNotionDate(value)) ? "date" : looksMultiSelect(values) ? "multi_select" : inferColumnType(values));
      if (htmlType === "formula") report.warnings.push({ path: build.descriptor.path, property: name, reason: "公式表达式未包含在导出中；结果已保留为文本，不会自动计算。" });
      const colors = htmlOptionColors(build.descriptor, name);
      const optionNames = values.flatMap((value, index) => {
        const sourceOptions = build.descriptor.records[index]?.page?.recordProperties?.find((entry) => entry.name === name)?.options;
        return sourceOptions?.length ? sourceOptions.map((option) => option.name) : type === "multi_select" ? splitNotionMulti(value) : value ? [value] : [];
      });
      const options = ["select", "multi_select", "status"].includes(type) ? [...new Set(optionNames)].map((value) => ({ id: idFactory("option"), name: value, color: colors.get(value)?.size === 1 ? [...colors.get(value)][0] : "gray", ...(type === "status" ? { group: "todo" } : {}) })) : [];
      let targetSourceId = null;
      if (type === "relation") {
        for (const value of filled) for (const part of relationParts(value)) {
          const target = recordByPath.get(resolveNotionPath(build.descriptor.path, part.href));
          if (target) { targetSourceId = target.sourceId; break; }
        }
      }
      const property = createProperty({ id: idFactory("prop"), name: name || `列 ${column + 1}`, type, options, config: targetSourceId ? { targetSourceId } : {} });
      if (targetSourceId) relations.push(createRelation({ id: idFactory("relation"), sourceId: build.sourceId, propertyId: property.id, targetSourceId }));
      return property;
    });
    const source = createDataSource({ id: build.sourceId, title: build.descriptor.title, ownerPageId: build.page.id, properties, createdAt: time, updatedAt: time });
    sources.push(source);
    for (const record of build.records) {
      const values = {};
      let createdAt = time, updatedAt = time;
      for (const [column, property] of properties.entries()) {
        const text = String(record.descriptor.values[column] ?? "").trim();
        const sourceOptions = record.descriptor.page?.recordProperties?.find((entry) => entry.name === property.name)?.options;
        if (property.type === "date") values[property.id] = parseNotionDate(text);
        else if (property.type === "number") values[property.id] = parseCsvNumber(text);
        else if (property.type === "checkbox") values[property.id] = TRUE_WORDS.includes(text.toLowerCase());
        else if (["select", "status"].includes(property.type)) values[property.id] = property.options.find((option) => option.name === (sourceOptions?.length === 1 ? sourceOptions[0].name : text))?.id || null;
        else if (property.type === "multi_select") {
          values[property.id] = (sourceOptions?.length ? sourceOptions.map((option) => option.name) : splitNotionMulti(text)).map((value) => property.options.find((option) => option.name === value)?.id).filter(Boolean);
        }
        else if (["modified_time", "created_time"].includes(property.type)) {
          const timestamp = htmlTime(record.descriptor, property.name, text);
          if (timestamp) { if (property.type === "modified_time") updatedAt = timestamp; else createdAt = timestamp; }
          else if (text) report.warnings.push({ path: build.descriptor.path, property: property.name, reason: `记录“${record.descriptor.title}”的时间无法识别，使用导入时间。` });
        }
        else if (property.type === "relation") {
          values[property.id] = [];
          for (const part of relationParts(text) || []) {
            const target = recordByPath.get(resolveNotionPath(build.descriptor.path, part.href));
            if (target && target.sourceId === property.config.targetSourceId) values[property.id].push(target.itemId);
            else report.unrecognizedValues.push({ path: build.descriptor.path, row: record.descriptor.title, property: property.name, value: part.title });
          }
          values[property.id] = [...new Set(values[property.id])];
        } else values[property.id] = text;
      }
      record.page.createdAt = createdAt;
      record.page.updatedAt = updatedAt;
      items.push(createDatabaseItem({ id: record.itemId, sourceId: build.sourceId, pageId: record.page.id, values, createdAt, updatedAt }));
    }
  }
  // Validate explicitly associated settings before they can resolve a source
  // that the original export alone could not identify.
  for (const [key, configuration] of configurations.entries) {
    if (!configuration.sourceDescriptor) continue;
    const build = databaseBuilds.find((candidate) => candidate.descriptor === configuration.sourceDescriptor);
    const source = sources.find((candidate) => candidate.id === build?.sourceId);
    const invalid = configuration.entry.views.map((view) => mapNotionSourceViewConfiguration(view, source)).find((view) => !view.valid);
    if (invalid) {
      configurations.invalid(configuration.entry, configuration.entryIndex, invalid.reason);
      configurations.entries.delete(key);
    }
  }
  const contentFor = (descriptor) => {
    const resolvePage = (href, metadata = {}) => {
      const target = resolveNotionPath(descriptor.path, href);
      const alias = target && target.replace(/\.(?:md|html?)$/i, (ext) => ext.toLowerCase() === ".md" ? ".html" : ".md");
      return (pageByPath.get(target) || pageByPath.get(alias) || pageByNotionId.get(metadata.notionId))?.id || null;
    };
    const resolveAsset = (href) => assetsByPath.get(resolveNotionPath(descriptor.path, href)) || null;
    const ownerBuild = databaseBuilds.find((build) => build.descriptor.page === descriptor);
    const canonicalIndex = ownerBuild ? descriptor.collections?.indexOf(ownerBuild.descriptor.collection) : -1;
    let collectionIndex = -1;
    const resolveCollection = (collection) => {
      collectionIndex += 1;
      const configuration = notionSourceViewConfigurationFor(configurations, descriptor, collectionIndex);
      const remember = (sourceId, viewId) => {
        occurrences.push({ descriptor, collectionIndex, sourceId, viewId, configuration });
        return { sourceId, viewId };
      };
      if (ownerBuild && collectionIndex === canonicalIndex) return remember(ownerBuild.sourceId, ownerBuild.viewId);
      const rows = new Set(collection.rowIds || []);
      const exact = collection.id ? databaseBuilds.filter((build) => build.descriptor.notionId === collection.id) : [];
      let matches = exact.length ? exact : rows.size ? databaseBuilds.filter((build) => {
        const knownRows = new Set(build.records.map((record) => record.descriptor.page?.notionId).filter(Boolean));
        return [...rows].every((id) => knownRows.has(id));
      }) : databaseBuilds.filter((build) => collection.title && build.descriptor.title === collection.title);
      if (configuration?.sourceDescriptor) {
        const explicit = databaseBuilds.find((build) => build.descriptor === configuration.sourceDescriptor);
        const foreignRows = [...rows].some((id) => {
          const owners = databaseBuilds.filter((build) => build.records.some((record) => record.descriptor.page?.notionId === id));
          return owners.length && !owners.includes(explicit);
        });
        const foreignIdentity = exact.length && !exact.includes(explicit);
        if (explicit && matches.length !== 1 && !foreignRows && !foreignIdentity) matches = [explicit];
      }
      if (matches.length !== 1) {
        report.warnings.push({ kind: "collection_source_unresolved", path: descriptor.path, view: collection.title || "", reason: "无法唯一确定这个视图的数据源；已保留导出中的可见表格内容。" });
        return null;
      }
      const sourceId = matches[0].sourceId;
      const properties = sources.find((source) => source.id === sourceId).properties;
      const visiblePropertyIds = (collection.propertyNames || []).map((name) => {
        const candidates = properties.filter((property) => property.name === name);
        return candidates.length === 1 ? candidates[0].id : null;
      }).filter(Boolean);
      // Sharing records does not mean sharing a view's independent configuration.
      const view = { ...createDatabaseView({ id: idFactory("view"), sourceId, name: "导入视图", type: "table", linked: true, visiblePropertyIds: visiblePropertyIds.length ? visiblePropertyIds : null }), createdAt: time, updatedAt: time };
      views.push(view);
      warnMissingView(descriptor.path, view, collection);
      return remember(sourceId, view.id);
    };
    const blocks = descriptor.format === "html" ? notionHtmlToBlocks(descriptor, {
      idFactory, resolvePage, resolveAsset, resolveCollection,
      resolvePageTitle: (pageId) => pages.find((page) => page.id === pageId)?.title,
      onTableWarning: (number, reason) => report.warnings.push({
        kind: "table_layout_adjusted", path: descriptor.path,
        reason: `${descriptor.path} · ${number ? `表格 ${number}` : "表格"}：${reason}`,
      }),
    }) : markdownToBlocks(descriptor.body, { idFactory, extended: true, resolvePage, resolveAsset });
    return blocks.length ? blocks : [{ id: idFactory("block"), type: "paragraph", content: [], props: {}, children: [] }];
  };
  const applyAppearance = (page, descriptor) => {
    if (!descriptor?.appearance) return;
    if (descriptor.appearance.icon) page.icon = descriptor.appearance.icon;
    const cover = assetsByPath.get(resolveNotionPath(descriptor.path, descriptor.appearance.coverHref));
    if (cover?.kind === "image" && /^(?:life-asset:\/\/[a-f0-9]{64}|blob:)/i.test(cover.url)) page.cover = { kind: "upload", value: cover.url, position: descriptor.appearance.coverPosition };
  };
  for (const descriptor of plan.pages) {
    const page = pageByPath.get(descriptor.path);
    page.parentPageId = pageByPath.get(descriptor.parentPath)?.id || null;
    page.content = contentFor(descriptor);
    applyAppearance(page, descriptor);
    page.summary = derivePageSummary(page);
  }
  for (const build of databaseBuilds) {
    build.page.parentPageId = pageByPath.get(build.descriptor.parentPath)?.id || null;
    if (build.descriptor.page) { build.page.content = contentFor(build.descriptor.page); applyAppearance(build.page, build.descriptor.page); build.page.summary = derivePageSummary(build.page); }
    for (const record of build.records) if (record.descriptor.page) {
      record.page.content = contentFor(record.descriptor.page);
      applyAppearance(record.page, record.descriptor.page);
      record.page.summary = derivePageSummary(record.page);
    }
  }
  // Apply metadata only after the original import has allocated all its IDs.
  // This keeps every legacy entity/block ID stable, including later occurrences.
  const databaseBlocks = (blocks) => (blocks || []).flatMap((block) => [
    ...(block.type === "databaseView" ? [block] : []), ...databaseBlocks(block.children),
  ]);
  for (const configuration of configurations.entries.values()) {
    const { entry, entryIndex, descriptor, sourceDescriptor, currentViewIndex } = configuration;
    const targets = occurrences.filter((occurrence) => occurrence.configuration === configuration);
    const reject = (reason) => configurations.invalid(entry, entryIndex, reason);
    if (targets.length !== 1) { reject("无法唯一匹配已导入的原始数据库展示位置。 "); continue; }
    const target = targets[0];
    const source = sources.find((candidate) => candidate.id === target.sourceId);
    if (sourceDescriptor && databaseBuilds.find((build) => build.descriptor === sourceDescriptor)?.sourceId !== source.id) {
      reject("sourcePath 与原始展示位置的数据源不一致，未应用异源配置。 "); continue;
    }
    const page = pageByPath.get(descriptor.path);
    const blocks = databaseBlocks(page?.content).filter((block) => block.props.sourceId === target.sourceId && block.props.viewId === target.viewId);
    if (blocks.length !== 1) { reject("无法唯一匹配原始数据库区块。 "); continue; }
    const mapped = entry.views.map((view) => mapNotionSourceViewConfiguration(view, source));
    const invalid = mapped.find((view) => !view.valid);
    if (invalid) { reject(invalid.reason); continue; }
    const firstIndex = views.findIndex((view) => view.id === target.viewId);
    const fallback = views[firstIndex];
    const provided = mapped.map((result, index) => ({
      ...createDatabaseView({ ...fallback, ...result.view, id: index === 0 ? fallback.id : idFactory("view"), sourceId: source.id }),
      createdAt: time, updatedAt: time,
    }));
    views[firstIndex] = provided[0];
    views.push(...provided.slice(1));
    blocks[0].props.viewIdsJson = JSON.stringify(provided.map((view) => view.id));
    blocks[0].props.viewId = provided[currentViewIndex].id;
    if (entry.pageType === "database" || page.pageType === "database" && page.databaseViewId === fallback.id) {
      page.pageType = "database";
      page.databaseSourceId = source.id;
      page.databaseViewId = provided[currentViewIndex].id;
    }
    // Keep the same owned warning array: the validator's invalid-entry reporter
    // must still publish failures that follow an already successful entry.
    for (let index = report.warnings.length - 1; index >= 0; index -= 1) {
      const warning = report.warnings[index];
      if (warning.kind === "view_configuration_missing" && warning.viewId === fallback.id) report.warnings.splice(index, 1);
    }
    mapped.forEach((result, index) => {
      if (result.missingFields.length) report.warnings.push({
        kind: "view_configuration_missing", path: descriptor.path, collectionIndex: entry.collectionIndex,
        viewId: provided[index].id, view: provided[index].name, missingFields: result.missingFields,
        reason: `已应用明确提供的来源视图设置；仍未提供的字段：${result.missingFields.join("、")}。这些字段使用本地默认值，不代表原视图设置。`,
      });
    });
  }
  return { workspace: { ...workspace, folders: [...(workspace.folders || []), folder], pages: [...(workspace.pages || []), ...pages], dataSources: [...(workspace.dataSources || []), ...sources], databaseViews: [...(workspace.databaseViews || []), ...views], databaseItems: [...(workspace.databaseItems || []), ...items], relations: [...(workspace.relations || []), ...relations], attachments: [...(workspace.attachments || []), ...attachments] }, rootFolderId, report };
}
