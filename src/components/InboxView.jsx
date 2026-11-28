import { useMemo, useRef, useState } from "react";
import IconCheck from "@tabler/icons-react/dist/esm/icons/IconCheck.mjs";
import IconFolder from "@tabler/icons-react/dist/esm/icons/IconFolder.mjs";
import IconInbox from "@tabler/icons-react/dist/esm/icons/IconInbox.mjs";
import IconSearch from "@tabler/icons-react/dist/esm/icons/IconSearch.mjs";
import { navigateChoiceGroup } from "../ui/keyboard.js";
import { Dialog } from "../ui/Dialog.jsx";
import { inboxPages } from "../domain/inbox.js";
import { folderAncestors } from "../domain/navigation.js";
import { formatDateTime } from "../domain/content.js";
import { useI18n } from "../i18n/workspaceRuntime.js";

export function ArchivePagesDialog({ workspace, pageIds, onClose, onArchive }) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [targetId, setTargetId] = useState("");
  const [error, setError] = useState("");
  const searchRef = useRef(null);
  const choices = workspace.folders.filter((folder) => !folder.system && !folder.trashedAt).map((folder) => ({ ...folder, path: folderAncestors(workspace.folders, folder.id).map((entry) => entry.name).join(" / ") })).filter((folder) => folder.path.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  return <Dialog title={t("inbox.archiveDialogTitle")} ariaLabel={t("inbox.archiveDialogTitle")} description={t("inbox.archiveDialogDesc", { count: pageIds.length })} onClose={onClose} initialFocusRef={searchRef} className="mb-folder-move-dialog">
    <div className="mb-dialog-body"><label className="mb-destination-search"><IconSearch size={16} /><input ref={searchRef} aria-label={t("inbox.archiveSearchAria")} placeholder={t("inbox.archiveSearchPlaceholder")} value={query} onChange={(event) => setQuery(event.target.value)} /></label><div className="mb-destination-list" role="listbox" aria-label={t("inbox.archiveListAria")}>{choices.map((folder) => <button key={folder.id} type="button" role="option" aria-selected={targetId === folder.id} onClick={() => setTargetId(folder.id)}><IconFolder size={16} /><span>{folder.path}</span>{targetId === folder.id && <IconCheck size={15} />}</button>)}</div>{error && <p role="alert" className="mb-danger-text">{error}</p>}</div>
    <footer className="mb-dialog-footer"><button type="button" className="mb-button" onClick={onClose}>{t("common.cancel")}</button><button type="button" className="mb-button mb-primary" disabled={!targetId} onClick={() => { try { onArchive(pageIds, targetId); } catch (failure) { setError(failure.message); } }}>{t("inbox.archiveAction")}</button></footer>
  </Dialog>;
}

export function InboxView({ workspace, onOpenPage, onArchive, onTrash, onReadReminder, onReadAll }) {
  const { t } = useI18n();
  const [tab, setTab] = useState("pending");
  const [selected, setSelected] = useState(new Set());
  const [archiveIds, setArchiveIds] = useState(null);
  const pages = useMemo(() => inboxPages(workspace), [workspace.pages, workspace.folders]);
  const selectedIds = pages.filter((page) => selected.has(page.id)).map((page) => page.id);
  const reminders = workspace.ui?.reminderLog || [];
  const unread = reminders.filter((entry) => !entry.readAt).length;
  return <article className="inbox-view" aria-label={t("inbox.title")}>
    <header className="inbox-heading"><IconInbox size={30} /><div><h1>{t("inbox.title")}</h1><p>{t("inbox.subtitle")}</p></div></header>
    <div className="inbox-tabs" role="tablist" aria-label={t("inbox.tabsAria")} onKeyDown={navigateChoiceGroup}><button type="button" role="tab" id="inbox-tab-pending" aria-controls="inbox-panel" tabIndex={tab === "pending" ? 0 : -1} aria-selected={tab === "pending"} onClick={() => setTab("pending")}>{t("inbox.tab.pending")} <span>{pages.length}</span></button><button type="button" role="tab" id="inbox-tab-reminders" aria-controls="inbox-panel" tabIndex={tab === "reminders" ? 0 : -1} aria-selected={tab === "reminders"} onClick={() => setTab("reminders")}>{t("inbox.tab.reminders")} {unread > 0 && <span>{unread}</span>}</button></div>
    {tab === "pending" ? <section role="tabpanel" id="inbox-panel" aria-labelledby="inbox-tab-pending">
      {selectedIds.length > 0 && <div className="inbox-batch"><span>{t("inbox.selectedCount", { count: selectedIds.length })}</span><button type="button" className="mb-button mb-primary" onClick={() => setArchiveIds(selectedIds)}>{t("inbox.archiveTo")}</button><button type="button" className="mb-button" onClick={() => setSelected(new Set())}>{t("inbox.clearSelection")}</button></div>}
      <div className="inbox-list">{pages.map((page) => <div key={page.id} data-inbox-page-id={page.id} className={`inbox-note-row${selected.has(page.id) ? " is-selected" : ""}`}><input type="checkbox" aria-label={t("inbox.selectRow", { title: page.title })} checked={selected.has(page.id)} onChange={(event) => setSelected((current) => { const next = new Set(current); if (event.target.checked) next.add(page.id); else next.delete(page.id); return next; })} /><button type="button" className="inbox-note-body" onClick={() => onOpenPage(page.id)}><strong>{page.title}</strong><span>{page.summary}</span></button><time>{formatDateTime(page.inboxedAt || page.createdAt)}</time><button type="button" className="inbox-row-action" aria-label={t("inbox.archiveRow", { title: page.title })} onClick={() => setArchiveIds([page.id])}>{t("inbox.archiveTo")}</button><button type="button" className="inbox-row-action" aria-label={t("inbox.deleteRow", { title: page.title })} onClick={() => onTrash(page.id)}>{t("inbox.moveToTrash")}</button></div>)}</div>
      {!pages.length && <p className="inbox-empty">{t("inbox.emptyPending")}</p>}
    </section> : <section role="tabpanel" id="inbox-panel" aria-labelledby="inbox-tab-reminders"><div className="inbox-reminder-actions"><button type="button" className="mb-button" disabled={!unread} onClick={onReadAll}>{t("inbox.markAllRead")}</button></div><div className="inbox-list">{reminders.map((entry) => <button type="button" key={entry.key} data-reminder-key={entry.key} className={`inbox-reminder-row${entry.readAt ? "" : " is-unread"}`} onClick={() => onReadReminder(entry)}><strong>{entry.title}</strong><span>{entry.source}</span><time>{formatDateTime(new Date(entry.fireAt).toISOString())}</time>{entry.missed && <small>{t("inbox.missedReminder")}</small>}</button>)}</div>{!reminders.length && <p className="inbox-empty">{t("inbox.emptyReminders")}</p>}</section>}
    {archiveIds && <ArchivePagesDialog workspace={workspace} pageIds={archiveIds} onClose={() => setArchiveIds(null)} onArchive={(ids, targetId) => { onArchive(ids, targetId); setArchiveIds(null); setSelected(new Set()); }} />}
  </article>;
}
