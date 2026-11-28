import { walkBlocks } from "./blockDocument.js";

const kinds = ["none", "page-cover", "page-content", "files-property"];

export function boardCardAppearance(config = {}) {
  if (!config || typeof config !== "object") config = {};
  const preview = config.preview || {};
  return {
    ...config,
    cardSize: ["small", "medium", "large"].includes(config.cardSize) ? config.cardSize : "medium",
    preview: { ...preview, kind: kinds.includes(preview.kind) ? preview.kind : "none", propertyId: preview.propertyId || null },
    imageFit: config.imageFit === "contain" ? "contain" : "cover",
  };
}

function blockText(content) {
  if (typeof content === "string") return content;
  return Array.isArray(content) ? content.map(entry => typeof entry === "string" ? entry : entry?.text || blockText(entry?.content)).join("") : "";
}

export function pageCardPreview(page, scanForMedia = false) {
  const content = Array.isArray(page?.content) ? page.content : [];
  const first = walkBlocks(content.slice(0, 1));
  const blocks = scanForMedia ? walkBlocks(content) : first;
  const media = blocks.find(block => ["image", "video"].includes(block.type) && typeof block.props?.url === "string" && block.props.url);
  return {
    kind: media?.type || "text",
    url: media?.props.url || null,
    name: media?.props.name || media?.props.caption || null,
    text: first.map(block => blockText(block.content)).filter(Boolean).join(" ").slice(0, 180),
  };
}
