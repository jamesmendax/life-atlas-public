import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { app, BrowserWindow, ClipboardItem, clipboard, dialog, globalShortcut, ipcMain, Menu, nativeImage, nativeTheme, net, Notification, powerMonitor, protocol, safeStorage, session, shell, WebContentsView } from "electron";
import { resolveRuntimeFlavor } from "./flavor.js";
import { assertPhysicalPath, bootstrapFilePath, ensureDataRootMarker, acquireDataRootLock, releaseDataRootLock, resolveDataRoot, isPathInside } from "./storage/dataRoot.js";
import { createLogger } from "./logger.js";
import { configureDialogs } from "./dialogs.js";
import { confirmAndOpenExternal } from "./externalLinks.js";
import { createMarkdownPreview, parseMarkdownPreviewArgs } from "./markdownPreview.js";
import { createContrastPreferences, registerContrastReadIpc } from "./contrastPreferences.js";
import { createLocalePreferences, registerLocaleIpc } from "./localePreferences.js";
import { setMainLocale, tMain } from "./i18n/index.js";
import { registerAppScheme, installAppProtocol } from "./protocols.js";
import { WORKSPACE_CSP, VAULT_CSP, installSessionSecurity, createFlushController, installApplicationLifecycle } from "./security.js";
import { configureWindows, createWorkspaceWindow, createSetupWindow, createVaultWindow, installThemeBackgroundSync, refreshWindowTitle, shouldDeferWorkspaceStartup } from "./windows.js";
import { installTestHooks, consumeInjectedFailure } from "./testHooks.js";
import { createWorkspaceService } from "./storage/workspaceService.js";
import { StorageError } from "./storage/workspaceDb.js";
import { createAssetStore } from "./storage/assetStore.js";
import { createAssetCleanupService } from "./storage/assetCleanup.js";
import { createSnapshot, createSnapshotService } from "./storage/snapshots.js";
import { installAssetProtocol } from "./assetProtocol.js";
import { createVaultService, createConfirmRequests, VaultError } from "./vault/index.js";
import { createBackupService } from "./backup/index.js";
import { createSetupService, validateFolder } from "./setup.js";
import { createDataRootMoveService } from "./dataRootMove.js";
import { registerAppIpc } from "./ipc/app.js";
import { registerWorkspaceIpc } from "./ipc/workspace.js";
import { isTrustedSender } from "./ipc/validate.js";
import { registerAssistantIpc } from "./assistant/ipc.js";
import { createAssistantConversationStore } from "./assistant/conversations.js";
import { createAssistantWeb, createSystemProxyTransport, requestPublicWeb } from "./assistant/publicWeb.js";
import { registerOcrIpc } from "./ocr/index.js";
import { registerAssetsIpc } from "./ipc/assets.js";
import { registerVaultIpc } from "./ipc/vault.js";
import { registerBackupIpc } from "./ipc/backup.js";
import { registerExportsIpc } from "./ipc/exports.js";
import { registerTripRoutesIpc } from "./ipc/tripRoutes.js";
import { calculateOfflineTrip, registerTripOfflineIpc } from "./ipc/tripOffline.js";
import { createTripProvider, registerTripProviderIpc } from "./tripProvider.js";
import { createTripOfflineRouter } from "./tripOfflineRouter.js";
import { registerTripAmapSdk } from "./tripAmapSdk.js";
import { createFormShare, registerFormShareIpc } from "./formShare.js";
import { registerTripMapWindows } from "./tripMapWindow.js";
import { registerSetupIpc } from "./ipc/setup.js";
import { createMarketService, registerMarketIpc } from "./market/service.js";
import { registerDatabaseMapTiles, databaseTileAgent } from "./ipc/databaseMap.js";
import { createMarketTileCache } from "./market/tileCache.js";
import { createWidgetRuntime } from "./market/widgetRuntime.js";
import { CURRENT_SCHEMA_VERSION } from "../../src/persistence/migrations.js";

const appRoot = app.getAppPath();
const appVersion = app.getVersion();
const { flavor, testHooksEnabled } = resolveRuntimeFlavor(app);
const testHooks = installTestHooks({ enabled: testHooksEnabled });
const dialogs = configureDialogs({ dialog, shell, testHooksEnabled, state: globalThis.__lifeAtlasDialogs });
const now = () => new Date(testHooks?.clock.now() ?? Date.now()).toISOString();
const preloads = (name) => path.join(appRoot, "electron", "preload", `${name}.cjs`);
let dataRoot;
let dataRootSource;
let bootstrapFile;
let localePreferences;
let setupTempDir;
let setupTempParent;
let rootLockHeld = false;
let logger;
let workspaceWindow;
let setupWindow;
let reopenPrimaryWindow;
let vaultWindow;
let workspaceService;
let vaultService;
let snapshotService;
let backupService;
let setupService;
let assetCleanupService;
let marketService;
let formShare;
let confirmRequests;
let themeCleanup;
let shortcutRegistered = false;
const notifications = new Set();
const accelerator = "Ctrl+Alt+Space";

function processIsAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code !== "ESRCH"; }
}

function focusWindow(window) {
  if (!window || window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

function send(window, channel, value) {
  if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send(channel, value);
}

const resolvedVaultTheme = () => nativeTheme.shouldUseDarkColors ? "dark" : "light";

function removeSetupTemporary() {
  if (!setupTempDir || !fs.existsSync(setupTempDir)) return;
  const target = assertPhysicalPath(setupTempDir, { root: setupTempParent });
  if (!isPathInside(setupTempParent, target) || !path.basename(target).startsWith("life-atlas-setup-")) throw new StorageError("E_IO", tMain("临时目录不在允许的范围内"));
  try { fs.rmSync(target, { recursive: true, force: true }); }
  catch (error) {
    if (!["EBUSY", "EPERM", "ENOTEMPTY"].includes(error.code)) throw error;
    logger?.log("setup.cleanup-deferred", { code: error.code });
    return;
  }
  setupTempDir = undefined;
}

process.once("exit", () => { try { removeSetupTemporary(); } catch {} });

function prepareStartup(markdownInvocation = null) {
  let deliveryAddress;
  let runtimeDirectory;
  let crashDirectory;
  let instanceDirectory;
  if (markdownInvocation) {
    try {
      deliveryAddress = workspaceBootstrapFile();
      const { dataRoot: root } = resolveDataRoot({ bootstrapFile: deliveryAddress, flavor, repoRoot: appRoot });
      const existing = root && existingPreviewRuntime(root);
      if (existing) ({ runtimeDirectory, crashDirectory } = existing);
    } catch {
      // The preview can run on its own. A workspace launch reads the configuration afresh.
    }
  } else {
    loadWorkspaceLocation();
    deliveryAddress = bootstrapFile;
    if (dataRoot) ({ runtimeDirectory, crashDirectory } = prepareWorkspaceRuntime());
  }
  if (!runtimeDirectory) {
    setupTempParent = assertPhysicalPath(os.tmpdir(), { allowMissing: false });
    setupTempDir = fs.mkdtempSync(path.join(setupTempParent, "life-atlas-setup-"));
    crashDirectory = runtimeDirectory = setupTempDir;
    // Setup and independent previews share a delivery address before a
    // workspace exists, while their Chromium session data stays temporary.
    const requestedAddress = deliveryAddress || JSON.stringify([
      appRoot, process.env.LIFE_ATLAS_DATA_ROOT, testHooksEnabled ? process.env.LIFE_ATLAS_BOOTSTRAP_DIR : null,
    ]);
    const instanceKey = createHash("sha256").update(requestedAddress).digest("hex").slice(0, 24);
    instanceDirectory = assertPhysicalPath(path.join(setupTempParent, `life-atlas-instance-${instanceKey}`), { root: setupTempParent });
    fs.mkdirSync(instanceDirectory, { recursive: true });
  }
  app.setPath("userData", instanceDirectory || runtimeDirectory);
  app.setPath("sessionData", runtimeDirectory);
  app.setPath("crashDumps", crashDirectory);
  const additionalData = markdownInvocation ? { markdownPreview: markdownInvocation } : undefined;
  if (!app.requestSingleInstanceLock(additionalData)) {
    removeSetupTemporary();
    app.quit();
    return false;
  }
  if (!markdownInvocation) acquireWorkspaceDataRoot();
  registerAppScheme(protocol);
  return true;
}

function workspaceBootstrapFile() {
  return bootstrapFilePath({ getAppDataDir: () => app.getPath("appData"), testHooksEnabled });
}

function initializeLocalePreferences({ standalonePreview = false } = {}) {
  let file = bootstrapFile;
  if (!file) {
    try { file = workspaceBootstrapFile(); }
    catch (error) {
      if (!standalonePreview) throw error;
      file = bootstrapFilePath({ getAppDataDir: () => app.getPath("appData"), env: {} });
    }
  }
  localePreferences = createLocalePreferences({
    bootstrapFile: file,
    getPreferredSystemLanguages: () => app.getPreferredSystemLanguages(),
    testHooksEnabled,
  });
  setMainLocale(localePreferences.get().locale);
}

function loadWorkspaceLocation() {
  const file = workspaceBootstrapFile();
  const resolved = resolveDataRoot({ bootstrapFile: file, flavor, repoRoot: appRoot });
  bootstrapFile = file;
  dataRoot = resolved.dataRoot;
  dataRootSource = resolved.source;
}

function workspaceRuntimePaths(root, allowMissing = true) {
  const runtimeDirectory = assertPhysicalPath(path.join(root, "runtime"), { root, allowMissing });
  const crashDirectory = assertPhysicalPath(path.join(runtimeDirectory, "crashes"), { root, allowMissing });
  return { runtimeDirectory, crashDirectory };
}

function assertWorkspaceOutsideInstallation(root) {
  if (app.isPackaged && isPathInside(path.dirname(process.execPath), root, { allowRoot: true })) throw new StorageError("E_INVALID_ARGUMENT", tMain("数据目录不能位于安装目录内"));
}

function existingPreviewRuntime(root) {
  assertWorkspaceOutsideInstallation(root);
  const file = assertPhysicalPath(path.join(root, "life-atlas.root.json"), { root, allowMissing: false });
  const marker = JSON.parse(fs.readFileSync(file, "utf8"));
  if (marker?.kind !== "life-atlas-data-root" || marker.formatVersion !== 1) return null;
  const runtime = workspaceRuntimePaths(root, false);
  for (const directory of Object.values(runtime)) {
    if (!fs.statSync(directory).isDirectory()) return null;
    fs.accessSync(directory, fs.constants.R_OK | fs.constants.W_OK);
  }
  return runtime;
}

function prepareWorkspaceRuntime() {
  const runtime = workspaceRuntimePaths(dataRoot);
  assertWorkspaceOutsideInstallation(dataRoot);
  ensureDataRootMarker(dataRoot, { appVersion, now: now() });
  fs.mkdirSync(runtime.crashDirectory, { recursive: true });
  return runtime;
}

function acquireWorkspaceDataRoot() {
  if (!dataRoot || rootLockHeld) return;
  const lock = acquireDataRootLock(dataRoot, { pid: process.pid, appVersion, now: now(), isProcessAlive: processIsAlive });
  if (!lock.ok) throw new StorageError("E_CONFLICT", tMain("这个数据目录正被另一个 Life Atlas 使用。"));
  rootLockHeld = true;
  logger = createLogger({ logsDir: path.join(dataRoot, "logs"), now });
  if (lock.staleRecovered) logger.log("lock.stale-recovered");
  logger.log("app.start", { flavor, source: dataRootSource, appVersion });
}

function relaunchWorkspace() {
  app.relaunch({ args: process.defaultApp ? [appRoot] : [] });
}

function developmentUrl() {
  if (flavor !== "dev" || !process.env.LIFE_ATLAS_DEV_URL) return null;
  const url = new URL(process.env.LIFE_ATLAS_DEV_URL);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname) || url.port !== "5199" || url.username || url.password || url.search || url.hash) throw new StorageError("E_INVALID_ARGUMENT", tMain("开发服务器必须使用本机 5199 端口"));
  return url.href;
}

function testMilliseconds(name) {
  if (!testHooksEnabled || !process.env[name]) return undefined;
  const value = Number(process.env[name]);
  if (!Number.isSafeInteger(value) || value < 1 || value > 3600000) throw new StorageError("E_INVALID_ARGUMENT", "测试时间参数无效");
  return value;
}

async function waitForRendererReady(window, attribute, { navigationComplete = false } = {}) {
  if (!window || window.isDestroyed() || window.webContents.isDestroyed()) throw new StorageError("E_IO", tMain("窗口已经关闭"));
  if (!navigationComplete && window.webContents.isLoadingMainFrame()) {
    await new Promise((resolve, reject) => {
      const contents = window.webContents;
      const cleanup = () => {
        clearTimeout(timeout);
        contents.removeListener("did-finish-load", loaded);
        contents.removeListener("did-fail-load", failed);
        contents.removeListener("destroyed", destroyed);
      };
      const loaded = () => { cleanup(); resolve(); };
      const failed = (_, code, description, url, mainFrame) => { if (mainFrame !== false) { cleanup(); reject(new StorageError("E_IO", tMain("窗口加载失败"))); } };
      const destroyed = () => { cleanup(); reject(new StorageError("E_IO", tMain("窗口已经关闭"))); };
      const timeout = setTimeout(() => { cleanup(); reject(new StorageError("E_IO", tMain("窗口加载超时"))); }, 10000);
      contents.once("did-finish-load", loaded);
      contents.on("did-fail-load", failed);
      contents.once("destroyed", destroyed);
    });
  }
  const ready = await window.webContents.executeJavaScript(`new Promise((resolve) => {
    if (document.documentElement.getAttribute(${JSON.stringify(attribute)}) === "1") { resolve(true); return; }
    const observer = new MutationObserver(() => {
      if (document.documentElement.getAttribute(${JSON.stringify(attribute)}) === "1") { observer.disconnect(); clearTimeout(timeout); resolve(true); }
    });
    const timeout = setTimeout(() => { observer.disconnect(); resolve(false); }, 10000);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: [${JSON.stringify(attribute)}] });
  })`);
  if (!ready || window.isDestroyed()) throw new StorageError("E_IO", tMain("窗口尚未准备好，请重试"));
}

async function shutdown() {
  confirmRequests?.cancelAll();
  marketService?.close();
  formShare?.close();
  await setupService?.stop();
  await backupService?.stop();
  await snapshotService?.stop();
  await assetCleanupService?.stop();
  workspaceService?.close();
  vaultService?.closeDatabase();
  if (shortcutRegistered) globalShortcut.unregister(accelerator);
  shortcutRegistered = false;
  themeCleanup?.();
  for (const notification of notifications) notification.close();
  notifications.clear();
  logger?.log("app.quit");
  if (rootLockHeld) releaseDataRootLock(dataRoot, process.pid);
  rootLockHeld = false;
  removeSetupTemporary();
}

async function start() {
  const argumentOffset = process.defaultApp ? 2 : 1;
  const initialPreview = parseMarkdownPreviewArgs(process.argv.slice(argumentOffset));
  if (!prepareStartup(initialPreview)) return;
  const ready = app.whenReady().then(() => {
    initializeLocalePreferences({ standalonePreview: Boolean(initialPreview) });
    let openPreview;
    const getWritableWindows = () => [workspaceWindow, setupWindow];
    const getWindows = () => [...getWritableWindows(), vaultWindow, ...(openPreview?.getWindows() ?? [])];
    registerLocaleIpc({ ipcMain, preferences: localePreferences, getWindows, getWritableWindows });
    localePreferences.subscribe((preference) => {
      setMainLocale(preference.locale);
      for (const window of getWindows()) {
        if (!window || window.isDestroyed()) continue;
        try {
          refreshWindowTitle(window);
          send(window, "la:locale:changed", preference);
        } catch (error) {
          logger?.log("locale.window-update-failed", { code: error.code || "E_IO" });
        }
      }
    });
    app.setAppUserModelId("com.medax.lifeatlas");
    Menu.setApplicationMenu(null);
    app.on("window-all-closed", () => app.quit());
    const devUrl = developmentUrl();
    const distDir = path.join(appRoot, "dist", "client");
    openPreview = createMarkdownPreview({ BrowserWindow, ipcMain, session, devUrl, distDir, nativeTheme, isPackaged: app.isPackaged,
      preload: preloads("markdown-preview"), confirmExternal: (window, url) => confirmAndOpenExternal(window, url, { dialogs }),
      onLoadError: () => dialogs.showErrorBox(tMain("无法打开 Markdown 预览"), tMain("预览窗口加载失败。")),
    });
    return { devUrl, distDir, openPreview };
  });
  let workspaceStartup;
  const launch = async (preview) => {
    const runtime = await ready;
    if (preview) { runtime.openPreview(preview); return; }
    const alreadyStarted = Boolean(workspaceStartup);
    workspaceStartup ??= startWorkspace(runtime);
    await workspaceStartup;
    if (alreadyStarted) {
      if (workspaceWindow || setupWindow) focusWindow(workspaceWindow || setupWindow);
      else reopenPrimaryWindow?.();
    }
  };
  app.on("second-instance", (_, argv, workingDirectory, additionalData) => {
    const forwarded = additionalData?.markdownPreview;
    const fromArguments = Array.isArray(forwarded?.selected)
      ? parseMarkdownPreviewArgs(["--markdown-preview", ...forwarded.selected], workingDirectory)
      : parseMarkdownPreviewArgs(argv.slice(argumentOffset), workingDirectory);
    if (fromArguments && Number.isSafeInteger(forwarded?.overflow) && forwarded.overflow > 0) fromArguments.overflow += forwarded.overflow;
    void launch(fromArguments).catch(handleStartupError);
  });
  await launch(initialPreview);
}

async function startWorkspace({ devUrl, distDir }) {
  if (!bootstrapFile) loadWorkspaceLocation();
  if (dataRoot && !rootLockHeld) {
    prepareWorkspaceRuntime();
    acquireWorkspaceDataRoot();
  }
  const contrastPreferences = createContrastPreferences(path.join(path.dirname(bootstrapFile), "contrast.json"), (value) => {
    send(vaultWindow, "la:appearance:contrast-changed", value);
    send(setupWindow, "la:appearance:contrast-changed", value);
  });
  registerContrastReadIpc({ ipcMain, getWindows: () => [workspaceWindow, setupWindow, vaultWindow], preferences: contrastPreferences });
  const workspaceUrl = devUrl || "app://bundle/index.html";
  const vaultUrl = new URL("vault.html", workspaceUrl).href;
  const setupUrl = new URL("setup.html", workspaceUrl).href;
  const devOrigin = devUrl ? new URL(devUrl).origin : undefined;
  const configureSession = (target, csp, allowClipboard) => {
    installAppProtocol(target, { distDir, csp });
    installSessionSecurity(target, {
      devOrigin, logger, networkLog: globalThis.__lifeAtlasNetworkLog, allowClipboard, dialogs,
      getWindowForContents: contents => BrowserWindow.fromWebContents(contents),
      getWorkspaceWindow: () => workspaceWindow, workspaceUrl,
      locationIpc: allowClipboard ? ipcMain : undefined,
    });
  };
  configureSession(session.defaultSession, WORKSPACE_CSP, true);
  configureWindows({ BrowserWindow, nativeTheme, isPackaged: app.isPackaged, testHooksEnabled, logger });
  const cleanupThemeBackgrounds = installThemeBackgroundSync();
  const sendVaultTheme = () => send(vaultWindow, "la:vault:theme-changed", resolvedVaultTheme());
  nativeTheme.on("updated", sendVaultTheme);
  themeCleanup = () => { cleanupThemeBackgrounds(); nativeTheme.off("updated", sendVaultTheme); };
  const deferWorkspaceLoad = shouldDeferWorkspaceStartup({ testHooksEnabled });
  let workspaceStartupReady = !deferWorkspaceLoad;
  const flushController = createFlushController({
    getWindow: () => workspaceWindow,
    canFlush: () => workspaceStartupReady && Boolean(workspaceService?.status().loaded),
    onTimeout: () => dialogs.showMessageBox(workspaceWindow, { type: "error", buttons: [tMain("返回继续编辑")], defaultId: 0, cancelId: 0, message: tMain("保存尚未完成"), detail: tMain("为保护最后的修改，应用没有关闭。请重试保存后再退出。") }),
  });
  const lifecycle = installApplicationLifecycle({ app, flushController, lockVault: (reason) => vaultService?.lock(reason), shutdown, logger, onError: () => dialogs.showErrorBox(tMain("无法安全退出"), tMain("数据仍在使用中，请重试退出。原始数据没有被丢弃。")) });
  if (!dataRoot) {
    setupService = createSetupService({
      bootstrapFile, setupTempDir, appVersion, isPackaged: app.isPackaged, installDir: path.dirname(process.execPath), now, dialogs, getSetupWindow: () => setupWindow,
      createWorkspaceService: (options) => createWorkspaceService({ now, appVersion, createSnapshot: (input) => createSnapshot({ appVersion, logger, ...input }), ...options }),
      createBackupService, testHooksEnabled, logger,
      persistInitialLocale: () => localePreferences.set(localePreferences.get().locale),
      relaunch: relaunchWorkspace, exit: (code = 0) => { removeSetupTemporary(); app.exit(code); },
    });
    registerSetupIpc({ ipcMain, service: setupService, getSetupWindow: () => setupWindow });
    reopenPrimaryWindow = () => {
      setupWindow = createSetupWindow({ preload: preloads("setup"), url: setupUrl });
      setupWindow.on("closed", () => { setupWindow = undefined; });
    };
    reopenPrimaryWindow();
    return;
  }
  const autoLockMs = testMilliseconds("LIFE_ATLAS_TEST_AUTOLOCK_MS");
  const requestConfirmation = (input) => confirmRequests.request(input);
  const vaultDialogs = {
    showOpenDialog: (options) => dialogs.showOpenDialog(vaultWindow, options),
    showSaveDialog: (options) => dialogs.showSaveDialog(vaultWindow, options),
    showMessageBox: (options) => dialogs.showMessageBox(vaultWindow, options),
  };
  vaultService = createVaultService({ dataRoot, clock: testHooks?.clock || Date, appVersion, clipboard, createClipboardItem: (types) => new ClipboardItem(types), getSystemIdleSeconds: () => powerMonitor.getSystemIdleTime(), logger: (event, fields) => logger.log(event, fields), dialogs: vaultDialogs, openExternal: (url) => confirmAndOpenExternal(vaultWindow, url, { dialogs }), requestConfirmation, injectFailure: testHooksEnabled ? consumeInjectedFailure : undefined, autoLockMs, autoLockCheckMs: Math.min(15000, autoLockMs ?? 15000), clipboardClearMs: testMilliseconds("LIFE_ATLAS_TEST_CLIPBOARD_MS") });
  let vaultSessionConfigured = false;
  const ensureVaultWindow = (section = "main") => {
    if (!vaultWindow || vaultWindow.isDestroyed()) {
      if (!vaultSessionConfigured) { configureSession(session.fromPartition("vault"), VAULT_CSP, false); vaultSessionConfigured = true; }
      vaultWindow = createVaultWindow({ preload: preloads("vault"), url: section === "settings" ? `${vaultUrl}#settings` : vaultUrl, testHooks, onClose: () => { confirmRequests.cancelAll(); vaultService.lock("window-closed"); }, onMinimize: () => { if (vaultService.status().settings.lockOnMinimize) vaultService.lock("minimized"); } });
      const created = vaultWindow;
      created.on("closed", () => { if (vaultWindow === created) vaultWindow = undefined; });
    } else if (section === "settings") {
      void vaultWindow.webContents.executeJavaScript('location.hash = "settings"').catch(() => {});
    }
    focusWindow(vaultWindow);
    return vaultWindow;
  };
  confirmRequests = createConfirmRequests({ verifyPassword: (password) => vaultService.verifyPassword(password), ttlMs: testMilliseconds("LIFE_ATLAS_TEST_CONFIRM_TTL_MS") ?? 120000, deliver: async (input) => { const window = ensureVaultWindow(); await waitForRendererReady(window, "data-la-vault-ready"); send(window, "la:vault:confirm-request", input); } });
  vaultService.onLocked((value) => send(vaultWindow, "la:vault:locked", value));
  vaultService.onStatusChanged((value) => send(workspaceWindow, "la:app:vault-status-changed", { exists: Boolean(value.exists), locked: Boolean(value.locked) }));
  vaultService.onSettingsChanged((settings) => send(vaultWindow, "la:vault:settings-changed", settings));
  powerMonitor.on("suspend", () => vaultService.lock("suspend"));
  powerMonitor.on("lock-screen", () => vaultService.lock("system-lock"));
  workspaceService = createWorkspaceService({ dataRoot, now, appVersion, beforeMigration: (input) => snapshotService.beforeMigration(input), beforeUpgrade: (input) => snapshotService.beforeUpgrade(input), logger });
  snapshotService = createSnapshotService({ dataRoot, workspaceService, vaultService, appVersion, now, logger, onDailyCheck: () => assetCleanupService?.purgeExpired() });
  try {
    const loaded = await workspaceService.load();
    const theme = loaded.workspace.ui?.preferences?.theme;
    if (["light", "dark", "system"].includes(theme)) nativeTheme.themeSource = theme;
  } catch (error) { logger.log("storage.open-failed", { code: error.code || "E_IO" }); }
  const assetStore = createAssetStore({ assetsDir: path.join(dataRoot, "assets"), db: () => workspaceService.db, now });
  const conversations = createAssistantConversationStore({ dataRoot });
  assetCleanupService = createAssetCleanupService({ dataRoot, db: () => workspaceService.db, now, requestFlush: () => flushController.request(), additionalReferences: conversations.listAttachmentAssetIds, installedMarketAssets: () => marketService?.installedAssetIds() ?? [] });
  if (workspaceService.status().loaded) {
    try { await assetCleanupService.purgeExpired(); } catch (error) { logger.log("asset-trash.cleanup-failed", { errorCode: error.code || "E_IO" }); }
  }
  installAssetProtocol(session.defaultSession, { assetStore, allowedOrigin: devOrigin || "app://bundle" });
  backupService = createBackupService({ dataRoot, workspaceService, assetStore, vaultService, snapshotService, conversations, appVersion, now, logger, dialogs, getWindow: () => workspaceWindow, requestFlush: () => flushController.request(), requestConfirmation, reloadWorkspace: async () => { await vaultService.lock("restored"); if (workspaceWindow && !workspaceWindow.isDestroyed()) { workspaceWindow.webContents.reload(); await waitForRendererReady(workspaceWindow, "data-la-ready"); } }, injectFailure: testHooksEnabled ? consumeInjectedFailure : undefined, safeStorage });
  const dataRootMover = createDataRootMoveService({
    dataRoot, bootstrapFile, now, dialogs, getWindow: () => workspaceWindow,
    validateFolder: (input) => validateFolder(input, { isPackaged: app.isPackaged, installDir: path.dirname(process.execPath) }),
    requestFlush: () => flushController.request(),
    lockVault: () => { confirmRequests.cancelAll(); return vaultService.lock("manual"); },
    stopTimers: async () => { await backupService.stop(); await snapshotService.stop(); await assetCleanupService.stop(); },
    closeDatabases: () => {
      formShare?.close();
      workspaceService.suspendWrites();
      workspaceService.checkpoint();
      workspaceService.close();
      vaultService.closeDatabase();
      for (const name of ["workspace.db", "vault.db"]) {
        for (const suffix of ["-wal", "-shm"]) if (fs.existsSync(assertPhysicalPath(path.join(dataRoot, `${name}${suffix}`), { root: dataRoot }))) throw new StorageError("E_IO", tMain("数据库仍有未关闭的连接，未复制数据目录"));
      }
    },
    reopenDatabases: async () => { await workspaceService.reopen(); vaultService.reopenDatabase(); workspaceService.resumeWrites(); },
    restartTimers: () => { assetCleanupService.start(); snapshotService.start(); backupService.start(); },
    injectFailure: testHooksEnabled ? consumeInjectedFailure : undefined, testHooksEnabled,
    relaunch: (target) => {
      const previousRoot = process.env.LIFE_ATLAS_DATA_ROOT;
      if (previousRoot) process.env.LIFE_ATLAS_DATA_ROOT = target;
      try {
        if (previousRoot) {
          const nextBootstrap = workspaceBootstrapFile();
          if (nextBootstrap !== bootstrapFile) createLocalePreferences({ bootstrapFile: nextBootstrap }).set(localePreferences.get().locale);
        }
        relaunchWorkspace();
      } catch (error) {
        if (previousRoot) process.env.LIFE_ATLAS_DATA_ROOT = previousRoot;
        throw error;
      }
    },
    exit: (code) => { if (rootLockHeld) releaseDataRootLock(dataRoot, process.pid); rootLockHeld = false; app.exit(code); },
  });
  registerWorkspaceIpc({ ipcMain, service: workspaceService, getWorkspaceWindow: () => workspaceWindow, testHooks });
  formShare = createFormShare({ dataRoot,
    getWorkspace: async () => {
      const state = workspaceService.status();
      if (!state.loaded || state.readOnlyError) throw new Error(tMain("工作区不可写入"));
      return (await workspaceService.load()).workspace;
    },
    onReceived: event => { if (workspaceWindow && !workspaceWindow.isDestroyed()) workspaceWindow.webContents.send("la:forms:received", event); },
  });
  registerFormShareIpc({ ipcMain, service: formShare, getWindow: () => workspaceWindow });
  const webSession = session.fromPartition("life-atlas-assistant-public-web", { cache: false });
  const providerSession = session.fromPartition("life-atlas-assistant-provider", { cache: false });
  const proxyTransport = createSystemProxyTransport({ net, session: webSession });
  const web = createAssistantWeb({ request: (url, options) => requestPublicWeb(url, { ...options, proxyTransport }) });
  const fetchImpl = (url, options) => url.startsWith("https:")
    ? providerSession.fetch(url, { ...options, credentials: "omit" }) : fetch(url, options);
  registerAssistantIpc({ ipcMain, getWorkspaceWindow: () => workspaceWindow, safeStorage, configDirectory: path.join(path.dirname(bootstrapFile), "assistant"), conversations, assetStore, nativeImage, web, fetchImpl });
  const marketSession = session.fromPartition("life-atlas-market-public", { cache: false });
  let databaseTileSession;
  registerDatabaseMapTiles({ ipcMain, getWindow: () => workspaceWindow, appVersion,
    // Lazily create the disk-backed HTTP cache after the first explicit online view.
    // It is separate from users' sites, widget caches, cookies and workspace backups.
    fetchTile(url, options) {
      if (!databaseTileSession) {
        databaseTileSession = session.fromPartition("persist:life-atlas-database-map-tiles", { cache: true });
        databaseTileSession.setUserAgent(databaseTileAgent(appVersion));
      }
      return databaseTileSession.fetch(url, options);
    },
    isEmptySatelliteTile(bytes) {
      const image = nativeImage.createFromBuffer(bytes);
      if (image.isEmpty()) return true;
      const pixels = image.toBitmap();
      for (let i = 3; i < pixels.length; i += 4) if (pixels[i] !== 0) return false;
      return true;
    },
  });
  const tileCache = createMarketTileCache({ session, directory: path.join(dataRoot, "runtime", "market-tile-index") });
  void tileCache.retryPending().catch(() => logger.log("market.tile-cleanup-pending", { code: "E_IO" }));
  marketService = createMarketService({
    appVersion, assetStore, assetCleanup: assetCleanupService, allowedOrigin: devOrigin || "app://bundle", dialogs, getWindow: () => workspaceWindow,
    directory: app.isPackaged ? path.join(process.resourcesPath, "market") : path.join(appRoot, "market", "public"),
    runtime: createWidgetRuntime({ session, WebContentsView }),
    fetchImpl: !testHooksEnabled || process.env.LIFE_ATLAS_TEST_MARKET_TRANSPORT === "1" ? (url, options) => marketSession.fetch(url, options) : undefined,
    onRemoveResources: ({ sha256, capabilities }) => capabilities.includes("trip-routing") ? tileCache.clear(sha256) : undefined,
    checkWritable: () => workspaceService.status().loaded && !workspaceService.status().readOnlyError,
  });
  registerMarketIpc({ ipcMain, getWindow: () => workspaceWindow, service: marketService });
  session.defaultSession.protocol.handle("life-widget", (request) => marketService.serveWidgetResource(request));
  const tripProvider = createTripProvider({
    file: path.join(path.dirname(bootstrapFile), "maps", "amap.json"),
    safeStorage,
  });
  registerTripProviderIpc({ ipcMain, getWindow: () => workspaceWindow, provider: tripProvider });
  const offlineTrips = createTripOfflineRouter({ dataDir: path.join(app.getPath("userData"), "trip-road-data") });
  app.once("before-quit", () => offlineTrips.close());
  const tripCapability = (frameUrl, capability) => marketService.capabilityOwner(frameUrl, capability);
  registerTripOfflineIpc({ ipcMain, getWindow: () => workspaceWindow, capabilityOwner: tripCapability, dialog: dialogs, router: offlineTrips });
  const fetchTrip = (url, options) => session.fromPartition("life-atlas-trip-routing", { cache: false }).fetch(url, options);
  const amapSdk = registerTripAmapSdk({ ipcMain, getWindow: () => workspaceWindow, BrowserWindow, session, safeStorage,
    capabilityOwner: tripCapability, file: path.join(path.dirname(bootstrapFile), "maps", "amap-sdk.json"), fetchImpl: fetchTrip });
  app.once("before-quit", () => amapSdk?.close?.());
  registerTripMapWindows({ ipcMain, getWindow: () => workspaceWindow, BrowserWindow, session, isPackaged: app.isPackaged,
    capabilityOwner: (frameUrl, capability) => marketService.capabilityOwner(frameUrl, capability), getAmapAccess: () => tripProvider.access(), fetchImpl: fetchTrip });
  registerTripRoutesIpc({
    ipcMain, getWorkspaceWindow: () => workspaceWindow, appVersion,
    getAmapAccess: () => tripProvider.access(),
    nominatimSearchUrl: process.env.LIFE_ATLAS_NOMINATIM_SEARCH_URL,
    capabilityOwner: tripCapability,
    routeOffline: input => calculateOfflineTrip(offlineTrips, input),
    fetchRoute: fetchTrip,
    fetchTile: tileCache.fetchTile,
  });
  registerOcrIpc({ ipcMain, isAuthorized: (event) => isTrustedSender(event, workspaceWindow), getCaptureWindows: () => [] });
  registerAssetsIpc({ ipcMain, assetStore, getWorkspaceWindow: () => workspaceWindow, maintenance: assetCleanupService });
  registerVaultIpc({ ipcMain, service: vaultService, confirmRequests, getTheme: resolvedVaultTheme, getVaultWindowId: () => vaultWindow && !vaultWindow.isDestroyed() ? vaultWindow.webContents.id : undefined });
  registerBackupIpc({ ipcMain, service: backupService, getWorkspaceWindow: () => workspaceWindow });
  registerExportsIpc({ ipcMain, assetStore, dialogs, getWorkspaceWindow: () => workspaceWindow, now });
  const notificationClick = (pageId) => { focusWindow(workspaceWindow); send(workspaceWindow, "la:app:notification-click", { pageId }); };
  const triggerQuickCapture = () => { focusWindow(workspaceWindow); send(workspaceWindow, "la:app:quick-capture"); };
  registerAppIpc({
    ipcMain, getWorkspaceWindow: () => workspaceWindow, getInfo: () => ({ appVersion, schemaVersion: CURRENT_SCHEMA_VERSION, dataRoot, isPackaged: app.isPackaged, flavor, versions: { electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node } }),
    confirmAndOpenExternal: (window, url) => confirmAndOpenExternal(window, url, { dialogs }), dialogs, nativeTheme, flushController, getDataRoot: () => dataRoot,
    openVaultWindow: ({ section }) => { ensureVaultWindow(section); return {}; }, getVaultStatus: () => vaultService.status(), getQuickCaptureShortcutStatus: () => ({ registered: shortcutRegistered, accelerator }),
    requestVaultPreferences: (input) => vaultService.requestVaultPreferences(input),
    setContrastPreference: (value) => contrastPreferences.set(value),
    changeDataRoot: () => dataRootMover.changeDataRoot(),
    notify: ({ title, body, pageId }) => {
      if (testHooks) {
        testHooks.notifications.push({ title, body, pageId });
        return {};
      }
      if (!Notification.isSupported()) return {};
      const notification = new Notification({ title, body, silent: true });
      notifications.add(notification);
      notification.on("click", () => notificationClick(pageId));
      notification.on("close", () => notifications.delete(notification));
      notification.show();
      return {};
    },
  });
  if (testHooks) {
    testHooks.requestConfirmation = requestConfirmation;
    testHooks.snapshots = { checkNow: () => snapshotService.checkNow() };
    testHooks.schedule = { checkNow: () => backupService.schedule.checkNow() };
  }
  let createdWorkspaceWindow = false;
  reopenPrimaryWindow = () => {
    workspaceWindow = createWorkspaceWindow({ preload: preloads("workspace"), url: workspaceUrl, deferLoad: deferWorkspaceLoad && !createdWorkspaceWindow, testHooks, onDeferredLoaded: async () => { await waitForRendererReady(workspaceWindow, "data-la-ready", { navigationComplete: true }); workspaceStartupReady = true; } });
    workspaceWindow.webContents.on("did-start-navigation", (event) => {
      if (event.isMainFrame && !event.isSameDocument) marketService.releaseAllFrames();
    });
    lifecycle.attachWorkspaceWindow(workspaceWindow);
    workspaceWindow.on("app-command", (_, command) => { if (["browser-backward", "browser-forward"].includes(command)) send(workspaceWindow, "la:app:navigate", { direction: command === "browser-backward" ? "back" : "forward" }); });
    workspaceWindow.on("closed", () => { formShare?.close(); marketService.releaseAllFrames(); workspaceWindow = undefined; });
    createdWorkspaceWindow = true;
  };
  reopenPrimaryWindow();
  shortcutRegistered = globalShortcut.register(accelerator, triggerQuickCapture);
  if (testHooks) {
    testHooks.clickNotification = (index) => {
      if (!Number.isSafeInteger(index) || index < 0 || index >= testHooks.notifications.length) throw new TypeError("通知索引无效");
      notificationClick(testHooks.notifications[index].pageId);
    };
    testHooks.triggerQuickCapture = triggerQuickCapture;
  }
  if (!shortcutRegistered) logger.log("shortcut.unavailable", { registered: false });
  if (workspaceService.status().loaded) { snapshotService.start(); backupService.start(); }
  if (flavor === "dev" && process.env.LIFE_ATLAS_DEV_SMOKE === "1") {
    await waitForRendererReady(workspaceWindow, "data-la-ready");
    console.log("LIFE_ATLAS_DEV_SMOKE_OK");
    app.quit();
  }
}

async function handleStartupError(error) {
  logger?.log("app.start-failed", { code: error.code || "E_IO" });
  if (!localePreferences) {
    try { initializeLocalePreferences(); } catch { /* Keep the legacy language if configuration is unavailable. */ }
  }
  const storageError = error instanceof StorageError || error instanceof VaultError;
  dialogs.showErrorBox(tMain(error.code === "E_CONFLICT" ? "数据目录正在使用" : "无法打开 Life Atlas"), tMain(storageError ? error.message : "启动失败。为保护原始数据，应用没有替换数据文件。"));
  try { await vaultService?.lock("app-quit"); await shutdown(); } catch {}
  app.exit(1);
}

start().catch(handleStartupError);
