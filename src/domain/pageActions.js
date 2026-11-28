export const defaultPageSettings = Object.freeze({
  fontFamily: "default",
  smallText: false,
  fullWidth: false,
  presentationMode: "default",
  locked: false,
});

const FONT_FAMILIES = new Set(["default", "serif", "mono"]);
const PRESENTATION_MODES = new Set(["default", "full", "focus"]);

export function normalizePageSettings(value) {
  const source = value && typeof value === "object" ? value : {};
  const presentationMode = PRESENTATION_MODES.has(source.presentationMode)
    ? source.presentationMode
    : source.fullWidth
      ? "full"
      : "default";
  return {
    fontFamily: FONT_FAMILIES.has(source.fontFamily) ? source.fontFamily : "default",
    smallText: Boolean(source.smallText),
    fullWidth: presentationMode !== "default",
    presentationMode,
    locked: Boolean(source.locked),
  };
}

export function duplicatePage(page, { id, now = new Date().toISOString(), sortIndex }) {
  return {
    ...JSON.parse(JSON.stringify(page)),
    id,
    title: `${page.title || "无标题页面"} 副本`,
    sortIndex,
    createdAt: now,
    updatedAt: now,
    trashedAt: null,
    settings: normalizePageSettings(page.settings),
  };
}

export function movePage(page, { folderId, sortIndex, now = new Date().toISOString() }) {
  return {
    ...page,
    folderId,
    sortIndex,
    updatedAt: now,
  };
}

export function movePageToTrash(page, now = new Date().toISOString()) {
  return {
    ...page,
    trashedAt: now,
    updatedAt: now,
  };
}

export const TRASH_RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export function restorePageFromTrash(page, { now = new Date().toISOString(), folderId } = {}) {
  return {
    ...page,
    folderId: folderId ?? page.folderId,
    trashedAt: null,
    updatedAt: now,
  };
}

export function trashExpiresAt(page, retentionDays = TRASH_RETENTION_DAYS) {
  const trashedAt = Date.parse(page?.trashedAt || "");
  if (!Number.isFinite(trashedAt)) return null;
  return new Date(trashedAt + retentionDays * DAY_MS).toISOString();
}

export function trashDaysRemaining(page, now = Date.now(), retentionDays = TRASH_RETENTION_DAYS) {
  const trashedAt = Date.parse(page?.trashedAt || "");
  if (!Number.isFinite(trashedAt)) return retentionDays;
  const nowMs = now instanceof Date ? now.getTime() : typeof now === "string" ? Date.parse(now) : Number(now);
  const expiresMs = trashedAt + retentionDays * DAY_MS;
  return Math.max(0, Math.ceil((expiresMs - nowMs) / DAY_MS));
}

export function isTrashExpired(page, now = Date.now(), retentionDays = TRASH_RETENTION_DAYS) {
  if (!page?.trashedAt) return false;
  return trashDaysRemaining(page, now, retentionDays) <= 0;
}

export function purgeExpiredTrash(pages, now = Date.now(), retentionDays = TRASH_RETENTION_DAYS) {
  return (Array.isArray(pages) ? pages : []).filter((page) => !isTrashExpired(page, now, retentionDays));
}

export function createPageExport(page) {
  return {
    kind: "life-atlas-page",
    version: 1,
    exportedAt: new Date().toISOString(),
    page: {
      title: page.title || "无标题页面",
      icon: page.icon || "📄",
      iconColor: page.iconColor || null,
      cover: page.cover ?? null,
      settings: normalizePageSettings(page.settings),
      content: Array.isArray(page.content) ? page.content : [],
    },
  };
}

function textLineToBlock(line) {
  const heading = line.match(/^(#{1,3})\s+(.+)$/);
  if (heading) {
    return {
      type: "heading",
      props: { level: heading[1].length },
      content: heading[2],
    };
  }
  return { type: "paragraph", content: line };
}

export function parsePageImport(text, fileName = "") {
  const normalizedName = String(fileName).toLocaleLowerCase();
  if (normalizedName.endsWith(".json")) {
    const parsed = JSON.parse(text);
    const source = parsed?.kind === "life-atlas-page" ? parsed.page : parsed?.page ?? parsed;
    if (!source || !Array.isArray(source.content)) {
      throw new Error("JSON 中没有可导入的 Life Atlas 页面内容");
    }
    return {
      bundle: parsed?.kind === "life-atlas-page" && parsed.related ? parsed : undefined,
      title: typeof source.title === "string" && source.title.trim() ? source.title.trim() : undefined,
      icon: typeof source.icon === "string" ? source.icon : undefined,
      iconColor: typeof source.iconColor === "string" ? source.iconColor : undefined,
      cover: source.cover ?? undefined,
      settings: normalizePageSettings(source.settings),
      content: source.content,
    };
  }

  if (normalizedName.endsWith(".md") || normalizedName.endsWith(".markdown") || normalizedName.endsWith(".txt")) {
    const lines = String(text).replace(/\r\n/g, "\n").split("\n");
    const content = lines.map(textLineToBlock);
    return {
      title: undefined,
      settings: undefined,
      content: content.length ? content : [{ type: "paragraph", content: "" }],
    };
  }

  throw new Error("仅支持 .json、.md、.markdown 或 .txt 文件");
}

export function safeExportFileName(title) {
  const cleaned = String(title || "untitled")
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
    .replace(/\s+/g, " ")
    .slice(0, 80);
  return cleaned || "untitled";
}
