const { contextBridge, ipcRenderer } = require("electron");

function subscribe(channel, callback) {
  const listener = (_event, value) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld("lifeAtlasMarkdownPreview", Object.freeze({
  locale: Object.freeze({
    get: () => ipcRenderer.invoke("la:locale:get"),
    onChanged: (callback) => subscribe("la:locale:changed", callback),
  }),
  list: () => ipcRenderer.invoke("la:markdown-preview:list"),
  read: id => ipcRenderer.invoke("la:markdown-preview:read", id),
  onChanged: callback => subscribe("la:markdown-preview:changed", callback),
}));
