import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import IconArrowDown from "@tabler/icons-react/dist/esm/icons/IconArrowDown.mjs";
import IconArrowUp from "@tabler/icons-react/dist/esm/icons/IconArrowUp.mjs";
import IconEye from "@tabler/icons-react/dist/esm/icons/IconEye.mjs";
import IconPlus from "@tabler/icons-react/dist/esm/icons/IconPlus.mjs";
import IconTrash from "@tabler/icons-react/dist/esm/icons/IconTrash.mjs";
import { invokeVault } from "./api.js";
import { FIELD_KINDS, ITEM_TYPES, fieldKindLabel, itemTypeLabel, newItemFields } from "./itemTypes.js";
import Generator from "./Generator.jsx";
import NoteAttachments from "./NoteAttachments.jsx";
import VaultNoteEditor from "./VaultNoteEditor.jsx";
import { buildSiteObject } from "./siteHelper.js";
import { collectFieldAttachmentIds } from "./vaultNoteModel.js";
import { useI18n } from "./i18n.js";

const RICH_NOTE_LABELS = new Set(["备注", "内容", "メモ", "本文", "Notes", "Content"]);
const SUBTITLE_LABELS = new Set(["用户名", "Key 名称", "服务", "主机", "ユーザー名", "Key 名", "サービス", "ホスト", "Username", "Key Name", "Service", "Host"]);

export default function ItemEditor({ item, onSaved, onCancel, onError, renderAttachmentDownload, navigationState }) {
  const { t } = useI18n();
  const isMultiSite = Boolean(item?.credentials?.length);
  const ownedIds = new Set((item?.credentials ?? []).flatMap((credential) => credential.fieldIds));
  const editableSourceFields = item
    ? (isMultiSite ? item.fields.filter((field) => !ownedIds.has(field.id)) : item.fields)
    : null;

  const [type, setType] = useState(item?.type || "login");
  const [title, setTitle] = useState(item?.title || "");
  const [siteUrl, setSiteUrl] = useState(item?.site?.url || "");
  const [tags, setTags] = useState(item?.tags.join(", ") || "");
  const [favorite, setFavorite] = useState(item?.favorite || false);
  const [expiresAt, setExpiresAt] = useState(item?.expiresAt?.slice(0, 10) || "");
  const [fields, setFields] = useState(
    editableSourceFields
      ? editableSourceFields.map((field) => ({ ...field, editorId: field.id, value: field.value ?? "", modified: !field.sensitive }))
      : newItemFields("login", t),
  );
  const [busy, setBusy] = useState(false);
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [pickedAttachments, setPickedAttachments] = useState([]);
  const [removedAttachmentIds, setRemovedAttachmentIds] = useState([]);
  const [generatorTarget, setGeneratorTarget] = useState(null);
  const [hideEpoch, setHideEpoch] = useState(0);
  const [windowBlurred, setWindowBlurred] = useState(false);
  const temporary = useRef(new Map());
  const timerIds = useRef(new Map());
  const nextId = useRef(100);
  const mounted = useRef(false);
  const revealGeneration = useRef(0);
  const attachmentDraftId = useRef(null);
  const initialFields = useRef(fields);

  const dirty = type !== (item?.type || "login")
    || title !== (item?.title || "")
    || siteUrl !== (item?.site?.url || "")
    || tags !== (item?.tags.join(", ") || "")
    || favorite !== Boolean(item?.favorite)
    || expiresAt !== (item?.expiresAt?.slice(0, 10) || "")
    || pickedAttachments.length > 0
    || removedAttachmentIds.length > 0
    || fields.length !== initialFields.current.length
    || fields.some((field, index) => {
      const before = initialFields.current[index];
      return field.editorId !== before.editorId || field.label !== before.label || field.kind !== before.kind
        || field.sensitive !== before.sensitive || field.modified !== before.modified || field.value !== before.value;
    });

  useLayoutEffect(() => {
    if (!navigationState) return;
    navigationState.current = { dirty, busy: busy || attachmentBusy };
    return () => { navigationState.current = null; };
  }, [navigationState, dirty, busy, attachmentBusy]);

  const savedAttachments = item?.attachments ?? [];
  const savedAttachmentIds = new Set(savedAttachments.map((file) => file.id));
  const visibleAttachments = [...savedAttachments.filter((file) => !removedAttachmentIds.includes(file.id)), ...pickedAttachments];
  const ownedFieldAttachments = isMultiSite
    ? collectFieldAttachmentIds((item?.fields ?? []).filter((field) => ownedIds.has(field.id)))
    : new Set();
  const embeddedAttachmentIds = collectFieldAttachmentIds(fields.map((field) => (
    field.modified ? field : { ...field, value: temporary.current.get(field.editorId) || "" }
  )));
  const legacyAttachments = visibleAttachments.filter((file) => !embeddedAttachmentIds.has(file.id) && !ownedFieldAttachments.has(file.id));

  function downloadButton(file) {
    if (!file) return null;
    const source = savedAttachmentIds.has(file.id) ? { id: item.id } : { draftId: attachmentDraftId.current };
    return renderAttachmentDownload(file, source, busy || attachmentBusy);
  }

  useEffect(() => {
    mounted.current = true;
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
    };
  }, []);

  const patchField = (editorId, patch) => setFields((values) => values.map((field) => field.editorId === editorId ? { ...field, ...patch } : field));
  const move = (index, direction) => setFields((previous) => {
    const target = index + direction;
    if (target < 0 || target >= previous.length) return previous;
    const result = [...previous];
    [result[index], result[target]] = [result[target], result[index]];
    return result;
  });

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
      onError(error);
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
      if (mounted.current) onError(error);
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
      if (mounted.current) onError(error);
    } finally {
      if (mounted.current) setAttachmentBusy(false);
    }
  }

  async function save(event) {
    event.preventDefault();
    if (busy || attachmentBusy) return;
    setBusy(true);
    try {
      let sitePatch = {};
      if (isMultiSite) {
        const trimmedUrl = siteUrl.trim();
        if (trimmedUrl !== (item?.site?.url || "") || title.trim() !== (item?.site?.name || "")) {
          const built = buildSiteObject({ name: title.trim(), url: trimmedUrl });
          if (built.error) {
            onError(new Error(built.error));
            return;
          }
          sitePatch = { site: built.site };
        }
      }

      const payload = {
        title,
        tags: tags.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean),
        favorite,
        ...(isMultiSite ? sitePatch : { expiresAt: expiresAt || null }),
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
      const result = item
        ? await invokeVault("updateItem", { id: item.id, patch: payload })
        : await invokeVault("createItem", { input: { type, ...payload, subtitleFieldId: null } });
      attachmentDraftId.current = null;
      const details = await invokeVault("getItem", { id: result.summary.id });
      if (!item) {
        const subtitle = details.item.fields.find((field) => !field.sensitive && SUBTITLE_LABELS.has(field.label));
        if (subtitle) await invokeVault("updateItem", { id: result.summary.id, patch: { subtitleFieldId: subtitle.id } });
      }
      if (mounted.current) await onSaved(result.summary.id);
    } catch (error) {
      if (mounted.current) onError(error);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <form className="notion-page vault-editor" onSubmit={save} aria-label={item ? t("vault.editor.editItemAria") : t("vault.editor.newItemAria")}>
      <div className="vault-section-head">
        <h2>{item ? (isMultiSite ? t("vault.editor.editSite") : t("vault.editor.editItem")) : t("vault.newItem")}</h2>
        <button type="button" className="btn-line btn-sm" onClick={onCancel} disabled={busy}>{t("common.cancel")}</button>
      </div>

      {isMultiSite && (
        <p className="notion-callout-inline">
          {t("vault.editor.multiSiteHint", { count: item.credentials.length })}
        </p>
      )}

      {!item && (
        <label className="editor-label">
          {t("vault.editor.type")}
          <select aria-label={t("vault.editor.typeAria")} value={type} onChange={(event) => { setType(event.target.value); setFields(newItemFields(event.target.value, t)); setGeneratorTarget(null); }}>
            {Object.keys(ITEM_TYPES).map((value) => <option key={value} value={value}>{itemTypeLabel(value, t)}</option>)}
          </select>
        </label>
      )}

      <label className="editor-label">
        {isMultiSite ? t("vault.editor.siteName") : t("vault.editor.title")}
        <input aria-label={t("vault.editor.titleAria")} value={title} maxLength={500} onChange={(event) => setTitle(event.target.value)} required autoFocus />
      </label>

      {isMultiSite && (
        <label className="editor-label">
          {t("vault.editor.mainUrl")}
          <input aria-label={t("vault.editor.mainUrlAria")} type="url" value={siteUrl} placeholder="https://example.com" onChange={(event) => setSiteUrl(event.target.value)} />
        </label>
      )}

      <label className="editor-label">
        {t("vault.editor.tags")}
        <input aria-label={t("vault.editor.tagsAria")} value={tags} onChange={(event) => setTags(event.target.value)} placeholder={t("vault.editor.tagsPlaceholder")} />
      </label>

      <div className="editor-meta">
        <label><input type="checkbox" checked={favorite} onChange={(event) => setFavorite(event.target.checked)} />{t("vault.editor.favorite")}</label>
        {!isMultiSite && (
          <label>{t("vault.editor.expiry")}<input aria-label={t("vault.editor.expiryAria")} type="date" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} /></label>
        )}
      </div>

      <div className="editor-fields">
        {fields.map((field, index) => {
          const isRichNote = field.kind === "multiline" && (!field.sensitive || type === "secureNote" || RICH_NOTE_LABELS.has(field.label));
          const maskedByBlur = Boolean(windowBlurred && field.sensitive);
          const maskedUnrevealed = maskedByBlur || Boolean(field.id && field.sensitive && !field.modified && !temporary.current.has(field.editorId));
          const fieldValue = maskedByBlur ? "" : (field.modified ? field.value : temporary.current.get(field.editorId) || "");
          return (
            <section key={field.editorId} className={`editor-field ${field.kind === "multiline" ? "is-note" : ""}`}>
              <div className="editor-field-head">
                <input aria-label={t("vault.editor.fieldLabelAria", { index: index + 1 })} value={field.label} maxLength={100} onChange={(event) => patchField(field.editorId, { label: event.target.value })} required />
                <select aria-label={t("vault.editor.fieldKindAria", { index: index + 1 })} value={field.kind} onChange={(event) => patchField(field.editorId, { kind: event.target.value, sensitive: ["secret", "totp"].includes(event.target.value) || field.sensitive })}>
                  {Object.keys(FIELD_KINDS).map((value) => <option key={value} value={value}>{fieldKindLabel(value, t)}</option>)}
                </select>
                <button type="button" className="mini" aria-label={t("vault.editor.fieldMoveUp", { index: index + 1 })} disabled={index === 0} onClick={() => move(index, -1)}><IconArrowUp size={16} /></button>
                <button type="button" className="mini" aria-label={t("vault.editor.fieldMoveDown", { index: index + 1 })} disabled={index === fields.length - 1} onClick={() => move(index, 1)}><IconArrowDown size={16} /></button>
                <button type="button" className="mini" aria-label={t("vault.editor.fieldDelete", { index: index + 1 })} onClick={() => setFields((values) => values.filter((entry) => entry.editorId !== field.editorId))}><IconTrash size={16} /></button>
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
                  <input type="checkbox" checked={field.sensitive} disabled={["secret", "totp"].includes(field.kind)} onChange={(event) => patchField(field.editorId, { sensitive: event.target.checked })} />
                  {t("vault.editor.sensitiveField")}
                </label>
                {field.sensitive && (
                  <button type="button" className="text-button" onClick={() => setGeneratorTarget(generatorTarget === field.editorId ? null : field.editorId)}>
                    {t("vault.editor.generate")}
                  </button>
                )}
              </div>
              {generatorTarget === field.editorId && (
                <Generator key={field.editorId} onError={onError} onUse={(value) => { patchField(field.editorId, { value, modified: true }); setGeneratorTarget(null); }} />
              )}
            </section>
          );
        })}
      </div>

      <button
        type="button"
        className="btn-line btn-sm"
        disabled={fields.length >= 100}
        onClick={() => setFields((values) => [...values, {
          editorId: `new-${nextId.current++}`,
          label: isMultiSite ? t("vault.editor.siteNoteLabel") : "",
          kind: isMultiSite ? "multiline" : "text",
          sensitive: false,
          value: "",
          modified: true,
        }])}
      >
        <IconPlus size={14} />{isMultiSite ? t("vault.editor.addSharedNote") : t("vault.editor.addField")}
      </button>

      {!item?.deletedAt && legacyAttachments.length > 0 && (
        <NoteAttachments
          files={legacyAttachments}
          fileAction={(file) => (
            <>
              {downloadButton(file)}
              <button type="button" className="mini" title={t("vault.editor.removeAttachment")} aria-label={t("vault.editor.removeAttachmentAria", { name: file.name })} disabled={attachmentBusy || busy} onClick={() => removeAttachment(file)}>
                <IconTrash size={16} />
              </button>
            </>
          )}
        >
          <p className="vault-attachment-hint">{t("vault.editor.attachmentHint")}</p>
        </NoteAttachments>
      )}

      <div className="editor-save">
        <button className="primary" disabled={!title.trim() || busy || attachmentBusy}>{busy ? t("vault.editor.saving") : t("vault.editor.saveItem")}</button>
      </div>
    </form>
  );
}
