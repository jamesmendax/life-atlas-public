import {
  dataSourceById,
  databaseItemPage,
  projectViewItems,
  resolvePropertyValue,
} from "./database.js";
import { formatPropertyValue } from "./databaseProperties.js";

function parseJson(value, fallback) {
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function propertyById(source, id, fallbackType = null) {
  if (id) {
    const exact = (source?.properties || []).find((property) => property.id === id);
    if (exact) return exact;
  }
  return fallbackType
    ? (source?.properties || []).find((property) => property.type === fallbackType) || null
    : null;
}

function attachmentUrl(workspace, value) {
  const ids = Array.isArray(value) ? value : value ? [value] : [];
  for (const id of ids) {
    const attachment = (workspace?.attachments || []).find((entry) => entry.id === id);
    if (attachment?.externalUrl) return attachment.externalUrl;
    if (attachment?.provider === "external" && attachment?.storageKey) return attachment.storageKey;
  }
  return "";
}

function plainValue(workspace, source, item, property) {
  if (!property) return "";
  const raw = resolvePropertyValue(workspace, source, item, property);
  return formatPropertyValue(workspace, property, raw);
}

export function normalizeEditorialSectionConfig(config = {}) {
  const limit = Math.max(1, Math.min(12, Number(config.limit) || 3));
  return {
    sourceId: String(config.sourceId || ""),
    layout: ["cards-2", "cards-3", "media-left"].includes(config.layout) ? config.layout : "cards-3",
    filter: typeof config.filter === "string" ? parseJson(config.filter, null) : config.filter || null,
    sorts: typeof config.sorts === "string" ? parseJson(config.sorts, []) : Array.isArray(config.sorts) ? config.sorts : [],
    limit,
    titlePropertyId: String(config.titlePropertyId || ""),
    eyebrowPropertyId: String(config.eyebrowPropertyId || ""),
    excerptPropertyId: String(config.excerptPropertyId || ""),
    imagePropertyId: String(config.imagePropertyId || ""),
  };
}

export function projectEditorialSection(workspace, config = {}) {
  const normalized = normalizeEditorialSectionConfig(config);
  const source = dataSourceById(workspace, normalized.sourceId);
  if (!source) return { source: null, cards: [], config: normalized };

  const projection = {
    sourceId: source.id,
    filter: normalized.filter,
    sorts: normalized.sorts,
  };
  const titleProperty = propertyById(source, normalized.titlePropertyId, "title");
  const eyebrowProperty = propertyById(source, normalized.eyebrowPropertyId);
  const excerptProperty = propertyById(source, normalized.excerptPropertyId, "text");
  const imageProperty = propertyById(source, normalized.imagePropertyId);

  const cards = projectViewItems(workspace, projection).slice(0, normalized.limit).map((item) => {
    const page = databaseItemPage(workspace, item);
    let imageUrl = "";
    if (imageProperty) {
      const raw = resolvePropertyValue(workspace, source, item, imageProperty);
      if (imageProperty.type === "files") imageUrl = attachmentUrl(workspace, raw);
      else imageUrl = String(raw || "");
    }
    return {
      itemId: item.id,
      pageId: item.pageId || page?.id || "",
      title: plainValue(workspace, source, item, titleProperty) || page?.title || "无标题",
      eyebrow: plainValue(workspace, source, item, eyebrowProperty),
      excerpt: plainValue(workspace, source, item, excerptProperty) || page?.summary || "",
      imageUrl,
    };
  });

  return { source, cards, config: normalized };
}
