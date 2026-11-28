import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import vm from "node:vm";
import * as windows from "../electron/main/windows.js";
import * as desktopHelpers from "./desktop/helpers.mjs";
import { resolveFlavor, areTestHooksEnabled } from "../electron/main/flavor.js";
import { FIXTURE_TIME } from "./fixtures/full-workspace.mjs";

function configuredWindows({ enabled = true, load = async () => {} } = {}) {
  const created = [];
  const events = [];
  class BrowserWindow extends EventEmitter {
    constructor(options) {
      super();
      this.id = created.length + 1;
      this.options = options;
      this.webContents = new EventEmitter();
      this.webContents.setWindowOpenHandler = (handler) => { this.openHandler = handler; };
      this.urls = [];
      created.push(this);
    }
    setMenuBarVisibility(value) { this.menuBarVisible = value; }
    isDestroyed() { return false; }
    show() { this.shown = true; }
    setContentProtection(value) { this.contentProtected = value; }
    async loadURL(url) { this.urls.push(url); return url === "about:blank" ? undefined : load(url); }
  }
  windows.configureWindows({ BrowserWindow, nativeTheme: { shouldUseDarkColors: false }, isPackaged: !enabled, testHooksEnabled: enabled, logger: { log: (name, fields) => events.push({ name, fields }) } });
  return { created, events };
}

test("release and unauthorized startup cannot read or enable the deferred workspace flag", () => {
  assert.equal(typeof windows.shouldDeferWorkspaceStartup, "function");
  const env = { LIFE_ATLAS_TEST: "1", LIFE_ATLAS_TEST_DEFER_WORKSPACE_LOAD: "1" };
  const release = resolveFlavor({ isPackaged: true, packageJson: { lifeAtlasBuildFlavor: "release" } });
  assert.equal(areTestHooksEnabled(release, env), false);
  const unreadable = new Proxy({}, { get() { throw new Error("release read a test-only flag"); } });
  assert.equal(windows.shouldDeferWorkspaceStartup({ testHooksEnabled: false, env: unreadable }), false);
  assert.equal(windows.shouldDeferWorkspaceStartup({ testHooksEnabled: true, env: {} }), false);
  assert.equal(windows.shouldDeferWorkspaceStartup({ testHooksEnabled: true, env: { LIFE_ATLAS_TEST_DEFER_WORKSPACE_LOAD: "true" } }), false);
  assert.equal(windows.shouldDeferWorkspaceStartup({ testHooksEnabled: true, env }), true);
  configuredWindows({ enabled: false });
  const hooks = {};
  const window = windows.createWorkspaceWindow({ preload: "workspace.cjs", url: "app://bundle/index.html", deferLoad: true, testHooks: hooks });
  assert.deepEqual(window.urls, ["app://bundle/index.html"]);
  assert.equal(Object.hasOwn(hooks, "loadWorkspaceForTest"), false);
});

test("authorized deferred workspace loads its trusted URL once without accepting arguments", async () => {
  configuredWindows();
  const hooks = {};
  const window = windows.createWorkspaceWindow({ preload: "workspace.cjs", url: "app://bundle/index.html", deferLoad: true, testHooks: hooks });
  assert.deepEqual(window.urls, ["about:blank"]);
  assert.equal(typeof hooks.loadWorkspaceForTest, "function");
  assert.equal(hooks.loadWorkspaceForTest.length, 0);
  await assert.rejects(() => hooks.loadWorkspaceForTest("https://example.invalid/"), TypeError);
  assert.deepEqual(window.urls, ["about:blank"]);
  await hooks.loadWorkspaceForTest();
  assert.deepEqual(window.urls, ["about:blank", "app://bundle/index.html"]);
  await assert.rejects(() => hooks.loadWorkspaceForTest(), /already|已/);
  assert.deepEqual(window.urls, ["about:blank", "app://bundle/index.html"]);
  assert.equal(window.options.webPreferences.sandbox, true);
  assert.equal(window.options.webPreferences.contextIsolation, true);
  assert.equal(window.options.webPreferences.nodeIntegration, false);
});

test("deferred workspace startup waits for navigation and renderer readiness before resolving", async () => {
  let finishNavigation;
  let finishReady;
  let readyStarted = false;
  configuredWindows({ load: () => new Promise((resolve) => { finishNavigation = resolve; }) });
  const hooks = {};
  const window = windows.createWorkspaceWindow({ preload: "workspace.cjs", url: "app://bundle/index.html", deferLoad: true, testHooks: hooks, onDeferredLoaded: () => { readyStarted = true; return new Promise((resolve) => { finishReady = resolve; }); } });
  assert.equal(typeof hooks.loadWorkspaceForTest, "function");
  let settled = false;
  const pending = hooks.loadWorkspaceForTest().then(() => { settled = true; });
  assert.deepEqual(window.urls, ["about:blank"]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(window.urls, ["about:blank", "app://bundle/index.html"]);
  await assert.rejects(() => hooks.loadWorkspaceForTest(), /already|已/);
  assert.equal(readyStarted, false);
  finishNavigation();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(readyStarted, true);
  assert.equal(settled, false);
  finishReady();
  await pending;
  assert.equal(settled, true);
});

test("deferred navigation failures are reported and cannot be silently retried", async () => {
  const failure = new Error("fixture navigation failed");
  const { events } = configuredWindows({ load: async () => { throw failure; } });
  let ready = false;
  const hooks = {};
  const window = windows.createWorkspaceWindow({ preload: "workspace.cjs", url: "app://bundle/index.html", deferLoad: true, testHooks: hooks, onDeferredLoaded: () => { ready = true; } });
  assert.equal(typeof hooks.loadWorkspaceForTest, "function");
  await assert.rejects(() => hooks.loadWorkspaceForTest(), (error) => error === failure);
  assert.equal(ready, false);
  assert.deepEqual(window.urls, ["about:blank", "app://bundle/index.html"]);
  assert.deepEqual(events.filter((entry) => entry.name === "window.load-failed"), [{ name: "window.load-failed", fields: { code: "E_IO" } }]);
  await assert.rejects(() => hooks.loadWorkspaceForTest(), /already|已/);
  assert.deepEqual(window.urls, ["about:blank", "app://bundle/index.html"]);
});

test("the test workspace loader does not defer setup or vault windows", () => {
  configuredWindows();
  const hooks = {};
  const setup = windows.createSetupWindow({ preload: "setup.cjs", url: "app://bundle/setup.html", deferLoad: true, testHooks: hooks });
  const vault = windows.createVaultWindow({ preload: "vault.cjs", url: "app://bundle/vault.html", deferLoad: true, testHooks: hooks });
  assert.deepEqual(setup.urls, ["app://bundle/setup.html"]);
  assert.deepEqual(vault.urls, ["app://bundle/vault.html"]);
  assert.equal(Object.hasOwn(hooks, "loadWorkspaceForTest"), false);
  assert.equal(vault.contentProtected, true);
  assert.equal(vault.options.webPreferences.partition, "vault");
});

test("deferred startup initializes only about blank and never shows its blank window", async () => {
  configuredWindows();
  const hooks = {};
  const window = windows.createWorkspaceWindow({ preload: "workspace.cjs", url: "app://bundle/index.html", deferLoad: true, testHooks: hooks });
  assert.deepEqual(window.urls, ["about:blank"]);
  window.emit("ready-to-show");
  assert.notEqual(window.shown, true);
  let prevented = false;
  window.webContents.emit("will-navigate", { preventDefault() { prevented = true; } }, "https://example.invalid/");
  assert.equal(prevented, true);
  assert.deepEqual(window.openHandler({ url: "https://example.invalid/" }), { action: "deny" });
  await hooks.loadWorkspaceForTest();
  assert.deepEqual(window.urls, ["about:blank", "app://bundle/index.html"]);
  assert.equal(window.shown, true);
});

test("completed deferred navigation bypasses only the already finished load event wait", () => {
  const main = fs.readFileSync(new URL("../electron/main/index.js", import.meta.url), "utf8");
  assert.match(main, /if \(!navigationComplete && window\.webContents\.isLoadingMainFrame\(\)\)/);
  assert.match(main, /onDeferredLoaded: async \(\) => \{ await waitForRendererReady\(workspaceWindow, "data-la-ready", \{ navigationComplete: true \}\); workspaceStartupReady = true; \}/);
  assert.equal((main.match(/navigationComplete: true/g) || []).length, 1);
  assert.match(main, /if \(!ready \|\| window\.isDestroyed\(\)\) throw new StorageError/);
});

test("fixed workspace Date preserves native Date APIs without patching timers or performance", () => {
  assert.equal(typeof desktopHelpers.installWorkspaceFixedDate, "function");
  const performanceClock = { now: () => 42, timeOrigin: 12345 };
  const realm = vm.createContext({ setTimeout, clearTimeout, setInterval, clearInterval, performance: performanceClock });
  const OriginalDate = vm.runInContext("Date", realm);
  const OriginalIntl = vm.runInContext("Intl", realm);
  const fixed = Date.parse(FIXTURE_TIME);
  vm.runInContext(`(${desktopHelpers.installWorkspaceFixedDate.toString()})(${fixed})`, realm);
  assert.equal(vm.runInContext("Date.now()", realm), fixed);
  assert.equal(vm.runInContext("new Date().toISOString()", realm), FIXTURE_TIME);
  assert.equal(vm.runInContext("Date()", realm), new OriginalDate(fixed).toString());
  assert.equal(vm.runInContext("Date(0)", realm), new OriginalDate(fixed).toString());
  assert.equal(vm.runInContext("new Date(0).getTime()", realm), 0);
  assert.equal(vm.runInContext("new Date(null).getTime()", realm), 0);
  assert.equal(Number.isNaN(vm.runInContext("new Date(undefined).getTime()", realm)), true);
  assert.equal(vm.runInContext("new Date(2026, 0, 2, 3, 4, 5, 6).getTime()", realm), new OriginalDate(2026, 0, 2, 3, 4, 5, 6).getTime());
  assert.equal(vm.runInContext(`Date.parse(${JSON.stringify(FIXTURE_TIME)})`, realm), fixed);
  assert.equal(vm.runInContext("Date.UTC(2026, 0, 2, 3, 4, 5, 6)", realm), OriginalDate.UTC(2026, 0, 2, 3, 4, 5, 6));
  assert.equal(vm.runInContext("Date.prototype", realm), OriginalDate.prototype);
  assert.equal(vm.runInContext("new Date() instanceof Date", realm), true);
  assert.equal(vm.runInContext("Object.prototype.toString.call(new Date())", realm), "[object Date]");
  assert.equal(vm.runInContext("Date.name", realm), "Date");
  assert.equal(vm.runInContext("Date.length", realm), 7);
  assert.equal(vm.runInContext("Date.toString()", realm), OriginalDate.toString());
  assert.equal(vm.runInContext("(() => { class ExtendedDate extends Date {} const value = new ExtendedDate(); return value instanceof ExtendedDate && value.getTime() === Date.now(); })()", realm), true);
  assert.equal(realm.setTimeout, setTimeout);
  assert.equal(realm.clearTimeout, clearTimeout);
  assert.equal(realm.setInterval, setInterval);
  assert.equal(realm.clearInterval, clearInterval);
  assert.equal(realm.performance, performanceClock);
  assert.equal(vm.runInContext("performance.now()", realm), 42);
  assert.equal(vm.runInContext("Intl", realm), OriginalIntl);
  assert.throws(() => vm.runInContext(`(${desktopHelpers.installWorkspaceFixedDate.toString()})(NaN)`, vm.createContext({})), /time|时间/);
});

test("page local fixed workspace time survives reloads without changing vault or setup realms", async () => {
  assert.equal(typeof desktopHelpers.setWorkspaceFixedTime, "function");
  const scripts = [];
  const createRealm = () => vm.createContext({ setTimeout, clearTimeout, performance: { now: () => 73 } });
  let workspace = createRealm();
  const vault = createRealm();
  const setup = createRealm();
  const vaultDate = vm.runInContext("Date", vault);
  const setupDate = vm.runInContext("Date", setup);
  const page = {
    async addInitScript(callback, value) { scripts.push({ callback, value }); },
    async evaluate(callback, value) { return vm.runInContext(`(${callback.toString()})(${JSON.stringify(value)})`, workspace); },
    context() { throw new Error("Fixed Date must not reach the shared BrowserContext"); },
  };
  await desktopHelpers.setWorkspaceFixedTime(page, new Date(FIXTURE_TIME));
  assert.equal(scripts.length, 1);
  assert.equal(vm.runInContext("Date.now()", workspace), Date.parse(FIXTURE_TIME));
  assert.equal(vm.runInContext("Date", vault), vaultDate);
  assert.equal(vm.runInContext("Date", setup), setupDate);
  assert.ok(Math.abs(vm.runInContext("Date.now()", vault) - Date.now()) < 1000);
  assert.ok(Math.abs(vm.runInContext("Date.now()", setup) - Date.now()) < 1000);
  workspace = createRealm();
  for (const { callback, value } of scripts) await page.evaluate(callback, value);
  assert.equal(vm.runInContext("new Date().toISOString()", workspace), FIXTURE_TIME);
  assert.equal(workspace.setTimeout, setTimeout);
  assert.equal(vm.runInContext("performance.now()", workspace), 73);
  await assert.rejects(() => desktopHelpers.setWorkspaceFixedTime(page, "invalid-time"), /time|时间/);
  assert.equal(scripts.length, 1);
});

test("fixed startup uses page local Date before navigation and reserves context clock for running mode", () => {
  const helper = fs.readFileSync(new URL("./desktop/helpers.mjs", import.meta.url), "utf8");
  assert.match(helper, /if \(clock\.mode === "fixed"\) await setWorkspaceFixedTime\(page, clock\.time\);/);
  assert.doesNotMatch(helper, /page\.clock\.setFixedTime/);
  assert.match(helper, /else await page\.clock\.install\(\{ time: clock\.time \}\);/);
  assert.ok(helper.indexOf('if (clock.mode === "fixed")') < helper.indexOf("if (deferred) await app.evaluate"));
});
