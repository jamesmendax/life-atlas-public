export const DEVICE_PREFERENCES_KEY = "life-atlas.device-preferences";
export const SIDEBAR_SECTIONS = ["private", "favorites", "recents"];
export const DATABASE_VIEW_TAB_DISPLAYS = ["icon-text", "text", "icon"];
export const CONTRAST_PREFERENCES = ["system", "standard", "high"];

const listeners = new Set();
let fallback;

function getStorage() {
  try { return globalThis.localStorage; } catch { return undefined; }
}

function normalizeTabSession(session) {
  const ids = [...new Set((Array.isArray(session?.ids) ? session.ids : []).filter((id) => typeof id === "string" && id))];
  return { ids, activeId: ids.includes(session?.activeId) ? session.activeId : null };
}

function normalizeDevicePreferences(value) {
  return {
    databaseViewTabDisplay: DATABASE_VIEW_TAB_DISPLAYS.includes(value?.databaseViewTabDisplay) ? value.databaseViewTabDisplay : "icon-text",
    contrast: CONTRAST_PREFERENCES.includes(value?.contrast) ? value.contrast : "system",
    reopenPageTabs: value?.reopenPageTabs === true,
    sidebarSections: Object.fromEntries(SIDEBAR_SECTIONS.map((section) => [section, value?.sidebarSections?.[section] !== false])),
    pageTabs: Object.fromEntries(Object.entries(value?.pageTabs ?? {}).map(([workspaceId, session]) => [workspaceId, normalizeTabSession(session)])),
  };
}

export function readDevicePreferences(storage) {
  if (storage === undefined && fallback) return fallback;
  try {
    return normalizeDevicePreferences(JSON.parse((storage ?? getStorage())?.getItem(DEVICE_PREFERENCES_KEY) ?? "{}"));
  } catch {
    return normalizeDevicePreferences();
  }
}

export function updateDevicePreferences(patch, storage) {
  const current = readDevicePreferences(storage);
  const next = normalizeDevicePreferences({
    ...current,
    ...patch,
    sidebarSections: { ...current.sidebarSections, ...patch.sidebarSections },
    pageTabs: { ...current.pageTabs, ...patch.pageTabs },
  });
  try {
    const target = storage ?? getStorage();
    target?.setItem(DEVICE_PREFERENCES_KEY, JSON.stringify(next));
    if (storage === undefined) fallback = target ? undefined : next;
  } catch {
    if (storage === undefined) fallback = next;
  }
  if (storage === undefined) listeners.forEach((listener) => listener(next));
  return next;
}

function notifyStorage(event) {
  if (event.key !== null && event.key !== DEVICE_PREFERENCES_KEY) return;
  if (event.storageArea && event.storageArea !== getStorage()) return;
  fallback = undefined;
  const preferences = readDevicePreferences();
  listeners.forEach((listener) => listener(preferences));
}

export function subscribeDevicePreferences(listener) {
  if (!listeners.size) globalThis.addEventListener?.("storage", notifyStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) globalThis.removeEventListener?.("storage", notifyStorage);
  };
}
