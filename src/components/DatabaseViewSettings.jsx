import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import IconArrowLeft from "@tabler/icons-react/dist/esm/icons/IconArrowLeft.mjs";
import IconArrowsSort from "@tabler/icons-react/dist/esm/icons/IconArrowsSort.mjs";
import IconChevronRight from "@tabler/icons-react/dist/esm/icons/IconChevronRight.mjs";
import IconColumns3 from "@tabler/icons-react/dist/esm/icons/IconColumns3.mjs";
import IconCopy from "@tabler/icons-react/dist/esm/icons/IconCopy.mjs";
import IconDatabase from "@tabler/icons-react/dist/esm/icons/IconDatabase.mjs";
import IconEye from "@tabler/icons-react/dist/esm/icons/IconEye.mjs";
import IconFileImport from "@tabler/icons-react/dist/esm/icons/IconFileImport.mjs";
import IconFilter from "@tabler/icons-react/dist/esm/icons/IconFilter.mjs";
import IconGripVertical from "@tabler/icons-react/dist/esm/icons/IconGripVertical.mjs";
import IconLayoutGrid from "@tabler/icons-react/dist/esm/icons/IconLayoutGrid.mjs";
import IconLink from "@tabler/icons-react/dist/esm/icons/IconLink.mjs";
import IconListDetails from "@tabler/icons-react/dist/esm/icons/IconListDetails.mjs";
import IconPlus from "@tabler/icons-react/dist/esm/icons/IconPlus.mjs";
import IconStack2 from "@tabler/icons-react/dist/esm/icons/IconStack2.mjs";
import IconX from "@tabler/icons-react/dist/esm/icons/IconX.mjs";
import { DATABASE_PROPERTY_TYPES, DATABASE_VIEW_TYPES } from "../domain/database.js";
import { PROPERTY_LABELS } from "../domain/databaseProperties.js";
import { formForView, formFields } from "../domain/viewProjections.js";
import { VIEW_REGISTRY, listVisiblePropertyIds } from "../domain/viewRegistry.js";
import { moveVisibleProperty } from "../domain/viewPropertyOrder.js";
import { ChartSettings, DashboardSettings, FormSettings, MapSettings } from "./DatabasePresentations.jsx";
import { DatabaseQuerySettings } from "./DatabaseQuerySettings.jsx";
import { BoardCardSettings, CalendarSettings, GallerySettings, TimelineSettings } from "./DatabaseWorkSurfaceSettings.jsx";
import { LayoutChoice } from "./GallerySettings.jsx";
import { RoadmapSettings } from "./RoadmapSettings.jsx";
import { DependencySettings, SubitemSettings } from "./DatabaseStructureControls.jsx";
import { useI18n } from "../i18n/workspaceRuntime.js";

// Database controls share this anchored popover. It stays outside editor clipping,
// while React context and events continue to belong to the database instance.
export function DatabasePopover({ anchor, label, className = "", onClose, children, overlap = false, inline = false }) {
  const panelRef = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const [position, setPosition] = useState({ left: 8, top: 8 });

  useLayoutEffect(() => {
    const place = () => {
      const bounds = anchor?.getBoundingClientRect();
      const panel = panelRef.current;
      if (!bounds || !panel) return;
      const width = panel.offsetWidth;
      const height = panel.offsetHeight;
      const left = Math.max(8, Math.min(bounds.left, window.innerWidth - width - 8));
      const top = overlap ? Math.max(8, Math.min(bounds.top, window.innerHeight - height - 8)) : window.innerHeight - bounds.bottom - 8 >= height
        ? bounds.bottom + 4
        : Math.max(8, Math.min(bounds.top - height - 4, window.innerHeight - height - 8));
      setPosition((current) => current.left === left && current.top === top ? current : { left, top });
    };
    // A local popover belongs to its database for focus and keyboard navigation.
    // The native top layer lets it escape the board's horizontal scrollport.
    const localPanel = panelRef.current;
    if (inline && localPanel?.showPopover && !localPanel.matches(":popover-open")) localPanel.showPopover();
    place();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(place);
    if (panelRef.current) observer?.observe(panelRef.current);
    window.addEventListener("resize", place);
    document.addEventListener("scroll", place, true);
    return () => { observer?.disconnect(); window.removeEventListener("resize", place); document.removeEventListener("scroll", place, true); };
  }, [anchor, overlap, inline]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const initial = panelRef.current?.querySelector("[data-popover-initial]") || panelRef.current?.querySelector("button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), summary");
      (initial || panelRef.current)?.focus();
    });
    const inOtherModal = (target) => {
      const modal = target.closest?.('[aria-modal="true"]');
      return modal && modal !== anchor?.closest?.('[aria-modal="true"]');
    };
    const outside = (event) => {
      if (panelRef.current?.contains(event.target) || anchor?.contains(event.target) || inOtherModal(event.target)) return;
      closeRef.current(false);
    };
    // If focus stayed in the editor, Escape must still close the popover before
    // the editor handles it. Events inside the panel are handled in bubble phase
    // so an open picker can consume Escape first.
    const escapeOutside = (event) => {
      if (event.key !== "Escape" || event.isComposing || event.keyCode === 229 || panelRef.current?.contains(event.target) || inOtherModal(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      closeRef.current(true);
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", escapeOutside, true);
    return () => { cancelAnimationFrame(frame); document.removeEventListener("pointerdown", outside, true); document.removeEventListener("keydown", escapeOutside, true); };
  }, [anchor]);

  const panel = <div ref={panelRef} popover={inline ? "manual" : undefined} className={`ui-popover db-v9-popover ${className}`} role="dialog" aria-label={label} tabIndex={-1} style={position} onKeyDown={(event) => {
    event.stopPropagation();
    if (event.key === "Escape" && !event.defaultPrevented && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) { event.preventDefault(); closeRef.current(true); }
    if (event.target.matches?.(".db-v9-menu-list > button") && ["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
      const buttons = [...event.target.parentElement.querySelectorAll(":scope > button:not([disabled])")];
      const index = buttons.indexOf(event.target);
      const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
      event.preventDefault();
      buttons[next]?.focus();
    }
  }}>{children}</div>;
  return inline ? panel : createPortal(panel, document.body);
}

const PANEL_TITLE_KEYS = {
  main: "db.ui.viewSettings",
  layout: "db.ui.layout",
  properties: "db.ui.showProps",
  filter: "db.ui.filter",
  sort: "db.ui.sort",
  group: "db.ui.group",
  subgroup: "db.ui.subgroup",
  source: "db.ui.sourceLabel",
  propertyTypes: "db.ui.addProp",
  subitems: "db.ui.subitems",
  dependencies: "db.ui.dependencies",
};
const propertyDragType = "application/x-life-atlas-view-property";
const reordersProperties = ["table", "board", "gallery", "list", "feed"];

function PropertyVisibility({ properties, visible, onToggle, onReorder, excludedId, locked, form }) {
  const { t } = useI18n();
  const checkboxPrefix = useId();
  const dragging = useRef(null);
  const gripRefs = useRef(new Map());
  const [target, setTarget] = useState(null);
  const byId = new Map(properties.map(property => [property.id, property]));
  const movable = onReorder ? [...new Set(visible.filter(id => byId.has(id) && id !== excludedId && byId.get(id).type !== "title"))] : [];
  const order = onReorder ? [...new Set([...properties.filter(property => property.type === "title").map(property => property.id),
    ...movable, ...properties.map(property => property.id)])] : properties.map(property => property.id);

  function move(id, targetId, restoreFocus = false) {
    if (locked || !onReorder) return;
    const next = moveVisibleProperty(visible, movable, id, targetId);
    if (next === visible) return;
    onReorder(next);
    if (restoreFocus) requestAnimationFrame(() => gripRefs.current.get(id)?.focus());
  }

  function endDrag() { dragging.current = null; setTarget(null); }

  return <div className="db-v9-property-list">{order.map(id => {
    const property = byId.get(id);
    const fixedTitle = !form && property.type === "title";
    const checked = (Boolean(onReorder) && fixedTitle) || visible.includes(id);
    const position = movable.indexOf(id);
    const eligible = !locked && position >= 0;
    const checkboxId = `${checkboxPrefix}-${id}`;
    const canDrop = event => eligible && dragging.current && dragging.current !== id && event.dataTransfer.types.includes(propertyDragType);
    const moveBy = offset => move(id, movable[position + offset], true);
    const propertyName = property.name + (fixedTitle && onReorder ? t("db.ui.alwaysShown") : id === excludedId ? t("db.ui.usedForGroup") : "");
    return <div className="db-v9-property-row" data-property-id={id} key={id}
      data-drop-edge={target === id ? movable.indexOf(dragging.current) < position ? "after" : "before" : undefined}
      onDragOver={event => {
        if (!canDrop(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setTarget(id);
      }}
      onDragLeave={event => {
        if (!event.currentTarget.contains(event.relatedTarget)) setTarget(current => current === id ? null : current);
      }}
      onDrop={event => {
        if (!canDrop(event)) return;
        event.preventDefault();
        move(dragging.current, id);
        endDrag();
      }}>
      <label htmlFor={checkboxId}>{propertyName}</label>
      {eligible && movable.length > 1 && <div className="db-v9-property-order">
        <button ref={node => { if (node) gripRefs.current.set(id, node); else gripRefs.current.delete(id); }}
          type="button" className="db-v9-panel-icon db-v9-property-grip" draggable aria-label={t("dbx.settings.dragOrderAria", { name: property.name })}
          title={t("dbx.settings.dragOrderTitle")}
          onDragStart={event => {
            dragging.current = id;
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData(propertyDragType, id);
          }}
          onDragEnd={endDrag}
          onKeyDown={event => {
            if (!["ArrowUp", "ArrowDown"].includes(event.key)) return;
            event.preventDefault();
            moveBy(event.key === "ArrowUp" ? -1 : 1);
          }}><IconGripVertical size={15} aria-hidden="true" /></button>
        <button type="button" className="db-v9-panel-icon" aria-label={t("dbx.layout.moveUp", { label: property.name })} disabled={position === 0} onClick={() => moveBy(-1)}>↑</button>
        <button type="button" className="db-v9-panel-icon" aria-label={t("dbx.layout.moveDown", { label: property.name })} disabled={position === movable.length - 1} onClick={() => moveBy(1)}>↓</button>
      </div>}
      <input id={checkboxId} type="checkbox" aria-label={t("dbx.settings.showPropAria", { name: property.name })} checked={checked}
        disabled={locked || fixedTitle} onChange={event => onToggle(id, event.target.checked)} />
    </div>;
  })}</div>;
}

export function DatabaseViewSettings({ section, onSection, onBack, workspace, source, view, config, runtime, viewIcons, onUpdateView, onCopyView, onSelectSource, onRenameSource, onAddPropertyType, onImportCsv, onTurnIntoPage, onTurnIntoInline, inline, onClose, allowBack = true, creation = false }) {
  const { t } = useI18n();
  const contentRef = useRef(null);
  const [propertyName, setPropertyName] = useState("");
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const panel = contentRef.current?.closest(".db-v9-popover");
      if (panel) panel.scrollTop = 0;
      contentRef.current?.querySelector("[data-panel-focus]")?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [section]);
  const updateConfig = (key, value) => onUpdateView?.(view.id, { config: { ...config, [key]: value } });
  const gallery = view.type === "gallery";
  const usesListVisibility = view.type === "list" || view.type === "feed";
  const form = view.type === "form" ? formForView(source, view, config.form) : null;
  const boardGrouping = view.type === "board" ? view.grouping || { primaryPropertyId: view.groupBy } : null;
  const boardGroupId = boardGrouping && (source.properties.find(property => property.id === boardGrouping.primaryPropertyId)
    || (!view.grouping && source.properties.find(property => property.type === "status" || property.type === "select")))?.id;
  const defaultVisible = view.type === "board"
    ? source.properties.filter(property => property.type !== "title" && property.id !== boardGroupId).slice(0, 3).map(property => property.id)
    : source.properties.map(property => property.id);
  const visible = form ? form.fields.filter(f => !f.hidden).map(f => f.propertyId) : gallery ? config.gallery.visiblePropertyIds : usesListVisibility ? listVisiblePropertyIds(source, view) : Array.isArray(view.visiblePropertyIds) ? view.visiblePropertyIds : defaultVisible;
  const saveForm = next => onUpdateView(view.id, { visiblePropertyIds: next.fields.filter(f => !f.hidden).map(f => f.propertyId), config: { ...config, form: next } });
  const sortableProperties = reordersProperties.includes(view.type);
  const saveVisible = visiblePropertyIds => {
    if (gallery) updateConfig("gallery", { ...config.gallery, visiblePropertyIds });
    else onUpdateView(view.id, { visiblePropertyIds });
  };
  const toggleVisibility = (id, checked) => {
    if (form) saveForm({ ...form, fields: form.fields.map(f => f.propertyId === id ? { ...f, hidden: !checked } : f) });
    else saveVisible(checked ? [...visible, id] : visible.filter(key => key !== id));
  };
  const visibleCount = sortableProperties ? source.properties.filter(property => property.type === "title" || (property.id !== boardGroupId && visible.includes(property.id))).length : visible.length;
  const entry = (target, label, Icon, value) => <button type="button" className="db-v9-menu-row" onClick={() => onSection(target)}><Icon size={15} aria-hidden="true" /><span>{label}</span>{value && <small>{value}</small>}<IconChevronRight size={14} aria-hidden="true" /></button>;
  const layoutGrid = <div className="db-v9-layout-grid" role="group" aria-label={t("dbx.settings.layoutGridAria")} onKeyDown={(event) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    const buttons = [...event.currentTarget.querySelectorAll("button[data-view-type]")];
    const current = buttons.indexOf(event.target);
    if (current < 0) return;
    const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -3, ArrowDown: 3 }[event.key];
    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : Math.max(0, Math.min(buttons.length - 1, current + delta));
    event.preventDefault(); event.stopPropagation();
    buttons[next]?.focus();
    if (buttons[next]?.dataset.viewType !== view.type) onUpdateView(view.id, { type: buttons[next].dataset.viewType });
  }}>{DATABASE_VIEW_TYPES.map((type) => {
    const Icon = viewIcons[type];
    const viewLabel = t(`db.view.${type}`) || VIEW_REGISTRY[type].label;
    return <button key={type} type="button" data-view-type={type} aria-label={t("dbx.settings.layoutBtnAria", { label: viewLabel })} aria-pressed={view.type === type} onClick={() => onUpdateView(view.id, { type })}>{Icon && <Icon size={16} aria-hidden="true" />}<span>{viewLabel}</span></button>;
  })}</div>;
  return <div ref={contentRef} className="db-v9-settings-content">
    <header className="db-v9-panel-header">
      {section !== "main" && allowBack && <button type="button" className="db-v9-panel-icon" aria-label={t("dbx.settings.backAria")} data-panel-focus data-popover-initial onClick={onBack}><IconArrowLeft size={15} aria-hidden="true" /></button>}
      <strong>{creation && section === "main" ? t("db.ui.newViewTitle") : t(PANEL_TITLE_KEYS[section] || "db.ui.viewSettings")}</strong>
      <button type="button" className="db-v9-panel-icon" aria-label={creation ? t("dbx.settings.closeNewViewAria") : allowBack ? t("dbx.settings.closeSettingsAria") : t("dbx.settings.closeSourceAria")} onClick={() => onClose(true)}><IconX size={15} aria-hidden="true" /></button>
    </header>
    {section === "main" && <>
      <label className="db-v9-view-name"><span className="db-v9-sr-only">{t("dbx.settings.viewName")}</span><input aria-label={t("dbx.settings.viewName")} placeholder={creation ? t("dbx.settings.viewName") : undefined} data-panel-focus={creation ? "" : undefined} data-popover-initial={creation ? "" : undefined} value={view.name ?? ""} onChange={(event) => onUpdateView(view.id, { name: event.target.value })} /></label>
      {creation && layoutGrid}
      <div className="db-v9-menu-list">
        <button type="button" className="db-v9-menu-row" data-panel-focus={creation ? undefined : ""} data-popover-initial={creation ? undefined : ""} onClick={() => onSection("layout")}><IconLayoutGrid size={15} aria-hidden="true" /><span>{t("db.ui.layout")}</span><small>{t(`db.view.${view.type}`) || VIEW_REGISTRY[view.type]?.label}</small><IconChevronRight size={14} aria-hidden="true" /></button>
        {entry("properties", t("db.ui.showProps"), IconEye, String(visibleCount))}
        {entry("filter", t("db.ui.filter"), IconFilter)}{entry("sort", t("db.ui.sort"), IconArrowsSort)}{entry("group", t("db.ui.group"), IconColumns3)}{entry("subgroup", t("db.ui.subgroup"), IconStack2)}
        {["table", "list", "board", "gallery", "calendar"].includes(view.type) && entry("subitems", t("db.ui.subitems"), IconListDetails)}
        {!creation && <button type="button" className="db-v9-menu-row" onClick={onCopyView}><IconCopy size={15} aria-hidden="true" /><span>{t("db.ui.copyView")}</span></button>}
      </div>
      <div className="db-v9-menu-divider" />
      <div className="db-v9-menu-caption">{t("db.ui.sourceLabel")}</div>
      {creation ? <div className="db-view-create-source">{source.title}</div> : <div className="db-v9-menu-list">
        {entry("source", t("db.ui.sourceLabel"), IconDatabase, source.title)}
        {runtime?.updateDependencyConfig && !runtime.locked && entry("dependencies", t("db.ui.dependencies"), IconLink)}
        {runtime?.openDatabaseHistory && <button type="button" className="db-v9-menu-row" onClick={() => { onClose?.(); runtime.openDatabaseHistory(source.id); }}><IconListDetails size={15} aria-hidden="true" /><span>{t("actions.databaseHistory")}</span></button>}
        {entry("propertyTypes", t("db.ui.addProp"), IconPlus)}
        {onImportCsv && <button type="button" className="db-v9-menu-row" onClick={onImportCsv}><IconFileImport size={15} aria-hidden="true" /><span>{t("import.csvTitle")}</span></button>}
        {inline && onTurnIntoPage && <button type="button" className="db-v9-menu-row" onClick={onTurnIntoPage}><IconListDetails size={15} aria-hidden="true" /><span>{t("db.ui.turnIntoPage")}</span></button>}
        {!inline && onTurnIntoInline && <button type="button" className="db-v9-menu-row" onClick={onTurnIntoInline}><IconListDetails size={15} aria-hidden="true" /><span>{t("db.ui.turnIntoInline")}</span></button>}
      </div>}
    </>}
    {section === "layout" && <div className="db-v9-panel-body">
      {layoutGrid}
      <LayoutChoice label={t("db.ui.openRecordsIn")} value={view.config?.openRecordsIn === "page" ? "page" : view.config?.openRecordsIn === "side" ? "side" : "peek"} choices={[{ value: "peek", label: t("db.ui.modePeek") }, { value: "side", label: t("db.ui.modeSide") }, { value: "page", label: t("db.ui.modePage") }]} onChange={(value) => onUpdateView(view.id, { config: { ...view.config, openRecordsIn: value } })} />
      {view.type === "board" && <><button type="button" className="db-v9-menu-row" onClick={() => onSection("group")}>{t("db.ui.group")}<IconChevronRight size={14} aria-hidden="true" /></button><button type="button" className="db-v9-menu-row" onClick={() => onSection("properties")}>{t("db.ui.cardProps")}<IconChevronRight size={14} aria-hidden="true" /></button><label className="db-v9-menu-row"><input aria-label={t("db.ui.colorColumns")} type="checkbox" checked={Boolean(view.config?.board?.colorColumns)} onChange={(event) => onUpdateView(view.id, { config: { ...view.config, board: { ...view.config?.board, colorColumns: event.target.checked } } })} /><span>{t("db.ui.colorColumns")}</span></label><label className="db-v9-menu-row"><input aria-label={t("db.ui.wrapCards")} type="checkbox" checked={Boolean(view.config?.board?.wrapAllContent)} onChange={(event) => onUpdateView(view.id, { config: { ...view.config, board: { ...view.config?.board, wrapAllContent: event.target.checked } } })} /><span>{t("db.ui.wrapCards")}</span></label></>}
      <label className="db-v9-menu-row"><input aria-label={t("db.ui.showSourceTitle")} type="checkbox" checked={view.config?.showDataSourceTitle !== false} onChange={(event) => onUpdateView(view.id, { config: { ...view.config, showDataSourceTitle: event.target.checked } })} /><span>{t("db.ui.showSourceTitle")}</span></label>
      <label className="db-v9-menu-row"><input aria-label={t("db.ui.showPageIcon")} type="checkbox" checked={view.config?.showPageIcon !== false} onChange={(event) => onUpdateView(view.id, { config: { ...view.config, showPageIcon: event.target.checked } })} /><span>{t("db.ui.showPageIcon")}</span></label>
      {view.type === "board" && <BoardCardSettings source={source} config={config.board} onChange={value => updateConfig("board", value)} />}
      {view.type === "chart" && <ChartSettings workspace={workspace} source={source} config={config.chart} onChange={(value) => updateConfig("chart", value)} />}
      {form && <FormSettings workspace={workspace} source={source} config={form} runtime={runtime} onChange={saveForm} />}
      {view.type === "dashboard" && <DashboardSettings workspace={workspace} source={source} config={config.dashboard} onChange={(value) => updateConfig("dashboard", value)} />}
      {view.type === "map" && <MapSettings workspace={workspace} source={source} config={config.map} onChange={(value) => updateConfig("map", value)} />}
      {view.type === "calendar" && <CalendarSettings workspace={workspace} source={source} config={config.calendar} onChange={(value) => updateConfig("calendar", value)} />}
      {view.type === "timeline" && <TimelineSettings workspace={workspace} source={source} config={config.timeline} onChange={(value) => updateConfig("timeline", value)} />}
      {view.type === "gallery" && <GallerySettings source={source} config={config.gallery} onChange={(value) => updateConfig("gallery", value)} onProperties={() => onSection("properties")} visibleCount={visibleCount} />}
      {view.type === "roadmap" && <RoadmapSettings source={source} config={config.roadmap} onChange={(value) => updateConfig("roadmap", value)} />}
    </div>}
    {section === "properties" && <PropertyVisibility key={view.id} properties={form ? formFields(source, form).map(f => f.property) : source.properties}
      visible={visible} onToggle={toggleVisibility} onReorder={sortableProperties ? saveVisible : null} excludedId={boardGroupId}
      locked={Boolean(runtime?.locked || !onUpdateView)} form={Boolean(form)} />}
    {section === "subitems" && <div className="db-v9-panel-body"><SubitemSettings view={view} onChange={(value) => updateConfig("subitems", value)} /></div>}
    {section === "dependencies" && <div className="db-v9-panel-body"><DependencySettings source={source} onChange={(value) => runtime?.updateDependencyConfig?.(source.id, value)} /></div>}
    {["filter", "sort", "group", "subgroup"].includes(section) && <div className="db-v9-panel-body"><DatabaseQuerySettings workspace={workspace} source={source} view={view} onUpdateView={onUpdateView} section={section} /></div>}
    {section === "source" && <div className="db-v9-menu-list"><div className="db-v9-menu-caption">{source.title}</div>{onRenameSource && <button type="button" className="db-v9-menu-row" onClick={onRenameSource}>{t("db.ui.renameSource")}</button>}{onSelectSource && (workspace.dataSources || []).filter((entry) => !entry.ownerPageId || workspace.pages?.some((page) => page.id === entry.ownerPageId && !page.trashedAt)).map((entry) => <button type="button" className="db-v9-menu-row" key={entry.id} aria-current={entry.id === source.id ? "true" : undefined} onClick={() => onSelectSource(entry.id)}>{entry.title}</button>)}</div>}
    {section === "propertyTypes" && <><label className="db-new-property-name"><span>{t("db.ui.propName")}</span><input aria-label={t("dbx.settings.newPropNameAria")} placeholder={t("db.ui.propName")} value={propertyName} onChange={(event) => setPropertyName(event.target.value)} /></label><div className="db-v9-menu-list" aria-label={t("dbx.settings.propTypesAria")}>{DATABASE_PROPERTY_TYPES.filter((type) => type !== "title").map((type) => <button type="button" className="db-v9-menu-row" key={type} onClick={() => onAddPropertyType(type, propertyName)}>{t(`db.prop.${type}`) || PROPERTY_LABELS[type] || type}</button>)}</div></>}
    {creation && <button type="button" className="db-view-create-done" onClick={() => { onUpdateView(view.id, { name: (view.name ?? "").trim() }); onClose(true); }}>{t("dbx.settings.done")}</button>}
  </div>;
}
