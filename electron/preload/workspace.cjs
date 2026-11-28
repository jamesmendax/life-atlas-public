const { contextBridge, ipcRenderer } = require("electron");

const subscribe = (channel, callback) => {
  if (typeof callback !== "function") throw new TypeError("订阅需要回调函数");
  const listener = (_, value) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

function completeAssistant(request, onReasoning) {
  if (typeof onReasoning !== "function") return ipcRenderer.invoke("la:assistant:complete", request);
  const unsubscribe = subscribe("la:assistant:reasoning", (value) => {
    if (value?.requestId === request.requestId && typeof value.text === "string") onReasoning(value.text);
  });
  return ipcRenderer.invoke("la:assistant:complete", { ...request, stream: true }).finally(unsubscribe);
}

contextBridge.exposeInMainWorld("lifeAtlas", {
  platform: "desktop",
  locale: {
    get: () => ipcRenderer.invoke("la:locale:get"),
    set: (args) => ipcRenderer.invoke("la:locale:set", args),
    onChanged: (callback) => subscribe("la:locale:changed", callback),
  },
  forms: {
    status: args => ipcRenderer.invoke("la:forms:status", args),
    start: args => ipcRenderer.invoke("la:forms:start", args),
    stop: args => ipcRenderer.invoke("la:forms:stop", args),
    pending: args => ipcRenderer.invoke("la:forms:pending", args),
    pendingViews: () => ipcRenderer.invoke("la:forms:pendingViews"),
    ack: args => ipcRenderer.invoke("la:forms:ack", args),
    onReceived: callback => subscribe("la:forms:received", callback),
  },
  databaseMap: {
    authorizeLocation: () => ipcRenderer.invoke("la:database-map:authorize-location"),
    releaseLocation: token => ipcRenderer.invoke("la:database-map:release-location", token),
    tile: (args) => ipcRenderer.invoke("la:database-map:tile", args),
    cancel: (args) => ipcRenderer.invoke("la:database-map:cancel", args),
    search: (args) => ipcRenderer.invoke("la:database-map:search", args),
    cancelSearch: (args) => ipcRenderer.invoke("la:database-map:cancel-search", args),
  },
  trip: {
    route: (args) => ipcRenderer.invoke("la:trip:route", args),
    tile: (args) => ipcRenderer.invoke("la:trip:tile", args),
    search: (args) => ipcRenderer.invoke("la:trip:search", args),
    transit: (args) => ipcRenderer.invoke("la:trip:transit", args),
    status: () => ipcRenderer.invoke("la:trip:provider-status"),
    offlineStatus: (args) => ipcRenderer.invoke("la:trip:offline-status", args),
    offlineSetup: (args) => ipcRenderer.invoke("la:trip:offline-setup", args),
    offlineDownload: (args) => ipcRenderer.invoke("la:trip:offline-download", args),
    sdkStatus: () => ipcRenderer.invoke("la:trip:amap-sdk-status"),
    sdkConfigure: (args) => ipcRenderer.invoke("la:trip:amap-sdk-configure", args),
    sdkOpen: (args) => ipcRenderer.invoke("la:trip:amap-sdk-open", args),
    cancel: (args) => ipcRenderer.invoke("la:trip:cancel", args),
    map: (args) => ipcRenderer.invoke("la:trip:map", args),
    personalMap: (args) => ipcRenderer.invoke("la:trip:personal-map", args),
    setProvider: (args) => ipcRenderer.invoke("la:trip:set-provider", args),
  },
  market: {
    catalogue: () => ipcRenderer.invoke("la:market:catalogue"),
    previewImage: (args) => ipcRenderer.invoke("la:market:preview-image", args),
    preview: (args) => ipcRenderer.invoke("la:market:preview", args),
    pick: () => ipcRenderer.invoke("la:market:pick"),
    install: (args) => ipcRenderer.invoke("la:market:install", args),
    installed: () => ipcRenderer.invoke("la:market:installed"),
    remove: (args) => ipcRenderer.invoke("la:market:remove", args),
    hostWidget: (args) => ipcRenderer.invoke("la:market:host-widget", args),
    releaseFrame: (args) => ipcRenderer.invoke("la:market:release-frame", args),
    run: (args) => ipcRenderer.invoke("la:market:run", args),
    release: (args) => ipcRenderer.invoke("la:market:release", args),
  },
  assistant: {
    getConfig: () => ipcRenderer.invoke("la:assistant:get-config"),
    configure: (settings) => ipcRenderer.invoke("la:assistant:configure", settings),
    complete: completeAssistant,
    cancel: (request) => ipcRenderer.invoke("la:assistant:cancel", request),
    web: (request) => ipcRenderer.invoke("la:assistant:web", request),
    importWebImage: (request) => ipcRenderer.invoke("la:assistant:import-web-image", request),
    prepareAttachment: (request) => ipcRenderer.invoke("la:assistant:prepare-attachment", request),
    loadAttachment: (request) => ipcRenderer.invoke("la:assistant:load-attachment", request),
    recognizeAttachment: (request) => ipcRenderer.invoke("la:assistant:recognize-attachment", request),
    listConversations: () => ipcRenderer.invoke("la:assistant:list-conversations"),
    getConversation: (request) => ipcRenderer.invoke("la:assistant:get-conversation", request),
    saveConversation: (request) => ipcRenderer.invoke("la:assistant:save-conversation", request),
    selectConversation: (request) => ipcRenderer.invoke("la:assistant:select-conversation", request),
  },
  ocr: {
    getStatus: () => ipcRenderer.invoke("assistant:ocr:status"),
    recognizeFile: (language) => ipcRenderer.invoke("assistant:ocr:file", language),
    recognizeClipboard: (language) => ipcRenderer.invoke("assistant:ocr:clipboard", language),
    recognizeScreen: (language) => ipcRenderer.invoke("assistant:ocr:screen", language),
    copyText: (text) => ipcRenderer.invoke("assistant:ocr:copy", text),
  },
  app: {
    getInfo: () => ipcRenderer.invoke("la:app:get-info"),
    openExternal: (args) => ipcRenderer.invoke("la:app:open-external", args),
    setThemeSource: (args) => ipcRenderer.invoke("la:app:set-theme-source", args),
    setContrastPreference: (args) => ipcRenderer.invoke("la:app:set-contrast-preference", args),
    onFlushRequest: (callback) => subscribe("la:app:flush-request", callback),
    flushDone: () => ipcRenderer.invoke("la:app:flush-done"),
    openDataFolder: () => ipcRenderer.invoke("la:app:open-data-folder"),
    openVaultWindow: (args) => ipcRenderer.invoke("la:app:open-vault-window", args),
    getVaultStatus: () => ipcRenderer.invoke("la:app:get-vault-status"),
    requestVaultPreferences: (input) => ipcRenderer.invoke("la:app:request-vault-preferences", input),
    onVaultStatusChanged: (callback) => subscribe("la:app:vault-status-changed", callback),
    onNavigate: (callback) => subscribe("la:app:navigate", callback),
    onExportDownload: (callback) => subscribe("la:app:export-download", callback),
    notify: (args) => ipcRenderer.invoke("la:app:notify", args),
    onNotificationClick: (callback) => subscribe("la:app:notification-click", callback),
    onQuickCapture: (callback) => subscribe("la:app:quick-capture", callback),
    getQuickCaptureShortcutStatus: () => ipcRenderer.invoke("la:app:get-quick-capture-shortcut-status"),
    changeDataRoot: () => ipcRenderer.invoke("la:app:change-data-root"),
  },
  workspace: {
    load: () => ipcRenderer.invoke("la:workspace:load"),
    applyChanges: (args) => ipcRenderer.invoke("la:workspace:apply-changes", args),
  },
  assets: {
    put: (args) => ipcRenderer.invoke("la:assets:put", args),
    scanUnreferenced: () => ipcRenderer.invoke("la:assets:scan-unreferenced"),
    moveToTrash: (args) => ipcRenderer.invoke("la:assets:move-to-trash", args),
    listTrash: () => ipcRenderer.invoke("la:assets:list-trash"),
    restoreTrash: (args) => ipcRenderer.invoke("la:assets:restore-trash", args),
  },
  backup: {
    getStatus: () => ipcRenderer.invoke("la:backup:get-status"),
    exportFull: (args) => ipcRenderer.invoke("la:backup:export-full", args),
    exportRescue: (workspace) => ipcRenderer.invoke("la:backup:export-rescue", { workspace }),
    onProgress: (callback) => subscribe("la:backup:progress", callback),
    cancel: (args) => ipcRenderer.invoke("la:backup:cancel", args),
    inspect: () => ipcRenderer.invoke("la:backup:inspect"),
    inspectScheduled: () => ipcRenderer.invoke("la:backup:inspect-scheduled"),
    inspectWithPassword: (args) => ipcRenderer.invoke("la:backup:inspect-with-password", args),
    restore: (args) => ipcRenderer.invoke("la:backup:restore", args),
    verify: () => ipcRenderer.invoke("la:backup:verify"),
    verifyWithPassword: (args) => ipcRenderer.invoke("la:backup:verify-with-password", args),
    listSnapshots: () => ipcRenderer.invoke("la:backup:list-snapshots"),
    createSnapshot: () => ipcRenderer.invoke("la:backup:create-snapshot"),
    createWorkspaceSnapshot: () => ipcRenderer.invoke("la:backup:create-workspace-snapshot"),
    restoreSnapshot: (args) => ipcRenderer.invoke("la:backup:restore-snapshot", args),
    getSchedule: () => ipcRenderer.invoke("la:backup:get-schedule"),
    chooseScheduleFolder: () => ipcRenderer.invoke("la:backup:choose-schedule-folder"),
    setSchedule: (args) => ipcRenderer.invoke("la:backup:set-schedule", args),
    runScheduleNow: () => ipcRenderer.invoke("la:backup:run-schedule-now"),
    updateWorkspaceSchedule: (args) => ipcRenderer.invoke("la:backup:update-workspace-schedule", args),
  },
  exports: { writeMarkdownFolder: (args) => ipcRenderer.invoke("la:exports:write-markdown-folder", args) },
});
