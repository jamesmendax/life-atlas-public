import { useRef } from "react";
import { useI18n } from "../i18n/workspaceRuntime.js";
import { Dialog } from "./Dialog.jsx";

export function ConfirmDialog({ title, description, confirmLabel, danger = false, onConfirm, onClose }) {
  const { t } = useI18n();
  const cancelRef = useRef(null);
  const confirmRef = useRef(null);
  return <Dialog title={title} description={description} onClose={onClose} initialFocusRef={danger ? cancelRef : confirmRef} className="mb-confirm-dialog" role="alertdialog" dialogKind="confirm">
    <footer className="mb-dialog-footer"><button ref={cancelRef} type="button" data-la-dialog-cancel className="mb-button" onClick={onClose}>{t("common.cancel")}</button><button ref={confirmRef} type="button" data-la-dialog-confirm className={`mb-button ${danger ? "mb-danger-button is-danger" : "mb-primary"}`} onClick={onConfirm}>{confirmLabel || t("common.confirm")}</button></footer>
  </Dialog>;
}
