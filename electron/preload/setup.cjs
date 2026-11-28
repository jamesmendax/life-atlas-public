const { contextBridge, ipcRenderer } = require("electron");

function subscribe(channel, callback) {
  const listener = (_event, value) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld("lifeAtlasSetup", {
  locale: {
    get: () => ipcRenderer.invoke("la:locale:get"),
    set: (args) => ipcRenderer.invoke("la:locale:set", args),
    onChanged: (callback) => subscribe("la:locale:changed", callback),
  },
  getContrastPreference: () => ipcRenderer.invoke("la:appearance:get-contrast"),
  onContrastPreferenceChanged: (callback) => subscribe("la:appearance:contrast-changed", callback),
  getDefaults: () => ipcRenderer.invoke("la:setup:get-defaults"),
  chooseFolder: () => ipcRenderer.invoke("la:setup:choose-folder"),
  validateFolder: (args) => ipcRenderer.invoke("la:setup:validate-folder", args),
  inspectBackup: () => ipcRenderer.invoke("la:setup:inspect-backup"),
  inspectBackupWithPassword: (args) => ipcRenderer.invoke("la:setup:inspect-backup-with-password", args),
  finish: (args) => ipcRenderer.invoke("la:setup:finish", args),
});
