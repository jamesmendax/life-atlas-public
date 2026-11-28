import { useId, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import IconX from "@tabler/icons-react/dist/esm/icons/IconX.mjs";
import { isComposingKeyboardEvent } from "./keyboard.js";
import { useI18n } from "../i18n/workspaceRuntime.js";

const focusableSelector = 'button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
const dialogStack = [];
let originalOverflow;

export function hasOpenModal() {
  return dialogStack.length > 0 || Boolean(document.querySelector('[aria-modal="true"]'));
}

export function useModalFocus(container, { initialFocusRef, restoreFocusRef, onClose, busy = false } = {}) {
  const closeRef = useRef(onClose);
  const busyRef = useRef(busy);
  closeRef.current = onClose;
  busyRef.current = busy;
  useLayoutEffect(() => {
    const element = container.current;
    if (!element) return;
    const previous = document.activeElement;
    const returnTarget = restoreFocusRef?.current || previous;
    if (!dialogStack.length) originalOverflow = document.body.style.overflow;
    dialogStack.push(element);
    document.body.style.overflow = "hidden";
    const tabbable = () => [...element.querySelectorAll(focusableSelector)].filter((item) =>
      item.tabIndex >= 0 && !item.matches(":disabled") && !item.closest("[inert]") && item.getClientRects().length && getComputedStyle(item).visibility === "visible");
    const firstTarget = initialFocusRef?.current || tabbable()[0] || element;
    firstTarget.focus({ preventScroll: true });
    const keyboard = (event) => {
      if (dialogStack.at(-1) !== element || event.defaultPrevented || isComposingKeyboardEvent(event)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (!busyRef.current) closeRef.current?.();
        return;
      }
      if (event.key !== "Tab") return;
      const items = tabbable();
      const focus = document.activeElement;
      if (!items.length || !element.contains(focus) || focus === element ||
        (event.shiftKey ? focus === items[0] : focus === items.at(-1))) {
        event.preventDefault();
        (event.shiftKey ? items.at(-1) || element : items[0] || element).focus();
      }
    };
    document.addEventListener("keydown", keyboard);
    return () => {
      const wasTop = dialogStack.at(-1) === element;
      const position = dialogStack.indexOf(element);
      if (position >= 0) dialogStack.splice(position, 1);
      if (!dialogStack.length) document.body.style.overflow = originalOverflow;
      document.removeEventListener("keydown", keyboard);
      if (wasTop && returnTarget?.isConnected) returnTarget.focus({ preventScroll: true });
    };
  }, [container, initialFocusRef, restoreFocusRef]);
}

export function Dialog({ title, description, children, onClose, initialFocusRef, restoreFocusRef, className = "", busy = false, role = "dialog", dialogKind, closeLabel, ariaLabel }) {
  const { t } = useI18n();
  const resolvedCloseLabel = closeLabel || t("common.close");
  const titleId = useId();
  const descriptionId = useId();
  const container = useRef(null);
  useModalFocus(container, { initialFocusRef, restoreFocusRef, onClose, busy });
  return createPortal(
    <div className="mb-dialog-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget && !busy) onClose?.(); }}>
      <section ref={container} className={`mb-dialog ${className}`} role={role} data-la-dialog={dialogKind} aria-modal="true" aria-label={ariaLabel} aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined} aria-busy={busy} tabIndex={-1}>
        <header className="mb-dialog-header"><div><h2 id={titleId}>{title}</h2>{description && <p id={descriptionId}>{description}</p>}</div><button type="button" className="ui-icon-button" aria-label={resolvedCloseLabel} onClick={onClose} disabled={busy}><IconX size={18} /></button></header>
        {children}
      </section>
    </div>, document.body,
  );
}
