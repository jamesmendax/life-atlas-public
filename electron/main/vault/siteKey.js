import { isIP } from "node:net";

const TWO_PART_SUFFIXES = new Set([
  "com.cn", "net.cn", "org.cn", "gov.cn", "edu.cn", "co.uk", "org.uk", "ac.uk", "co.jp", "ne.jp", "or.jp",
  "com.au", "com.hk", "com.tw", "com.sg", "co.kr", "com.br",
]);

const TENANT_HOSTS = [
  "github.io", "vercel.app", "pages.dev", "netlify.app", "workers.dev", "web.app", "firebaseapp.com", "appspot.com",
  "herokuapp.com", "fly.dev", "railway.app", "render.com", "onrender.com", "amazonaws.com", "cloudfront.net",
  "azurewebsites.net", "aliyuncs.com", "myqcloud.com", "gitee.io", "notion.site",
];

function parseHttpUrl(value) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value.trim());
    return ["http:", "https:"].includes(url.protocol) && siteHostname(url) ? url : null;
  } catch {
    return null;
  }
}

export function parseSiteUrl(value) {
  const url = parseHttpUrl(value);
  return url && !url.username && !url.password ? url : null;
}

function siteHostname(url) {
  return url.hostname.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
}

function fullHost(url, hostname = siteHostname(url)) {
  return url.port ? `${hostname}:${url.port}` : hostname;
}

function groupingKey(url) {
  const hostname = siteHostname(url);
  const address = hostname.startsWith("[") ? hostname.slice(1, -1) : hostname;
  if (url.port || isIP(address) || hostname === "localhost" || hostname.endsWith(".localhost") ||
      TENANT_HOSTS.some((suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`))) {
    return fullHost(url, hostname);
  }
  const labels = hostname.split(".");
  const suffix = labels.slice(-2).join(".");
  return labels.slice(TWO_PART_SUFFIXES.has(suffix) ? -3 : -2).join(".");
}

export function normalizeSiteIdentity({ url, website, title }) {
  const parsed = parseSiteUrl(url);
  const displayUrl = parseHttpUrl(website);
  const websiteName = typeof website === "string" && !displayUrl?.username && !displayUrl?.password ? website.trim() : "";
  const titleName = typeof title === "string" ? title.trim() : "";
  if (parsed) {
    const siteKey = groupingKey(parsed);
    return { name: websiteName || titleName || siteKey, url: parsed.href, siteKey };
  }
  return websiteName ? { name: websiteName, url: "", siteKey: `site:${websiteName.toLowerCase()}` } : null;
}

export function normalizeDedupeScope({ url, title, siteKey }) {
  const parsed = parseSiteUrl(url);
  return parsed ? fullHost(parsed) : siteKey || title?.trim().toLowerCase() || "";
}

export function normalizeAccount(value) {
  const account = String(value ?? "").trim();
  return account.includes("@") ? account.toLowerCase() : account;
}

export function credentialSecretSignature(fields) {
  const values = fields.filter(({ kind, value }) => kind === "secret" && value !== "").map(({ value }) => value);
  if (values.length === 0) return null;
  return values.length === 1 ? values[0] : JSON.stringify(values);
}
