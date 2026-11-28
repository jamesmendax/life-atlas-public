const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ocrSelection", {
  onFrame: (callback) => { ipcRenderer.once("ocr-selection:frame", (_, image) => callback(image)); },
  onRectangle: (callback) => { ipcRenderer.on("ocr-selection:rectangle", (_, rectangle) => callback(rectangle)); },
  loaded: (success) => ipcRenderer.send("ocr-selection:loaded", success),
  start: (x, y) => ipcRenderer.send("ocr-selection:start", x, y),
  commit: () => ipcRenderer.send("ocr-selection:commit"),
  cancel: () => ipcRenderer.send("ocr-selection:cancel"),
});
