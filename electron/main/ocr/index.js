import { BrowserWindow, clipboard, desktopCapturer, dialog, nativeImage, screen } from "electron";
import { readClipboardImage } from "./clipboard.js";
import { DEFAULT_OCR_LANGUAGE, OCR_LANGUAGES, getOcrStatus, recognizeImage } from "./engine.js";
import { OcrError, ocrFailure } from "./errors.js";
import { IMAGE_EXTENSIONS, readImageFile } from "./images.js";
import { selectScreenArea } from "./screenCapture.js";

export function registerOcrIpc({ ipcMain, isAuthorized, getCaptureWindows = () => [] }) {
  let running = false;
  const channels = [];

  function handle(action, operation) {
    const channel = `assistant:ocr:${action}`;
    channels.push(channel);
    ipcMain.handle(channel, async (event, ...args) => {
      try {
        if (!isAuthorized(event)) throw new OcrError("E_OCR_ACCESS");
        const owner = BrowserWindow.fromWebContents(event.sender);
        if (!owner || owner.isDestroyed() || (action !== "status" && !owner.isFocused())) throw new OcrError("E_OCR_ACCESS");
        return await operation(owner, ...args);
      } catch (error) {
        return ocrFailure(error);
      }
    });
  }

  function recognize(readImage) {
    return async (owner, language = DEFAULT_OCR_LANGUAGE) => {
      if (!OCR_LANGUAGES.includes(language)) throw new OcrError("E_OCR_LANGUAGE");
      if (running) throw new OcrError("E_OCR_BUSY");
      const status = getOcrStatus();
      if (!status.available) return status;
      running = true;
      try {
        const image = await readImage(owner);
        if (!image || owner.isDestroyed()) return { ok: true, cancelled: true };
        return { ok: true, text: await recognizeImage(image, language) };
      } finally {
        running = false;
      }
    };
  }

  handle("status", () => getOcrStatus());

  handle("file", recognize(async (owner) => {
    const result = await dialog.showOpenDialog(owner, {
      title: "选择要识别的图片",
      properties: ["openFile"],
      filters: [{ name: "图片", extensions: IMAGE_EXTENSIONS }],
    });
    return result.canceled || !result.filePaths[0] ? null : readImageFile(result.filePaths[0]);
  }));

  handle("clipboard", recognize(() => readClipboardImage(clipboard)));

  handle("screen", recognize((owner) => selectScreenArea({
    BrowserWindow, desktopCapturer, screen, ipcMain, nativeImage, owner, hideWindows: getCaptureWindows(owner),
  })));

  handle("copy", async (_, text) => {
    if (typeof text !== "string" || !text.trim() || text.length > 1_000_000) throw new OcrError("E_OCR_COPY");
    try {
      await clipboard.writeText(text);
    } catch {
      throw new OcrError("E_OCR_COPY");
    }
    return { ok: true };
  });

  return () => { for (const channel of channels) ipcMain.removeHandler(channel); };
}
