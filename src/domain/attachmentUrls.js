import { attachmentIdFromUrl } from "./attachments.js";

export function assetHashFromUrl(url) {
  return typeof url === "string" ? /^life-asset:\/\/([a-f0-9]{64})\/?(?:#.*)?$/.exec(url)?.[1] || null : null;
}

export function attachmentForUrl(url, attachments = []) {
  const id = attachmentIdFromUrl(url);
  if (id) return attachments.find((attachment) => attachment.id === id) || null;
  const hash = assetHashFromUrl(url);
  if (!hash) return null;
  return attachments.find((attachment) => attachment.checksum === hash || (attachment.provider === "asset" && attachment.storageKey === hash)) || null;
}

export async function resolveAttachmentMediaUrl(url, runtime) {
  if (!url) return url;
  const attachment = attachmentForUrl(url, runtime?.workspace?.attachments);
  const attachmentId = attachmentIdFromUrl(url) || attachment?.id;
  if (attachmentId) {
    const resolved = await runtime?.resolveEditorAttachmentUrl?.(attachmentId);
    if (!resolved) throw new Error("附件文件在本机不可用");
    return resolved;
  }
  if (assetHashFromUrl(url) && runtime?.platform === "desktop") return url;
  if (/^(?:blob|life-asset):/i.test(url)) throw new Error("附件文件在本机不可用");
  if (/^(?:https?|wss?|file|ftp):/i.test(url) || /^\/\//.test(url)) throw new Error("离线模式不加载远程附件");
  return url;
}
