import { useEffect, useId, useRef, useState } from "react";
import IconCheck from "@tabler/icons-react/dist/esm/icons/IconCheck.mjs";
import IconChevronRight from "@tabler/icons-react/dist/esm/icons/IconChevronRight.mjs";
import IconDatabase from "@tabler/icons-react/dist/esm/icons/IconDatabase.mjs";
import { AppearanceGlyph } from "./AppearanceGlyph.jsx";
import { WorkspaceNavigationMenu } from "./WorkspaceNavigationMenu.jsx";
import { useI18n } from "../i18n/workspaceRuntime.js";

export function WorkspaceBreadcrumb({ path, onOpen, onOpenRoot }) {
  const { t } = useI18n();
  const displayLabel = (label) => (label === "新数据库" ? t("app.msg.newDb") : label === "无标题页面" ? t("backlinks.untitled") : label);
  const menuId = useId();
  const [open, setOpen] = useState(null);
  const hoverTimer = useRef(null);
  const pathKey = JSON.stringify(path.map((node) => [node.kind, node.id]));
  useEffect(() => {
    setOpen(null);
    return () => clearTimeout(hoverTimer.current);
  }, [pathKey]);

  const activeNode = open && path.find((node) => node.id === open.id && node.kind === open.kind);
  const dismiss = (restoreFocus) => {
    setOpen(null);
    if (restoreFocus) open?.anchor.focus();
  };
  const show = (node, anchor, focusIndex = null) => {
    clearTimeout(hoverTimer.current);
    setOpen({ id: node.id, kind: node.kind, anchor, focusIndex });
  };

  return <nav className="breadcrumb workspace-breadcrumb" aria-label={t("topbar.locationAria")}>
    <button type="button" className="workspace-crumb-trigger breadcrumb-muted" onClick={onOpenRoot} title={t("topbar.openLibraryTitle")}>{t("section.private")}</button>
    {path.map((node, index) => {
      const current = index === path.length - 1;
      const expanded = node === activeNode;
      const label = displayLabel(node.label);
      return <span className={`breadcrumb-piece${current ? " breadcrumb-page" : ""}`} key={`${node.kind}:${node.id}`}>
        <IconChevronRight size={12} aria-hidden="true" />
        {node.alternatives.length ? <button
          type="button"
          className="workspace-crumb-trigger"
          title={label}
          aria-label={t("topbar.siblingsAria", { label })}
          aria-current={current ? "page" : undefined}
          aria-haspopup="menu"
          aria-expanded={expanded}
          aria-controls={expanded ? menuId : undefined}
          onPointerEnter={(event) => {
            if (event.pointerType !== "mouse" || expanded) return;
            const anchor = event.currentTarget;
            clearTimeout(hoverTimer.current);
            hoverTimer.current = setTimeout(() => show(node, anchor), 280);
          }}
          onPointerLeave={() => clearTimeout(hoverTimer.current)}
          onClick={(event) => show(node, event.currentTarget, event.detail === 0 ? 0 : null)}
          onKeyDown={(event) => {
            if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
            event.preventDefault();
            show(node, event.currentTarget, event.key === "ArrowUp" ? -1 : 0);
          }}
        >{label}</button> : <span title={label}>{label}</span>}
      </span>;
    })}
    {activeNode && <WorkspaceNavigationMenu id={menuId} label={t("topbar.siblingsAria", { label: displayLabel(activeNode.label) })} anchor={open.anchor} focusIndex={open.focusIndex} onDismiss={dismiss}>
      {activeNode.alternatives.map((node) => <button
        key={`${node.kind}:${node.id}`}
        type="button"
        className="workspace-navigation-menu-row"
        role="menuitem"
        tabIndex={-1}
        aria-current={node.id === activeNode.id ? "location" : undefined}
        data-navigation-id={node.id}
        onClick={() => { dismiss(true); onOpen(node); }}
      >
        {node.kind === "folder" ? <span aria-hidden="true" className={`folder-marker color-${node.color ?? "stone"}`} />
          : node.kind === "source" ? <IconDatabase size={16} /> : <AppearanceGlyph icon={node.icon} color={node.iconColor} className="workspace-navigation-menu-icon" />}
        <span>{displayLabel(node.label)}</span>
        {node.id === activeNode.id && <IconCheck size={14} className="workspace-navigation-menu-check" aria-hidden="true" />}
      </button>)}
    </WorkspaceNavigationMenu>}
  </nav>;
}
