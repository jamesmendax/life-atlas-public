import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../i18n/workspaceRuntime.js";
import { Dialog } from "./Dialog.jsx";
import { ConfirmDialog } from "./ConfirmDialog.jsx";

const DialogContext = createContext(null);

function TextDialog({ title, description, label = title, initialValue = "", inputType = "text", confirmLabel, validate, onClose, onConfirm }) {
  const { t } = useI18n();
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState("");
  const inputRef = useRef(null);
  return <Dialog title={title} description={description} onClose={onClose} initialFocusRef={inputRef} className="mb-text-dialog" dialogKind="prompt">
    <form onSubmit={(event) => {
      event.preventDefault();
      const issue = validate?.(value);
      setError(issue || "");
      if (!issue) onConfirm(value);
    }}><div className="mb-dialog-body"><label className="mb-field-group">{label}<input ref={inputRef} type={inputType} value={value} aria-invalid={Boolean(error)} onChange={(event) => { setValue(event.target.value); setError(validate?.(event.target.value) || ""); }} /></label>{error && <p role="alert" className="mb-danger-text">{error}</p>}</div><footer className="mb-dialog-footer"><button type="button" data-la-dialog-cancel className="mb-button" onClick={onClose}>{t("common.cancel")}</button><button type="submit" data-la-dialog-confirm className="mb-button mb-primary" disabled={Boolean(error)}>{confirmLabel || t("common.save")}</button></footer></form>
  </Dialog>;
}

export function DialogProvider({ children }) {
  const { t } = useI18n();
  const [queue, setQueue] = useState([]);
  const queueRef = useRef(queue);
  const sequence = useRef(0);
  queueRef.current = queue;
  const request = useCallback((kind, options) => new Promise((resolve) => {
    sequence.current += 1;
    setQueue((current) => [...current, { ...options, kind, id: sequence.current, resolve }]);
  }), []);
  const api = useMemo(() => ({
    confirm: (options) => request("confirm", options),
    promptText: (options) => request("text", options),
    alert: (options) => request("alert", options),
  }), [request]);
  useEffect(() => () => { queueRef.current.forEach((entry) => entry.resolve(entry.kind === "confirm" ? false : null)); }, []);
  const active = queue[0];
  const finish = (value) => {
    if (!active) return;
    setQueue((current) => current.filter((entry) => entry.id !== active.id));
    active.resolve(value);
  };
  return <DialogContext.Provider value={api}>{children}
    {active?.kind === "confirm" && <ConfirmDialog key={active.id} {...active} onConfirm={() => finish(true)} onClose={() => finish(false)} />}
    {active?.kind === "text" && <TextDialog key={active.id} {...active} onConfirm={finish} onClose={() => finish(null)} />}
    {active?.kind === "alert" && <Dialog key={active.id} title={active.title} description={active.description} onClose={() => finish(null)} className="mb-confirm-dialog" role="alertdialog" dialogKind="alert"><footer className="mb-dialog-footer"><button type="button" data-la-dialog-confirm className="mb-button mb-primary" onClick={() => finish(null)}>{t("common.okGotIt")}</button></footer></Dialog>}
  </DialogContext.Provider>;
}

export function useDialogs() {
  const dialogs = useContext(DialogContext);
  if (!dialogs) throw new Error("DialogProvider is required for workspace dialogs");
  return dialogs;
}
