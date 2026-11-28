import { inlineSemanticText } from "../domain/databaseProperties.js";
import { plainTextFromMaterialized } from "../domain/documentSemantics.js";
import { reusableMediaReference } from "./pageContent.js";

function textWithinJsonBudget(value, size) {
  const prefix = value.slice(0, Math.max(0, size));
  if (JSON.stringify(prefix).length <= size + 2) return prefix;
  let low = 0;
  let high = prefix.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (JSON.stringify(prefix.slice(0, middle)).length <= size + 2) low = middle;
    else high = middle - 1;
  }
  return prefix.slice(0, low);
}

function tablePreview(content, size) {
  const rows = Array.isArray(content?.rows) ? content.rows : [];
  const columnCount = rows.reduce((count, row) => Math.max(count, row.cells?.length ?? 0), 0);
  const preview = { header_rows: content?.headerRows ?? 0, row_count: rows.length, column_count: columnCount, rows: [], truncated: columnCount > 20 };
  let available = size - JSON.stringify({ table: preview }).length;
  for (const row of rows.slice(0, 24)) {
    const cells = (row.cells ?? []).slice(0, 20);
    const perCell = Math.min(240, Math.floor((available - 3) / Math.max(1, cells.length)) - 3);
    if (perCell < 12) break;
    const values = cells.map((cell) => {
      const text = inlineSemanticText(typeof cell === "string" || Array.isArray(cell) ? cell : cell?.content);
      const excerpt = textWithinJsonBudget(text, perCell);
      if (excerpt.length < text.length) preview.truncated = true;
      return excerpt;
    });
    preview.rows.push(values);
    available -= JSON.stringify(values).length + 1;
  }
  if (preview.rows.length < rows.length) preview.truncated = true;
  return preview;
}

function nativeDetails(block, parent, size) {
  const props = block.props || {};
  if (block.type === "table") return { table: tablePreview(block.content, size) };
  if (block.type === "columnList") return { column_count: block.children?.length ?? 0 };
  if (block.type === "column") return { column: {
    index: parent?.children?.indexOf(block) ?? props.index ?? 0,
    count: parent?.children?.length ?? props.count ?? 0,
    width: props.width,
  } };
  if (block.type === "heading") return { level: props.level };
  if (block.type === "callout") return { icon: String(props.icon ?? "").slice(0, 24), tone: props.tone };
  if (["image", "video", "audio", "file", "attachment"].includes(block.type)) {
    const name = typeof props.name === "string" && !/^(?:life-asset:|blob:|data:)/i.test(props.name)
      ? props.name.split(/[\\/]/u).at(-1).slice(0, 120) : "";
    const reuseUrl = reusableMediaReference(block);
    return { media: {
      name,
      caption: String(props.caption ?? "").slice(0, 200),
      ...(reuseUrl ? { reuse_url: reuseUrl } : {}),
    } };
  }
  const label = props.label ?? (block.type === "editorialCard" ? props.title : undefined);
  return typeof label === "string" ? { label: label.slice(0, 160) } : {};
}

export function pageBlockExcerpt(block, parent, limit) {
  const entry = { block_id: block.id, type: block.type, ...(parent ? { parent_block_id: parent.id } : {}), text: "" };
  const initialSize = JSON.stringify(entry).length;
  const available = limit - initialSize - 18;
  if (available < 0) return null;
  const details = nativeDetails(block, parent, Math.floor(available * 0.8));
  if (JSON.stringify(details).length - 1 <= available) Object.assign(entry, details);
  // Only local contents are read. Linked structures and media URLs stay in the workspace.
  const text = block.type === "table"
    ? (entry.table?.rows ?? []).map((row) => row.join(" | ")).join("\n")
    : plainTextFromMaterialized([{ ...block, children: [] }]);
  entry.text = textWithinJsonBudget(text, limit - JSON.stringify(entry).length - 18);
  if (entry.text.length < text.length || (block.type === "table" && (!entry.table || entry.table.truncated))) entry.truncated = true;
  return entry;
}
