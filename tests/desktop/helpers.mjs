import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { execFile, execFileSync } from "node:child_process";
import { assertPhysicalPath, ensureDataRootMarker, isPathInside } from "../../electron/main/storage/dataRoot.js";
import { initializeWorkspace, openWorkspaceDatabase, prepareWritable } from "../../electron/main/storage/workspaceDb.js";
import { normalizeLoadedWorkspace } from "../../src/persistence/normalize.js";
import { RUNTIME_ROOT } from "../../scripts/runtime-paths.mjs";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const PACKAGED_EXE = path.join(REPO_ROOT, "release/test/win-unpacked/Life Atlas.exe");
export const TASK_RUNTIME_ROOT = RUNTIME_ROOT;
const ownedDirectories = new Set();
const require = createRequire(import.meta.url);

export { seedDesktopFullWorkspace } from "./backup-helpers.mjs";

export function assertTestPath(value) {
  const absolute = assertPhysicalPath(value);
  if (!isPathInside(TASK_RUNTIME_ROOT, absolute)) throw new Error("测试目录必须位于当前任务的物理 runtime 目录内");
  return absolute;
}

export function createIsolatedDirectory(label = "desktop") {
  if (!/^[a-z0-9-]+$/i.test(label)) throw new Error("测试目录名称无效");
  const root = assertPhysicalPath(TASK_RUNTIME_ROOT);
  fs.mkdirSync(root, { recursive: true });
  const directory = fs.mkdtempSync(path.join(root, `${label}-`));
  ownedDirectories.add(directory);
  return directory;
}

export function removeIsolatedDirectory(value) {
  const absolute = assertTestPath(value);
  if (!ownedDirectories.has(absolute)) throw new Error("不能清理不是本测试创建的目录");
  if (fs.existsSync(absolute)) fs.rmSync(absolute, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  ownedDirectories.delete(absolute);
}

function normalizedWindowsPath(value) {
  return path.win32.normalize(value).toLowerCase();
}

function runtimeFromCommandLine(value) {
  return /(?:^|\s)--user-data-dir=(?:"([^"]+)"|([^\s]+))/i.exec(value || "")?.slice(1).find(Boolean);
}

export function selectOwnedTestProcesses(records, ownership) {
  const { mainPid, launcherPid, executablePath, runtimeDir, mainCreatedAt, launcherCreatedAt } = ownership;
  assert.ok(Number.isSafeInteger(mainPid) && mainPid > 0);
  assert.ok(Number.isSafeInteger(launcherPid) && launcherPid > 0);
  assert.ok(Number.isFinite(Date.parse(mainCreatedAt)));
  const byPid = new Map(records.map((entry) => [entry.pid, entry]));
  assert.equal(byPid.size, records.length, "Duplicate process IDs in ownership inventory");
  const sameExecutable = (entry) => typeof entry.executablePath === "string" && normalizedWindowsPath(entry.executablePath) === normalizedWindowsPath(executablePath);
  const main = byPid.get(mainPid);
  if (main) {
    assert.equal(main.createdAt, mainCreatedAt, "Main process PID was reused");
    assert.equal(sameExecutable(main), true, "Main process executable changed");
    if (mainPid !== launcherPid) assert.equal(main.parentPid, launcherPid, "Main process launcher changed");
  }
  const launcher = launcherPid === mainPid ? undefined : byPid.get(launcherPid);
  if (launcher) {
    assert.equal(launcher.createdAt, launcherCreatedAt, "Launcher process PID was reused");
    assert.equal(path.win32.basename(launcher.executablePath).toLowerCase(), "cmd.exe", "Unexpected Windows launcher");
    assert.ok(normalizedWindowsPath(launcher.commandLine).includes(normalizedWindowsPath(executablePath)), "Launcher does not belong to this Electron executable");
  }
  const boundedString = (value) => typeof value === "string" ? value.slice(0, 512) : null;
  const describeProcess = (entry) => entry ? {
    pid: entry.pid,
    parentPid: entry.parentPid,
    executablePath: boundedString(entry.executablePath),
    createdAt: boundedString(entry.createdAt),
    runtimeDir: boundedString(runtimeFromCommandLine(entry.commandLine)),
  } : null;
  const withDiagnostic = (message, entry) => `${message}\nLIFE_ATLAS_TEST_PROCESS_OWNERSHIP ${JSON.stringify({
    expected: { mainPid, launcherPid, executablePath: boundedString(executablePath), runtimeDir: boundedString(runtimeDir), mainCreatedAt: boundedString(mainCreatedAt), launcherCreatedAt: boundedString(launcherCreatedAt) },
    mainPresent: Boolean(main),
    launcherPresent: launcherPid === mainPid ? Boolean(main) : Boolean(launcher),
    candidate: describeProcess(entry),
    parent: describeProcess(byPid.get(entry.parentPid)),
  })}`;
  const descendants = [];
  const seen = new Set([mainPid]);
  let frontier = [mainPid];
  while (frontier.length) {
    const children = records.filter((entry) => frontier.includes(entry.parentPid));
    for (const entry of children) {
      assert.equal(seen.has(entry.pid), false, withDiagnostic("Process ancestry contains a cycle", entry));
      seen.add(entry.pid);
      assert.equal(sameExecutable(entry), true, withDiagnostic("Unexpected process in the test Electron tree", entry));
      assert.ok(Date.parse(entry.createdAt) >= Date.parse(mainCreatedAt), withDiagnostic("Descendant predates the test main process", entry));
      const runtime = runtimeFromCommandLine(entry.commandLine);
      assert.ok(runtime && normalizedWindowsPath(runtime) === normalizedWindowsPath(runtimeDir), withDiagnostic("Descendant uses an unowned runtime directory", entry));
      descendants.push(entry);
    }
    frontier = children.map((entry) => entry.pid);
  }
  return [...(main ? [main] : []), ...descendants.reverse(), ...(launcher ? [launcher] : [])];
}

function windowsProcessQuery(pids) {
  const script = "$records = if ($env:LIFE_ATLAS_TEST_PROCESS_IDS) { foreach ($processId in ($env:LIFE_ATLAS_TEST_PROCESS_IDS -split ',')) { Get-CimInstance -ClassName Win32_Process -Filter ('ProcessId=' + [int]$processId) } } else { Get-CimInstance -ClassName Win32_Process }; [pscustomobject]@{ records = @($records | ForEach-Object { [pscustomobject]@{ pid = [int]$_.ProcessId; parentPid = [int]$_.ParentProcessId; executablePath = $_.ExecutablePath; createdAt = $_.CreationDate.ToUniversalTime().ToString('o'); commandLine = $_.CommandLine } }) } | ConvertTo-Json -Depth 5 -Compress";
  return ["powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, encoding: "utf8", timeout: 10000, env: { ...process.env, LIFE_ATLAS_TEST_PROCESS_IDS: pids?.join(",") || "" } }];
}

function readWindowsProcessRecords(pids) {
  const output = execFileSync(...windowsProcessQuery(pids));
  return JSON.parse(output.trim()).records;
}

function readWindowsProcessRecordsAsync(pids) {
  return new Promise((resolve, reject) => {
    execFile(...windowsProcessQuery(pids), (error, stdout) => {
      if (error) { reject(error); return; }
      try { resolve(JSON.parse(stdout.trim()).records); } catch (parseError) { reject(parseError); }
    });
  });
}

async function captureProcessOwnership(app) {
  const identity = await app.evaluate(({ app }) => ({ mainPid: process.pid, executablePath: process.execPath, runtimeDir: app.getPath("userData") }));
  assertTestPath(identity.runtimeDir);
  const launcherPid = app.process().pid;
  if (process.platform !== "win32") return { ...identity, launcherPid };
  const records = await readWindowsProcessRecordsAsync([...new Set([identity.mainPid, launcherPid])]);
  const main = records.find((entry) => entry.pid === identity.mainPid);
  const launcher = records.find((entry) => entry.pid === launcherPid);
  assert.ok(main && launcher, "The launched test process identities cannot be verified");
  const ownership = { ...identity, launcherPid, mainCreatedAt: main.createdAt, launcherCreatedAt: launcher.createdAt };
  selectOwnedTestProcesses(records, ownership);
  return ownership;
}

async function bounded(promise, timeoutMs, message) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error(message)), timeoutMs); })]);
  } finally { clearTimeout(timer); }
}

function waitForLauncherExit(child, timeoutMs = 5000) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  let exited;
  const pending = new Promise((resolve) => { exited = resolve; child.once("exit", exited); });
  return bounded(pending, timeoutMs, "The owned test launcher did not exit after process termination").finally(() => child.removeListener("exit", exited));
}

async function terminateOwnedTestProcesses(handle, reason) {
  const ownership = handle.processOwnership;
  assert.ok(ownership, "Cannot terminate a test process without a verified launch identity");
  if (process.platform === "win32") {
    const records = selectOwnedTestProcesses(readWindowsProcessRecords(), ownership);
    if (records.length) {
      const script = "$records = ConvertFrom-Json $env:LIFE_ATLAS_TEST_PROCESS_RECORDS; foreach ($record in $records) { $live = Get-CimInstance -ClassName Win32_Process -Filter ('ProcessId=' + [int]$record.pid); if ($live) { if ($live.CreationDate.ToUniversalTime().ToString('o') -ne $record.createdAt -or $live.ExecutablePath -ine $record.executablePath) { throw 'Process identity changed before termination' }; Stop-Process -Id ([int]$record.pid) -Force -ErrorAction Stop } }";
      execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, timeout: 15000, env: { ...process.env, LIFE_ATLAS_TEST_PROCESS_RECORDS: JSON.stringify(records) } });
      console.log(`LIFE_ATLAS_TEST_TERMINATE ${JSON.stringify({ reason, mainPid: ownership.mainPid, launcherPid: ownership.launcherPid, verifiedPids: records.map((entry) => entry.pid) })}`);
    }
  } else {
    assert.equal(ownership.mainPid, ownership.launcherPid, "Cannot terminate an unexpected process launcher");
    try { process.kill(ownership.mainPid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; }
    console.log(`LIFE_ATLAS_TEST_TERMINATE ${JSON.stringify({ reason, mainPid: ownership.mainPid, verifiedPids: [ownership.mainPid] })}`);
  }
  await waitForLauncherExit(handle.launcherProcess ?? handle.app.process());
  if (process.platform === "win32") assert.deepEqual(selectOwnedTestProcesses(readWindowsProcessRecords(), ownership), [], "An owned test process survived verified termination");
}

export async function killMainProcess(handle) {
  await terminateOwnedTestProcesses(handle, "intentional-main-process-crash");
}

export async function seedWorkspaceDatabase(dataRoot, workspace, { normalize = true, now = workspace.savedAt || "2026-10-01T08:00:00.000Z", generation = "gen-e2e" } = {}) {
  const directory = assertTestPath(dataRoot);
  fs.mkdirSync(directory, { recursive: true });
  ensureDataRootMarker(directory, { appVersion: "0.1.0", now });
  let sequence = 0;
  const normalized = normalize ? normalizeLoadedWorkspace(workspace, { fallbackWorkspace: workspace, now, idFactory: (prefix) => `${prefix}-seed-${++sequence}` }) : workspace;
  const db = openWorkspaceDatabase(path.join(directory, "workspace.db"));
  try {
    prepareWritable(db);
    initializeWorkspace(db, normalized, { generation, now });
  } finally {
    db.close();
  }
  return normalized;
}

export function isolatedElectronEnv({ dataRoot, bootstrapDir, tempDir, env = {} }) {
  const result = { ...process.env, ...env };
  delete result.ELECTRON_RUN_AS_NODE;
  delete result.LIFE_ATLAS_DEV_URL;
  delete result.LIFE_ATLAS_DEV_SMOKE;
  result.LIFE_ATLAS_TEST_SYSTEM_LOCALES = env.LIFE_ATLAS_TEST_SYSTEM_LOCALES ?? "zh-CN";
  for (const name of ["LIFE_ATLAS_TEST_AUTOLOCK_MS", "LIFE_ATLAS_TEST_CLIPBOARD_MS", "LIFE_ATLAS_TEST_CONFIRM_TTL_MS", "LIFE_ATLAS_TEST_CLOCK_MS", "LIFE_ATLAS_TEST_DEFER_WORKSPACE_LOAD"]) if (!(name in env)) delete result[name];
  if (dataRoot === null) delete result.LIFE_ATLAS_DATA_ROOT;
  else result.LIFE_ATLAS_DATA_ROOT = assertTestPath(dataRoot);
  result.LIFE_ATLAS_BOOTSTRAP_DIR = assertTestPath(bootstrapDir);
  result.TEMP = assertTestPath(tempDir);
  result.TMP = result.TEMP;
  result.LIFE_ATLAS_TEST = "1";
  return result;
}

export function installWorkspaceFixedDate(timeMillis) {
  if (!Number.isFinite(timeMillis)) throw new TypeError("固定测试时间无效");
  const OriginalDate = globalThis.Date;
  const FixedDate = function Date(...values) {
    if (!new.target) return new OriginalDate(timeMillis).toString();
    return Reflect.construct(OriginalDate, values.length ? values : [timeMillis], new.target);
  };
  Object.setPrototypeOf(FixedDate, OriginalDate);
  FixedDate.prototype = OriginalDate.prototype;
  Object.defineProperty(FixedDate, "length", { value: OriginalDate.length });
  Object.defineProperty(FixedDate, "now", { value: () => timeMillis, writable: true, configurable: true });
  Object.defineProperty(FixedDate, "toString", { value: () => OriginalDate.toString(), writable: true, configurable: true });
  globalThis.Date = FixedDate;
}

export async function setWorkspaceFixedTime(page, time) {
  const timeMillis = new Date(time).getTime();
  if (!Number.isFinite(timeMillis)) throw new TypeError("固定测试时间无效");
  await page.addInitScript(installWorkspaceFixedDate, timeMillis);
  await page.evaluate(installWorkspaceFixedDate, timeMillis);
}

export async function launchApp({ packaged = false, dataRoot, bootstrapDir, env = {}, rendererClock } = {}) {
  if (!fs.existsSync(path.join(REPO_ROOT, "dist/client/index.html"))) throw new Error("请先运行 npm run build");
  if (packaged && !fs.existsSync(PACKAGED_EXE)) throw new Error("请先运行 npm run desktop:build:test");
  if (dataRoot === null && !packaged) throw new Error("首次启动测试必须使用测试安装包，不能回退到项目 .devdata");
  let clock;
  if (rendererClock !== undefined) {
    if (!["fixed", "running"].includes(rendererClock?.mode)) throw new TypeError("渲染测试时钟模式无效");
    const time = new Date(rendererClock.time);
    if (!Number.isFinite(time.getTime())) throw new TypeError("渲染测试时间无效");
    clock = { mode: rendererClock.mode, time };
  }
  const resolvedDataRoot = dataRoot === null ? null : dataRoot === undefined ? createIsolatedDirectory("data") : assertTestPath(dataRoot);
  const resolvedBootstrap = bootstrapDir === undefined ? createIsolatedDirectory("bootstrap") : assertTestPath(bootstrapDir);
  const tempDir = createIsolatedDirectory("electron-temp");
  const { _electron } = await import("playwright");
  let app;
  let launcherProcess;
  let processOwnership;
  let ownershipResult;
  let page;
  const errors = { page: [], console: [], consoleDetails: [] };
  const captureOwnership = async () => {
    processOwnership = await captureProcessOwnership(app);
    console.log(`LIFE_ATLAS_TEST_LAUNCH ${JSON.stringify({ pid: processOwnership.mainPid, launcherPid: processOwnership.launcherPid, packaged, dataRoot: resolvedDataRoot, bootstrapDir: resolvedBootstrap, tempDir, mainCreatedAt: processOwnership.mainCreatedAt })}`);
  };
  try {
    const childEnv = isolatedElectronEnv({ dataRoot: resolvedDataRoot, bootstrapDir: resolvedBootstrap, tempDir, env: { ...env, LIFE_ATLAS_TEST_DEFER_WORKSPACE_LOAD: "1" } });
    app = await _electron.launch({ executablePath: packaged ? PACKAGED_EXE : require("electron"), args: packaged ? [] : [REPO_ROOT], cwd: REPO_ROOT, env: childEnv, timeout: 30000 });
    launcherProcess = app.process();
    ownershipResult = captureOwnership().then(() => ({ ok: true }), (error) => ({ ok: false, error }));
    const recorded = new WeakSet();
    const record = (window) => {
      if (recorded.has(window)) return;
      recorded.add(window);
      window.on("pageerror", (error) => errors.page.push(error.message));
      window.on("console", (message) => {
        if (message.type() !== "error") return;
        const text = message.text();
        const status = /^Failed to load resource: the server responded with a status of (\d{3}) \([^\r\n]+\)$/.exec(text);
        errors.console.push(text);
        errors.consoleDetails.push({ message: text, url: message.location().url, status: status ? Number(status[1]) : undefined });
      });
    };
    app.on("window", record);
    for (const window of app.windows()) record(window);
    page = await app.firstWindow();
    record(page);
    const deferred = await app.evaluate(() => typeof globalThis.__lifeAtlasTest?.loadWorkspaceForTest === "function");
    if (clock) {
      assert.equal(deferred, true, "A renderer startup clock requires the trusted deferred workspace loader");
      if (clock.mode === "fixed") await setWorkspaceFixedTime(page, clock.time);
      else await page.clock.install({ time: clock.time });
    }
    if (deferred) await app.evaluate(() => globalThis.__lifeAtlasTest.loadWorkspaceForTest());
    const ownership = await ownershipResult;
    if (!ownership.ok) throw ownership.error;
    return { app, page, launcherProcess, dataRoot: resolvedDataRoot, bootstrapDir: resolvedBootstrap, tempDir, errors, env: childEnv, packaged, processOwnership, rendererClock: clock };
  } catch (error) {
    if (app) {
      if (page && !page.isClosed()) {
        try {
          const snapshot = await bounded(page.evaluate(() => ({ url: location.href, title: document.title, body: document.body?.innerText?.slice(0, 3000) || "", ready: document.documentElement.dataset.laReady || null })), 2000, "Startup diagnostic timed out");
          console.log(`LIFE_ATLAS_TEST_STARTUP_FAILURE ${JSON.stringify({ ...snapshot, errors })}`);
        } catch (diagnosticError) { console.log(`LIFE_ATLAS_TEST_STARTUP_DIAGNOSTIC_FAILED ${JSON.stringify({ message: diagnosticError.message, errors })}`); }
      }
      try {
        if (ownershipResult) await ownershipResult;
        if (!processOwnership) await captureOwnership();
        await closeApp({ app, launcherProcess, processOwnership, dataRoot: resolvedDataRoot, bootstrapDir: resolvedBootstrap, tempDir }, { keepDirs: true });
      }
      catch (cleanupError) { throw new AggregateError([error, cleanupError], "Electron launch failed and cleanup also reported an error"); }
      finally { console.log(`LIFE_ATLAS_TEST_STARTUP_RETAINED ${JSON.stringify({ dataRoot: resolvedDataRoot, bootstrapDir: resolvedBootstrap, tempDir })}`); }
    } else console.log(`LIFE_ATLAS_TEST_STARTUP_RETAINED ${JSON.stringify({ dataRoot: resolvedDataRoot, bootstrapDir: resolvedBootstrap, tempDir })}`);
    throw error;
  }
}

export async function closeApp(handle, { keepDirs = false } = {}) {
  const child = handle.launcherProcess ?? handle.app.process();
  let failure;
  let safeToClean = false;
  try {
    if (child.exitCode === null && child.signalCode === null) await bounded(handle.app.close(), 10000, "Normal test application close timed out; preserving the close failure");
    if (process.platform === "win32" && handle.processOwnership) assert.deepEqual(selectOwnedTestProcesses(readWindowsProcessRecords(), handle.processOwnership), [], "An owned Electron process is still alive after normal close");
    safeToClean = true;
  } catch (error) {
    failure = error;
    try { await terminateOwnedTestProcesses(handle, "failed-normal-close-cleanup"); safeToClean = true; }
    catch (cleanupError) { failure = new AggregateError([error, cleanupError], "Normal close failed and verified process cleanup failed"); }
  }
  console.log(`LIFE_ATLAS_TEST_CLOSE ${JSON.stringify({ pid: handle.processOwnership?.mainPid, launcherPid: child.pid, exitCode: child.exitCode, signalCode: child.signalCode, normalCloseFailed: Boolean(failure) })}`);
  if (!keepDirs && safeToClean) {
    const errors = [];
    for (const directory of [handle.dataRoot, handle.bootstrapDir, handle.tempDir]) {
      if (!directory || !ownedDirectories.has(directory)) continue;
      try { removeIsolatedDirectory(directory); } catch (error) { errors.push(error); }
    }
    if (errors.length) failure = new AggregateError([...(failure ? [failure] : []), ...errors], "Owned test directory cleanup reported an error");
  }
  if (failure) throw failure;
}

export async function readNetworkLog(handle) {
  return handle.app.evaluate(() => globalThis.__lifeAtlasNetworkLog);
}

export async function queueDialogResponse(handle, kind, response) {
  if (!["showMessageBox", "showSaveDialog", "showOpenDialog"].includes(kind)) throw new Error("对话框类型无效");
  await handle.app.evaluate((_, args) => globalThis.__lifeAtlasDialogs.queue[args.kind].push(args.response), { kind, response });
}

export async function readDialogCalls(handle) {
  return handle.app.evaluate(() => globalThis.__lifeAtlasDialogs.calls);
}

export async function openPageInSidebar(page, title) {
  const loaded = await page.evaluate(() => window.lifeAtlas.workspace.load());
  assert.equal(loaded.ok, true, loaded.error?.message);
  const workspace = loaded.value.workspace;
  const target = workspace.pages.find((entry) => entry.title === title);
  assert.ok(target, `The stored fixture page ${title} does not exist`);
  const ancestors = [];
  const seen = new Set();
  let folderId = target.folderId;
  while (folderId) {
    assert.equal(seen.has(folderId), false, "Sidebar fixture contains a folder cycle");
    seen.add(folderId);
    const folder = workspace.folders.find((entry) => entry.id === folderId);
    assert.ok(folder, `The stored fixture folder ${folderId} does not exist`);
    ancestors.unshift(folder);
    folderId = folder.parentId;
  }
  for (const folder of ancestors) {
    await page.locator(`.workspace-sidebar .tree-folder-main[title=${JSON.stringify(folder.name)}]`).waitFor();
    const expand = page.getByRole("button", { name: `展开${folder.name}`, exact: true });
    if (await expand.count()) await expand.click();
  }
  await page.locator(`.workspace-sidebar .page-tree-row[title=${JSON.stringify(title)}]`).click();
  await page.getByLabel("页面标题", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("页面标题", { exact: true }).inputValue(), title);
}

export async function assertNoNetworkAndErrors(handle, { allowedUrls = [], expectedHttpErrors = [] } = {}) {
  const log = await readNetworkLog(handle);
  assert.ok(log, "测试网络钩子未安装");
  assert.deepEqual(log.completed.filter(({ url }) => /^(?:https?|wss?):/.test(url)), []);
  const allowed = (value) => allowedUrls.some((url) => value.includes(url));
  assert.deepEqual(log.blocked.filter(({ url }) => !allowed(url)), []);
  let consoleErrors = handle.errors.console;
  if (expectedHttpErrors.length) {
    assert.equal(Array.isArray(expectedHttpErrors), true);
    assert.equal(handle.errors.consoleDetails?.length, handle.errors.console.length, "HTTP error expectations require complete console provenance");
    assert.deepEqual(handle.errors.consoleDetails.map((event) => event.message), handle.errors.console, "Console provenance must match every captured error");
    const remaining = [...handle.errors.consoleDetails];
    const declared = new Set();
    for (const expected of expectedHttpErrors) {
      assert.equal(typeof expected.url, "string");
      assert.match(expected.url, /^life-asset:\/\/[^\s*]+$/);
      assert.equal([400, 404].includes(expected.status), true);
      assert.equal(expected.count, 1, "Each deliberate HTTP error must occur exactly once");
      const key = `${expected.url}:${expected.status}`;
      assert.equal(declared.has(key), false, "Duplicate expected HTTP error declarations are forbidden");
      declared.add(key);
      const matches = remaining.filter((event) => event.url === expected.url && event.status === expected.status && /^Failed to load resource: the server responded with a status of \d{3} \([^\r\n]+\)$/.test(event.message));
      assert.equal(matches.length, expected.count, `Expected exactly one HTTP ${expected.status} diagnostic for ${expected.url}; observed ${JSON.stringify(remaining)}`);
      remaining.splice(remaining.indexOf(matches[0]), 1);
    }
    consoleErrors = remaining.map((event) => event.message);
  }
  assert.deepEqual([...handle.errors.page, ...consoleErrors].filter((error) => !allowed(error)), []);
}

export async function shootWindowBothModes(handle, name, { shotsDir = path.join(REPO_ROOT, ".qa/LOCAL-NOTION-001/shots"), page = handle.page } = {}) {
  if (!isPathInside(path.join(REPO_ROOT, ".qa"), shotsDir, { allowRoot: true })) throw new Error("截图目录必须位于本项目 .qa");
  fs.mkdirSync(shotsDir, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const source of ["light", "dark"]) {
    await handle.app.evaluate(({ nativeTheme }, value) => { nativeTheme.themeSource = value; }, source);
    await page.emulateMedia({ colorScheme: source });
    await page.screenshot({ path: path.join(shotsDir, `${name}-${source}.png`) });
  }
}

export async function answerProductDialog(page, { accept = true, optional = false } = {}) {
  const dialog = page.locator("[data-la-dialog]").last();
  try { await dialog.waitFor({ state: "visible", timeout: optional ? 1000 : 5000 }); }
  catch (error) { if (optional) return false; throw error; }
  const element = await dialog.elementHandle();
  assert.ok(element, "The selected product dialog must exist before answering");
  try {
    await dialog.locator(accept ? "[data-la-dialog-confirm]" : "[data-la-dialog-cancel]").click();
    await page.waitForFunction((target) => !target.isConnected, element);
  } finally {
    await element.dispose();
  }
  return true;
}
