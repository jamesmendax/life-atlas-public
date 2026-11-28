import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createHash } from "node:crypto";
import { areTestHooksEnabled } from "../electron/main/flavor.js";
import { assertPhysicalPath, bootstrapFilePath, ensureDataRootMarker, acquireDataRootLock, releaseDataRootLock, resolveDataRoot, isPathInside } from "../electron/main/storage/dataRoot.js";
import { createDataRootMoveService } from "../electron/main/dataRootMove.js";
import { createLocalePreferences } from "../electron/main/localePreferences.js";
import { createIsolatedDirectory, removeIsolatedDirectory } from "./desktop/helpers.mjs";

function fixture(context) {
  const root = createIsolatedDirectory("release-startup-isolation");
  context.after(() => removeIsolatedDirectory(root));
  return { root, dataRoot: path.join(root, "data"), bootstrapDir: path.join(root, "test-bootstrap") };
}

test("release explicit data roots derive bootstrap inside their own runtime without reading test overrides", (context) => {
  const { dataRoot } = fixture(context);
  const env = {
    LIFE_ATLAS_DATA_ROOT: dataRoot,
    LIFE_ATLAS_TEST: "1",
    get LIFE_ATLAS_BOOTSTRAP_DIR() { throw new Error("Release cannot read a test bootstrap override"); },
  };
  const testHooksEnabled = areTestHooksEnabled("release", env);
  assert.equal(testHooksEnabled, false);
  const file = bootstrapFilePath({ env, testHooksEnabled, getAppDataDir: () => { throw new Error("Explicit-root startup cannot consult default appData"); } });
  assert.equal(file, path.join(dataRoot, "runtime", "bootstrap", "bootstrap.json"));
  assert.deepEqual(resolveDataRoot({ env, bootstrapFile: file, flavor: "release" }), { dataRoot, source: "env" });
  assert.equal(fs.existsSync(dataRoot), false);
});

test("actual release prepareStartup and data-root mover construction remain inside the explicit root", (context) => {
  const { root, dataRoot } = fixture(context);
  const source = fs.readFileSync(new URL("../electron/main/index.js", import.meta.url), "utf8");
  const start = source.indexOf("function prepareStartup(");
  const end = source.indexOf("\nfunction developmentUrl()", start);
  assert.ok(start >= 0 && end > start, "Execute the actual startup function");
  const env = { LIFE_ATLAS_DATA_ROOT: dataRoot, LIFE_ATLAS_TEST: "1" };
  const runtimePaths = new Map();
  const startupEvents = [];
  const realm = vm.createContext({
    fs,
    path,
    process: { env, execPath: path.join(root, "program", "Life Atlas.exe"), pid: process.pid },
    app: {
      isPackaged: true,
      getPath() { throw new Error("Explicit-root startup consulted default appData"); },
      setPath(name, value) { assert.ok(isPathInside(dataRoot, value)); runtimePaths.set(name, value); },
      requestSingleInstanceLock: () => true,
      on: (name) => startupEvents.push(name),
    },
    flavor: "release",
    testHooksEnabled: areTestHooksEnabled("release", env),
    appRoot: root,
    appVersion: "1.0.0",
    now: () => "2026-11-07T00:00:00.000Z",
    assertPhysicalPath,
    bootstrapFilePath: (options) => bootstrapFilePath({ ...options, env }),
    resolveDataRoot: (options) => resolveDataRoot({ ...options, env }),
    ensureDataRootMarker,
    acquireDataRootLock,
    isPathInside,
    processIsAlive: () => false,
    createLogger: ({ logsDir }) => { assert.ok(isPathInside(dataRoot, logsDir)); return { log: (event) => startupEvents.push(event) }; },
    protocol: {},
    registerAppScheme: () => startupEvents.push("protocol.registered"),
    StorageError: Error,
  });
  let result;
  try {
    result = vm.runInContext(`let dataRoot, dataRootSource, bootstrapFile, rootLockHeld = false, logger; ${source.slice(start, end)}; ({ started: prepareStartup(), dataRoot, bootstrapFile, rootLockHeld })`, realm);
  } finally {
    if (fs.existsSync(dataRoot)) releaseDataRootLock(dataRoot, process.pid);
  }
  assert.equal(result.started, true);
  assert.equal(result.dataRoot, dataRoot);
  assert.equal(result.rootLockHeld, true);
  assert.equal(result.bootstrapFile, path.join(dataRoot, "runtime", "bootstrap", "bootstrap.json"));
  assert.deepEqual([...runtimePaths], [["userData", path.join(dataRoot, "runtime")], ["sessionData", path.join(dataRoot, "runtime")], ["crashDumps", path.join(dataRoot, "runtime", "crashes")]]);
  assert.ok(startupEvents.includes("app.start"));
  assert.ok(startupEvents.includes("protocol.registered"));
  const mover = createDataRootMoveService({ dataRoot, bootstrapFile: result.bootstrapFile });
  assert.equal(typeof mover.changeDataRoot, "function");
  assert.equal(fs.existsSync(result.bootstrapFile), false);
});

test("authorized test bootstrap overrides retain priority without consulting appData", (context) => {
  const { dataRoot, bootstrapDir } = fixture(context);
  const env = { LIFE_ATLAS_DATA_ROOT: dataRoot, LIFE_ATLAS_BOOTSTRAP_DIR: bootstrapDir };
  const file = bootstrapFilePath({ env, testHooksEnabled: true, getAppDataDir: () => { throw new Error("Test startup cannot consult default appData"); } });
  assert.equal(file, path.join(bootstrapDir, "bootstrap.json"));
});

test("ordinary release startup keeps the established bootstrap location and ignores test overrides", (context) => {
  const { root } = fixture(context);
  const env = { get LIFE_ATLAS_BOOTSTRAP_DIR() { throw new Error("Unauthorized override was read"); } };
  const file = bootstrapFilePath({ appDataDir: root, env, testHooksEnabled: false });
  assert.equal(file, path.join(root, "Life Atlas", "bootstrap.json"));
  assert.deepEqual(resolveDataRoot({ env, bootstrapFile: file, flavor: "release" }), { dataRoot: null, source: null });
});

test("invalid explicit roots are rejected before consulting default appData", (context) => {
  const { root } = fixture(context);
  for (const invalid of ["relative-data", `${root}\u0000`]) {
    assert.throws(() => bootstrapFilePath({ env: { LIFE_ATLAS_DATA_ROOT: invalid }, testHooksEnabled: false, getAppDataDir: () => { throw new Error("Invalid explicit root fell back to appData"); } }), { code: "E_INVALID_ARGUMENT" });
  }
});

test("preview uses isolated runtime paths for a damaged bootstrap or unusable workspace", (context) => {
  const { root } = fixture(context);
  const source = fs.readFileSync(new URL("../electron/main/index.js", import.meta.url), "utf8");
  const start = source.indexOf("function prepareStartup(");
  const end = source.indexOf("\nfunction developmentUrl()", start);
  assert.ok(start >= 0 && end > start);
  const previewFile = path.join(root, "document.md");
  for (const fault of ["bootstrap", "runtime"]) {
    const base = path.join(root, fault);
    const appDataDir = path.join(base, "app-data");
    const temp = path.join(base, "temporary");
    const dataRoot = path.join(base, "workspace");
    fs.mkdirSync(path.join(appDataDir, "Life Atlas"), { recursive: true });
    fs.mkdirSync(temp);
    ensureDataRootMarker(dataRoot, { appVersion: "1.6.0", now: "2026-11-27T00:00:00.000Z" });
    const sentinel = path.join(dataRoot, "runtime");
    fs.writeFileSync(sentinel, "existing file");
    const file = path.join(appDataDir, "Life Atlas", "bootstrap.json");
    const bootstrap = fault === "bootstrap" ? "{ damaged configuration" : JSON.stringify({ dataRoot });
    fs.writeFileSync(file, bootstrap);
    const paths = new Map();
    let delivered;
    const realm = vm.createContext({
      fs, path, os: { tmpdir: () => temp }, createHash,
      process: { env: {}, execPath: path.join(root, "program", "Life Atlas.exe") },
      app: {
        isPackaged: true, getPath: () => appDataDir, setPath: (name, value) => paths.set(name, value),
        requestSingleInstanceLock: (data) => { delivered = data; return true; },
      },
      appRoot: root, flavor: "release", testHooksEnabled: false, protocol: {}, registerAppScheme() {},
      preview: { selected: [previewFile], overflow: 0 },
      assertPhysicalPath, bootstrapFilePath, resolveDataRoot, isPathInside, ensureDataRootMarker, StorageError: Error,
    });
    const result = vm.runInContext(`let dataRoot, dataRootSource, bootstrapFile, setupTempParent, setupTempDir;
      ${source.slice(start, end)}; ({ started: prepareStartup(preview), dataRoot, bootstrapFile })`, realm);
    assert.equal(result.started, true);
    assert.equal(result.dataRoot, undefined);
    assert.equal(result.bootstrapFile, undefined);
    assert.deepEqual([...delivered.markdownPreview.selected], [previewFile]);
    assert.equal(paths.size, 3);
    for (const directory of paths.values()) assert.ok(isPathInside(temp, directory));
    assert.throws(() => vm.runInContext("loadWorkspaceLocation(); prepareWorkspaceRuntime()", realm), {
      code: fault === "bootstrap" ? "E_CORRUPT" : "E_INVALID_ARGUMENT",
    });
    assert.equal(fs.readFileSync(file, "utf8"), bootstrap);
    assert.equal(fs.readFileSync(sentinel, "utf8"), "existing file");
    assert.deepEqual(fs.readdirSync(dataRoot).sort(), ["life-atlas.root.json", "runtime"]);
  }
});

function actualRootRelaunch({ env, relaunch, defaultApp = false, argv = [], appRoot = "unused-app" }) {
  const source = fs.readFileSync(new URL("../electron/main/index.js", import.meta.url), "utf8");
  const start = source.indexOf("const dataRootMover = createDataRootMoveService({");
  const end = source.indexOf("\n  });", start);
  const relaunchStart = source.indexOf("function relaunchWorkspace()");
  const relaunchEnd = source.indexOf("\nfunction developmentUrl()", relaunchStart);
  assert.ok(start >= 0 && end > start, "Execute the actual data-root mover wiring");
  assert.ok(relaunchStart >= 0 && relaunchEnd > relaunchStart);
  const realm = vm.createContext({
    process: { env, defaultApp, argv },
    appRoot,
    app: { relaunch },
    dataRoot: env.LIFE_ATLAS_DATA_ROOT,
    bootstrapFile: env.LIFE_ATLAS_DATA_ROOT ? bootstrapFilePath({ env }) : "unused",
    workspaceBootstrapFile: () => bootstrapFilePath({ env }),
    createLocalePreferences,
    localePreferences: { get: () => ({ locale: "ja-JP" }) },
    now: () => "2026-11-07T00:00:00.000Z",
    dialogs: {},
    testHooksEnabled: false,
    flushController: {},
    createDataRootMoveService: (options) => options.relaunch,
  });
  return vm.runInContext(`${source.slice(relaunchStart, relaunchEnd)}; ${source.slice(start, end + 6)}; dataRootMover`, realm);
}

test("workspace relaunch drops inherited Markdown arguments for both setup and data-root relocation", (context) => {
  const { root, dataRoot } = fixture(context);
  const source = fs.readFileSync(new URL("../electron/main/index.js", import.meta.url), "utf8");
  const start = source.indexOf("setupService = createSetupService({");
  const end = source.indexOf("\n    });", start);
  const helperStart = source.indexOf("function relaunchWorkspace()");
  const helperEnd = source.indexOf("\nfunction developmentUrl()", helperStart);
  assert.ok(start >= 0 && end > start && helperStart >= 0 && helperEnd > helperStart);
  for (const defaultApp of [false, true]) {
    const argv = [path.join(root, "desktop.exe"), ...(defaultApp ? [root] : []), "--markdown-preview", path.join(root, "document.md")];
    const expected = defaultApp ? [root] : [];
    const calls = [];
    const relaunch = (options) => calls.push([...options.args]);
    actualRootRelaunch({ env: {}, relaunch, defaultApp, argv, appRoot: root })(dataRoot);
    const realm = vm.createContext({
      process: { defaultApp, argv, execPath: argv[0] }, app: { relaunch }, appRoot: root, path,
      setupTempDir: root, bootstrapFile: "bootstrap.json", appVersion: "1.6.0", dialogs: {}, testHooksEnabled: false,
      now() {}, createBackupService() {}, createSetupService: ({ relaunch }) => relaunch,
    });
    vm.runInContext(`let setupService, logger; ${source.slice(helperStart, helperEnd)};
      ${source.slice(start, end + 7)}; setupService();`, realm);
    assert.deepEqual(calls, [expected, expected]);
  }
});

test("explicit-root relocation passes the copied target into the real relaunch wiring", async (context) => {
  const { root, dataRoot } = fixture(context);
  const target = path.join(root, "moved");
  ensureDataRootMarker(dataRoot, { appVersion: "1.0.0", now: "2026-11-07T00:00:00.000Z" });
  fs.writeFileSync(path.join(dataRoot, "workspace.db"), "untouched workspace");
  const env = { LIFE_ATLAS_DATA_ROOT: dataRoot };
  const launchedRoots = [];
  const relaunch = actualRootRelaunch({ env, relaunch: () => launchedRoots.push(env.LIFE_ATLAS_DATA_ROOT) });
  const service = createDataRootMoveService({
    dataRoot,
    bootstrapFile: bootstrapFilePath({ env, testHooksEnabled: false }),
    dialogs: { showOpenDialog: async () => ({ filePaths: [target] }), showMessageBox: async () => ({ response: 0 }) },
    requestFlush: async () => true,
    relaunch,
    exit: () => {},
    now: "2026-11-07T00:00:00.000Z",
  });
  assert.deepEqual(await service.changeDataRoot(), { changed: true });
  assert.deepEqual(launchedRoots, [target]);
  assert.equal(env.LIFE_ATLAS_DATA_ROOT, target);
  assert.deepEqual(resolveDataRoot({ env, flavor: "release" }), { dataRoot: target, source: "env" });
  assert.deepEqual(createLocalePreferences({ bootstrapFile: bootstrapFilePath({ env }) }).get(), { locale: "ja-JP" });
  assert.equal(fs.readFileSync(path.join(dataRoot, "workspace.db"), "utf8"), "untouched workspace");
  assert.equal(fs.readFileSync(path.join(target, "workspace.db"), "utf8"), "untouched workspace");
});

test("failed explicit-root relaunch restores the original environment", (context) => {
  const { root, dataRoot } = fixture(context);
  const target = path.join(root, "moved");
  const env = { LIFE_ATLAS_DATA_ROOT: dataRoot };
  const observed = [];
  const relaunch = actualRootRelaunch({ env, relaunch: () => { observed.push(env.LIFE_ATLAS_DATA_ROOT); throw new Error("Relaunch rejected"); } });
  assert.throws(() => relaunch(target), /Relaunch rejected/);
  assert.deepEqual(observed, [target]);
  assert.equal(env.LIFE_ATLAS_DATA_ROOT, dataRoot);
});

test("normal bootstrap-based relocation does not introduce an explicit environment override", (context) => {
  const { dataRoot } = fixture(context);
  const env = {};
  let launched = 0;
  const relaunch = actualRootRelaunch({ env, relaunch: () => { launched += 1; } });
  relaunch(dataRoot);
  assert.equal(launched, 1);
  assert.deepEqual(env, {});
});
