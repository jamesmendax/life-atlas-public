import { useEffect, useRef, useState } from "react";
import IconDots from "@tabler/icons-react/dist/esm/icons/IconDots.mjs";
import IconGripVertical from "@tabler/icons-react/dist/esm/icons/IconGripVertical.mjs";
import IconPencil from "@tabler/icons-react/dist/esm/icons/IconPencil.mjs";
import { useDialogs } from "../ui/DialogProvider.jsx";
import { AppearanceGlyph, SpriteIcon } from "./AppearanceGlyph.jsx";
import { DatabasePopover } from "./DatabaseViewSettings.jsx";
import { handleBoardTitleKey } from "./databaseBoardInteractions.js";
import { startDatabaseItemDrag } from "./databaseItemDrag.js";
import { useI18n } from "../i18n/workspaceRuntime.js";

export function DatabaseBoardCard({
  item, page, title, titleProperty, config, runtime, groupKey, groupPropertyId, moveOptions, subgroupKey, subgroupOptions, onMoveSubgroup,
  onUpdateItemValue, onOpenItemPage, onPeekItemPage, onDragHandle, onMove, preview, children,
}) {
  const { t } = useI18n();
  const dialogs = useDialogs();
  const cardRef = useRef(null), editButton = useRef(null), menuButton = useRef(null);
  const originalTitle = useRef(null);
  const [editing, setEditing] = useState(false);
  const [menu, setMenu] = useState(null);
  const locked = Boolean(runtime?.locked || page?.settings?.locked);
  const isLocked = useRef(locked);
  isLocked.current = locked;
  const canRename = !locked && titleProperty && onUpdateItemValue;
  const showIcon = config?.showPageIcon !== false;
  const wrapped = Boolean(config?.board?.wrapAllContent);

  useEffect(() => {
    if (!locked) return;
    originalTitle.current = null;
    setEditing(false);
    setMenu(null);
  }, [locked]);

  function beginTitle() {
    if (!canRename) return;
    originalTitle.current = String(item.values?.[titleProperty.id] ?? page?.title ?? "");
    setEditing(true);
  }

  function finishTitle(value, save, restoreFocus = false) {
    const original = originalTitle.current;
    if (original === null) return;
    originalTitle.current = null;
    setEditing(false);
    const board = cardRef.current?.closest(".db-board-view");
    if (save && canRename && value !== original) onUpdateItemValue(item.id, titleProperty.id, value);
    if (restoreFocus) requestAnimationFrame(() => (editButton.current || board)?.focus({ preventScroll: true }));
  }

  function closeMenu(restoreFocus = false) {
    setMenu(null);
    if (restoreFocus) menuButton.current?.focus({ preventScroll: true });
  }

  async function trashRecord() {
    closeMenu(true);
    const card = cardRef.current;
    const board = card.closest(".db-board-view");
    const next = card.nextElementSibling?.querySelector(".db-board-card-open")
      || card.previousElementSibling?.querySelector(".db-board-card-open")
      || card.closest(".db-board-column")?.querySelector(".db-board-new-page");
    const confirmed = await dialogs.confirm({
      title: t("dbx.table.trashTitle"), description: t("dbx.table.trashCardDesc", { title }), confirmLabel: t("dbx.table.trashTitle"), danger: true,
    });
    if (!confirmed || !card.isConnected || isLocked.current) return;
    runtime.trashDatabaseItems([item.id]);
    requestAnimationFrame(() => (next?.isConnected ? next : board)?.focus({ preventScroll: true }));
  }

  function changeGroup(destination) {
    const board = cardRef.current.closest(".db-board-view");
    closeMenu();
    onMove(item.id, destination, groupKey);
    requestAnimationFrame(() => {
      const selector = `.db-board-column[data-group-key="${CSS.escape(destination)}"] [data-item-id="${CSS.escape(item.id)}"] .db-board-move-menu`;
      const target = board.querySelector(selector) || menuButton.current || board;
      target.focus({ preventScroll: true });
      target.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
  }

  return <article ref={cardRef} className={`db-board-card${wrapped ? " is-wrapped" : ""}`} data-item-id={item.id}
    draggable={Boolean(moveOptions && !locked && !editing && !menu)} onDragStart={(event) => {
      if (!startDatabaseItemDrag(event, item)) return;
      event.dataTransfer.setData("text/life-atlas-group", groupKey);
      event.dataTransfer.setData("text/life-atlas-group-property", groupPropertyId);
      if (subgroupKey != null) event.dataTransfer.setData("text/life-atlas-subgroup",subgroupKey);
    }}>
    {editing && canRename
      ? <input className="db-board-title-input" aria-label={t("dbx.peek.recordTitleAria")} placeholder={t("dbx.untitled")} defaultValue={originalTitle.current} autoFocus
          onFocus={(event) => event.currentTarget.select()} onBlur={(event) => finishTitle(event.target.value, true)}
          onKeyDown={(event) => handleBoardTitleKey(event, finishTitle)} />
      : <button type="button" className="db-board-card-open" onClick={(event) => onOpenItemPage?.(item.pageId, event.currentTarget)}>
          {preview}
          <strong>{showIcon && <span className="db-gallery-title-icon" aria-hidden="true">{page?.icon ? <AppearanceGlyph icon={page.icon} color={page.iconColor} /> : <SpriteIcon id="file-description" size={16} />}</span>}{showIcon ? " " : ""}{title === "无标题" ? t("dbx.untitled") : title}</strong>
        </button>}
    {children}
    <div className="db-board-card-tools" role="group" aria-label={t("dbx.card.toolsAria")} data-open={menu ? "true" : undefined} hidden={locked || editing}>
      {onDragHandle && <button type="button" className="db-drag-handle" disabled={locked || !moveOptions} aria-label={t("dbx.card.dragToGroupAria", { title })}
        onPointerDown={(event) => onDragHandle(event, item.id, groupKey)} onClick={(event) => { if (event.detail === 0) setMenu("move"); }}>
        <IconGripVertical size={14} aria-hidden="true" /></button>}
      {canRename && <button type="button" ref={editButton} aria-label={t("dbx.list.editTitleAria", { title })} title={t("dbx.card.editTitle")} onClick={beginTitle}>
        <IconPencil size={14} aria-hidden="true" /></button>}
      {!locked && <button type="button" ref={menuButton} className="db-board-move-menu" aria-label={t("dbx.card.actionsAria", { title })} title={t("dbx.card.actionsTitle")}
        aria-haspopup="dialog" aria-expanded={Boolean(menu)} onClick={() => setMenu(menu ? null : "actions")}><IconDots size={15} aria-hidden="true" /></button>}
    </div>
    {menu && !locked && <DatabasePopover inline anchor={menuButton.current} className="db-board-record-menu" label={t("dbx.card.cardMenuTitle")} onClose={closeMenu}>
      <div className="db-v9-menu-list">
        {onPeekItemPage && <button type="button" className="db-v9-menu-row" onClick={() => { closeMenu(); onPeekItemPage(item.pageId, menuButton.current, "side"); }}>{t("db.ui.openInSide")}</button>}
        {runtime?.duplicateDatabaseItem && <button type="button" className="db-v9-menu-row" onClick={() => { closeMenu(true); runtime.duplicateDatabaseItem(item.id); }}>{t("db.ui.dupRecord")}</button>}
        {runtime?.trashDatabaseItems && <button type="button" className="db-v9-menu-row is-danger" onClick={trashRecord}>{t("dbx.table.trashTitle")}</button>}
      </div>
      {moveOptions && <label className="db-v9-setting-field db-board-move-field">{t("db.ui.moveToGroup")}
        <select aria-label={t("dbx.card.moveToGroupAria", { title })} data-popover-initial={menu === "move" || undefined} value={groupKey === "未分组" ? "" : groupKey}
          onChange={(event) => changeGroup(event.target.value || "未分组")}>
          <option value="">{t("db.unassignedGroup")}</option>{moveOptions.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
        </select>
      </label>}
      {subgroupOptions && <label className="db-v9-setting-field db-board-move-field">{t("db.ui.moveToSubgroup")}<select aria-label={t("dbx.card.moveToSubgroupAria", { title })} value={subgroupKey || "未分组"} onChange={event=>{closeMenu();onMoveSubgroup(event.target.value);}}><option value="未分组">{t("db.unassignedGroup")}</option>{subgroupOptions.map(option=><option key={option.id} value={option.id}>{option.name}</option>)}</select></label>}
    </DatabasePopover>}
  </article>;
}
