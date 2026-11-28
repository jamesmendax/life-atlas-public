import path from "node:path";
import { randomUUID } from "node:crypto";
import { shouldBlockRequest } from "./networkPolicy.js";
import { assertPhysicalPath } from "./storage/dataRoot.js";
import { isTrustedSender } from "./ipc/validate.js";
import { checkedTripEmbed, TRIP_EMBED_PATHS } from "../../src/domain/tripEmbed.js";

export const WORKSPACE_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' life-asset: data: blob:; media-src 'self' life-asset: blob: data:; font-src 'self' data:; connect-src 'self' life-asset:; object-src 'none'; frame-src life-widget: " + TRIP_EMBED_PATHS.join(" ") + "; base-uri 'none'; form-action 'none'";
export const VAULT_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";

export function isAllowedNavigation(value, allowedPrefix) {
  try {
    const target = new URL(value);
    const allowed = new URL(allowedPrefix);
    return target.protocol === allowed.protocol && target.hostname === allowed.hostname && target.port === allowed.port && target.pathname === allowed.pathname && target.search === allowed.search && !target.username && !target.password;
  } catch { return false; }
}

export function installContentsGuards(contents, { allowedPrefix, widgetFrames = false, onExternalUrl = () => {} }) {
  const external = (url) => { if (/^(?:https?|mailto):/i.test(url)) Promise.resolve(onExternalUrl(url)).catch(() => {}); };
  const navigate = (event, url) => {
    if (isAllowedNavigation(url, allowedPrefix)) return;
    event.preventDefault();
    external(url);
  };
  contents.on("will-navigate", navigate);
  contents.on("will-redirect", (event, url, _inPlace, mainFrame) => {
    if (event.isMainFrame === false || mainFrame === false) { event.preventDefault(); return; }
    navigate(event, url);
  });
  contents.on("will-frame-navigate", (event) => {
    if (event.isMainFrame) return;
    const parent = event.frame?.parent;
    if (widgetFrames && parent === contents.mainFrame && (!event.initiator || event.initiator === parent)
      && (/^life-widget:\/\/[a-f0-9-]{32,64}\/index\.html$/u.test(event.url) || checkedTripEmbed(event.url))) return;
    event.preventDefault();
  });
  contents.on("will-attach-webview", (event) => event.preventDefault());
  contents.setWindowOpenHandler(({ url, referrer }) => {
    if (!referrer?.url || isAllowedNavigation(referrer.url, allowedPrefix)) external(url);
    return { action: "deny" };
  });
}

// These are assets fetched by the official map document. A widget receives
// neither this network access nor the ability to supply asset URLs.
const mapResourceHosts = new Set(["www.amap.com", "ssr-next.amap.com", "webapi.amap.com", "jsapi.amap.com",
  "a.amap.com", "custyle.amap.com", "g.alicdn.com", "o.alicdn.com", "at.alicdn.com",
  ...[1, 2, 3, 4, 5].flatMap(n => ["jsapi-data" + n + ".amap.com", "o" + n + ".amap.com"])]);

export function tripEmbedRequest(details, workspaceUrl) {
  const frame = details.frame;
  const childOfWorkspace = frame?.parent && !frame.parent.parent && isAllowedNavigation(frame.parent.url, workspaceUrl);
  if (!childOfWorkspace) return null;
  if (details.resourceType === "subFrame" && checkedTripEmbed(details.url)) return true;
  if (!checkedTripEmbed(frame.url)) return null;
  if (["mainFrame", "subFrame"].includes(details.resourceType)) return false;
  let target;
  try { target = new URL(details.url); } catch { return false; }
  if (target.protocol === "data:" || (target.protocol === "blob:" && target.origin === "https://www.amap.com")) return true;
  if (target.protocol !== "https:" || target.username || target.password || target.port) return false;
  if (mapResourceHosts.has(target.hostname)) return true;
  // AMap retrieves satellite imagery and labels from these eight tile shards.
  return /^(?:webst|wprd)0[1-4]\.is\.autonavi\.com$/u.test(target.hostname) && target.pathname === "/appmaptile"
    && details.method === "GET" && ["image", "xhr", "other"].includes(details.resourceType);
}

export function installSessionSecurity(targetSession, { devOrigin, logger, networkLog, allowClipboard = true, dialogs,
  getWindowForContents = () => undefined, getWorkspaceWindow = () => undefined, workspaceUrl, locationIpc } = {}) {
  const at = () => new Date().toISOString();
  const network = (url) => /^(?:https?|wss?):/i.test(url);
  targetSession.webRequest.onBeforeRequest((details, callback) => {
    const mapRequest = workspaceUrl && allowClipboard ? tripEmbedRequest(details, workspaceUrl) : null;
    if (mapRequest != null) { callback({ cancel: !mapRequest }); return; }
    const widgetUrl = details.frame?.url;
    const fromWidget = widgetUrl?.startsWith("life-widget://");
    const allowedWidgetResource = !fromWidget || /^(?:data|blob):/u.test(details.url)
      || details.url.startsWith(`life-widget://${new URL(widgetUrl).host}/`);
    const blocked = !allowedWidgetResource || shouldBlockRequest(details.url, { devOrigin });
    if (blocked && network(details.url)) {
      networkLog?.blocked.push({ url: details.url, at: at() });
      let host;
      try { host = new URL(details.url).hostname; } catch {}
      logger?.log("network.blocked", { host });
    }
    callback({ cancel: blocked });
  });
  targetSession.webRequest.onCompleted((details) => {
    if (network(details.url)) networkLog?.completed.push({ url: tripEmbedRequest(details, workspaceUrl) == null ? details.url : new URL(details.url).origin, at: at() });
  });
  const pendingLocation = new WeakSet();
  const locationGrants = new WeakMap();
  const trustedLocationWindow = (contents, details) => {
    const window = getWorkspaceWindow();
    return window && !window.isDestroyed() && contents && !contents.isDestroyed() && window.webContents === contents
      && details?.isMainFrame === true && isAllowedNavigation(details.requestingUrl, workspaceUrl)
      && isAllowedNavigation(contents.getURL(), workspaceUrl) ? window : null;
  };
  const locationPermission = permission => permission === "geolocation" || permission === "geolocation-approximate";
  const mayReadLocation = (contents, details) => Boolean(trustedLocationWindow(contents, details)
    && locationGrants.get(contents)?.until > Date.now());
  const locationCheckDetails = (contents, origin, details) => {
    if (!details?.isMainFrame) return null;
    try {
      const expected = new URL(workspaceUrl);
      const request = new URL(origin);
      return request.protocol === expected.protocol && request.host === expected.host && !request.username && !request.password
        ? { ...details, requestingUrl: details.requestingUrl || contents?.getURL() } : null;
    } catch { return null; }
  };
  const revokeLocation = (contents, token) => {
    const grant = locationGrants.get(contents);
    if (!grant || token && grant.token !== token) return;
    locationGrants.delete(contents);
    contents.removeListener?.("did-start-navigation", grant.revoke);
  };
  const clipboardPermission = (permission, details) => allowClipboard && details?.isMainFrame !== false && permission === "clipboard-sanitized-write";
  const locationDetails = event => ({ isMainFrame: true, requestingUrl: event.senderFrame.url });
  locationIpc?.handle("la:database-map:authorize-location", async (event, args) => {
    if (args !== undefined || !isTrustedSender(event, getWorkspaceWindow())) return { status: "denied" };
    const contents = event.sender;
    const details = locationDetails(event);
    const window = trustedLocationWindow(contents, details);
    if (!window || !dialogs || pendingLocation.has(contents)) return { status: "denied" };
    revokeLocation(contents);
    pendingLocation.add(contents);
    try {
      const result = await dialogs.showMessageBox(window, {
        type: "question", title: "获取设备位置", message: "允许 Life Atlas 在当前地图显示设备位置？",
        detail: "本次定位由系统位置服务提供。设备位置不会作为数据库记录保存。",
        buttons: ["取消", "允许一次"], defaultId: 0, cancelId: 0, noLink: true,
      });
      if (result.response !== 1 || !isTrustedSender(event, getWorkspaceWindow()) || !trustedLocationWindow(contents, locationDetails(event))) return { status: "denied" };
      const token = randomUUID();
      const revoke = () => revokeLocation(contents, token);
      locationGrants.set(contents, { token, revoke, until: Date.now() + 15000 });
      contents.once?.("did-start-navigation", revoke);
      return { status: "authorized", token };
    } catch {
      return { status: "unavailable" };
    } finally {
      pendingLocation.delete(contents);
    }
  });
  locationIpc?.handle("la:database-map:release-location", (event, token) => {
    if (!isTrustedSender(event, getWorkspaceWindow()) || !trustedLocationWindow(event.sender, locationDetails(event))) return;
    if (typeof token === "string" && token) revokeLocation(event.sender, token);
  });
  targetSession.setPermissionRequestHandler((contents, permission, callback, details) =>
    callback(locationPermission(permission) ? mayReadLocation(contents, details) : clipboardPermission(permission, details)));
  targetSession.setPermissionCheckHandler((contents, permission, origin, details) =>
    locationPermission(permission) ? mayReadLocation(contents, locationCheckDetails(contents, origin, details)) : clipboardPermission(permission, details));
  targetSession.setSpellCheckerEnabled?.(false);
  targetSession.setSpellCheckerLanguages?.([]);
  const selectedDownloads = new Map();
  const reportDownload = (contents, url, outcome) => {
    if (url.startsWith("blob:") && !contents.isDestroyed()) contents.send("la:app:export-download", { url, outcome });
  };
  targetSession.on("will-download", (event, item, contents) => {
    const url = item.getURL();
    const key = `${contents?.id || 0}\0${url}`;
    const selected = selectedDownloads.get(key);
    if (selected) {
      selected.clear();
      try {
        item.setSavePath(selected.path);
        item.once("done", (_, state) => reportDownload(contents, url, state));
      } catch {
        event.preventDefault();
        reportDownload(contents, url, "failed");
      }
      return;
    }
    event.preventDefault();
    if (!/^(?:blob|data):/.test(url) || !dialogs || !contents || contents.isDestroyed()) return;
    const name = path.basename(item.getFilename() || "导出文件").replace(/[<>:"/\\|?*\0-\x1f]/g, "_");
    reportDownload(contents, url, "choosing");
    dialogs.showSaveDialog(getWindowForContents(contents), { title: "保存导出文件", defaultPath: name }).then((result) => {
      if (contents.isDestroyed()) return;
      if (result.canceled || !result.filePath) { reportDownload(contents, url, "cancelled"); return; }
      const destination = assertPhysicalPath(result.filePath);
      const clear = () => {
        clearTimeout(timer);
        contents.removeListener("destroyed", clear);
        selectedDownloads.delete(key);
      };
      // Only the handoff to the second DownloadItem has a deadline. The chooser and disk write do not.
      const timer = setTimeout(() => { clear(); reportDownload(contents, url, "failed"); }, 30000);
      timer.unref();
      contents.once("destroyed", clear);
      selectedDownloads.set(key, { path: destination, clear });
      try { contents.downloadURL(url); }
      catch (error) { clear(); throw error; }
    }).catch(() => { reportDownload(contents, url, "failed"); logger?.log("download.failed", { code: "E_IO" }); });
  });
}

export function createFlushController({ getWindow, timeoutMs = 3000, timers = { setTimeout, clearTimeout }, onTimeout = () => {}, canFlush = () => true } = {}) {
  let pending;
  let acknowledge;
  let timeout;
  const finish = (value) => {
    if (!pending) return;
    timers.clearTimeout(timeout);
    const resolve = acknowledge;
    pending = undefined;
    acknowledge = undefined;
    resolve(value);
  };
  return {
    request() {
      if (pending) return pending;
      const window = getWindow();
      if (!canFlush() || !window || window.isDestroyed() || window.webContents.isDestroyed()) return Promise.resolve(true);
      pending = new Promise((resolve) => { acknowledge = resolve; });
      const requested = pending;
      timeout = timers.setTimeout(() => { finish(false); Promise.resolve(onTimeout()).catch(() => {}); }, timeoutMs);
      try { window.webContents.send("la:app:flush-request"); } catch { finish(false); }
      return requested;
    },
    acknowledge() { finish(true); },
    cancel() { finish(false); },
    get pending() { return Boolean(pending); },
  };
}

export function installApplicationLifecycle({ app, flushController, lockVault = () => {}, shutdown = () => {}, logger, onError = () => {} } = {}) {
  let permittingQuit = false;
  let quitting = false;
  const permittingClose = new WeakSet();
  const closing = new WeakSet();
  const requestVaultLock = (reason) => {
    try { return Promise.resolve(lockVault(reason)); }
    catch (error) { return Promise.reject(error); }
  };
  const beforeQuit = (event) => {
    if (permittingQuit) return;
    event.preventDefault();
    if (quitting) return;
    quitting = true;
    requestVaultLock("app-quit").then(() => flushController.request()).then(async (saved) => {
      if (!saved) { quitting = false; return; }
      await shutdown();
      permittingQuit = true;
      app.quit();
    }).catch((error) => {
      quitting = false;
      logger?.log("app.quit-failed", { code: error.code || "E_IO" });
      Promise.resolve(onError(error)).catch(() => {});
    });
  };
  app.on("before-quit", beforeQuit);
  return {
    attachWorkspaceWindow(window) {
      window.on("close", (event) => {
        if (permittingQuit || permittingClose.has(window)) return;
        event.preventDefault();
        if (closing.has(window)) return;
        closing.add(window);
        requestVaultLock("window-closed").then(() => flushController.request()).then((saved) => {
          closing.delete(window);
          if (!saved || window.isDestroyed()) return;
          permittingClose.add(window);
          window.close();
        }).catch((error) => {
          closing.delete(window);
          logger?.log("window.close-failed", { code: error.code || "E_IO" });
          Promise.resolve(onError(error)).catch(() => {});
        });
      });
      window.on("closed", () => { if (!permittingQuit) app.quit(); });
    },
    get permittingQuit() { return permittingQuit; },
    dispose() { app.removeListener("before-quit", beforeQuit); flushController.cancel(); },
  };
}
