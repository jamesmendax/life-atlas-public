import React, { useEffect, useRef } from "react";
import { useI18n } from "./i18n.js";

export default function ConfirmationDialog({ title, description, danger = false, busy = false, cancelLabel, confirmLabel, onConfirm, onCancel }) {
  const { t } = useI18n();
  const dialog = useRef(null);
  const cancel = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    cancel.current?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);

  return <div className="vault-scrim"><section ref={dialog} className="vault-dialog" role="dialog" aria-modal="true" aria-label={title} aria-busy={busy} data-la-dialog="confirm" tabIndex={-1} onKeyDown={(event) => {
    if (event.key === "Escape" && !busy) { event.preventDefault(); event.stopPropagation(); onCancel(); }
    if (event.key !== "Tab") return;
    const buttons = [...dialog.current.querySelectorAll("button:not(:disabled)")];
    if (!buttons.length) { event.preventDefault(); dialog.current.focus(); return; }
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }}><h2>{title}</h2><p>{description}</p><div className="vault-actions"><button ref={cancel} type="button" className="btn-line" data-la-dialog-cancel disabled={busy} onClick={onCancel}>{cancelLabel ?? t("common.cancel")}</button><button type="button" className={danger ? "danger" : "primary"} data-la-dialog-confirm disabled={busy} onClick={onConfirm}>{busy ? t("common.processing") : (confirmLabel ?? t("common.confirm"))}</button></div></section></div>;
}
