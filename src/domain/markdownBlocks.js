import { newEntityId } from "./blockDocument.js";

export function markdownInline(text) {
  const content = [];
  const expression = /\*\*([^*\n]+)\*\*|\*([^*\n]+)\*|`([^`\n]+)`/g;
  let position = 0;
  for (const match of String(text).matchAll(expression)) {
    if (match.index > position) content.push({ type: "text", text: text.slice(position, match.index), styles: {} });
    content.push({ type: "text", text: match[1] ?? match[2] ?? match[3], styles: { [match[1] !== undefined ? "bold" : match[2] !== undefined ? "italic" : "code"]: true } });
    position = match.index + match[0].length;
  }
  if (position < text.length) content.push({ type: "text", text: text.slice(position), styles: {} });
  return content;
}

export function safeMarkdownHref(href) {
  if (typeof href !== "string" || /[\u0000-\u0020\u007f]/u.test(href)) return null;
  try {
    const url = new URL(href);
    if (/^https?:\/\//i.test(href) && url.hostname && !url.username && !url.password) return href;
    if (url.protocol === "mailto:" && url.pathname) return href;
  } catch {}
  return null;
}

function linkDestination(value) {
  const href = value.trim();
  const angle = /^<([^>]+)>(?:\s+["'][^"']*["'])?$/.exec(href);
  return angle?.[1] ?? href.replace(/\s+["'][^"']*["']$/, "");
}

const inlineTokens = new RegExp([
  /\\(?<escaped>[\\`*_\[\]~$<>])/,
  /!\[(?<image>[^\]\n]*)\]\((?:[^()\n]|\([^()\n]*\))+\)/,
  /\[(?<label>[^\]\n]+)\]\((?<href>(?:[^()\n]|\([^()\n]*\))+)\)/,
  /<(?<autolink>(?:https?:\/\/|mailto:)[^<>\s]+)>/,
  /\*\*\*(?<both>[^*\n]+)\*\*\*/,
  /\*\*(?<bold>.+?)\*\*/,
  /(?<![\p{L}\p{N}])__(?<boldUnderscore>.+?)__(?![\p{L}\p{N}])/u,
  /~~(?<strike>[^~\n]+)~~/,
  /\*(?<italic>[^*\n]+)\*/,
  /(?<![\p{L}\p{N}])_(?<italicUnderscore>[^_\n]+)_(?![\p{L}\p{N}])/u,
  /`(?<code>[^`\n]+)`/,
  /\$(?<equation>[^$\n]+)\$/,
  /<u>(?<underline>[^\n]+?)<\/u>/,
].map((token) => token.source).join("|"), "giu");

export function extendedMarkdownInline(text, options = {}, styles = {}) {
  const value = String(text ?? "");
  const content = [];
  let position = 0;
  const plain = (body, nextStyles = styles) => { if (body) content.push({ type: "text", text: body, styles: { ...nextStyles } }); };
  for (const match of value.matchAll(inlineTokens)) {
    if (match.index > position) plain(value.slice(position, match.index));
    const {
      escaped, image, autolink, label = autolink, href: rawHref = autolink, code, equation,
      both, bold, boldUnderscore, strike, italic, italicUnderscore, underline,
    } = match.groups;
    if (escaped !== undefined) plain(escaped);
    else if (image !== undefined) plain(`[图片：${image}]`);
    else if (label !== undefined) {
      const href = linkDestination(rawHref);
      const pageId = !options.textOnly && options.resolvePage?.(href);
      const link = options.preserveLinks && !options.textOnly && safeMarkdownHref(href);
      const children = extendedMarkdownInline(label, { textOnly: true }, styles);
      if (pageId) content.push({ type: "pageMention", props: { pageId, labelSnapshot: label } });
      else if (link) content.push({ type: "link", href: link, content: children });
      else content.push(...children);
    } else if (code !== undefined) plain(code, { ...styles, code: true });
    else if (equation !== undefined) {
      if (options.textOnly) plain(match[0]);
      else content.push({ type: "inlineEquation", props: { expression: equation } });
    } else {
      const body = both ?? bold ?? boldUnderscore ?? strike ?? italic ?? italicUnderscore ?? underline;
      const nextStyles = { ...styles };
      if (both !== undefined || bold !== undefined || boldUnderscore !== undefined) nextStyles.bold = true;
      if (both !== undefined || italic !== undefined || italicUnderscore !== undefined) nextStyles.italic = true;
      if (strike !== undefined) nextStyles.strike = true;
      if (underline !== undefined) nextStyles.underline = true;
      content.push(...extendedMarkdownInline(body, options, nextStyles));
    }
    position = match.index + match[0].length;
  }
  if (position < value.length) plain(value.slice(position));
  return content;
}

function tableCells(line) {
  const value = (line || "").trim();
  const cells = [""];
  let position = 0;
  for (const match of value.matchAll(/\\[\\|]|\|/g)) {
    cells[cells.length - 1] += value.slice(position, match.index);
    if (match[0] === "|") cells.push("");
    else cells[cells.length - 1] += match[0] === "\\|" ? "|" : match[0];
    position = match.index + match[0].length;
  }
  if (cells.length === 1) return null;
  cells[cells.length - 1] += value.slice(position);
  if (value.startsWith("|")) cells.shift();
  if (cells.at(-1) === "") cells.pop();
  return cells.length ? cells.map((cell) => cell.trim()) : null;
}

export function markdownTableContent(rows, { headerRows = 1, ...options } = {}) {
  const width = Math.max(...rows.map((row) => row.length));
  options.checkTableSize?.(width * rows.length);
  return {
    type: "tableContent",
    headerRows,
    rows: rows.map((row) => ({
      cells: Array.from({ length: width }, (_, column) => extendedMarkdownInline(row[column] || "", options)),
    })),
  };
}

const alertProps = {
  NOTE: { icon: "ℹ️", tone: "blue" },
  TIP: { icon: "💡", tone: "green" },
  IMPORTANT: { icon: "📌", tone: "brown" },
  WARNING: { icon: "⚠️", tone: "yellow" },
  CAUTION: { icon: "🛑", tone: "red" },
};

function markdownTableStart(line, next) {
  if (startsMarkdownBlock(line)) return null;
  const delimiter = tableCells(next);
  if (!delimiter?.every((cell) => /^:?-+:?$/.test(cell))) return null;
  const header = tableCells(line);
  return header?.length === delimiter.length ? header : null;
}

function startsMarkdownBlock(line) {
  return /^(?:#{1,4}\s|>|`{3}|~{3}|[-*]\s|\d+\.\s|<aside>|<details>)/.test((line || "").trim());
}

function extendedMarkdown(text, options) {
  const lines = String(text ?? "").replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  const paragraph = [];
  const listStack = [];
  const create = (type, body, props = {}, content) => ({ id: options.idFactory("block"), type, props, content: content ?? (type === "codeBlock" || type === "equation" ? [{ type: "text", text: body, styles: {} }] : extendedMarkdownInline(body, options)), children: [] });
  const push = (type, body, props = {}, content) => { const block = create(type, body, props, content); blocks.push(block); return block; };
  const flush = () => { if (paragraph.length) push("paragraph", paragraph.splice(0).join("\n")); };
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed) { flush(); continue; }
    const header = markdownTableStart(line, lines[index + 1]);
    if (header) {
      flush();
      listStack.length = 0;
      const rows = [header];
      index += 1;
      while (!startsMarkdownBlock(lines[index + 1])) {
        const next = tableCells(lines[index + 1]);
        if (!next) break;
        rows.push(next);
        index += 1;
      }
      push("table", "", {}, markdownTableContent(rows, options));
      continue;
    }
    const list = /^([ \t]*)(?:([-*])\s+(?:\[([ xX])\]\s+)?|\d+\.\s+)(.*)$/.exec(line);
    if (list) {
      flush();
      const indent = [...list[1]].reduce((count, character) => count + (character === "\t" ? 4 : 1), 0);
      const type = list[3] !== undefined ? "checkListItem" : list[2] ? "bulletListItem" : "numberedListItem";
      const block = create(type, list[4], list[3] !== undefined ? { checked: list[3].toLowerCase() === "x" } : {});
      while (listStack.length && listStack.at(-1).indent >= indent) listStack.pop();
      if (indent > 0 && listStack.length) listStack.at(-1).block.children.push(block);
      else blocks.push(block);
      listStack.push({ indent, block });
      continue;
    }
    listStack.length = 0;
    const fence = /^(`{3,}|~{3,})\s*([^\s`~]*)\s*$/.exec(trimmed);
    if (fence) {
      flush();
      const code = [];
      const closing = new RegExp("^" + fence[1][0] + "{" + fence[1].length + ",}\\s*$");
      while (++index < lines.length && !closing.test(lines[index].trim())) code.push(lines[index]);
      push("codeBlock", code.join("\n"), { language: fence[2] || "text" });
      continue;
    }
    if (trimmed === "<aside>") {
      flush();
      const body = [];
      while (++index < lines.length && lines[index].trim() !== "</aside>") body.push(lines[index]);
      const value = body.join("\n").trim();
      const first = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value)][0]?.segment || "";
      const emoji = /[\p{Extended_Pictographic}\p{Regional_Indicator}\u20e3]/u.test(first);
      push("callout", emoji ? value.slice(first.length).trimStart() : value, { icon: emoji ? first : "💡", tone: "neutral" });
      continue;
    }
    const alert = /^>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?:\s+(.*))?$/i.exec(trimmed);
    if (alert) {
      flush();
      const body = [alert[2] ?? ""];
      while (/^>/.test(lines[index + 1]?.trim() || "")) body.push(lines[++index].trim().replace(/^>\s?/, ""));
      push("callout", body.join("\n").trim(), alertProps[alert[1].toUpperCase()]);
      continue;
    }
    if (trimmed === "$$") {
      flush();
      const equation = [];
      while (++index < lines.length && lines[index].trim() !== "$$") equation.push(lines[index]);
      push("equation", equation.join("\n"));
      continue;
    }
    const details = /^<details>\s*<summary>(.*?)<\/summary>\s*$/.exec(trimmed);
    if (details) {
      flush();
      const body = [];
      let nesting = 1;
      while (++index < lines.length) {
        if (/^<details>/.test(lines[index].trim())) nesting += 1;
        if (lines[index].trim() === "</details>") nesting -= 1;
        if (!nesting) break;
        body.push(lines[index]);
      }
      const block = push("toggleListItem", details[1]);
      block.children = extendedMarkdown(body.join("\n"), options);
      continue;
    }
    if (trimmed === "---" || trimmed === "***") { flush(); push("divider", ""); continue; }
    const image = /^!\[([^\]]*)\]\(((?:[^()]|\([^()]*\))+)\)$/.exec(trimmed);
    if (image) {
      flush();
      const href = linkDestination(image[2]);
      const asset = (options.resolveImage ?? options.resolveAsset)?.(href);
      if (asset?.url) push(asset.kind === "image" ? "image" : "file", "", { url: asset.url, name: image[1] || asset.name || decodeFileName(href) }, []);
      else push("paragraph", `[图片：${image[1]}]`);
      continue;
    }
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(trimmed);
    if (link) {
      flush();
      const pageId = options.resolvePage?.(link[2]);
      const asset = pageId ? null : options.resolveAsset?.(link[2]);
      if (pageId) push("pageLink", "", { pageId, label: link[1] }, []);
      else if (asset?.url) push(asset.kind === "image" ? "image" : "file", "", { url: asset.url, name: link[1] || decodeFileName(link[2]) }, []);
      else push("paragraph", trimmed);
      continue;
    }
    const heading = /^(#{1,4}) (.*)$/.exec(line);
    const quote = /^> (.*)$/.exec(line);
    if (heading || quote) flush();
    if (heading) push("heading", heading[2], { level: heading[1].length });
    else if (quote) push("quote", quote[1]);
    else paragraph.push(line);
  }
  flush();
  return blocks;
}

function decodeFileName(href) {
  try { return decodeURIComponent(href.split("/").at(-1)); } catch { return href.split("/").at(-1); }
}

export function markdownToBlocks(text, options = {}) {
  const normalized = typeof options === "function" ? { idFactory: options } : options || {};
  const { idFactory = newEntityId } = normalized;
  if (normalized.extended || normalized.resolveImage || normalized.resolveAsset || normalized.resolvePage) return extendedMarkdown(text, {
    ...normalized, idFactory, preserveLinks: normalized.preserveLinks ?? Boolean(normalized.resolveAsset || normalized.resolvePage),
  });
  const lines = String(text ?? "").replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  const paragraph = [];
  const push = (type, body, props = {}) => blocks.push({ id: idFactory("block"), type, props, content: type === "codeBlock" ? [{ type: "text", text: body, styles: {} }] : markdownInline(body), children: [] });
  const flush = () => { if (paragraph.length) push("paragraph", paragraph.splice(0).join("\n")); };
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) { flush(); continue; }
    const fence = /^```([^\s`]*)\s*$/.exec(line);
    if (fence) {
      flush();
      const code = [];
      while (++index < lines.length && !/^```\s*$/.test(lines[index])) code.push(lines[index]);
      push("codeBlock", code.join("\n"), { language: fence[1] || "text" });
      continue;
    }
    const heading = /^(#{1,3}) (.*)$/.exec(line);
    const todo = /^- \[([ xX])\] (.*)$/.exec(line);
    const bullet = /^[-*] (.*)$/.exec(line);
    const numbered = /^\d+\. (.*)$/.exec(line);
    const quote = /^> (.*)$/.exec(line);
    if (heading || todo || bullet || numbered || quote) flush();
    if (heading) push("heading", heading[2], { level: heading[1].length });
    else if (todo) push("checkListItem", todo[2], { checked: todo[1].toLowerCase() === "x" });
    else if (bullet) push("bulletListItem", bullet[1]);
    else if (numbered) push("numberedListItem", numbered[1]);
    else if (quote) push("quote", quote[1]);
    else paragraph.push(line);
  }
  flush();
  return blocks;
}

export function captureTitle(title, body) {
  if (String(title ?? "").trim()) return String(title).trim();
  const first = String(body ?? "").trim().split(/\r?\n/)[0] || "";
  const plain = first.replace(/^(?:#{1,3}\s|[-*]\s(?:\[[ xX]\]\s)?|\d+\.\s|>\s)/, "").replace(/\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`/g, (_, bold, italic, code) => bold ?? italic ?? code).trim();
  return Array.from(plain).slice(0, 30).join("") || "无标题记录";
}
