import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { registerTripAmapSdk } from "../electron/main/tripAmapSdk.js";
import { toAmapPoint } from "../src/domain/transitProviders.js";
import { encodeLine, MAX_ROUTE_SECTION_POINTS } from "../src/domain/tripRoutes.js";

// Simulated Electron and SDK. The HTTP integration calls only the temporary
// local loopback listener and an injected fetch, never a credential endpoint.
const key = "a".repeat(32), securityCode = "d".repeat(32);
const coords = [[[39.91, 116.38], [39.912, 116.387]], [[39.92, 116.39], [39.922, 116.395]]];
const validRoute = { frameUrl: "life-widget://authorized/index.html", sections: coords.map(encodeLine) };
const sdkSource = fs.readFileSync(new URL("../electron/main/trip-amap-sdk/preview.js", import.meta.url), "utf8");

function fixture(t, overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-amap-sdk-"));
  const file = path.join(root, "maps", "sdk.json"), handlers = new Map();
  const mainFrame = { routingId: 2, processId: 12 };
  const contents = { id: 37, mainFrame }, event = { sender: contents, senderFrame: mainFrame };
  const tokens = new Map(), windows = [], partitions = [];
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString(value) {
      const token = randomBytes(32);
      tokens.set(token.toString("hex"), value);
      return token;
    },
    decryptString(token) { return tokens.get(token.toString("hex")); },
  };
  const isolation = new EventEmitter();
  isolation.clearStorageData = overrides.clearStorageData ?? (async () => {});
  isolation.setPermissionCheckHandler = callback => { isolation.check = callback; };
  isolation.setPermissionRequestHandler = callback => { isolation.request = callback; };
  isolation.setDevicePermissionHandler = callback => { isolation.device = callback; };
  isolation.webRequest = {
    onBeforeRequest(callback) { isolation.beforeRequest = callback; },
    onBeforeSendHeaders(callback) { isolation.beforeHeaders = callback; },
  };
  class Window extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.webContents = new EventEmitter();
      this.webContents.id = 100 + windows.length;
      this.webContents.setWindowOpenHandler = callback => { this.openHandler = callback; };
      windows.push(this);
    }
    async loadURL(url) { this.url = new URL(url); if (overrides.loadURL) await overrides.loadURL(this); }
    removeMenu() {}
    show() { this.visible = true; }
    focus() {}
    isDestroyed() { return Boolean(this.destroyed); }
    destroy() { this.destroyed = true; this.emit("closed"); }
  }
  registerTripAmapSdk({ ipcMain: { handle: (name, callback) => handlers.set(name, callback) },
    getWindow: () => ({ webContents: contents }), capabilityOwner: (address, capability) => address === validRoute.frameUrl && capability === "trip-routing",
    BrowserWindow: Window, session: { fromPartition: (name, options) => { partitions.push([name, options]); return isolation; } },
    file, safeStorage: overrides.safeStorage ?? safeStorage, fetchImpl: overrides.fetchImpl ?? (() => assert.fail("Unexpected upstream call")) });
  t.after(() => {
    for (const win of windows) if (!win.isDestroyed()) win.destroy();
    fs.rmSync(root, { recursive: true, force: true });
  });
  function networkRequest(win, url, overrides = {}) {
    let decision, headers;
    const details = { url: String(url), webContentsId: win.webContents.id, method: "GET", resourceType: "xhr", initiatorOrigin: win.url.origin,
      requestHeaders: {}, ...overrides };
    isolation.beforeRequest(details, result => { decision = result; });
    isolation.beforeHeaders(details, result => { headers = result.requestHeaders; });
    return { ...decision, headers };
  }
  const run = (method, input, sender = event) => handlers.get("la:trip:amap-sdk-" + method)(sender, input);
  return { run, mainFrame, event, windows, partitions, file, isolation, networkRequest };
}

test("fixture: SDK credentials are encrypted separately and never returned through IPC", async t => {
  const { run, file, windows, partitions, event } = fixture(t);
  const initial = { configured: false, preview: true, host: "127.0.0.1" };
  assert.deepEqual(run("status").value, initial);
  assert.deepEqual(run("status", {}).value, initial);
  assert.equal(run("status", { frameUrl: validRoute.frameUrl }).error.code, "E_INVALID_ARGUMENT");
  assert.equal(run("configure", { key }).error.code, "E_INVALID_ARGUMENT");
  assert.equal(run("configure", { key, securityCode }, { ...event, senderFrame: { routingId: 1, processId: 12 } }).error.code, "E_FORBIDDEN");
  assert.equal((await run("open", { ...validRoute, frameUrl: "https://foreign.example" })).error.code, "E_FORBIDDEN");
  assert.equal((await run("open", validRoute)).error.code, "E_NOT_FOUND");
  assert.equal((await run("open", { ...validRoute, url: "https://foreign.example" })).error.code, "E_INVALID_ARGUMENT");
  assert.equal((await run("open", { ...validRoute, sections: ["invalid"] })).error.code, "E_INVALID_ARGUMENT");
  assert.equal((await run("open", { ...validRoute, sections: [encodeLine(Array(MAX_ROUTE_SECTION_POINTS + 1).fill(coords[0][0]))] })).error.code, "E_TOO_LARGE");
  const configured = run("configure", { key, securityCode });
  assert.deepEqual(configured.value, { ...initial, configured: true });
  const ciphertext = fs.readFileSync(file, "utf8");
  assert.deepEqual(Object.keys(JSON.parse(ciphertext)).sort(), ["ciphertext", "version"]);
  assert.equal(ciphertext.includes(key) || ciphertext.includes(securityCode), false);
  assert.equal(windows.length, 0);
  assert.equal(partitions.length, 0);
  assert.deepEqual(run("configure", { clear: true }).value, initial);
  assert.equal(fs.existsSync(file), false);
});

test("fixture: SDK refuses plaintext fallback storage", t => {
  const { run, file } = fixture(t, { safeStorage: { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => "basic_text" } });
  assert.equal(run("configure", { key, securityCode }).error.code, "E_IO");
  assert.equal(fs.existsSync(file), false);
});

test("fixture: authenticated loopback renders only the selected sections and injects credentials only toward fixed AMap endpoints", async t => {
  const upstreams = [];
  const { run, windows, partitions, isolation, networkRequest } = fixture(t, { fetchImpl: async (url, options) => {
    const upstream = new URL(url);
    upstreams.push(upstream);
    assert.equal(options.credentials, "omit");
    assert.equal(options.redirect, "error");
    assert.equal(options.headers.Referer, windows[0].url.origin + "/");
    if (upstream.searchParams.has("reflect")) return Response.json({ secret: securityCode.toUpperCase() });
    return new Response('{"status":"1"}', { headers: { "content-type": "application/json", "set-cookie": "secret=fixture", "x-preview-leak": securityCode } });
  } });
  assert.equal(run("configure", { key, securityCode }).ok, true);
  assert.deepEqual((await run("open", validRoute)).value, { opened: true });
  assert.deepEqual(partitions, [["life-atlas-amap-sdk-preview", { cache: false }]]);
  const [win] = windows;
  assert.equal(win.visible, true);
  assert.equal(win.url.hostname, "127.0.0.1");
  assert.match(win.url.pathname, /^\/[a-f0-9]{32}\/$/u);
  const preferences = win.options.webPreferences;
  assert.equal(preferences.session, isolation);
  assert.equal(preferences.sandbox && preferences.contextIsolation && preferences.webSecurity, true);
  assert.equal(preferences.nodeIntegration || preferences.nodeIntegrationInSubFrames || preferences.nodeIntegrationInWorker || preferences.webviewTag, false);
  assert.equal(Object.hasOwn(preferences, "preload"), false);
  assert.equal(isolation.check(), false);
  isolation.request(null, "geolocation", allow => assert.equal(allow, false));
  assert.equal(isolation.device(), false);
  assert.deepEqual(win.openHandler({ url: "https://webapi.amap.com" }), { action: "deny" });
  for (const name of ["will-navigate", "will-frame-navigate", "will-redirect", "will-attach-webview"]) {
    let prevented = false;
    win.webContents.emit(name, { preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
  }
  assert.equal(networkRequest(win, "https://webapi.amap.com/maps", { resourceType: "script" }).cancel, false);
  assert.equal(networkRequest(win, "https://webapi.amap.com.example/maps", { resourceType: "script" }).cancel, true);
  assert.equal(networkRequest(win, "http://webapi.amap.com/maps", { resourceType: "script" }).cancel, true);
  assert.equal(networkRequest(win, "http://127.0.0.1:9/route.json").cancel, true);
  assert.equal(networkRequest(win, win.url, { resourceType: "subFrame" }).cancel, true);
  assert.equal(networkRequest(win, win.url, { webContentsId: 402 }).cancel, true);
  assert.equal(networkRequest(win, "https://webapi.amap.com/maps", { resourceType: "script", requestHeaders: { "X-Life-Atlas-Preview": "attempt" } }).headers["X-Life-Atlas-Preview"], undefined);
  const response = await fetch(win.url, { headers: networkRequest(win, win.url, { resourceType: "mainFrame", initiatorOrigin: undefined }).headers });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-security-policy"), /frame-ancestors 'none'/u);
  assert.match(response.headers.get("content-security-policy"), /script-src 'self' https:\/\/webapi\.amap\.com/u);
  assert.equal(response.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
  const html = await response.text();
  assert.match(html, /preview\.js/u);
  assert.equal(html.includes(key) || html.includes(securityCode), false);
  const dataUrl = new URL("route.json", win.url);
  assert.equal((await fetch(dataUrl)).status, 403);
  const headers = networkRequest(win, dataUrl).headers;
  assert.equal((await fetch(dataUrl, { headers: { ...headers, Origin: "https://foreign.example" } })).status, 403);
  const payload = await (await fetch(dataUrl, { headers })).json();
  assert.deepEqual(Object.keys(payload).sort(), ["key", "sections", "serviceHost"]);
  assert.equal(payload.key, key);
  assert.equal(JSON.stringify(payload).includes(securityCode), false);
  assert.deepEqual(payload.sections, coords.map(line => line.map(point => toAmapPoint(point).reverse().map(value => Number(value.toFixed(6))))));
  const serviceUrl = new URL(payload.serviceHost + "/v3/log/init");
  serviceUrl.search = new URLSearchParams({ key: "untrusted", JSCODE: "untrusted", flag: "fixture", webpage: win.url.href }).toString();
  const proxyResponse = await fetch(serviceUrl, { headers: networkRequest(win, serviceUrl).headers });
  assert.equal(proxyResponse.status, 200);
  assert.equal(proxyResponse.headers.has("set-cookie"), false);
  assert.equal(proxyResponse.headers.has("x-preview-leak"), false);
  assert.deepEqual(await proxyResponse.json(), { status: "1" });
  assert.equal(upstreams[0].origin + upstreams[0].pathname, "https://restapi.amap.com/v3/log/init");
  assert.equal(upstreams[0].searchParams.get("key"), key);
  assert.deepEqual(upstreams[0].searchParams.getAll("jscode"), [securityCode]);
  assert.equal(upstreams[0].searchParams.has("JSCODE"), false);
  assert.equal(upstreams[0].searchParams.get("webpage"), win.url.origin + "/");
  const unsafe = new URL(payload.serviceHost + "/v3/direction/driving?url=https://foreign.example");
  assert.equal((await fetch(unsafe, { headers: networkRequest(win, unsafe).headers })).status, 404);
  assert.equal(upstreams.length, 1);
  const reflected = new URL(payload.serviceHost + "/v4/map/styles?reflect=1");
  const stripped = await fetch(reflected, { headers: networkRequest(win, reflected).headers });
  assert.equal(upstreams[1].origin + upstreams[1].pathname, "https://webapi.amap.com/v4/map/styles");
  assert.equal(stripped.status, 502);
  assert.equal((await stripped.text()).includes(securityCode), false);
  assert.equal(run("configure", { clear: true }).ok, true);
  assert.equal(win.isDestroyed(), true);
  await assert.rejects(() => fetch(dataUrl, { headers }));
});

test("fixture: clearing SDK credentials cancels a pending preview before any window is created", async t => {
  let release, entered;
  const setup = new Promise(resolve => { entered = resolve; });
  const { run, windows } = fixture(t, { clearStorageData: () => { entered(); return new Promise(resolve => { release = resolve; }); } });
  run("configure", { key, securityCode });
  const open = run("open", validRoute);
  await setup;
  assert.equal((await run("open", validRoute)).error.code, "E_THROTTLED");
  assert.equal(run("configure", { clear: true }).value.configured, false);
  release();
  assert.equal((await open).error.code, "E_CANCELLED");
  assert.equal(windows.length, 0);
});

test("simulated SDK: only independent stored sections are drawn and initialization failure stays visible", async () => {
  const drawn = [], status = { dataset: { state: "loading" } };
  let script, complete, fitted, destroy, release;
  const appended = new Promise(resolve => { release = resolve; });
  const window = { addEventListener: (event, callback) => { assert.equal(event, "pagehide"); destroy = callback; } };
  const sections = [[[116.406, 39.909], [116.407, 39.913]], [[116.423, 39.924], [116.429, 39.929]]];
  const serviceHost = "http://127.0.0.1:9181/test/_AMapService";
  const context = { window, URL, URLSearchParams, setTimeout: () => 1, clearTimeout: () => {},
    document: { getElementById: () => status, createElement: () => ({}), head: { append(element) { script = element; release(); } } },
    fetch: async url => { assert.equal(url, "./route.json"); return Response.json({ key, serviceHost, sections }); } };
  vm.runInNewContext(sdkSource, context);
  await appended;
  assert.equal(window._AMapSecurityConfig.serviceHost, serviceHost);
  assert.equal("securityJsCode" in window._AMapSecurityConfig, false);
  assert.equal(new URL(script.src).origin, "https://webapi.amap.com");
  assert.equal(new URL(script.src).searchParams.get("key"), key);
  const loadingScript = script;
  window.AMap = {
    Map: class {
      add(overlays) { drawn.push(...overlays); }
      setFitView(overlays) { fitted = overlays; }
      on(event, listener) { assert.equal(event, "complete"); complete = listener; }
      destroy() {}
    },
    Polyline: class { constructor({ path }) { this.path = path; } },
  };
  window.lifeAtlasAmapReady();
  assert.equal(drawn.length, 2);
  assert.deepEqual(drawn.map(overlay => overlay.path), sections);
  assert.deepEqual(Array.from(fitted), drawn);
  assert.equal(status.dataset.state, "loading");
  complete();
  assert.equal(status.dataset.state, "ready");
  destroy();
  loadingScript.onerror();
  assert.equal(status.dataset.state, "error");
  assert.match(status.textContent, /行程路网/u);
});
