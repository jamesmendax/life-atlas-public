import { MAX_ROUTE_STOPS, ROAD_GEOMETRY_SIZE_ERROR, routingUrl, ROUTE_GEOMETRY_VERSION, TRIP_MODES, VALID_POINT } from "../../../src/domain/tripRoutes.js";
import { isRd5TileName } from "../../../src/domain/tripOfflineRegions.js";
import { normalizeRoadRef } from "../../../src/domain/tripRoadRef.js";
import { amapRoadCandidates, selectRoadCandidate } from "../tripRoadCandidates.js";
import { createHighwayLookup } from "../tripHighwayLookup.js";
import { amapSearchResults, amapTransitAlternatives, osmSearchResults, toAmapPoint } from "../../../src/domain/transitProviders.js";
import { fail, ok } from "./result.js";
import { isPlainObject, isTrustedSender } from "./validate.js";
import { tMain } from "../i18n/index.js";

import { boundedBytes } from "../boundedResponse.js";

function tileUrl(input) {
  const { x, y, z } = input;
  if (!Number.isInteger(z) || z < 1 || z > 18 || ![x, y].every((n) => Number.isInteger(n) && n >= 0 && n < 2 ** z)) return null;
  return `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
}

const roadModes = new Set(TRIP_MODES.filter(mode => mode.profile).map(mode => mode.id));
const amapRoadMode = { drive: "driving", walk: "walking", bike: "bicycling" };
const validPlaces = places => places === undefined || (Array.isArray(places) && places.length === 2 && places.every(place => place === null || isPlainObject(place)));
const pointQuery = coordinate => coordinate.map(n => n.toFixed(6)).join(",");

function amapRoutePoint(point, place) {
  const coordinate = toAmapPoint(point).reverse();
  const matches = saved => Array.isArray(saved) && saved.length === 2 && saved.every((value, i) => Number.isFinite(value) && Math.abs(value - coordinate[i]) <= 0.00002);
  const center = matches(place?.location);
  const selected = center ? place.location : [place?.entrance, place?.exit, place?.navigation].find(matches);
  const poiId = center && typeof place.poiId === "string" && /^[A-Z0-9]{1,80}$/iu.test(place.poiId) ? place.poiId : "";
  const adcode = selected && typeof place.adcode === "string" && /^\d{6}$/u.test(place.adcode) ? place.adcode : "";
  const typecode = poiId && typeof place.typecode === "string" && /^\d{6}$/u.test(place.typecode) ? place.typecode : "";
  return { coordinate: pointQuery(selected || coordinate), poiId, adcode, typecode };
}

function retryDelay(header, now) {
  const text = header?.trim();
  const delay = text && (/^\d+$/u.test(text) ? Number(text) * 1000 : Date.parse(text) - now);
  return Number.isFinite(delay) && delay > 0 ? Math.min(86_400_000, Math.max(1000, delay)) : 60_000;
}

function tileFailure(reason, message, { httpStatus, retryAfterMs } = {}) {
  const code = retryAfterMs || reason === "busy" ? "E_THROTTLED" : "E_IO";
  const result = fail(code, message, { retryAfterMs });
  result.error.details = { reason, ...(httpStatus && { httpStatus }), ...(retryAfterMs && { retryAfterMs }) };
  return result;
}

const tileLimit = 512 * 1024;
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
function looksLikeTilePng(bytes) {
  if (bytes.length < 57 || !bytes.subarray(0, 8).equals(pngSignature) || bytes.readUInt32BE(8) !== 13
    || bytes.toString("ascii", 12, 16) !== "IHDR") return false;
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  if (!width || !height || width > 1024 || height > 1024) return false;
  let imageData = false;
  for (let offset = 33; offset + 12 <= bytes.length;) {
    const size = bytes.readUInt32BE(offset), end = offset + 12 + size;
    if (end > bytes.length) return false;
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    if (type === "IDAT" && size) imageData = true;
    if (type === "IEND") return imageData && size === 0 && end === bytes.length;
    offset = end;
  }
  return false;
}

function offlineRouteFailure(error) {
  const messages = {
    E_NOT_FOUND: "本机路网未找到可通行的路线，请查看已安装的区域或调整站点",
    E_INVALID_ARGUMENT: "所选的出行方式、地点或公路编号超出本机路网支持范围",
    E_THROTTLED: "本机路网正在计算，请稍后重试",
    E_CANCELLED: "本机路网查询已取消",
    E_CONFLICT: "本机路网尚未就绪，请先检查离线路网设置",
  };
  if (error?.code === ROAD_GEOMETRY_SIZE_ERROR || error?.code === "E_TOO_LARGE") return fail("E_TOO_LARGE", "路线数据超过处理上限，请拆分路线后重试");
  if (Object.hasOwn(messages, error?.code)) {
    const result = fail(error.code, messages[error.code], { retryAfterMs: error.retryAfterMs });
    const { requiredTiles, missingTiles } = error.details ?? {};
    if (error.code === "E_NOT_FOUND" && Array.isArray(requiredTiles) && Array.isArray(missingTiles)) {
      const required = new Set(requiredTiles.slice(0, 2592).filter(isRd5TileName));
      result.error.details = { requiredTiles: [...required], missingTiles: [...new Set(missingTiles.slice(0, 2592).filter(tile => required.has(tile)))] };
    }
    return result;
  }
  return fail("E_IO", "未能取得本机路线，请检查离线路网设置");
}

export function registerTripRoutesIpc({ ipcMain, getWorkspaceWindow, fetchRoute, fetchTile, routeOffline, capabilityOwner, getAmapKey = () => "", getAmapAccess, nominatimSearchUrl, osrmBaseUrl = process.env.LIFE_ATLAS_OSRM_BASE_URL, appVersion = "desktop", now = Date.now }) {
  let nextRouteAt = 0;
  let busy = false;
  let activeTiles = 0;
  let tileBackoff;
  const headers = { "User-Agent": `LifeAtlas-TripItinerary/${appVersion} (https://github.com/jamesmendax/life-atlas-public)` };
  const options = (timeout) => ({ method: "GET", headers, redirect: "error", credentials: "omit", signal: AbortSignal.timeout(timeout) });
  const trusted = (event) => isTrustedSender(event, getWorkspaceWindow());
  const requestAmapRoad = registerPlaceAndTransit();
  let lookupBusy = false, nextLookupAt = 0;
  const lookupHighway = createHighwayLookup({ now, fetchBytes: async (url, owner) => {
    const response = await fetchRoute(url, options(10000), owner);
    if (response.ok) return response;
    await response.body?.cancel().catch(() => {});
    if (response.status === 429) {
      nextLookupAt = now() + 60000;
      throw { result: fail("E_THROTTLED", "公路地图服务已限流，请稍后重试") };
    }
    throw new Error("公路地图服务暂不可用");
  } });

  function registerPlaceAndTransit() {
    const cache = new Map();
    const inflight = new Map();
    const subscribers = new Map();
    let nominNext = 0;
    // Deployment configuration is read in the main process, never from IPC.
    // An invalid override fails closed instead of disclosing the keyword to an
    // unexpected fallback. Operators can deploy a shared, rate-limited proxy.
    let geocoder;
    try {
      const endpoint = new URL(nominatimSearchUrl || "https://nominatim.openstreetmap.org/search");
      if (endpoint.protocol === "https:" && !endpoint.username && !endpoint.password && !endpoint.search && !endpoint.hash) geocoder = endpoint;
    } catch { /* Report the configuration problem only if search is requested. */ }
    const serviceDate = () => new Date(now() + 8 * 3600000).toISOString().slice(0, 10);
    const cityCode = value => typeof value === "string" && /^0?\d{2,4}$/u.test(value);
    const idAllowed = id => typeof id === "string" && /^[\w.:-]{1,96}$/u.test(id);
    const ownerOf = args => capabilityOwner ? capabilityOwner(args.frameUrl, "trip-routing") : "desktop";
    const ownerTag = (event, args) => JSON.stringify([event.sender?.id, args.frameUrl || "desktop"]);
    function cached(key) {
      const hit = cache.get(key);
      if (hit && hit.until > now()) return hit.value;
      cache.delete(key);
      return null;
    }
    function remember(key, value, ttl) {
      if (cache.size >= 180) cache.delete(cache.keys().next().value);
      cache.set(key, { value, until: now() + ttl });
    }
    async function json(url, owner, signal, limit = 2 * 1024 * 1024) {
      const response = await fetchRoute(url.toString(), { ...options(20000), signal: AbortSignal.any([signal, AbortSignal.timeout(18000)]) }, owner);
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        if (response.status === 429) {
          if (geocoder && url.origin === geocoder.origin && url.pathname === geocoder.pathname) nominNext = now() + 60000;
          throw { result: fail("E_THROTTLED", "地图服务已限流，请稍后重试") };
        }
        throw new Error("HTTP");
      }
      return JSON.parse((await boundedBytes(response, limit)).toString("utf8"));
    }
    async function amap(path, params, key, owner, signal) {
      const url = new URL(path, "https://restapi.amap.com");
      url.search = new URLSearchParams({ ...params, key }).toString();
      const data = await json(url, owner, signal, path.startsWith("/v5/direction/") ? 4 * 1024 * 1024 : undefined);
      if (String(data.status) !== "1") {
        const code = String(data.infocode);
        if (["10003","10004","10021","10044"].includes(code)) throw { result: fail("E_THROTTLED", "高德请求达到限额，请稍后再试") };
        if (["10001","10002","10005","10006","10007","10009","10012","10041"].includes(code)) throw { result: fail("E_FORBIDDEN", "请检查高德 Web 服务 Key、权限或绑定限制") };
        if (code === "20803") throw { result: fail("E_NOT_FOUND", "高德未找到此距离的方案，请拆分区间后重试") };
        if (["20800", "20801", "20802"].includes(code)) throw { result: fail("E_NOT_FOUND", "高德未找到可通行的路线，请调整站点或换一种方式") };
        throw { result: fail("E_IO", "高德未能返回可用结果，请检查服务配置或调整地点") };
      }
      return data;
    }
    async function cityFor(point, supplied, key, owner, signal) {
      if (cityCode(supplied)) return supplied;
      const cacheKey = "city|" + point;
      const saved = cached(cacheKey);
      if (saved) return saved;
      const data = await amap("/v3/geocode/regeo", { location: point, extensions: "base" }, key, owner, signal);
      const code = data.regeocode?.addressComponent?.citycode;
      if (!cityCode(code)) throw { result: fail("E_NOT_FOUND", "未能确定该地点的公交城市代码") };
      remember(cacheKey, code, 3600000);
      return code;
    }
    function validDate(s) {
      if (s === undefined || s === "") return true;
      if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(s)) return false;
      const stamp = Date.parse(s + "T00:00:00Z");
      return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === s;
    }
    async function runQuery(event, args, method, databaseSearch = false) {
      if (!trusted(event) || !isPlainObject(args)) return fail("E_FORBIDDEN", "只接受工作区组件的调用");
      const owner = databaseSearch ? "native-database-map" : ownerOf(args);
      if (!owner) return fail("E_FORBIDDEN", "这个组件没有地图权限");
      if (args.requestId !== undefined && !idAllowed(args.requestId)) return fail("E_INVALID_ARGUMENT", "请求编号无效");
      let access;
      try { access = databaseSearch ? {} : getAmapAccess ? getAmapAccess() : { key: await getAmapKey() }; } catch { return fail("E_IO", "无法读取本机地图配置"); }
      const key = access.key;
      const provider = key ? "amap" : "nominatim";
      const scope = databaseSearch ? JSON.stringify([event.sender.id, "native-database-map"]) : ownerTag(event, args);
      let params, task;
      if (method === "search") {
        const query = typeof args.query === "string" ? args.query.trim() : "";
        if (!query || query.length > 80 || (args.region !== undefined && (typeof args.region !== "string" || args.region.length > 40))) return fail("E_INVALID_ARGUMENT", "请输入有效的地点关键词和城市");
        if (args.provider !== provider || args.userInitiated !== true) return fail("E_FORBIDDEN", "请确认要使用的地图服务并手动搜索");
        const limit = Math.min(25, Math.max(1, Number.isInteger(args.limit) ? args.limit : 10));
        const region = args.region?.trim() || "";
        const types = args.types === undefined ? "" : args.types;
        const cityLimit = args.cityLimit === true;
        if ((args.cityLimit !== undefined && typeof args.cityLimit !== "boolean") || (cityLimit && !region)
          || (types !== "" && (typeof types !== "string" || !/^\d{6}(?:\|\d{6}){0,9}$/u.test(types)))) {
          return fail("E_INVALID_ARGUMENT", "请选择有效的城市范围或地点类型");
        }
        if (provider !== "amap" && (cityLimit || types)) return fail("E_INVALID_ARGUMENT", "城市和地点类型筛选需要高德 Web 服务");
        params = [query, region, limit, cityLimit, types];
        task = async signal => {
          if (provider === "amap") {
            const data = await amap("/v5/place/text", { keywords: query, page_size: String(limit), show_fields: "navi",
              ...(region && { region }), ...(cityLimit && { city_limit: "true" }), ...(types && { types }) }, key, owner, signal);
            return { provider, attribution: "高德地图", places: amapSearchResults(data) };
          }
          if (!geocoder) throw { result: fail("E_IO", "本机地点搜索服务的 HTTPS 地址配置无效") };
          if (now() < nominNext) throw { result: fail("E_THROTTLED", "公开地点搜索有频率限制，请稍后再试", { retryAfterMs: nominNext - now() }) };
          nominNext = now() + 1200;
          const url = new URL(geocoder.href);
          url.search = new URLSearchParams({ q: [query, region].filter(Boolean).join(", "), format: "jsonv2", limit: String(limit), "accept-language": "zh-CN,en" }).toString();
          return { provider, serviceHost: geocoder.host, attribution: "© OpenStreetMap contributors · ODbL", places: osmSearchResults(await json(url, owner, signal)) };
        };
      } else {
        if (!Array.isArray(args.points) || args.points.length !== 2 || !args.points.every(VALID_POINT) || !validPlaces(args.places)
          || (args.citycodes !== undefined && (!Array.isArray(args.citycodes) || args.citycodes.length !== 2 || !args.citycodes.every(c => c == null || c === "" || cityCode(c))))
          || !validDate(args.date) || (args.time !== undefined && args.time !== "" && (typeof args.time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/u.test(args.time)))) return fail("E_INVALID_ARGUMENT", "公交起终点或出发日期、时间无效");
        if (!key) return fail("E_NOT_FOUND", "此设备尚未配置高德 Web 服务 Key，可查看离线路线");
        const [from, to] = args.points.map((point, i) => amapRoutePoint(point, args.places?.[i]));
        const origin = from.coordinate, destination = to.coordinate;
        const identity = from.poiId && to.poiId ? { originpoi: from.poiId, destinationpoi: to.poiId } : {};
        const areas = { ...(from.adcode && { ad1: from.adcode }), ...(to.adcode && { ad2: to.adcode }) };
        params = [origin, destination, args.citycodes || [], args.date || "", args.time || "", identity, areas];
        task = async signal => {
          const city1 = await cityFor(origin, args.citycodes?.[0], key, owner, signal);
          const city2 = await cityFor(destination, args.citycodes?.[1], key, owner, signal);
          const data = await amap("/v5/direction/transit/integrated", { origin, destination, city1, city2, show_fields: "cost,polyline", ...identity, ...areas,
            ...(args.date ? {date:args.date} : {}), ...(args.time ? {time:args.time.replace(":","-")} : {}) }, key, owner, signal);
          const alternatives = amapTransitAlternatives(data);
          if (!alternatives.length) throw { result: fail("E_NOT_FOUND", "高德未返回可用的公共交通方案") };
          return { provider, at: serviceDate(), legs: [alternatives[0]], alternatives };
        };
      }
      const cacheKey = JSON.stringify([method, provider, key ? access.revision : null, params]);
      const hit = cached(cacheKey);
      if (hit) return ok(hit);
      const jobKey = provider === "nominatim" ? cacheKey : scope + cacheKey;
      const subKey = args.requestId ? scope + "|" + args.requestId : Symbol();
      if (subscribers.has(subKey)) return fail("E_CONFLICT", "请使用本次查询的独立请求号");
      let job = inflight.get(jobKey);
      if (!job) {
        if (inflight.size >= 16) return fail("E_THROTTLED", "地图查询繁忙，请稍后重试");
        const controller = new AbortController();
        job = { controller, users: new Set(), result: null };
        const current = job;
        const signal = key && access.signal ? AbortSignal.any([controller.signal, access.signal]) : controller.signal;
        job.result = Promise.resolve().then(() => { signal.throwIfAborted(); return task(signal); }).then(value => {
          if (signal.aborted) return fail("E_CANCELLED", "查询已取消");
          remember(cacheKey, value, method === "search" ? 86400000 : 300000);
          return ok(value);
        }).catch(e => signal.aborted ? fail("E_CANCELLED", "查询已取消") : e?.result || fail("E_IO", "暂时无法取得地图结果，仍可查看离线数据"))
          .finally(() => { if (inflight.get(jobKey) === current) inflight.delete(jobKey); });
        inflight.set(jobKey, job);
      }
      let cancelled;
      const wake = new Promise(resolve => { cancelled = resolve; });
      job.users.add(subKey);
      subscribers.set(subKey, () => {
        job.users.delete(subKey);
        if (!job.users.size) { job.controller.abort(); if (inflight.get(jobKey) === job) inflight.delete(jobKey); }
        cancelled(fail("E_CANCELLED", "查询已取消"));
      });
      try { return await Promise.race([job.result, wake]); }
      finally { job.users.delete(subKey); subscribers.delete(subKey); }
    }
    for (const method of ["search", "transit"]) ipcMain.handle("la:trip:" + method, (event, args) => runQuery(event, args, method));
    ipcMain.handle("la:database-map:search", (event, args) => {
      if (!trusted(event)) return fail("E_FORBIDDEN", "只接受工作区窗口的地图搜索");
      if (!isPlainObject(args) || !idAllowed(args.requestId) || Object.keys(args).some(key => !["query", "requestId"].includes(key))) {
        return fail("E_INVALID_ARGUMENT", "请输入地点关键词");
      }
      return runQuery(event, { query: args.query, requestId: args.requestId, userInitiated: true, provider: "nominatim" }, "search", true);
    });
    ipcMain.handle("la:database-map:cancel-search", (event, args) => {
      if (!trusted(event)) return fail("E_FORBIDDEN", "只接受工作区窗口的地图搜索");
      if (!isPlainObject(args) || !idAllowed(args.requestId)) return fail("E_INVALID_ARGUMENT", "请求编号无效");
      subscribers.get(JSON.stringify([event.sender.id, "native-database-map"]) + "|" + args.requestId)?.();
      return ok();
    });
    ipcMain.handle("la:trip:cancel", (event,args) => {
      if (!trusted(event) || !isPlainObject(args) || !ownerOf(args)) return fail("E_FORBIDDEN","只接受工作区组件的调用");
      if (!idAllowed(args.requestId)) return fail("E_INVALID_ARGUMENT","请求编号无效");
      subscribers.get(ownerTag(event,args) + "|" + args.requestId)?.();
      return ok();
    });
    return async (mode, points, places, ref, owner) => {
      const access = getAmapAccess ? getAmapAccess() : { key: await getAmapKey() };
      if (!access?.key) throw { result: fail("E_FORBIDDEN", "本机尚未设置高德 Web 服务 Key") };
      const [from, to] = points.map((point, i) => amapRoutePoint(point, places?.[i]));
      const ids = mode === "bike" ? {} : { ...(from.poiId && { origin_id: from.poiId }), ...(to.poiId && { destination_id: to.poiId }) };
      const data = await amap("/v5/direction/" + amapRoadMode[mode], { origin: from.coordinate, destination: to.coordinate, show_fields: "cost,polyline", ...ids,
        ...(mode === "drive" && to.typecode && { destination_type: to.typecode }), ...(ref && { strategy: "32" }) }, access.key, owner, access.signal || AbortSignal.timeout(20000));
      if (access.signal?.aborted) throw { result: fail("E_CANCELLED", "地图配置已更新，请重新查询") };
      return amapRoadCandidates(data);
    };
  }
  ipcMain.handle("la:trip:route", async (event, args) => {
    if (!trusted(event)) return fail("E_FORBIDDEN", "只接受工作区窗口的调用");
    if (!isPlainObject(args)) return fail("E_INVALID_ARGUMENT", "行程参数无效");
    const owner = capabilityOwner?.(args.frameUrl, "trip-routing");
    if (capabilityOwner && !owner) return fail("E_FORBIDDEN", "这个组件没有可用的地图权限");
    if (args.kind === "highway-nearby") {
      const ref = normalizeRoadRef(args.ref);
      if (!ref || !VALID_POINT(args.point)) return fail("E_INVALID_ARGUMENT", "请输入有效的 G 字头公路编号，并选择附近位置");
      if (lookupBusy || now() < nextLookupAt) return fail("E_THROTTLED", "公路地图正在查询，请稍后再试");
      lookupBusy = true;
      nextLookupAt = now() + 1100;
      try { return ok(await lookupHighway(args.point, ref, owner)); }
      catch (e) { return e?.result || fail("E_IO", "未能取得附近的公路地图，请检查网络后重试"); }
      finally { lookupBusy = false; }
    }
    if (args.kind !== undefined || !Array.isArray(args.points)) return fail("E_INVALID_ARGUMENT", "行程坐标无效");
    const ref = normalizeRoadRef(args.highwayRef);
    if (args.highwayRef !== undefined && (!ref || args.mode !== "drive")) return fail("E_INVALID_ARGUMENT", "指定公路仅支持驾车，请输入有效的 G 字头编号");
    if (args.provider !== undefined && !["osrm", "amap", "offline"].includes(args.provider)) return fail("E_INVALID_ARGUMENT", "道路服务无效");
    if (!roadModes.has(args.mode) || args.points.length < 2 || args.points.length > MAX_ROUTE_STOPS || !args.points.every(VALID_POINT)) {
      return fail("E_INVALID_ARGUMENT", tMain("请选择驾车、骑行或步行，并提供 2 到 {max} 个有效站点", { max: MAX_ROUTE_STOPS }));
    }
    if (args.provider === "offline") {
      if (!routeOffline) return fail("E_NOT_FOUND", "此设备尚未配置本机离线路网");
      try { return ok(await routeOffline({ mode: args.mode, points: args.points, ...(ref && { highwayRef: ref }) })); }
      catch (error) { return offlineRouteFailure(error); }
    }
    const withAmap = args.provider === "amap";
    if (withAmap && (args.points.length !== 2 || !validPlaces(args.places))) return fail("E_INVALID_ARGUMENT", "高德路线需要选定一个有效的起终点区间");
    if (busy || now() < nextRouteAt) return fail("E_THROTTLED", "道路服务正在处理请求，请稍后重试");
    busy = true;
    nextRouteAt = now() + 1100;
    try {
      let payload;
      if (withAmap) payload = await requestAmapRoad(args.mode, args.points, args.places, ref, owner);
      else {
        let url = routingUrl(args.mode, args.points);
        if (osrmBaseUrl) {
          const base = new URL(osrmBaseUrl);
          if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash) throw new Error("道路服务 HTTPS 地址无效");
          url = base.href.replace(/\/$/u, "") + url.slice("https://routing.openstreetmap.de".length);
        }
        if (ref) url += "&alternatives=true";
        const response = await fetchRoute(url, options(20000), owner);
        if (!response.ok && response.status !== 400) {
          await response.body?.cancel().catch(() => {});
          if (response.status === 429) {
            const seconds = Number(response.headers.get("retry-after"));
            nextRouteAt = now() + Math.max(60000, Number.isFinite(seconds) ? seconds * 1000 : 0);
            return fail("E_THROTTLED", "道路服务已限流，请稍后重试");
          }
          return fail("E_IO", "道路服务暂不可用，已保留原有路线");
        }
        payload = JSON.parse((await boundedBytes(response, 3 * 1024 * 1024)).toString("utf8"));
      }
      if (payload.code === "NoRoute" || payload.code === "NoSegment") return fail("E_NOT_FOUND", "该方式没有找到可通行的道路，可调整站点或换一种方式");
      const matched = selectRoadCandidate(payload, args.points.length, ref);
      const legs = matched || selectRoadCandidate(payload, args.points.length, "");
      return ok({ legs, geometryVersion: ROUTE_GEOMETRY_VERSION, at: new Date(now()).toISOString().slice(0, 10), source: withAmap ? "高德地图" : "OSRM / OpenStreetMap", ...(ref && { highwayRef: ref, highwayVerified: Boolean(matched) }) });
    } catch (e) { return e?.result || (e?.code === ROAD_GEOMETRY_SIZE_ERROR
      ? fail("E_TOO_LARGE", "路线轨迹超过可处理的点数，请拆分路线后重试") : fail("E_IO", "未能取得完整路线，请检查网络或稍后重试")); }
    finally { busy = false; }
  });
  ipcMain.handle("la:trip:tile", async (event, args) => {
    if (!trusted(event)) return fail("E_FORBIDDEN", "只接受工作区窗口的调用");
    const url = isPlainObject(args) && tileUrl(args);
    if (!url) return fail("E_INVALID_ARGUMENT", "地图范围无效");
    const owner = capabilityOwner?.(args.frameUrl, "trip-routing");
    if (capabilityOwner && !owner) return fail("E_FORBIDDEN", "这个组件没有可用的地图权限");
    const remaining = tileBackoff?.until - now();
    if (remaining > 0) return tileFailure(tileBackoff.reason, tileBackoff.message, { httpStatus: tileBackoff.status, retryAfterMs: remaining });
    if (activeTiles >= 32) return tileFailure("busy", "街道底图正在加载，请稍后再试");
    activeTiles++;
    const request = options(12000);
    let status;
    try {
      const response = await fetchTile(url, request, owner);
      status = response.status;
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        const retryAfter = response.headers.get("retry-after");
        const reason = status === 429 ? "rate-limited" : status === 401 || status === 403 ? "blocked" : "http";
        const message = reason === "rate-limited" ? "街图服务已限流" : reason === "blocked" ? "街图服务拒绝访问" : "街图服务暂未返回图块";
        const backoff = reason !== "http" || (status === 503 && retryAfter) ? retryDelay(retryAfter, now()) : 0;
        if (backoff && now() + backoff > (tileBackoff?.until ?? 0)) tileBackoff = { until: now() + backoff, reason, status, message };
        return tileFailure(reason, message, { httpStatus: status, retryAfterMs: backoff });
      }
      if (response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "image/png" || !response.body) {
        await response.body?.cancel().catch(() => {});
        return tileFailure("payload-type", "街图服务未返回 PNG 图片", { httpStatus: response.status });
      }
      const bytes = await boundedBytes(response, tileLimit);
      if (!looksLikeTilePng(bytes)) return tileFailure("invalid-png", "街图图片数据不完整或损坏", { httpStatus: response.status });
      return ok({ dataUrl: "data:image/png;base64," + bytes.toString("base64") });
    } catch (error) {
      if (request.signal.aborted || error?.name === "TimeoutError" || /^(?:net::)?ERR_TIMED_OUT$/u.test(error?.message)
        || ["ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT"].includes(error?.code ?? error?.cause?.code)) return tileFailure("timeout", "连接街图服务超时");
      if (error?.code === "E_CONFLICT") return tileFailure("cache-unavailable", "街图缓存暂不可用");
      if (error?.message === "超出响应上限") return tileFailure("payload-too-large", "街图图片超过大小上限", { httpStatus: status });
      return tileFailure("network", "无法连接街图服务");
    }
    finally { activeTiles--; }
  });
}
