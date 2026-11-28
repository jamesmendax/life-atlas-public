import { copyJson } from "./blockDocument.js";
import { createDataSource, createDatabaseItem, createDatabaseView, createProperty, makeDatabaseItemPage } from "./database.js";
import { defaultPageSettings } from "./pageActions.js";
import { READ_ONLY_PROPERTY_TYPES } from "./databaseProperties.js";
import { allocateUniqueIds, textToValue } from "./propertyChanges.js";

export const TRUE_WORDS = ["true", "yes", "y", "是", "✓", "✔", "√", "x"];
export const FALSE_WORDS = ["false", "no", "n", "否"];

export function decodeCsvBytes(bytes, encoding = "auto") {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (encoding === "gbk") return { text: new TextDecoder("gbk").decode(view), encoding: "gbk" };
  if (encoding === "utf-8") return { text: new TextDecoder("utf-8").decode(view), encoding: "utf-8" };
  try { return { text: new TextDecoder("utf-8", { fatal: true }).decode(view), encoding: "utf-8" }; }
  catch { return { text: new TextDecoder("gbk").decode(view), encoding: "gbk" }; }
}

export function parseCsv(text) {
  const input = String(text ?? "").replace(/^\uFEFF/, "");
  const rows = [];
  let row = [], field = "", quoted = false, fieldStarted = false, index = 0;
  while (index < input.length) {
    const character = input[index];
    if (quoted) {
      if (character === '"') {
        if (input[index + 1] === '"') { field += '"'; index += 2; continue; }
        quoted = false; index++; continue;
      }
      field += character; index++; continue;
    }
    if (character === '"' && !fieldStarted) { quoted = true; fieldStarted = true; index++; continue; }
    if (character === ",") { row.push(field); field = ""; fieldStarted = false; index++; continue; }
    if (character === "\r" || character === "\n") {
      row.push(field); rows.push(row); row = []; field = ""; fieldStarted = false;
      index += character === "\r" && input[index + 1] === "\n" ? 2 : 1; continue;
    }
    field += character; fieldStarted = true; index++;
  }
  if (quoted) throw new Error("CSV 里有没有闭合的引号");
  if (fieldStarted || field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows.filter((entry) => !(entry.length === 1 && entry[0] === ""));
}

const DATE_PATTERNS = [/^(\d{4})-(\d{1,2})-(\d{1,2})$/, /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/, /^(\d{4})年(\d{1,2})月(\d{1,2})日$/];
export function parseCsvDate(text) {
  const value = String(text ?? "").trim();
  for (const pattern of DATE_PATTERNS) {
    const match = pattern.exec(value);
    if (!match) continue;
    const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  return null;
}

export function parseCsvNumber(text) {
  const value = String(text ?? "").trim().replace(/,/g, "");
  if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(value)) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function inferColumnType(values) {
  const filled = values.map((value) => String(value ?? "").trim()).filter(Boolean);
  if (!filled.length) return "text";
  if (filled.every((value) => parseCsvNumber(value) !== null)) return "number";
  if (filled.every((value) => parseCsvDate(value) !== null)) return "date";
  if (filled.every((value) => [...TRUE_WORDS, ...FALSE_WORDS].includes(value.toLowerCase()))) return "checkbox";
  const distinct = new Set(filled);
  if (distinct.size <= 20 && distinct.size < filled.length) return "select";
  return "text";
}

export function assertCsvLimits({ byteLength, rowCount, columnCount }) {
  if (byteLength > 10 * 1024 * 1024) throw new Error("文件太大：最多 10 MB");
  if (rowCount > 50000) throw new Error(`文件太大：最多 50,000 行，这个文件有 ${rowCount} 行`);
  if (columnCount > 200) throw new Error(`文件太大：最多 200 列，这个文件有 ${columnCount} 列`);
}

export function importCsvIntoSource(workspace, { sourceId, header, rows, mapping, now, idFactory }) {
  assertCsvLimits({ byteLength: 0, rowCount: rows.length, columnCount: rows.reduce((maximum, row) => Math.max(maximum, row.length), header.length) });
  const originalSource = workspace.dataSources?.find((source) => source.id === sourceId);
  if (!originalSource) throw new Error("找不到导入的数据库");
  const owner = workspace.pages?.find((page) => page.id === originalSource.ownerPageId);
  if (!owner || owner.trashedAt || owner.settings?.locked) throw new Error("数据库不可编辑");
  const properties = originalSource.properties.map((property) => copyJson(property));
  let next = { ...workspace, dataSources: workspace.dataSources.map((source) => source.id === sourceId ? { ...source, properties, updatedAt: now } : source) };
  const createdItems = [], createdPages = [];
  let unrecognizedCount = 0;
  let sortIndex = (workspace.pages || []).filter((page) => page.folderId === owner.folderId).reduce((maximum, page) => Math.max(maximum, Number(page.sortIndex) || 0), 0);
  const titleProperty = properties.find((property) => property.type === "title");
  for (const row of rows) {
    const values = {};
    for (let column = 0; column < header.length; column++) {
      const property = properties.find((candidate) => candidate.id === mapping[column]);
      if (!property || READ_ONLY_PROPERTY_TYPES.includes(property.type)) continue;
      const text = row[column] ?? "";
      const value = textToValue(property, text, { idFactory });
      if (["number", "date"].includes(property.type) && String(text).trim() && value === null) unrecognizedCount++;
      values[property.id] = value;
    }
    const allocated = allocateUniqueIds(next, { sourceId, values });
    next = allocated.workspace;
    const itemId = idFactory("item"), pageId = idFactory("page");
    const title = String(allocated.values[titleProperty?.id] || "无标题");
    sortIndex += 10;
    createdPages.push(makeDatabaseItemPage({ itemId, pageId, source: originalSource, folderId: owner.folderId, title, sortIndex, now, idFactory }));
    createdItems.push(createDatabaseItem({ id: itemId, sourceId, pageId, values: { ...allocated.values, [titleProperty.id]: title }, createdAt: now, updatedAt: now }));
  }
  return { workspace: { ...next, pages: [...(next.pages || []), ...createdPages], databaseItems: [...(next.databaseItems || []), ...createdItems] }, importedCount: rows.length, unrecognizedCount };
}

export function buildCsvDatabase(workspace, { fileName, header, rows, columnTypes, folderId, now, idFactory }) {
  const folder = workspace.folders?.find((entry) => entry.id === folderId && !entry.trashedAt);
  if (!folder) throw new Error("找不到导入的文件夹");
  if (!header.length) throw new Error("CSV 没有列");
  const pageId = idFactory("page"), sourceId = idFactory("source"), viewId = idFactory("view");
  const title = String(fileName || "导入的数据库").split(/[\\/]/).at(-1).replace(/\.csv$/i, "") || "导入的数据库";
  const properties = header.map((name, index) => createProperty({ id: index === 0 ? "title" : idFactory("prop"), name: name || `列 ${index + 1}`, type: index === 0 ? "title" : columnTypes[index] || "text" }));
  const source = createDataSource({ id: sourceId, title, ownerPageId: pageId, properties, createdAt: now, updatedAt: now });
  const view = { ...createDatabaseView({ id: viewId, sourceId, name: "表格", type: "table", visiblePropertyIds: null }), createdAt: now, updatedAt: now };
  const sortIndex = (workspace.pages || []).filter((page) => page.folderId === folderId).reduce((maximum, page) => Math.max(maximum, Number(page.sortIndex) || 0), 0) + 10;
  const page = { ...makeDatabaseItemPage({ itemId: sourceId, pageId, source, folderId, title, sortIndex, now, idFactory }), settings: { ...defaultPageSettings, fullWidth: true, presentationMode: "full" }, icon: "icon:database", content: [], pageType: "database", databaseSourceId: sourceId, databaseViewId: viewId };
  const initial = { ...workspace, pages: [...(workspace.pages || []), page], dataSources: [...(workspace.dataSources || []), source], databaseViews: [...(workspace.databaseViews || []), view] };
  const result = importCsvIntoSource(initial, { sourceId, header, rows, mapping: Object.fromEntries(properties.map((property, index) => [index, property.id])), now, idFactory });
  return { ...result, pageId };
}
