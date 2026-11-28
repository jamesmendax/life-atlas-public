import { useCallback, useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import IconArrowUpRight from "@tabler/icons-react/dist/esm/icons/IconArrowUpRight.mjs";
import IconX from "@tabler/icons-react/dist/esm/icons/IconX.mjs";
import { dataSourceById, itemDisplayTitle } from "../domain/database.js";
import { PageEditor } from "../editor/PageEditor.jsx";
import { LifeAtlasEditorRuntimeContext } from "../editor/EditorRuntime.jsx";
import { RecordProperties } from "./RecordProperties.jsx";
import { isPageArchived } from "../domain/archive.js";
import { useI18n } from "../i18n/workspaceRuntime.js";

const FOCUSABLE = 'button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"]),[contenteditable="true"]';

export function RecordPeek({ workspace, pageId, runtime, mode = "peek", onOpenItemPage, onClose }) {
  const { t } = useI18n();
  const isSide = mode === "side";
  const page = workspace.pages?.find((entry) => entry.id === pageId);
  const item = workspace.databaseItems?.find((entry) => entry.pageId === pageId);
  const source = item && dataSourceById(workspace, item.sourceId);
  const titleProperty = source?.properties?.find((property) => property.type === "title");
  const rawTitle = item && source ? itemDisplayTitle(workspace, source, item) : page?.title;
  const title = rawTitle && rawTitle !== "无标题" ? rawTitle : t("dbx.untitled");
  const titleValue = String(item?.values?.[titleProperty?.id] ?? page?.title ?? "");
  const owner = source?.ownerPageId && workspace.pages?.find(entry => entry.id === source.ownerPageId);
  const locked = Boolean(runtime?.locked || page?.settings?.locked || owner?.settings?.locked || owner?.trashedAt || isPageArchived(workspace, page) || isPageArchived(workspace, owner));
  const dialogRef = useRef(null), titleRef = useRef(null), closeRef = useRef(onClose);
  const editorApiRef = useRef(null);
  const rememberEditorApi = useCallback((api) => { editorApiRef.current = api; }, []);
  closeRef.current = onClose;
  const visitRef = useRef(runtime?.recordPeekVisit);
  visitRef.current = runtime?.recordPeekVisit;
  useEffect(() => {
    if (!page || page.trashedAt) return;
    const timer = setTimeout(() => visitRef.current?.(pageId), 1000);
    return () => clearTimeout(timer);
  }, [pageId, Boolean(page), page?.trashedAt]);
  const recordRuntime = useMemo(() => ({
    ...runtime, workspace, pageId, locked,
    breadcrumb: [source?.title || t("dbx.databaseFallback"), title],
    createSubPage: (childTitle) => runtime?.createSubPage?.(childTitle, pageId),
    updatePageContent: (targetPageId, content) => runtime?.updatePageContent?.(targetPageId, content),
  }), [runtime, workspace, pageId, locked, source?.title, title, t]);
  useEffect(() => {
    const overflow = document.body.style.overflow;
    if (!isSide) document.body.style.overflow = "hidden";
    titleRef.current?.focus({ preventScroll: true });
    const keyboard = (event) => {
      if (!dialogRef.current?.contains(document.activeElement)) return;
      if (event.key === "Escape" && !document.activeElement?.closest?.(".bn-editor")) { event.preventDefault(); event.stopPropagation(); closeRef.current?.(); }
      if (isSide) return;
      if (event.key !== "Tab") return;
      const focusable = [...(dialogRef.current?.querySelectorAll(FOCUSABLE) || [])].filter((element) => element.getClientRects().length);
      if (!focusable.length) { event.preventDefault(); dialogRef.current?.focus(); }
      else if (event.shiftKey && document.activeElement === focusable[0]) { event.preventDefault(); focusable.at(-1).focus(); }
      else if (!event.shiftKey && document.activeElement === focusable.at(-1)) { event.preventDefault(); focusable[0].focus(); }
    };
    document.addEventListener("keydown", keyboard);
    return () => {
      if (!isSide) document.body.style.overflow = overflow;
      document.removeEventListener("keydown", keyboard);
    };
  }, [pageId, isSide]);
  useEffect(() => {
    if (!isSide) return;
    const handlePointerDown = (event) => {
      if (document.querySelector('[data-la-dialog="record-layout"]')) return;
      if (dialogRef.current && !dialogRef.current.contains(event.target)) {
        closeRef.current?.(false);
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [isSide]);
  useEffect(() => { if (!page || page.trashedAt || !item || !source) closeRef.current?.(); }, [page, item, source]);
  if (!page || page.trashedAt || !item || !source) return null;
  const peekContent = (
    <section ref={dialogRef} className={`ui-dialog record-peek ${isSide ? "is-side" : ""}`} role={isSide ? "region" : "dialog"} aria-modal={isSide ? undefined : "true"} aria-label={isSide ? t("dbx.peek.sideAria") : t("dbx.peek.centerAria")} tabIndex={-1}>
      <header className="record-peek-header"><span>{source.title} / {title}</span><button type="button" aria-label={t("dbx.peek.openFullPage")} onClick={() => { onOpenItemPage?.(pageId); onClose(false); }}><IconArrowUpRight size={15} />{t("dbx.peek.openFullPage")}</button><button type="button" className="ui-icon-button" aria-label={t("dbx.peek.closePreview")} onClick={() => onClose()}><IconX size={18} /></button></header>
      <div className="record-peek-body"><div className="record-peek-content"><input ref={titleRef} className="record-peek-title" aria-label={t("dbx.peek.recordTitleAria")} placeholder={t("dbx.untitled")} value={titleValue} readOnly={locked} onChange={(event) => runtime?.updateDatabaseItemValue?.(item.id, titleProperty.id, event.target.value)} onKeyDown={(event) => {
        if (event.key !== "Enter" || locked || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
        event.preventDefault(); event.stopPropagation(); editorApiRef.current?.focus();
      }} />
        <LifeAtlasEditorRuntimeContext.Provider value={recordRuntime}><RecordProperties page={page} runtime={recordRuntime} compact /><PageEditor pageId={pageId} initialContent={page.content} locked={locked} databaseRuntime={recordRuntime} onEditorApiChange={rememberEditorApi} onChange={(content) => { if (!locked) runtime?.updatePageContent?.(pageId, content); }} /></LifeAtlasEditorRuntimeContext.Provider>
      </div></div>
    </section>
  );
  if (isSide) return createPortal(peekContent, document.body);
  return createPortal(<div className="modal-backdrop record-peek-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    {peekContent}
  </div>, document.body);
}
