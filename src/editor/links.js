const ALLOWED_SCHEMES = /^(?:https?|ftps?|mailto|tel|callto|sms|cid|xmpp):/i;
const ANY_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const BLOCK_LINK = /^lifeatlas:\/\/page\/([A-Za-z0-9_-]{1,200})(?:#block-([A-Za-z0-9_-]{1,200}))?$/;

export function isAllowedEditorLink(href) {
  const value = String(href ?? "").trim();
  if (BLOCK_LINK.test(value)) return true;
  return ALLOWED_SCHEMES.test(value) || !ANY_SCHEME.test(value);
}

export function parseBlockLink(href) {
  const match = BLOCK_LINK.exec(String(href ?? "").trim());
  return match ? { pageId: match[1], blockId: match[2] || null } : null;
}
