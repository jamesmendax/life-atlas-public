import { useCallback, useMemo, useSyncExternalStore } from "react";

const changed = "life-atlas-dashboard-personal-filters";
const fallback = new Map();

export function useDashboardFilters(workspaceId, personId, viewId, defaults) {
  const key = "life-atlas.dashboard-filters." + JSON.stringify([workspaceId, personId, viewId]);
  const subscribe = useCallback(notify => {
    const onChange = event => {
      if (event.key === key || event.key === null || event.detail === key) notify();
    };
    window.addEventListener("storage", onChange);
    window.addEventListener(changed, onChange);
    return () => {
      window.removeEventListener("storage", onChange);
      window.removeEventListener(changed, onChange);
    };
  }, [key]);
  const read = useCallback(() => {
    if (fallback.has(key)) return fallback.get(key);
    try { return window.localStorage.getItem(key); } catch { return null; }
  }, [key]);
  const stored = useSyncExternalStore(subscribe, read, () => null);
  const personal = useMemo(() => {
    if (stored === null) return null;
    try {
      const rules = JSON.parse(stored);
      return Array.isArray(rules) && rules.every(rule => rule && typeof rule.propertyId === "string" && typeof rule.operator === "string") ? rules : null;
    } catch { return null; }
  }, [stored]);
  const set = rules => {
    const value = rules === null ? null : JSON.stringify(rules);
    try {
      if (value === null) window.localStorage.removeItem(key);
      else window.localStorage.setItem(key, value);
      fallback.delete(key);
    } catch { fallback.set(key, value); }
    window.dispatchEvent(new CustomEvent(changed, { detail: key }));
  };
  return { rules: personal ?? defaults, isPersonal: personal !== null, set };
}
