export function isRemoteUrl(url) {
  return /^https?:\/\//i.test(String(url ?? "").trim());
}

export function remotePlaceholderDataUrl(url) {
  let host = "未知地址";
  try { host = new URL(url).host || host; } catch {}
  const safeHost = host.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="200" viewBox="0 0 640 200"><rect x="1" y="1" width="638" height="198" rx="6" fill="none" stroke="#8b8d93" stroke-width="1.5" stroke-dasharray="6 5"/><text x="320" y="92" text-anchor="middle" font-family="sans-serif" font-size="22" fill="#8b8d93">外部内容（未加载）</text><text x="320" y="128" text-anchor="middle" font-family="sans-serif" font-size="16" fill="#8b8d93">${safeHost}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export async function resolveEditorFileUrl(url) {
  return isRemoteUrl(url) ? remotePlaceholderDataUrl(url) : url;
}
