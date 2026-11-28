import { useEffect, useState } from "react";

function localMidnight() {
  const date = new Date();
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function useFilterDay(enabled) {
  const [day, setDay] = useState(localMidnight);
  useEffect(() => {
    if (!enabled) return;
    let timer;
    function refresh() {
      clearTimeout(timer);
      const midnight = localMidnight();
      const next = new Date(midnight);
      next.setDate(next.getDate() + 1);
      setDay(midnight);
      timer = setTimeout(refresh, Math.max(1, next.getTime() - Date.now()));
    }
    refresh();
    document.addEventListener("visibilitychange", refresh);
    return () => { clearTimeout(timer); document.removeEventListener("visibilitychange", refresh); };
  }, [enabled]);
  return day;
}
