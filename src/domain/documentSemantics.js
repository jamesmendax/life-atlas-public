import { copyJson } from "./blockDocument.js";
import { inlineSemanticText, formatPropertyValue, mentionLabel } from "./databaseProperties.js";
import { dataSourceById, databaseViewById, projectViewItems, resolvePropertyValue } from "./database.js";

function databaseRows(workspace, sourceId, viewId) {
  const source = dataSourceById(workspace, sourceId);
  if (!source) return { title: "不可用数据库", rows: [] };
  const selected = databaseViewById(workspace, viewId);
  const view = selected?.sourceId === sourceId ? selected : { sourceId, type: "table", filter: null, sorts: [] };
  const properties = source.properties || [];
  const items = projectViewItems(workspace, view);
  return {
    title: [source.title, selected?.name].filter(Boolean).join(" · "),
    rows: [properties.map((property) => property.name), ...items.map((item) => properties.map((property) => formatPropertyValue(workspace, property, resolvePropertyValue(workspace, source, item, property))))],
  };
}

function materializeInline(content, workspace) {
  if (typeof content === "string" || content == null) return content;
  if (Array.isArray(content)) return content.map((item) => {
    if (!item || typeof item !== "object") return item;
    const label = mentionLabel(item, workspace);
    if (label) return { type: "text", text: label, styles: {} };
    return { ...copyJson(item), ...(item.content ? { content: materializeInline(item.content, workspace) } : {}) };
  });
  if (content.type === "tableContent" || Array.isArray(content.rows)) return {
    ...copyJson(content), rows: (content.rows || []).map((row) => {
      const cells = Array.isArray(row) ? row : row.cells || [];
      return { ...(Array.isArray(row) ? {} : copyJson(row)), cells: cells.map(cell => {
        if (cell && typeof cell === "object" && !Array.isArray(cell)) return { ...copyJson(cell), content: materializeInline(cell.content, workspace) };
        return materializeInline(cell, workspace);
      }) };
    }),
  };
  return copyJson(content);
}

function textBlock(text, type = "paragraph", props = {}) { return { type, props, content: String(text || "") }; }
function tableBlock(rows) { return { type: "table", content: { type: "tableContent", rows: rows.map((cells) => ({ cells: cells.map((text) => [{ type: "text", text: String(text || ""), styles: {} }]) })) } }; }

// Export materializes a read-only projection. Canonical sources and references
// remain untouched in native JSON. Every tab is traversed, regardless of selection.
export function materializeDocument(blocks, workspace, ancestry = new Set(), depth = 0, options = {}) {
  if (depth > 128) return [textBlock("[内容嵌套过深]")];
  const result = [];
  for (const input of Array.isArray(blocks) ? blocks : []) {
    if (!input || typeof input !== "object") continue;
    const block = copyJson(input);
    if (block.type === "syncedBlock") {
      const id = block.props?.sourceId;
      const source = workspace?.syncedSources?.find((entry) => entry.id === id);
      if (!source || source.deletedAt || ancestry.has(id)) {
        result.push(textBlock(source?.deletedAt ? "[同步源已删除]" : ancestry.has(id) ? "[同步引用循环]" : "[同步内容不可用]"));
      } else {
        const next = new Set(ancestry); next.add(id);
        result.push(...materializeDocument(source.blocks, workspace, next, depth + 1, options));
      }
      continue;
    }
    if (block.type === "databaseView" && workspace) {
      const { title, rows } = databaseRows(workspace, block.props?.sourceId, block.props?.viewId);
      result.push(textBlock(title, "heading", { level: 3 }));
      if (rows.length) result.push(tableBlock(rows));
      continue;
    }
    if (block.type === "tabs") {
      result.push(...materializeDocument(block.children, workspace, ancestry, depth + 1, options));
      continue;
    }
    if (block.type === "tabPanel") {
      result.push(textBlock(block.props?.label || "标签页", "heading", { level: 3 }), ...materializeDocument(block.children, workspace, ancestry, depth + 1, options));
      continue;
    }
    if (["columnList", "column"].includes(block.type)) {
      result.push(...materializeDocument(block.children, workspace, ancestry, depth + 1, options));
      continue;
    }
    if (block.type === "subPage" && workspace) {
      const page = workspace.pages?.find((entry) => entry.id === block.props?.pageId);
      result.push(textBlock(`子页面：${page?.title || block.props?.title || "不可用页面"}`));
      continue;
    }
    if (!options.preserveMedia && ["image", "video", "audio", "file", "attachment"].includes(block.type)) {
      const attachment = workspace?.attachments?.find((entry) => entry.id === block.props?.attachmentId);
      const label = attachment?.name || block.props?.name || block.props?.caption || block.props?.url || "附件";
      const url = attachment?.externalUrl || (/^https?:\/\//.test(block.props?.url || "") ? block.props.url : "");
      result.push({ ...textBlock(`${label}${url ? ` (${url})` : ""}`), attachmentId: attachment?.id || null });
      if (block.children?.length) result.push(...materializeDocument(block.children, workspace, ancestry, depth + 1, options));
      continue;
    }
    if (block.type === "callout") {
      block.type = "quote";
      const content = materializeInline(block.content, workspace);
      const inline = typeof content === "string"
        ? (content ? [{ type: "text", text: content, styles: {} }] : [])
        : content || [];
      const icon = block.props?.icon || "";
      block.content = icon
        ? [{ type: "text", text: `${icon}${inline.length ? " " : ""}`, styles: {} }, ...inline]
        : inline;
    } else block.content = materializeInline(block.content, workspace);
    if (block.children) block.children = materializeDocument(block.children, workspace, ancestry, depth + 1, options);
    result.push(block);
  }
  return result;
}

export function pageSemanticDocument(page, workspace) {
  if (!page) return [];
  const document = materializeDocument(page.content, workspace);
  if (!workspace) return document;
  const item = workspace.databaseItems?.find((entry) => entry.pageId === page.id);
  const source = item ? dataSourceById(workspace, item.sourceId) : null;
  if (item && source) document.unshift(tableBlock([["属性", "值"], ...source.properties.filter((property) => property.type !== "title").map((property) => [property.name, formatPropertyValue(workspace, property, resolvePropertyValue(workspace, source, item, property))])]));
  if (page.pageType === "database" && page.databaseSourceId) {
    const { title, rows } = databaseRows(workspace, page.databaseSourceId, page.databaseViewId);
    document.push(textBlock(title, "heading", { level: 2 }));
    if (rows.length) document.push(tableBlock(rows));
  }
  return document;
}

export function plainTextFromMaterialized(blocks) {
  const walk = (block) => {
    const content = block.content;
    const own = Array.isArray(content?.rows)
      ? content.rows.map((row) => (row.cells || []).map((cell) => inlineSemanticText(cell?.content ?? cell)).join(" | ")).join("\n")
      : inlineSemanticText(content);
    return [own, ...(block.children || []).map(walk)].filter(Boolean).join("\n");
  };
  return (blocks || []).map(walk).filter(Boolean).join("\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

export function pageSemanticText(page, workspace) { return plainTextFromMaterialized(pageSemanticDocument(page, workspace)); }
