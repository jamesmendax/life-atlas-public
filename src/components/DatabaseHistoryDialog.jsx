import { useMemo, useState } from "react";
import { stableJson } from "../domain/blockDocument.js";
import { formatPropertyValue, PROPERTY_LABELS, READ_ONLY_PROPERTY_TYPES } from "../domain/databaseProperties.js";
import { previewDatabaseRestore } from "../domain/databaseHistory.js";
import { Dialog } from "../ui/Dialog.jsx";
import { useDialogs } from "../ui/DialogProvider.jsx";
import { useI18n } from "../i18n/workspaceRuntime.js";
import "./DatabaseHistoryDialog.css";

const VIEW_LABEL_KEYS = {
  name: "dbx.propCfg.nameLabel",
  type: "dbx.hist.view.type",
  filter: "db.ui.filter",
  sorts: "db.ui.sort",
  groupBy: "db.ui.group",
  grouping: "db.ui.group",
  visiblePropertyIds: "db.ui.showProps",
  config: "db.ui.layout",
};
const byId = (entries = []) => new Map(entries.map((entry) => [entry.id, entry]));

function timeLabel(value, locale, t) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString(locale, { hour12: false }) : t("dbx.hist.timeUnknown");
}

function displayValue(workspace, property, value, source, t) {
  if (value == null || value === "" || (Array.isArray(value) && !value.length)) return t("db.ui.emptyCell");
  return formatPropertyValue(workspace, property, value, { source }) || String(value);
}

function RecordDifference({ workspace, source, version, item }) {
  const { t } = useI18n();
  const live = workspace.databaseItems?.find((entry) => entry.id === item.id && entry.sourceId === source.id);
  const liveFields = byId(source.properties);
  const fields = (version.source?.properties || []).filter((entry) => entry.type === "unique_id" || !READ_ONLY_PROPERTY_TYPES.includes(entry.type));
  const changes = fields.filter((field) => stableJson(item.values?.[field.id]) !== stableJson(live?.values?.[field.id])
    || (Object.hasOwn(item.values || {}, field.id) && liveFields.get(field.id)?.type !== field.type));
  const parentChanged = (item.parentItemId ?? null) !== (live?.parentItemId ?? null);
  const dependenciesChanged = stableJson(item.dependencyIds || []) !== stableJson(live?.dependencyIds || []);
  return <>
    {!live && <p>{t("dbx.hist.missingRecord")}</p>}
    {changes.length > 0 && <table className="db-history-values">
      <thead><tr><th scope="col">{t("dbx.hist.colProp")}</th><th scope="col">{t("dbx.hist.colCurVal")}</th><th scope="col">{t("dbx.hist.colHistVal")}</th></tr></thead>
      <tbody>{changes.map((field) => <tr key={field.id}>
        <th scope="row">{field.name || field.id}</th>
        <td>{liveFields.has(field.id) ? displayValue(workspace, liveFields.get(field.id), live?.values?.[field.id], source, t) : t("dbx.hist.propDeleted")}</td>
        <td>{displayValue(workspace, field, item.values?.[field.id], version.source, t)}</td>
      </tr>)}</tbody>
    </table>}
    {parentChanged && <p>{t("dbx.hist.parentRestore", { from: live?.parentItemId || t("dbx.group.secondaryNone"), to: item.parentItemId || t("dbx.group.secondaryNone") })}</p>}
    {dependenciesChanged && <p>{t("dbx.hist.depsRestore", { deps: item.dependencyIds?.join(", ") || t("dbx.group.secondaryNone") })}</p>}
    {live && !changes.length && !parentChanged && !dependenciesChanged && <p>{t("dbx.hist.recordSame")}</p>}
  </>;
}

function RestoreImpact({ preview }) {
  const { t } = useI18n();
  const typeLabel = (type) => t(`db.prop.${type}`) || PROPERTY_LABELS[type] || type;
  if (!preview) return null;
  if (!preview.ok) return <p className="db-history-warning" role="status">{preview.reason}</p>;
  const { summary, changed } = preview;
  if (!changed) return <p>{t("dbx.hist.sameAsCurrent")}</p>;
  return <>
    <p>{t("dbx.hist.impactRows", { count: summary.rowsChanged })}{summary.rowsRestored > 0 && t("dbx.hist.rowsRestored", { count: summary.rowsRestored })}
      {summary.rowsToTrash > 0 && t("dbx.hist.rowsToTrash", { count: summary.rowsToTrash })}</p>
    {summary.pagesRestored > summary.rowsRestored && <p>{t("dbx.hist.pagesRestored", { count: summary.pagesRestored - summary.rowsRestored })}</p>}
    {summary.pagesToTrash > summary.rowsToTrash && <p>{t("dbx.hist.pagesToTrash", { count: summary.pagesToTrash - summary.rowsToTrash })}</p>}
    {!!summary.columns.length && <div>
      <h3>{t("dbx.hist.colStructure")}</h3>
      <ul>{summary.columns.map((column) => <li key={column.id}>{column.name || column.id}
        {" · "}{column.kind === "restored" ? t("dbx.hist.colRestore", { type: typeLabel(column.after) }) : column.kind === "removed" ? t("dbx.hist.colRemove", { type: typeLabel(column.before) }) : column.before === column.after ? t("dbx.hist.colRestoreCfg", { type: typeLabel(column.after) }) : `${typeLabel(column.before)} → ${typeLabel(column.after)}`}
      </li>)}</ul>
    </div>}
    {summary.columnOrderChanged && <p>{t("dbx.hist.colOrderRestored")}</p>}
    {!!summary.views.length && <div>
      <h3>{t("dbx.hist.ownViews")}</h3>
      <ul>{summary.views.map((view) => <li key={view.id}>{view.name || t("dbx.hist.untitledView")} · {view.kind === "restored" ? t("dbx.hist.viewRestored") : t("dbx.hist.viewCfgRestored")}
        {view.fields.length > 0 && ` (${[...new Set(view.fields.map((field) => t(VIEW_LABEL_KEYS[field] || field)))].join(", ")})`}
      </li>)}</ul>
    </div>}
    {summary.sourceChanged && <p>{t("dbx.hist.sourceSettingsRestored")}</p>}
    {summary.viewsPreserved > 0 && <p>{t("dbx.hist.viewsPreserved", { count: summary.viewsPreserved })}</p>}
  </>;
}

export function DatabaseHistoryDialog({ workspace, sourceId, onCapture, onRestore, onRestoreItem, onClose, restoreFocusRef, itemId: initialItemId }) {
  const { locale, t } = useI18n();
  const dialogs = useDialogs();
  const source = workspace.dataSources?.find((entry) => entry.id === sourceId);
  const versions = useMemo(() => [...(workspace.databaseVersions || [])].reverse()
    .filter((version) => version.sourceId === sourceId).sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt)), [workspace.databaseVersions, sourceId]);
  const [selection, setSelection] = useState({ versionId: null, itemId: initialItemId });
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState(null);
  const version = versions.find((entry) => entry.id === selection.versionId) || versions[0];
  const item = version?.items?.find((entry) => entry.id === selection.itemId);
  const titleField = version?.source?.properties?.find((entry) => entry.type === "title");
  const itemLabel = (record) => record.values?.[titleField?.id] || workspace.pages?.find((page) => page.id === record.pageId)?.title || t("dbx.hist.untitledRecord");
  const full = useMemo(() => version && previewDatabaseRestore(workspace, sourceId, version.id), [workspace, sourceId, version]);
  const single = useMemo(() => item && previewDatabaseRestore(workspace, sourceId, version.id, { itemId: item.id }), [workspace, sourceId, version, item]);
  const canFullRestore = full?.ok && full.changed;
  const canSingleRestore = single?.ok && single.changed;

  async function capture() {
    setPending(true);
    setMessage(null);
    try {
      await onCapture(sourceId);
      setSelection({ versionId: null, itemId: initialItemId });
      setMessage({ text: t("dbx.hist.saveCurrentOk") });
    } catch (failure) { setMessage({ error: true, text: failure.message || t("dbx.hist.saveVerErr") }); }
    finally { setPending(false); }
  }

  async function restore(record) {
    const preview = record ? single : full;
    if (pending || !preview?.ok || !preview.changed) return;
    const approved = await dialogs.confirm({
      title: record ? t("dbx.hist.restoreRecordTitle") : t("dbx.hist.restoreDbTitle"),
      description: record
        ? t("dbx.hist.restoreRecordDesc", { name: itemLabel(record) })
        : t("dbx.hist.restoreDbDesc", { extra: preview.summary.rowsToTrash ? t("dbx.hist.restoreDbTrashExtra", { count: preview.summary.rowsToTrash }) : "" }),
      confirmLabel: t("dbx.hist.confirmRestore"),
    });
    if (!approved) return;
    setPending(true);
    setMessage(null);
    try {
      if (record) await onRestoreItem(sourceId, version.id, record.id, preview.expectedSignature);
      else await onRestore(sourceId, version.id, preview.expectedSignature);
      setMessage({ text: record ? t("dbx.hist.restoredRecordMsg") : t("dbx.hist.restoredDbMsg") });
    } catch (failure) { setMessage({ error: true, text: failure.message || t("dbx.hist.restoreErr") }); }
    finally { setPending(false); }
  }

  return <Dialog title={t("actions.databaseHistory")} description={source?.title || t("app.msg.untitledDb")} onClose={onClose}
    className="db-history-dialog" busy={pending} dialogKind="database-history" restoreFocusRef={restoreFocusRef}>
    <div className="db-history-content">
      <aside className="db-history-versions" aria-label={t("dbx.hist.versionsAria")}>
        <button className="mb-button" type="button" onClick={capture} disabled={pending || !source || !onCapture}>{t("dbx.hist.saveCurrentVer")}</button>
        {versions.map((entry) => <button key={entry.id} type="button" aria-pressed={version.id === entry.id} disabled={pending}
          onClick={() => { setSelection({ versionId: entry.id, itemId: initialItemId }); setMessage(null); }}>
          <strong>{timeLabel(entry.createdAt, locale, t)}</strong>
          <span>{entry.reason && ["before-edit", "manual", "pre-restore"].includes(entry.reason) ? t(`dbx.hist.reason.${entry.reason}`) : entry.reason || t("dbx.hist.verFallback")}</span>
        </button>)}
      </aside>
      <div className="db-history-preview">
        {version ? <>
          <section aria-label={t("dbx.hist.impactAria")}>
            <h3>{t("dbx.hist.impactTitle")}</h3>
            <RestoreImpact preview={full} />
          </section>
          {source && version.items?.length > 0 && <section aria-label={t("dbx.hist.singleAria")}>
            <label className="db-history-record-label">
              <span>{t("dbx.hist.previewSingle")}</span>
              <select value={item?.id || ""} disabled={pending} onChange={(event) => setSelection({ versionId: version.id, itemId: event.target.value })}>
                <option value="">{t("dbx.hist.chooseRecord")}</option>
                {version.items.map((entry) => <option key={entry.id} value={entry.id}>{itemLabel(entry)}</option>)}
              </select>
            </label>
            {item && <RecordDifference workspace={workspace} source={source} version={version} item={item} />}
            {single && !single.ok && <p className="db-history-warning" role="status">{single.reason}</p>}
            {item && <button className="mb-button" type="button" disabled={pending || !canSingleRestore || !onRestoreItem} onClick={() => restore(item)}>{t("dbx.hist.restoreThisRecord")}</button>}
          </section>}
        </> : <p>{t("dbx.hist.emptyMsg")}</p>}
      </div>
    </div>
    <footer className="db-history-footer">
      {message && <p role={message.error ? "alert" : "status"} className={message.error ? "db-history-warning" : ""}>{message.text}</p>}
      <button type="button" className="mb-button" onClick={onClose} disabled={pending}>{t("common.close")}</button>
      <button type="button" className="mb-button mb-primary" onClick={() => restore(null)} disabled={pending || !canFullRestore || !onRestore}>{t("dbx.hist.restoreWholeDb")}</button>
    </footer>
  </Dialog>;
}

export default DatabaseHistoryDialog;
