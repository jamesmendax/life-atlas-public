import IconRestore from "@tabler/icons-react/dist/esm/icons/IconRestore.mjs";
import IconTrash from "@tabler/icons-react/dist/esm/icons/IconTrash.mjs";
import IconTrashX from "@tabler/icons-react/dist/esm/icons/IconTrashX.mjs";
import IconFolder from "@tabler/icons-react/dist/esm/icons/IconFolder.mjs";
import { AppearanceGlyph } from "./AppearanceGlyph.jsx";
import { listTrashGroups } from "../domain/trash.js";
import { format, useI18n } from "../i18n/workspaceRuntime.js";

export function TrashView({ workspace, onRestore, onDeletePermanently, onEmptyTrash }) {
  const { locale, t } = useI18n();
  const groups = listTrashGroups(workspace, new Date().toISOString());
  return <div className="page-view trash-view">
    <header className="trash-header"><div><div className="trash-eyebrow"><IconTrash size={15} stroke={1.8} />{t("trash.eyebrow")}</div><h1>{t("trash.title")}</h1><p>{t("trash.subtitle")}</p></div><button type="button" className="trash-empty-button" disabled={!groups.length} onClick={onEmptyTrash}><IconTrashX size={15} />{t("trash.emptyButton")}</button></header>
    {groups.length ? <section className="trash-list" aria-label={t("trash.listAria")}>{groups.map((group) => {
      const page = group.kind === "page" ? workspace.pages.find((entry) => entry.id === group.id) : null;
      return <article className="trash-row" key={`${group.kind}:${group.id}`} data-trash-kind={group.kind} data-trash-id={group.id}><div className="trash-row-glyph">{group.kind === "folder" ? <IconFolder size={20} /> : <AppearanceGlyph icon={page?.icon} color={page?.iconColor} />}</div><div className="trash-row-copy"><strong>{group.name}</strong><span>{group.path}</span><small>{group.kind === "folder" ? t("trash.folderMeta", { folders: group.folderCount, pages: group.pageCount }) : t("trash.pageMeta", { pages: group.pageCount })}{t("trash.deletedOn", { date: format.formatDate(group.trashedAt, locale) })}{group.daysRemaining > 0 ? t("trash.daysRemaining", { days: group.daysRemaining }) : t("trash.deletingSoon")}</small></div><div className="trash-row-actions"><button type="button" className="trash-restore-button" onClick={() => onRestore({ kind: group.kind, id: group.id })}><IconRestore size={15} />{t("common.restore")}</button><button type="button" className="trash-delete-button" onClick={() => onDeletePermanently({ kind: group.kind, id: group.id })}><IconTrashX size={15} />{t("trash.deleteForever")}</button></div></article>;
    })}</section> : <div className="trash-empty-state"><IconTrash size={34} stroke={1.35} /><strong>{t("trash.emptyTitle")}</strong><p>{t("trash.emptyDesc")}</p></div>}
  </div>;
}
