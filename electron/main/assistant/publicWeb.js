import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { BlockList, isIP } from "node:net";
import { inspectImage } from "../ocr/images.js";
import { assistantError } from "./errors.js";

const userAgent = "LifeAtlas/1.0 (public web assistant; https://github.com/jamesmendax/life-atlas-public)";
const blocked = new BlockList();
for (const [address, bits] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.168.0.0", 16], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 3],
]) blocked.addSubnet(address, bits);
for (const [address, bits] of [["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["3fff::", 20]]) {
  blocked.addSubnet(address, bits, "ipv6");
}
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
const syntheticDns = new BlockList();
syntheticDns.addSubnet("198.18.0.0", 15);
const rasterTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const rasterAccept = [...rasterTypes].join(",");
const maxReadPageLength = 30000;
const officialLinkLabel = /\bofficial\s+(?:web\s*site|home\s*page|site|profile|(?:character\s+)?page)\b|官方(?:网站|網站|网页|網頁|主页|主頁|页面|頁面|资料|資料|简介|簡介|档案|檔案)|官网|官網|公式(?:ウェブサイト|ホームページ|サイト|プロフィール|ページ)/iu;
const invalidUrl = () => assistantError("E_INVALID_ARGUMENT", "请使用可公开访问的网页或图片网址。");

function addressAllowed(address, resolved = false) {
  const family = isIP(address);
  if (family === 4) return !blocked.check(address) && (resolved || !syntheticDns.check(address));
  return family === 6 && globalV6.check(address, "ipv6") && !blocked.check(address, "ipv6");
}

export function publicUrl(value) {
  let url;
  if (typeof value === "string" && value.length <= 2048 && /^https?:\/\//i.test(value) && !/[\x00-\x20\\]/.test(value)) {
    try { url = new URL(value); } catch {}
  }
  if (!url || url.username || url.password || url.port) throw invalidUrl();
  const hostname = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (isIP(hostname) ? !addressAllowed(hostname) : !hostname.includes(".") || /(?:^|\.)(?:localhost|local|internal|lan|home|localdomain|test|invalid|onion)$/i.test(hostname)) {
    throw invalidUrl();
  }
  url.hash = "";
  return url;
}

function readResponse(response, bytesLimit, resolve, reject) {
      const { statusCode, headers } = response;
      if (statusCode >= 300 && statusCode < 400 && headers.location) {
        response.destroy();
        resolve({ redirect: String(headers.location) });
        return;
      }
      if (statusCode < 200 || statusCode >= 300 || Number(headers["content-length"]) > bytesLimit) {
        response.destroy();
        reject(assistantError("E_IO", statusCode >= 200 && statusCode < 300 ? "网页或图片超过大小限制。" : "来源网站暂时无法读取。"));
        return;
      }
      const contentType = String(headers["content-type"] || "").split(";")[0].toLowerCase().trim();
      const chunks = [];
      let size = 0;
      response.on("data", (chunk) => {
        size += chunk.length;
        if (size <= bytesLimit) chunks.push(chunk);
        else response.destroy(assistantError("E_IO", "网页或图片超过大小限制。"));
      });
      response.on("error", reject);
      response.on("end", () => resolve({ bytes: Buffer.concat(chunks, size), contentType }));
}

function fetchOnce(url, addresses, { signal, bytesLimit, accept }) {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === "https:" ? https : http;
    const request = transport.get(url, {
      agent: false, signal,
      headers: { "User-Agent": userAgent, Accept: accept, "Accept-Encoding": "identity" },
      lookup: (_, options, callback) => {
        if (options.all) callback(null, addresses);
        else callback(null, addresses[0].address, addresses[0].family);
      },
    }, (response) => readResponse(response, bytesLimit, resolve, reject));
    request.on("error", reject);
  });
}

export function createSystemProxyTransport({ net, session }) {
  return {
    async usedBy(url) {
      const route = await session.resolveProxy(url.href);
      return /^(?:PROXY|HTTPS|SOCKS[45]?)\s+/i.test(route);
    },
    once(url, { signal, bytesLimit, accept }) {
      return new Promise((resolve, reject) => {
        signal.throwIfAborted();
        const request = net.request({
          url: url.href, session, credentials: "omit", redirect: "manual",
          headers: { "User-Agent": userAgent, Accept: accept },
        });
        const abort = () => { reject(signal.reason); request.abort(); };
        signal.addEventListener("abort", abort, { once: true });
        request.once("close", () => signal.removeEventListener("abort", abort));
        request.on("error", reject);
        request.on("redirect", (_status, _method, redirect) => {
          resolve({ redirect });
          request.abort();
        });
        request.on("response", (response) => readResponse(response, bytesLimit, resolve, reject));
        request.end();
      });
    },
  };
}

function bounded(promise, signal) {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

export async function requestPublicWeb(value, { bytesLimit = 2 * 1024 * 1024, accept = "*/*", signal: callerSignal, proxyTransport } = {}) {
  let url = publicUrl(value);
  const deadline = AbortSignal.timeout(10000);
  const signal = callerSignal ? AbortSignal.any([callerSignal, deadline]) : deadline;
  for (let redirects = 0; redirects <= 4; redirects += 1) {
    signal.throwIfAborted();
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    const addresses = await bounded(lookup(hostname, { all: true }), signal);
    if (!addresses.length || addresses.some(({ address }) => !addressAllowed(address, !isIP(hostname)))) throw invalidUrl();
    const options = { signal, bytesLimit, accept };
    const proxied = proxyTransport && await bounded(proxyTransport.usedBy(url), signal);
    const result = proxied ? await proxyTransport.once(url, options) : await fetchOnce(url, addresses, options);
    if (!result.redirect) return { ...result, url: url.href };
    url = publicUrl(new URL(result.redirect, url).href);
  }
  throw assistantError("E_IO", "来源网站的重定向次数过多。");
}

const entities = { amp: "&", apos: "'", quot: '"', lt: "<", gt: ">", nbsp: " ", ndash: "–", mdash: "—", hellip: "…" };
function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (match, key) => {
    if (key[0] !== "#") return entities[key.toLowerCase()] ?? match;
    const point = key[1].toLowerCase() === "x" ? parseInt(key.slice(2), 16) : Number(key.slice(1));
    return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : match;
  });
}

function cleanText(value, limit = 600) {
  return decodeEntities(String(value ?? "").replace(/<[^>]*>/g, " ")).replace(/\s+/gu, " ").trim().slice(0, limit);
}

function field(xml, tag) {
  const text = xml.match(new RegExp("<" + tag + "(?:\\s[^>]*)?>([\\s\\S]*?)</" + tag + ">", "i"))?.[1]?.trim() ?? "";
  return text.startsWith("<![CDATA[") && text.endsWith("]]>") ? text.slice(9, -3) : text;
}

function safeResultUrl(value) {
  try { return publicUrl(value).href; } catch { return null; }
}

function htmlAttributes(tag) {
  const attributes = new Map();
  for (const [, name, doubleQuoted, singleQuoted, unquoted] of tag.matchAll(/\s([^\s=<>/]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'`=<>]+))/g)) {
    const key = name.toLowerCase();
    if (!attributes.has(key)) attributes.set(key, decodeEntities(doubleQuoted ?? singleQuoted ?? unquoted));
  }
  return attributes;
}

function resolvePublicUrl(value, base) {
  if (!value || value.startsWith("#")) return null;
  try { return publicUrl(new URL(value, base).href).href; } catch { return null; }
}

function pageImageUrl(value, base) {
  const url = resolvePublicUrl(value, base);
  return url && !/\.(?:gif|svgz?|ico|avif|bmp|tiff?|jxl|pdf|html?)$/i.test(new URL(url).pathname) ? url : null;
}

function imageFilename(url) {
  let filename = new URL(url).pathname.split("/").pop() ?? "";
  try { filename = decodeURIComponent(filename); } catch {}
  filename = filename.split(/[\\/]/).pop().replace(/[\x00-\x1f\x7f]/g, "").trim().slice(0, 220);
  return filename || "网页图片";
}

function directImagePage({ url, bytes, contentType }) {
  const imageUrl = publicUrl(url).href;
  let size;
  try { size = inspectImage(bytes); }
  catch { throw assistantError("E_INVALID_ARGUMENT", "该网址没有返回可读取的 JPG、PNG 或 WebP 图片。"); }
  const filename = imageFilename(imageUrl);
  const image = { title: filename, filename, content_type: contentType, image_url: imageUrl, source_url: imageUrl,
    width: size.width, height: size.height };
  return { url: imageUrl, title: filename, text: "", images: [image] };
}

function positiveDimension(value) {
  const dimension = Number(value);
  return Number.isInteger(dimension) && dimension > 0 ? dimension : undefined;
}

function imageDimension(attributes, dimension) {
  const lazy = [...attributes].find(([name]) => name.startsWith("data-")
    && (name.endsWith(`-${dimension}`) || name.endsWith(`-r${dimension}`)))?.[1];
  return positiveDimension(attributes.get(dimension)) ?? positiveDimension(lazy);
}

function responsiveImageSource(attributes, base) {
  const srcset = attributes.get("data-srcset") || attributes.get("srcset") || "";
  const candidates = [...srcset.matchAll(/([^\s,]+)(?:\s+(\d+(?:\.\d+)?)(w|x))?(?:\s*,|$)/g)];
  const ranked = candidates.map(([, value, size, unit]) => ({
    url: pageImageUrl(value, base), size: unit === "x" ? Number(size) * 800 : Number(size) || 800,
  })).filter(({ url }) => url);
  return ranked.sort((a, b) => Math.abs(a.size - 1000) - Math.abs(b.size - 1000))[0]?.url;
}

function contentImages(content, head, pageUrl, pageTitle) {
  const images = new Map();
  const subject = pageTitle.toLowerCase();
  const add = (url, title, width, height, preview = false) => {
    if (!url || (width && width < 96) || (height && height < 96)) return;
    const image = { image_url: url, source_url: pageUrl, title, ...(width ? { width } : {}), ...(height ? { height } : {}) };
    const fitsTitle = title && subject.includes(title.toLowerCase());
    const size = width && height ? Math.min(width, height, 1200) / 1200 : 0;
    const score = (title ? 1 : 0) + (fitsTitle ? 1 : 0) + size + (preview ? 0 : 0.25);
    if (!images.has(url) || images.get(url).score < score) images.set(url, { image, score });
  };

  for (const [tag, picture] of content.matchAll(/<picture\b[^>]*>([\s\S]*?)<\/picture\s*>|<img\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi)) {
    const img = picture === undefined ? tag : picture.match(/<img\b(?:[^>"']|"[^"]*"|'[^']*')*>/i)?.[0] ?? "";
    const attrs = htmlAttributes(img);
    const source = ["data-src", "data-lazy-src", "data-original", "src"]
      .map((name) => pageImageUrl(attrs.get(name), pageUrl)).find(Boolean)
      || responsiveImageSource(attrs, pageUrl)
      || (picture ? [...picture.matchAll(/<source\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi)]
        .map(([entry]) => responsiveImageSource(htmlAttributes(entry), pageUrl)).find(Boolean) : null);
    add(source, cleanText(attrs.get("alt") || attrs.get("title"), 140), imageDimension(attrs, "width"), imageDimension(attrs, "height"));
  }

  const metadata = new Map();
  for (const [tag] of head.matchAll(/<meta\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi)) {
    const attrs = htmlAttributes(tag);
    const key = (attrs.get("property") || attrs.get("name"))?.toLowerCase();
    if (key && !metadata.has(key) && attrs.has("content")) metadata.set(key, attrs.get("content"));
  }
  const preview = pageImageUrl(metadata.get("og:image:secure_url") || metadata.get("og:image") || metadata.get("twitter:image"), pageUrl);
  const previewTitle = cleanText(metadata.get("og:image:alt") || metadata.get("twitter:image:alt") || pageTitle, 140);
  add(preview, previewTitle, positiveDimension(metadata.get("og:image:width")), positiveDimension(metadata.get("og:image:height")), true);
  return [...images.values()].sort((a, b) => b.score - a.score).slice(0, 6).map(({ image }) => image);
}

function contentLinks(content, pageUrl, limit = 60, include = () => true) {
  const links = new Map();
  for (const [, tag, body] of content.matchAll(/(<a\b(?:[^>"']|"[^"]*"|'[^']*')*>)([\s\S]*?)<\/a\s*>/gi)) {
    const attrs = htmlAttributes(tag);
    const url = resolvePublicUrl(attrs.get("href"), pageUrl);
    if (!url || url === pageUrl || links.has(url) || /(?:^|\s)sponsored(?:\s|$)/i.test(attrs.get("rel") ?? "")) continue;
    const img = body.match(/<img\b(?:[^>"']|"[^"]*"|'[^']*')*>/i)?.[0];
    const title = cleanText(body, 120) || cleanText(attrs.get("aria-label") || attrs.get("title") || (img && htmlAttributes(img).get("alt")), 120);
    if (!title || !include(title, url)) continue;
    links.set(url, { title, url });
    if (links.size >= limit) break;
  }
  return [...links.values()];
}

function officialLinks(content, pageUrl) {
  const hostname = (url) => new URL(url).hostname.replace(/^www\.|\.$/g, "");
  const originHost = hostname(pageUrl);
  return contentLinks(content, pageUrl, 6, (title, url) => officialLinkLabel.test(title) && hostname(url) !== originHost);
}

function navigationLinks(markup, pageUrl) {
  const nav = markup.match(/<nav\b[^>]*>[\s\S]*?<\/nav\s*>/gi) ?? [];
  const header = markup.match(/<header\b[^>]*>[\s\S]*?<\/header\s*>/gi) ?? [];
  return contentLinks([...nav, ...header].join(" "), pageUrl, 10);
}

function addPageItems(page, field, items, limit = maxReadPageLength) {
  const fieldLength = field.length + 6;
  let remaining = Math.min(limit, maxReadPageLength - JSON.stringify(page).length) - fieldLength;
  const included = [];
  for (const item of items) {
    remaining -= JSON.stringify(item).length + 1;
    if (remaining < 0) break;
    included.push(item);
  }
  if (included.length) page[field] = included;
}

function publicResult(title, value, snippet) {
  const url = safeResultUrl(value);
  return url ? { title: cleanText(title, 200), url, snippet: cleanText(snippet) } : null;
}

function wikipediaUrl(query) {
  const language = /\p{Script=Han}/u.test(query) ? "zh" : "en";
  const url = new URL("https://" + language + ".wikipedia.org/w/api.php");
  url.search = new URLSearchParams({ action: "query", list: "search", srsearch: query, srlimit: "6", format: "json" });
  return url;
}

export function normalizeSearchBaseUrl(input) {
  if (input == null || input === "") return "";
  const url = publicUrl(typeof input === "string" ? input.trim() : input);
  if (url.protocol !== "https:" || url.search || input.includes("#")) {
    throw assistantError("E_INVALID_ARGUMENT", "搜索服务地址须为公开 HTTPS 网址，可包含服务路径。");
  }
  return url.href.replace(/\/+$/, "");
}

export function createAssistantWeb({ request = requestPublicWeb } = {}) {
  async function searchSearXng(query, searchBaseUrl, category, signal) {
    const url = new URL(normalizeSearchBaseUrl(searchBaseUrl));
    url.pathname = url.pathname.replace(/(?:\/search)?\/?$/, "/search");
    url.search = new URLSearchParams({ q: query, format: "json", categories: category, language: "all", safesearch: "1" });
    const { bytes } = await request(url.href, { signal, accept: "application/json" });
    const items = JSON.parse(bytes.toString("utf8")).results;
    if (!Array.isArray(items)) throw assistantError("E_IO", "搜索服务需要启用 JSON 结果。");
    return items.slice(0, 12);
  }

  async function searchWeb(query, searchBaseUrl, signal) {
    if (searchBaseUrl) {
      const items = await searchSearXng(query, searchBaseUrl, "general", signal);
      return items.slice(0, 8).map((item) => publicResult(item.title, item.url, item.content)).filter(Boolean);
    }
    const wiki = wikipediaUrl(query);
    const locale = wiki.hostname.startsWith("zh.") ? "zh-CN" : "en-US";
    const words = [...new Intl.Segmenter(locale, { granularity: "word" }).segment(query.toLowerCase())]
      .filter((part) => part.isWordLike && part.segment.length > 2 && !/^(the|and|for|from|with|about|what|how|最新的)$/.test(part.segment))
      .map((part) => part.segment);
    const bing = new URL("https://www.bing.com/search");
    bing.search = new URLSearchParams({ q: query, format: "rss", adlt: "moderate", setlang: locale, mkt: locale });
    const [web, encyclopedia] = await Promise.allSettled([
      request(bing.href, { signal, accept: "application/rss+xml, application/xml, text/xml" }).then(({ bytes }) =>
        [...bytes.toString("utf8").matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, item]) =>
          publicResult(field(item, "title"), decodeEntities(field(item, "link")), field(item, "description"))).filter(Boolean)),
      request(wiki.href, { signal, accept: "application/json" }).then(({ bytes }) =>
        (JSON.parse(bytes.toString("utf8"))?.query?.search ?? []).map((item) =>
          publicResult(item.title, new URL("/?curid=" + Number(item.pageid), wiki).href, item.snippet)).filter(Boolean)),
    ]);
    signal?.throwIfAborted();
    if (web.status === "rejected" && encyclopedia.status === "rejected") throw web.reason;
    const matchedWeb = (web.value ?? []).filter(({ title, snippet, url }) => {
      const text = (title + " " + snippet + " " + url).toLowerCase();
      return words.filter((word) => text.includes(word)).length >= Math.min(2, words.length);
    });
    return [...matchedWeb, ...(encyclopedia.value ?? [])].slice(0, 8);
  }

  async function searchImages(query, searchBaseUrl, signal) {
    if (searchBaseUrl) {
      const items = await searchSearXng(query, searchBaseUrl, "images", signal);
      return items.flatMap((item) => {
        const imageUrl = safeResultUrl(item.img_src);
        const sourceUrl = safeResultUrl(item.url);
        return imageUrl && sourceUrl ? [{
          title: cleanText(item.title, 200), image_url: imageUrl, source_url: sourceUrl, description: cleanText(item.content),
        }] : [];
      }).slice(0, 8);
    }
    const url = new URL("https://commons.wikimedia.org/w/api.php");
    url.search = new URLSearchParams({
      action: "query", format: "json", formatversion: "2", generator: "search", gsrnamespace: "6", gsrsearch: query,
      gsrlimit: "12", prop: "imageinfo", iiprop: "url|mime|extmetadata", iiurlwidth: "1280",
      iiextmetadatafilter: "LicenseShortName|LicenseUrl|Artist|ImageDescription",
    });
    const { bytes } = await request(url.href, { signal, accept: "application/json" });
    const pages = JSON.parse(bytes.toString("utf8"))?.query?.pages ?? [];
    return pages.sort((a, b) => a.index - b.index).flatMap((page) => {
      const info = page.imageinfo?.[0];
      const imageUrl = safeResultUrl(info?.thumburl || info?.url);
      const sourceUrl = safeResultUrl(info?.descriptionurl);
      if (!imageUrl || !sourceUrl || !rasterTypes.has(info.mime)) return [];
      return [{
        title: cleanText(String(page.title).replace(/^File:/, ""), 200), image_url: imageUrl, source_url: sourceUrl,
        license: cleanText(info.extmetadata?.LicenseShortName?.value, 80),
        license_url: safeResultUrl(info.extmetadata?.LicenseUrl?.value),
        author: cleanText(info.extmetadata?.Artist?.value, 160),
        description: cleanText(info.extmetadata?.ImageDescription?.value),
      }];
    }).slice(0, 8);
  }

  async function readPage(url, signal) {
    const response = await request(url, { signal, accept: `text/html,text/plain,application/xhtml+xml,${rasterAccept}` });
    if (rasterTypes.has(response.contentType)) return directImagePage(response);
    if (!["text/html", "application/xhtml+xml", "text/plain"].includes(response.contentType)) {
      throw assistantError("E_INVALID_ARGUMENT", "该网址没有返回可读取的网页文本。");
    }
    const raw = response.bytes.toString("utf8");
    const visible = raw.replace(/<!--[\s\S]*?-->/g, " ").replace(/<(script|style|noscript|svg|footer|aside)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ");
    const stripped = visible.replace(/<(nav|header)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ");
    const content = stripped.match(/<main\b[^>]*>([\s\S]*?)<\/main\s*>/i)?.[1]
      ?? stripped.match(/<body\b[^>]*>([\s\S]*?)<\/body\s*>/i)?.[1] ?? stripped;
    const text = response.contentType === "text/plain" ? raw.slice(0, 12000) : cleanText(content, 12000);
    const title = cleanText(field(raw, "title"), 200);
    const page = { url: response.url, title, text: "" };
    const textBudget = Math.max(0, maxReadPageLength - JSON.stringify(page).length);
    page.text = text;
    for (let length = JSON.stringify(page.text).length - 2; length > textBudget; length = JSON.stringify(page.text).length - 2) {
      page.text = page.text.slice(0, Math.floor(page.text.length * textBudget / length));
    }
    if (response.contentType !== "text/plain") {
      const head = stripped.match(/<head\b[^>]*>([\s\S]*?)<\/head\s*>/i)?.[1] ?? "";
      addPageItems(page, "official_links", officialLinks(content, response.url), 2500);
      addPageItems(page, "images", contentImages(content, head, response.url, title));
      addPageItems(page, "links", contentLinks(content, response.url), 8000);
      addPageItems(page, "navigation_links", navigationLinks(visible, response.url));
    }
    if (!page.text.trim() && !page.images && !page.links && !page.official_links && !page.navigation_links) {
      throw assistantError("E_NOT_FOUND", "这个网址没有可读取的正文。");
    }
    return page;
  }

  return {
    async run(name, args, { searchBaseUrl = "", signal } = {}) {
      if (name === "read_web_page") return readPage(args?.url, signal);
      const query = typeof args?.query === "string" ? args.query.trim() : "";
      if (!query || query.length > 240 || /[\x00-\x1f\x7f]/.test(query)) throw assistantError("E_INVALID_ARGUMENT", "请输入 1–240 字的公开搜索关键词。");
      if (name === "search_web") return { results: await searchWeb(query, searchBaseUrl, signal) };
      if (name === "search_images") return { results: await searchImages(query, searchBaseUrl, signal) };
      throw assistantError("E_INVALID_ARGUMENT", "未知的联网工具。");
    },
    async readImage(url, signal) {
      const photo = await request(url, { signal, bytesLimit: 16 * 1024 * 1024, accept: rasterAccept });
      if (!rasterTypes.has(photo.contentType)) throw assistantError("E_INVALID_ARGUMENT", "请使用公开的 JPG、PNG 或 WebP 图片链接。");
      return { ...photo, name: imageFilename(photo.url) };
    },
  };
}
