import { setTimeout as delay } from "node:timers/promises";
import { databaseTileSource } from "../databaseTileSource.js";
import { boundedBytes } from "../boundedResponse.js";
import { fail, ok } from "./result.js";
import { isPlainObject, isTrustedSender } from "./validate.js";

const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const requestIdValid = value => typeof value === "string" && /^[\w.:-]{1,96}$/u.test(value);
const cancelled = () => fail("E_CANCELLED", "已取消地图瓦片");
const unavailable = () => fail("E_NOT_FOUND", "此处没有该图层的影像");
const tileKeys = new Set(["layer", "z", "x", "y", "requestId"]);
class TemporaryGatewayError extends Error {}

function isTransientTransfer(error) {
  return error instanceof TemporaryGatewayError || error?.name === "TimeoutError" || error?.name === "AbortError"
    || /net::ERR_(CONNECTION_(?:RESET|CLOSED|TIMED_OUT)|ABORTED|TIMED_OUT|NETWORK_CHANGED|HTTP2_PROTOCOL_ERROR|INCOMPLETE_CHUNKED_ENCODING)\b/u.test(error?.message)
    || (error instanceof TypeError && /fetch failed|failed to fetch|terminated|network error/iu.test(error.message));
}

function imageMatches(bytes, type) {
  if (type === "image/jpeg") return bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  return bytes.length >= 33 && bytes.subarray(0, 8).equals(pngSignature)
    && bytes.toString("ascii", 12, 16) === "IHDR" && bytes.readUInt32BE(16) === 256 && bytes.readUInt32BE(20) === 256;
}

export function registerDatabaseMapTiles({ ipcMain, getWindow, fetchTile, isEmptySatelliteTile, appVersion, now = Date.now }) {
  const jobs = new Map(), subscribers = new Map(), queued = new Set(), cooldown = new Map();
  let active = 0;
  const userAgent = databaseTileAgent(appVersion);
  const senderKey = (event, id) => event.sender.id + "|" + id;
  async function load(job) {
    const { provider, type, url } = job.source;
    const remaining = (cooldown.get(provider) || 0) - now();
    if (remaining > 0) return fail("E_THROTTLED", "地图服务正在限流", { retryAfterMs: remaining });
    const response = await fetchTile(url, { method: "GET", headers: { "User-Agent": userAgent, Accept: type },
      credentials: "omit", redirect: "error", referrerPolicy: "no-referrer", cache: "default",
      signal: AbortSignal.any([job.controller.signal, AbortSignal.timeout(20000)]) });
    if (!response.ok || response.status === 204 || response.headers.get("content-type")?.split(";")[0].toLowerCase() !== type) {
      await response.body?.cancel().catch(() => {});
      if ([204, 404, 410].includes(response.status)) return unavailable();
      const retry = response.headers.get("retry-after");
      if (response.status === 429 || response.status === 503 || (!response.ok && retry)) {
        const retryMs = retry && /^\d+$/u.test(retry) ? Number(retry) * 1000 : (Date.parse(retry) || 0) - now();
        const until = Math.max(cooldown.get(provider) || 0, now() + Math.max(30000, retryMs));
        cooldown.set(provider, until);
        return fail("E_THROTTLED", "地图服务正在限流", { retryAfterMs: until - now() });
      }
      if ([502, 504].includes(response.status)) throw new TemporaryGatewayError();
      return fail("E_IO", "当前无法取得地图瓦片");
    }
    const bytes = await boundedBytes(response, 512 * 1024);
    if (!imageMatches(bytes, type)) return fail("E_IO", "地图服务返回了无效图像");
    if (provider === "terrascope" && bytes.length < 4096 && isEmptySatelliteTile?.(bytes)) return unavailable();
    return ok({ dataUrl: "data:" + type + ";base64," + bytes.toString("base64") });
  }

  async function loadVisibleTile(job) {
    try { return await load(job); }
    catch (error) {
      if (job.source.provider === "osm" || job.controller.signal.aborted || !isTransientTransfer(error)) throw error;
      // Keep the same visible-tile subscribers and cancellation signal across both attempts.
      await delay(500, undefined, { signal: job.controller.signal });
      return load(job);
    }
  }
  async function run(job) {
    let result;
    try { result = await loadVisibleTile(job); }
    catch { result = job.controller.signal.aborted ? cancelled() : fail("E_IO", "地图加载失败，请检查网络或稍后重试"); }
    if (jobs.get(job.source.url) === job) jobs.delete(job.source.url);
    for (const [key, resolve] of job.users) { subscribers.delete(key); resolve(result); }
    active--;
    pump();
  }
  function pump() {
    while (active < 6 && queued.size) {
      const job = queued.values().next().value;
      queued.delete(job);
      active++;
      void run(job);
    }
  }
  function cancel(key) {
    const job = subscribers.get(key);
    if (!job) return;
    const resolve = job.users.get(key);
    job.users.delete(key);
    subscribers.delete(key);
    resolve(cancelled());
    if (!job.users.size) {
      queued.delete(job);
      if (jobs.get(job.source.url) === job) jobs.delete(job.source.url);
      job.controller.abort();
    }
  }
  const watched = new WeakSet();
  ipcMain.handle("la:database-map:tile", (event, args) => {
    if (!isTrustedSender(event, getWindow())) return fail("E_FORBIDDEN", "只接受工作区窗口的地图请求");
    if (!isPlainObject(args) || !requestIdValid(args.requestId) || Object.keys(args).some(key => !tileKeys.has(key))) {
      return fail("E_INVALID_ARGUMENT", "地图瓦片参数无效");
    }
    const source = databaseTileSource(args.layer, args.z, args.x, args.y);
    if (!source) return fail("E_INVALID_ARGUMENT", "地图图层或瓦片编号无效");
    if (source.unavailable) return unavailable();
    const key = senderKey(event, args.requestId);
    if (subscribers.has(key)) return fail("E_CONFLICT", "地图请求编号已使用");
    if (subscribers.size >= 512) return fail("E_THROTTLED", "地图请求过多，请稍后重试");
    if (!watched.has(event.sender)) {
      const prefix = event.sender.id + "|";
      const cancelAll = () => { for (const id of subscribers.keys()) if (id.startsWith(prefix)) cancel(id); };
      event.sender.once?.("destroyed", cancelAll);
      event.sender.on?.("did-start-navigation", (navigation) => { if (navigation.isMainFrame && !navigation.isSameDocument) cancelAll(); });
      watched.add(event.sender);
    }
    let job = jobs.get(source.url);
    if (!job) {
      job = { source, controller: new AbortController(), users: new Map() };
      jobs.set(source.url, job);
      queued.add(job);
    }
    subscribers.set(key, job);
    const result = new Promise(resolve => job.users.set(key, resolve));
    pump();
    return result;
  });
  ipcMain.handle("la:database-map:cancel", (event, args) => {
    if (!isTrustedSender(event, getWindow())) return fail("E_FORBIDDEN", "只接受工作区窗口的地图请求");
    if (!isPlainObject(args) || !requestIdValid(args.requestId)) return fail("E_INVALID_ARGUMENT", "地图请求编号无效");
    cancel(senderKey(event, args.requestId));
    return ok();
  });
}

export function databaseTileAgent(appVersion) {
  return "LifeAtlas-DatabaseMap/" + appVersion + " (+https://github.com/jamesmendax/life-atlas-public)";
}
