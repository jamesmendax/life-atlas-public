import { parseNotionName } from "./notionNames.js";
import { convertNotionHtmlTable } from "./notionHtmlTable.js";

// Exported markup is parsed only in a detached template. Never insert it into the page.
function fragment(html) {
  const template = document.createElement("template");
  template.innerHTML = html;
  return template.content;
}

const text = (node) => (node?.textContent || "").trim();
const compactId = (value) => /^[0-9a-f-]{32,36}$/i.test(value || "") ? value.replaceAll("-", "").toLowerCase() : null;
const localMediaUrl = (url) => /^(?:life-asset:\/\/[a-f0-9]{64}\/?|blob:|data:image\/)/i.test(String(url || ""));
const unique = (values) => [...new Set(values.filter(Boolean))];

function iconValue(raw) {
  if (!raw) return null;
  if (/^(?:https?:|\/|\.\/)/i.test(raw)) {
    // The export's activity icon has a clear native equivalent; do not copy its SVG.
    return /(?:^|\/)activity_(?:lightgray|gray)\.svg(?:\?|$)/i.test(raw) ? "icon:activity" : null;
  }
  return raw;
}

function imageHrefs(node) {
  return unique([node.querySelector("img")?.getAttribute("src"), node.getAttribute("data-notion-image"), node.querySelector("a")?.getAttribute("href")]);
}

function collectionMetadata(table, fallbackTitle = "") {
  const owner = table.closest("div.collection-content");
  const headers = [...(table?.querySelectorAll("thead tr:first-child th") || [])];
  const rows = [...(table?.querySelectorAll("tbody tr") || [])].map((row) => {
    const first = row.querySelector("td");
    const link = first?.querySelector("a[href]");
    return { notionId: compactId(link?.getAttribute("data-notion-page-id")) || compactId(row.id), title: text(link) || text(first), href: link?.getAttribute("href") || null };
  });
  return {
    id: compactId(owner?.id) || compactId(table.id), title: text(owner?.querySelector(".collection-title")) || fallbackTitle,
    rowIds: rows.map((row) => row.notionId).filter(Boolean), rows,
    propertyNames: headers.map(text),
    ...(headers.some((header) => header.querySelector("img[src]")) ? { propertyIcons: headers.map((header) => header.querySelector("img[src]")?.getAttribute("src") || null) } : {}),
  };
}

export function parseNotionHtmlPage(filePath, bytes) {
  const html = typeof bytes === "string" ? bytes : new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const root = fragment(html);
  const article = root.querySelector("article.page") || root.querySelector("article");
  const header = article?.querySelector(":scope > header");
  const body = article?.querySelector(":scope > .page-body");
  const description = header?.querySelector(":scope > p.page-description");
  const name = parseNotionName(String(filePath).split("/").at(-1));
  const titleNode = header?.querySelector(".page-title");
  const iconRaw = article?.getAttribute("data-notion-page-icon") || root.querySelector('meta[name="data-notion-page-icon"]')?.getAttribute("content") || text(header?.querySelector(".page-header-icon"));
  const cover = header?.querySelector("img.page-cover-image");
  const position = /(?:^|\s)(-?\d+(?:\.\d+)?)%/.exec(cover?.style.objectPosition || "");
  const links = [...(body?.querySelectorAll("a[href]") || [])].map((link) => ({ href: link.getAttribute("href"), text: text(link), notionId: compactId(link.getAttribute("data-notion-page-id")), child: Boolean(link.closest("figure.link-to-page")) }));
  // Header description links are navigation, never child-page ownership.
  links.push(...[...(description?.querySelectorAll("a[href]") || [])].map((link) => ({ href: link.getAttribute("href"), text: text(link), notionId: compactId(link.getAttribute("data-notion-page-id")), child: false })));
  const recordProperties = [...(header?.querySelectorAll("table.properties tr") || [])].map((row) => {
    const value = row.querySelector("td");
    const checkbox = value?.querySelector('input[type="checkbox"]');
    const options = [...(value?.querySelectorAll(".selected-value") || [])].map((option) => ({ name: text(option), color: [...option.classList].find((item) => item.startsWith("select-value-color-"))?.slice(19) || null })).filter((option) => option.name);
    const dateTime = value?.querySelector("time[datetime]")?.getAttribute("datetime");
    return { name: text(row.querySelector("th")), type: [...row.classList].find((item) => item.startsWith("property-row-") && item !== "property-row")?.slice(13) || "", value: checkbox ? checkbox.hasAttribute("checked") : text(value), hrefs: [...(value?.querySelectorAll("a[href]") || [])].map((a) => a.getAttribute("href")), ...(options.length ? { options } : {}), ...(dateTime ? { dateTime } : {}) };
  });
  const assetHrefs = unique([cover?.getAttribute("src"), ...[...(body?.querySelectorAll("figure.image, figure[data-notion-image]") || [])].flatMap(imageHrefs), ...[...(body?.querySelectorAll("img") || [])].filter((img) => !img.closest("figure.image, figure[data-notion-image], .property-icon, .icon, figure.link-to-page")).map((img) => img.getAttribute("src"))]);
  assetHrefs.push(...unique([
    ...[...(description?.querySelectorAll("a[href]") || [])].map((link) => link.getAttribute("href")).filter((href) => {
      const path = href.split(/[?#]/)[0];
      return path && !/^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(path) && /\.[^/]+$/.test(path) && !/\.(?:html?|md|csv)$/i.test(path);
    }),
    ...[...(description?.querySelectorAll("img") || [])].map((img) => img.getAttribute("src")),
  ]).filter((href) => !assetHrefs.includes(href)));
  return {
    path: filePath, title: text(titleNode) || name.title, notionId: compactId(article?.id) || name.notionId,
    format: "html", body: body?.innerHTML || "", description: description?.innerHTML || "", hasTitle: Boolean(titleNode),
    appearance: { coverHref: cover?.getAttribute("src") || null, coverPosition: position ? Number(position[1]) : 50, icon: iconValue(iconRaw) },
    assetHrefs, links, childPagePaths: unique(links.filter((link) => link.child).map((link) => link.href)),
    ownedPageHrefs: unique(links.filter((link) => link.child).map((link) => link.href)),
    collections: [...(body?.querySelectorAll("table.collection-content") || [])].map((table) => collectionMetadata(table, text(titleNode) || name.title)), recordProperties,
  };
}

export function notionHtmlToBlocks(descriptor, { idFactory, resolvePage, resolvePageTitle, resolveAsset, resolveCollection, onTableWarning } = {}) {
  if (typeof idFactory !== "function") throw new Error("notionHtmlToBlocks requires idFactory");
  const root = fragment(descriptor.body || "");
  const tableNumbers = new Map([...root.querySelectorAll("table")].map((table, index) => [table, index + 1]));
  const block = (type, content = [], props = {}, children = []) => ({ id: idFactory("block"), type, props, content, children });
  const colors = new Set(["gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"]);
  const colorName = (value) => value.replace(/_background$/, "").replace(/^teal$/, "green");
  function inline(node, styles = {}) {
    if (node.nodeType === 3) return node.nodeValue ? [{ type: "text", text: node.nodeValue, styles: { ...styles } }] : [];
    if (node.nodeType !== 1) return [];
    const tag = node.tagName.toLowerCase();
    if (["script", "style", "iframe", "object", "embed", "img", "input", "ul", "ol"].includes(tag)) return [];
    if (tag === "br") return [{ type: "text", text: "\n", styles: { ...styles } }];
    const next = { ...styles };
    if (["b", "strong"].includes(tag)) next.bold = true;
    if (["i", "em"].includes(tag)) next.italic = true;
    if (["s", "del", "strike"].includes(tag)) next.strike = true;
    if (tag === "u") next.underline = true;
    if (tag === "code") next.code = true;
    const highlight = node.getAttribute("data-notion-highlight") || [...node.classList].find((item) => item.startsWith("highlight-"))?.slice(10);
    if (highlight) {
      const color = colorName(highlight);
      if (colors.has(color)) next[highlight.endsWith("_background") ? "backgroundColor" : "textColor"] = color;
    }
    if (tag === "a") {
      const href = node.getAttribute("href") || "";
      const label = text(node);
      const pageId = resolvePage?.(href, { notionId: compactId(node.getAttribute("data-notion-page-id")), label });
      if (pageId) {
        const title = resolvePageTitle?.(pageId);
        if (typeof title === "string" && label !== title.trim()) {
          return [{ type: "link", href: `lifeatlas://page/${pageId}`, content: [...node.childNodes].flatMap((child) => inline(child, next)) }];
        }
        return [{ type: "pageMention", props: { pageId, labelSnapshot: label } }];
      }
      const children = [...node.childNodes].flatMap((child) => inline(child, next));
      const asset = resolveAsset?.(href);
      const assetUrl = typeof asset === "string" ? asset : asset?.url;
      if (localMediaUrl(assetUrl) && children.every((child) => child.type === "text")) return [{ type: "link", href: assetUrl, content: children }];
      if (/^(?:https?|mailto):/i.test(href) && children.every((child) => child.type === "text")) return [{ type: "link", href, content: children }];
      return children;
    }
    return [...node.childNodes].flatMap((child) => inline(child, next));
  }
  const contents = (node) => [...node.childNodes].flatMap((child) => inline(child));
  const ensureChildren = (children) => children.length ? children : [block("paragraph")];
  function image(node) {
    const hrefs = node.tagName.toLowerCase() === "img" ? [node.getAttribute("src")] : imageHrefs(node);
    const caption = text(node.querySelector("figcaption"));
    for (const href of hrefs.filter(Boolean)) {
      const asset = resolveAsset?.(href);
      const url = typeof asset === "string" ? asset : asset?.url;
      if (localMediaUrl(url)) return block("image", [], { url, name: node.querySelector("img")?.getAttribute("alt") || node.getAttribute("alt") || caption || "图片", caption });
    }
    return block("paragraph", [{ type: "text", text: caption ? `[图片：${caption}]` : "[图片未能本地化]", styles: {} }]);
  }
  function table(node) {
    const { content, fallbackRows, warnings } = convertNotionHtmlTable(node, contents);
    if (warnings.length) onTableWarning?.(tableNumbers.get(node), warnings.join(" "));
    return content ? [block("table", content)] : (fallbackRows || []).map((row) => block("paragraph", row));
  }
  function callout(node) {
    // The export puts the decorative icon in a separate div before the body.
    // Read only this callout's icon, never one belonging to a nested callout.
    const iconSelector = ":scope > .icon, :scope > div > .icon";
    const iconNode = node.querySelector(iconSelector);
    const icon = node.getAttribute("data-notion-callout-icon") ?? iconNode?.getAttribute("data-emoji") ?? text(iconNode);
    const background = node.getAttribute("data-notion-callout-background") || [...node.classList].find((item) => item.startsWith("block-color-"))?.slice(12) || "";
    const color = colorName(background);
    const body = node.cloneNode(true);
    body.querySelector(iconSelector)?.remove();
    const children = childrenOf(body);
    const first = children[0]?.type === "paragraph" ? children.shift() : null;
    return block("callout", first?.content || [], {
      icon: icon.trim(),
      tone: ["gray", "brown", "blue", "yellow", "red", "green"].includes(color) ? color : "neutral",
      backgroundColor: colors.has(color) ? color : "default",
    }, [...(first?.children || []), ...children]);
  }
  function convert(node) {
    if (node.nodeType === 3) return node.nodeValue.trim() ? [block("paragraph", inline(node))] : [];
    if (node.nodeType !== 1) return [];
    const tag = node.tagName.toLowerCase();
    if (["script", "style", "iframe", "object", "embed"].includes(tag)) return [];
    if (tag === "aside" || node.hasAttribute("data-notion-callout")) return [callout(node)];
    if (node.matches(".column-list, [data-notion-column-list]")) {
      const columns = [...node.children].filter((child) => child.matches(".column, [data-notion-column-ratio]"));
      if (columns.length < 2 || columns.length > 5) return columns.flatMap((column) => childrenOf(column));
      return [block("columnList", [], { columns: columns.length }, columns.map((column, index) => {
        const ratio = Number(column.getAttribute("data-notion-column-ratio"));
        const percent = Number.parseFloat(column.style.width);
        const weight = Number.isFinite(ratio) && ratio > 0 ? ratio * 100 : Number.isFinite(percent) && percent > 0 ? percent : 100 / columns.length;
        const width = Math.abs(weight - Math.round(weight)) < 1e-10 ? Math.round(weight) : weight;
        return block("column", [], { width, index, count: columns.length }, ensureChildren(childrenOf(column)));
      }))];
    }
    if (node.matches("div.collection-content, div.collection-content-wrapper, table.collection-content")) {
      const collectionTables = node.matches("table.collection-content") ? [node] : [...node.querySelectorAll("table.collection-content")];
      if (!collectionTables.length) return childrenOf(node);
      return collectionTables.flatMap((collectionTable) => {
        const metadata = collectionMetadata(collectionTable, descriptor.title || "");
        const result = resolveCollection?.(metadata);
        const view = result?.type === "databaseView" ? result.props : result;
        if (view?.sourceId && view?.viewId) return [block("databaseView", [], { sourceId: view.sourceId, viewId: view.viewId })];
        const visibleTitle = text(collectionTable.closest("div.collection-content")?.querySelector(".collection-title"));
        return [...(visibleTitle ? [block("heading", [{ type: "text", text: visibleTitle, styles: {} }], { level: 3 })] : []), ...table(collectionTable)];
      });
    }
    if (node.matches("figure.image, figure[data-notion-image]") || tag === "img") return [image(node)];
    if (node.matches("figure.link-to-page")) {
      const link = node.querySelector("a[href]");
      const pageId = link && resolvePage?.(link.getAttribute("href"), { notionId: compactId(link.getAttribute("data-notion-page-id")), label: text(link) });
      return pageId ? [block("pageLink", [], { pageId, label: text(link) })] : [block("paragraph", contents(node))];
    }
    if (tag === "details") {
      const summary = [...node.children].find((child) => child.tagName === "SUMMARY");
      const children = [...node.childNodes].filter((child) => child !== summary).flatMap(convert);
      return [block("toggleListItem", summary ? contents(summary) : [], {}, children)];
    }
    if (["ul", "ol"].includes(tag)) return [...node.children].filter((child) => child.tagName === "LI").map((li) => {
      const checkbox = li.querySelector('input[type="checkbox"]');
      const type = checkbox ? "checkListItem" : tag === "ol" ? "numberedListItem" : "bulletListItem";
      const nested = [...li.children].filter((child) => ["UL", "OL"].includes(child.tagName)).flatMap(convert);
      return block(type, contents(li), checkbox ? { checked: checkbox.hasAttribute("checked") } : {}, nested);
    });
    if (tag === "table") return table(node);
    if (tag === "hr") return [block("divider")];
    if (tag === "pre") return [block("codeBlock", [{ type: "text", text: node.textContent || "", styles: {} }], { language: "text" })];
    if (/^h[1-4]$/.test(tag)) return [block("heading", contents(node), { level: Number(tag[1]) })];
    if (tag === "blockquote") return [block("quote", contents(node))];
    if (tag === "p") return [block("paragraph", contents(node))];
    if (["div", "section", "article", "figure"].includes(tag)) return childrenOf(node);
    const content = contents(node);
    return content.length ? [block("paragraph", content)] : [];
  }
  function childrenOf(node) { return [...node.childNodes].flatMap(convert); }
  const blocks = childrenOf(root);
  if (!descriptor.description) return blocks;
  const descriptionRoot = fragment(descriptor.description);
  const description = contents(descriptionRoot);
  const inlineText = (content) => content.map((item) => item.text ?? item.props?.labelSnapshot ?? inlineText(item.content || [])).join("");
  const normalizedText = (content) => inlineText(content).replace(/\s+/g, " ").trim();
  const descriptionText = normalizedText(description);
  // Convert the body first so adding header text never shifts its allocated IDs.
  // Header and body are distinct source positions; equal text/media can be intentional.
  const headerBlocks = descriptionText ? [block("paragraph", description)] : [];
  for (const node of descriptionRoot.querySelectorAll("img")) {
    const asset = resolveAsset?.(node.getAttribute("src"));
    const url = typeof asset === "string" ? asset : asset?.url;
    if (localMediaUrl(url)) headerBlocks.push(image(node));
  }
  blocks.unshift(...headerBlocks);
  return blocks;
}
