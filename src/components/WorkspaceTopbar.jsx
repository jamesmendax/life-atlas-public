import IconChevronLeft from "@tabler/icons-react/dist/esm/icons/IconChevronLeft.mjs";
import IconChevronRight from "@tabler/icons-react/dist/esm/icons/IconChevronRight.mjs";
import IconSearch from "@tabler/icons-react/dist/esm/icons/IconSearch.mjs";
import IconSun from "@tabler/icons-react/dist/esm/icons/IconSun.mjs";
import IconMoon from "@tabler/icons-react/dist/esm/icons/IconMoon.mjs";
import IconCircleHalf2 from "@tabler/icons-react/dist/esm/icons/IconCircleHalf2.mjs";
import IconLayoutSidebarLeftExpand from "@tabler/icons-react/dist/esm/icons/IconLayoutSidebarLeftExpand.mjs";
import { useI18n } from "../i18n/workspaceRuntime.js";
import { getThemeLabels } from "../ui/theme.js";
import { WorkspaceBreadcrumb } from "./WorkspaceBreadcrumb.jsx";

export function WorkspaceTopbar({
  activeSection,
  sectionTitle,
  breadcrumbPath = [],
  onOpenBreadcrumb,
  onOpenLibrary,
  onSearch,
  actions = null,
  themePreference = "system",
  onCycleTheme,
  canGoBack = false,
  canGoForward = false,
  onBack,
  onForward,
  sidebarCollapsed = false,
  onExpandSidebar,
}) {
  const { t } = useI18n();
  const themeLabels = getThemeLabels(t);
  return (
    <header className="workspace-header workspace-topbar">
      <div className="header-navigation">
        {sidebarCollapsed && <button type="button" className="header-nav-button ui-icon-button" aria-label={t("topbar.expandSidebar")} onClick={onExpandSidebar}><IconLayoutSidebarLeftExpand size={18} /></button>}
        <button type="button" className="header-nav-button ui-icon-button" aria-label={t("nav.back")} disabled={!canGoBack} onClick={onBack}><IconChevronLeft size={18} /></button>
        <button type="button" className="header-nav-button ui-icon-button" aria-label={t("nav.forward")} disabled={!canGoForward} onClick={onForward}><IconChevronRight size={18} /></button>
      </div>
      {activeSection === "private"
        ? <WorkspaceBreadcrumb path={breadcrumbPath} onOpen={onOpenBreadcrumb} onOpenRoot={onOpenLibrary} />
        : <div className="breadcrumb" aria-label={t("topbar.locationAria")}>{sectionTitle}</div>}
      <div className="header-actions">
        <button type="button" className="header-theme-toggle ui-icon-button" aria-label={t("topbar.themeToggleAria")} title={t("topbar.themeTitle", { label: themeLabels[themePreference] })} onClick={onCycleTheme}>
          {themePreference === "light" ? <IconSun size={16} /> : themePreference === "dark" ? <IconMoon size={16} /> : <IconCircleHalf2 size={16} />}
        </button>
        <button type="button" className="header-search ui-control" onClick={onSearch}>
          <IconSearch size={14} />
          <span>{t("common.search")}</span>
        </button>
        {actions}
      </div>
    </header>
  );
}
