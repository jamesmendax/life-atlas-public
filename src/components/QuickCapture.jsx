import { useEffect, useRef, useState } from "react";
import IconInbox from "@tabler/icons-react/dist/esm/icons/IconInbox.mjs";
import { Dialog } from "../ui/Dialog.jsx";
import { useDialogs } from "../ui/DialogProvider.jsx";
import { useI18n } from "../i18n/workspaceRuntime.js";

export function QuickCapture({ onClose, onSave }) {
  const { t } = useI18n();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [shortcutUnavailable, setShortcutUnavailable] = useState(false);
  const [error, setError] = useState("");
  const titleRef = useRef(null);
  const dialogs = useDialogs();
  useEffect(() => {
    let alive = true;
    void window.lifeAtlas?.app?.getQuickCaptureShortcutStatus?.().then((result) => { if (alive && result.ok) setShortcutUnavailable(!result.value.registered); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  const close = async () => {
    if ((title.trim() || body.trim()) && !await dialogs.confirm({ title: t("capture.discardTitle"), description: t("capture.discardDesc"), confirmLabel: t("capture.discardConfirm"), danger: true })) return;
    onClose();
  };
  const save = (open) => { try { onSave({ title, body, open }); } catch (failure) { setError(failure.message); } };
  return <Dialog title={t("quickCapture.title")} ariaLabel={t("quickCapture.title")} onClose={close} initialFocusRef={titleRef} className="capture-dialog">
    <span className="capture-destination">{t("capture.saveTo")}<span><IconInbox size={14} />{t("nav.inbox")}</span></span>
    <form onSubmit={(event) => { event.preventDefault(); save(false); }} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); save(false); } }}>
      <input ref={titleRef} className="capture-title" aria-label={t("capture.titleAria")} placeholder={t("capture.titlePh")} value={title} onChange={(event) => setTitle(event.target.value)} />
      <textarea className="capture-text" aria-label={t("capture.bodyAria")} placeholder={t("capture.bodyPh")} value={body} onChange={(event) => setBody(event.target.value)} />
      {error && <p role="alert" className="mb-danger-text">{error}</p>}
      <footer className="capture-foot"><small>{shortcutUnavailable ? t("capture.shortcutBusy") : t("capture.markdownHint")}</small><button type="button" className="mb-button" onClick={() => save(true)}>{t("capture.saveAndOpen")}</button><button type="submit" className="mb-button mb-primary">{t("common.save")} <span aria-hidden="true"><kbd>Ctrl</kbd> <kbd>Enter</kbd></span></button></footer>
    </form>
  </Dialog>;
}
