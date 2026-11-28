import { MAX_ROUTE_STOPS, ROUTE_GEOMETRY_VERSION, VALID_POINT } from "../../../src/domain/tripRoutes.js";
import { errorResult, fail, ok } from "./result.js";
import { isPlainObject, isTrustedSender } from "./validate.js";
import { tMain } from "../i18n/index.js";

const folderActions = {
  runtime: { title: "选择解压后的官方 BRouter 文件夹", configure: (router, directory) => router.configure(directory) },
  java: { title: "选择 Java 文件夹（包含 bin/java.exe）", configure: (router, directory) => router.configureJava(directory) },
  roads: { title: "选择包含 .rd5 路网文件的文件夹", configure: (router, directory) => router.importSegments(directory) },
};

export function registerTripOfflineIpc({ ipcMain, getWindow, capabilityOwner, dialog, router }) {
  let operation;
  function authorized(event, args, requireComponent = false) {
    return isTrustedSender(event, getWindow()) && isPlainObject(args) &&
      (typeof args.frameUrl === "string"
        ? Boolean(capabilityOwner(args.frameUrl, "trip-routing"))
        : !requireComponent && args.frameUrl === undefined);
  }
  function validPoints(points, optional) {
    return optional && points === undefined || Array.isArray(points) && points.length >= 2 &&
      points.length <= MAX_ROUTE_STOPS && points.every(VALID_POINT);
  }

  ipcMain.handle("la:trip:offline-status", async (event, args = {}) => {
    if (!authorized(event, args)) return fail("E_FORBIDDEN", "这个窗口没有离线路网权限。");
    if (!validPoints(args.points, true)) return fail("E_INVALID_ARGUMENT", "请选择有坐标的起终点和途经站。");
    try { return ok(await router.status({ coords: args.points })); }
    catch (error) { return errorResult(error, "无法读取离线路网。"); }
  });
  ipcMain.handle("la:trip:offline-setup", async (event, args = {}) => {
    if (!authorized(event, args) || args.frameUrl !== undefined) return fail("E_FORBIDDEN", "请在地图服务设置中管理离线路网。");
    if (!Object.hasOwn(folderActions, args.kind)) return fail("E_INVALID_ARGUMENT", "无效的离线路网设置。");
    if (operation) return fail("E_THROTTLED", "正在准备离线路网。");
    operation = "setup";
    try {
      const action = folderActions[args.kind];
      const selected = await dialog.showOpenDialog(getWindow(), { title: tMain(action.title), properties: ["openDirectory"] });
      if (selected.canceled || !selected.filePaths[0]) return fail("E_CANCELLED", "已取消选择文件夹。");
      return ok(await action.configure(router, selected.filePaths[0]));
    } catch (error) { return errorResult(error, "无法导入离线路网，请检查所选目录。"); }
    finally { operation = undefined; }
  });
  ipcMain.handle("la:trip:offline-download", async (event, args = {}) => {
    if (!authorized(event, args, true)) return fail("E_FORBIDDEN", "这个组件没有下载离线路网的权限。");
    if (!validPoints(args.points, false)) return fail("E_INVALID_ARGUMENT", "请选择有坐标的起终点和途经站。");
    if (operation) return fail("E_THROTTLED", "正在准备离线路网。");
    operation = "download";
    try { return ok(await router.downloadSegments({ coords: args.points })); }
    catch (error) { return errorResult(error, "未能下载离线路网，请检查网络或从本机导入。"); }
    finally { operation = undefined; }
  });
}

export async function calculateOfflineTrip(router, { mode, points, highwayRef }, now = Date.now) {
  const result = await router.route({ mode, coords: points });
  return { ...result, geometryVersion: ROUTE_GEOMETRY_VERSION, source: "BRouter / OpenStreetMap",
    at: new Date(now()).toISOString().slice(0, 10), ...(highwayRef && { highwayRef, highwayVerified: false }) };
}
