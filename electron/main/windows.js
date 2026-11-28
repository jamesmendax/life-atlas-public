import { installContentsGuards } from "./security.js";
import { confirmAndOpenExternal } from "./externalLinks.js";
import { tMain } from "./i18n/index.js";

let platform;
const windowTitles = new WeakMap();

export function trackWindowTitle(window, initialTitle, documentTitle = initialTitle) {
  windowTitles.set(window, initialTitle);
  window.on("page-title-updated", (event, title, explicitSet) => {
    if (explicitSet === false) return;
    windowTitles.set(window, documentTitle);
    const translated = tMain(documentTitle);
    if (translated !== title) {
      event.preventDefault();
      window.setTitle(translated);
    }
  });
}

export function refreshWindowTitle(window) {
  if (!window || window.isDestroyed() || !windowTitles.has(window)) return;
  window.setTitle(tMain(windowTitles.get(window)));
}

export function configureWindows(options) {
  platform = options;
}

export function shouldDeferWorkspaceStartup({ testHooksEnabled, env = process.env } = {}) {
  return testHooksEnabled === true && env.LIFE_ATLAS_TEST_DEFER_WORKSPACE_LOAD === "1";
}

export function themeBackgroundColor(nativeTheme = platform.nativeTheme) {
  return nativeTheme.shouldUseDarkColors ? "#191919" : "#ffffff";
}

export function secureWebPreferences({ preload, isPackaged, partition } = {}) {
  return {
    preload, sandbox: true, contextIsolation: true, nodeIntegration: false, nodeIntegrationInWorker: false,
    webSecurity: true, allowRunningInsecureContent: false, experimentalFeatures: false, webviewTag: false,
    navigateOnDragDrop: false, spellcheck: false, devTools: !isPackaged, ...(partition ? { partition } : {}),
  };
}

function createWindow({ preload, url, width, height, minWidth, minHeight, partition, title, documentTitle = title, externalLinks = true, widgetFrames = false, loadImmediately = true, showOnReady = true }) {
  const window = new platform.BrowserWindow({ width, height, minWidth, minHeight, show: false, title: tMain(title), backgroundColor: themeBackgroundColor(), autoHideMenuBar: true, webPreferences: secureWebPreferences({ preload, isPackaged: platform.isPackaged, partition }) });
  trackWindowTitle(window, title, documentTitle);
  window.setMenuBarVisibility(false);
  installContentsGuards(window.webContents, { allowedPrefix: url, widgetFrames, onExternalUrl: externalLinks ? (value) => confirmAndOpenExternal(window, value) : () => {} });
  if (showOnReady) window.once("ready-to-show", () => { if (!window.isDestroyed()) window.show(); });
  if (loadImmediately) window.loadURL(url).catch(() => platform.logger?.log("window.load-failed", { code: "E_IO" }));
  platform.logger?.log("window.created", { windowId: window.id });
  return window;
}

export function createWorkspaceWindow({ preload, url, deferLoad = false, testHooks, onDeferredLoaded }) {
  const deferred = platform.testHooksEnabled === true && deferLoad === true && Boolean(testHooks);
  const window = createWindow({ preload, url, width: 1440, height: 900, minWidth: 960, minHeight: 600, title: "Life Atlas", documentTitle: "Life Atlas · Private Workspace", widgetFrames: true, loadImmediately: !deferred, showOnReady: !deferred });
  if (deferred) {
    const initialized = window.loadURL("about:blank");
    initialized.catch(() => platform.logger?.log("window.load-failed", { code: "E_IO" }));
    let consumed = false;
    testHooks.loadWorkspaceForTest = async (...args) => {
      if (args.length) throw new TypeError("测试工作区加载不接受参数");
      if (consumed) throw new Error("测试工作区已经开始加载");
      consumed = true;
      try {
        await initialized;
        await window.loadURL(url);
        await onDeferredLoaded?.();
        if (!window.isDestroyed()) window.show();
        return {};
      } catch (error) {
        platform.logger?.log("window.load-failed", { code: "E_IO" });
        throw error;
      }
    };
  }
  return window;
}

export function createSetupWindow({ preload, url }) {
  return createWindow({ preload, url, width: 900, height: 720, minWidth: 720, minHeight: 600, title: "开始使用 Life Atlas", documentTitle: "开始使用 · Life Atlas", externalLinks: false });
}

export function createVaultWindow({ preload, url, onClose, onMinimize, onBlur, testHooks } = {}) {
  const window = createWindow({ preload, url, width: 1100, height: 800, minWidth: 760, minHeight: 600, title: "Life Atlas 密钥库", documentTitle: "密钥库", partition: "vault", externalLinks: false });
  window.setContentProtection(true);
  if (testHooks) testHooks.contentProtected = true;
  window.on("close", () => onClose?.());
  window.on("minimize", () => onMinimize?.());
  window.on("blur", () => onBlur?.());
  return window;
}

export function installThemeBackgroundSync() {
  const update = () => { for (const window of platform.BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.setBackgroundColor(themeBackgroundColor()); };
  platform.nativeTheme.on("updated", update);
  return () => platform.nativeTheme.removeListener("updated", update);
}
