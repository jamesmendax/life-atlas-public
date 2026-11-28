import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

export function WorkspaceNavigationMenu({ id, label, anchor, onDismiss, focusIndex = null, children }) {
  const menu = useRef(null);
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    const outside = (event) => {
      if (!menu.current?.contains(event.target) && !anchor.contains(event.target)) dismissRef.current();
    };
    const escape = (event) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        dismissRef.current(menu.current?.contains(document.activeElement));
      }
    };
    const resize = () => dismissRef.current();
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    document.addEventListener("keydown", escape);
    window.addEventListener("resize", resize);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("resize", resize);
    };
  }, [anchor]);

  useEffect(() => {
    if (focusIndex === null) return;
    const items = menu.current?.querySelectorAll("[role='menuitem']:enabled");
    items?.[focusIndex < 0 ? items.length - 1 : focusIndex]?.focus();
  }, [focusIndex]);

  const rect = anchor.getBoundingClientRect();
  const width = Math.min(288, window.innerWidth - 16);
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
  return createPortal(<div
    id={id}
    ref={menu}
    role="menu"
    aria-label={label}
    className="workspace-navigation-menu ui-popover ui-menu"
    style={{ left, top: rect.bottom, width, maxHeight: Math.min(360, window.innerHeight - rect.bottom - 8) }}
    onKeyDown={(event) => {
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const items = [...menu.current.querySelectorAll("[role='menuitem']:enabled")];
      if (!items.length) return;
      const index = items.indexOf(document.activeElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
        : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      items[next].focus();
    }}
  >{children}</div>, document.body);
}
