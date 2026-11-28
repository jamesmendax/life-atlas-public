import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import IconPencil from "@tabler/icons-react/dist/esm/icons/IconPencil.mjs";
import IconPlus from "@tabler/icons-react/dist/esm/icons/IconPlus.mjs";
import { groupViewItems, groupViewLabel, resolveDisplayPropertyValue, resolvePropertyValue } from "../domain/database.js";
import { formatPropertyValue, isEmptyProperty } from "../domain/databaseProperties.js";
import { listVisiblePropertyIds } from "../domain/viewRegistry.js";
import { tableRowWindow } from "../domain/tableVirtualization.js";
import { filterSubitems, subitemRows, subitemViewConfig } from "../domain/databaseSubitems.js";
import { AppearanceGlyph, SpriteIcon } from "./AppearanceGlyph.jsx";
import { PropertyEditor } from "./PropertyEditor.jsx";
import { DatabasePopover } from "./DatabaseViewSettings.jsx";
import { SubitemToggle } from "./DatabaseStructureControls.jsx";
import { useI18n } from "../i18n/workspaceRuntime.js";

const listRowHeight = 40;

function ListTextProperty({ workspace, source, property, value, runtime, locked, label, onChange }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const anchor = useRef(null);
  const editor = useRef(null);
  const enter = useRef(false);
  const close = (focus) => {
    if (!focus && editor.current?.contains(document.activeElement)) { document.activeElement.blur(); return; }
    setOpen(false);
    if (focus) requestAnimationFrame(() => anchor.current?.focus());
  };
  const display = formatPropertyValue(workspace, property, value);
  if (locked) return <span className="db-list-readonly" title={display}>{display}</span>;
  return <><button ref={anchor} type="button" className="db-list-value" title={display} aria-label={label} onClick={() => setOpen(true)}>{display}</button>
    {open && <DatabasePopover anchor={anchor.current} label={t("dbx.table.editPropHeaderAria", { name: label })} className="db-list-editor-popover" onClose={close}>
      <div ref={editor} onKeyDownCapture={(event) => {
        if (event.key === "Escape" && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); close(true); }
        else if (event.key === "Enter" && !event.nativeEvent.isComposing) enter.current = true;
      }} onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget)) return;
        const restore = enter.current; enter.current = false;
        const field = event.target;
        requestAnimationFrame(() => {
          if (field.getAttribute("aria-invalid") === "true") { field.focus(); return; }
          setOpen(false);
          if (restore) requestAnimationFrame(() => anchor.current?.focus());
        });
      }}><PropertyEditor workspace={workspace} source={source} property={property} value={value} runtime={runtime} label={label} onChange={onChange} compact /></div>
    </DatabasePopover>}
  </>;
}

export function DatabaseList({ workspace, source, view, items, onOpenItemPage, onCreateItem, onUpdateItemValue, runtime, searchQuery }) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(null);
  const [viewport, setViewport] = useState({ scrollTop: 0, height: 600 });
  const [collapse, setCollapse] = useState({ viewId: view.id, searchQuery, ids: new Set() });
  const collapsed = collapse.viewId === view.id && collapse.searchQuery === searchQuery ? collapse.ids : undefined;
  const toggle = (id) => setCollapse((current) => {
    const ids = new Set(current.viewId === view.id && current.searchQuery === searchQuery ? current.ids : []);
    if (!ids.delete(id)) ids.add(id);
    return { viewId: view.id, searchQuery, ids };
  });
  const cancelBlur = useRef(false);
  const rowRefs = useRef(new Map());
  const container = useRef(null);
  const pendingFrame = useRef(0);
  const pages = useMemo(() => new Map((workspace.pages || []).map(page => [page.id, page])), [workspace.pages]);
  const titleProperty = source.properties.find((property) => property.type === "title");
  const properties = listVisiblePropertyIds(source, view).map((id) => source.properties.find((property) => property.id === id)).filter((property) => property && property.type !== "title");
  const groupPropertyId = view.grouping ? view.grouping.primaryPropertyId : view.groupBy;
  const grouped = source.properties.some(property => property.id === groupPropertyId);
  const { display, filter } = subitemViewConfig(view);
  const { rows, visibleCount } = useMemo(() => {
    const scoped = filterSubitems(items, filter);
    if (!grouped) {
      const records = subitemRows(scoped, display, collapsed);
      return { rows: records.map((row, index) => ({ ...row, key: row.item.id, position: index + 1 })), visibleCount: records.length };
    }
    const rows = [];
    let position = 0;
    for (const group of groupViewItems(workspace, view, scoped)) {
      const label = groupViewLabel(workspace, view, group.key);
      rows.push({ group, label, key: JSON.stringify([group.key]) });
      for (const row of subitemRows(group.items, display, collapsed)) {
        rows.push({ ...row, groupKey: group.key, label, key: JSON.stringify([group.key, row.item.id]), position: ++position });
      }
    }
    return { rows, visibleCount: position };
  }, [grouped, workspace, view, items, display, filter, collapsed]);
  const virtual = rows.length > 200;
  const range = virtual ? tableRowWindow({
    count: rows.length, scrollTop: viewport.scrollTop, viewportHeight: viewport.height, rowHeight: listRowHeight,
  }) : { start: 0, end: rows.length, top: 0, bottom: 0 };
  const measure = () => {
    const host = container.current;
    if (host) setViewport({ scrollTop: host.scrollTop, height: host.clientHeight });
  };
  useEffect(() => { setEditing(null); }, [source.id, view.id, runtime?.locked]);
  useLayoutEffect(() => {
    if (!virtual || !container.current) return undefined;
    const resize = new ResizeObserver(measure);
    resize.observe(container.current);
    measure();
    return () => { resize.disconnect(); cancelAnimationFrame(pendingFrame.current); pendingFrame.current = 0; };
  }, [virtual]);
  useLayoutEffect(() => {
    if (container.current) container.current.scrollTop = 0;
  }, [source.id, view.id, view.filter, view.sorts, view.grouping, groupPropertyId, display, filter, searchQuery]);
  const finish = (save, restoreFocus = false) => {
    const current = editing;
    if (!current) return;
    if (save && titleProperty && current.value !== current.original) onUpdateItemValue?.(current.id, titleProperty.id, current.value);
    setEditing(null);
    if (restoreFocus) requestAnimationFrame(() => rowRefs.current.get(current.key)?.focus());
  };
  const start = (id, key, title) => { cancelBlur.current = false; setEditing({ id, key, value: title, original: title }); };
  const create = (event) => {
    if (runtime?.locked || !onCreateItem) return;
    const created = onCreateItem(source.id, {});
    if (!created?.itemId || !created?.pageId) return;
    if (grouped || filter === "children") onOpenItemPage?.(created.pageId, event.currentTarget);
    else start(created.itemId, created.itemId, "");
  };
  useLayoutEffect(() => {
    if (!virtual || !editing?.key || !container.current) return;
    const index = rows.findIndex(row => row.key === editing.key);
    if (index < 0 || index >= range.start && index < range.end) return;
    container.current.scrollTop = Math.max(0, index * listRowHeight - container.current.clientHeight / 2);
    measure();
  }, [virtual, editing?.key, rows]);
  const onScroll = () => {
    if (!virtual || pendingFrame.current) return;
    pendingFrame.current = requestAnimationFrame(() => {
      pendingFrame.current = 0;
      if (editing?.key) {
        const input = rowRefs.current.get(editing.key)?.querySelector(".db-list-title-input");
        const row = input?.closest(".db-list-row")?.getBoundingClientRect();
        const viewport = container.current?.getBoundingClientRect();
        if (row && viewport && (row.bottom < viewport.top || row.top > viewport.bottom)) input.blur();
      }
      measure();
    });
  };
  return <div ref={container} onScroll={onScroll} className={`db-list-view${virtual ? " is-virtual" : ""}`} role="list" aria-label={`${source.title} · ${view.name}`}
    style={virtual ? { "--db-list-row-height": listRowHeight + "px" } : undefined}>
    {range.top > 0 && <div aria-hidden="true" style={{ height: range.top }} />}
    {rows.slice(range.start, range.end).map(({ group, item, key, label, groupKey, position, depth, hasChildren }) => {
    const groupLabel = label === "未分组" ? t("db.unassignedGroup") : label;
    if (group) return <div key={key} role="presentation" className="db-list-group" data-group-key={group.key}>
      <h3>{groupLabel}</h3><small>{group.items.length}</small>
    </div>;
    const page = pages.get(item.pageId);
    const locked = Boolean(runtime?.locked || page?.settings?.locked);
    const rawTitle = titleProperty ? resolvePropertyValue(workspace, source, item, titleProperty) : page?.title;
    const title = String(rawTitle ?? page?.title ?? "");
    const display = title || page?.title || t("dbx.untitled");
    const active = editing?.key === key;
    const shown = properties.map((property) => ({ property, value: resolveDisplayPropertyValue(workspace, source, item, property) })).filter(({ property, value }) => property.type === "button" || !isEmptyProperty(value));
    return <div className="db-list-row" role="listitem" aria-posinset={position} aria-setsize={visibleCount} aria-description={groupLabel}
      data-item-id={item.id} data-group-key={groupKey} key={key} tabIndex={-1} ref={(node) => { if (node) rowRefs.current.set(key, node); else rowRefs.current.delete(key); }}>
      <div className="db-list-heading" style={depth ? { paddingInlineStart: `${Math.min(depth, 8) * 15}px` } : undefined}>
        {hasChildren && <SubitemToggle title={display} collapsed={Boolean(collapsed?.has(item.id))} onToggle={() => toggle(item.id)} />}
        {view?.config?.showPageIcon !== false && <span className="db-list-icon" aria-hidden="true">{page?.icon ? <AppearanceGlyph icon={page.icon} color={page.iconColor} /> : <SpriteIcon id="file-description" size={16} />}</span>}
        {active ? <input autoFocus className="db-list-title-input" placeholder={t("dbx.list.typeNamePh")} aria-label={t("dbx.peek.recordTitleAria")} value={editing.value} onChange={(event) => setEditing({ ...editing, value: event.target.value })} onBlur={() => { if (cancelBlur.current) { cancelBlur.current = false; return; } finish(true); }} onKeyDown={(event) => {
          if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); cancelBlur.current = true; finish(true, true); }
          if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); cancelBlur.current = true; finish(false, true); }
        }} /> : <button type="button" title={display} className={`db-list-open${title ? "" : " is-empty"}`} onClick={(event) => onOpenItemPage?.(item.pageId, event.currentTarget)}>{display}</button>}
        {!active && !locked && <button type="button" className="db-list-edit" aria-label={t("dbx.list.editTitleAria", { title: display })} onClick={() => start(item.id, key, title)}><IconPencil size={14} aria-hidden="true" /></button>}
      </div>
      {shown.length > 0 && <div className="db-list-properties">{shown.map(({ property, value }) => <div className="db-list-property" data-property-id={property.id} key={property.id} title={property.name}>{["text", "number"].includes(property.type) ? <ListTextProperty workspace={workspace} source={source} property={property} value={value} runtime={runtime} locked={locked} label={`${property.name} · ${display}`} onChange={(next) => onUpdateItemValue?.(item.id, property.id, next)} /> : locked && property.type === "checkbox" ? <input type="checkbox" disabled checked={Boolean(value)} aria-label={`${property.name} · ${display}`} /> : <PropertyEditor workspace={workspace} source={source} item={item} property={property} value={value} runtime={runtime} disabled={locked} label={`${property.name} · ${display}`} onChange={(next) => onUpdateItemValue?.(item.id, property.id, next)} />}</div>)}</div>}
    </div>;
  })}
    {range.bottom > 0 && <div aria-hidden="true" style={{ height: range.bottom }} />}
    {!runtime?.locked && onCreateItem && <button type="button" className="db-list-create" aria-label={t("dbx.list.newPageBtn")} onClick={create}><IconPlus size={14} aria-hidden="true" />{t("dbx.list.newPageBtn")}</button>}
  </div>;
}
