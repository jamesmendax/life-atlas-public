import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { isTrustedSender } from "../ipc/validate.js";
import { OcrError } from "./errors.js";
import { nativeImageBytes } from "./images.js";
import { captureThumbnailSize, displayLocalRect, planSelection, rectangleBetween } from "./screenGeometry.js";

const overlayPreload = fileURLToPath(new URL("./selection-preload.cjs", import.meta.url));
const displayEvents = ["display-added", "display-removed", "display-metrics-changed"];
let overlayUrl;

function selectionPageUrl() {
  if (overlayUrl) return overlayUrl;
  // Electron's restricted file protocol cannot serve HTML inside app.asar.
  const read = (file) => readFileSync(new URL(file, import.meta.url), "utf8").replaceAll("\r\n", "\n");
  const sha256 = (value) => createHash("sha256").update(value).digest("base64");
  const stylesheet = read("./selection.css");
  const renderer = read("./selection-renderer.js");
  const html = read("./selection.html")
    .replace("__STYLE_HASH__", sha256(stylesheet))
    .replace("__SCRIPT_HASH__", sha256(renderer))
    .replace("<!--selection-style-->", () => `<style>${stylesheet}</style>`)
    .replace("<!--selection-script-->", () => `<script>${renderer}</script>`);
  overlayUrl = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
  return overlayUrl;
}

async function readScreenFrames(screen, desktopCapturer) {
  const displays = screen.getAllDisplays();
  if (!displays.length) throw new OcrError("E_OCR_SCREEN");
  const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: captureThumbnailSize(displays) });
  const byId = new Map(sources.map((source) => [source.display_id, source.thumbnail]));
  return displays.map((display) => {
    const image = byId.get(String(display.id)) ?? (displays.length === 1 && sources.length === 1 ? sources[0].thumbnail : undefined);
    if (!image || image.isEmpty()) throw new OcrError("E_OCR_SCREEN");
    return { image, displayId: display.id, bounds: display.bounds, size: image.getSize(1) };
  });
}

export function cropScreenSelection(nativeImage, frames, selected) {
  const plan = planSelection(selected, frames);
  if (plan.singleCrop) {
    const { frame, source } = plan.singleCrop;
    return nativeImageBytes(frame.image.crop(source));
  }
  const { width, height, tiles } = plan;
  const bitmap = Buffer.alloc(width * height * 4, 255);
  for (const { frame, source, destination } of tiles) {
    const { x, y, width: tileWidth, height: tileHeight } = destination;
    if (tileWidth === 0 || tileHeight === 0) continue;
    const crop = frame.image.crop(source).resize({ width: tileWidth, height: tileHeight, quality: "best" });
    const pixels = crop.toBitmap({ scaleFactor: 1 });
    const stride = tileWidth * 4;
    for (let row = 0; row < tileHeight; row += 1) {
      pixels.copy(bitmap, ((y + row) * width + x) * 4, row * stride, (row + 1) * stride);
    }
  }
  return nativeImageBytes(nativeImage.createFromBitmap(bitmap, { width, height, scaleFactor: 1 }));
}

function createOverlay(BrowserWindow, bounds) {
  const overlay = new BrowserWindow({
    ...bounds,
    frame: false,
    thickFrame: false,
    show: false,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    backgroundColor: "#0f0f0f",
    webPreferences: {
      preload: overlayPreload,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      navigateOnDragDrop: false,
      spellcheck: false,
      devTools: false,
    },
  });
  overlay.setMenuBarVisibility(false);
  overlay.setAlwaysOnTop(true, "screen-saver");
  overlay.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  overlay.webContents.on("will-navigate", (event) => event.preventDefault());
  return overlay;
}

export async function selectScreenArea({ BrowserWindow, desktopCapturer, screen, ipcMain, nativeImage, owner, hideWindows = [] }) {
  const hidden = [];
  const overlays = new Map();
  const result = Promise.withResolvers();
  result.promise.catch(() => {});
  let alreadyFinished = false;
  let startPoint;
  let pointerSampler;
  let startOverlay;
  let lastPointer;
  let loaded = false;
  const ownerContents = owner.webContents;
  const restoreFocus = owner.isFocused();

  function finish(value, error) {
    if (alreadyFinished) return;
    alreadyFinished = true;
    if (error) result.reject(error);
    else result.resolve(value);
  }

  function stateFor(event) {
    const state = overlays.get(event.sender.id);
    return state && isTrustedSender(event, state.window) ? state : undefined;
  }

  function showRectangle() {
    const point = screen.getCursorScreenPoint();
    if (point.x === lastPointer?.x && point.y === lastPointer?.y) return;
    lastPointer = point;
    const rectangle = rectangleBetween(startPoint, point);
    for (const { window, frame } of overlays.values()) {
      if (!window.isDestroyed()) window.webContents.send("ocr-selection:rectangle", displayLocalRect(rectangle, frame.bounds));
    }
  }

  const listeners = [
    ["ocr-selection:loaded", (event, success) => stateFor(event)?.ready.resolve(success === true)],
    ["ocr-selection:start", (event, x, y) => {
      const state = stateFor(event);
      if (!loaded || !state || startOverlay || !Number.isFinite(x) || !Number.isFinite(y)) return;
      const { bounds } = state.frame;
      startPoint = {
        x: bounds.x + Math.round(Math.max(0, Math.min(bounds.width, x))),
        y: bounds.y + Math.round(Math.max(0, Math.min(bounds.height, y))),
      };
      startOverlay = state;
      pointerSampler = setInterval(showRectangle, 24);
    }],
    ["ocr-selection:commit", (event) => {
      if (startOverlay && stateFor(event) === startOverlay) finish(rectangleBetween(startPoint, screen.getCursorScreenPoint()));
    }],
    ["ocr-selection:cancel", (event) => { if (stateFor(event)) finish(null); }],
  ];
  const cancel = () => finish(null);
  const displayChanged = () => finish(null, new OcrError("E_OCR_DISPLAY"));
  const failed = () => finish(null, new OcrError("E_OCR_SCREEN"));
  const setupTimeout = setTimeout(failed, 12_000);
  const idleTimeout = setTimeout(cancel, 120_000);
  let frames;
  try {
    const pageUrl = selectionPageUrl();
    for (const [channel, listener] of listeners) ipcMain.on(channel, listener);
    for (const name of displayEvents) screen.on(name, displayChanged);
    ownerContents.once("destroyed", cancel);
    for (const window of new Set(hideWindows)) {
      if (window && !window.isDestroyed() && window.isVisible() && !window.isMinimized()) {
        hidden.push(window);
        window.hide();
      }
    }
    const capture = delay(90).then(() => (alreadyFinished ? null : readScreenFrames(screen, desktopCapturer)));
    frames = await Promise.race([capture, result.promise]);
    if (!frames) return null;

    await Promise.race([
      Promise.all(frames.map(async (frame) => {
        const window = createOverlay(BrowserWindow, frame.bounds);
        const ready = Promise.withResolvers();
        overlays.set(window.webContents.id, { window, frame, ready });
        window.once("closed", cancel);
        window.webContents.once("render-process-gone", failed);
        window.webContents.on("before-input-event", (event, input) => {
          if (input.type === "keyDown" && input.key === "Escape") {
            event.preventDefault();
            cancel();
          }
        });
        await window.loadURL(pageUrl);
        if (alreadyFinished) return;
        window.webContents.setZoomFactor(1);
        const preview = frame.size.width > 2560 ? frame.image.resize({ width: 2560, quality: "good" }) : frame.image;
        const image = `data:image/jpeg;base64,${preview.toJPEG(86).toString("base64")}`;
        window.webContents.send("ocr-selection:frame", image);
        if (!await ready.promise) failed();
      })),
      result.promise,
    ]);
    if (alreadyFinished) return null;
    clearTimeout(setupTimeout);
    loaded = true;
    const activeDisplay = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id;
    let focusedWindow;
    for (const { window, frame } of overlays.values()) {
      window.showInactive();
      if (frame.displayId === activeDisplay) focusedWindow = window;
    }
    (focusedWindow ?? overlays.values().next().value?.window)?.focus();

    const selected = await result.promise;
    return selected ? cropScreenSelection(nativeImage, frames, selected) : null;
  } catch (error) {
    if (error instanceof OcrError) throw error;
    throw new OcrError("E_OCR_SCREEN");
  } finally {
    alreadyFinished = true;
    clearTimeout(setupTimeout);
    clearTimeout(idleTimeout);
    clearInterval(pointerSampler);
    for (const [channel, listener] of listeners) ipcMain.removeListener(channel, listener);
    for (const name of displayEvents) screen.removeListener(name, displayChanged);
    ownerContents.removeListener("destroyed", cancel);
    for (const { window, ready } of overlays.values()) {
      ready.resolve(false);
      if (!window.isDestroyed()) window.destroy();
    }
    for (const window of hidden.reverse()) if (!window.isDestroyed() && !window.isMinimized()) window.showInactive();
    if (restoreFocus && !owner.isDestroyed() && owner.isVisible() && !owner.isMinimized()) owner.focus();
  }
}
