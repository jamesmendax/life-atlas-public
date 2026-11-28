import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import { createDialogs } from "../electron/main/dialogs.js";
import { confirmAndOpenExternal, validateExternalUrl } from "../electron/main/externalLinks.js";
import { createAppResponse, registerAppScheme } from "../electron/main/protocols.js";
import { WORKSPACE_CSP, VAULT_CSP, installSessionSecurity, installContentsGuards, isAllowedNavigation, createFlushController, installApplicationLifecycle, tripEmbedRequest } from "../electron/main/security.js";
import { checkedTripEmbed, TRIP_EMBED_PATHS } from "../src/domain/tripEmbed.js";
import { secureWebPreferences } from "../electron/main/windows.js";
import { createIsolatedDirectory, removeIsolatedDirectory } from "./desktop/helpers.mjs";

test("test dialog queues cancel safely and never invoke the real shell", async () => {
  let realCalls = 0;
  const real = new Proxy({}, { get: () => () => { realCalls += 1; } });
  const dialogs = createDialogs({ dialog: real, shell: real, testHooksEnabled: true });
  assert.equal((await dialogs.showMessageBox(null, { buttons: ["打开", "取消"], cancelId: 1 })).response, 1);
  assert.equal((await dialogs.showSaveDialog(null, {})).canceled, true);
  assert.equal((await dialogs.showOpenDialog(null, {})).canceled, true);
  await dialogs.openPath("D:/test");
  await dialogs.openExternal("https://example.com");
  assert.equal(realCalls, 0);
  assert.deepEqual(dialogs.state.calls.map((call) => call.kind), ["showMessageBox", "showSaveDialog", "showOpenDialog", "openPath", "openExternal"]);
});

test("external links show the whole URL and open only after confirmation", async () => {
  const dialogs = createDialogs({ testHooksEnabled: true });
  const url = "https://example.com/path?x=1#section";
  assert.deepEqual(await confirmAndOpenExternal(null, url, { dialogs }), { opened: false });
  assert.equal(dialogs.state.calls[0].options.detail, url);
  assert.equal(dialogs.state.calls[0].options.defaultId, 1);
  dialogs.state.queue.showMessageBox.push({ response: 0 });
  assert.deepEqual(await confirmAndOpenExternal(null, url, { dialogs }), { opened: true });
  assert.equal(dialogs.state.calls.filter((call) => call.kind === "openExternal").length, 1);
  for (const value of ["file:///D:/secret", "javascript:alert(1)", "data:text/html,test", "https://user:password@example.com", "https://example.com\n", "not a url"]) assert.throws(() => validateExternalUrl(value), { code: "E_INVALID_ARGUMENT" });
});

test("app responses serve exact CSP and refuse encoded traversal", async (context) => {
  const directory = createIsolatedDirectory("app-protocol");
  context.after(() => removeIsolatedDirectory(directory));
  fs.writeFileSync(path.join(directory, "index.html"), "<p>local</p>");
  fs.writeFileSync(path.join(directory, "main.js"), "globalThis.local=true;");
  const response = createAppResponse(new Request("app://bundle/index.html"), { distDir: directory, csp: WORKSPACE_CSP });
  assert.equal(response.headers.get("content-security-policy"), WORKSPACE_CSP);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(await response.text(), "<p>local</p>");
  const script = createAppResponse(new Request("app://bundle/main.js"), { distDir: directory, csp: WORKSPACE_CSP });
  assert.equal(script.headers.get("content-security-policy"), null);
  assert.match(script.headers.get("content-type"), /^text\/javascript/);
  assert.equal(createAppResponse({ url: "app://bundle/%2e%2e/index.html", method: "GET" }, { distDir: directory, csp: WORKSPACE_CSP }).status, 404);
});

test("the opaque asset scheme enables secure fetch with CORS but never bypasses CSP", () => {
  let schemes;
  registerAppScheme({ registerSchemesAsPrivileged: (value) => { schemes = value; } });
  assert.deepEqual(schemes, [
    { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true } },
    { scheme: "life-asset", privileges: { standard: false, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
    { scheme: "life-widget", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
  ]);
  assert.equal(schemes.some((entry) => entry.privileges.bypassCSP), false);
});

test("navigation matches one exact entrypoint rather than a loose prefix", () => {
  const entry = "app://bundle/index.html";
  assert.equal(isAllowedNavigation(`${entry}#page/1`, entry), true);
  for (const url of ["app://bundle/vault.html", `${entry}.evil`, `${entry}?file=vault`, "file:///index.html", "app://evil/index.html"]) assert.equal(isAllowedNavigation(url, entry), false);
  const contents = new EventEmitter();
  contents.setWindowOpenHandler = (handler) => { contents.openWindow = handler; };
  const external = [];
  installContentsGuards(contents, { allowedPrefix: entry, onExternalUrl: (url) => external.push(url) });
  let prevented = false;
  contents.emit("will-navigate", { preventDefault: () => { prevented = true; } }, "https://example.com/");
  assert.equal(prevented, true);
  assert.deepEqual(contents.openWindow({ url: "https://example.com/" }), { action: "deny" });
  assert.equal(external.length, 2);
});

test("only the workspace may embed a verified Market frame as its direct child", () => {
  const entry = "app://bundle/index.html";
  const url = `life-widget://${"a".repeat(48)}/index.html`;
  const main = {};
  const frame = { parent: main };
  function permits(options, details) {
    const contents = new EventEmitter();
    contents.mainFrame = main;
    contents.setWindowOpenHandler = () => {};
    installContentsGuards(contents, { allowedPrefix: entry, ...options });
    let allowed = true;
    contents.emit("will-frame-navigate", { url, frame, initiator: main, isMainFrame: false, ...details, preventDefault: () => { allowed = false; } });
    return allowed;
  }
  assert.equal(permits({ widgetFrames: true }, {}), true);
  assert.equal(permits({}, {}), false);
  assert.equal(permits({ widgetFrames: true }, { initiator: frame }), false);
  assert.equal(permits({ widgetFrames: true }, { frame: { parent: frame } }), false);
  assert.equal(permits({ widgetFrames: true }, { url: "app://bundle/setup.html" }), false);
  assert.equal(WORKSPACE_CSP.match(/frame-src ([^;]+)/u)[1], ["life-widget:", ...TRIP_EMBED_PATHS].join(" "));
  const map = TRIP_EMBED_PATHS[0] + "?lng=104&lat=35&zoom=4&platform=pc&src=LifeAtlas";
  assert.equal(permits({ widgetFrames: true }, { url: map }), true);
  assert.equal(permits({ widgetFrames: true }, { url: map, initiator: frame }), false);
  assert.equal(permits({ widgetFrames: true }, { url: map, frame: { parent: frame } }), false);
  assert.match(VAULT_CSP, /frame-src 'none';/u);
});

test("official map resources are confined to authenticated direct provider frames", () => {
  const local = "app://bundle/index.html";
  const url = "https://www.amap.com/ssr/embed/view?lng=104&lat=35&zoom=4&platform=pc&src=LifeAtlas";
  const workspace = { url: local };
  const remote = { url, parent: workspace };
  const tile = { url:"https://jsapi-data2.amap.com/tile/1", resourceType:"xhr", frame:remote };
  assert.equal(checkedTripEmbed(url), url);
  for (const bad of [url + "&src=a", url + "&callback=foo", url.replace("lat=35","lat=92"), url.replace("/view", "/script"), url.replace("www.", "user@www.")]) assert.equal(checkedTripEmbed(bad), null);
  assert.equal(tripEmbedRequest(tile, local), true);
  assert.equal(tripEmbedRequest({ ...tile, frame:workspace }, local), null);
  assert.equal(tripEmbedRequest({ ...tile, frame:{url:"life-widget://id/index.html",parent:workspace} }, local), null);
  assert.equal(tripEmbedRequest({ ...tile, frame:{url,parent:remote} }, local), null);
  for (const blocked of ["app://bundle/vault.html", "life-asset://file", "file:///C:/config", "https://jsapi-data2.amap.com.example.com/", "http://jsapi-data2.amap.com/"]) assert.equal(tripEmbedRequest({...tile,url:blocked}, local), false);
  assert.equal(tripEmbedRequest({...tile,url:"https://www.amap.com/",resourceType:"subFrame"},local), false);
  const imagery = { ...tile, method:"GET", resourceType:"image", url:"https://webst02.is.autonavi.com/appmaptile?x=1&y=2&z=3" };
  assert.equal(tripEmbedRequest(imagery, local), true);
  for (const change of [{method:"POST"}, {resourceType:"script"}, {url:"https://webst06.is.autonavi.com/appmaptile"},
    {url:"https://wprd02.is.autonavi.com/other"}]) assert.equal(tripEmbedRequest({...imagery,...change}, local), false);
});

test("session security blocks networking, permissions and spellcheck in both sessions", () => {
  const target = new EventEmitter();
  target.webRequest = { onBeforeRequest: (callback) => { target.before = callback; }, onCompleted: (callback) => { target.completed = callback; } };
  target.setPermissionRequestHandler = (callback) => { target.permission = callback; };
  target.setPermissionCheckHandler = (callback) => { target.checkPermission = callback; };
  target.setSpellCheckerEnabled = (value) => { target.spellcheck = value; };
  target.setSpellCheckerLanguages = (value) => { target.languages = value; };
  const log = { blocked: [], completed: [] };
  installSessionSecurity(target, { networkLog: log, allowClipboard: false });
  let blocked;
  target.before({ url: "https://example.com/private-path" }, (result) => { blocked = result.cancel; });
  assert.equal(blocked, true);
  assert.equal(log.blocked.length, 1);
  assert.equal(target.checkPermission(null, "clipboard-sanitized-write"), false);
  assert.equal(target.checkPermission(null, "media"), false);
  assert.equal(target.spellcheck, false);
  assert.deepEqual(target.languages, []);
  assert.ok(VAULT_CSP.includes("connect-src 'none'"));
});

test("packaged windows cannot enable node, webviews, spellcheck or devtools", () => {
  const preferences = secureWebPreferences({ preload: "test.cjs", isPackaged: true, partition: "vault" });
  assert.equal(preferences.sandbox, true);
  assert.equal(preferences.contextIsolation, true);
  for (const key of ["nodeIntegration", "nodeIntegrationInWorker", "webviewTag", "spellcheck", "devTools", "allowRunningInsecureContent", "experimentalFeatures"]) assert.equal(preferences[key], false);
  assert.equal(preferences.partition, "vault");
});

test("flush waits for successful acknowledgement and timeout cancels normal close", async () => {
  const sent = [];
  const window = { isDestroyed: () => false, webContents: { isDestroyed: () => false, send: (channel) => sent.push(channel) } };
  let timedOut = 0;
  const controller = createFlushController({ getWindow: () => window, timeoutMs: 15, onTimeout: () => { timedOut += 1; } });
  const saved = controller.request();
  assert.equal(controller.request(), saved);
  assert.equal(controller.pending, true);
  controller.acknowledge();
  assert.equal(await saved, true);
  assert.equal(await controller.request(), false);
  assert.equal(timedOut, 1);
  assert.deepEqual(sent, ["la:app:flush-request", "la:app:flush-request"]);
});

test("quit locks the vault immediately but closes storage only after an acknowledged flush", async () => {
  const app = new EventEmitter();
  let quitCalls = 0;
  app.quit = () => { quitCalls += 1; };
  const locks = [];
  let closeCalls = 0;
  let resolveFlush;
  const flushController = { request: () => new Promise((resolve) => { resolveFlush = resolve; }), cancel: () => {} };
  const lifecycle = installApplicationLifecycle({ app, flushController, lockVault: (reason) => locks.push(reason), shutdown: () => { closeCalls += 1; } });
  let prevented = false;
  app.emit("before-quit", { preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  assert.deepEqual(locks, ["app-quit"]);
  assert.equal(closeCalls, 0);
  await Promise.resolve();
  resolveFlush(true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(closeCalls, 1);
  assert.equal(quitCalls, 1);
  assert.equal(lifecycle.permittingQuit, true);
  lifecycle.dispose();
});

test("failed flush does not discard edits or close a window", async () => {
  const app = new EventEmitter();
  app.quit = () => { throw new Error("must not quit"); };
  const window = new EventEmitter();
  window.isDestroyed = () => false;
  let closed = 0;
  window.close = () => { closed += 1; };
  const lifecycle = installApplicationLifecycle({ app, flushController: { request: async () => false, cancel: () => {} } });
  lifecycle.attachWorkspaceWindow(window);
  let prevented = false;
  window.emit("close", { preventDefault: () => { prevented = true; } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(prevented, true);
  assert.equal(closed, 0);
  assert.equal(lifecycle.permittingQuit, false);
  lifecycle.dispose();
});

test("quit awaits asynchronous vault cleanup before flushing and closing storage", async (context) => {
  const app = new EventEmitter();
  const sequence = [];
  const cleanup = Promise.withResolvers();
  app.quit = () => sequence.push("quit");
  const lifecycle = installApplicationLifecycle({
    app,
    flushController: { request: async () => { sequence.push("flush"); return true; }, cancel: () => {} },
    lockVault: () => { sequence.push("lock"); return cleanup.promise; },
    shutdown: () => sequence.push("shutdown"),
  });
  context.after(() => { cleanup.resolve(); lifecycle.dispose(); });
  let prevented = false;
  app.emit("before-quit", { preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  assert.deepEqual(sequence, ["lock"]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(sequence, ["lock"]);
  cleanup.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(sequence, ["lock", "flush", "shutdown", "quit"]);
  assert.equal(lifecycle.permittingQuit, true);
});

test("workspace close awaits asynchronous vault cleanup before closing the window", async (context) => {
  const app = new EventEmitter();
  const window = new EventEmitter();
  const sequence = [];
  const cleanup = Promise.withResolvers();
  app.quit = () => sequence.push("quit");
  window.isDestroyed = () => false;
  window.close = () => sequence.push("close");
  const lifecycle = installApplicationLifecycle({
    app,
    flushController: { request: async () => { sequence.push("flush"); return true; }, cancel: () => {} },
    lockVault: () => { sequence.push("lock"); return cleanup.promise; },
  });
  lifecycle.attachWorkspaceWindow(window);
  context.after(() => { cleanup.resolve(); lifecycle.dispose(); });
  let prevented = false;
  window.emit("close", { preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  assert.deepEqual(sequence, ["lock"]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(sequence, ["lock"]);
  cleanup.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(sequence, ["lock", "flush", "close"]);
});
