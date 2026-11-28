import { useEffect, useRef } from "react";

export function useDatabasePointerCommit(viewId) {
  const active = useRef(null);
  useEffect(() => () => active.current?.(), [viewId]);
  return (event, commit) => {
    if (event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    event.stopPropagation();
    active.current?.();
    const id = event.pointerId;
    const cancel = () => {
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", abort);
      window.removeEventListener("blur", cancel);
      active.current = null;
    };
    const abort = e => { if (e.pointerId === id) cancel(); };
    const release = e => {
      if (e.pointerId !== id) return;
      cancel();
      commit(e);
    };
    active.current = cancel;
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", abort);
    window.addEventListener("blur", cancel);
  };
}
