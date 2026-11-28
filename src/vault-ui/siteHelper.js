import { format as i18nFormat, getActiveLocale, tVault } from "../i18n/vaultTranslator.js";

const TWO_PART_SUFFIXES = new Set([
  "com.cn", "net.cn", "org.cn", "gov.cn", "edu.cn", "co.uk", "org.uk", "ac.uk", "co.jp", "ne.jp", "or.jp",
  "com.au", "com.hk", "com.tw", "com.sg", "co.kr", "com.br",
]);

const TENANT_HOSTS = [
  "github.io", "vercel.app", "pages.dev", "netlify.app", "workers.dev", "web.app", "firebaseapp.com", "appspot.com",
  "herokuapp.com", "fly.dev", "railway.app", "render.com", "onrender.com", "amazonaws.com", "cloudfront.net",
  "azurewebsites.net", "aliyuncs.com", "myqcloud.com", "gitee.io", "notion.site",
];

function isIpAddress(host) {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.includes(":");
}

export function buildSiteObject({ name, url }) {
  const cleanName = String(name ?? "").trim();
  const cleanUrl = String(url ?? "").trim();
  if (cleanUrl) {
    let parsed;
    try { parsed = new URL(cleanUrl); } catch { return { error: tVault("vault.err.invalidUrl") }; }
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
      return { error: tVault("vault.err.httpOnly") };
    }
    const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
    const bare = hostname.startsWith("[") ? hostname.slice(1, -1) : hostname;
    let siteKey;
    if (parsed.port || isIpAddress(bare) || hostname === "localhost" || hostname.endsWith(".localhost") ||
      TENANT_HOSTS.some((suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`))) {
      siteKey = parsed.port ? `${hostname}:${parsed.port}` : hostname;
    } else {
      const labels = hostname.split(".");
      const suffix = labels.slice(-2).join(".");
      siteKey = labels.slice(TWO_PART_SUFFIXES.has(suffix) ? -3 : -2).join(".");
    }
    return { site: { name: cleanName || siteKey, url: parsed.href, siteKey } };
  }
  if (cleanName) {
    return { site: { name: cleanName, url: "", siteKey: `site:${cleanName.toLowerCase()}` } };
  }
  return { site: null };
}

export function displayDomain(url, fallback = "") {
  if (!url) return fallback;
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, "") + (parsed.port ? `:${parsed.port}` : "");
  } catch {
    return fallback || url;
  }
}

export function findMergeableSiteGroups(summaries) {
  const active = summaries.filter((entry) => !entry.deletedAt && entry.siteKey);
  const byKey = new Map();
  for (const entry of active) {
    const list = byKey.get(entry.siteKey) ?? [];
    list.push(entry);
    byKey.set(entry.siteKey, list);
  }
  const groups = [];
  for (const [siteKey, items] of byKey.entries()) {
    if (items.length < 2) continue;
    const sorted = [...items].sort((first, second) =>
      (second.credentialCount || 1) - (first.credentialCount || 1) || second.updatedAt.localeCompare(first.updatedAt)
    );
    const preferredName = !siteKey.startsWith("site:")
      ? (displayDomain(sorted[0].siteUrl, siteKey) || siteKey)
      : (sorted[0].siteName || sorted[0].title);
    groups.push({
      siteKey,
      siteName: preferredName,
      target: sorted[0],
      sources: sorted.slice(1),
      items: sorted,
      totalCredentials: sorted.reduce((sum, entry) => sum + (entry.credentialCount || 1), 0),
    });
  }
  return groups.sort((first, second) => second.items.length - first.items.length || first.siteName.localeCompare(second.siteName, "zh-CN"));
}

export const TYPE_TAG_TONE = Object.freeze({
  login: "default",
  apiKey: "blue",
  server: "green",
  database: "green",
  secureNote: "purple",
  recoveryCodes: "purple",
  custom: "default",
});

export function formatShortDate(iso, locale = getActiveLocale()) {
  if (!iso) return "";
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return "";
  return i18nFormat.formatDate(time, locale);
}

export function daysUntilExpiry(expiresAt, todayIso) {
  if (!expiresAt) return null;
  const target = Date.parse(expiresAt.slice(0, 10));
  const today = Date.parse(todayIso);
  if (!Number.isFinite(target) || !Number.isFinite(today)) return null;
  return Math.round((target - today) / 86400000);
}
