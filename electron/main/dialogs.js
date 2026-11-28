import { StorageError } from "./storage/workspaceDb.js";

let configured;

export function createDialogs({ dialog, shell, testHooksEnabled = false, state } = {}) {
  const testState = state || { queue: { showMessageBox: [], showSaveDialog: [], showOpenDialog: [] }, calls: [] };
  const record = (kind, options, response) => { testState.calls.push({ kind, options, response }); return response; };
  const call = (method, window, options) => window ? dialog[method](window, options) : dialog[method](options);
  return {
    state: testState,
    async showMessageBox(window, options) {
      if (!testHooksEnabled) return call("showMessageBox", window, options);
      const queued = testState.queue.showMessageBox.shift();
      const response = queued && typeof queued === "object" ? queued : { response: Number.isInteger(queued) ? queued : options.cancelId ?? (options.buttons?.length ? options.buttons.length - 1 : 0), checkboxChecked: false };
      return record("showMessageBox", options, response);
    },
    async showSaveDialog(window, options) {
      if (!testHooksEnabled) return call("showSaveDialog", window, options);
      const queued = testState.queue.showSaveDialog.shift();
      const response = typeof queued === "string" && queued ? { canceled: false, filePath: queued } : queued && typeof queued === "object" ? queued : { canceled: true };
      return record("showSaveDialog", options, response);
    },
    async showOpenDialog(window, options) {
      if (!testHooksEnabled) return call("showOpenDialog", window, options);
      const queued = testState.queue.showOpenDialog.shift();
      const response = Array.isArray(queued) && queued.length ? { canceled: false, filePaths: queued } : queued && typeof queued === "object" && !Array.isArray(queued) ? queued : { canceled: true, filePaths: [] };
      return record("showOpenDialog", options, response);
    },
    showErrorBox(title, content) {
      if (!testHooksEnabled) return dialog.showErrorBox(title, content);
      return record("showErrorBox", { title, content }, undefined);
    },
    async openExternal(url) {
      if (!testHooksEnabled) return shell.openExternal(url);
      return record("openExternal", { url }, undefined);
    },
    async openPath(filePath) {
      if (!testHooksEnabled) return shell.openPath(filePath);
      return record("openPath", { path: filePath }, "");
    },
  };
}

export function configureDialogs(options) {
  configured = createDialogs(options);
  return configured;
}

function adapter() {
  if (!configured) throw new StorageError("E_IO", "系统对话框尚未准备好");
  return configured;
}

export const showMessageBox = (window, options) => adapter().showMessageBox(window, options);
export const showSaveDialog = (window, options) => adapter().showSaveDialog(window, options);
export const showOpenDialog = (window, options) => adapter().showOpenDialog(window, options);
export const showErrorBox = (title, content) => adapter().showErrorBox(title, content);
export const openExternal = (url) => adapter().openExternal(url);
export const openPath = (filePath) => adapter().openPath(filePath);
