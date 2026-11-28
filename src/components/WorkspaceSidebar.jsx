import { useEffect, useMemo, useRef, useState } from "react";
import IconChevronDown from "@tabler/icons-react/dist/esm/icons/IconChevronDown.mjs";
import IconChevronRight from "@tabler/icons-react/dist/esm/icons/IconChevronRight.mjs";
import IconDots from "@tabler/icons-react/dist/esm/icons/IconDots.mjs";
import IconBooks from "@tabler/icons-react/dist/esm/icons/IconBooks.mjs";
import IconFileDescription from "@tabler/icons-react/dist/esm/icons/IconFileDescription.mjs";
import IconHome2 from "@tabler/icons-react/dist/esm/icons/IconHome2.mjs";
import IconPlus from "@tabler/icons-react/dist/esm/icons/IconPlus.mjs";
import IconSearch from "@tabler/icons-react/dist/esm/icons/IconSearch.mjs";
import IconTrash from "@tabler/icons-react/dist/esm/icons/IconTrash.mjs";
import IconLock from "@tabler/icons-react/dist/esm/icons/IconLock.mjs";
import IconLockOpen from "@tabler/icons-react/dist/esm/icons/IconLockOpen.mjs";
import IconTemplate from "@tabler/icons-react/dist/esm/icons/IconTemplate.mjs";
import IconPencil from "@tabler/icons-react/dist/esm/icons/IconPencil.mjs";
import IconArchive from "@tabler/icons-react/dist/esm/icons/IconArchive.mjs";
import IconFolderOpen from "@tabler/icons-react/dist/esm/icons/IconFolderOpen.mjs";
import IconInfoCircle from "@tabler/icons-react/dist/esm/icons/IconInfoCircle.mjs";
import IconInbox from "@tabler/icons-react/dist/esm/icons/IconInbox.mjs";
import IconSettings from "@tabler/icons-react/dist/esm/icons/IconSettings.mjs";
import IconFileImport from "@tabler/icons-react/dist/esm/icons/IconFileImport.mjs";
import IconTable from "@tabler/icons-react/dist/esm/icons/IconTable.mjs";
import IconArrowUpRight from "@tabler/icons-react/dist/esm/icons/IconArrowUpRight.mjs";
import { AppearanceGlyph } from "./AppearanceGlyph.jsx";
import { childFolders, createPageNavigationIndex, pageNavigationEntries, topLevelPages } from "../domain/navigation.js";
import { IconButton } from "../ui/IconButton.jsx";
import { canDropSidebarNode } from "../domain/sidebarDrag.js";
import { useI18n } from "../i18n/workspaceRuntime.js";

function scrollSidebar(element, limit, delta) {
  const before = Math.max(0, Math.min(limit, element.scrollTop));
  const after = Math.max(0, Math.min(limit, before + delta));
  if (after !== before) element.scrollTo({ top: after, behavior: "instant" });
  return delta - (after - before);
}

function bindSidebarWheel(tree, navigation) {
  let fraction = 0;
  const wheel = (event) => {
    if (!event.cancelable || event.defaultPrevented || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const mode = event.deltaMode;
    const vertical = event.deltaY;
    if (!vertical || Math.abs(event.deltaX) > Math.abs(vertical)) return;
    const treeLimit = tree.scrollHeight - tree.clientHeight;
    const navigationLimit = navigation.scrollHeight - navigation.clientHeight;
    if (treeLimit <= 0 || navigationLimit <= 0) { fraction = 0; return; }

    let unit = 1;
    if (mode === WheelEvent.DOM_DELTA_LINE) unit = Number.parseFloat(getComputedStyle(tree).lineHeight) || 18;
    if (mode === WheelEvent.DOM_DELTA_PAGE) unit = tree.clientHeight;
    const total = vertical * unit + fraction;
    const whole = Math.trunc(total);
    fraction = total - whole;
    event.preventDefault();

    // Hand off the unused part of this input before the browser can latch it to the tree.
    const unused = scrollSidebar(tree, treeLimit, whole);
    if (unused) scrollSidebar(navigation, navigationLimit, unused);
  };
  tree.addEventListener("wheel", wheel, { passive: false });
  return () => tree.removeEventListener("wheel", wheel);
}

function LinkedDatabaseGlyph() {
  return (
    <span className="page-tree-glyph sidebar-database-view-glyph" aria-hidden="true">
      <IconTable size={16} />
      <IconArrowUpRight className="sidebar-database-view-arrow" size={9} />
    </span>
  );
}

function DatabaseViewTreeRow({ entry, level, onOpenPageAt, selected }) {
  return (
    <button
      type="button"
      role="treeitem"
      aria-level={level + 1}
      aria-selected={selected}
      className={`page-tree-row workspace-tree-row sidebar-database-view-row ${selected ? "is-selected" : ""}`}
      style={{ "--level": level }}
      data-sidebar-view-id={entry.blockId}
      data-owner-page-id={entry.pageId}
      data-view-id={entry.viewId}
      onClick={() => onOpenPageAt?.(entry.pageId, entry.blockId, entry.viewId)}
      title={entry.label}
    >
      <span className="page-tree-spacer" aria-hidden="true" />
      {entry.isCanonicalView ? (
        <span className="sidebar-view-dot" aria-hidden="true">·</span>
      ) : (
        <LinkedDatabaseGlyph />
      )}
      <span className="workspace-tree-label">{entry.label}</span>
    </button>
  );
}

function PageTreeRow(props) {
  const {
    page, entry, level, workspace, navigationIndex, expanded, selectedPageId, onToggle,
    onOpenPage, onOpenPageAt, onContextMenu, dragBindings, ancestorPageIds = new Set(),
  } = props;
  if (ancestorPageIds.has(page.id)) return null;
  const branchPath = new Set(ancestorPageIds);
  branchPath.add(page.id);
  const linkedView = entry?.linkedDatabaseView;
  const entries = pageNavigationEntries(workspace, page.id, navigationIndex, { includeDatabaseViews: true }).filter((child) =>
    child.kind === "page" ? !branchPath.has(child.pageId)
      : !linkedView || child.blockId !== linkedView.blockId,
  );
  const { t } = useI18n();
  const hasChildren = entries.length > 0;
  const isExpanded = expanded.has(page.id);
  const selected = selectedPageId === page.id;
  const rawLabel = entry?.label || page.title || "无标题页面";
  const label = rawLabel === "无标题页面" ? t("backlinks.untitled") : rawLabel === "新数据库" ? t("app.msg.newDb") : rawLabel;
  return (
    <div className="sidebar-page-branch" role="none">
      <div
        role="treeitem"
        aria-label={label}
        aria-level={level + 1}
        aria-selected={selected}
        aria-expanded={hasChildren ? isExpanded : undefined}
        aria-owns={hasChildren && isExpanded ? `sidebar-page-children-${page.id}` : undefined}
        className={`page-tree-row workspace-tree-row sidebar-page-row ${selected ? "is-selected" : ""}`}
        style={{ "--level": level }}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onContextMenu(event, { type: "page", id: page.id });
        }}
        title={label}
        {...dragBindings({ kind: "page", id: page.id })}
      >
        {hasChildren ? (
          <button
            type="button"
            className="tree-disclosure has-children sidebar-page-disclosure"
            aria-label={t(isExpanded ? "sidebar.collapseItem" : "sidebar.expandItem", { name: label })}
            aria-expanded={isExpanded}
            aria-controls={isExpanded ? `sidebar-page-children-${page.id}` : undefined}
            onClick={(event) => {
              event.stopPropagation();
              onToggle(page.id);
            }}
          >
            {isExpanded ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
          </button>
        ) : <span className="tree-disclosure is-empty" aria-hidden="true" />}
        <button type="button" className="sidebar-page-main" onClick={() => onOpenPage(page.id)} title={label}>
          {linkedView ? <LinkedDatabaseGlyph /> : page.pageType === "database" && !page.icon
            ? <IconTable className="page-tree-glyph" size={16} aria-hidden="true" />
            : <AppearanceGlyph icon={page.icon} color={page.iconColor} className="page-tree-glyph" />}
          <span className="workspace-tree-label">{label}</span>
        </button>
      </div>
      {hasChildren && isExpanded && (
        <div id={`sidebar-page-children-${page.id}`} className="sidebar-page-children" role="group" aria-label={t("sidebar.pageChildrenAria", { label })}>
          {entries.map((entry) => entry.kind === "page" ? (
            <PageTreeRow key={entry.key} {...props} page={entry.page} entry={entry} level={level + 1} ancestorPageIds={branchPath} />
          ) : (
            <DatabaseViewTreeRow
              key={entry.key}
              entry={entry}
              level={level + 1}
              selected={selectedPageId === entry.pageId && (page.databaseViewId === entry.viewId || (!page.databaseViewId && entries.find((e) => e.kind === "databaseView")?.viewId === entry.viewId))}
              onOpenPageAt={onOpenPageAt}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function FolderTreeRow(props) {
  const { t } = useI18n();
  const {
    folder, level, folders, pages, expanded, selectedFolderId, selectedPageId,
    onToggle, onOpenFolder, onOpenPage, onContextMenu, dragBindings,
  } = props;
  const foldersBelow = childFolders(folders, folder.id);
  const pagesBelow = topLevelPages(pages, folder.id);
  const hasChildren = foldersBelow.length > 0 || pagesBelow.length > 0;
  const isExpanded = expanded.has(folder.id);
  const selected = selectedFolderId === folder.id && !selectedPageId;

  return (
    <div className="tree-folder-branch" role="none">
      <div
        className={`tree-folder-row workspace-tree-row ${selected ? "is-selected" : ""}`}
        role="treeitem" aria-label={folder.name} aria-level={level + 1} aria-selected={selected}
        aria-expanded={hasChildren ? isExpanded : undefined}
        style={{ "--level": level }}
        {...dragBindings({ kind: "folder", id: folder.id })}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onContextMenu(event, { type: "folder", id: folder.id });
        }}
      >
        <button
          type="button"
          className={`tree-disclosure ${hasChildren ? "has-children" : "is-empty"}`}
          disabled={!hasChildren}
          aria-label={hasChildren ? t(isExpanded ? "sidebar.collapseItem" : "sidebar.expandItem", { name: folder.name }) : t("sidebar.emptyFolder", { name: folder.name })}
          aria-expanded={hasChildren ? isExpanded : undefined}
          onClick={(event) => {
            event.stopPropagation();
            if (hasChildren) onToggle(folder.id);
          }}
        >
          {hasChildren ? (isExpanded ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />) : null}
        </button>
        <button type="button" className="tree-folder-main" onClick={() => onOpenFolder(folder.id)} title={folder.name}>
          <span aria-hidden="true" className={`folder-marker color-${folder.color ?? "stone"}`} />
          <span className="workspace-tree-label">{folder.name}</span>
        </button>
      </div>
      {hasChildren && isExpanded && (
        <div className="tree-folder-children" role="group">
          {pagesBelow.map((page) => (
            <PageTreeRow key={page.id} {...props} page={page} level={level + 1} />
          ))}
          {foldersBelow.map((child) => (
            <FolderTreeRow key={child.id} {...props} folder={child} level={level + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

function SidebarTree(props) {
  const { t } = useI18n();
  function navigateTree(event) {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const row = event.target.closest(".workspace-tree-row");
    if (!row || !["ArrowDown", "ArrowUp", "Home", "End", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
    const rows = [...event.currentTarget.querySelectorAll(".workspace-tree-row")];
    const index = rows.indexOf(row);
    const depth = (item) => Number(item.getAttribute("aria-level"));
    const toggle = row.querySelector(".tree-disclosure.has-children");
    let target = row;
    if (event.key === "ArrowRight") {
      if (toggle?.getAttribute("aria-expanded") === "false") toggle.click();
      else if (rows[index + 1] && depth(rows[index + 1]) > depth(row)) target = rows[index + 1];
    } else if (event.key === "ArrowLeft") {
      if (toggle?.getAttribute("aria-expanded") === "true") toggle.click();
      else target = rows.slice(0, index).findLast((item) => depth(item) < depth(row)) || row;
    } else {
      const next = event.key === "Home" ? 0 : event.key === "End" ? rows.length - 1 : index + (event.key === "ArrowDown" ? 1 : -1);
      target = rows[Math.max(0, Math.min(rows.length - 1, next))];
    }
    event.preventDefault();
    (target.querySelector(".tree-folder-main, .sidebar-page-main") || target).focus();
  }
  return (
    <div className="sidebar-folder-tree" role="tree" aria-label={t("sidebar.treeAria")} onKeyDown={navigateTree}>
      {childFolders(props.folders, null).map((folder) => (
        <FolderTreeRow key={folder.id} folder={folder} level={0} {...props} />
      ))}
    </div>
  );
}

export function WorkspaceSidebar({
  activeSection,
  onChange,
  privateExpanded,
  onTogglePrivate,
  folders,
  pages,
  dataSources = [],
  databaseViews = [],
  expanded,
  selectedFolderId,
  selectedPageId,
  onToggleFolder,
  onOpenFolder,
  onOpenPage,
  onOpenPageAt,
  onQuickCreatePage,
  onContextMenu,
  onSearch,
  onQuickCapture,
  inboxCount = 0,
  onOpenBackup,
  onOpenTemplates,
  onOpenVault,
  onRenameWorkspace,
  onOpenSettings,
  onImportCsv,
  onImportNotion,
  onExportMarkdown,
  onAbout,
  onOpenDataFolder,
  onCreateRootFolder,
  onExpandAll,
  onCollapseAll,
  onMoveNode,
  onMoveFavorite,
  onResize,
  onResizeCommit,
  workspaceName,
  workspaceIcon = null,
  favorites = [],
  visibleSections = {},
  sidebarWidth = 248,
  trashCount,
  vaultStatus = { exists: false, locked: true },
}) {
  const { t } = useI18n();
  const resolvedWorkspaceName = workspaceName || t("app.msg.mySpace");
  const [menuOpen, setMenuOpen] = useState(false);
  const [privateMenuOpen, setPrivateMenuOpen] = useState(false);
  const [dropTarget, setDropTarget] = useState(null);
  const [draggingNode, setDraggingNode] = useState(null);
  const [resizing, setResizing] = useState(false);
  const menuRef = useRef(null);
  const switcherRef = useRef(null);
  const privateMenuRef = useRef(null);
  const privateTriggerRef = useRef(null);
  const navigationRef = useRef(null);
  const privateTreeRef = useRef(null);
  const dragSource = useRef(null);
  const widthRef = useRef(sidebarWidth);
  const resizeStart = useRef(null);
  widthRef.current = sidebarWidth;
  useEffect(() => {
    const tree = privateTreeRef.current;
    const navigation = navigationRef.current;
    if (!tree || !navigation) return undefined;
    return bindSidebarWheel(tree, navigation);
  }, [privateExpanded]);
  useEffect(() => {
    if (!menuOpen && !privateMenuOpen) return undefined;
    const activeMenu = menuOpen ? menuRef : privateMenuRef;
    const trigger = menuOpen ? switcherRef : privateTriggerRef;
    const close = () => { setMenuOpen(false); setPrivateMenuOpen(false); };
    const closeOutside = (event) => { if (!activeMenu.current?.contains(event.target) && !trigger.current?.contains(event.target)) close(); };
    const keyboard = (event) => {
      if (event.key === "Escape") { event.preventDefault(); close(); trigger.current?.focus(); }
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      const items = [...activeMenu.current.querySelectorAll('[role="menuitem"]')];
      if (!items.length) return;
      event.preventDefault();
      const index = items.indexOf(document.activeElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      items[next].focus();
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", keyboard);
    activeMenu.current?.querySelector("button")?.focus();
    return () => { document.removeEventListener("pointerdown", closeOutside); document.removeEventListener("keydown", keyboard); };
  }, [menuOpen, privateMenuOpen]);
  const navigationWorkspace = useMemo(() => ({ pages, dataSources, databaseViews }), [pages, dataSources, databaseViews]);
  const navigationIndex = useMemo(() => createPageNavigationIndex(navigationWorkspace), [navigationWorkspace]);
  const pageCount = pages.filter((page) => !page.trashedAt && (!page.databaseSourceId || page.pageType === "database")).length;
  const trashedCount = trashCount ?? pages.filter((page) => page.trashedAt).length;
  const avatar = workspaceIcon || [...resolvedWorkspaceName][0];
  const runMenuAction = (action, privateMenu = false) => {
    (privateMenu ? privateTriggerRef : switcherRef).current?.focus();
    setMenuOpen(false);
    setPrivateMenuOpen(false);
    action?.();
  };
  const readSource = (event) => {
    if (dragSource.current) return dragSource.current;
    try { return JSON.parse(event.dataTransfer.getData("application/x-life-atlas-node")); } catch { return null; }
  };
  const positionFor = (event, target) => {
    if (target.kind === "root") return target.position ?? "inside";
    const box = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientY - box.top) / box.height;
    return ratio < .25 ? "before" : ratio > .75 ? "after" : "inside";
  };
  const dragBindings = (target) => {
    const normalizedTarget = target.kind === "root" ? { kind: "root", id: null } : target;
    const targetKey = target.kind === "root" ? (target.slot ?? "root-head") : `${target.kind}:${target.id}`;
    return {
      draggable: target.kind !== "root",
      "data-node-id": target.id,
      "data-drop-position": dropTarget?.key === targetKey ? dropTarget.position : undefined,
      onDragStart: (event) => {
        event.stopPropagation();
        dragSource.current = normalizedTarget;
        const folder = target.kind === "folder" ? folders.find((entry) => entry.id === target.id) : null;
        setDraggingNode(folder ? { ...normalizedTarget, parentId: folder.parentId ?? null } : normalizedTarget);
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("application/x-life-atlas-node", JSON.stringify(normalizedTarget));
      },
      onDragOver: (event) => {
        event.stopPropagation();
        const position = positionFor(event, target);
        const allowed = canDropSidebarNode({ folders, pages }, readSource(event), normalizedTarget, position);
        event.preventDefault();
        event.dataTransfer.dropEffect = allowed ? "move" : "none";
        setDropTarget({ key: targetKey, ...normalizedTarget, position: allowed ? position : "forbidden" });
      },
      onDragLeave: (event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDropTarget((current) => current?.key === targetKey ? null : current); },
      onDrop: (event) => {
        event.preventDefault();
        event.stopPropagation();
        const source = readSource(event);
        const position = positionFor(event, target);
        if (canDropSidebarNode({ folders, pages }, source, normalizedTarget, position)) onMoveNode?.(source, normalizedTarget, position);
        setDropTarget(null);
        setDraggingNode(null);
        dragSource.current = null;
      },
      onDragEnd: () => { setDropTarget(null); setDraggingNode(null); dragSource.current = null; },
    };
  };
  const draggingNestedFolder = draggingNode?.kind === "folder" && draggingNode.parentId !== null;
  const draggingAnyFolder = draggingNode?.kind === "folder";

  return (
    <aside className={`sidebar workspace-sidebar${resizing ? " is-resizing" : ""}`} aria-label={t("sidebar.mainNavAria")}>
      <button ref={switcherRef} type="button" className="sidebar-topline workspace-switcher" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((current) => !current)}>
        <div className="workspace-avatar" aria-hidden="true">{avatar}</div>
        <span className="workspace-name">{resolvedWorkspaceName}</span>
        <IconChevronDown className="workspace-chevron" size={14} />
      </button>
      {menuOpen && <div ref={menuRef} className="workspace-switcher-menu ui-popover ui-menu" role="menu" aria-label={t("sidebar.workspaceMenuAria")}>
        <div className="workspace-menu-head"><span className="workspace-avatar" aria-hidden="true">{avatar}</span><strong>{resolvedWorkspaceName}</strong></div>
        <button type="button" role="menuitem" onClick={() => runMenuAction(onOpenSettings)}><IconSettings size={17} />{t("sidebar.settingsMenu")}</button>
        <button type="button" role="menuitem" onClick={() => runMenuAction(onRenameWorkspace)}><IconPencil size={17} />{t("sidebar.renameWorkspaceMenu")}</button>
        <div className="workspace-menu-separator" role="separator" />
        <button type="button" role="menuitem" onClick={() => runMenuAction(onOpenBackup)}><IconArchive size={17} />{t("sidebar.backupMenu")}</button>
        {onImportCsv && <button type="button" role="menuitem" onClick={() => runMenuAction(onImportCsv)}><IconFileImport size={17} />{t("sidebar.importCsvMenu")}</button>}
        {onImportNotion && <button type="button" role="menuitem" onClick={() => runMenuAction(onImportNotion)}><IconFileImport size={17} />{t("sidebar.importNotionMenu")}</button>}
        {onExportMarkdown && <button type="button" role="menuitem" onClick={() => runMenuAction(onExportMarkdown)}><IconArchive size={17} />{t("sidebar.exportMarkdownMenu")}</button>}
        {onOpenDataFolder && <button type="button" role="menuitem" onClick={() => runMenuAction(onOpenDataFolder)}><IconFolderOpen size={17} />{t("sidebar.openDataFolderMenu")}</button>}
        <div className="workspace-menu-separator" role="separator" />
        <button type="button" role="menuitem" onClick={() => runMenuAction(onAbout)}><IconInfoCircle size={17} />{t("sidebar.aboutMenu")}</button>
      </div>}

      <button type="button" className="sidebar-quick-search ui-control" onClick={onSearch}>
        <IconSearch size={15} />
        <span>{t("common.search")}</span>
        <span className="sidebar-shortcut">Ctrl K</span>
      </button>

      <nav ref={navigationRef} className="sidebar-nav">
        <button type="button" className="nav-section-link" onClick={onQuickCapture}><IconPencil size={15} /><span>{t("nav.quickCapture")}</span></button>
        <button type="button" className={`nav-section-link ${activeSection === "home" ? "is-active" : ""}`} onClick={() => onChange("home")}>
          <IconHome2 size={15} /><span>{t("nav.home")}</span>
        </button>
        <button type="button" className={`nav-section-link ${activeSection === "inbox" ? "is-active" : ""}`} aria-label={t("nav.inbox")} onClick={() => onChange("inbox")}><IconInbox size={15} /><span>{t("nav.inbox")}</span>{inboxCount > 0 && <span className="inbox-nav-badge">{inboxCount}</span>}</button>
        <button type="button" className={`nav-section-link ${activeSection === "library" ? "is-active" : ""}`} onClick={() => onChange("library")}><IconBooks size={15} /><span>{t("nav.library")}</span></button>
        {visibleSections.recents !== false && <button type="button" className={`nav-section-link ${activeSection === "recents" ? "is-active" : ""}`} onClick={() => onChange("recents")}>
          <IconFileDescription size={15} /><span>{t("sidebar.recentsNav")}</span>
        </button>}

        {visibleSections.favorites !== false && favorites.length > 0 && <section className="favorites-nav-group" aria-label={t("sidebar.favorites")}><div className="private-nav-header"><span className="private-nav-trigger">{t("sidebar.favorites")}</span></div><div className="favorites-nav-list">{favorites.map((page, index) => <button type="button" className={`nav-section-link favorite-nav-row${selectedPageId === page.id && activeSection === "private" ? " is-active" : ""}`} key={page.id} data-favorite-id={page.id} onClick={() => onOpenPage(page.id)} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); onContextMenu(event, { type: "page", id: page.id, favorite: true }); }} draggable onDragStart={(event) => { dragSource.current = { kind: "favorite", id: page.id }; event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("application/x-life-atlas-favorite", page.id); }} onDragOver={(event) => { if (dragSource.current?.kind === "favorite" || [...event.dataTransfer.types].includes("application/x-life-atlas-favorite")) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; } }} onDrop={(event) => { const id = dragSource.current?.kind === "favorite" ? dragSource.current.id : event.dataTransfer.getData("application/x-life-atlas-favorite"); if (id) { event.preventDefault(); onMoveFavorite?.(id, index); } dragSource.current = null; }} onDragEnd={() => { dragSource.current = null; }}><AppearanceGlyph icon={page.icon} color={page.iconColor} className="favorite-nav-icon" /><span>{page.title === "新数据库" ? t("app.msg.newDb") : page.title || t("backlinks.untitled")}</span></button>)}</div></section>}

        {visibleSections.private !== false && <section className={`private-nav-group ${activeSection === "private" ? "is-active" : ""}`} aria-label={t("section.private")}>
          <div
            className="private-nav-header"
            {...dragBindings({ kind: "root", id: null, slot: "root-head", position: "before" })}
            onContextMenu={(event) => {
              event.preventDefault();
              onContextMenu(event, { type: "root", id: null });
            }}
          >
            <button
              type="button"
              className="private-nav-trigger"
              onClick={() => {
                onChange("private");
                onTogglePrivate();
              }}
              aria-expanded={privateExpanded}
            >
              {privateExpanded ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
              <span>{t("section.private")}</span>
            </button>
            <div className="private-nav-actions">
              <IconButton label={t("nav.newPage")} onClick={onQuickCreatePage}><IconPlus size={15} /></IconButton>
              <button ref={privateTriggerRef} type="button" className="ui-icon-button" aria-label={t("sidebar.privateMoreAria")} aria-haspopup="menu" aria-expanded={privateMenuOpen} onClick={() => { setMenuOpen(false); setPrivateMenuOpen((current) => !current); }}><IconDots size={15} /></button>
            </div>
            {privateMenuOpen && <div ref={privateMenuRef} className="private-more-menu ui-popover ui-menu" role="menu" aria-label={t("sidebar.privateMoreAria")}><button type="button" role="menuitem" onClick={() => runMenuAction(onQuickCreatePage, true)}>{t("nav.newPage")}</button><button type="button" role="menuitem" onClick={() => runMenuAction(onCreateRootFolder, true)}>{t("nav.newFolder")}</button><button type="button" role="menuitem" onClick={() => runMenuAction(onExpandAll, true)}>{t("sidebar.expandAll")}</button><button type="button" role="menuitem" onClick={() => runMenuAction(onCollapseAll, true)}>{t("sidebar.collapseAll")}</button></div>}
          </div>
          {privateExpanded && (
            <div ref={privateTreeRef} className="private-sidebar-tree">
              <SidebarTree
                folders={folders}
                pages={pages}
                workspace={navigationWorkspace}
                navigationIndex={navigationIndex}
                expanded={expanded}
                selectedFolderId={selectedFolderId}
                selectedPageId={selectedPageId}
                onToggle={onToggleFolder}
                onOpenFolder={onOpenFolder}
                onOpenPage={onOpenPage}
                onOpenPageAt={onOpenPageAt}
                onContextMenu={onContextMenu}
                dragBindings={dragBindings}
              />
              <span
                className="sidebar-tree-count"
                {...dragBindings({ kind: "root", id: null, slot: "root-tail", position: "after" })}
              >{t("sidebar.treeCounts", { folders: folders.filter((folder) => !folder.trashedAt).length, pages: pageCount })}</span>
            </div>
          )}
        </section>}

        {visibleSections.private !== false && <div
          className={`sidebar-root-drop-zone${draggingAnyFolder ? " is-folder-dragging" : ""}${draggingNestedFolder ? " is-promoting" : ""}`}
          aria-label={t("sidebar.dropZoneAria")}
          {...dragBindings({ kind: "root", id: null, slot: "root-tail", position: "after" })}
        >
          {draggingAnyFolder && (
            <span className="sidebar-root-drop-hint">
              {dropTarget?.key === "root-tail" && dropTarget.position !== "forbidden"
                ? (draggingNestedFolder ? t("sidebar.dropPromoteRelease") : t("sidebar.dropTailRelease"))
                : (draggingNestedFolder ? t("sidebar.dropPromoteDrag") : t("sidebar.dropTailDrag"))}
            </span>
          )}
        </div>}

        <div className="sidebar-bottom-links">
        <button type="button" className={`nav-section-link ${activeSection === "market" ? "is-active" : ""}`} onClick={onOpenTemplates}><IconTemplate size={15} /><span>{t("section.market")}</span></button>
        <button type="button" className="nav-section-link" disabled={!onOpenVault} title={!onOpenVault ? t("sidebar.vaultDesktopOnly") : !vaultStatus.exists ? t("sidebar.vaultCreateTip") : vaultStatus.locked ? t("sidebar.vaultLockedTip") : t("sidebar.vaultUnlockedTip")} onClick={onOpenVault}>{vaultStatus.locked ? <IconLock size={15} /> : <IconLockOpen size={15} />}<span>{t("nav.vault")}</span>{onOpenVault && <small>{!vaultStatus.exists ? t("sidebar.vaultUncreated") : vaultStatus.locked ? t("sidebar.vaultLocked") : t("sidebar.vaultUnlocked")}</small>}</button>
        <button type="button" aria-label={t("nav.trash")} className={`nav-section-link trash-nav-link ${activeSection === "trash" ? "is-active" : ""}`} onClick={() => onChange("trash")}>
          <IconTrash size={15} />
          <span>{t("nav.trash")}</span>
          {trashedCount > 0 && <span className="trash-nav-count">{trashedCount}</span>}
        </button>
        </div>
      </nav>
      <div className="sidebar-resizer" role="separator" aria-orientation="vertical" aria-label={t("sidebar.resizeAria")} aria-valuemin={200} aria-valuemax={480} aria-valuenow={Math.round(sidebarWidth)} tabIndex={0} onPointerDown={(event) => { if (event.button !== 0) return; event.preventDefault(); resizeStart.current = { x: event.clientX, width: sidebarWidth }; event.currentTarget.setPointerCapture(event.pointerId); setResizing(true); }} onPointerMove={(event) => { if (!resizeStart.current) return; const width = Math.max(200, Math.min(480, resizeStart.current.width + event.clientX - resizeStart.current.x)); widthRef.current = width; onResize?.(width); }} onPointerUp={(event) => { if (!resizeStart.current) return; resizeStart.current = null; setResizing(false); event.currentTarget.releasePointerCapture(event.pointerId); onResizeCommit?.(widthRef.current); }} onPointerCancel={() => { resizeStart.current = null; setResizing(false); onResizeCommit?.(widthRef.current); }} onKeyDown={(event) => { if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return; event.preventDefault(); const width = event.key === "Home" ? 200 : event.key === "End" ? 480 : Math.max(200, Math.min(480, sidebarWidth + (event.key === "ArrowLeft" ? -10 : 10))); onResize?.(width); onResizeCommit?.(width); }} />
    </aside>
  );
}
