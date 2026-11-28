import { useEffect, useId, useMemo, useRef, useState } from "react";
import { walkBlocks } from "../domain/blockDocument.js";
import { discussionAnchorState, pageDiscussions } from "../domain/comments.js";
import { isComposingKeyboardEvent } from "../ui/keyboard.js";
import { useI18n } from "../i18n/workspaceRuntime.js";

function TemplatePanel({ page, runtime }) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [selected, setSelected] = useState("");
  const [dbName, setDbName] = useState("");
  const [dbSelected, setDbSelected] = useState("");
  const workspace = runtime.workspace;
  const item = (workspace.databaseItems || []).find((entry) => entry.pageId === page.id);
  const pageTemplates = workspace.pageTemplates || [];
  const dbTemplates = (workspace.databaseTemplates || []).filter((entry) => item && entry.sourceId === item.sourceId);

  return <div className="page-workspace-panel-body" data-tool-panel="templates">
    <div className="workspace-tool-section">
      <div className="workspace-tool-heading"><strong>{t("tools.pageTplTitle")}</strong><small>{t("tools.pageTplHint")}</small></div>
      <div className="workspace-tool-form">
        <input aria-label={t("tools.pageTplNameAria")} value={name} placeholder={page.title || t("tools.pageTplTitle")} onChange={(event) => setName(event.target.value)} />
        <button type="button" onClick={() => { const created = runtime.saveCurrentPageTemplate?.(page.id, name || page.title); if (created) { setSelected(created.id); setName(""); } }}>{t("tools.saveAsTpl")}</button>
      </div>
      <div className="workspace-tool-form">
        <select aria-label={t("tools.selectPageTplAria")} value={selected} onChange={(event) => setSelected(event.target.value)}><option value="">{t("tools.chooseTpl")}</option>{pageTemplates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select>
        <button type="button" disabled={!selected} onClick={() => runtime.createPageFromTemplate?.(selected, page.folderId)}>{t("tools.newFromTpl")}</button>
        <button type="button" disabled={!selected} className="quiet-danger" onClick={() => { runtime.deletePageTemplate?.(selected); setSelected(""); }}>{t("common.delete")}</button>
      </div>
    </div>
    {item && <div className="workspace-tool-section">
      <div className="workspace-tool-heading"><strong>{t("tools.dbTplTitle")}</strong><small>{t("tools.dbTplHint")}</small></div>
      <div className="workspace-tool-form">
        <input aria-label={t("tools.dbTplNameAria")} value={dbName} placeholder={t("tools.dbTplPh")} onChange={(event) => setDbName(event.target.value)} />
        <button type="button" onClick={() => { const created = runtime.saveDatabaseTemplateFromPage?.(page.id, dbName || t("tools.dbTplDefaultName", { title: page.title || t("tools.recordDefault") })); if (created) { setDbSelected(created.id); setDbName(""); } }}>{t("tools.saveDbTpl")}</button>
      </div>
      <div className="workspace-tool-form">
        <select aria-label={t("tools.selectDbTplAria")} value={dbSelected} onChange={(event) => setDbSelected(event.target.value)}><option value="">{t("tools.chooseDbTpl")}</option>{dbTemplates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select>
        <button type="button" disabled={!dbSelected} onClick={() => runtime.createDatabaseItem?.(item.sourceId, { templateId:dbSelected })}>{t("tools.newRecFromTpl")}</button>
        <button type="button" disabled={!dbSelected} className="quiet-danger" onClick={() => { runtime.deleteDatabaseTemplate?.(dbSelected); setDbSelected(""); }}>{t("common.delete")}</button>
      </div>
    </div>}
  </div>;
}

function CommentsPanel({ page, runtime }) {
  const { t } = useI18n();
  const workspace = runtime.workspace;
  const blocks = useMemo(() => walkBlocks(page.content || []).filter((block) => block.id), [page.content]);
  const [anchorKind, setAnchorKind] = useState("page");
  const [blockId, setBlockId] = useState(blocks[0]?.id || "");
  const [body, setBody] = useState("");
  const [reply, setReply] = useState({});
  const [unresolvedOnly, setUnresolvedOnly] = useState(false);
  const threads = pageDiscussions(workspace, page.id, { unresolvedOnly });

  return <div className="page-workspace-panel-body" data-tool-panel="comments">
    <div className="workspace-tool-section">
      <div className="workspace-tool-heading"><strong>{t("tools.commentsTitle")}</strong><small>{t("tools.commentsHint")}</small></div>
      <div className="workspace-tool-form">
        <select aria-label={t("tools.anchorAria")} value={anchorKind} onChange={(event) => setAnchorKind(event.target.value)}><option value="page">{t("tools.anchorPage")}</option><option value="block">{t("tools.anchorBlock")}</option></select>
        {anchorKind === "block" && <select aria-label={t("tools.blockAria")} value={blockId} onChange={(event) => setBlockId(event.target.value)}>{blocks.map((block) => <option key={block.id} value={block.id}>{block.type} · {block.id}</option>)}</select>}
      </div>
      <textarea aria-label={t("tools.newCommentAria")} value={body} placeholder={t("tools.newCommentPh")} onChange={(event) => setBody(event.target.value)} />
      <div className="workspace-tool-form"><button type="button" disabled={!body.trim() || (anchorKind === "block" && !blockId)} onClick={() => {
        runtime.addDiscussion?.(page.id, anchorKind === "block" ? { kind:"block", blockId } : { kind:"page" }, body);
        setBody("");
      }}>{t("tools.addDiscussion")}</button><label className="workspace-inline-check"><input aria-label={t("tools.unresolvedOnlyAria")} type="checkbox" checked={unresolvedOnly} onChange={(event) => setUnresolvedOnly(event.target.checked)} />{t("tools.unresolvedOnly")}</label></div>
    </div>
    <div className="workspace-thread-list">{threads.length ? threads.map((thread) => {
      const state = discussionAnchorState(thread, page);
      return <article className={`workspace-thread ${thread.resolvedAt ? "is-resolved" : ""}`} key={thread.id} data-discussion-id={thread.id}>
        <header><span>{thread.anchor?.kind === "page" ? t("tools.anchorPage") : t("tools.blockPrefix", { id: thread.anchor?.blockId })}</span><small>{state === "orphaned" ? t("tools.orphaned") : thread.resolvedAt ? t("tools.resolved") : t("tools.open")}</small></header>
        <div className="workspace-thread-comments">{thread.comments.map((comment) => <p key={comment.id}>{comment.body}</p>)}</div>
        <div className="workspace-tool-form"><input aria-label={t("tools.replyAria", { id: thread.id })} value={reply[thread.id] || ""} placeholder={t("tools.replyPh")} onChange={(event) => setReply((current) => ({ ...current, [thread.id]:event.target.value }))} /><button type="button" disabled={!(reply[thread.id] || "").trim()} onClick={() => { runtime.replyDiscussion?.(thread.id, reply[thread.id]); setReply((current) => ({ ...current, [thread.id]:"" })); }}>{t("tools.replyBtn")}</button><button type="button" onClick={() => runtime.resolveDiscussion?.(thread.id, !thread.resolvedAt)}>{thread.resolvedAt ? t("tools.reopen") : t("tools.resolve")}</button></div>
      </article>;
    }) : <p className="workspace-tool-empty">{t("tools.noDiscussions")}</p>}</div>
  </div>;
}

function AttachmentPanel({ page, runtime }) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const workspace = runtime.workspace;
  const item = (workspace.databaseItems || []).find((entry) => entry.pageId === page.id);
  const source = item ? (workspace.dataSources || []).find((entry) => entry.id === item.sourceId) : null;
  const fileIds = item && source ? source.properties.filter((property) => property.type === "files").flatMap((property) => Array.isArray(item.values?.[property.id]) ? item.values[property.id] : []) : [];
  const files = (workspace.attachments || []).filter((attachment) => !item || fileIds.includes(attachment.id));

  return <div className="page-workspace-panel-body" data-tool-panel="attachments">
    <div className="workspace-tool-section">
      <div className="workspace-tool-heading"><strong>{t("tools.attachMetaTitle")}</strong><small>{t("tools.attachMetaHint")}</small></div>
      <div className="workspace-tool-form"><input aria-label={t("tools.attachNameAria")} value={name} placeholder={t("tools.attachNamePh")} onChange={(event) => setName(event.target.value)} /><input aria-label={t("tools.attachUrlAria")} value={url} placeholder="https://…" onChange={(event) => setUrl(event.target.value)} /><button type="button" disabled={!name.trim() || !url.trim()} onClick={() => { runtime.attachExternalToPage?.(page.id, { name, externalUrl:url }); setName(""); setUrl(""); }}>{t("tools.addAttachBtn")}</button></div>
      {!item && <p className="workspace-tool-note">{t("tools.nonDbAttachNote")}</p>}
    </div>
    <div className="workspace-attachment-list">{files.map((file) => <a key={file.id} href={file.externalUrl || undefined} target="_blank" rel="noreferrer"><strong>{file.name}</strong><small>{file.mime || t("tools.fileFallback")} · {file.provider}</small></a>)}</div>
  </div>;
}

function WorkspaceTools({ page, runtime }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("comments");
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const panelId = useId();
  useEffect(() => {
    if (!open) return undefined;
    const outside = (event) => { if (!rootRef.current?.contains(event.target)) setOpen(false); };
    document.addEventListener("pointerdown", outside, true);
    return () => document.removeEventListener("pointerdown", outside, true);
  }, [open]);
  const unresolved = (runtime.workspace.discussions || []).filter((entry) => entry.pageId === page.id && !entry.resolvedAt).length;
  return <div ref={rootRef} className="page-workspace-tools" onKeyDown={(event) => {
    if (open && event.key === "Escape" && !isComposingKeyboardEvent(event)) {
      event.preventDefault(); event.stopPropagation(); setOpen(false); triggerRef.current?.focus({ preventScroll: true });
    }
  }}>
    <button type="button" ref={triggerRef} className="page-workspace-trigger" aria-label={t("tools.trigger")} aria-expanded={open} aria-controls={open ? panelId : undefined} onClick={() => setOpen((value) => !value)}>{t("tools.trigger")}{unresolved ? <span>{unresolved}</span> : null}</button>
    {open && <aside id={panelId} className="page-workspace-panel" aria-label={t("tools.panelAria")}>
      <nav><button type="button" className={tab === "comments" ? "is-active" : ""} onClick={() => setTab("comments")}>{t("tools.tab.comments")}</button><button type="button" className={tab === "templates" ? "is-active" : ""} onClick={() => setTab("templates")}>{t("tools.tab.templates")}</button><button type="button" className={tab === "attachments" ? "is-active" : ""} onClick={() => setTab("attachments")}>{t("tools.tab.attachments")}</button></nav>
      {tab === "comments" && <CommentsPanel page={page} runtime={runtime} />}
      {tab === "templates" && <TemplatePanel page={page} runtime={runtime} />}
      {tab === "attachments" && <AttachmentPanel page={page} runtime={runtime} />}
    </aside>}
  </div>;
}

export function PageWorkspaceTools({ page, runtime }) {
  return runtime?.workspace ? <WorkspaceTools key={page.id} page={page} runtime={runtime} /> : null;
}
