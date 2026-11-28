import React, { useEffect, useRef, useState } from "react";
import IconArrowDown from "@tabler/icons-react/dist/esm/icons/IconArrowDown.mjs";
import IconArrowUp from "@tabler/icons-react/dist/esm/icons/IconArrowUp.mjs";
import IconEye from "@tabler/icons-react/dist/esm/icons/IconEye.mjs";
import IconPlus from "@tabler/icons-react/dist/esm/icons/IconPlus.mjs";
import IconTrash from "@tabler/icons-react/dist/esm/icons/IconTrash.mjs";
import IconX from "@tabler/icons-react/dist/esm/icons/IconX.mjs";
import { invokeVault } from "./api.js";
import { FIELD_KINDS, ITEM_TYPES, fieldKindLabel, itemTypeLabel, newItemFields } from "./itemTypes.js";
import Generator from "./Generator.jsx";
import VaultNoteEditor from "./VaultNoteEditor.jsx";
import ConfirmationDialog from "./ConfirmationDialog.jsx";
import { useI18n } from "./i18n.js";

const CREDENTIAL_TYPE_KEYS = Object.keys(ITEM_TYPES).filter((key) => key !== "secureNote");
const RICH_NOTE_LABELS = new Set(["备注", "内容", "メモ", "本文", "Notes", "Content"]);

export default function CredentialFormModal({
  item,
  credential = null,
  initialType = "login",
  renderAttachmentDownload,
  onSaved,
  onCancel,
  onError,
}) {
  const { t } = useI18n();
  const isEditing = Boolean(credential);
  const ownedFields = isEditing
    ? credential.fieldIds
      .map((fieldId) => item.fields.find((field) => field.id === fieldId))
      .filter(Boolean)
      .map((field) => ({ ...field, editorId: field.id, value: field.value ?? "", modified: !field.sensitive }))
    : newItemFields(initialType, t);

  const [type, setType] = useState(credential?.type || initialType);
  const [label, setLabel] = useState(credential?.label || "");
  const [expiresAt, setExpiresAt] = useState(credential?.expiresAt?.slice(0, 10) || "");
  const [fields, setFields] = useState(ownedFields);
  const [busy, setBusy] = useState(false);
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [pickedAttachments, setPickedAttachments] = useState([]);
  const [removedAttachmentIds, setRemovedAttachmentIds] = useState([]);
  const [generatorTarget, setGeneratorTarget] = useState(null);
  const [hideEpoch, setHideEpoch] = useState(0);
  const [windowBlurred, setWindowBlurred] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [localError, setLocalError] = useState("");

  const temporary = useRef(new Map());
  const timerIds = useRef(new Map());
  const nextId = useRef(500);
  const mounted = useRef(false);
  const revealGeneration = useRef(0);
  const attachmentDraftId = useRef(null);
  const initialFields = useRef(fields);
  const dialogRef = useRef(null);

  const dirty = type !== (credential?.type || initialType)
    || label !== (credential?.label || "")
    || expiresAt !== (credential?.expiresAt?.slice(0, 10) || "")
    || pickedAttachments.length > 0
    || removedAttachmentIds.length > 0
    || fields.length !== initialFields.current.length
    || fields.some((field, index) => {
      const before = initialFields.current[index];
      return field.editorId !== before.editorId || field.label !== before.label || field.kind !== before.kind
        || field.sensitive !== before.sensitive || field.modified !== before.modified || field.value !== before.value;
    });

  const savedAttachments = item?.attachments ?? [];
  const savedAttachmentIds = new Set(savedAttachments.map((file) => file.id));
  const visibleAttachments = [...savedAttachments.filter((file) => !removedAttachmentIds.includes(file.id)), ...pickedAttachments];

  function downloadButton(file) {
    if (!file) return null;
    const source = savedAttachmentIds.has(file.id) ? { id: item.id } : { draftId: attachmentDraftId.current };
    return renderAttachmentDownload(file, source, busy || attachmentBusy);
  }

  useEffect(() => {
    mounted.current = true;
    const previous = document.activeElement;
    const hide = () => {
      revealGeneration.current += 1;
      temporary.current.clear();
      for (const timer of timerIds.current.values()) clearTimeout(timer);
      timerIds.current.clear();
      setWindowBlurred(true);
      setHideEpoch((value) => value + 1);
      setGeneratorTarget(null);
    };
    const show = () => setWindowBlurred(false);
    window.addEventListener("blur", hide);
    window.addEventListener("focus", show);
    return () => {
      mounted.current = false;
      hide();
      window.removeEventListener("blur", hide);
      window.removeEventListener("focus", show);
      if (attachmentDraftId.current) invokeVault("discardAttachmentDraft", { draftId: attachmentDraftId.current }).catch(() => {});
      attachmentDraftId.current = null;
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  const patchField = (editorId, patch) => setFields((values) => values.map((field) => field.editorId === editorId ? { ...field, ...patch } : field));
  const move = (index, direction) => setFields((previous) => {
    const target = index + direction;
    if (target < 0 || target >= previous.length) return previous;
    const next = [...previous];
    [next[index], next[target]] = [next[target], next[index]];
    return next;
  });

  function requestClose() {
    if (busy || attachmentBusy) return;
    if (dirty) setConfirmDiscard(true);
    else onCancel();
  }

  async function reveal(field) {
    const expected = revealGeneration.current;
    try {
      const { value } = await invokeVault("revealField", { id: item.id, fieldId: field.id });
      if (!mounted.current || revealGeneration.current !== expected) return;
      temporary.current.set(field.editorId, value);
      setHideEpoch((previous) => previous + 1);
      clearTimeout(timerIds.current.get(field.editorId));
      timerIds.current.set(field.editorId, setTimeout(() => {
        temporary.current.delete(field.editorId);
        timerIds.current.delete(field.editorId);
        setHideEpoch((previous) => previous + 1);
      }, 20000));
    } catch (error) {
      if (mounted.current) setLocalError(error.message);
    }
  }

  async function addAttachments({ filter } = {}) {
    if (attachmentBusy || busy) return [];
    setAttachmentBusy(true);
    try {
      const previousIds = new Set(pickedAttachments.map((file) => file.id));
      const args = {
        ...(attachmentDraftId.current ? { draftId: attachmentDraftId.current } : {}),
        ...(filter ? { filter } : {}),
      };
      const result = await invokeVault("pickAttachments", Object.keys(args).length ? args : undefined);
      if (result.cancelled) return [];
      if (!mounted.current) {
        invokeVault("discardAttachmentDraft", { draftId: result.draftId }).catch(() => {});
        return [];
      }
      attachmentDraftId.current = result.draftId;
      setPickedAttachments(result.attachments);
      return result.attachments.filter((file) => !previousIds.has(file.id));
    } catch (error) {
      if (mounted.current) setLocalError(error.message);
      return [];
    } finally {
      if (mounted.current) setAttachmentBusy(false);
    }
  }

  async function removeAttachment(file) {
    if (attachmentBusy || busy) return;
    if (savedAttachments.some((attachment) => attachment.id === file.id)) {
      setRemovedAttachmentIds((ids) => [...ids, file.id]);
      return;
    }
    setAttachmentBusy(true);
    try {
      const result = await invokeVault("discardAttachmentDraft", { draftId: attachmentDraftId.current, attachmentId: file.id });
      if (mounted.current) setPickedAttachments(result.attachments);
    } catch (error) {
      if (mounted.current) setLocalError(error.message);
    } finally {
      if (mounted.current) setAttachmentBusy(false);
    }
  }

  async function save(event) {
    event.preventDefault();
    if (busy || attachmentBusy || !label.trim()) return;
    setBusy(true);
    setLocalError("");
    try {
      if (isEditing) {
        const patch = {
          label: label.trim(),
          type,
          expiresAt: expiresAt || null,
          ...(attachmentDraftId.current ? { attachmentDraftId: attachmentDraftId.current } : {}),
          ...(removedAttachmentIds.length ? { removeAttachmentIds: removedAttachmentIds } : {}),
          fields: fields.map((field) => ({
            ...(field.id ? { id: field.id } : {}),
            label: field.label,
            kind: field.kind,
            sensitive: ["secret", "totp"].includes(field.kind) || field.sensitive,
            ...(field.id && !field.modified ? { keepValue: true } : { value: field.value }),
          })),
        };
        await invokeVault("updateCredential", { id: item.id, credentialId: credential.id, patch });
        attachmentDraftId.current = null;
        if (mounted.current) await onSaved(credential.id);
      } else {
        const payload = {
          label: label.trim(),
          type,
          expiresAt: expiresAt || null,
          ...(attachmentDraftId.current ? { attachmentDraftId: attachmentDraftId.current } : {}),
          fields: fields.map((field) => ({
            label: field.label,
            kind: field.kind,
            sensitive: ["secret", "totp"].includes(field.kind) || field.sensitive,
            value: field.value,
          })),
        };
        const result = await invokeVault("addCredential", { id: item.id, credential: payload });
        attachmentDraftId.current = null;
        if (mounted.current) await onSaved(result.credentialId);
      }
    } catch (error) {
      if (mounted.current) {
        setLocalError(error.message);
        onError?.(error);
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  function handleKeyDown(event) {
    if (event.key === "Escape" && !confirmDiscard) {
      event.preventDefault();
      event.stopPropagation();
      requestClose();
    }
  }

  const title = isEditing ? `${t("vault.cred.titleEdit")} · ${credential.label}` : t("vault.cred.titleAdd", { title: item.title });

  return (
    <div className="vault-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) requestClose(); }}>
      <form
        ref={dialogRef}
        className="vault-dialog vault-dialog-wide"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onKeyDown={handleKeyDown}
        onSubmit={save}
      >
        <div className="dialog-head">
          <h2>{title}</h2>
          <button type="button" className="n-icon" aria-label={t("common.close")} disabled={busy} onClick={requestClose}>
            <IconX size={16} />
          </button>
        </div>

        <div className="dialog-scroll">
          <div className="cred-meta-grid">
            <label className="editor-label">
              {t("vault.cred.label")}
              <input
                aria-label={t("vault.cred.label")}
                value={label}
                maxLength={200}
                placeholder={t("vault.cred.labelPlaceholder")}
                onChange={(event) => setLabel(event.target.value)}
                required
                autoFocus
              />
            </label>
            <label className="editor-label">
              {t("vault.editor.type")}
              <select
                aria-label={t("vault.editor.typeAria")}
                value={type}
                onChange={(event) => {
                  const nextType = event.target.value;
                  setType(nextType);
                  if (!isEditing) {
                    setFields(newItemFields(nextType, t));
                    setGeneratorTarget(null);
                  }
                }}
              >
                {CREDENTIAL_TYPE_KEYS.map((value) => <option key={value} value={value}>{itemTypeLabel(value, t)}</option>)}
              </select>
            </label>
            <label className="editor-label">
              {t("vault.editor.expiry")}
              <input aria-label={t("vault.editor.expiryAria")} type="date" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} />
            </label>
          </div>

          <div className="editor-fields">
            {fields.map((field, index) => {
              const isRichNote = field.kind === "multiline" && (!field.sensitive || RICH_NOTE_LABELS.has(field.label));
              const maskedByBlur = Boolean(windowBlurred && field.sensitive);
              const maskedUnrevealed = maskedByBlur || Boolean(field.id && field.sensitive && !field.modified && !temporary.current.has(field.editorId));
              const fieldValue = maskedByBlur ? "" : (field.modified ? field.value : temporary.current.get(field.editorId) || "");
              return (
                <section key={field.editorId} className={`editor-field ${field.kind === "multiline" ? "is-note" : ""}`}>
                  <div className="editor-field-head">
                    <input
                      aria-label={t("vault.editor.fieldLabelAria", { index: index + 1 })}
                      value={field.label}
                      maxLength={100}
                      onChange={(event) => patchField(field.editorId, { label: event.target.value })}
                      required
                    />
                    <select
                      aria-label={t("vault.editor.fieldKindAria", { index: index + 1 })}
                      value={field.kind}
                      onChange={(event) => patchField(field.editorId, { kind: event.target.value, sensitive: ["secret", "totp"].includes(event.target.value) || field.sensitive })}
                    >
                      {Object.keys(FIELD_KINDS).map((value) => <option key={value} value={value}>{fieldKindLabel(value, t)}</option>)}
                    </select>
                    <button type="button" className="mini" aria-label={t("vault.editor.fieldMoveUp", { index: index + 1 })} disabled={index === 0} onClick={() => move(index, -1)}><IconArrowUp size={15} /></button>
                    <button type="button" className="mini" aria-label={t("vault.editor.fieldMoveDown", { index: index + 1 })} disabled={index === fields.length - 1} onClick={() => move(index, 1)}><IconArrowDown size={15} /></button>
                    <button type="button" className="mini" aria-label={t("vault.editor.fieldDelete", { index: index + 1 })} onClick={() => setFields((values) => values.filter((entry) => entry.editorId !== field.editorId))}><IconTrash size={15} /></button>
                  </div>
                  <div className="editor-field-input">
                    {isRichNote && !maskedUnrevealed ? (
                      <VaultNoteEditor
                        value={fieldValue}
                        ariaLabel={field.label || t("vault.editor.fieldValueAria", { index: index + 1 })}
                        disabled={busy || attachmentBusy}
                        canAttach={!item?.deletedAt}
                        attachments={visibleAttachments}
                        savedAttachmentIds={savedAttachmentIds}
                        itemId={item?.id ?? null}
                        draftId={attachmentDraftId.current}
                        revealEpoch={hideEpoch}
                        onChange={(nextValue) => {
                          temporary.current.delete(field.editorId);
                          patchField(field.editorId, { value: nextValue, modified: true });
                        }}
                        onPickFiles={addAttachments}
                        onRemoveAttachment={removeAttachment}
                        renderDownload={downloadButton}
                      />
                    ) : (
                      <textarea
                        aria-label={field.label || t("vault.editor.fieldValueAria", { index: index + 1 })}
                        rows={field.kind === "multiline" ? 3 : 1}
                        value={fieldValue}
                        readOnly={maskedByBlur}
                        data-reveal-epoch={hideEpoch}
                        placeholder={maskedByBlur ? t("vault.editor.maskedBlur") : (field.id && field.sensitive && !field.modified ? t("vault.editor.maskedKeep") : "")}
                        onChange={(event) => {
                          if (maskedByBlur) return;
                          temporary.current.delete(field.editorId);
                          patchField(field.editorId, { value: event.target.value, modified: true });
                        }}
                      />
                    )}
                    {field.id && field.sensitive && !field.modified && (
                      <button type="button" className="btn-line btn-sm" onClick={() => reveal(field)}>
                        <IconEye size={14} />{t("vault.details.show")}
                      </button>
                    )}
                  </div>
                  <div className="editor-field-options">
                    <label>
                      <input
                        type="checkbox"
                        checked={field.sensitive}
                        disabled={["secret", "totp"].includes(field.kind)}
                        onChange={(event) => patchField(field.editorId, { sensitive: event.target.checked })}
                      />
                      {t("vault.editor.sensitiveField")}
                    </label>
                    {field.sensitive && (
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => setGeneratorTarget(generatorTarget === field.editorId ? null : field.editorId)}
                      >
                        {t("vault.editor.generate")}
                      </button>
                    )}
                  </div>
                  {generatorTarget === field.editorId && (
                    <Generator
                      key={field.editorId}
                      onError={(err) => setLocalError(err.message)}
                      onUse={(value) => {
                        patchField(field.editorId, { value, modified: true });
                        setGeneratorTarget(null);
                      }}
                    />
                  )}
                </section>
              );
            })}
          </div>

          <button
            type="button"
            className="btn-line btn-sm"
            disabled={fields.length >= 60}
            onClick={() => setFields((values) => [...values, { editorId: `new-${nextId.current++}`, label: "", kind: "text", sensitive: false, value: "", modified: true }])}
          >
            <IconPlus size={14} />{t("vault.editor.addField")}
          </button>

          {localError && <p className="vault-error" role="alert">{localError}</p>}
        </div>

        <div className="vault-actions dialog-foot">
          <button type="button" className="btn-line" disabled={busy || attachmentBusy} onClick={requestClose}>{t("common.cancel")}</button>
          <button className="primary" disabled={!label.trim() || busy || attachmentBusy}>
            {busy ? t("vault.editor.saving") : t("vault.cred.saveCred")}
          </button>
        </div>
      </form>

      {confirmDiscard && (
        <ConfirmationDialog
          title={t("vault.cred.discardTitle")}
          description={t("vault.cred.discardDesc")}
          danger
          cancelLabel={t("vault.cred.continueEdit")}
          confirmLabel={t("vault.cred.discard")}
          onCancel={() => setConfirmDiscard(false)}
          onConfirm={() => { setConfirmDiscard(false); onCancel(); }}
        />
      )}
    </div>
  );
}
