import { useSyncExternalStore } from "react";

function subscribe(callback) {
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}

const getSnapshot = () => document.documentElement.dataset.theme === "dark" ? "dark" : "light";

export function useResolvedTheme() {
  return useSyncExternalStore(subscribe, getSnapshot, () => "light");
}
