import { createPageExport, safeExportFileName } from "./pageActions.js";
import { pageSemanticDocument } from "./documentSemantics.js";
import { createPageBundle } from "./pageBundle.js";
import { expandSyncedBlocks } from "./blockDocument.js";
import { mentionLabel } from "./databaseProperties.js";
import { fillTableGaps, flattenTable, layoutTable, tableRows } from "./tableGrid.js";
import katex from "katex";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function inlinePlainText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((item) => {
    if (typeof item === "string") return item;
    if (!item || typeof item !== "object") return "";
    if (typeof item.text === "string") return item.text;
    if (item.type === "link") return inlinePlainText(item.content);
    return inlinePlainText(item.content);
  }).join("");
}

function inlineMarkdown(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((item) => {
    if (typeof item === "string") return item;
    if (!item || typeof item !== "object") return "";
    if (item.type === "inlineEquation") return `$${item.props?.expression || ""}$`;
    if (item.type === "link") {
      const text = inlineMarkdown(item.content);
      const href = item.href || item.props?.href || "";
      return href ? `[${text || href}](${href})` : text;
    }
    let text = typeof item.text === "string" ? item.text : inlineMarkdown(item.content);
    const styles = item.styles || {};
    if (styles.code) text = `\`${text}\``;
    if (styles.bold) text = `**${text}**`;
    if (styles.italic) text = `*${text}*`;
    if (styles.strike) text = `~~${text}~~`;
    return text;
  }).join("");
}

function inlineHtml(content) {
  if (typeof content === "string") return escapeHtml(content);
  if (!Array.isArray(content)) return "";
  return content.map((item) => {
    if (typeof item === "string") return escapeHtml(item);
    if (!item || typeof item !== "object") return "";
    if (item.type === "inlineEquation") return katex.renderToString(item.props?.expression || "", { displayMode: false, throwOnError: false, output: "mathml", trust: false });
    if (item.type === "link") {
      const href = escapeHtml(item.href || item.props?.href || "");
      const text = inlineHtml(item.content);
      return href ? `<a href="${href}">${text || href}</a>` : text;
    }
    let html = escapeHtml(typeof item.text === "string" ? item.text : inlinePlainText(item.content));
    const styles = item.styles || {};
    if (styles.code) html = `<code>${html}</code>`;
    if (styles.bold) html = `<strong>${html}</strong>`;
    if (styles.italic) html = `<em>${html}</em>`;
    if (styles.strike) html = `<s>${html}</s>`;
    return html;
  }).join("");
}

const cellContent = (cell) => cell?.content ?? cell;
const cellText = (cell) => inlinePlainText(cellContent(cell));
const spansNote = "合并单元格已按原行列展开，覆盖位置留空；Markdown 和 CSV 不保留跨度。";

function markdownTable(block, render) {
  const rows = tableRows(block.content);
  const layout = layoutTable(rows);
  const rowWidth = Math.max(1, layout.width);
  const normalized = layout.width ? flattenTable(layout, (cell) => render(cellContent(cell)).replaceAll("|", "\\|").replace(/\r\n?|\n/g, "<br>"), "") : rows.map(() => [""]);
  const line = (cells) => `| ${cells.join(" | ")} |`;
  return rows.length ? [line(normalized[0]), line(Array(rowWidth).fill("---")), ...normalized.slice(1).map(line)].join("\n") : "";
}

function escapeCsv(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function tableCsvProjection(page, workspace) {
  const files = [];
  let flattenedSpans = false;
  const walk = (blocks = []) => {
    for (const block of blocks) {
      if (block?.type === "table") {
        const rows = tableRows(block.content);
        const layout = layoutTable(rows);
        flattenedSpans ||= layout.hasSpans;
        const values = layout.hasSpans ? flattenTable(layout, cellText, "") : rows.map((row) => row.map(cellText));
        const csv = values
          .map((row) => layout.hasSpans && row.length === 1 && row[0] === "" ? '""' : row.map(escapeCsv).join(","))
          .join("\r\n");
        files.push({
          name: `table-${String(files.length + 1).padStart(2, "0")}.csv`,
          csv,
        });
      }
      if (Array.isArray(block?.children) && block.children.length) walk(block.children);
    }
  };
  walk(workspace ? pageSemanticDocument(page, workspace) : Array.isArray(page?.content) ? page.content : []);
  return { files, flattenedSpans };
}

export function collectTableCsvFiles(page, { workspace } = {}) {
  return tableCsvProjection(page, workspace).files;
}

function blockMarkdown(block, depth = 0) {
  const text = inlineMarkdown(block?.content);
  const type = block?.type || "paragraph";
  const indent = "  ".repeat(depth);
  let line = text;

  if (type === "heading") {
    const level = Math.min(4, Math.max(1, Number(block?.props?.level) || 1));
    line = `${"#".repeat(level)} ${text}`;
  } else if (type === "bulletListItem") {
    line = `- ${text}`;
  } else if (type === "numberedListItem") {
    line = `1. ${text}`;
  } else if (type === "checkListItem") {
    line = `- [${block?.props?.checked ? "x" : " "}] ${text}`;
  } else if (type === "quote") {
    line = `> ${text}`;
  } else if (type === "codeBlock") {
    const language = block?.props?.language || "";
    line = `\`\`\`${language}\n${inlinePlainText(block?.content)}\n\`\`\``;
  } else if (type === "equation") {
    line = `$$\n${inlinePlainText(block?.content)}\n$$`;
  } else if (type === "divider") {
    line = "---";
  } else if (type === "table") line = markdownTable(block, inlinePlainText);

  const children = Array.isArray(block?.children) ? block.children : [];
  const childText = children.map((child) => blockMarkdown(child, depth + 1)).filter(Boolean).join("\n");
  const own = line ? `${indent}${line}` : "";
  return [own, childText].filter(Boolean).join("\n");
}

const exportLinkPath = (value) => String(value).replaceAll(" ", "%20");

function linkedInlineMarkdown(content, workspace, links) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((item) => {
    if (typeof item === "string") return item;
    if (!item || typeof item !== "object") return "";
    if (item.type === "pageMention") {
      const page = workspace?.pages?.find((candidate) => candidate.id === item.props?.pageId);
      const title = page?.title || item.props?.labelSnapshot || "页面";
      const href = links.pagePath?.(item.props?.pageId);
      return href ? `[${title}](${exportLinkPath(href)})` : title;
    }
    if (item.type === "inlineEquation") return `$${item.props?.expression || ""}$`;
    if (item.type === "link") {
      const text = linkedInlineMarkdown(item.content, workspace, links);
      const href = item.href || item.props?.href || "";
      const pageLink = /^lifeatlas:\/\/page\/([A-Za-z0-9_-]+)(?:#block-([A-Za-z0-9_-]+))?$/.exec(href);
      if (pageLink) {
        const target = links.pagePath?.(pageLink[1]);
        return target ? `[${text || workspace?.pages?.find((page) => page.id === pageLink[1])?.title || "页面"}](${exportLinkPath(target)}${pageLink[2] ? `#block-${pageLink[2]}` : ""})` : text;
      }
      return href ? `[${text || href}](${href})` : text;
    }
    const semanticLabel = mentionLabel(item, workspace);
    let text = semanticLabel || (typeof item.text === "string" ? item.text : linkedInlineMarkdown(item.content, workspace, links));
    const styles = item.styles || {};
    if (styles.code) text = `\`${text}\``;
    if (styles.bold) text = `**${text}**`;
    if (styles.italic) text = `*${text}*`;
    if (styles.strike) text = `~~${text}~~`;
    return text;
  }).join("");
}

function linkedBlockMarkdown(block, workspace, links, depth = 0) {
  const type = block?.type || "paragraph";
  const children = Array.isArray(block?.children) ? block.children : [];
  const childBody = (childDepth = depth) => children.map((child) => linkedBlockMarkdown(child, workspace, links, childDepth)).filter(Boolean).join("\n\n");
  const text = linkedInlineMarkdown(block?.content, workspace, links);
  if (["tableOfContents", "breadcrumb"].includes(type)) return "";
  if (type === "syncedBlock" || type === "column") return childBody();
  if (type === "columnList") return children.map((column, index) => `<!-- 第 ${index + 1} 栏 -->\n\n${linkedBlockMarkdown(column, workspace, links, depth)}`).join("\n\n");
  if (type === "tabs") return childBody();
  if (type === "tabPanel") return [`**${block.props?.label || "标签页"}**`, childBody()].filter(Boolean).join("\n\n");
  if (type === "toggleListItem" || type === "heading" && block.props?.isToggleable) return `<details><summary>${text}</summary>\n\n${childBody()}\n\n</details>`;
  let line = text;
  if (["pageLink", "subPage"].includes(type)) {
    const target = workspace?.pages?.find((page) => page.id === block.props?.pageId);
    const title = target?.title || block.props?.label || block.props?.title || "页面";
    const href = links.pagePath?.(block.props?.pageId);
    line = href ? `[→ ${title}](${exportLinkPath(href)})` : `→ ${title}`;
  } else if (type === "databaseView") {
    const source = workspace?.dataSources?.find((entry) => entry.id === block.props?.sourceId);
    const title = source?.title || "不可用数据库";
    const href = links.databasePath?.(block.props?.sourceId);
    line = href ? `[数据库：${title}](${exportLinkPath(href)})` : `数据库：${title}`;
  } else if (["image", "video", "audio", "file", "attachment", "pdf"].includes(type)) {
    const attachment = workspace?.attachments?.find((entry) => entry.id === block.props?.attachmentId);
    const url = block.props?.url || attachment?.externalUrl || (attachment?.provider === "asset" ? `life-asset://${attachment.storageKey}` : attachment?.id) || "";
    const name = block.props?.name || attachment?.name || block.props?.caption || "附件";
    const remote = /^(?:https?|mailto):/i.test(url);
    const href = remote ? url : links.assetPath?.(url);
    line = href ? `${type === "image" ? "!" : ""}[${name}](${remote ? href : exportLinkPath(href)})` : name;
  } else if (type === "callout") line = `> ${block.props?.icon || "💡"} ${text.replaceAll("\n", "\n> ")}`;
  else if (type === "heading") line = `${"#".repeat(Math.min(4, Math.max(1, Number(block.props?.level) || 1)))} ${text}`;
  else if (type === "bulletListItem") line = `- ${text}`;
  else if (type === "numberedListItem") line = `1. ${text}`;
  else if (type === "checkListItem") line = `- [${block.props?.checked ? "x" : " "}] ${text}`;
  else if (type === "quote") line = `> ${text.replaceAll("\n", "\n> ")}`;
  else if (type === "codeBlock") line = `\`\`\`${block.props?.language || ""}\n${inlinePlainText(block.content)}\n\`\`\``;
  else if (type === "equation") line = `$$\n${inlinePlainText(block.content)}\n$$`;
  else if (type === "divider") line = "---";
  else if (type === "table") line = markdownTable(block, (value) => linkedInlineMarkdown(value, workspace, links));
  else if (type === "editorialCard") {
    const href = links.pagePath?.(block.props?.pageId);
    const title = block.props?.title || "内容卡片";
    const image = block.props?.imageUrl;
    const imagePath = image && (/^https?:/i.test(image) ? image : links.assetPath?.(image));
    line = [imagePath ? `![${title}](${exportLinkPath(imagePath)})` : "", href ? `[${title}](${exportLinkPath(href)})` : `**${title}**`, block.props?.eyebrow, block.props?.excerpt].filter(Boolean).join("\n\n");
  }
  const indent = "  ".repeat(depth);
  const own = line ? line.split("\n").map((part) => `${indent}${part}`).join("\n") : "";
  const list = ["bulletListItem", "numberedListItem", "checkListItem"].includes(type);
  return [own, childBody(list ? depth + 1 : depth)].filter(Boolean).join(list ? "\n" : "\n\n");
}

export function pageToMarkdown(page, { includeTitle = true, workspace, links } = {}) {
  if (links) {
    const blocks = expandSyncedBlocks(Array.isArray(page?.content) ? page.content : [], workspace);
    const body = blocks.map((block) => linkedBlockMarkdown(block, workspace, links)).filter(Boolean).join("\n\n").trim();
    if (!includeTitle) return body ? `${body}\n` : "";
    return `# ${page?.title || "无标题页面"}\n\n${body}`.trimEnd() + "\n";
  }
  const blocks = workspace ? pageSemanticDocument(page, workspace) : Array.isArray(page?.content) ? page.content : [];
  const body = blocks.map((block) => blockMarkdown(block)).filter(Boolean).join("\n\n").trim();
  if (!includeTitle) return body ? `${body}\n` : "";
  const title = page?.title || "无标题页面";
  return `# ${title}\n\n${body}`.trimEnd() + "\n";
}

function blockHtml(block) {
  const type = block?.type || "paragraph";
  const content = inlineHtml(block?.content);
  let html = `<p>${content || "<br>"}</p>`;

  if (type === "heading") {
    const level = Math.min(4, Math.max(1, Number(block?.props?.level) || 1));
    html = `<h${level}>${content}</h${level}>`;
  } else if (type === "bulletListItem") {
    html = `<ul><li>${content}</li></ul>`;
  } else if (type === "numberedListItem") {
    html = `<ol><li>${content}</li></ol>`;
  } else if (type === "checkListItem") {
    html = `<p class="check">${block?.props?.checked ? "☑" : "☐"} ${content}</p>`;
  } else if (type === "quote") {
    html = `<blockquote>${content}</blockquote>`;
  } else if (type === "codeBlock") {
    html = `<pre><code>${escapeHtml(inlinePlainText(block?.content))}</code></pre>`;
  } else if (type === "equation") {
    html = katex.renderToString(inlinePlainText(block?.content), { displayMode: true, throwOnError: false, output: "mathml", trust: false });
  } else if (type === "divider") {
    html = "<hr>";
  } else if (type === "table") {
    const layout = layoutTable(tableRows(block.content));
    const rows = layout.displaced ? fillTableGaps(layout) : layout.placed;
    const { headerRows, headerCols } = block.content ?? {};
    html = `<table>${rows.map((row, rowIndex) => `<tr>${row.map(({ cell, column, rowspan, colspan }) => {
      const tag = rowIndex < headerRows || column < headerCols ? "th" : "td";
      const attributes = `${rowspan > 1 ? ` rowspan="${rowspan}"` : ""}${colspan > 1 ? ` colspan="${colspan}"` : ""}`;
      return `<${tag}${attributes}>${escapeHtml(cellText(cell))}</${tag}>`;
    }).join("")}</tr>`).join("")}</table>`;
  }

  const children = Array.isArray(block?.children) ? block.children : [];
  if (children.length) html += `<div class="children">${children.map(blockHtml).join("")}</div>`;
  return html;
}

export function pageToStandaloneHtml(page, { includeAppearance = true, workspace } = {}) {
  const title = page?.title || "无标题页面";
  const content = (workspace ? pageSemanticDocument(page, workspace) : Array.isArray(page?.content) ? page.content : []).map(blockHtml).join("\n");
  const icon = includeAppearance ? escapeHtml(page?.icon || "") : "";
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:#171717;color:#e8e8e8;font:16px/1.72 Inter,"Microsoft YaHei","Noto Sans SC",system-ui,sans-serif}main{width:min(760px,calc(100% - 48px));margin:72px auto 120px}.icon{font-size:52px;line-height:1;margin-bottom:18px}h1{margin:0 0 34px;font-size:42px;line-height:1.15}h2{font-size:28px}h3{font-size:22px}p{margin:10px 0}blockquote{margin:18px 0;padding-left:18px;border-left:3px solid #777;color:#cfcfcf}pre{overflow:auto;padding:16px;border-radius:8px;background:#101010}code{font-family:Consolas,monospace}table{border-collapse:collapse;width:100%;margin:18px 0}td,th{border:1px solid #555;padding:8px 10px}th{text-align:left}.children{margin-left:24px}.check{font-variant-numeric:tabular-nums}a{color:#7fb7ff}
</style>
</head>
<body><main>${icon ? `<div class="icon">${icon}</div>` : ""}<h1>${escapeHtml(title)}</h1>${content}</main></body>
</html>`;
}

export async function createMarkdownCsvArchive(page, { includeTitle = true, workspace } = {}) {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  const base = safeExportFileName(page?.title);
  zip.file(`${base}.md`, pageToMarkdown(page, { includeTitle, workspace }));
  const { files: tables, flattenedSpans } = tableCsvProjection(page, workspace);
  for (const table of tables) zip.file(table.name, table.csv);
  zip.file("_README.txt", tables.length
    ? `Life Atlas 导出：${base}.md + ${tables.length} 个表格 CSV。\n${flattenedSpans ? `${spansNote}\n` : ""}`
    : "Life Atlas 导出：当前页面没有表格，因此压缩包仅包含 Markdown 正文。\n");
  const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });
  const blob = new Blob([bytes], { type: "application/zip" });
  return { blob, fileName: `${base}.markdown-csv.zip`, tableCount: tables.length };
}

export function createHtmlExport(page, options) {
  return {
    blob: new Blob([pageToStandaloneHtml(page, options)], { type: "text/html;charset=utf-8" }),
    fileName: `${safeExportFileName(page?.title)}.html`,
  };
}

export function createJsonBackup(page, { workspace } = {}) {
  return {
    blob: new Blob([JSON.stringify(workspace ? createPageBundle(page, workspace) : createPageExport(page), null, 2)], { type: "application/json;charset=utf-8" }),
    fileName: `${safeExportFileName(page?.title)}.life-atlas.json`,
  };
}

export async function createPdfBlobFromRenderedPages(renderedPages = [], title = "Life Atlas") {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4", compress: true });
  pdf.setProperties({ title: String(title || "Life Atlas"), creator: "Life Atlas" });
  if (!renderedPages.length) {
    pdf.setFontSize(15);
    pdf.text("Life Atlas local PDF export", 40, 52);
  } else {
    renderedPages.forEach((page, index) => {
      if (index > 0) pdf.addPage();
      pdf.addImage(page.dataUrl, "JPEG", 0, 0, page.widthPt, page.heightPt, undefined, "FAST");
    });
  }
  return pdf.output("blob");
}

export async function exportPageElementToPdf(element, page, { includeAppearance = true } = {}) {
  if (!(element instanceof Element)) throw new Error("找不到当前页面的可导出内容");
  const { default: html2canvas } = await import("html2canvas");
  const canvas = await html2canvas(element, {
    backgroundColor: "#171717",
    scale: Math.min(2, Math.max(1.35, window.devicePixelRatio || 1)),
    useCORS: true,
    logging: false,
    ignoreElements: (node) => {
      if (!(node instanceof Element)) return false;
      if (node.matches(".cover-action,.page-add-cover-action")) return true;
      if (!includeAppearance && node.matches(".page-cover,.page-icon-button")) return true;
      return false;
    },
  });

  const { jsPDF } = await import("jspdf");
  const probe = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  const pageWidthPt = probe.internal.pageSize.getWidth();
  const pageHeightPt = probe.internal.pageSize.getHeight();
  const scale = pageWidthPt / canvas.width;
  const pagePixelHeight = Math.max(1, Math.floor(pageHeightPt / scale));
  const renderedPages = [];

  for (let y = 0; y < canvas.height; y += pagePixelHeight) {
    const sliceHeight = Math.min(pagePixelHeight, canvas.height - y);
    const slice = document.createElement("canvas");
    slice.width = canvas.width;
    slice.height = sliceHeight;
    const context = slice.getContext("2d");
    context.drawImage(canvas, 0, y, canvas.width, sliceHeight, 0, 0, canvas.width, sliceHeight);
    renderedPages.push({
      dataUrl: slice.toDataURL("image/jpeg", 0.93),
      widthPt: pageWidthPt,
      heightPt: sliceHeight * scale,
    });
  }

  const blob = await createPdfBlobFromRenderedPages(renderedPages, page?.title);
  return { blob, fileName: `${safeExportFileName(page?.title)}.pdf` };
}

export async function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  const subscribe = window.lifeAtlas?.app?.onExportDownload;
  let unsubscribe, timer;
  try {
    const completion = subscribe && new Promise((resolve, reject) => {
      timer = window.setTimeout(() => reject(new Error("未能打开保存窗口，请重试。")), 30000);
      unsubscribe = subscribe(({ url: original, outcome }) => {
        if (original !== url) return;
        window.clearTimeout(timer);
        if (outcome === "choosing") return;
        if (outcome === "completed") resolve(true);
        else if (outcome === "cancelled") resolve(false);
        else reject(new Error("未能保存导出文件，请重新选择保存位置。"));
      });
    });
    document.body.appendChild(anchor);
    anchor.click();
    return completion ? await completion : true;
  } finally {
    anchor.remove();
    window.clearTimeout(timer);
    unsubscribe?.();
    if (subscribe) URL.revokeObjectURL(url);
    else window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
