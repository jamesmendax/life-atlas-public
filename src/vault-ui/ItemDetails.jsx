import React, { useEffect, useMemo, useRef, useState } from "react";
import IconChevronDown from "@tabler/icons-react/dist/esm/icons/IconChevronDown.mjs";
import IconChevronRight from "@tabler/icons-react/dist/esm/icons/IconChevronRight.mjs";
import IconClock from "@tabler/icons-react/dist/esm/icons/IconClock.mjs";
import IconCopy from "@tabler/icons-react/dist/esm/icons/IconCopy.mjs";
import IconCheck from "@tabler/icons-react/dist/esm/icons/IconCheck.mjs";
import IconEdit from "@tabler/icons-react/dist/esm/icons/IconEdit.mjs";
import IconExternalLink from "@tabler/icons-react/dist/esm/icons/IconExternalLink.mjs";
import IconEye from "@tabler/icons-react/dist/esm/icons/IconEye.mjs";
import IconEyeOff from "@tabler/icons-react/dist/esm/icons/IconEyeOff.mjs";
import IconGitFork from "@tabler/icons-react/dist/esm/icons/IconGitFork.mjs";
import IconGitMerge from "@tabler/icons-react/dist/esm/icons/IconGitMerge.mjs";
import IconHistory from "@tabler/icons-react/dist/esm/icons/IconHistory.mjs";
import IconHourglass from "@tabler/icons-react/dist/esm/icons/IconHourglass.mjs";
import IconKey from "@tabler/icons-react/dist/esm/icons/IconKey.mjs";
import IconLink from "@tabler/icons-react/dist/esm/icons/IconLink.mjs";
import IconPlus from "@tabler/icons-react/dist/esm/icons/IconPlus.mjs";
import IconShieldCheck from "@tabler/icons-react/dist/esm/icons/IconShieldCheck.mjs";
import IconTag from "@tabler/icons-react/dist/esm/icons/IconTag.mjs";
import IconTrash from "@tabler/icons-react/dist/esm/icons/IconTrash.mjs";
import { invokeVault } from "./api.js";
import { expiryState, localDateString } from "./expiry.js";
import { itemTypeLabel } from "./itemTypes.js";
import ConfirmationDialog from "./ConfirmationDialog.jsx";
import CredentialFormModal from "./CredentialFormModal.jsx";
import NoteAttachments from "./NoteAttachments.jsx";
import VaultNoteView from "./VaultNoteView.jsx";
import { SiteGlyph } from "./SiteOverview.jsx";
import { TYPE_TAG_TONE, daysUntilExpiry, displayDomain, formatShortDate } from "./siteHelper.js";
import { collectFieldAttachmentIds } from "./vaultNoteModel.js";
import { useI18n } from "./i18n.js";

const PREVIEW_LABELS = new Set([
  "用户名", "账号", "账户名", "邮箱", "电子邮箱", "主机", "主机名", "key 名称", "key名称",
  "username", "user name", "email", "e-mail", "host", "hostname", "key name",
  "ユーザー名", "メールアドレス", "ホスト", "key 名",
]);
const RICH_NOTE_LABELS = new Set(["备注", "内容", "原图", "メモ", "本文", "notes", "content"]);

export function ExpiryBadge({ expiresAt }) {
  const { t } = useI18n();
  const today = localDateString();
  const state = expiryState(expiresAt, today);
  if (state === "none") return null;
  const days = daysUntilExpiry(expiresAt, today);
  return (
    <span className={`n-tag ${state === "expired" ? "red" : "yellow"} num`}>
      <IconHourglass size={11} aria-hidden="true" />
      {state === "expired" ? t("vault.overview.expired") : days !== null && days >= 0 ? t("vault.overview.daysLaterExpire", { days }) : t("vault.overview.expiringSoon")}
    </span>
  );
}

function Totp({ id, fieldId, paused, onError }) {
  const { t } = useI18n();
  const [totp, setTotp] = useState(null);
  useEffect(() => {
    if (paused) {
      setTotp(null);
      return undefined;
    }
    let active = true;
    let requestSeq = 0;
    const refresh = async () => {
      const seq = ++requestSeq;
      try {
        const value = await invokeVault("getTotp", { id, fieldId });
        if (active && seq === requestSeq) setTotp(value);
      } catch (error) {
        if (active && seq === requestSeq) {
          setTotp(null);
          onError(error);
        }
      }
    };
    refresh();
    const timer = setInterval(refresh, 1000);
    return () => {
      active = false;
      requestSeq += 1;
      clearInterval(timer);
    };
  }, [id, fieldId, paused, onError]);

  if (paused) return <span className="vault-muted">{t("vault.details.totpPaused")}</span>;
  if (!totp) return <span className="vault-muted">{t("vault.details.noTotp")}</span>;
  const midpoint = Math.floor(totp.code.length / 2);
  return (
    <span className="totp" aria-label={t("vault.details.totpAria")}>
      <b className="mono">{totp.code.slice(0, midpoint)}</b>
      <b className="mono">{totp.code.slice(midpoint)}</b>
      <span className="totp-ring" style={{ "--p": totp.validForSeconds / totp.periodSeconds }}>
        <small className="num">{totp.validForSeconds}</small>
      </span>
    </span>
  );
}

function primaryCopyField(fields) {
  return fields.find((field) => field.kind === "secret" && field.hasValue)
    || fields.find((field) => field.kind === "totp" && field.hasValue)
    || fields.find((field) => field.sensitive && field.hasValue)
    || fields.find((field) => !field.sensitive && field.value);
}

function primaryRevealField(fields) {
  return fields.find((field) => field.kind === "secret" && field.hasValue)
    || fields.find((field) => field.sensitive && field.kind !== "totp" && field.hasValue);
}

function nonSensitivePreview(fields, emptyLabel) {
  const labeled = fields.find((field) => !field.sensitive && field.value?.trim()
    && (field.kind === "email" || PREVIEW_LABELS.has(field.label.trim().toLowerCase())));
  if (labeled) return { text: labeled.value, masked: false };
  const hasSecret = fields.some((field) => field.sensitive && field.hasValue);
  if (hasSecret) return { text: "••••••••••••", masked: true };
  const fallback = fields.find((field) => !field.sensitive && field.kind !== "multiline" && field.value?.trim());
  return fallback ? { text: fallback.value, masked: false } : { text: emptyLabel, masked: false };
}

export default function ItemDetails({
  item,
  focusedCredentialId = null,
  focusSeq = 0,
  sameSiteSiblings = [],
  onEdit,
  onChanged,
  onSplitCreated,
  onOpenMerge,
  onError,
  renderAttachmentDownload,
}) {
  const { locale, t, format } = useI18n();
  const isMultiModel = Array.isArray(item.credentials) && item.credentials.length > 0;
  const isStandaloneNote = !isMultiModel && item.type === "secureNote";

  const credentialRows = useMemo(() => {
    if (isStandaloneNote) return [];
    const byId = new Map(item.fields.map((field) => [field.id, field]));
    if (isMultiModel) {
      return item.credentials.map((credential) => ({
        ...credential,
        virtual: false,
        fields: credential.fieldIds.map((id) => byId.get(id)).filter(Boolean),
      }));
    }
    return [{
      id: "__single__",
      label: item.title,
      type: item.type,
      expiresAt: item.expiresAt,
      fieldIds: item.fields.map((field) => field.id),
      fields: item.fields,
      virtual: true,
    }];
  }, [item, isMultiModel, isStandaloneNote]);

  const sharedFields = useMemo(() => {
    if (isStandaloneNote) return item.fields;
    if (!isMultiModel) return [];
    const owned = new Set(item.credentials.flatMap((credential) => credential.fieldIds));
    return item.fields.filter((field) => !owned.has(field.id));
  }, [item, isMultiModel, isStandaloneNote]);

  const [typeTab, setTypeTab] = useState("all");
  const [expandedIds, setExpandedIds] = useState(() => new Set(
    focusedCredentialId
      ? [focusedCredentialId]
      : credentialRows[0] ? [credentialRows[0].id] : [],
  ));
  const [revealed, setRevealed] = useState({});
  const [copied, setCopied] = useState({});
  const [historyOpen, setHistoryOpen] = useState({});
  const [history, setHistory] = useState({});
  const [confirmation, setConfirmation] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [credModal, setCredModal] = useState(null); // { mode: "add" | "edit", credential?: object }
  const [windowBlurred, setWindowBlurred] = useState(false);

  const timerIds = useRef(new Map());
  const version = useRef(0);
  const mounted = useRef(false);
  const rowRefs = useRef(new Map());

  useEffect(() => {
    mounted.current = true;
    const onBlur = () => {
      version.current += 1;
      setWindowBlurred(true);
      setRevealed({});
      for (const timer of timerIds.current.values()) clearTimeout(timer);
      timerIds.current.clear();
    };
    const onFocus = () => setWindowBlurred(false);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    return () => {
      mounted.current = false;
      version.current += 1;
      for (const timer of timerIds.current.values()) clearTimeout(timer);
      timerIds.current.clear();
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  // VP Review #1 + #5: ONLY react when a new sidebar sub-credential click happens (focusSeq changes), never fight manual filter tab switches!
  const lastFocusSeq = useRef(-1);
  useEffect(() => {
    if (!focusedCredentialId || focusSeq === lastFocusSeq.current) return;
    lastFocusSeq.current = focusSeq;
    const match = credentialRows.find((row) => row.id === focusedCredentialId);
    if (!match) return;
    setTypeTab((current) => (current !== "all" && match.type !== current ? "all" : current));
    setExpandedIds((previous) => {
      if (previous.has(focusedCredentialId)) return previous;
      const next = new Set(previous);
      next.add(focusedCredentialId);
      return next;
    });
    requestAnimationFrame(() => {
      const node = rowRefs.current.get(focusedCredentialId);
      if (node) node.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }, [focusedCredentialId, focusSeq, credentialRows]);

  function clearRevealed() {
    version.current += 1;
    setRevealed({});
    for (const timer of timerIds.current.values()) clearTimeout(timer);
    timerIds.current.clear();
  }

  async function reveal(field, index) {
    const key = index === undefined ? field.id : `${field.id}:${index}`;
    if (Object.hasOwn(revealed, key)) {
      version.current += 1;
      setRevealed((previous) => { const next = { ...previous }; delete next[key]; return next; });
      clearTimeout(timerIds.current.get(key));
      timerIds.current.delete(key);
      return;
    }
    const expectedVersion = version.current;
    try {
      const result = await invokeVault(index === undefined ? "revealField" : "revealHistory", {
        id: item.id,
        fieldId: field.id,
        ...(index === undefined ? {} : { index }),
      });
      if (!mounted.current || version.current !== expectedVersion) return;
      setRevealed((previous) => ({ ...previous, [key]: result.value }));
      clearTimeout(timerIds.current.get(key));
      timerIds.current.set(key, setTimeout(() => {
        setRevealed((previous) => { const next = { ...previous }; delete next[key]; return next; });
        timerIds.current.delete(key);
      }, 20000));
    } catch (error) {
      if (mounted.current) onError(error);
    }
  }

  async function copy(field, index) {
    try {
      const result = await invokeVault(index === undefined ? "copyField" : "copyHistory", {
        id: item.id,
        fieldId: field.id,
        ...(index === undefined ? {} : { index }),
      });
      if (!mounted.current) return;
      const startedAt = Date.now();
      setCopied((previous) => ({ ...previous, [field.id]: { seconds: result.clearsInSeconds, startedAt } }));
      setTimeout(() => {
        if (mounted.current) {
          setCopied((previous) => {
            const next = { ...previous };
            if (next[field.id]?.startedAt === startedAt) delete next[field.id];
            return next;
          });
        }
      }, result.clearsInSeconds * 1000);
    } catch (error) {
      if (mounted.current) onError(error);
    }
  }

  async function toggleHistory(field) {
    if (historyOpen[field.id]) {
      clearRevealed();
      setHistoryOpen((previous) => ({ ...previous, [field.id]: false }));
      return;
    }
    try {
      const result = await invokeVault("getHistory", { id: item.id, fieldId: field.id });
      if (!mounted.current) return;
      setHistory((previous) => ({ ...previous, [field.id]: result.entries }));
      setHistoryOpen((previous) => ({ ...previous, [field.id]: true }));
    } catch (error) {
      if (mounted.current) onError(error);
    }
  }

  async function mutate(method) {
    try {
      await invokeVault(method, { id: item.id });
      if (mounted.current) onChanged(null);
    } catch (error) {
      if (mounted.current) onError(error);
    }
  }

  async function confirmChange() {
    if (!confirmation || confirming) return;
    setConfirming(true);
    try {
      const result = await invokeVault(confirmation.method, confirmation.args);
      if (!mounted.current) return;
      const method = confirmation.method;
      setConfirmation(null);
      if (method === "splitCredential" && result?.createdSummary?.id) {
        onSplitCreated?.(result.createdSummary.id);
      } else if (method === "restoreHistory" || method === "deleteCredential") {
        onChanged(item.id);
      } else {
        onChanged(null);
      }
    } catch (error) {
      if (mounted.current) onError(error);
    } finally {
      if (mounted.current) setConfirming(false);
    }
  }

  function toggleRow(id) {
    clearRevealed();
    setExpandedIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const downloadButton = (file) => renderAttachmentDownload(file, { id: item.id });

  const visibleFieldValues = item.fields.map((field) => (
    field.sensitive ? { ...field, value: Object.hasOwn(revealed, field.id) ? revealed[field.id] : "" } : field
  ));
  const embeddedAttachmentIds = collectFieldAttachmentIds(visibleFieldValues);
  const legacyAttachments = (item.attachments ?? []).filter((file) => !embeddedAttachmentIds.has(file.id));

  const savedSiteUrl = item.site?.url || "";
  const urlFields = item.fields.filter((field) => field.kind === "url" && !field.sensitive && field.value);
  const matchedUrlField = savedSiteUrl
    ? urlFields.find((field) => field.value.trim() === savedSiteUrl)
    : urlFields[0];
  const displaySiteUrl = savedSiteUrl || matchedUrlField?.value || "";
  const siteUrlDisplay = displayDomain(displaySiteUrl, "");

  const typeTabs = useMemo(() => {
    const counts = new Map();
    for (const row of credentialRows) counts.set(row.type, (counts.get(row.type) || 0) + 1);
    return [
      ["all", t("vault.overview.filterAll"), credentialRows.length],
      ...["login", "apiKey", "server", "database", "secureNote", "recoveryCodes", "custom"]
        .filter((key) => (counts.get(key) || 0) > 0)
        .map((key) => [key, itemTypeLabel(key, t), counts.get(key)]),
    ];
  }, [credentialRows, t]);

  const effectiveTypeTab = typeTabs.some(([key]) => key === typeTab) ? typeTab : "all";
  const filteredRows = effectiveTypeTab === "all"
    ? credentialRows
    : credentialRows.filter((row) => row.type === effectiveTypeTab);

  const today = localDateString();

  function renderFieldRow(field) {
    const isRichNote = field.kind === "multiline" && (!field.sensitive || item.type === "secureNote" || RICH_NOTE_LABELS.has(field.label.trim().toLowerCase()));
    const showRich = isRichNote && (!field.sensitive || Object.hasOwn(revealed, field.id));
    const richValue = field.sensitive ? revealed[field.id] : field.value;
    const historyCount = item.history.filter((entry) => entry.fieldId === field.id).length;
    const isRevealed = Object.hasOwn(revealed, field.id);

    return (
      <div key={field.id} className={`vw-field cred-field-row ${field.kind === "multiline" ? "is-note" : ""} ${field.sensitive ? "is-secret" : ""}`}>
        <span className="cred-field-label">{field.label}</span>
        <div className="cred-field-val">
          {field.kind === "totp" && field.hasValue ? (
            <Totp id={item.id} fieldId={field.id} paused={windowBlurred} onError={onError} />
          ) : showRich ? (
            <VaultNoteView value={richValue} itemId={item.id} attachments={item.attachments ?? []} renderDownload={downloadButton} />
          ) : field.sensitive ? (
            isRevealed
              ? <span className="mono revealed-secret">{revealed[field.id]}</span>
              : field.hasValue ? <span className="mono masked-dots">••••••••••••</span> : <span className="vault-muted">{t("vault.details.emptyValue")}</span>
          ) : (
            field.value || <span className="vault-muted">{t("vault.details.emptyValue")}</span>
          )}
        </div>
        <span className="cred-field-actions">
          {field.kind === "url" && field.value && (
            <button
              type="button"
              className="mini"
              aria-label={t("vault.details.openField", { label: field.label })}
              title={t("vault.details.openField", { label: field.label })}
              onClick={async () => {
                try { await invokeVault("openFieldUrl", { id: item.id, fieldId: field.id }); }
                catch (error) { onError(error); }
              }}
            >
              <IconExternalLink size={15} />
            </button>
          )}
          {field.sensitive && field.kind !== "totp" && (
            <button
              type="button"
              className="mini"
              aria-label={t("vault.details.showField", { label: field.label })}
              title={isRevealed ? t("vault.details.hideField", { label: field.label }) : t("vault.details.showField", { label: field.label })}
              onClick={() => reveal(field)}
            >
              {isRevealed ? <IconEyeOff size={15} /> : <IconEye size={15} />}
            </button>
          )}
          <button
            type="button"
            className={`mini ${copied[field.id] ? "is-copied" : ""}`}
            aria-label={t("vault.details.copyField", { label: field.label })}
            title={t("vault.details.copyField", { label: field.label })}
            onClick={() => copy(field)}
          >
            {copied[field.id] ? <IconCheck size={15} /> : <IconCopy size={15} />}
          </button>
        </span>

        {copied[field.id] && (
          <div className="copy-clear" key={copied[field.id].startedAt}>
            <span className="copy-bar"><i style={{ animationDuration: `${copied[field.id].seconds}s` }} /></span>
            <span className="num">{t("vault.details.copiedCountdown", { seconds: copied[field.id].seconds })}</span>
          </div>
        )}

        {field.sensitive && historyCount > 0 && (
          <div className="field-history">
            <button type="button" className="text-button" onClick={() => toggleHistory(field)}>
              <IconHistory size={13} aria-hidden="true" />{t("vault.details.history", { count: historyCount })}
            </button>
            {historyOpen[field.id] && (
              <div className="history-entries">
                {history[field.id]?.map((entry) => (
                  <div className="history-entry" key={entry.index}>
                    <time>{format.formatDateTime(entry.changedAt, locale, { includeSeconds: true })}</time>
                    <div className="vault-actions">
                      <button type="button" className="btn-line btn-sm" onClick={() => reveal(field, entry.index)}>
                        {Object.hasOwn(revealed, `${field.id}:${entry.index}`) ? t("vault.details.hide") : t("vault.details.show")}
                      </button>
                      <button type="button" className="btn-line btn-sm" onClick={() => copy(field, entry.index)}>{t("vault.details.copy")}</button>
                      <button
                        type="button"
                        className="btn-line btn-sm"
                        onClick={() => setConfirmation({
                          method: "restoreHistory",
                          args: { id: item.id, fieldId: field.id, index: entry.index },
                          title: t("vault.details.restoreHistoryTitle"),
                          description: t("vault.details.restoreHistoryDesc"),
                        })}
                      >
                        {t("vault.details.restoreHistoryBtn")}
                      </button>
                    </div>
                    {Object.hasOwn(revealed, `${field.id}:${entry.index}`) && <pre>{revealed[`${field.id}:${entry.index}`]}</pre>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <article className="notion-page notion-doc" aria-label={t("vault.details.aria")}>
      <header className="doc-header">
        <div className="doc-title-line">
          <span className="doc-glyph">
            <SiteGlyph summary={{ type: item.type, siteUrl: item.site?.url, host: siteUrlDisplay }} size={30} />
          </span>
          <h2>{item.title}</h2>
          {!item.deletedAt && (
            <button type="button" className="n-ghost doc-edit-btn" aria-label={t("vault.details.editItemAria")} onClick={onEdit}>
              <IconEdit size={15} aria-hidden="true" />{t("vault.details.edit")}
            </button>
          )}
        </div>
      </header>

      {/* Pure Notion Compact Properties */}
      <section className="doc-props" aria-label={t("vault.details.propsAria")}>
        {displaySiteUrl && (
          <div className="doc-prop">
            <span className="doc-prop-k"><IconLink size={14} aria-hidden="true" />{t("vault.details.siteUrl")}</span>
            <span className="doc-prop-v">
              {matchedUrlField ? (
                <button
                  type="button"
                  className="doc-url-link"
                  onClick={async () => {
                    try { await invokeVault("openFieldUrl", { id: item.id, fieldId: matchedUrlField.id }); }
                    catch (error) { onError(error); }
                  }}
                >
                  <span>{displaySiteUrl}</span>
                  <IconExternalLink size={13} aria-hidden="true" />
                </button>
              ) : (
                <span>{displaySiteUrl}</span>
              )}
            </span>
          </div>
        )}

        <div className="doc-prop">
          <span className="doc-prop-k"><IconKey size={14} aria-hidden="true" />{t("vault.details.grouping")}</span>
          <span className="doc-prop-v num">
            {isStandaloneNote ? (
              <span className="n-tag purple">{itemTypeLabel("secureNote", t)}</span>
            ) : credentialRows.length > 1 ? (
              <span className="muted-val">{t("vault.details.mergedCount", { count: credentialRows.length })}</span>
            ) : (
              <span className="muted-val">{t("vault.details.singleKeyMeta", { type: itemTypeLabel(item.type, t) })}</span>
            )}
            {sameSiteSiblings.length > 0 && !item.deletedAt && (
              <button type="button" className="notion-link-action" onClick={onOpenMerge}>
                <IconGitMerge size={13} aria-hidden="true" />{t("vault.details.findSiblings", { count: sameSiteSiblings.length })}
              </button>
            )}
          </span>
        </div>

        {item.tags.length > 0 && (
          <div className="doc-prop">
            <span className="doc-prop-k"><IconTag size={14} aria-hidden="true" />{t("vault.details.tags")}</span>
            <span className="doc-prop-v tag-cluster">
              {item.tags.map((tag) => <span key={tag} className="n-tag">{tag}</span>)}
            </span>
          </div>
        )}

        <div className="doc-prop">
          <span className="doc-prop-k"><IconClock size={14} aria-hidden="true" />{t("vault.details.lastModified")}</span>
          <span className="doc-prop-v muted-val num">
            {format.formatDate(item.updatedAt, locale) || formatShortDate(item.updatedAt)} · {t("vault.details.createdAt", { date: format.formatDate(item.createdAt, locale) || formatShortDate(item.createdAt) })}
          </span>
        </div>
      </section>

      {/* Core Stage: Notion Inline Database for Site Credentials (Scheme 2) */}
      {!isStandaloneNote && (
        <section className="inline-db-section" aria-label={t("vault.details.listAria")}>
          <div className="inline-db-head">
            <h3><IconKey size={16} aria-hidden="true" />{t("vault.details.keysHeading")}</h3>
          </div>

          <div className="notion-db-bar">
            <div className="notion-db-tabs" role="tablist" aria-label={t("vault.details.filterSubAria")}>
              {typeTabs.map(([key, label, count]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={effectiveTypeTab === key}
                  className={`notion-db-tab ${effectiveTypeTab === key ? "is-active" : ""}`}
                  onClick={() => { clearRevealed(); setTypeTab(key); }}
                >
                  <span>{label}</span>
                  <small className="num">{count}</small>
                </button>
              ))}
            </div>
            {!item.deletedAt && (
              <div className="notion-db-actions">
                <button type="button" className="n-primary" onClick={() => setCredModal({ mode: "add" })}>
                  <IconPlus size={14} aria-hidden="true" />{t("vault.details.addKeyBtn")}
                </button>
              </div>
            )}
          </div>

          <div className="notion-table-wrap">
            <table className="notion-table cred-inline-table">
              <thead>
                <tr>
                  <th className="c-name">{t("vault.details.colName")}</th>
                  <th className="c-type">{t("vault.details.colType")}</th>
                  <th className="c-preview">{t("vault.details.colPreview")}</th>
                  <th className="c-status">{t("vault.overview.colStatus")}</th>
                  <th className="c-actions"><span className="sr-only">{t("vault.details.quickActionsAria")}</span></th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => {
                  const expanded = expandedIds.has(row.id);
                  const preview = nonSensitivePreview(row.fields, t("vault.details.emptyValue"));
                  const rowCopyField = primaryCopyField(row.fields);
                  const rowRevealField = primaryRevealField(row.fields);
                  const expState = expiryState(row.expiresAt, today);
                  const days = daysUntilExpiry(row.expiresAt, today);
                  const hasTotp = row.fields.some((field) => field.kind === "totp" && field.hasValue);
                  const isCopied = rowCopyField && Boolean(copied[rowCopyField.id]);

                  return (
                    <React.Fragment key={row.id}>
                      <tr
                        ref={(node) => { if (node) rowRefs.current.set(row.id, node); else rowRefs.current.delete(row.id); }}
                        className={`cred-summary-row ${expanded ? "is-expanded" : ""} ${focusedCredentialId === row.id ? "is-focused" : ""}`}
                        onClick={() => toggleRow(row.id)}
                      >
                        <td className="c-name">
                          <button
                            type="button"
                            className="cred-toggle-trigger"
                            aria-expanded={expanded}
                            onClick={(event) => { event.stopPropagation(); toggleRow(row.id); }}
                          >
                            {expanded ? <IconChevronDown size={14} aria-hidden="true" /> : <IconChevronRight size={14} aria-hidden="true" />}
                            <span className="cred-row-label">{row.label}</span>
                            {expState !== "none" && (
                              <span className={`n-tag inline-mobile-status ${expState === "expired" ? "red" : "yellow"} num`}>
                                {expState === "expired" ? t("vault.overview.expired") : t("vault.overview.daysLaterShort", { days: Math.max(days ?? 0, 0) })}
                              </span>
                            )}
                          </button>
                        </td>
                        <td className="c-type">
                          <span className={`n-tag ${TYPE_TAG_TONE[row.type] || ""}`}>{itemTypeLabel(row.type, t)}</span>
                        </td>
                        <td className={`c-preview ${preview.masked ? "mono masked-dots" : ""}`}>
                          {preview.text}
                        </td>
                        <td className="c-status">
                          {expState !== "none" ? (
                            <ExpiryBadge expiresAt={row.expiresAt} />
                          ) : hasTotp ? (
                            <span className="n-tag green"><IconShieldCheck size={11} aria-hidden="true" />{t("vault.overview.has2fa")}</span>
                          ) : (
                            <span className="status-calm">{t("vault.overview.statusNormal")}</span>
                          )}
                        </td>
                        <td className="c-actions" onClick={(event) => event.stopPropagation()}>
                          <div className="cred-quick-acts">
                            {rowRevealField && (
                              <button
                                type="button"
                                className="mini"
                                aria-label={t("vault.details.revealRowAria", { label: row.label })}
                                title={t("vault.details.revealRowTitle")}
                                onClick={() => {
                                  if (!expanded) toggleRow(row.id);
                                  reveal(rowRevealField);
                                }}
                              >
                                <IconEye size={14} />
                              </button>
                            )}
                            {rowCopyField && (
                              <button
                                type="button"
                                className={`mini ${isCopied ? "is-copied" : ""}`}
                                aria-label={t("vault.details.copyRowAria", { label: row.label })}
                                title={t("vault.details.copyField", { label: rowCopyField.label })}
                                onClick={() => copy(rowCopyField)}
                              >
                                {isCopied ? <IconCheck size={14} /> : <IconCopy size={14} />}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>

                      {expanded && (
                        <tr className="cred-expand-row">
                          <td colSpan={5}>
                            <div className="cred-expand-body">
                              <div className="cred-fields-list">
                                {row.fields.map(renderFieldRow)}
                              </div>

                              {!item.deletedAt && (
                                <div className="cred-expand-foot">
                                  {row.expiresAt && (
                                    <span className="cred-foot-meta num">{t("vault.details.expiryMeta", { date: format.formatDate(row.expiresAt, locale) || row.expiresAt.slice(0, 10) })}</span>
                                  )}
                                  <div className="cred-foot-actions">
                                    {!row.virtual ? (
                                      <>
                                        <button
                                          type="button"
                                          className="text-button"
                                          onClick={() => setCredModal({ mode: "edit", credential: row })}
                                        >
                                          <IconEdit size={13} aria-hidden="true" />{t("vault.details.editCred")}
                                        </button>
                                        {credentialRows.length >= 2 && (
                                          <>
                                            <button
                                              type="button"
                                              className="text-button"
                                              onClick={() => setConfirmation({
                                                method: "splitCredential",
                                                args: { id: item.id, credentialId: row.id },
                                                title: t("vault.details.splitTitle"),
                                                description: t("vault.details.splitDesc", { label: row.label, title: item.title }),
                                              })}
                                            >
                                              <IconGitFork size={13} aria-hidden="true" />{t("vault.details.splitTitle")}
                                            </button>
                                            <button
                                              type="button"
                                              className="text-button is-danger"
                                              onClick={() => setConfirmation({
                                                method: "deleteCredential",
                                                args: { id: item.id, credentialId: row.id },
                                                title: t("vault.details.removeCredTitle"),
                                                description: t("vault.details.removeCredDesc", { label: row.label, title: item.title }),
                                                danger: true,
                                              })}
                                            >
                                              <IconTrash size={13} aria-hidden="true" />{t("vault.details.removeCredBtn")}
                                            </button>
                                          </>
                                        )}
                                      </>
                                    ) : (
                                      <button type="button" className="text-button" onClick={onEdit}>
                                        <IconEdit size={13} aria-hidden="true" />{t("vault.details.editFields")}
                                      </button>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>

            {!item.deletedAt && (
              <button type="button" className="notion-table-add" onClick={() => setCredModal({ mode: "add" })}>
                <IconPlus size={14} aria-hidden="true" />{t("vault.details.addCredUnderSite", { title: item.title })}
              </button>
            )}
          </div>
        </section>
      )}

      {/* Standalone Secure Note OR Shared Site-level Fields */}
      {sharedFields.length > 0 && (
        <section className="doc-shared-section" aria-label={isStandaloneNote ? t("vault.details.noteAria") : t("vault.details.sharedAria")}>
          {!isStandaloneNote && <h3>{t("vault.details.sharedHeading")}</h3>}
          <div className="cred-fields-list">
            {sharedFields.map(renderFieldRow)}
          </div>
        </section>
      )}

      {legacyAttachments.length > 0 && <NoteAttachments files={legacyAttachments} fileAction={downloadButton} />}

      <div className="detail-bottom">
        {item.deletedAt ? (
          <>
            <button type="button" className="btn-line btn-sm" onClick={() => mutate("restoreItem")}>{t("vault.details.restoreItem")}</button>
            <button
              type="button"
              className="danger btn-sm"
              onClick={() => setConfirmation({
                method: "deleteItemPermanently",
                args: { id: item.id },
                title: t("vault.details.deleteForeverTitle"),
                description: t("vault.details.deleteForeverDesc"),
                danger: true,
              })}
            >
              {t("vault.details.deleteForeverBtn")}
            </button>
          </>
        ) : (
          <button type="button" className="text-button" onClick={() => mutate("trashItem")}>
            <IconTrash size={14} aria-hidden="true" />{t("vault.details.moveToTrash")}
          </button>
        )}
      </div>

      {credModal && (
        <CredentialFormModal
          item={item}
          credential={credModal.credential || null}
          renderAttachmentDownload={renderAttachmentDownload}
          onError={onError}
          onCancel={() => setCredModal(null)}
          onSaved={async (savedCredId) => {
            setCredModal(null);
            if (savedCredId) {
              setTypeTab("all");
              setExpandedIds((previous) => new Set([...previous, savedCredId]));
            }
            await onChanged(item.id, savedCredId);
          }}
        />
      )}

      {confirmation && (
        <ConfirmationDialog
          {...confirmation}
          busy={confirming}
          onCancel={() => setConfirmation(null)}
          onConfirm={confirmChange}
        />
      )}
    </article>
  );
}
