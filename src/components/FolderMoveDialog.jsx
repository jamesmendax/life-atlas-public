import { useMemo, useRef, useState } from "react";
import IconFolder from "@tabler/icons-react/dist/esm/icons/IconFolder.mjs";
import IconSearch from "@tabler/icons-react/dist/esm/icons/IconSearch.mjs";
import IconCheck from "@tabler/icons-react/dist/esm/icons/IconCheck.mjs";
import { Dialog } from "../ui/Dialog.jsx";
import { folderAncestors } from "../domain/navigation.js";
import { useI18n } from "../i18n/workspaceRuntime.js";

export function FolderMoveDialog({ workspace, folderId, onClose, onMove }) {
  const { t } = useI18n();
  const searchRef = useRef(null);
  const [query, setQuery] = useState("");
  const [target, setTarget] = useState(undefined);
  const [error, setError] = useState("");
  const folder = workspace.folders.find((entry) => entry.id === folderId);
  const choices = useMemo(() => {
    const blocked = new Set([folderId]);
    let changed = true;
    while (changed) { changed = false; for (const entry of workspace.folders) if (!blocked.has(entry.id) && blocked.has(entry.parentId)) { blocked.add(entry.id); changed = true; } }
    return [{ id: null, name: t("move.privateTop") }, ...workspace.folders.filter((entry) => !entry.trashedAt && !entry.system).map((entry) => ({ ...entry, name: `Private / ${folderAncestors(workspace.folders, entry.id).map((ancestor) => ancestor.name).join(" / ")}`, blocked: blocked.has(entry.id) }))].filter((entry) => entry.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  }, [workspace.folders, folderId, query, t]);
  return <Dialog title={t("move.folderTitle")} description={t("move.folderDesc", { name: folder?.name || t("move.folderDefaultName") })} onClose={onClose} initialFocusRef={searchRef} className="mb-folder-move-dialog">
    <div className="mb-dialog-body"><label className="mb-destination-search"><IconSearch size={16} /><input ref={searchRef} aria-label={t("inbox.archiveSearchAria")} placeholder={t("inbox.archiveSearchPlaceholder")} value={query} onChange={(event) => setQuery(event.target.value)} /></label><div className="mb-destination-list" role="listbox" aria-label={t("move.targetListAria")}>{choices.map((choice) => <button type="button" key={choice.id || "root"} role="option" aria-selected={target === choice.id} disabled={choice.blocked || choice.id === (folder?.parentId ?? null)} onClick={() => setTarget(choice.id)}><IconFolder size={16} /><span>{choice.name}</span>{target === choice.id && <IconCheck size={15} />}{choice.blocked ? <small>{t("move.cannotSelf")}</small> : choice.id === (folder?.parentId ?? null) && <small>{t("move.currentLocation")}</small>}</button>)}</div>{error && <p role="alert" className="mb-danger-text">{error}</p>}</div><footer className="mb-dialog-footer"><button type="button" className="mb-button" onClick={onClose}>{t("common.cancel")}</button><button type="button" className="mb-button mb-primary" disabled={target === undefined} onClick={() => { try { onMove(target); } catch (failure) { setError(failure.message); } }}>{t("move.folderAction")}</button></footer>
  </Dialog>;
}
