import { useState } from "react";
import IconArrowLeft from "@tabler/icons-react/dist/esm/icons/IconArrowLeft.mjs";
import { VIEW_REGISTRY } from "../domain/viewRegistry.js";
import { isPageArchived } from "../domain/archive.js";
import { useI18n } from "../i18n/workspaceRuntime.js";
import "./databaseOccurrenceSources.css";

export function DatabaseOccurrenceSources({ workspace, sourceIds, activeSourceId, viewIds, onChoose, onLink, onRemove, onCreate, onRename, onBack, onClose }) {
  const { t } = useI18n();
  const [choice, setChoice] = useState("");
  const sources = workspace.dataSources || [];
  const isAvailable = source => !source.trashedAt && (!source.ownerPageId || workspace.pages?.some(page => page.id === source.ownerPageId && !page.trashedAt));
  const availableSources = sources.filter(source => isAvailable(source) && !isPageArchived(workspace, source.ownerPageId));
  const views = (workspace.databaseViews || []).filter(view => !view.trashedAt && view.sourceId === choice && !viewIds.includes(view.id));
  return <div className="db-occurrence-sources">
    <header className="db-v9-panel-header">{onBack && <button type="button" className="db-v9-panel-icon" aria-label={t("dbx.settings.backAria")} data-popover-initial onClick={onBack}><IconArrowLeft size={15} aria-hidden="true" /></button>}<strong>{t("db.ui.sourceLabel")}</strong><button type="button" className="db-v9-panel-icon" aria-label={t("dbx.settings.closeSourceAria")} onClick={() => onClose(true)}>×</button></header>
    <ul aria-label={t("dbx.sources.listAria")}>
      {sourceIds.map(id => sources.find(source => source.id === id)).filter(Boolean).map(source => {
        const firstView = (workspace.databaseViews || []).find(view => view.sourceId === source.id && viewIds.includes(view.id));
        const status = !isAvailable(source) ? t("dbx.sources.unavailable") : isPageArchived(workspace, source.ownerPageId) ? t("dbx.sources.archived") : "";
        return <li key={source.id}>
          <button type="button" className="db-v9-menu-row" disabled={!firstView} aria-current={activeSourceId === source.id ? "true" : undefined} onClick={() => onChoose(firstView.id)}>{source.title}{status}</button>
          {onRemove && source.id !== sourceIds[0] && <button type="button" className="db-v9-panel-icon" title={t("dbx.sources.removeRefTitle")} aria-label={t("dbx.sources.removeRefAria", { title: source.title })} onClick={() => onRemove(source.id)}>×</button>}
        </li>;
      })}
    </ul>
    {onRename && <button type="button" className="db-v9-menu-row" onClick={onRename}>{t("db.ui.renameSource")}</button>}
    {onCreate && <button type="button" className="db-v9-menu-row" onClick={onCreate}>{t("dbx.sources.createSource")}</button>}
    {onLink && <div className="db-occurrence-link">
      <label>{t("dbx.sources.linkExisting")}<select aria-label={t("dbx.sources.linkExisting")} value={choice} onChange={event => setChoice(event.target.value)}>
        <option value="">{t("dbx.sources.chooseSource")}</option>
        {availableSources.map(source => <option key={source.id} value={source.id}>{source.title}</option>)}
      </select></label>
      {choice && <label>{t("dbx.sources.linkView")}<select aria-label={t("dbx.sources.linkView")} value="" onChange={event => {
        const view = views.find(entry => entry.id === event.target.value);
        if (view) onLink(view);
      }}><option value="">{views.length ? t("dbx.sources.chooseSavedView") : t("dbx.sources.noSavedViews")}</option>
        {views.map(view => <option key={view.id} value={view.id}>{view.name || t(`db.view.${view.type}`) || VIEW_REGISTRY[view.type]?.label || t("db.ui.viewFallback")}</option>)}
      </select></label>}
    </div>}
  </div>;
}
