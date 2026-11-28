import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import IconChevronLeft from "@tabler/icons-react/dist/esm/icons/IconChevronLeft.mjs";
import IconChevronRight from "@tabler/icons-react/dist/esm/icons/IconChevronRight.mjs";
import IconGripVertical from "@tabler/icons-react/dist/esm/icons/IconGripVertical.mjs";
import { groupViewItems, groupViewLabel, itemDisplayTitle, projectViewItems, resolveDisplayPropertyValue, resolvePropertyValue } from "../domain/database.js";
import { PROPERTY_LABELS } from "../domain/databaseProperties.js";
import { CALCULATIONS, availableCalculations, computeColumnStat } from "../domain/databaseStats.js";
import { propertyTypeConversionTargets } from "../domain/propertyChanges.js";
import { normalizeViewConfig } from "../domain/viewRegistry.js";
import { TABLE_ROW_HEIGHT, tableRowWindow } from "../domain/tableVirtualization.js";
import { useMeasuredTableRows } from "./useMeasuredTableRows.js";
import { moveTableRow } from "../domain/tableRowOrder.js";
import { filterSubitems, subitemRows, subitemViewConfig } from "../domain/databaseSubitems.js";
import { useDialogs } from "../ui/DialogProvider.jsx";
import { PropertyEditor } from "./PropertyEditor.jsx";
import { DatabaseTitleCell } from "./DatabaseTitleCell.jsx";
import { DatabaseTableNumberCell } from "./DatabaseTableNumberCell.jsx";
import { handleDatabaseCellEscape } from "./databaseCellFocus.js";
import { newFilterCondition, normalizeRoot } from "./DatabaseQuerySettings.jsx";
import { TableBatchPropertyDialog } from "./TableBatchPropertyDialog.jsx";
import { DatabasePopover } from "./DatabaseViewSettings.jsx";
import { RecordStructureForm, SubitemToggle } from "./DatabaseStructureControls.jsx";
import { useI18n } from "../i18n/workspaceRuntime.js";

const clampWidth = (width) => Math.max(80, Math.min(800, Math.round(width)));
const MENU_ITEMS = '[role="menuitem"],[role="menuitemradio"],[role="menuitemcheckbox"]';
const rowDragType = "application/x-life-atlas-table-row";

function TableMenu({ anchor, label, children, onClose, restoreFocusRef }) {
  const menuRef = useRef(null), closeRef = useRef(onClose);
  const restoreOnClose = useRef(true);
  closeRef.current = onClose;
  const [position, setPosition] = useState({ left: 8, top: 8 });
  useLayoutEffect(() => {
    const place = () => {
      const bounds = anchor?.getBoundingClientRect(), menu = menuRef.current;
      if (!bounds || !menu) return;
      const left = Math.max(8, Math.min(bounds.left, window.innerWidth - menu.offsetWidth - 8));
      const top = window.innerHeight - bounds.bottom - 8 >= menu.offsetHeight ? bounds.bottom + 4 : Math.max(8, bounds.top - menu.offsetHeight - 4);
      setPosition((current) => current.left === left && current.top === top ? current : { left, top });
    };
    place();
    window.addEventListener("resize", place);
    document.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); document.removeEventListener("scroll", place, true); };
  }, [anchor, children]);
  useEffect(() => {
    restoreOnClose.current = true;
    (menuRef.current?.querySelector("[data-menu-initial]") || menuRef.current?.querySelector(MENU_ITEMS))?.focus();
    const outside = (event) => { if (!menuRef.current?.contains(event.target) && !anchor?.contains(event.target)) { restoreOnClose.current = false; closeRef.current?.(); } };
    document.addEventListener("pointerdown", outside);
    return () => { document.removeEventListener("pointerdown", outside); if (restoreOnClose.current && restoreFocusRef?.current !== false && anchor?.isConnected) anchor.focus({ preventScroll: true }); };
  }, [anchor]);
  const keyboard = (event) => {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeRef.current?.(); return; }
    if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const controls = [...(menuRef.current?.querySelectorAll(MENU_ITEMS) || [])].filter((control) => !control.disabled && control.getClientRects().length);
    const index = controls.indexOf(document.activeElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? controls.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + controls.length) % controls.length;
    controls[next]?.focus();
  };
  return createPortal(<div ref={menuRef} className="ui-popover ui-menu db-table-menu" role="menu" aria-label={label} style={position} onKeyDown={keyboard}>{children}</div>, document.body);
}

function PropertyName({ property, properties, onRename }) {
  const { t } = useI18n();
  const [name, setName] = useState(property.name);
  const duplicate = name !== property.name && properties.some((entry) => entry.id !== property.id && entry.name === name);
  return <div className="db-table-header-name"><input data-menu-initial aria-label={t("db.ui.propName")} aria-invalid={duplicate} aria-describedby={duplicate ? "db-table-header-name-error" : undefined} value={name} onChange={(event) => {
    const next = event.target.value;
    setName(next);
    if (next !== property.name && !properties.some((entry) => entry.id !== property.id && entry.name === next)) onRename?.(property.id, next);
  }} onKeyDown={(event) => {
    if (event.key === "Escape" && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) return;
    event.stopPropagation();
    if (event.key === "Enter" && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) event.preventDefault();
  }} />{duplicate && <small id="db-table-header-name-error" role="alert" className="db-field-error">{t("dbx.table.duplicateNameErr")}</small>}</div>;
}

export function DatabaseTable({ workspace, source, view, items: projectedItems, onUpdateItemValue, onUpdateView, onOpenItemPage, onOpenItemFullPage, onPeekItemPage, onOpenViewSettings, onCreateItem, onEditProperty, onRenameProperty, runtime, searchQuery = "" }) {
  const { t } = useI18n();
  const propTypeLabel = (type) => t(`db.prop.${type}`) || PROPERTY_LABELS[type] || type;
  const menuRestoreFocus = useRef(true);
  const dialogs = useDialogs();
  const locked = Boolean(runtime?.locked);
  const titleId = source.properties.find((property) => property.type === "title")?.id;
  const visibleIds = Array.isArray(view.visiblePropertyIds) ? view.visiblePropertyIds : source.properties.map((property) => property.id);
  const propertyIds = [...new Set([titleId, ...visibleIds].filter((id) => source.properties.some((property) => property.id === id)))];
  const properties = propertyIds.map((id) => source.properties.find((property) => property.id === id));
  const tableConfig = normalizeViewConfig("table", { ...view.config, table: view.config?.table ?? {} }).table;
  const itemsById = useMemo(() => new Map((workspace.databaseItems || []).map((item) => [item.id, item])), [workspace.databaseItems]);
  const pagesById = useMemo(() => new Map((workspace.pages || []).map((page) => [page.id, page])), [workspace.pages]);
  const recordLocked = (item) => locked || Boolean(pagesById.get(item.pageId)?.settings?.locked);
  const [collapse, setCollapse] = useState({ viewId: view.id, searchQuery, ids: new Set() });
  const collapsed = collapse.viewId === view.id && collapse.searchQuery === searchQuery ? collapse.ids : undefined;
  const setCollapsed = (id, value) => setCollapse((current) => {
    const ids = new Set(current.viewId === view.id && current.searchQuery === searchQuery ? current.ids : []);
    if (value) ids.add(id); else ids.delete(id);
    return { viewId: view.id, searchQuery, ids };
  });
  const { display, filter } = subitemViewConfig(view);
  const scopedItems = useMemo(() => filterSubitems(projectedItems, filter), [projectedItems, filter]);
  const groupProperty = source.properties.find(p=>p.id === (view.grouping?.primaryPropertyId || view.groupBy));
  const groups = useMemo(() => groupProperty ? groupViewItems(workspace, view, scopedItems) : null, [workspace, view, scopedItems, groupProperty]);
  const { rows, items, itemRows } = useMemo(() => {
    const rows = [], items = [], itemRows = [];
    const add = (records, groupKey = null) => {
      for (const row of subitemRows(records, display, collapsed)) {
        const { item } = row;
        const key = groupKey == null ? item.id : JSON.stringify([groupKey, item.id]);
        itemRows.push(rows.length);
        rows.push({ ...row, key, index: items.length, groupKey });
        items.push(item);
      }
    };
    if (groups) for (const group of groups) { rows.push({ group, key: JSON.stringify([group.key]) }); add(group.items, group.key); }
    else add(scopedItems);
    return { rows, items, itemRows };
  }, [groups, scopedItems, display, collapsed]);
  const virtual = rows.length > 200;
  const wrappedVirtual = virtual && properties.some(property => property.type === "formula" || property.type === "rollup" || tableConfig.wrapPropertyIds.includes(property.id));
  const containerRef = useRef(null);
  const frameRef = useRef(null);
  const focusFrame = useRef(null), resizeCleanup = useRef(null), selectAllRef = useRef(null);
  const draggingRow = useRef(null);
  const creatingRef = useRef(false);
  const [viewport, setViewport] = useState({ scrollTop: 0, height: 600 });
  const [scrollEdges, setScrollEdges] = useState({ start: true, end: true });
  const [selected, setSelected] = useState(new Set());
  const [batchOpen, setBatchOpen] = useState(false);
  const [dropRow, setDropRow] = useState(null);
  const [focusedCell, setFocusedCell] = useState(null);
  const [pendingCreate, setPendingCreate] = useState(null);
  const [menu, setMenu] = useState(null), [typeMenuOpen, setTypeMenuOpen] = useState(false);
  const [draftWidths, setDraftWidths] = useState({}), [resizing, setResizing] = useState(null), [dropColumn, setDropColumn] = useState(null);
  const eligible = items.filter((item) => !recordLocked(item));
  const canReorder = !locked && Boolean(onUpdateView) && !view.sorts?.length;
  const selectionWidth = canReorder ? 72 : 48;
  const allSelected = eligible.length > 0 && eligible.every((item) => selected.has(item.id));
  const activeCell = focusedCell && itemsById.has(focusedCell.itemId) && items.some((item) => item.id === focusedCell.itemId) && propertyIds.includes(focusedCell.propertyId) ? focusedCell : { itemId: items[0]?.id, propertyId: propertyIds[0] };
  const widths = Object.fromEntries(properties.map((property) => [property.id, draftWidths[property.id] ?? tableConfig.columnWidths[property.id] ?? (property.type === "title" ? 260 : 180)]));
  const tableWidth = properties.reduce((width, property) => width + widths[property.id], selectionWidth + 72);
  const measured = useMeasuredTableRows({
    enabled: wrappedVirtual, rows, viewport, setViewport, containerRef,
    geometry: wrappedVirtual ? JSON.stringify([view.id, propertyIds, tableConfig.wrapPropertyIds, widths, viewport.width, globalThis.devicePixelRatio]) : "",
  });
  const range = measured.range ?? (virtual ? tableRowWindow({ count: rows.length, scrollTop: Math.max(0, viewport.scrollTop - 34), viewportHeight: viewport.height }) : { start: 0, end: rows.length, top: 0, bottom: 0 });
  const rowOffset = index => measured.layout ? (viewport.headerHeight ?? 34) + measured.layout.offsets[index] : 34 + index * TABLE_ROW_HEIGHT;
  const updateTable = (patch) => { if (!locked) onUpdateView?.(view.id, { config: { ...view.config, table: { ...tableConfig, ...patch } } }); };
  const closeMenu = () => { setMenu(null); setTypeMenuOpen(false); };
  const openMenu = (kind, definition, anchor) => { menuRestoreFocus.current = true; setMenu({ kind, ...definition, anchor }); setTypeMenuOpen(false); };
  const openStructure = (kind) => { menuRestoreFocus.current = false; setMenu({ ...menu, kind }); };
  const closeStructure = (focus) => {
    const anchor = menu.anchor;
    closeMenu();
    if (focus) requestAnimationFrame(() => { if (anchor.isConnected) anchor.focus(); });
  };
  const createAtEnd = () => {
    if (locked || creatingRef.current || !onCreateItem || !titleId) return;
    creatingRef.current = true;
    let created;
    try { created = onCreateItem(source.id); }
    catch (error) { creatingRef.current = false; throw error; }
    if (typeof created?.itemId === "string" && created.itemId && typeof created?.pageId === "string" && created.pageId) setPendingCreate(created);
    else creatingRef.current = false;
  };
  useEffect(() => {
    const ids = new Set(items.filter((item) => !recordLocked(item)).map((item) => item.id));
    setSelected((current) => { const next = new Set([...current].filter((id) => ids.has(id))); return next.size === current.size ? current : next; });
  }, [items, pagesById, locked]);
  useEffect(() => { if (selectAllRef.current) selectAllRef.current.indeterminate = selected.size > 0 && !allSelected; }, [selected, allSelected]);
  useEffect(() => {
    setSelected(new Set()); setBatchOpen(false); setFocusedCell(null); setPendingCreate(null);
    draggingRow.current = null; setDropRow(null); creatingRef.current = false; closeMenu();
  }, [view.id]);
  useEffect(() => {
    if (containerRef.current) containerRef.current.scrollTop = 0;
    setViewport((current) => ({ ...current, scrollTop: 0 }));
  }, [view.id, view.sorts, view.filter, display, filter, searchQuery]);
  useEffect(() => () => { resizeCleanup.current?.(); if (focusFrame.current !== null) cancelAnimationFrame(focusFrame.current); }, []);
  useLayoutEffect(() => {
    if (!pendingCreate) return;
    if (locked) { creatingRef.current = false; setPendingCreate(null); return; }
    const index = items.findIndex((item) => item.id === pendingCreate.itemId && item.pageId === pendingCreate.pageId);
    if (index < 0) {
      if (itemsById.has(pendingCreate.itemId)) { creatingRef.current = false; setPendingCreate(null); }
      return;
    }
    setFocusedCell((current) => current?.itemId === pendingCreate.itemId && current?.propertyId === titleId ? current : { itemId: pendingCreate.itemId, propertyId: titleId });
    if (virtual && (itemRows[index] < range.start || itemRows[index] >= range.end)) {
      const container = containerRef.current;
      const scrollTop = Math.max(0, rowOffset(itemRows[index]) - (container?.clientHeight || 600) / 2);
      if (container) container.scrollTop = scrollTop;
      const actualScrollTop = container?.scrollTop ?? scrollTop;
      setViewport((current) => current.scrollTop === actualScrollTop ? current : { ...current, scrollTop: actualScrollTop });
    }
  }, [pendingCreate, items, itemRows, itemsById, locked, virtual, titleId, range.start, range.end]);
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    const measure = () => {
      const start = container.scrollLeft <= 1;
      const end = container.scrollWidth - container.clientWidth - container.scrollLeft <= 1;
      setScrollEdges((current) => current.start === start && current.end === end ? current : { start, end });
    };
    const resize = new ResizeObserver(measure);
    resize.observe(container);
    resize.observe(container.querySelector("table"));
    container.addEventListener("scroll", measure, { passive: true });
    measure();
    return () => { resize.disconnect(); container.removeEventListener("scroll", measure); };
  }, [tableWidth]);
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !virtual) return undefined;
    const header = container.querySelector("thead");
    const measure = () => setViewport({ scrollTop: container.scrollTop, height: container.clientHeight, width: container.clientWidth, headerHeight: header?.offsetHeight, atBottom: container.scrollTop + container.clientHeight >= container.scrollHeight - 1 });
    const resize = new ResizeObserver(measure);
    resize.observe(container);
    if (wrappedVirtual && header) resize.observe(header);
    measure();
    return () => { resize.disconnect(); if (frameRef.current !== null) cancelAnimationFrame(frameRef.current); frameRef.current = null; };
  }, [virtual, wrappedVirtual]);
  const scroll = () => {
    if (!virtual || frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      const container = containerRef.current;
      if (container) setViewport(current => ({ ...current, scrollTop: container.scrollTop, height: container.clientHeight, atBottom: container.scrollTop + container.clientHeight >= container.scrollHeight - 1 }));
    });
  };
  const focusCell = (itemIndex, propertyIndex) => {
    itemIndex = Math.max(0, Math.min(items.length - 1, itemIndex));
    const item = items[itemIndex], property = properties[Math.max(0, Math.min(properties.length - 1, propertyIndex))];
    if (!item || !property) return;
    setFocusedCell({ itemId: item.id, propertyId: property.id });
    if (virtual && (itemRows[itemIndex] < range.start || itemRows[itemIndex] >= range.end)) {
      const container = containerRef.current;
      const scrollTop = Math.max(0, rowOffset(itemRows[itemIndex]) - (container?.clientHeight || 600) / 2);
      if (container) container.scrollTop = scrollTop;
      setViewport((current) => ({ ...current, scrollTop: container?.scrollTop ?? scrollTop }));
    }
    if (focusFrame.current !== null) cancelAnimationFrame(focusFrame.current);
    focusFrame.current = requestAnimationFrame(() => {
      focusFrame.current = null;
      const cell = containerRef.current?.querySelector(`tr[data-layout-index="${itemIndex}"] td[data-property-id="${CSS.escape(property.id)}"]`);
      cell?.focus();
      cell?.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
  };
  const cellKeyboard = (event, itemIndex, propertyIndex) => {
    const cell = event.currentTarget;
    if (handleDatabaseCellEscape(event)) return;
    if (event.target !== cell) return;
    const delta = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[event.key];
    if (delta) { event.preventDefault(); event.stopPropagation(); focusCell(itemIndex + delta[0], propertyIndex + delta[1]); }
    if (event.key === "Enter") {
      event.preventDefault(); event.stopPropagation();
      const control = cell.querySelector('input:not([disabled]),textarea:not([disabled]),summary,button:not([disabled]):not(.db-structure-toggle)');
      if (control?.matches('input[type="checkbox"],summary,button')) control.click();
      else control?.focus();
    }
  };
  const resizeColumn = (event, property) => {
    if (locked) return;
    event.preventDefault(); event.stopPropagation(); resizeCleanup.current?.();
    const startX = event.clientX, startWidth = widths[property.id];
    let nextWidth = startWidth;
    setResizing(property.id);
    const move = (moveEvent) => { nextWidth = clampWidth(startWidth + moveEvent.clientX - startX); setDraftWidths((current) => ({ ...current, [property.id]: nextWidth })); };
    const cleanup = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", finish); window.removeEventListener("pointercancel", cancel); resizeCleanup.current = null; };
    const finish = () => { cleanup(); setResizing(null); setDraftWidths({}); updateTable({ columnWidths: { ...tableConfig.columnWidths, [property.id]: nextWidth } }); };
    const cancel = () => { cleanup(); setResizing(null); setDraftWidths({}); };
    resizeCleanup.current = cleanup;
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", finish, { once: true }); window.addEventListener("pointercancel", cancel, { once: true });
  };
  const moveColumn = (propertyId, targetIndex) => {
    const index = propertyIds.indexOf(propertyId);
    if (locked || index < 1 || targetIndex < 1 || targetIndex >= propertyIds.length || index === targetIndex) return;
    const next = [...propertyIds]; next.splice(index, 1); next.splice(targetIndex, 0, propertyId);
    onUpdateView?.(view.id, { visiblePropertyIds: next });
  };
  const trashItems = async (ids) => {
    closeMenu();
    if (locked || !ids.length) return;
    const confirmed = await dialogs.confirm({ title: t("dbx.table.trashTitle"), description: t("dbx.table.trashItemsDesc", { count: ids.length }), confirmLabel: t("dbx.table.trashTitle"), danger: true });
    if (confirmed) { runtime?.trashDatabaseItems?.(ids); setSelected(new Set()); }
  };
  const changeType = async (property, nextType) => {
    closeMenu();
    const confirmed = await dialogs.confirm({ title: t("dbx.table.changeTypeTitle"), description: t("dbx.table.changeTypeDesc", { name: property.name, from: propTypeLabel(property.type), to: propTypeLabel(nextType) }), confirmLabel: t("db.ui.changeType"), danger: true });
    if (confirmed) { try { await runtime?.changePropertyType?.(source.id, property.id, nextType); } catch (error) { await dialogs.alert({ title: t("dbx.table.changeFail"), description: error.message }); } }
  };
  const deleteColumn = async (property) => {
    closeMenu();
    const confirmed = await dialogs.confirm({ title: t("dbx.table.delPropTitle"), description: t("dbx.table.delPropDesc", { name: property.name }), confirmLabel: t("db.ui.deleteProp"), danger: true });
    if (confirmed) runtime?.deleteDatabaseProperty?.(source.id, property.id);
  };
  const addFilter = (property) => {
    const root = normalizeRoot(view.filter);
    onUpdateView?.(view.id, { filter: { ...root, children: [...root.children, { kind: "condition", ...newFilterCondition(workspace, source, property) }] } });
    closeMenu(); onOpenViewSettings?.();
  };
  const menuProperty = menu?.propertyId ? source.properties.find((property) => property.id === menu.propertyId) : null;
  const conversionTargets = propertyTypeConversionTargets(menuProperty?.type);
  const menuItem = menu?.itemId ? itemsById.get(menu.itemId) : null;
  const propertyIndex = menuProperty ? propertyIds.indexOf(menuProperty.id) : -1;
  const spacer = (height, key) => height > 0 ? <tr key={key} aria-hidden="true" className="db-virtual-spacer"><td colSpan={properties.length + 2} style={{ height }} /></tr> : null;
  const acceptsRow = (from, to) => canReorder && from?.item && to?.item
    && from.groupKey === to.groupKey && (display === "flat" || from.item.parentItemId === to.item.parentItemId)
    && !recordLocked(from.item) && !recordLocked(to.item);
  const moveRow = (from, to, side) => {
    if (!acceptsRow(from, to)) return;
    const scope = rows.filter(row => acceptsRow(from, row)).map(row => row.item.id);
    const all = projectViewItems(workspace, { ...view, filter: null });
    const manualOrder = moveTableRow(all, scope, from.item.id, to.item.id, side);
    if (manualOrder) updateTable({ manualOrder });
  };
  const resetRowDrag = () => { draggingRow.current = null; setDropRow(null); };
  const rowDropSide = event => {
    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientY < rect.top + rect.height / 2 ? "before" : "after";
  };
  const rowDrag = (event, row) => {
    if (!event.dataTransfer.types.includes(rowDragType) || !acceptsRow(draggingRow.current, row) || draggingRow.current.key === row.key) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const side = rowDropSide(event);
    setDropRow(current => current?.key === row.key && current.side === side ? current : { key: row.key, side });
  };
  const rowKeyboard = (event, row, index) => {
    if (!["ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const step = event.key === "ArrowUp" ? -1 : 1;
    let target = index + step;
    while (target >= 0 && target < rows.length && !acceptsRow(row, rows[target])) {
      if (rows[target].group) return;
      target += step;
    }
    if (!rows[target]) return;
    const handle = event.currentTarget;
    moveRow(row, rows[target], step < 0 ? "before" : "after");
    requestAnimationFrame(() => { if (handle.isConnected) handle.focus(); });
  };
  return <div className="db-table-workspace">
    {selected.size > 0 && <div className="db-batch-toolbar" role="toolbar" aria-label={t("dbx.table.batchAria")}><span>{t("dbx.table.selectedCount", { count: selected.size })}</span>
      {runtime?.updateDatabaseItemsProperty && !locked && <button type="button" onClick={() => setBatchOpen(true)}>{t("dbx.table.editPropBtn")}</button>}
      <button type="button" onClick={() => trashItems([...selected])}>{t("dbx.table.trashTitle")}</button><button type="button" onClick={() => setSelected(new Set())}>{t("dbx.table.clearSel")}</button></div>}
    {batchOpen && selected.size > 0 && !locked && <TableBatchPropertyDialog {...{ workspace, source, runtime }} count={selected.size}
      onClose={() => setBatchOpen(false)} onApply={(propertyId, value) => {
        runtime.updateDatabaseItemsProperty(source.id, [...selected], propertyId, value);
        setBatchOpen(false);
      }} />}
    {(!scrollEdges.start || !scrollEdges.end) && <div className="db-horizontal-scroll-controls" role="group" aria-label={t("dbx.table.hScrollAria")}>
      <span>{t("dbx.table.hScrollHint")}</span>
      <button type="button" aria-label={t("dbx.table.scrollLeftAria")} disabled={scrollEdges.start} onClick={() => { const container = containerRef.current; container?.scrollBy({ left: -container.clientWidth * .8, behavior: "instant" }); }}><IconChevronLeft size={15} /></button>
      <button type="button" aria-label={t("dbx.table.scrollRightAria")} disabled={scrollEdges.end} onClick={() => { const container = containerRef.current; container?.scrollBy({ left: container.clientWidth * .8, behavior: "instant" }); }}><IconChevronRight size={15} /></button>
    </div>}
    <div ref={containerRef} className={`db-table-scroll${virtual ? " is-virtual" : ""}${wrappedVirtual ? " is-wrapped-virtual" : ""}`} onScroll={scroll}>
    <table className={`db-table${selected.size ? " has-selection" : ""}`} style={{ width: tableWidth }} aria-rowcount={rows.length + 2 + (!locked && onCreateItem ? 1 : 0)}><caption className="db-sr-only">{source.title} · {view.name}</caption>
      <colgroup><col style={{ width: selectionWidth }} />{properties.map((property) => <col key={property.id} style={{ width: widths[property.id] }} />)}<col style={{ width: 72 }} /></colgroup>
      <thead><tr><th className="db-selection-heading" scope="col"><input ref={selectAllRef} type="checkbox" aria-label={t("common.selectAll")} disabled={locked || !eligible.length} checked={allSelected} onChange={(event) => setSelected(event.target.checked ? new Set(eligible.map((item) => item.id)) : new Set())} /></th>{properties.map((property) => <th key={property.id} scope="col" className={dropColumn === property.id ? "db-column-drop" : ""} draggable={!locked && property.type !== "title"}
        onDragStart={(event) => { if (event.target.closest(".db-column-resize")) { event.preventDefault(); return; } event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("application/x-life-atlas-column", property.id); }}
        onDragOver={(event) => { if (property.type !== "title" && event.dataTransfer.types.includes("application/x-life-atlas-column")) { event.preventDefault(); setDropColumn(property.id); } }} onDragLeave={() => setDropColumn(null)} onDragEnd={() => setDropColumn(null)}
        onDrop={(event) => { event.preventDefault(); setDropColumn(null); moveColumn(event.dataTransfer.getData("application/x-life-atlas-column"), propertyIds.indexOf(property.id)); }}>
        <button type="button" className="db-property-header" title={propTypeLabel(property.type)} data-type={property.type} disabled={locked} aria-label={t("dbx.table.editPropHeaderAria", { name: property.name })} aria-haspopup="menu" onClick={(event) => openMenu("property", { propertyId: property.id }, event.currentTarget)}>{property.name}<small>{propTypeLabel(property.type)}</small></button>
        <span className={`db-column-resize${resizing === property.id ? " is-resizing" : ""}`} role="separator" aria-orientation="vertical" aria-label={t("dbx.table.resizeColAria", { name: property.name })} aria-valuemin={80} aria-valuemax={800} aria-valuenow={widths[property.id]} tabIndex={locked ? -1 : 0} onPointerDown={(event) => resizeColumn(event, property)} onKeyDown={(event) => { if (!locked && ["ArrowLeft", "ArrowRight"].includes(event.key)) { event.preventDefault(); event.stopPropagation(); updateTable({ columnWidths: { ...tableConfig.columnWidths, [property.id]: clampWidth(widths[property.id] + (event.key === "ArrowRight" ? 10 : -10)) } }); } }} />
      </th>)}<th className="db-subitem-heading" scope="col">{t("dbx.table.subitemsCol")}</th></tr></thead>
      <tbody>{spacer(range.top, "top")}{rows.slice(range.start,range.end).map((row,offset) => {
        const physicalIndex = range.start + offset;
        if (row.group) {
          const {group} = row;
          const rawLabel = groupViewLabel(workspace, view, group.key);
          const label = rawLabel === "未分组" ? t("db.unassignedGroup") : rawLabel;
          return <tr key={row.key} className="db-table-group" data-group-key={group.key} data-measure-index={wrappedVirtual ? physicalIndex : undefined} data-measure-key={wrappedVirtual ? row.key : undefined} aria-rowindex={physicalIndex+2} style={virtual && !wrappedVirtual ? {height:TABLE_ROW_HEIGHT} : undefined}><th scope="rowgroup" colSpan={properties.length+2}>{label} <small>{group.items.length}</small></th></tr>;
        }
        const { item, index, key, depth, hasChildren } = row;
        const title = itemDisplayTitle(workspace, source, item);
        const itemLocked = recordLocked(item);
        const recordRuntime = itemLocked === locked ? runtime : { ...runtime, locked: itemLocked };
        return <tr key={key} data-item-id={item.id} data-item-group-key={row.groupKey ?? undefined} data-layout-index={index} data-row-drop={dropRow?.key === key ? dropRow.side : undefined}
          data-measure-index={wrappedVirtual ? physicalIndex : undefined} data-measure-key={wrappedVirtual ? key : undefined}
          aria-rowindex={physicalIndex + 2} style={virtual && !wrappedVirtual ? { height: TABLE_ROW_HEIGHT } : undefined}
          onDragOver={event => rowDrag(event, row)} onDragLeave={event => {
            if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDropRow(current => current?.key === key ? null : current);
          }} onDrop={event => {
            if (!event.dataTransfer.types.includes(rowDragType)) return;
            event.preventDefault();
            moveRow(draggingRow.current, row, rowDropSide(event));
            resetRowDrag();
          }}>
          <td className="db-selection-cell"><div className="db-row-controls">
            {canReorder && !itemLocked && <button type="button" className="db-table-row-grip" draggable aria-label={t("dbx.table.moveRecAria", { title })} title={t("dbx.table.moveRecTitle")}
              onDragStart={event => { draggingRow.current = row; event.dataTransfer.setData(rowDragType, item.id); event.dataTransfer.effectAllowed = "move"; }}
              onDragEnd={resetRowDrag} onKeyDown={event => rowKeyboard(event, row, physicalIndex)}><IconGripVertical size={15} aria-hidden="true" /></button>}
            <input type="checkbox" aria-label={t("dbx.table.selectRecAria", { title })} disabled={itemLocked} checked={selected.has(item.id)} onChange={(event) => setSelected((current) => { const next = new Set(current); if (event.target.checked) next.add(item.id); else next.delete(item.id); return next; })} />
            <button type="button" aria-label={t("dbx.table.recActionsAria", { title })} aria-haspopup="menu" onClick={(event) => openMenu("row", { itemId: item.id }, event.currentTarget)}>⋯</button>
          </div></td>
          {properties.map((property, columnIndex) => <td key={property.id} data-property-id={property.id} className={tableConfig.wrapPropertyIds.includes(property.id) ? "db-wrap-cell" : ""} tabIndex={activeCell.itemId === item.id && activeCell.propertyId === property.id ? 0 : -1}
            onFocus={() => setFocusedCell((current) => current?.itemId === item.id && current?.propertyId === property.id ? current : { itemId: item.id, propertyId: property.id })} onKeyDown={(event) => cellKeyboard(event, index, columnIndex)}>
          {property.type === "title" ? <div className="db-structure-title" style={hasChildren ? { paddingInlineStart: `${Math.min(depth, 8) * 15}px` } : undefined}>
            {hasChildren && <SubitemToggle title={title} collapsed={Boolean(collapsed?.has(item.id))} onToggle={() => setCollapsed(item.id, !collapsed?.has(item.id))} />}
            <DatabaseTitleCell title={String(item.values?.[property.id] ?? pagesById.get(item.pageId)?.title ?? "")} displayTitle={title} icon={pagesById.get(item.pageId)?.icon} iconColor={pagesById.get(item.pageId)?.iconColor} showIcon={view?.config?.showPageIcon !== false} depth={hasChildren ? 0 : Math.min(depth, 8)} locked={itemLocked} autoEdit={pendingCreate?.itemId === item.id && pendingCreate.pageId === item.pageId} onAutoEditStarted={() => { creatingRef.current = false; setPendingCreate(null); }} onChange={(value) => onUpdateItemValue?.(item.id, property.id, value)} onOpen={() => onOpenItemPage?.(item.pageId)} />
          </div> : property.type === "number" ? <DatabaseTableNumberCell key={`${view.id}:${property.id}`} property={property} value={resolvePropertyValue(workspace, source, item, property)} label={`${property.name} · ${title}`} locked={itemLocked} onChange={(value) => onUpdateItemValue?.(item.id, property.id, value)} onNext={() => focusCell(index + 1, columnIndex)} /> : <PropertyEditor workspace={workspace} source={source} item={item} property={property} compact={property.type === "text" && tableConfig.wrapPropertyIds.includes(property.id)} value={resolveDisplayPropertyValue(workspace, source, item, property)} runtime={recordRuntime} label={`${property.name} · ${title}`} onChange={(value) => onUpdateItemValue?.(item.id, property.id, value)} />}
        </td>)}<td className="db-subitem-cell"><button type="button" disabled={itemLocked || !onCreateItem} onClick={() => {
          setCollapsed(item.id, false);
          onCreateItem?.(source.id, { parentItemId: item.id, values: titleId ? { [titleId]: t("dbx.table.subitemDefault") } : {} });
        }}>{t("dbx.table.addSubitemBtn")}</button></td></tr>;
      })}{spacer(range.bottom, "bottom")}{!locked && onCreateItem && <tr className="db-table-create-row"><td colSpan={properties.length + 2}><button type="button" className="db-table-create" onClick={createAtEnd}>{t("dbx.table.addTableRow")}</button></td></tr>}</tbody>
      <tfoot><tr><td />{properties.map((property) => {
        const calculation = tableConfig.calculations[property.id] || "none";
        const stat = calculation === "none" ? { text: "" } : computeColumnStat(workspace, source, scopedItems, property, calculation);
        return <td key={property.id}><button type="button" className={`db-column-stat${calculation === "none" ? " is-empty" : ""}`} aria-label={t("dbx.table.statAria", { name: property.name })} aria-haspopup="menu" disabled={locked} onClick={(event) => openMenu("stat", { propertyId: property.id }, event.currentTarget)}>{calculation === "none" ? t("db.ui.calculate") : <><span>{CALCULATIONS[calculation]}</span>{" "}<strong>{stat.text}</strong></>}</button></td>;
      })}<td /></tr></tfoot>
    </table>{!items.length && <p className="db-surface-message">{t("db.ui.emptyTable")}</p>}
    </div>
    {menu?.kind === "property" && menuProperty && !locked && <TableMenu anchor={menu.anchor} label={t("dbx.table.propMenuAria", { name: menuProperty.name })} onClose={closeMenu} restoreFocusRef={menuRestoreFocus}>
      <div className="db-property-menu-identity"><PropertyName key={menuProperty.id} property={menuProperty} properties={source.properties} onRename={onRenameProperty} /><small>{propTypeLabel(menuProperty.type)}</small></div>
      <button type="button" role="menuitem" onClick={() => { menuRestoreFocus.current = false; closeMenu(); onEditProperty?.(menuProperty, menu.anchor); }}>{t("dbx.table.editPropEllipsis")}</button>
      {conversionTargets.length > 0 && runtime?.changePropertyType && <><button type="button" role="menuitem" aria-haspopup="menu" aria-expanded={typeMenuOpen} onClick={() => setTypeMenuOpen(!typeMenuOpen)}>{t("db.ui.changeType")}</button>{typeMenuOpen && <div className="db-type-submenu">{conversionTargets.map((type) => <button type="button" role="menuitem" key={type} onClick={() => changeType(menuProperty, type)}>{propTypeLabel(type)}</button>)}</div>}</>}
      <button type="button" role="menuitem" onClick={() => { onUpdateView?.(view.id, { sorts: [{ propertyId: menuProperty.id, direction: "asc" }] }); closeMenu(); }}>{t("db.ui.sortAsc")}</button>
      <button type="button" role="menuitem" onClick={() => { onUpdateView?.(view.id, { sorts: [{ propertyId: menuProperty.id, direction: "desc" }] }); closeMenu(); }}>{t("db.ui.sortDesc")}</button>
      <button type="button" role="menuitem" onClick={() => addFilter(menuProperty)}>{t("dbx.table.filterEllipsis")}</button>
      {menuProperty.type !== "title" && <button type="button" role="menuitem" onClick={() => { onUpdateView?.(view.id, { visiblePropertyIds: propertyIds.filter((id) => id !== menuProperty.id) }); closeMenu(); }}>{t("db.ui.hideProp")}</button>}
      <button type="button" role="menuitemcheckbox" aria-checked={tableConfig.wrapPropertyIds.includes(menuProperty.id)} onClick={() => { updateTable({ wrapPropertyIds: tableConfig.wrapPropertyIds.includes(menuProperty.id) ? tableConfig.wrapPropertyIds.filter((id) => id !== menuProperty.id) : [...tableConfig.wrapPropertyIds, menuProperty.id] }); closeMenu(); }}>{t("db.ui.wrapCell")}</button>
      {propertyIndex > 1 && <button type="button" role="menuitem" onClick={() => { moveColumn(menuProperty.id, propertyIndex - 1); closeMenu(); }}>{t("db.ui.moveLeft")}</button>}
      {propertyIndex > 0 && propertyIndex < propertyIds.length - 1 && <button type="button" role="menuitem" onClick={() => { moveColumn(menuProperty.id, propertyIndex + 1); closeMenu(); }}>{t("db.ui.moveRight")}</button>}
      {menuProperty.type !== "title" && runtime?.deleteDatabaseProperty && <button type="button" className="is-danger" role="menuitem" onClick={() => deleteColumn(menuProperty)}>{t("db.ui.deleteProp")}</button>}
    </TableMenu>}
    {menu?.kind === "stat" && menuProperty && !locked && <TableMenu anchor={menu.anchor} label={t("dbx.table.statMenuAria", { name: menuProperty.name })} onClose={closeMenu}>{availableCalculations(menuProperty).map((calculation) => <button type="button" role="menuitemradio" aria-checked={(tableConfig.calculations[menuProperty.id] || "none") === calculation} key={calculation} onClick={() => { updateTable({ calculations: { ...tableConfig.calculations, [menuProperty.id]: calculation } }); closeMenu(); }}>{CALCULATIONS[calculation]}</button>)}</TableMenu>}
    {menu?.kind === "row" && menuItem && <TableMenu anchor={menu.anchor} label={t("dbx.table.recMenuAria", { title: itemDisplayTitle(workspace, source, menuItem) })} onClose={closeMenu} restoreFocusRef={menuRestoreFocus}>
      <button type="button" role="menuitem" onClick={() => { menuRestoreFocus.current = false; closeMenu(); (onPeekItemPage || onOpenItemPage)?.(menuItem.pageId, menu.anchor); }}>{t("dbx.cal.openBtn")}</button>
      <button type="button" role="menuitem" onClick={() => { closeMenu(); (onOpenItemFullPage || onOpenItemPage)?.(menuItem.pageId); }}>{t("dbx.table.openFullBtn")}</button>
      {!recordLocked(menuItem) && runtime?.setDatabaseItemParent && <button type="button" role="menuitem" onClick={() => openStructure("parent")}>{t("db.ui.editParent")}</button>}
      {!recordLocked(menuItem) && runtime?.setItemDependencies && <button type="button" role="menuitem" onClick={() => openStructure("dependencies")}>{t("db.ui.editDeps")}{menuItem.dependencyIds?.length ? ` (${menuItem.dependencyIds.length})` : ""}…</button>}
      {!recordLocked(menuItem) && runtime?.duplicateDatabaseItem && <button type="button" role="menuitem" onClick={() => { closeMenu(); runtime.duplicateDatabaseItem(menuItem.id); }}>{t("db.ui.dupRecord")}</button>}
      {!recordLocked(menuItem) && runtime?.trashDatabaseItems && <button type="button" className="is-danger" role="menuitem" onClick={() => trashItems([menuItem.id])}>{t("dbx.table.trashTitle")}</button>}
    </TableMenu>}
    {["parent", "dependencies"].includes(menu?.kind) && menuItem && !recordLocked(menuItem) && <DatabasePopover anchor={menu.anchor} label={menu.kind === "parent" ? t("db.ui.editParent").replace("…", "") : t("db.ui.editDeps")} className="db-view-settings-panel" onClose={closeStructure}>
      <RecordStructureForm key={`${menu.kind}:${menuItem.id}`} kind={menu.kind} workspace={workspace} source={source} item={menuItem} onClose={closeStructure}
        onApply={(value) => menu.kind === "parent" ? runtime.setDatabaseItemParent(menuItem.id, value) : runtime.setItemDependencies(menuItem.id, value)} />
    </DatabasePopover>}
  </div>;
}
