import { constants } from "node:fs";
import { open } from "node:fs/promises";
import path from "node:path";
import { isAllowedNavigation, installContentsGuards, installSessionSecurity } from "./security.js";
import { assertPhysicalPath } from "./storage/dataRoot.js";
import { isTrustedSender } from "./ipc/validate.js";
import { installAppProtocol } from "./protocols.js";
import { secureWebPreferences, themeBackgroundColor, trackWindowTitle } from "./windows.js";
import { tMain } from "./i18n/index.js";

export const MARKDOWN_PREVIEW_EXTENSIONS = [".md", ".markdown", ".mdown", ".mkdn", ".mkd", ".rmd"];
export const MAX_MARKDOWN_PREVIEW_FILES = 10;
export const MAX_MARKDOWN_PREVIEW_BYTES = 8 * 1024 * 1024;
const PREVIEW_PARTITION = "markdown-preview";
const PREVIEW_CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const LIST = "la:markdown-preview:list";
const READ = "la:markdown-preview:read";
const CHANGED = "la:markdown-preview:changed";
const PREVIEW_TITLE = "Markdown 预览 · Life Atlas";
const accessDenied = () => ({ error: tMain("无法读取这个预览。") });
const isMarkdown = value => MARKDOWN_PREVIEW_EXTENSIONS.includes(path.extname(value).toLowerCase());

export function parseMarkdownPreviewArgs(args, workingDirectory = process.cwd()) {
  const marker = args.indexOf("--markdown-preview");
  const inputs = args.slice(marker + 1).filter(value => typeof value === "string" && value && !value.startsWith("--"));
  if (marker < 0 && !inputs.some(isMarkdown)) return null;
  const selected = inputs.slice(0, MAX_MARKDOWN_PREVIEW_FILES).map(value => path.resolve(workingDirectory, value));
  return { selected, overflow: inputs.length - selected.length };
}

export async function readSelectedMarkdown(file) {
  if (!isMarkdown(file) || /^\\\\/.test(file)) return { error: tMain("请选择本机的 Markdown 文件。") };
  let handle;
  try {
    const selected = assertPhysicalPath(file, { allowMissing: false });
    handle = await open(selected, constants.O_RDONLY | constants.O_NONBLOCK);
    const stat = await handle.stat();
    if (!stat.isFile()) return { error: tMain("所选路径不是文件。") };
    if (stat.size > MAX_MARKDOWN_PREVIEW_BYTES) return { error: tMain("文件超过 8 MB，无法预览。") };
    const limit = MAX_MARKDOWN_PREVIEW_BYTES + 1;
    const chunks = [];
    let length = 0;
    while (length < limit) {
      const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, limit - length));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      chunks.push(buffer.subarray(0, bytesRead));
      length += bytesRead;
    }
    if (length > MAX_MARKDOWN_PREVIEW_BYTES) return { error: tMain("文件超过 8 MB，无法预览。") };
    try { return { text: new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, length)) }; }
    catch { return { error: tMain("文件不是有效的 UTF-8 文本。") }; }
  } catch (error) {
    return { error: tMain(error.code === "ENOENT" ? "文件已移动或不存在。" : "无法读取所选文件。") };
  } finally { await handle?.close(); }
}

export function createMarkdownPreview({ BrowserWindow, ipcMain, session, devUrl, distDir, preload, nativeTheme, isPackaged, confirmExternal, onLoadError }) {
  const url = new URL("markdown-preview.html", devUrl || "app://bundle/index.html").href;
  const windows = new Map();
  let latest;
  let configured = false;

  const fromEvent = event => {
    const target = windows.get(event?.sender?.id);
    return target && isTrustedSender(event, target.window) && isAllowedNavigation(event.senderFrame.url, url) ? target : null;
  };
  const list = target => ({ files: [...target.files].map(([id, file]) => ({ id, name: path.basename(file) })), overflow: target.overflow });
  ipcMain.handle(LIST, (event, argument) => {
    const target = fromEvent(event);
    return target && argument === undefined ? list(target) : accessDenied();
  });
  ipcMain.handle(READ, (event, id) => {
    const file = fromEvent(event)?.files.get(id);
    return file ? readSelectedMarkdown(file) : accessDenied();
  });

  function openPreview({ selected, overflow }) {
    if (!configured) {
      const target = session.fromPartition(PREVIEW_PARTITION, { cache: false });
      installAppProtocol(target, { distDir, csp: PREVIEW_CSP });
      installSessionSecurity(target, { devOrigin: devUrl && new URL(devUrl).origin, allowClipboard: false });
      configured = true;
    }
    const now = Date.now();
    // The Windows shell can deliver separate processes for one file selection.
    const append = latest && !latest.window.isDestroyed() && selected.length === 1 && now - latest.receivedAt < 1000;
    let target = append ? latest : null;
    if (!target) {
      const window = new BrowserWindow({ width: 900, height: 760, minWidth: 460, minHeight: 350, show: false,
        title: tMain(PREVIEW_TITLE), backgroundColor: themeBackgroundColor(nativeTheme), autoHideMenuBar: true,
        webPreferences: secureWebPreferences({ preload, isPackaged, partition: PREVIEW_PARTITION }) });
      trackWindowTitle(window, PREVIEW_TITLE);
      window.setMenuBarVisibility(false);
      installContentsGuards(window.webContents, { allowedPrefix: url, onExternalUrl: value => confirmExternal(window, value) });
      const contentsId = window.webContents.id;
      target = { window, files: new Map(), overflow: 0 };
      windows.set(contentsId, target);
      window.once("closed", () => { windows.delete(contentsId); if (latest?.window === window) latest = undefined; });
      window.once("ready-to-show", () => { if (!window.isDestroyed()) window.show(); });
    }
    const { window, files } = target;
    for (const file of selected) {
      if ([...files.values()].includes(file)) continue;
      if (files.size === MAX_MARKDOWN_PREVIEW_FILES) target.overflow++;
      else files.set(String(files.size), file);
    }
    target.overflow += overflow;
    target.receivedAt = now;
    latest = target;
    if (append) {
      window.webContents.send(CHANGED, list(target));
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
    } else {
      window.loadURL(url).catch(() => {
        if (window.isDestroyed()) return;
        onLoadError();
        window.destroy();
      });
    }
  }
  openPreview.getWindows = () => [...windows.values()].map(({ window }) => window).filter(window => !window.isDestroyed());
  return openPreview;
}
