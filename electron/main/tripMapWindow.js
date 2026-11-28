import { secureWebPreferences } from "./windows.js";
import { errorResult, fail, ok } from "./ipc/result.js";
import { isPlainObject, isTrustedSender } from "./ipc/validate.js";
import { createAmapPersonalMap } from "./amapPersonalMap.js";

const embeddedModes = new Set(["car", "bus", "walk", "ride"]);
const allowedParams = new Set(["from", "to", "via", "type", "platform", "src", "policy", "ride_type"]);
function checkedEmbed(value) {
  if (typeof value !== "string" || value.length > 8192) return null;
  try {
    const url = new URL(value);
    if (url.origin !== "https://www.amap.com" || url.pathname !== "/ssr/embed/dir" || url.hash || url.username || url.password) return null;
    if ([...url.searchParams.keys()].some((name) => !allowedParams.has(name)) || !embeddedModes.has(url.searchParams.get("type"))) return null;
    for (const name of ["from", "to"]) {
      const coordinate = url.searchParams.get(name)?.split(",") || [];
      if (coordinate.length < 2 || coordinate.slice(0, 2).some((n) => !/^-?\d+(?:\.\d{1,8})?$/.test(n))
        || Math.abs(Number(coordinate[0])) > 180 || Math.abs(Number(coordinate[1])) > 85) return null;
    }
    url.searchParams.set("platform", "pc");
    return url.href;
  } catch { return null; }
}

export function registerTripMapWindows({ ipcMain, getWindow, capabilityOwner, BrowserWindow, session, isPackaged, getKey, getAmapAccess, fetchImpl }) {
  let mapWindow, loading = 0, personalPending = false;
  let isolated;
  function officialWindow() {
    if (mapWindow && !mapWindow.isDestroyed()) return mapWindow;
    if (!isolated) {
      isolated = session.fromPartition("life-atlas-amap-view");
      isolated.setPermissionCheckHandler(() => false);
      isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
      isolated.on("will-download", (event) => event.preventDefault());
    }
    const win = new BrowserWindow({ parent: getWindow(), title: "高德地图 · Life Atlas", width: 1000, height: 720,
      minWidth: 520, minHeight: 420, show: false, autoHideMenuBar: true,
      webPreferences: { ...secureWebPreferences({ isPackaged }), session: isolated } });
    win.removeMenu();
    win.webContents.setWindowOpenHandler(({ url }) => {
      try {
        const dest = new URL(url);
        if (dest.origin === "https://www.amap.com" && !dest.username && !dest.password) {
          void win.loadURL(dest.href).catch(() => {});
        }
      } catch { /* The official desktop map only uses HTTPS. */ }
      return { action: "deny" };
    });
    const onNavigate = (event, url) => {
      try { const target = new URL(url); if (target.origin === "https://www.amap.com" && !target.username && !target.password) return; } catch {}
      event.preventDefault();
    };
    win.webContents.on("will-navigate", onNavigate);
    win.webContents.on("will-redirect", onNavigate);
    win.on("page-title-updated", (event) => event.preventDefault());
    win.on("closed", () => { if (mapWindow === win) mapWindow = null; });
    mapWindow = win;
    return win;
  }
  const trusted = (event, args) => isTrustedSender(event, getWindow()) && isPlainObject(args) && Boolean(capabilityOwner(args.frameUrl, "trip-routing"));
  ipcMain.handle("la:trip:map", async (event, args) => {
    if (!trusted(event, args)) return fail("E_FORBIDDEN", "这个组件没有地图权限。");
    const url = checkedEmbed(args.url);
    if (!url) return fail("E_INVALID_ARGUMENT", "高德路线地址或坐标无效。");
    const id = ++loading;
    const win = officialWindow();
    try {
      await win.loadURL(url);
      if (id !== loading || win.isDestroyed()) return fail("E_CANCELLED", "已切换路线。");
      win.show(); win.focus();
      return ok({ opened: true });
    } catch {
      if (id === loading && !win.isDestroyed()) win.close();
      return fail("E_IO", "无法加载高德地图，请检查网络。");
    }
  });
  ipcMain.handle("la:trip:personal-map", async (event, args) => {
    if (!trusted(event, args)) return fail("E_FORBIDDEN", "这个组件没有地图权限。");
    if (personalPending) return fail("E_THROTTLED", "正在生成专属地图。");
    personalPending = true;
    try {
      const input = { plan: args.plan, day: args.day, date: args.date };
      const access = getAmapAccess ? getAmapAccess() : { key: await getKey() };
      const signal = access.signal && AbortSignal.any([access.signal, AbortSignal.timeout(40000)]);
      return ok(await createAmapPersonalMap(input, { key: access.key, signal, fetchImpl }));
    }
    catch (error) { return errorResult(error, "高德地图生成失败。"); }
    finally { personalPending = false; }
  });
}
