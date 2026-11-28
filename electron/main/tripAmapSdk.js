import { randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import { once } from "node:events";
import { decodeRoadGeometry, MAX_ROUTE_POINTS, MAX_ROUTE_SECTION_POINTS, ROAD_GEOMETRY_SIZE_ERROR } from "../../src/domain/tripRoutes.js";
import { toAmapPoint } from "../../src/domain/transitProviders.js";
import { boundedBytes } from "./boundedResponse.js";
import { errorResult, fail, ok } from "./ipc/result.js";
import { isPlainObject, isTrustedSender } from "./ipc/validate.js";
import { assertPhysicalPath, writeAtomicJson } from "./storage/dataRoot.js";

const host = "127.0.0.1";
const keyPattern = /^[a-f0-9]{32}$/iu;
const authHeader = "x-life-atlas-preview";
const apiHosts = ["https://webapi.amap.com", "https://jsapi.amap.com", "https://a.amap.com", "https://vdata.amap.com", "https://restapi.amap.com"];
const tileHosts = ["webrd", "webst", "wprd"].flatMap(prefix => [1, 2, 3, 4].map(n => `https://${prefix}0${n}.is.autonavi.com`));
const remoteSources = new Set([...apiHosts, ...tileHosts]);
const servicePaths = Object.freeze({ "/v3/log/init": "https://restapi.amap.com", "/v4/map/styles": "https://webapi.amap.com" });
const resourceTypes = new Set(["script", "stylesheet", "image", "font", "xhr", "other"]);
const staticResources = Object.freeze({
  "": ["preview.html", "text/html; charset=utf-8"],
  "preview.js": ["preview.js", "application/javascript; charset=utf-8"],
  "preview.css": ["preview.css", "text/css; charset=utf-8"],
});

function sdkError(code, message) {
  return Object.assign(new Error(message), { code });
}

function validCredentials(input) {
  return isPlainObject(input) && Object.keys(input).length === 2 && [input.key, input.securityCode].every(value => typeof value === "string" && keyPattern.test(value));
}

function keyStore(file, safeStorage) {
  const location = () => assertPhysicalPath(file);
  function read() {
    try {
      const target = location();
      const stat = fs.lstatSync(target);
      if (!stat.isFile() || stat.size > 8192) throw new Error("invalid");
      const record = JSON.parse(fs.readFileSync(target, "utf8"));
      if (record?.version !== 1 || typeof record.ciphertext !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/u.test(record.ciphertext)) throw new Error("invalid");
      return record.ciphertext;
    } catch (error) {
      if (error.code === "ENOENT") return "";
      throw sdkError("E_CORRUPT", "无法读取高德 JS API 本机配置。");
    }
  }
  function storage() {
    if (!safeStorage?.isEncryptionAvailable() || safeStorage.getSelectedStorageBackend?.() === "basic_text") {
      throw sdkError("E_IO", "系统密钥保护不可用，无法保存或读取高德 JS API 凭据。");
    }
    return safeStorage;
  }
  const status = () => ({ configured: Boolean(read()), preview: true, host });
  return {
    status,
    credentials() {
      const ciphertext = read();
      if (!ciphertext) throw sdkError("E_NOT_FOUND", "请先配置高德 Web 端 JS API Key 和安全密钥。");
      const protection = storage();
      try {
        const credentials = JSON.parse(protection.decryptString(Buffer.from(ciphertext, "base64")));
        if (validCredentials(credentials)) return credentials;
      } catch { /* Replacing the local credentials can recover a corrupt record. */ }
      throw sdkError("E_CORRUPT", "无法解密高德 JS API 凭据，请重新配置。");
    },
    configure(input) {
      if (isPlainObject(input) && Object.keys(input).length === 1 && input.clear === true) fs.rmSync(location(), { force: true });
      else if (validCredentials(input)) {
        const ciphertext = storage().encryptString(JSON.stringify({ key: input.key, securityCode: input.securityCode })).toString("base64");
        writeAtomicJson(location(), { version: 1, ciphertext });
      } else throw sdkError("E_INVALID_ARGUMENT", "请输入高德 JS API Key 和对应的安全密钥，均为 32 位十六进制字符。");
      return status();
    },
  };
}

function previewSections(sections) {
  if (!Array.isArray(sections) || !sections.length || sections.length > 256) throw sdkError("E_INVALID_ARGUMENT", "请选择已有真实轨迹的路段。");
  let remaining = MAX_ROUTE_POINTS + 32;
  return sections.map(section => {
    let line;
    try { line = decodeRoadGeometry(section, Math.min(MAX_ROUTE_SECTION_POINTS, remaining)); }
    catch (error) {
      if (error.code === ROAD_GEOMETRY_SIZE_ERROR) throw sdkError("E_TOO_LARGE", "这段路线超出高德叠加预览的点数上限。");
      throw sdkError("E_INVALID_ARGUMENT", "保存的路线数据无效。");
    }
    if (line.length < 2) throw sdkError("E_INVALID_ARGUMENT", "保存的路线缺少可显示的折线。");
    remaining -= line.length;
    return line.map(point => toAmapPoint(point).reverse().map(coordinate => Math.round(coordinate * 1e6) / 1e6));
  });
}

function parseUrl(value, base) {
  try { return new URL(value, base); } catch { return null; }
}

function serviceQuery(url, endpoint, credentials) {
  const path = url.pathname.slice(endpoint.servicePrefix.length);
  if (!Object.hasOwn(servicePaths, path)) return null;
  const upstream = new URL(path, servicePaths[path]);
  for (const [name, value] of url.searchParams) {
    if (!["key", "jscode", "securityjscode", "sig"].includes(name.toLowerCase())) {
      upstream.searchParams.append(name, value.replaceAll(endpoint.page.href, endpoint.page.origin + "/"));
    }
  }
  upstream.searchParams.set("key", credentials.key);
  upstream.searchParams.set("jscode", credentials.securityCode);
  return upstream;
}

function responseHeaders() {
  const sources = [...remoteSources].join(" ");
  return {
    "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Content-Security-Policy": ["default-src 'none'", "base-uri 'none'", "frame-ancestors 'none'", "form-action 'none'",
      `script-src 'self' ${apiHosts.join(" ")}`, `style-src 'self' 'unsafe-inline' ${apiHosts.join(" ")}`,
      `connect-src 'self' ${sources}`, `img-src 'self' data: blob: ${sources}`, `font-src data: ${apiHosts.join(" ")}`, "worker-src blob:"].join("; "),
  };
}

async function startLoopback(credentials, sections, fetchImpl, signal) {
  const prefix = "/" + randomBytes(16).toString("hex") + "/";
  const secret = randomBytes(32).toString("hex");
  const servicePrefix = prefix + "_AMapService";
  let endpoint, inflight = 0, budget = 48;
  const headers = responseHeaders();
  const server = http.createServer({ requestTimeout: 10_000, headersTimeout: 5_000, maxHeaderSize: 8192 }, async (request, response) => {
    function send(status, type = "text/plain; charset=utf-8", body = "") {
      if (!response.destroyed) response.writeHead(status, { ...headers, "Content-Type": type }).end(body);
    }
    const token = request.headers[authHeader];
    if (request.method !== "GET" || !endpoint || request.headers.host !== endpoint.page.host || typeof token !== "string"
      || token.length !== secret.length || !/^[a-f0-9]+$/u.test(token) || !timingSafeEqual(Buffer.from(token), Buffer.from(secret))
      || (request.headers.origin && request.headers.origin !== endpoint.page.origin) || signal.aborted) {
      send(403); return;
    }
    if (!request.url || request.url.length > 8192 || !request.url.startsWith("/") || request.url.startsWith("//")) { send(400); return; }
    const url = parseUrl(request.url, endpoint.page);
    if (!url || url.origin !== endpoint.page.origin || !url.pathname.startsWith(prefix) || url.hash) { send(404); return; }
    const route = url.pathname.slice(prefix.length);
    if (!url.search && Object.hasOwn(staticResources, route)) {
      try {
        const [filename, type] = staticResources[route];
        send(200, type, await fs.promises.readFile(new URL(`./trip-amap-sdk/${filename}`, import.meta.url)));
      } catch { send(500); }
      return;
    }
    if (route === "route.json" && !url.search) {
      send(200, "application/json; charset=utf-8", JSON.stringify({ key: credentials.key, serviceHost: endpoint.page.origin + servicePrefix, sections }));
      return;
    }
    const upstream = url.pathname.startsWith(servicePrefix + "/") && serviceQuery(url, endpoint, credentials);
    if (!upstream) { send(404); return; }
    if (inflight >= 4 || budget <= 0) { send(429); return; }
    inflight++;
    budget--;
    try {
      const result = await fetchImpl(upstream.href, { method: "GET", credentials: "omit", redirect: "error",
        headers: { Referer: endpoint.page.origin + "/", Accept: "application/json, application/javascript, */*" },
        signal: AbortSignal.any([signal, AbortSignal.timeout(8_000)]) });
      if (!result.ok) {
        await result.body?.cancel().catch(() => {});
        send(result.status === 429 ? 429 : result.status === 403 ? 403 : 502);
        return;
      }
      const mime = result.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
      // Some JS API endpoints return JSONP. Forward exact payloads only from
      // the fixed paths above, with no response cookies or other live headers.
      if (!["application/json", "application/javascript", "application/x-javascript", "text/javascript", "text/plain", "application/octet-stream"].includes(mime)) {
        await result.body?.cancel().catch(() => {});
        send(502); return;
      }
      const bytes = await boundedBytes(result, 2 * 1024 * 1024);
      if (bytes.toString("latin1").toLowerCase().includes(credentials.securityCode.toLowerCase())) { send(502); return; }
      send(200, mime, bytes);
    } catch { send(502); }
    finally { inflight--; }
  });
  server.maxConnections = 12;
  const close = () => { server.close(); server.closeAllConnections(); };
  server.listen(0, host);
  await once(server, "listening");
  server.unref();
  const { port } = server.address();
  endpoint = { page: new URL(`http://${host}:${port}${prefix}`), prefix, servicePrefix, secret };
  if (signal.aborted) close();
  else signal.addEventListener("abort", close, { once: true });
  return endpoint;
}

function guardSession(isolated, current) {
  isolated.setPermissionCheckHandler(() => false);
  isolated.setPermissionRequestHandler((_webContents, _permission, answer) => answer(false));
  isolated.setDevicePermissionHandler?.(() => false);
  isolated.on("will-download", event => event.preventDefault());
  function routeFor(details) {
    const view = current();
    const url = parseUrl(details.url);
    if (!view?.endpoint || !url || url.username || url.password || !["GET", "OPTIONS"].includes(details.method)) return {};
    if (details.webContentsId !== undefined && details.webContentsId !== view.window?.webContents.id) return {};
    const { page, prefix } = view.endpoint;
    if (details.resourceType === "mainFrame") return { local: url.href === page.href };
    if (!resourceTypes.has(details.resourceType) || (details.initiatorOrigin !== undefined && details.initiatorOrigin !== page.origin)) return {};
    if (url.origin === page.origin) return { local: url.pathname.startsWith(prefix) };
    return { remote: remoteSources.has(url.origin) };
  }
  isolated.webRequest.onBeforeRequest((details, answer) => {
    const { local, remote } = routeFor(details);
    answer({ cancel: !local && !remote });
  });
  isolated.webRequest.onBeforeSendHeaders((details, answer) => {
    const requestHeaders = Object.fromEntries(Object.entries(details.requestHeaders ?? {}).filter(([name]) => name.toLowerCase() !== authHeader));
    if (routeFor(details).local) requestHeaders[authHeader] = current().endpoint.secret;
    answer({ requestHeaders });
  });
}

export function registerTripAmapSdk({ ipcMain, getWindow, capabilityOwner, BrowserWindow, session, file, safeStorage, fetchImpl = globalThis.fetch }) {
  const store = keyStore(file, safeStorage);
  let isolated, active, opening = false;
  const trusted = event => isTrustedSender(event, getWindow());
  function closePreview(view) {
    if (!view) return;
    if (active === view) active = undefined;
    view.controller.abort();
    if (view.window && !view.window.isDestroyed()) view.window.destroy();
  }
  ipcMain.handle("la:trip:amap-sdk-status", (event, input) => {
    if (!trusted(event)) return fail("E_FORBIDDEN", "只接受工作区窗口的调用。");
    if (input !== undefined && (!isPlainObject(input) || Object.keys(input).length)) return fail("E_INVALID_ARGUMENT", "地图设置无效。");
    try { return ok(store.status()); } catch (error) { return errorResult(error, "无法读取高德 JS API 配置。"); }
  });
  ipcMain.handle("la:trip:amap-sdk-configure", (event, input) => {
    if (!trusted(event)) return fail("E_FORBIDDEN", "只接受工作区窗口的调用。");
    try {
      const status = store.configure(input);
      closePreview(active);
      return ok(status);
    } catch (error) { return errorResult(error, "无法保存高德 JS API 配置。"); }
  });
  ipcMain.handle("la:trip:amap-sdk-open", async (event, input) => {
    if (!trusted(event) || !isPlainObject(input) || typeof input.frameUrl !== "string" || !capabilityOwner(input.frameUrl, "trip-routing")) {
      return fail("E_FORBIDDEN", "这个组件没有地图预览权限。");
    }
    if (Object.keys(input).some(key => key !== "frameUrl" && key !== "sections")) return fail("E_INVALID_ARGUMENT", "地图预览参数无效。");
    if (opening) return fail("E_THROTTLED", "高德地图预览正在打开。");
    opening = true;
    let view;
    try {
      const sections = previewSections(input.sections);
      const credentials = store.credentials();
      closePreview(active);
      view = { controller: new AbortController() };
      active = view;
      if (!isolated) {
        isolated = session.fromPartition("life-atlas-amap-sdk-preview", { cache: false });
        guardSession(isolated, () => active);
      }
      await isolated.clearStorageData();
      view.controller.signal.throwIfAborted();
      view.endpoint = await startLoopback(credentials, sections, fetchImpl, view.controller.signal);
      view.controller.signal.throwIfAborted();
      const window = new BrowserWindow({ parent: getWindow(), width: 1000, height: 720, minWidth: 520, minHeight: 420,
        title: "高德路线叠加预览 · Life Atlas", show: false, autoHideMenuBar: true,
        webPreferences: { session: isolated, sandbox: true, contextIsolation: true, nodeIntegration: false, nodeIntegrationInWorker: false,
          nodeIntegrationInSubFrames: false, webSecurity: true, allowRunningInsecureContent: false, webviewTag: false, devTools: false,
          navigateOnDragDrop: false, spellcheck: false } });
      view.window = window;
      window.removeMenu();
      window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      for (const name of ["will-navigate", "will-frame-navigate", "will-redirect", "will-attach-webview"]) {
        window.webContents.on(name, event => event.preventDefault());
      }
      window.on("page-title-updated", event => event.preventDefault());
      window.on("closed", () => { if (active === view) closePreview(view); });
      window.webContents.on("render-process-gone", () => { if (active === view) closePreview(view); });
      await window.loadURL(view.endpoint.page.href);
      view.controller.signal.throwIfAborted();
      window.show();
      window.focus();
      return ok({ opened: true });
    } catch (error) {
      const cancelled = view?.controller.signal.aborted;
      closePreview(view);
      if (cancelled) return fail("E_CANCELLED", "高德路线预览已关闭。");
      return errorResult(error, "无法打开高德路线叠加预览，可返回行程路网。");
    } finally { opening = false; }
  });
  return { close: () => closePreview(active) };
}
