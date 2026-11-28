import { useEffect, useMemo, useRef, useState } from "react";
import IconArrowsSort from "@tabler/icons-react/dist/esm/icons/IconArrowsSort.mjs";
import IconArrowUpRight from "@tabler/icons-react/dist/esm/icons/IconArrowUpRight.mjs";
import IconCalendar from "@tabler/icons-react/dist/esm/icons/IconCalendar.mjs";
import IconChartBar from "@tabler/icons-react/dist/esm/icons/IconChartBar.mjs";
import IconChevronDown from "@tabler/icons-react/dist/esm/icons/IconChevronDown.mjs";
import IconDatabase from "@tabler/icons-react/dist/esm/icons/IconDatabase.mjs";
import IconFilter from "@tabler/icons-react/dist/esm/icons/IconFilter.mjs";
import IconForms from "@tabler/icons-react/dist/esm/icons/IconForms.mjs";
import IconLayoutBoard from "@tabler/icons-react/dist/esm/icons/IconLayoutBoard.mjs";
import IconLayoutGrid from "@tabler/icons-react/dist/esm/icons/IconLayoutGrid.mjs";
import IconLayoutDashboard from "@tabler/icons-react/dist/esm/icons/IconLayoutDashboard.mjs";
import IconList from "@tabler/icons-react/dist/esm/icons/IconList.mjs";
import IconMap from "@tabler/icons-react/dist/esm/icons/IconMap.mjs";
import IconNews from "@tabler/icons-react/dist/esm/icons/IconNews.mjs";
import { DatabaseFeed } from "./DatabaseFeed.jsx";
import IconPlus from "@tabler/icons-react/dist/esm/icons/IconPlus.mjs";
import IconSearch from "@tabler/icons-react/dist/esm/icons/IconSearch.mjs";
import IconSettings2 from "@tabler/icons-react/dist/esm/icons/IconSettings2.mjs";
import IconTable from "@tabler/icons-react/dist/esm/icons/IconTable.mjs";
import IconTimeline from "@tabler/icons-react/dist/esm/icons/IconTimeline.mjs";
import IconTimelineEvent from "@tabler/icons-react/dist/esm/icons/IconTimelineEvent.mjs";
import { DATABASE_VIEW_TYPES, dataSourceById, databaseViewById, defaultDatabaseProperties, projectViewItems, searchViewItems } from "../domain/database.js";
import { VIEW_REGISTRY, normalizeViewConfig } from "../domain/viewRegistry.js";
import { LifeAtlasEditorRuntimeContext } from "../editor/EditorRuntime.jsx";
import { PropertyConfigDialog } from "./PropertyEditor.jsx";
import { DatabaseStatusPropertyOptions } from "./DatabasePropertyOptions.jsx";
import { StatusActionSettings } from "./StatusActionSettings.jsx";
import { DatabasePropertyConfig } from "./DatabasePropertyConfig.jsx";
import { DatabaseTable } from "./DatabaseTable.jsx";
import { DashboardSavedView } from "./DatabaseDashboard.jsx";
import { ChartView, DatabaseDashboard, DatabaseForm, DatabaseMap } from "./DatabasePresentations.jsx";
import { DatabaseBoard, DatabaseCalendar, DatabaseCalendarUnscheduled, DatabaseGallery, DatabaseList, DatabaseTimeline } from "./DatabaseBasicViews.jsx";
import { DatabasePopover, DatabaseViewSettings } from "./DatabaseViewSettings.jsx";
import { DatabaseViewTabs } from "./DatabaseViewTabs.jsx";
import { DatabaseOccurrenceSources } from "./DatabaseOccurrenceSources.jsx";
import "./databaseParity.css";
import { useDialogs } from "../ui/DialogProvider.jsx";
import { DatabaseRoadmap } from "./DatabaseRoadmap.jsx";
import { RecordPeek } from "./RecordPeek.jsx";
import { CsvImportDialog } from "./CsvImportDialog.jsx";
import { resolveDatabaseOccurrenceSources, resolveDatabaseOccurrenceViews, serializeDatabaseOccurrenceSourceIds, serializeDatabaseOccurrenceViewIds } from "../domain/databaseOccurrenceViews.js";
import { filterUsesRelativeDate } from "../domain/databaseFilters.js";
import { isPageArchived } from "../domain/archive.js";
import { useFilterDay } from "./useFilterDay.js";
import { useI18n } from "../i18n/workspaceRuntime.js";

const VIEW_ICONS = { table: IconTable, board: IconLayoutBoard, list: IconList, gallery: IconLayoutGrid, calendar: IconCalendar, timeline: IconTimeline, chart: IconChartBar, form: IconForms, dashboard: IconLayoutDashboard, map: IconMap, roadmap: IconTimelineEvent, feed: IconNews };

export function DatabaseView({ workspace, sourceId, sourceIdsJson, viewId, viewIdsJson, embeddedItems, inline = false, readOnlyReference = false, containerPageId, onUpdateView, onUpdateItemValue, onCreateItem, onOpenItemPage, onCreateView, onAddProperty, onTurnIntoPage, onTurnIntoInline, onSelectSource, onSelectView, onChangeViewSet, onOpenOccurrence, runtime: hostRuntime }) {
  const { t } = useI18n();
  const dialogs = useDialogs();
  const [activeViewId, setActiveViewId] = useState(viewId || "");
  const [pendingOccurrence, setPendingOccurrence] = useState(null);
  const [popover, setPopover] = useState(null);
  const createViewPending = useRef(false);
  useEffect(() => { setActiveViewId(viewId || ""); }, [viewId, sourceId]);
  // A newly created view and its block update can arrive in separate React
  // renders. Keep that explicit operation visible until the props catch up.
  const pending = pendingOccurrence?.sourceId === sourceId && pendingOccurrence.baseViewId === viewId && pendingOccurrence.baseViewIdsJson === viewIdsJson && pendingOccurrence.baseSourceIdsJson === sourceIdsJson ? pendingOccurrence : null;
  const resolvingWorkspace = pending ? {
    ...workspace,
    databaseViews: pending.view && !databaseViewById(workspace, pending.view.id) ? [...(workspace.databaseViews || []), pending.view] : workspace.databaseViews,
    dataSources: pending.source && !dataSourceById(workspace, pending.source.id) ? [...(workspace.dataSources || []), pending.source] : workspace.dataSources,
  } : workspace;
  const declaration = { sourceId, sourceIdsJson: pending?.sourceIdsJson ?? sourceIdsJson };
  const membership = resolveDatabaseOccurrenceSources(resolvingWorkspace, declaration);
  const occurrence = resolveDatabaseOccurrenceViews(resolvingWorkspace, { ...declaration, viewId: activeViewId || viewId, viewIdsJson: pending?.viewIdsJson ?? viewIdsJson });
  const sourceViews = occurrence.problems.length ? [] : occurrence.views;
  const view = occurrence.selectedView;
  const source = dataSourceById(resolvingWorkspace, view?.sourceId || sourceId);
  const owner = source?.ownerPageId ? workspace.pages?.find((page) => page.id === source.ownerPageId) : null;
  const container = workspace.pages?.find(page => page.id === (containerPageId || hostRuntime?.pageId));
  const ownerArchived = isPageArchived(workspace, owner);
  const sourceUnavailable = source?.trashedAt || (source?.ownerPageId && (!owner || owner.trashedAt));
  const containerLocked = readOnlyReference || Boolean(hostRuntime?.locked || container?.settings?.locked || container?.trashedAt || isPageArchived(workspace, container));
  const locked = containerLocked || Boolean(sourceUnavailable || owner?.settings?.locked) || ownerArchived;
  const runtime = useMemo(() => locked && !hostRuntime?.locked ? { ...hostRuntime, locked: true } : hostRuntime, [hostRuntime, locked]);
  const filterDay = useFilterDay(!embeddedItems && filterUsesRelativeDate(view?.filter));
  const projectedItems = useMemo(() => embeddedItems ?? (source && view && !sourceUnavailable ? projectViewItems(workspace, view, { now: new Date(filterDay) }) : []), [workspace, source, view, embeddedItems, filterDay, sourceUnavailable]);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [peek, setPeek] = useState(null);
  const returnFocusFrame = useRef(null);
  useEffect(() => () => { if (returnFocusFrame.current !== null) cancelAnimationFrame(returnFocusFrame.current); }, [source?.id, view?.id]);
  const [csvOpen, setCsvOpen] = useState(false);
  const searchRef = useRef(null), searchButtonRef = useRef(null);
  const items = useMemo(() => source ? searchViewItems(workspace, source, projectedItems, query) : projectedItems, [workspace, source, projectedItems, query]);
  useEffect(() => { setQuery(""); setSearchOpen(false); setPeek(null); setPropertyDialog(null); setCsvOpen(false); }, [source?.id, view?.id]);
  useEffect(() => { if (searchOpen) searchRef.current?.focus(); }, [searchOpen]);
  const [propertyDialog, setPropertyDialog] = useState(null);
  const addButtonRef = useRef(null), filterButtonRef = useRef(null), sortButtonRef = useRef(null), settingsButtonRef = useRef(null), tabsRef = useRef(null), sourceButtonRef = useRef(null);
  useEffect(() => { setPopover(null); }, [sourceId]);
  const closePopover = (restoreFocus = true) => {
    const anchor = popover?.anchor;
    setPopover(null);
    createViewPending.current = false;
    if (restoreFocus && anchor) requestAnimationFrame(() => { if (anchor.isConnected) anchor.focus(); });
  };
  const openPopover = (type, anchor, section = "main") => {
    if (!anchor) return;
    setPopover((current) => current?.type === type && current.anchor === anchor ? null : { type, anchor, section, history: [] });
  };
  const selectView = (id) => {
    if (!sourceViews.some((entry) => entry.id === id)) return;
    setActiveViewId(id);
    if (!containerLocked) onSelectView?.(id);
    setPopover(null);
  };
  const changeMembership = (ids, viewIds, nextViewId, addedView = null, addedSource = null) => {
    const patch = { viewId: nextViewId, viewIdsJson: serializeDatabaseOccurrenceViewIds(viewIds), sourceIdsJson: serializeDatabaseOccurrenceSourceIds(ids) };
    setPendingOccurrence({ sourceId, baseViewId: viewId, baseViewIdsJson: viewIdsJson, baseSourceIdsJson: sourceIdsJson, view: addedView, source: addedSource, ...patch });
    setActiveViewId(nextViewId);
    if (onChangeViewSet) onChangeViewSet(patch);
    else onSelectView?.(nextViewId);
  };
  const appendCreatedView = (created, addedSource = null) => {
    const ids = membership.sourceIds.includes(created.sourceId) ? membership.sourceIds : [...membership.sourceIds, created.sourceId];
    changeMembership(ids, [...occurrence.viewIds, created.id], created.id, created, addedSource);
  };
  const removeSource = (id) => {
    const remaining = sourceViews.filter(entry => entry.sourceId !== id);
    if (id === sourceId || !remaining.length) return;
    changeMembership(membership.sourceIds.filter(entry => entry !== id), remaining.map(entry => entry.id), remaining.some(entry => entry.id === view?.id) ? view.id : remaining[0].id);
    closePopover(false);
  };
  const addSource = () => {
    const created = runtime?.createInlineDatabase?.("table", containerPageId || hostRuntime?.pageId || owner?.id);
    if (!created?.sourceId || !created.viewId) return;
    const newView = created.view || { id: created.viewId, sourceId: created.sourceId, type: "table", name: t("db.view.table") };
    appendCreatedView(newView, created.source);
    closePopover(false);
  };
  const createView = (type) => {
    if (locked || createViewPending.current) return;
    createViewPending.current = true;
    let created;
    try { created = onCreateView?.(source.id, { name: "", type }); }
    catch { created = null; }
    if (!created?.id) {
      createViewPending.current = false;
      setPopover((current) => current?.type === "addView" ? { ...current, error: t("db.createViewError") } : current);
      return;
    }
    appendCreatedView(created);
    setPopover((current) => ({ type: "createView", anchor: current?.anchor || addButtonRef.current, section: "main", history: [], createdView: created }));
  };
  const copyView = () => {
    const viewLabel = t(`db.view.${view.type}`) || VIEW_REGISTRY[view.type].label;
    const created = onCreateView?.(source.id, { type: view.type, name: `${view.name || viewLabel}${t("db.view.copySuffix")}`, filter: view.filter, sorts: view.sorts, groupBy: view.groupBy, grouping: view.grouping, visiblePropertyIds: view.visiblePropertyIds, config: view.config });
    if (created?.id) { appendCreatedView(created); setPopover(null); requestAnimationFrame(() => Array.from(tabsRef.current?.querySelectorAll('[role="tab"]') || []).find((tab) => tab.dataset.viewId === created.id)?.focus()); }
  };
  const unavailable = sourceUnavailable && <div className="database-view-empty" role="status"><IconDatabase size={22} /><strong>{owner?.trashedAt || source?.trashedAt ? t("db.empty.inTrash") : t("db.empty.deleted")}</strong><p>{t("db.empty.keepRefHint")}</p></div>;
  if (unavailable && (!view || sourceViews.length < 2)) return <div className="database-view">{unavailable}</div>;
  if (!source && sourceId) return <div className="database-view database-view-empty"><IconDatabase size={22} /><strong>{t("db.empty.dbDeleted")}</strong><p>{t("db.empty.dbDeletedHint")}</p></div>;
  if (!source) return <div className="database-view database-view-empty"><IconDatabase size={22} /><strong>{workspace.dataSources?.length ? t("db.empty.pickSource") : t("db.empty.noSources")}</strong><p>{t("db.empty.linkedHint")}</p><div className="db-source-picker">{workspace.dataSources?.filter((entry) => !entry.trashedAt && (!entry.ownerPageId || workspace.pages?.some((page) => page.id === entry.ownerPageId && !page.trashedAt && !isPageArchived(workspace, page)))).map((entry) => <button type="button" key={entry.id} disabled={locked} onClick={() => onSelectSource?.(entry.id)}>{entry.title}</button>)}</div></div>;
  if (occurrence.problems.length) return <div className="database-view database-view-empty" role="alert" data-source-id={source.id}><IconDatabase size={22} /><strong>{t("db.empty.unavailable")}</strong><p>{t("db.empty.unavailableHint")}</p></div>;
  if (!view) return <div className="database-view database-view-empty">{t("db.empty.noView")}{!locked && <button type="button" onClick={() => { const created = onCreateView?.(source.id, { type: "table", name: t("db.view.table") }); if (created?.id) appendCreatedView(created); }}>{t("db.empty.createTableView")}</button>}</div>;
  const config = normalizeViewConfig(view.type, view.config);
  const openPeek = (pageId, anchor = document.activeElement, mode = config.openRecordsIn) => { if (returnFocusFrame.current !== null) cancelAnimationFrame(returnFocusFrame.current); setPeek({ pageId, anchor, sourceId: source.id, viewId: view.id, mode: mode === "side" ? "side" : "peek" }); };
  const openRecord = (pageId, anchor) => { if (readOnlyReference || config.openRecordsIn === "page") onOpenItemPage?.(pageId); else openPeek(pageId, anchor, config.openRecordsIn); };
  const peekSource = view.type === "dashboard" && peek && dataSourceById(workspace, workspace.databaseItems?.find(item => item.pageId === peek.pageId)?.sourceId);
  const peekLocked = peekSource && workspace.pages?.some(page => page.id === peekSource.ownerPageId && page.settings?.locked);
  const createFromView = !locked && onCreateItem ? (_id, options = {}) => onCreateItem(source.id, { ...options, fromViewId: view.id }) : undefined;
  const createFromHeader = (options = {}) => {
    const created = createFromView?.(source.id, options);
    if (created?.pageId) openRecord(created.pageId);
  };
  const common = { workspace, source, view, items, onOpenItemPage: openRecord, onOpenItemFullPage: onOpenItemPage, onPeekItemPage: readOnlyReference ? openRecord : openPeek, onOpenViewSettings: () => openPopover("settings", filterButtonRef.current, "filter"), onCreateItem: createFromView,
    onUpdateItemValue: locked ? undefined : onUpdateItemValue, onUpdateView: !locked || embeddedItems ? onUpdateView : undefined, runtime, searchQuery: query };
  const renderView = () => {
    if (unavailable) return unavailable;
    switch (view.type) {
      case "feed": return <DatabaseFeed {...common} />;
      case "chart": return <ChartView key={view.id} {...common} embedded={Boolean(embeddedItems)} onSaveDrilldown={!locked && onCreateView ? (slice) => {
        const created = onCreateView(source.id, { name: slice.label + t("db.ui.chartSliceSuffix"), type: "table", filter: view.filter, sorts: view.sorts, config: { chartSlice: { ...slice, query } } });
        if (created?.id) appendCreatedView(created);
      } : undefined} />;
      case "form": return <DatabaseForm key={view.id} {...common} />;
      case "dashboard": return <DatabaseDashboard key={view.id} {...common} renderSavedView={({ source: child, view: saved, items: scoped }) =>
        <DashboardSavedView key={saved.id} component={DatabaseView} workspace={workspace} source={child} saved={saved} items={scoped} runtime={runtime} readOnlyReference={readOnlyReference}
          onUpdateView={onUpdateView} onUpdateItemValue={onUpdateItemValue} onCreateItem={onCreateItem} onOpenItemPage={onOpenItemPage} onAddProperty={onAddProperty} />} />;
      case "map": return <DatabaseMap {...common} />;
      case "board": return <DatabaseBoard {...common} />;
      case "list": return <DatabaseList {...common} />;
      case "gallery": return <DatabaseGallery {...common} />;
      case "calendar": return <DatabaseCalendar {...common} />;
      case "timeline": return <DatabaseTimeline {...common} />;
      case "roadmap": return <DatabaseRoadmap {...common} />;
      default: return <DatabaseTable {...common} onEditProperty={(property, anchor) => setPropertyDialog({ property, type: property.type, returnFocus: anchor })} onRenameProperty={(propertyId, name) => runtime?.updateDatabaseProperty?.(source.id, propertyId, { name })} />;
    }
  };
  const renameSource = !locked && runtime?.renameDatabaseSource ? async () => {
    closePopover(false);
    const name = await dialogs.promptText({ title: t("db.ui.dbNameTitle"), initialValue: source.title, validate: (value) => value.trim() ? null : t("db.ui.dbNameReq") });
    if (name?.trim()) runtime.renameDatabaseSource(source.id, name.trim());
    requestAnimationFrame(() => sourceButtonRef.current?.focus());
  } : null;
  const sourceFromSettings = popover?.type === "settings" && popover.section === "source";
  const hasSourceMenu = popover?.type === "source" || sourceFromSettings;
  const goBack = () => setPopover(current => current && { ...current, section: current.history.at(-1) || "main", history: current.history.slice(0, -1) });
  return <LifeAtlasEditorRuntimeContext.Provider value={{ ...runtime, workspace }}><section className={`database-view ${inline ? "is-inline" : "is-full-page"}`} data-source-id={source.id} data-view-id={view.id} data-view-type={view.type} onMouseDownCapture={(event) => {
    // Ordinary interaction belongs to this embedded work surface. Let modified
    // clicks, the external block handle and surrounding text keep editor selection.
    // Leaflet handles mousedown on the native map element and stops it there.
    if ((view.type === "map" || view.type === "dashboard") && event.target.closest?.(".db-geographic-canvas")) return;
    const control = event.target.closest?.('button, summary, [role="tab"]');
    const ordinaryInside = event.currentTarget.contains(event.target) && event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey;
    if (inline && (control || ordinaryInside)) event.stopPropagation();
  }}>
    {config.showDataSourceTitle !== false && <header className="db-view-header db-v9-header">
      <div className="db-view-title"><button ref={sourceButtonRef} type="button" className="db-source-button" aria-label={t("db.ui.sourceAria", { title: source.title })} aria-haspopup="dialog" aria-expanded={popover?.type === "source"} onClick={(event) => openPopover("source", event.currentTarget, "source")}><IconDatabase size={15} aria-hidden="true" /><span>{source.title}</span><IconChevronDown size={13} aria-hidden="true" /></button></div>
      {onOpenOccurrence && <button type="button" className="db-mini-action db-v9-icon-action" aria-label={t("db.ui.openFull")} title={t("db.ui.openFull")} onClick={onOpenOccurrence}><IconArrowUpRight size={15} aria-hidden="true" /></button>}
    </header>}
    <div className="db-navigation-row db-v9-toolbar-row">
      <div className="db-v9-tab-area">
        <DatabaseViewTabs key={sourceId} views={sourceViews} activeId={view.id} sourceTitle={source.title} tabsRef={tabsRef} addButtonRef={addButtonRef} viewIcons={VIEW_ICONS} getLabel={(entry) => entry.name || (popover?.type === "createView" && popover.createdView?.id === entry.id ? t("app.msg.newView") : t(`db.view.${entry.type}`) || VIEW_REGISTRY[entry.type]?.label || t("db.ui.viewFallback"))} onSelectView={selectView} onOpenMenu={() => closePopover(false)} onAddView={locked ? null : () => { createViewPending.current = false; openPopover("addView", addButtonRef.current); }} />
        {!locked && <button ref={addButtonRef} type="button" className="db-add-view" aria-label={t("db.ui.addView")} title={t("db.ui.addView")} aria-haspopup="dialog" aria-expanded={popover?.type === "addView" || popover?.type === "createView"} onClick={(event) => { if (popover?.type === "createView") closePopover(false); else { createViewPending.current = false; openPopover("addView", event.currentTarget); } }}><IconPlus size={14} aria-hidden="true" /></button>}
      </div>
      <div className="db-view-actions db-v9-actions">
        {config.showDataSourceTitle === false && onChangeViewSet && <button ref={sourceButtonRef} type="button" className="db-mini-action db-v9-icon-action" aria-label={t("db.ui.sourceAria", { title: source.title })} aria-haspopup="dialog" aria-expanded={popover?.type === "source"} onClick={(event) => openPopover("source", event.currentTarget, "source")}><IconDatabase size={15} aria-hidden="true" /></button>}
        {view.type === "calendar" && <DatabaseCalendarUnscheduled {...common} />}
        {!locked && <><button ref={filterButtonRef} type="button" className="db-mini-action db-v9-icon-action" aria-label={t("db.ui.filter")} title={t("db.ui.filter")} aria-haspopup="dialog" aria-expanded={popover?.type === "settings" && popover.anchor === filterButtonRef.current} onClick={(event) => openPopover("settings", event.currentTarget, "filter")}><IconFilter size={15} aria-hidden="true" /></button><button ref={sortButtonRef} type="button" className="db-mini-action db-v9-icon-action" aria-label={t("db.ui.sort")} title={t("db.ui.sort")} aria-haspopup="dialog" aria-expanded={popover?.type === "settings" && popover.anchor === sortButtonRef.current} onClick={(event) => openPopover("settings", event.currentTarget, "sort")}><IconArrowsSort size={15} aria-hidden="true" /></button></>}
        {searchOpen ? <input ref={searchRef} className="db-view-search" aria-label={t("db.ui.searchInViewAria")} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { event.stopPropagation(); if (event.key === "Escape") { setQuery(""); setSearchOpen(false); requestAnimationFrame(() => searchButtonRef.current?.focus()); } }} /> : <button ref={searchButtonRef} type="button" className="db-mini-action db-v9-icon-action" aria-label={t("db.ui.searchView")} title={t("db.ui.searchView")} onClick={() => { setPopover(null); setSearchOpen(true); }}><IconSearch size={15} aria-hidden="true" /></button>}
        {!locked && <button ref={settingsButtonRef} type="button" className="db-mini-action db-v9-icon-action" aria-label={t("db.ui.viewSettings")} title={t("db.ui.viewSettings")} aria-haspopup="dialog" aria-expanded={popover?.type === "settings" && popover.anchor === settingsButtonRef.current} onClick={(event) => openPopover("settings", event.currentTarget)}><IconSettings2 size={15} aria-hidden="true" /></button>}
        {!locked && view.type !== "form" && <div className="db-v9-new-group"><button type="button" className="db-v9-new-button" aria-label={t("db.ui.newRecordAria")} onClick={() => createFromHeader()}>{t("db.ui.newBtn")}</button><button type="button" className="db-v9-new-options" aria-label={t("db.ui.moreNewOptions")} title={t("db.ui.moreNewOptions")} aria-haspopup="dialog" aria-expanded={popover?.type === "new"} onClick={(event) => openPopover("new", event.currentTarget)}><IconChevronDown size={14} aria-hidden="true" /></button></div>}
      </div>
    </div>
    {popover?.type === "addView" && !locked && <DatabasePopover anchor={popover.anchor} label={t("db.ui.addView")} className="db-view-create-chooser" onClose={closePopover}><div className="db-view-create-heading"><span>{t("db.ui.addView")}</span><button type="button" aria-label={t("db.ui.closeAddViewAria")} onClick={() => closePopover(true)}>×</button></div><div className="db-view-create-grid">{DATABASE_VIEW_TYPES.map((type) => { const Icon = VIEW_ICONS[type] || IconTable; return <button type="button" key={type} onClick={() => createView(type)}><Icon size={18} aria-hidden="true" /><span>{t(`db.view.${type}`) || VIEW_REGISTRY[type].label}</span></button>; })}</div>{popover.error && <p role="alert" className="db-view-create-error">{popover.error}</p>}</DatabasePopover>}
    {popover?.type === "createView" && !locked && view.id === popover.createdView.id && <DatabasePopover key="createView" anchor={popover.anchor} label={t("db.ui.newViewTitle")} className="db-view-create-panel" onClose={closePopover}><DatabaseViewSettings creation section={popover.section} onSection={(section) => setPopover((current) => current && { ...current, section, history: [...current.history, current.section] })} onBack={goBack} workspace={workspace} source={source} view={view} config={config} runtime={runtime} viewIcons={VIEW_ICONS} onUpdateView={onUpdateView} onClose={closePopover} /></DatabasePopover>}
    {hasSourceMenu && <DatabasePopover anchor={popover.anchor} label={sourceFromSettings ? t("db.ui.viewSettings") : t("db.ui.sourceLabel")} className="db-view-settings-panel" onClose={closePopover}>
      <DatabaseOccurrenceSources workspace={workspace} sourceIds={membership.sourceIds} activeSourceId={source.id} viewIds={occurrence.viewIds} onChoose={selectView}
        onBack={sourceFromSettings && !embeddedItems ? goBack : undefined} onRename={renameSource} onRemove={!containerLocked && onChangeViewSet ? removeSource : null}
        onCreate={!containerLocked && onChangeViewSet && runtime?.createInlineDatabase ? addSource : null}
        onLink={!containerLocked && onChangeViewSet ? (saved) => { appendCreatedView(saved); closePopover(false); } : null} onClose={closePopover} />
    </DatabasePopover>}
    {popover?.type === "settings" && !locked && !hasSourceMenu && <DatabasePopover anchor={popover.anchor} label={t("db.ui.viewSettings")} className="db-view-settings-panel" onClose={closePopover}><DatabaseViewSettings section={popover.section} allowBack={!embeddedItems} onSection={(section) => setPopover((current) => current && { ...current, section, history: [...current.history, current.section] })} onBack={goBack} workspace={workspace} source={source} view={view} config={config} runtime={runtime} viewIcons={VIEW_ICONS} onUpdateView={onUpdateView} onCopyView={copyView} onAddPropertyType={(type, name) => { const anchor = popover.anchor; if (["relation", "rollup", "button", "converted_amount"].includes(type)) setPropertyDialog({ type, initialName: name, returnFocus: anchor }); else { const status = type === "status" ? defaultDatabaseProperties().find((entry) => entry.type === "status") : null; const definition = { name: name.trim(), options: status?.options || [], config: status?.config || (type === "unique_id" ? { prefix: "", nextNumber: 1 } : {}) }; const property = onAddProperty?.(source.id, type, definition); if (property?.id) setPropertyDialog({ property, type, returnFocus: anchor, compact: true }); } closePopover(false); }} onImportCsv={!locked && runtime?.importCsv ? () => { closePopover(false); setCsvOpen(true); } : null} onTurnIntoPage={!locked && onTurnIntoPage ? () => { closePopover(false); onTurnIntoPage(sourceId, view.id, occurrence.known ? serializeDatabaseOccurrenceViewIds(occurrence.viewIds) : undefined, serializeDatabaseOccurrenceSourceIds(membership.sourceIds)); } : null} onTurnIntoInline={!locked && onTurnIntoInline ? () => { closePopover(false); onTurnIntoInline(); } : null} inline={inline} onClose={closePopover} /></DatabasePopover>}
    {popover?.type === "new" && !locked && <DatabasePopover anchor={popover.anchor} label={t("db.ui.moreNewOptions")} onClose={closePopover}><div className="db-v9-menu-list"><button type="button" className="db-v9-menu-row" onClick={() => { popover.anchor.focus(); closePopover(false); createFromHeader(); }}>{t("db.ui.blankRecord")}</button>{(workspace.databaseTemplates || []).filter((template) => template.sourceId === source.id).map((template) => <button type="button" className="db-v9-menu-row" key={template.id} onClick={() => { popover.anchor.focus(); closePopover(false); createFromHeader({ templateId: template.id }); }}>{template.name}</button>)}</div></DatabasePopover>}
    {propertyDialog && (() => {
      const close = (restoreFocus = true) => { const anchor = propertyDialog.returnFocus; setPropertyDialog(null); if (restoreFocus && anchor) requestAnimationFrame(() => { if (anchor.isConnected) anchor.focus({ preventScroll: true }); }); };
      const property = propertyDialog.property && (source.properties.find((entry) => entry.id === propertyDialog.property.id) || propertyDialog.property);
      const change = (definition) => runtime?.updateDatabaseProperty?.(source.id, property.id, definition);
      const save = (definition) => { if (property) change(definition); else onAddProperty?.(source.id, definition.type, definition); close(); };
      return property?.type === "status" && propertyDialog.returnFocus
        ? <DatabaseStatusPropertyOptions source={source} property={property} anchor={propertyDialog.returnFocus} onClose={close} onChange={change}>
          <StatusActionSettings workspace={workspace} source={source} property={property} onChange={change} />
        </DatabaseStatusPropertyOptions>
        : (propertyDialog.compact || property?.type === "text" && propertyDialog.compact !== false) && property && propertyDialog.returnFocus
          ? <DatabasePropertyConfig property={property} anchor={propertyDialog.returnFocus} onClose={close} onSave={change} onAdvanced={(name) => setPropertyDialog({ ...propertyDialog, compact: false, initialName: name })} />
          : <PropertyConfigDialog workspace={workspace} source={source} {...propertyDialog} property={property && { ...property, name: propertyDialog.initialName ?? property.name }} onClose={() => close()} onSave={save} />;
    })()}
    {view.type === "table" && config.chartSlice && <div className="db-chart-slice">
      <span>{t("db.ui.chartDetailBanner", { label: config.chartSlice.label, query: config.chartSlice.query ? ` · ${config.chartSlice.query}` : "" })}</span>
      {!locked && <button type="button" onClick={() => { const next = { ...config }; delete next.chartSlice; onUpdateView?.(view.id, { config: next }); }}>{t("db.ui.clearChartDetail")}</button>}
    </div>}
    {ownerArchived && !unavailable && <p className="db-surface-message" role="status">{t("db.ui.archivedReadonly")}</p>}
    <div className="db-view-body">{renderView()}</div>
    {peek && peek.sourceId === source.id && peek.viewId === view.id && <RecordPeek workspace={workspace} pageId={peek.pageId} runtime={peekLocked ? { ...runtime, locked: true } : runtime} mode={peek.mode || "peek"} onOpenItemPage={onOpenItemPage} onClose={(restoreFocus = true) => {
      setPeek(null);
      const anchor = peek.anchor;
      if (restoreFocus && anchor) returnFocusFrame.current = requestAnimationFrame(() => {
        returnFocusFrame.current = null;
        if (!anchor.isConnected || document.activeElement !== document.body) return;
        if (anchor.matches?.('.db-title-open') && getComputedStyle(anchor).visibility === 'hidden') anchor.parentElement?.querySelector('.db-title-cell')?.focus({ preventScroll: true });
        anchor.focus({ preventScroll: true });
      });
    }} />}
    {csvOpen && !locked && runtime?.importCsv && <CsvImportDialog workspace={workspace} sourceId={source.id} folderId={owner?.folderId || workspace.pages?.find((page) => page.id === runtime.pageId)?.folderId || null} onImport={runtime.importCsv} onClose={() => setCsvOpen(false)} />}
  </section></LifeAtlasEditorRuntimeContext.Provider>;
}
