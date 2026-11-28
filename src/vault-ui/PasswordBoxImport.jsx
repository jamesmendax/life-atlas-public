import React, { useEffect, useRef, useState } from "react";
import { invokeVault } from "./api.js";
import { PasswordInput } from "./PasswordForm.jsx";
import { useI18n } from "./i18n.js";

export default function PasswordBoxImport({ onClose, onImported }) {
  const { t } = useI18n();
  const title = t("vault.pbox.title");
  const dialog = useRef(null);
  const input = useRef(null);
  const mounted = useRef(false);
  const [hasPassword, setHasPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    mounted.current = true;
    const previous = document.activeElement;
    const field = input.current;
    return () => {
      mounted.current = false;
      field.value = "";
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  useEffect(() => {
    if (busy) dialog.current.focus();
    else input.current.focus();
  }, [busy]);

  async function submit(event) {
    event.preventDefault();
    if (busy || !input.current.value) return;
    setBusy(true);
    setError("");
    setNotice("");
    const pending = invokeVault("importPasswordBoxBackup", { password: input.current.value });
    input.current.value = "";
    setHasPassword(false);
    try {
      const result = await pending;
      if (!mounted.current) return;
      if (result.cancelled) setNotice(t("vault.pbox.cancelled"));
      else onImported(result);
    } catch (failure) {
      if (mounted.current) setError(failure.message);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  function handleKeyDown(event) {
    if (event.key === "Escape" && !busy) {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
    if (event.key !== "Tab") return;
    const controls = [...dialog.current.querySelectorAll("input:not(:disabled), button:not(:disabled)")];
    if (!controls.length) {
      event.preventDefault();
      return;
    }
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return <div className="vault-scrim"><form ref={dialog} className="vault-dialog" role="dialog" aria-modal="true"
    aria-label={title} aria-busy={busy} tabIndex={-1} onKeyDown={handleKeyDown} onSubmit={submit}>
    <h2>{title}</h2>
    <p>{t("vault.pbox.desc")}</p>
    <PasswordInput ref={input} label={t("vault.pbox.passwordLabel")} maxLength={4096} disabled={busy}
      onChange={(value) => setHasPassword(Boolean(value))} />
    {error && <p className="vault-error" role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    <div className="vault-actions">
      <button type="button" className="btn-line" onClick={onClose} disabled={busy}>{t("common.cancel")}</button>
      <button className="primary" disabled={!hasPassword || busy}>{busy ? t("vault.pbox.busy") : t("vault.pbox.submit")}</button>
    </div>
  </form></div>;
}
