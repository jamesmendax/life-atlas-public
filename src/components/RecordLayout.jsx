import { useId, useRef, useState } from "react";
import { newEntityId } from "../domain/blockDocument.js";
import { MAX_PINNED_RECORD_PROPERTIES, normalizeRecordLayout, resolveRecordLayoutView } from "../domain/recordLayout.js";
import { VIEW_REGISTRY } from "../domain/viewRegistry.js";
import { Dialog } from "../ui/Dialog.jsx";
import { useI18n } from "../i18n/workspaceRuntime.js";
import "./recordLayout.css";

function move(list, index, delta) {
  const next = [...list];
  [next[index], next[index + delta]] = [next[index + delta], next[index]];
  return next;
}

function OrderButtons({ label, index, length, onMove, onRemove }) {
  const { t } = useI18n();
  return <span className="db-record-order-actions">
    <button type="button" className="mb-button" aria-label={t("dbx.layout.moveUp", { label })} disabled={index === 0} onClick={() => onMove(-1)}>↑</button>
    <button type="button" className="mb-button" aria-label={t("dbx.layout.moveDown", { label })} disabled={index === length - 1} onClick={() => onMove(1)}>↓</button>
    <button type="button" className="mb-button" aria-label={t("dbx.layout.removeAria", { label })} onClick={onRemove}>{t("dbx.layout.remove")}</button>
  </span>;
}

function PropertyOrder({ ids, available, properties, label, onChange, limit = Infinity }) {
  const { t } = useI18n();
  return <div className="db-record-layout-group">
    {ids.map((id, index) => {
      const property = properties.get(id);
      if (!property) return null;
      return <div className="db-record-layout-order" key={id}><span>{property.name}</span><OrderButtons label={property.name} index={index} length={ids.length}
        onMove={delta => onChange(move(ids, index, delta))} onRemove={() => onChange(ids.filter(value => value !== id))} /></div>;
    })}
    {ids.length < limit && <label>{t("db.ui.addProp")}<select aria-label={t("dbx.layout.addPropTo", { label })} value="" disabled={!available.length} onChange={event => {
      if (event.target.value) onChange([...ids, event.target.value]);
    }}><option value="">{available.length ? t("dbx.layout.chooseProp") : t("dbx.layout.noMoreProps")}</option>
      {available.map(property => <option key={property.id} value={property.id}>{property.name}</option>)}</select></label>}
  </div>;
}

function RecordLayoutDialog({ source, workspace, layout, onSave, onClose, restoreFocusRef }) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(() => layout || normalizeRecordLayout({}, source));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const properties = new Map(source.properties.filter(property => property.type !== "title").map(property => [property.id, property]));
  const assigned = new Set([...draft.pinnedPropertyIds, ...draft.sections.flatMap(section => section.propertyIds)]);
  const available = [...properties.values()].filter(property => !assigned.has(property.id));
  const updateSection = (id, patch) => setDraft(current => ({ ...current, sections: current.sections.map(section => section.id === id ? { ...section, ...patch } : section) }));
  const set = (field, value) => setDraft(current => ({ ...current, [field]: value }));
  const seenViews = new Set(draft.views.map(entry => entry.viewId));
  const availableViews = (workspace.databaseViews || []).flatMap(view => {
    const link = !seenViews.has(view.id) && resolveRecordLayoutView(workspace, { sourceId: view.sourceId, viewId: view.id });
    return link && !link.archived ? [link] : [];
  });
  const save = async value => {
    setBusy(true);
    setError("");
    try {
      const result = await onSave(value);
      if (result === false || result?.ok === false) throw new Error(result?.message || t("dbx.layout.saveError"));
      onClose();
    } catch (failure) {
      setError(failure.message || t("dbx.layout.saveError"));
    } finally { setBusy(false); }
  };
  return <Dialog title={t("dbx.layout.title")} ariaLabel={t("dbx.layout.title")} description={source.title} onClose={onClose} busy={busy} restoreFocusRef={restoreFocusRef} className="db-record-layout-dialog" dialogKind="record-layout">
    <div className="db-record-layout-editor">
      <label>{t("dbx.layout.displayMode")}<select aria-label={t("dbx.layout.displayModeAria")} value={draft.mode} onChange={event => set("mode", event.target.value)}>
        <option value="simple">{t("dbx.layout.modeSimple")}</option><option value="tabs">{t("dbx.layout.modeTabs")}</option>
      </select></label>
      <fieldset><legend>{t("dbx.layout.pinnedLegend", { count: draft.pinnedPropertyIds.length, max: MAX_PINNED_RECORD_PROPERTIES })}</legend>
        <PropertyOrder label={t("dbx.layout.pinnedLabel")} ids={draft.pinnedPropertyIds} available={available} properties={properties}
          limit={MAX_PINNED_RECORD_PROPERTIES} onChange={value => set("pinnedPropertyIds", value)} />
      </fieldset>
      {draft.sections.map((section, index) => <fieldset key={section.id}>
        <legend>{t("dbx.layout.sectionLegend")}</legend>
        <div className="db-record-layout-order"><input aria-label={t("dbx.layout.sectionNameAria", { index: index + 1 })} value={section.name} onChange={event => updateSection(section.id, { name: event.target.value })} />
          <OrderButtons label={section.name || t("dbx.layout.sectionFallback", { index: index + 1 })} index={index} length={draft.sections.length}
            onMove={delta => set("sections", move(draft.sections, index, delta))} onRemove={() => set("sections", draft.sections.filter(entry => entry.id !== section.id))} />
        </div>
        <PropertyOrder label={section.name || t("dbx.layout.sectionFallback", { index: index + 1 })} ids={section.propertyIds} available={available} properties={properties} onChange={propertyIds => updateSection(section.id, { propertyIds })} />
      </fieldset>)}
      <button type="button" className="mb-button" onClick={() => set("sections", [...draft.sections, { id: newEntityId("record-section"), name: t("dbx.layout.newSectionDefault"), propertyIds: [] }])}>{t("dbx.layout.addSection")}</button>
      <fieldset><legend>{t("dbx.layout.linkedViews")}</legend>
        {draft.views.map((module, index) => {
          const link = resolveRecordLayoutView(workspace, module);
          return <div className="db-record-layout-order" key={module.id}><label>{link?.source.title || t("dbx.layout.viewUnavailable")}<input aria-label={t("dbx.layout.viewTabNameAria", { index: index + 1 })} value={module.name}
            onChange={event => set("views", draft.views.map(entry => entry.id === module.id ? { ...entry, name: event.target.value } : entry))} /></label>
            <OrderButtons label={module.name || t("dbx.layout.viewTabFallback", { index: index + 1 })} index={index} length={draft.views.length}
              onMove={delta => set("views", move(draft.views, index, delta))} onRemove={() => set("views", draft.views.filter(entry => entry.id !== module.id))} /></div>;
        })}
        <label>{t("dbx.layout.addSavedView")}<select aria-label={t("dbx.layout.addSavedView")} value="" onChange={event => {
          const link = availableViews.find(entry => entry.view.id === event.target.value);
          if (link) set("views", [...draft.views, { id: newEntityId("record-view"), name: link.view.name || t(`db.view.${link.view.type}`) || VIEW_REGISTRY[link.view.type]?.label || t("dbx.layout.linkedViewDefault"), sourceId: link.source.id, viewId: link.view.id }]);
        }}><option value="">{t("dbx.layout.chooseView")}</option>
          {availableViews.map(({ source: linked, view }) => <option key={view.id} value={view.id}>{linked.title} · {view.name || t(`db.view.${view.type}`) || VIEW_REGISTRY[view.type]?.label}</option>)}
        </select></label>
      </fieldset>
      {error && <p role="alert">{error}</p>}
    </div>
    <footer className="mb-dialog-footer">{layout && <button type="button" className="mb-button" disabled={busy} onClick={() => save(null)}>{t("dbx.layout.resetDefault")}</button>}
      <button type="button" className="mb-button" disabled={busy} onClick={onClose}>{t("common.cancel")}</button>
      <button type="button" className="mb-button mb-primary" disabled={busy} onClick={() => save(normalizeRecordLayout(draft, source))}>{t("dbx.layout.saveToDb")}</button>
    </footer>
  </Dialog>;
}

export function RecordLayout({ workspace, source, runtime, properties, renderProperty, canEdit }) {
  const { t } = useI18n();
  const layout = normalizeRecordLayout(source.recordLayout, source);
  const [editing, setEditing] = useState(false);
  const [selectedKey, setSelectedKey] = useState(null);
  const editButton = useRef(null);
  const baseId = useId();
  const propertyById = new Map(properties.map(property => [property.id, property]));
  const renderProperties = ids => ids.map(id => propertyById.get(id)).filter(Boolean).map(renderProperty);
  const assigned = new Set(layout ? [...layout.pinnedPropertyIds, ...layout.sections.flatMap(section => section.propertyIds)] : []);
  const unassigned = properties.filter(property => !assigned.has(property.id));
  const entries = layout && [
    ...(unassigned.length ? [{ key: "properties", name: t("dbx.layout.otherProps"), render: () => unassigned.map(renderProperty) }] : []),
    ...layout.sections.map(section => ({ key: `section-${section.id}`, name: section.name, render: () => renderProperties(section.propertyIds) })),
    ...layout.views.map(module => ({ key: `view-${module.id}`, name: module.name, render: () => {
      const link = resolveRecordLayoutView(workspace, module);
      return link && !link.archived && runtime?.renderRecordLayoutView ? runtime.renderRecordLayoutView(module) : <p className="db-record-layout-unavailable">{link?.archived ? t("dbx.layout.sourceArchived") : t("dbx.layout.linkBroken")}</p>;
    } })),
  ];
  const activeIndex = entries ? Math.max(0, entries.findIndex(entry => entry.key === selectedKey)) : 0;
  return <>
    {canEdit && <div className="db-record-layout-actions"><button ref={editButton} type="button" className="mb-button" onClick={() => setEditing(true)}>{t("dbx.layout.customize")}</button></div>}
    {!layout ? properties.map(renderProperty) : <>
      {layout.pinnedPropertyIds.length > 0 && <div className="db-record-layout-pinned" aria-label={t("dbx.layout.pinnedLabel")}>{renderProperties(layout.pinnedPropertyIds)}</div>}
      {layout.mode === "tabs" && entries.length > 0 ? <>
        <div className="db-record-layout-tabs" role="tablist" aria-label={t("dbx.layout.tabsAria")} onKeyDown={event => {
          if (event.target.getAttribute("role") !== "tab" || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const next = event.key === "Home" ? 0 : event.key === "End" ? entries.length - 1 : (activeIndex + (event.key === "ArrowRight" ? 1 : -1) + entries.length) % entries.length;
          setSelectedKey(entries[next].key);
          event.currentTarget.querySelectorAll('[role="tab"]')[next]?.focus();
        }}>{entries.map((entry, index) => <button type="button" role="tab" key={entry.key} id={`${baseId}-tab-${index}`} aria-controls={`${baseId}-panel`} aria-selected={index === activeIndex} tabIndex={index === activeIndex ? 0 : -1} onClick={() => setSelectedKey(entry.key)}>{entry.name}</button>)}</div>
        <div className="db-record-layout-panel" role="tabpanel" id={`${baseId}-panel`} aria-labelledby={`${baseId}-tab-${activeIndex}`} key={entries[activeIndex].key}>{entries[activeIndex].render()}</div>
      </> : entries.map(entry => <section className="db-record-layout-panel" key={entry.key} aria-label={entry.name}><h3>{entry.name}</h3>{entry.render()}</section>)}
    </>}
    {editing && canEdit && <RecordLayoutDialog source={source} workspace={workspace} layout={layout} onSave={value => runtime.updateDataSourceLayout(source.id, value)}
      onClose={() => setEditing(false)} restoreFocusRef={editButton} />}
  </>;
}
