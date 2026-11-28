import { blockContext } from "../domain/blockDocument.js";
import { extendedMarkdownInline, markdownTableContent, safeMarkdownHref } from "../domain/markdownBlocks.js";
import { checkAuthoringBlockLimit, markdownDocument, toolError } from "./workspaceToolSupport.js";

const managedUrl = /^life-asset:\/\/[0-9a-f]{64}\/?$/;
const mediaBlockUrl = /^block:([^\s\u0000]{1,200})$/u;
const mediaTypes = new Set(["image", "video", "file"]);
const shape = {
  markdown: ["markdown"],
  table: ["rows", "header"],
  callout: ["markdown", "icon", "tone"],
  columns: ["columns"],
  section: ["heading", "level", "markdown"],
  image: ["url", "name", "caption"],
  video: ["url", "name", "caption"],
  file: ["url", "name", "caption"],
};

function webImageUrl(value) {
  const href = safeMarkdownHref(value);
  return href && /^https?:\/\//i.test(href) ? href : null;
}

export function reusableMediaReference(block) {
  if (!mediaTypes.has(block?.type) || !managedUrl.test(block.props?.url) || typeof block.id !== "string") return null;
  const reference = "block:" + block.id;
  return mediaBlockUrl.test(reference) ? reference : null;
}

export function collectPageImageUrls(args) {
  const urls = new Set();
  const collect = (source, kind) => {
    const url = webImageUrl(source?.trim());
    if (kind === "image" && url) urls.add(url);
    else if (!managedUrl.test(source?.trim()) && !mediaBlockUrl.test(source?.trim())) toolError("请选择已导入的素材。");
    return { url: source };
  };
  if (args.cover_url) collect(args.cover_url, "image");
  buildBodyDocument(args, () => "", collect);
  return [...urls];
}

export function assistantMediaAsset(source, kind, { mediaByUrl, attachments, page }) {
  const url = source?.trim();
  const blockId = mediaBlockUrl.exec(url)?.[1];
  const block = blockId ? blockContext(page?.content, blockId)?.block : null;
  let asset = blockId
    ? reusableMediaReference(block) && { url: block.props.url, name: block.props.name, kind: block.type }
    : mediaByUrl?.get(url);
  if (!asset && managedUrl.test(url)) {
    const selected = attachments?.find((entry) => entry.assetUrl === url);
    asset = selected ? { url, name: selected.name, mime: selected.mimeType, kind: selected.kind }
      : [...(mediaByUrl?.values() ?? [])].find((entry) => entry.url === url);
  }
  const mime = asset?.mime ?? asset?.mimeType;
  const assetKind = mime && mime !== "application/octet-stream" ? mime.split("/")[0] : asset?.kind;
  if (!asset || !managedUrl.test(asset.url) || (kind !== "file" && assetKind && assetKind !== kind)) {
    toolError(kind === "image" ? "图片素材还未导入为可用的本地附件。" : "请选择已导入的对应本地附件。");
  }
  return asset;
}

export function assistantBodyDocument(args, context) {
  return buildBodyDocument(args, context.idFactory, (url, kind) => assistantMediaAsset(url, kind, context));
}

function buildBodyDocument(args, idFactory, resolveMedia) {
  if (args.markdown !== undefined && args.blocks !== undefined) toolError("正文只能使用 Markdown 或结构化区块中的一种。");
  const parse = (markdown) => markdownDocument(markdown, idFactory, {
    resolveImage: (url) => ({ ...resolveMedia(url, "image"), kind: "image" }),
  });
  const block = (type, props = {}, content = undefined, children = []) => ({
    id: idFactory("block"), type, props, ...(content === undefined ? {} : { content }), children,
  });
  const parseBlocks = (specs) => specs.flatMap((spec) => {
    if (Object.keys(spec).some((field) => field !== "type" && !shape[spec.type].includes(field))) {
      toolError("结构化区块包含该类型不支持的字段。");
    }
    if (spec.type === "markdown") {
      if (spec.markdown === undefined) toolError("请为 Markdown 区块提供正文。");
      return parse(spec.markdown);
    }
    if (spec.type === "table") {
      if (!spec.rows?.length) toolError("请为表格提供行和单元格。");
      return [block("table", {}, markdownTableContent(spec.rows, { headerRows: spec.header === false ? 0 : 1, preserveLinks: true }))];
    }
    if (spec.type === "callout") {
      if (!spec.markdown?.trim()) toolError("请为提示框提供正文。");
      const body = parse(spec.markdown);
      const leading = body[0]?.type === "paragraph" ? body.shift() : null;
      return [block("callout", { icon: spec.icon?.trim() ?? "💡", tone: spec.tone ?? "neutral" }, leading?.content ?? [], body)];
    }
    if (spec.type === "section") {
      if (!spec.heading?.trim()) toolError("请为小节提供标题。");
      const heading = extendedMarkdownInline(spec.heading.trim().replace(/\s*\n\s*/g, " "), { preserveLinks: true });
      return [block("heading", { level: spec.level ?? 2 }, heading), ...parse(spec.markdown ?? "")];
    }
    if (spec.type === "columns") {
      if (!spec.columns) toolError("请为分栏提供 2 到 5 栏正文。");
      const count = spec.columns.length;
      const columns = spec.columns.map((specs, index) => {
        const children = parseBlocks(specs);
        return block("column", { width: 100 / count, index, count }, undefined, children.length ? children : [block("paragraph", {}, [])]);
      });
      return [block("columnList", { columns: count }, undefined, columns)];
    }
    if (mediaTypes.has(spec.type)) {
      if (!spec.url) toolError("请指定已导入的素材。");
      const asset = resolveMedia(spec.url, spec.type);
      return [block(spec.type, { url: asset.url, name: spec.name?.trim() || asset.name || "", caption: spec.caption?.trim() || "" })];
    }
    return [];
  });
  if (!args.blocks) return parse(args.markdown ?? "");
  return checkAuthoringBlockLimit(parseBlocks(args.blocks));
}
