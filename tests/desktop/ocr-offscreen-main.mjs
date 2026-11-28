import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import { appendFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { app, BrowserWindow, ClipboardItem, clipboard, dialog, ipcMain, nativeImage, session } from "electron";

const configuration = JSON.parse(process.env.LIFE_ATLAS_OCR_TEST_CONFIG);
const { appRoot, profile, report } = configuration;
const trace = (text) => appendFileSync(`${report}.trace`, `${text}\n`, "utf8");
trace("entry");
const load = (...segments) => import(pathToFileURL(path.join(appRoot, ...segments)).href);
const denyNetwork = fileURLToPath(new URL("../fixtures/deny-ocr-network.cjs", import.meta.url));
const require = createRequire(import.meta.url);
require(denyNetwork);
process.execArgv.push("--require", denyNetwork);
app.setPath("userData", profile);
app.setPath("sessionData", profile);
app.setAppUserModelId("com.lifeatlas.ocr-offscreen");
app.disableHardwareAcceleration();
app.commandLine.appendSwitch("disable-background-networking");
app.commandLine.appendSwitch("disable-component-update");
app.on("window-all-closed", () => {});

const screens = [
  { id: 7, bounds: { x: -800, y: 0, width: 800, height: 600 }, scaleFactor: 2 },
  { id: 9, bounds: { x: 0, y: 0, width: 800, height: 600 }, scaleFactor: 1 },
];

function solidImage(width, height, color) {
  const pixels = Buffer.alloc(width * height * 4, Buffer.from(color));
  return nativeImage.createFromBitmap(pixels, { width, height, scaleFactor: 1 });
}

function fakeHost() {
  let visible = true;
  return {
    webContents: new EventEmitter(),
    isDestroyed: () => false,
    isFocused: () => true,
    isVisible: () => visible,
    isMinimized: () => false,
    hide: () => { visible = false; },
    showInactive: () => { visible = true; },
    focus: () => {},
  };
}

async function verifyOcrIpc(registerOcrIpc, isTrustedSender, sample, samplePath) {
  const contents = new BrowserWindow({
    show: false,
    skipTaskbar: true,
    webPreferences: {
      offscreen: true,
      backgroundThrottling: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(appRoot, "electron", "preload", "workspace.cjs"),
    },
  });
  let hasFocus = true;
  let selected = samplePath;
  let readError;
  let clipboardItems = [new ClipboardItem({ "image/png": new Blob([sample], { type: "image/png" }) })];
  let clipboardText;
  let writeError;
  const originalRead = clipboard.read;
  const originalWriteText = clipboard.writeText;
  const originalShowOpenDialog = dialog.showOpenDialog;
  const dispose = registerOcrIpc({ ipcMain, isAuthorized: (event) => isTrustedSender(event, contents) });
  try {
    contents.isFocused = () => hasFocus;
    const readFixture = async () => {
      if (readError) throw readError;
      return clipboardItems;
    };
    const writeFixture = async (value) => {
      if (writeError) throw writeError;
      clipboardText = value;
    };
    const pickFixture = async (owner, options) => {
      assert.equal(owner.id, contents.id);
      assert.deepEqual(options.properties, ["openFile"]);
      return selected ? { canceled: false, filePaths: [selected] } : { canceled: true, filePaths: [] };
    };
    clipboard.read = readFixture;
    clipboard.writeText = writeFixture;
    dialog.showOpenDialog = pickFixture;
    assert.equal(clipboard.read, readFixture);
    assert.equal(clipboard.writeText, writeFixture);
    assert.equal(dialog.showOpenDialog, pickFixture);
    await contents.loadURL("data:text/html;charset=utf-8,<!doctype html><title>OCR fixture</title>");
    const execute = (code) => contents.webContents.executeJavaScript(`window.lifeAtlas.ocr.${code}`);
    assert.equal((await execute("getStatus()")).available, true);

    const file = await execute('recognizeFile("chi_sim+eng")');
    assert.equal(file.ok, true);
    assert.match(file.text, /离线识别测试，图片文字/);
    selected = null;
    assert.deepEqual(await execute('recognizeFile("eng")'), { ok: true, cancelled: true });

    const image = await execute('recognizeClipboard("eng")');
    assert.equal(image.ok, true, image.code);
    assert.match(image.text, /Offline text recognition 2026/);

    const copiedFile = path.join(profile, "复制的图片 2026.png");
    await fs.writeFile(copiedFile, sample);
    const files = (uris) => new ClipboardItem({ "text/uri-list": new Blob([uris], { type: "text/uri-list" }) });
    clipboardItems = [files(`# Explorer files\r\n${pathToFileURL(path.join(profile, "notice.txt")).href}\r\n${pathToFileURL(copiedFile).href}\r\n`)];
    const copied = await execute('recognizeClipboard("eng")');
    assert.equal(copied.ok, true, copied.code);
    assert.match(copied.text, /Offline text recognition 2026/);

    clipboardItems = [new ClipboardItem({ "text/plain": "ordinary text", "text/html": '<img src="https://example.invalid/image.png">' })];
    assert.equal((await execute('recognizeClipboard("eng")')).code, "E_OCR_CLIPBOARD");
    clipboardItems = [files("https://example.invalid/image.png\r\nfile://example.invalid/share/image.png")];
    assert.equal((await execute('recognizeClipboard("eng")')).code, "E_OCR_CLIPBOARD");
    clipboardItems = [files(pathToFileURL(path.join(profile, "not-readable.png")).href)];
    assert.equal((await execute('recognizeClipboard("eng")')).code, "E_OCR_FILE");
    clipboardItems = [files(pathToFileURL(path.join(profile, "unsupported.gif")).href)];
    assert.equal((await execute('recognizeClipboard("eng")')).code, "E_OCR_IMAGE");
    clipboardItems = [new ClipboardItem({ "image/png": new Blob(["invalid image"]) })];
    assert.equal((await execute('recognizeClipboard("eng")')).code, "E_OCR_IMAGE");
    readError = new Error("Simulated clipboard read failure");
    assert.equal((await execute('recognizeClipboard("eng")')).code, "E_OCR_CLIPBOARD_READ");

    assert.deepEqual(await execute('copyText("已编辑的文字")'), { ok: true });
    assert.equal(clipboardText, "已编辑的文字");
    writeError = new Error("Simulated clipboard write failure");
    assert.equal((await execute('copyText("新文字")')).code, "E_OCR_COPY");
    hasFocus = false;
    assert.equal((await execute('recognizeClipboard("eng")')).code, "E_OCR_ACCESS");
    assert.equal(contents.isVisible(), false);
  } finally {
    dispose();
    clipboard.read = originalRead;
    clipboard.writeText = originalWriteText;
    dialog.showOpenDialog = originalShowOpenDialog;
    contents.destroy();
  }
}

async function verifySelection(selectScreenArea, inspectImage, mode) {
  trace(`select:${mode}:begin`);
  const framesShown = Promise.withResolvers();
  const overlays = [];
  const contents = [];
  const onRenderErrors = [];
  const host = fakeHost();
  const independentOverlay = fakeHost();
  let cursor = { x: -200, y: 100 };

  class OffscreenWindow {
    constructor(options) {
      this.native = new BrowserWindow({ ...options, show: false, webPreferences: { ...options.webPreferences, offscreen: true, backgroundThrottling: false } });
      this.webContents = this.native.webContents;
      this.webContents.on("console-message", (_, message) => {
        if (message.level === "error") onRenderErrors.push(message.message);
      });
      this.webContents.on("did-finish-load", () => trace(`select:${mode}:loaded`));
      this.webContents.on("ipc-message", (_, channel) => trace(`select:${mode}:ipc:${channel}`));
      this.webContents.on("preload-error", (_, __, error) => onRenderErrors.push(error.message));
      contents.push(this);
    }
    setMenuBarVisibility(show) { this.native.setMenuBarVisibility(show); }
    setAlwaysOnTop() {}
    once(event, handler) { this.native.once(event, handler); }
    loadURL(url) { return this.native.loadURL(url); }
    isDestroyed() { return this.native.isDestroyed(); }
    destroy() { this.native.destroy(); }
    focus() {}
    showInactive() {
      assert.equal(this.native.isVisible(), false);
      overlays.push(this);
      if (overlays.length === screens.length) framesShown.resolve(overlays);
    }
  }

  const screen = Object.assign(new EventEmitter(), {
    getAllDisplays: () => screens,
    getCursorScreenPoint: () => cursor,
    getDisplayNearestPoint: (point) => screens[point.x < 0 ? 0 : 1],
  });
  const desktopCapturer = {
    async getSources(options) {
      assert.equal(host.isVisible(), true);
      assert.equal(independentOverlay.isVisible(), false);
      assert.deepEqual(options, { types: ["screen"], thumbnailSize: { width: 1600, height: 1200 } });
      return [
        { display_id: "9", thumbnail: solidImage(800, 600, [255, 0, 0, 255]) },
        { display_id: "7", thumbnail: solidImage(1600, 1200, [0, 0, 255, 255]) },
      ];
    },
  };

  const selection = selectScreenArea({ BrowserWindow: OffscreenWindow, desktopCapturer, screen, ipcMain, nativeImage, owner: host, hideWindows: [independentOverlay] });
  const [left, right] = await Promise.race([
    framesShown.promise,
    selection.then(
      () => { throw new Error("screen selection exited without showing previews"); },
      (error) => { throw new Error(`${error.message} ${onRenderErrors.join(" | ")}`, { cause: error }); },
    ),
  ]);
  trace(`select:${mode}:show`);
  assert.deepEqual(await left.webContents.executeJavaScript("[document.querySelector('#frame').naturalWidth, getComputedStyle(document.querySelector('#capture')).cursor]"), [1600, "crosshair"]);
  const completeSelection = (action) => Promise.race([
    selection,
    left.webContents.executeJavaScript(action).then(() => selection),
  ]);

  if (mode === "select") {
    trace(`select:${mode}:drag`);
    await left.webContents.executeJavaScript("window.ocrSelection.start(600, 100)");
    cursor = { x: 100, y: 300 };
    await delay(180);
    assert.deepEqual(await right.webContents.executeJavaScript("[document.querySelector('#selection').hidden, document.querySelector('#selection').style.width]"), [false, "100px"]);
    const result = await completeSelection("window.ocrSelection.commit()");
    assert.deepEqual(inspectImage(result), { width: 600, height: 400, orientation: 1 });
    const composed = nativeImage.createFromBuffer(result).toBitmap();
    assert.deepEqual(Array.from(composed.subarray(0, 4)), [0, 0, 255, 255]);
    assert.deepEqual(Array.from(composed.subarray(599 * 4, 600 * 4)), [255, 0, 0, 255]);
  } else if (mode === "cancel") {
    trace(`select:${mode}:release`);
    assert.equal(await completeSelection("document.querySelector('#cancel').click()"), null);
  } else {
    screen.emit("display-metrics-changed");
    await assert.rejects(selection, { code: "E_OCR_DISPLAY" });
  }
  assert.ok(contents.every((window) => window.isDestroyed()));
  assert.equal(host.isVisible(), true);
  assert.equal(independentOverlay.isVisible(), true);
  assert.equal(ipcMain.listenerCount("ocr-selection:commit"), 0);
  assert.deepEqual(onRenderErrors, []);
  trace(`select:${mode}:done`);
}

async function run() {
  trace("ready");
  const { installSessionSecurity } = await load("electron", "main", "security.js");
  const { isTrustedSender } = await load("electron", "main", "ipc", "validate.js");
  const { getOcrStatus, recognizeImage } = await load("electron", "main", "ocr", "engine.js");
  const { registerOcrIpc } = await load("electron", "main", "ocr", "index.js");
  const { inspectImage } = await load("electron", "main", "ocr", "images.js");
  const { selectScreenArea } = await load("electron", "main", "ocr", "screenCapture.js");
  installSessionSecurity(session.defaultSession, { allowClipboard: false });
  assert.equal(getOcrStatus().available, true);
  const samplePath = fileURLToPath(new URL("../fixtures/ocr-sample.png", import.meta.url));
  const testImage = await fs.readFile(samplePath);
  const text = await recognizeImage(testImage);
  assert.match(text, /Offline text recognition 2026/);
  assert.match(text, /离线识别测试，图片文字/);
  trace("worker:done");
  await verifyOcrIpc(registerOcrIpc, isTrustedSender, testImage, samplePath);
  trace("ipc:done");
  for (const mode of ["select", "cancel", "display-change"]) await verifySelection(selectScreenArea, inspectImage, mode);
  await fs.writeFile(report, JSON.stringify({ ok: true, electron: process.versions.electron, appRoot, text, scenarios: ["file selection", "clipboard image and file URI through IPC", "clipboard errors and copy result", "cross-display crop", "cancel", "display changed"] }, null, 2));
  app.exit(0);
}

app.whenReady().then(run).catch(async (error) => {
  await fs.writeFile(report, JSON.stringify({ ok: false, error: error.stack }, null, 2));
  app.exit(1);
});
