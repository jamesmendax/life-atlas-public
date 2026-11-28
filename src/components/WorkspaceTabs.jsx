import { useEffect, useId, useRef, useState } from "react";
import IconDots from "@tabler/icons-react/dist/esm/icons/IconDots.mjs";
import IconPlus from "@tabler/icons-react/dist/esm/icons/IconPlus.mjs";
import IconX from "@tabler/icons-react/dist/esm/icons/IconX.mjs";
import { AppearanceGlyph } from "./AppearanceGlyph.jsx";
import { WorkspaceNavigationMenu } from "./WorkspaceNavigationMenu.jsx";
import { useI18n } from "../i18n/workspaceRuntime.js";

export function WorkspaceTabs({ pages, activePageId, panelId, onActivate, onClose, onCloseOthers, onOpenPicker }) {
  const { t } = useI18n();
  const untitled = t("backlinks.untitled");
  const menuId = useId();
  const [menu, setMenu] = useState(null);
  const tabRefs = useRef(new Map());
  const fallbackRef = useRef(null);
  const current = pages.find((page) => page.id === activePageId);
  const menuPage = menu && pages.find((page) => page.id === menu.pageId);
  const tabIndexId = current?.id ?? pages[0]?.id;

  useEffect(() => {
    const tab = tabRefs.current.get(activePageId);
    const list = tab?.closest(".workspace-page-tabs");
    if (!list) return;
    const bounds = list.getBoundingClientRect();
    const target = tab.getBoundingClientRect();
    if (target.left < bounds.left) list.scrollLeft -= bounds.left - target.left;
    else if (target.right > bounds.right) list.scrollLeft += target.right - bounds.right;
  }, [activePageId]);

  function focusTab(id) {
    tabRefs.current.get(id)?.focus({ preventScroll: true });
  }

  function close(pageId) {
    const index = pages.findIndex((page) => page.id === pageId);
    const next = pages[index + 1] ?? pages[index - 1];
    setMenu(null);
    onClose(pageId);
    if (next) focusTab(pageId === activePageId ? next.id : activePageId ?? next.id);
    else fallbackRef.current?.focus();
  }

  return <div className="workspace-tabs-bar">
    <div className="workspace-page-tabs" role="tablist" aria-label={t("tabs.listAria")} onKeyDown={(event) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const tab = event.target.closest("[role='tab']");
      if (!tab) return;
      const index = pages.findIndex((page) => page.id === tab.dataset.pageId);
      if (event.key === "Delete") {
        event.preventDefault();
        close(pages[index].id);
      } else if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        const next = event.key === "Home" ? pages[0] : event.key === "End" ? pages.at(-1)
          : pages[(index + (event.key === "ArrowRight" ? 1 : -1) + pages.length) % pages.length];
        onActivate(next.id);
        focusTab(next.id);
      }
    }}>
      {pages.map((page) => {
        const pageTitle = page.title || untitled;
        return <div key={page.id} role="presentation" className={`workspace-tab${page.id === activePageId ? " is-active" : ""}`}>
        <button
          ref={(node) => { if (node) tabRefs.current.set(page.id, node); else tabRefs.current.delete(page.id); }}
          type="button"
          id={`workspace-tab-${page.id}`}
          className="workspace-tab-trigger"
          role="tab"
          data-page-id={page.id}
          aria-selected={page.id === activePageId}
          aria-controls={page.id === activePageId ? panelId : undefined}
          tabIndex={page.id === tabIndexId ? 0 : -1}
          title={pageTitle}
          onClick={() => onActivate(page.id)}
          onContextMenu={(event) => { event.preventDefault(); setMenu({ anchor: event.currentTarget, pageId: page.id, focusIndex: event.detail === 0 ? 0 : null }); }}
          onAuxClick={(event) => { if (event.button === 1) { event.preventDefault(); close(page.id); } }}
        >
          <AppearanceGlyph icon={page.icon} color={page.iconColor} className="workspace-navigation-menu-icon" />
          <span>{pageTitle}</span>
        </button>
        <button type="button" className="workspace-tab-close ui-icon-button" aria-label={t("tabs.closeTabAria", { title: pageTitle })} title={t("tabs.closeTabTitle")} tabIndex={-1} onClick={() => close(page.id)}><IconX size={13} /></button>
      </div>;
      })}
    </div>
    {current && <button type="button" className="workspace-tab-button ui-icon-button" aria-label={t("tabs.optionsAria")} aria-haspopup="menu" aria-expanded={Boolean(menu)} aria-controls={menu ? menuId : undefined} onClick={(event) => setMenu(menu ? null : { anchor: event.currentTarget, pageId: current.id, focusIndex: 0 })}><IconDots size={15} /></button>}
    <button ref={fallbackRef} type="button" className="workspace-tab-button ui-icon-button" aria-label={t("tabs.newTabAria")} title={t("tabs.newTabTitle")} onClick={onOpenPicker}><IconPlus size={16} /></button>
    {menuPage && <WorkspaceNavigationMenu id={menuId} label={t("tabs.optionsAria")} anchor={menu.anchor} focusIndex={menu.focusIndex} onDismiss={(restoreFocus) => { setMenu(null); if (restoreFocus) menu.anchor.focus(); }}>
      <button type="button" role="menuitem" tabIndex={-1} className="workspace-navigation-menu-row" onClick={() => close(menuPage.id)}>{t("tabs.closeTabTitle")}</button>
      <button type="button" role="menuitem" tabIndex={-1} className="workspace-navigation-menu-row" disabled={pages.length < 2} onClick={() => { setMenu(null); onCloseOthers(menuPage.id); focusTab(menuPage.id); }}>{t("tabs.closeOtherTabs")}</button>
    </WorkspaceNavigationMenu>}
  </div>;
}
