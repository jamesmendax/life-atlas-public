import { lazy, Suspense, useCallback, useId, useMemo, useRef, useState } from "react";
import { comparePageVersion, HISTORY_DATABASE_SCOPE, pageHistoryPreview } from "../domain/pageHistory.js";
import { pageHistoryBlockDifferences, pageHistoryOriginLabel } from "../domain/pageHistoryDiff.js";
import { Dialog } from "../ui/Dialog.jsx";
import { useDialogs } from "../ui/DialogProvider.jsx";
import { AppearanceGlyph } from "./AppearanceGlyph.jsx";
import { PageCover } from "./PageCover.jsx";
import { format, useI18n } from "../i18n/workspaceRuntime.js";
import "./PageHistoryDiff.css";

const PageEditor = lazy(() => import("../editor/PageEditor.jsx").then((module) => ({ default: module.PageEditor })));
const sameDay = (first, second) => first.getFullYear() === second.getFullYear() && first.getMonth() === second.getMonth() && first.getDate() === second.getDate();

function versionTime(value, locale, t, now = Date.now()) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return t("history.unknownTime");
  if (locale !== "zh-CN") return format.formatDateTime(date, locale);
  const today = new Date(now);
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const prefix = sameDay(date, today) ? t("history.today") : sameDay(date, yesterday) ? t("history.yesterday") : `${date.getFullYear() === today.getFullYear() ? "" : `${date.getFullYear()}年`}${date.getMonth() + 1}月${date.getDate()}日`;
  return `${prefix} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function versionSize(bytes) {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}

function visibleHistoryBlock(root, id) {
  const selector = `[data-id="${CSS.escape(id)}"]`;
  return [...(root?.querySelectorAll(selector) || [])]
    .find((element) => element.getClientRects().length && getComputedStyle(element).visibility !== "hidden");
}

function currentHistoryBlock(pageId, id) {
  return [...document.querySelectorAll(".life-editor[data-page-id]")]
    .filter((editor) => editor.dataset.pageId === pageId && !editor.closest('[data-la-dialog="page-history"]'))
    .map((editor) => visibleHistoryBlock(editor, id)).find(Boolean);
}

function highlightHistoryBlock(block, id) {
  block.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
  const { top, left, width, height } = block.getBoundingClientRect();
  const outline = document.createElement("div");
  outline.setAttribute("aria-hidden", "true");
  outline.className = "hist-block-location-ring";
  outline.dataset.pageHistoryLocation = id;
  Object.assign(outline.style, { top: `${top}px`, left: `${left}px`, width: `${width}px`, height: `${height}px` });
  document.body.append(outline);
  const dismiss = new AbortController();
  const close = () => { outline.remove(); dismiss.abort(); };
  document.addEventListener("pointerdown", close, { once: true, signal: dismiss.signal });
  document.addEventListener("keydown", close, { once: true, signal: dismiss.signal });
  window.setTimeout(close, 2200);
}

function BlockDifferenceList({ difference, onLocate, canLocateVersion, locationMessage, t }) {
  if (!difference.differences.length && !difference.ambiguousIds.length) return null;
  return <details className="hist-block-diff">
    <summary>{t("history.blockDiffs", { count: difference.differences.length })}</summary>
    {difference.ambiguousIds.length > 0 && <p className="hist-block-location-note">{t("history.ambiguousIds", { count: difference.ambiguousIds.length })}</p>}
    {difference.differences.length > 0 && <ul className="hist-block-diff-list">
      {difference.differences.map(({ id, categories, before, current }) => <li key={id} data-history-block-id={id}>
        <div className="hist-block-diff-row">
          {categories.map((category) => <span key={category} className="hist-diff-tag">{t(`history.change.${category}`)}</span>)}
          {before && current && before !== current
            ? <><p>{t("history.versionLabel", { text: before })}</p><p>{t("history.currentLabel", { text: current })}</p></>
            : <p>{current || before}</p>}
        </div>
        <div className="hist-block-diff-locate">
          {before && <button type="button" className="mb-button" disabled={!canLocateVersion} onClick={() => onLocate(id, "version")}>{t("history.locateVersion")}</button>}
          {current && <button type="button" className="mb-button" onClick={() => onLocate(id, "current")}>{t("history.locateCurrent")}</button>}
        </div>
      </li>)}
    </ul>}
    {locationMessage && <p className="hist-block-location-note" role="status">{locationMessage}</p>}
  </details>;
}

export function PageHistoryDialog({ workspace, page, runtime, onClose, onRestored, restoreFocusRef }) {
  const { locale, t } = useI18n();
  const dialogs = useDialogs();
  const versions = useMemo(() => (workspace.pageVersions || []).filter((version) => version.pageId === page.id).sort((first, second) => Date.parse(second.createdAt) - Date.parse(first.createdAt)), [workspace.pageVersions, page.id]);
  const [selectedId, setSelectedId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [locationMessage, setLocationMessage] = useState("");
  const [readyVersion, setReadyVersion] = useState(null);
  const options = useRef(new Map());
  const previewPageRef = useRef(null);
  const previewId = useId();
  const selected = versions.find((version) => version.id === selectedId) || versions[0];
  const reportPreviewApi = useCallback((api) => setReadyVersion(api ? selected?.id : null), [selected?.id]);
  const preview = useMemo(() => pageHistoryPreview(selected), [selected]);
  const difference = useMemo(() => selected ? pageHistoryBlockDifferences(selected.content, page.content) : null, [selected, page.content]);
  const comparison = useMemo(() => selected ? comparePageVersion(page, selected) : { identical: true, changedFields: [] }, [selected, page]);
  const identical = comparison.identical;
  const browserMode = runtime?.platform !== "desktop" && window.lifeAtlas?.platform !== "desktop";

  const select = (version) => { setSelectedId(version.id); setLocationMessage(""); options.current.get(version.id)?.focus(); };
  const locate = (id, scope) => {
    const block = scope === "version" ? visibleHistoryBlock(previewPageRef.current, id) : currentHistoryBlock(page.id, id);
    if (!block) { setLocationMessage(t("history.notVisible")); return; }
    setLocationMessage("");
    if (scope === "current") onClose();
    requestAnimationFrame(() => {
      const target = scope === "current" ? currentHistoryBlock(page.id, id) : block;
      if (target?.isConnected) highlightHistoryBlock(target, id);
    });
  };
  const restore = async () => {
    if (!selected || busy || page.settings?.locked || identical) return;
    const mirroredTitle = workspace.databaseItems?.some(item => item.pageId === page.id
      && workspace.dataSources?.some(source => source.id === item.sourceId && source.properties?.some(property => property.type === "title")));
    const fields = comparison.changedFields.map(field => t(`history.field.${field}`) || field).join(locale.startsWith("zh") ? "、" : ", ");
    const description = t("history.confirmDesc", { fields, extra: mirroredTitle ? t("history.mirroredDesc") : HISTORY_DATABASE_SCOPE });
    const approved = await dialogs.confirm({ title: t("history.confirmTitle"), description, confirmLabel: t("history.restore") });
    if (!approved) return;
    setBusy(true);
    setError("");
    try {
      await runtime.restorePageVersion(page.id, selected.id);
      onClose();
      onRestored?.(t("history.restored", { time: versionTime(selected.createdAt, locale, t) }));
    } catch (failure) { setError(failure.message || t("history.restoreFailed")); }
    finally { setBusy(false); }
  };

  return <Dialog title={t("history.title")} description={page.title || t("backlinks.untitled")} ariaLabel={t("history.title")} onClose={onClose} restoreFocusRef={restoreFocusRef} className="history-dialog" busy={busy} dialogKind="page-history">
    {browserMode && <p className="hist-notice">{t("history.browserNotice")}</p>}
    <div className="hist-body">
      <div className="hist-list" role="listbox" aria-label={t("history.listAria")} onKeyDown={(event) => {
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) || !versions.length) return;
        event.preventDefault();
        const current = Math.max(0, versions.findIndex((version) => version.id === selected?.id));
        const next = event.key === "Home" ? 0 : event.key === "End" ? versions.length - 1 : Math.max(0, Math.min(versions.length - 1, current + (event.key === "ArrowDown" ? 1 : -1)));
        select(versions[next]);
      }}>
        {versions.map((version) => <button key={version.id} ref={(element) => { options.current.set(version.id, element); }} type="button" role="option" aria-selected={version.id === selected?.id} aria-controls={previewId} tabIndex={version.id === selected?.id ? 0 : -1} className={`hist-item${version.id === selected?.id ? " is-active" : ""}`} onClick={() => select(version)} disabled={busy}>
          <b>{versionTime(version.createdAt, locale, t)}</b><span>{t(`history.reason.${version.reason}`) || version.reason} · {pageHistoryOriginLabel(version)}</span><small>{t("history.metaRow", { blocks: version.blockCount, size: versionSize(version.sizeBytes) })}</small>
        </button>)}
      </div>
      <section className="hist-preview" id={previewId} aria-label={t("history.previewAria")}>
        {selected ? <>
          <div className="hist-diff">{identical ? t("history.identical") : <>{t("history.currentBlocksPrefix")}{Object.entries(difference.counts).map(([category, count]) =>
            <b key={category} className="hist-diff-count">{t("history.diffCount", { label: t(`history.change.${category}`), count })}</b>)}<span>{t("history.pageChanges", { fields: comparison.changedFields.map((field) => t(`history.field.${field}`) || field).join(locale.startsWith("zh") ? "、" : ", ") })}</span></>}</div>
          <BlockDifferenceList key={selected.id} difference={difference} onLocate={locate} canLocateVersion={readyVersion === selected.id} locationMessage={locationMessage} t={t} />
          <div className="hist-page" ref={previewPageRef}>
            {selected.cover && <div className="hist-cover"><PageCover cover={selected.cover} readOnly /></div>}
            <AppearanceGlyph icon={selected.icon} color={selected.iconColor} className="hist-page-icon" />
            <h1>{selected.title || t("backlinks.untitled")}</h1>
            {preview.detachedDatabase && <p className="hist-reference">{t("history.detachedDb")}{HISTORY_DATABASE_SCOPE}</p>}
            <Suspense fallback={<p className="hist-loading" role="status">{t("history.loadingPreview")}</p>}>
              <PageEditor key={selected.id} pageId={selected.pageId} initialContent={preview.content} locked onChange={() => {}} onEditorApiChange={reportPreviewApi} databaseRuntime={runtime} />
            </Suspense>
          </div>
        </> : <p className="hist-empty">{t("history.empty")}</p>}
        {error && <p role="alert" className="hist-error">{error}</p>}
        <div className="hist-actions"><button type="button" className="mb-button" onClick={onClose} disabled={busy}>{t("common.close")}</button><button type="button" className="mb-button mb-primary" onClick={restore} disabled={!selected || identical || page.settings?.locked || busy}>{busy ? t("history.restoring") : t("history.restore")}</button></div>
      </section>
    </div>
  </Dialog>;
}

export default PageHistoryDialog;
