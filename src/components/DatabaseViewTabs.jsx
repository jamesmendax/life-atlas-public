import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import IconCheck from "@tabler/icons-react/dist/esm/icons/IconCheck.mjs";
import IconPlus from "@tabler/icons-react/dist/esm/icons/IconPlus.mjs";
import IconSearch from "@tabler/icons-react/dist/esm/icons/IconSearch.mjs";
import { DatabasePopover } from "./DatabaseViewSettings.jsx";
import { readDevicePreferences, subscribeDevicePreferences } from "../ui/devicePreferences.js";

const getDisplay = () => readDevicePreferences().databaseViewTabDisplay;

// The strip owns only width and focus. Source order and selection stay with DatabaseView.
export function DatabaseViewTabs({ views, activeId, sourceTitle, tabsRef, addButtonRef, viewIcons, getLabel, onSelectView, onOpenMenu, onAddView }) {
  const measureRef = useRef(null);
  const moreRef = useRef(null);
  const pendingFocus = useRef(null);
  const [layout, setLayout] = useState({ ids: [], available: null, activeMaxWidth: null });
  const [menuOpen, setMenuOpen] = useState(false);
  const [query, setQuery] = useState("");
  const display = useSyncExternalStore(subscribeDevicePreferences, getDisplay, () => "icon-text");
  const labels = views.map(getLabel);
  const measurementKey = JSON.stringify([display, ...views.map((entry, index) => [entry.id, entry.type, labels[index]])]);
  const active = views.find((entry) => entry.id === activeId) || views[0];
  const visible = views.filter((entry) => layout.ids.includes(entry.id) || entry.id === active?.id);
  const remaining = views.length - visible.length;
  const filtered = views.filter((entry, index) => labels[index].toLowerCase().includes(query.trim().toLowerCase()));
  const face = (entry, label) => {
    const Icon = viewIcons[entry.type];
    return <>{display !== "text" && Icon && <Icon size={14} aria-hidden="true" />}{(display !== "icon" || !Icon) && <span className="db-v10-view-label">{label}</span>}</>;
  };

  useLayoutEffect(() => {
    const strip = tabsRef.current;
    const area = strip?.parentElement;
    const rack = measureRef.current;
    if (!area || !rack || !active) return;
    let frame;
    const measure = () => {
      const areaStyle = getComputedStyle(area);
      const add = addButtonRef.current;
      const addStyle = add ? getComputedStyle(add) : null;
      const addWidth = add ? add.getBoundingClientRect().width + (parseFloat(addStyle.marginLeft) || 0) + (parseFloat(addStyle.marginRight) || 0) + (parseFloat(areaStyle.columnGap) || 0) : 0;
      const available = Math.max(0, area.clientWidth - (parseFloat(areaStyle.paddingLeft) || 0) - (parseFloat(areaStyle.paddingRight) || 0) - addWidth);
      const gap = parseFloat(getComputedStyle(strip).columnGap) || 0;
      const widths = new Map([...rack.querySelectorAll("[data-measure-view]")].map(element => [element.dataset.measureView, element.getBoundingClientRect().width]));
      const moreWidths = new Map([...rack.querySelectorAll("[data-measure-more]")].map(element => [Number(element.dataset.measureMore), element.getBoundingClientRect().width]));
      const tabsWidth = entries => entries.reduce((sum, entry) => sum + (widths.get(entry.id) || 0), 0) + Math.max(0, entries.length - 1) * gap;
      let shown = views;
      let activeMaxWidth = null;
      if (tabsWidth(views) > available) {
        shown = [active];
        // Largest leading prefix plus the current view, still in source order.
        for (let prefix = views.length - 1; prefix >= 0; prefix -= 1) {
          const candidate = views.filter((entry, index) => index < prefix || entry.id === active.id);
          const hidden = views.length - candidate.length;
          if (hidden && tabsWidth(candidate) + gap + moreWidths.get(hidden) <= available) { shown = candidate; break; }
        }
        const hidden = views.length - shown.length;
        if (shown.length === 1 && hidden) activeMaxWidth = Math.max(0, available - gap - moreWidths.get(hidden));
        if (shown.length === 1 && !hidden) activeMaxWidth = available;
      }
      const next = { ids: shown.map(entry => entry.id), available, activeMaxWidth };
      setLayout(current => current.available === next.available && current.activeMaxWidth === next.activeMaxWidth && current.ids.join("\n") === next.ids.join("\n") ? current : next);
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    measure();
    const observer = new ResizeObserver(schedule);
    observer.observe(area);
    if (addButtonRef.current) observer.observe(addButtonRef.current);
    for (const element of rack.children) observer.observe(element);
    document.fonts.ready.then(schedule);
    document.fonts.addEventListener("loadingdone", schedule);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); document.fonts.removeEventListener("loadingdone", schedule); };
  }, [measurementKey, activeId, Boolean(onAddView)]);

  useLayoutEffect(() => {
    if (!pendingFocus.current) return;
    const tab = [...(tabsRef.current?.querySelectorAll('[role="tab"]') || [])].find(element => element.dataset.viewId === pendingFocus.current);
    if (tab) { tab.focus(); pendingFocus.current = null; }
  }, [activeId, layout, menuOpen]);

  useLayoutEffect(() => { if (!remaining) setMenuOpen(false); }, [remaining]);
  const closeMenu = (restoreFocus = true) => {
    setMenuOpen(false);
    if (restoreFocus) requestAnimationFrame(() => moreRef.current?.focus());
  };
  const choose = id => { pendingFocus.current = id; closeMenu(false); onSelectView(id); };
  const menuKeys = event => {
    if (event.nativeEvent.isComposing) return;
    const buttons = [...event.currentTarget.querySelectorAll('[role="menuitemradio"], [role="menuitem"]')];
    const inSearch = event.target.tagName === "INPUT";
    if (inSearch && event.key === "Enter" && filtered.length) {
      event.preventDefault();
      choose((query.trim() ? filtered[0] : filtered.find(entry => entry.id === activeId) || filtered[0]).id);
      return;
    }
    if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key) || (inSearch && ["Home", "End"].includes(event.key)) || !buttons.length) return;
    event.preventDefault();
    const index = buttons.indexOf(event.target);
    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : index < 0 ? (event.key === "ArrowDown" ? 0 : buttons.length - 1) : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  };

  return <div ref={tabsRef} className="db-view-tabs db-v10-view-tabs" role="tablist" aria-label="数据库视图" data-tab-display={display} style={layout.available === null ? undefined : { maxWidth: layout.available }} onKeyDown={event => {
    if (event.target.getAttribute("role") !== "tab" || event.nativeEvent.isComposing || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const current = views.findIndex(entry => entry.id === activeId);
    const next = event.key === "Home" ? 0 : event.key === "End" ? views.length - 1 : (current + (event.key === "ArrowRight" ? 1 : -1) + views.length) % views.length;
    choose(views[next].id);
  }}>
    {visible.map(entry => {
      const label = getLabel(entry);
      return <button type="button" role="tab" data-view-id={entry.id} aria-label={label} title={label} aria-selected={activeId === entry.id} tabIndex={activeId === entry.id ? 0 : -1} className={"db-v10-view-tab" + (activeId === entry.id ? " is-active" : "")} key={entry.id} style={activeId === entry.id && layout.activeMaxWidth !== null ? { maxWidth: layout.activeMaxWidth } : undefined} onClick={() => choose(entry.id)}>{face(entry, label)}</button>;
    })}
    {remaining > 0 && <button ref={moreRef} type="button" className="db-v10-view-more" aria-haspopup="dialog" aria-expanded={menuOpen} onClick={() => { if (menuOpen) closeMenu(false); else { onOpenMenu(); setQuery(""); setMenuOpen(true); } }}>更多{remaining}个…</button>}
    <div ref={measureRef} className="db-v10-view-measure" aria-hidden="true">
      {views.map((entry, index) => <span key={entry.id} className="db-v10-view-tab" data-measure-view={entry.id}>{face(entry, labels[index])}</span>)}
      {views.map((entry, index) => <span key={index} className="db-v10-view-more" data-measure-more={index + 1}>更多{index + 1}个…</span>)}
    </div>
    {menuOpen && remaining > 0 && <DatabasePopover anchor={moreRef.current} label={"全部视图：" + sourceTitle} className="db-v10-view-menu" onClose={closeMenu}>
      <div onKeyDown={menuKeys}>
        <label className="db-v10-view-search"><IconSearch size={14} aria-hidden="true" /><input type="search" data-popover-initial aria-label="搜索视图" placeholder="搜索视图…" value={query} onChange={event => setQuery(event.target.value)} /></label>
        <div className="db-v10-view-menu-list" role="menu" aria-label={sourceTitle + "的视图"}>
          {filtered.map(entry => { const label = getLabel(entry); return <button type="button" role="menuitemradio" data-view-id={entry.id} aria-label={label} title={label} aria-checked={entry.id === activeId} key={entry.id} onClick={() => choose(entry.id)}>{face(entry, label)}{entry.id === activeId && <IconCheck size={15} aria-hidden="true" />}</button>; })}
          {!filtered.length && <p className="db-v10-view-no-results">没有匹配的视图</p>}
          {onAddView && <button type="button" role="menuitem" className="db-v10-view-menu-create" onClick={() => { closeMenu(false); onAddView(); }}><IconPlus size={14} aria-hidden="true" /><span>新建视图</span></button>}
        </div>
      </div>
    </DatabasePopover>}
  </div>;
}
