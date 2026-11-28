import { useEffect, useMemo, useRef, useState } from "react";
import IconArrowBackUp from "@tabler/icons-react/dist/esm/icons/IconArrowBackUp.mjs";
import IconArrowForwardUp from "@tabler/icons-react/dist/esm/icons/IconArrowForwardUp.mjs";
import IconArrowsMaximize from "@tabler/icons-react/dist/esm/icons/IconArrowsMaximize.mjs";
import IconCopy from "@tabler/icons-react/dist/esm/icons/IconCopy.mjs";
import IconFileExport from "@tabler/icons-react/dist/esm/icons/IconFileExport.mjs";
import IconFileImport from "@tabler/icons-react/dist/esm/icons/IconFileImport.mjs";
import IconFolder from "@tabler/icons-react/dist/esm/icons/IconFolder.mjs";
import IconLock from "@tabler/icons-react/dist/esm/icons/IconLock.mjs";
import IconLockOpen from "@tabler/icons-react/dist/esm/icons/IconLockOpen.mjs";
import IconPalette from "@tabler/icons-react/dist/esm/icons/IconPalette.mjs";
import IconSearch from "@tabler/icons-react/dist/esm/icons/IconSearch.mjs";
import IconTrash from "@tabler/icons-react/dist/esm/icons/IconTrash.mjs";
import IconTemplate from "@tabler/icons-react/dist/esm/icons/IconTemplate.mjs";
import IconStar from "@tabler/icons-react/dist/esm/icons/IconStar.mjs";
import IconHistory from "@tabler/icons-react/dist/esm/icons/IconHistory.mjs";
import IconPresentation from "@tabler/icons-react/dist/esm/icons/IconPresentation.mjs";
import { normalizePageSettings } from "../domain/pageActions.js";
import { useI18n } from "../i18n/workspaceRuntime.js";

function Toggle({ checked }) {
  return <span className={`page-action-toggle ${checked ? "is-on" : ""}`} aria-hidden="true"><span /></span>;
}

function MenuRow({ icon: Icon, label, shortcut, disabled = false, danger = false, toggle, onClick, keywords = "" }) {
  return (
    <button
      type="button"
      role="menuitem"
      aria-label={label}
      aria-keyshortcuts={shortcut?.replace("Ctrl", "Control")}
      className={`page-action-row ${danger ? "is-danger" : ""}`}
      disabled={disabled}
      data-search={`${label} ${keywords}`}
      onClick={onClick}
    >
      <span className="page-action-row-icon">{Icon ? <Icon size={18} stroke={1.7} /> : null}</span>
      <span className="page-action-row-label">{label}</span>
      {toggle !== undefined ? <Toggle checked={toggle} /> : <span className="page-action-shortcut" aria-hidden="true">{shortcut}</span>}
    </button>
  );
}

export function PageActionsMenu({
  page,
  history,
  onUndo,
  onRedo,
  onSettingChange,
  onCopyContents,
  onDuplicate,
  onDuplicateIndependently,
  onSaveTemplate,
  onOpenHistory,
  onPresent,
  onArchive,
  isArchived = false,
  archiveActionLabel,
  onOpenDatabaseHistory,
  isFavorite = false,
  onToggleFavorite,
  onMove,
  onTrash,
  onCustomize,
  onImport,
  onExport,
  onClose,
}) {
  const { t } = useI18n();
  const ref = useRef(null);
  const [query, setQuery] = useState("");
  const settings = normalizePageSettings(page?.settings);
  const needle = query.trim().toLocaleLowerCase();

  useEffect(() => {
    const buttonSelector = `button[aria-label="${t("actions.buttonAria")}"]`;
    const onPointer = (event) => {
      if (event.target instanceof Element && event.target.closest(buttonSelector)) return;
      if (!ref.current?.contains(event.target)) onClose();
    };
    window.addEventListener("mousedown", onPointer);
    return () => {
      window.removeEventListener("mousedown", onPointer);
    };
  }, [onClose, t]);

  const handleKeyDown = (event) => {
    if (event.key !== "Escape" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    event.stopPropagation();
    const trigger = ref.current?.parentElement?.querySelector(`button[aria-label="${t("actions.buttonAria")}"]`);
    onClose();
    trigger?.focus();
  };

  const visible = useMemo(() => (label, keywords = "") => {
    if (!needle) return true;
    return `${label} ${keywords}`.toLocaleLowerCase().includes(needle);
  }, [needle]);

  if (!page) return null;

  const undoLabel = t("actions.undo");
  const redoLabel = t("actions.redo");
  const presentLabel = t("actions.present");
  const copyContentsLabel = t("actions.copyContents");
  const duplicateLabel = t("actions.duplicate");
  const duplicateIndependentLabel = t("actions.duplicateIndependent");
  const saveTemplateLabel = t("actions.saveTemplate");
  const historyLabel = t("actions.history");
  const dbHistoryLabel = t("actions.databaseHistory");
  const archiveLabel = archiveActionLabel || (isArchived ? t("actions.unarchivePage") : t("actions.archivePage"));
  const favoriteLabel = isFavorite ? t("actions.removeFavorite") : t("actions.addFavorite");
  const moveLabel = t("actions.move");
  const customizeLabel = t("actions.customize");
  const trashLabel = t("actions.trash");
  const smallTextLabel = t("actions.smallText");
  const widthDefaultLabel = t("actions.width.default");
  const widthFullLabel = t("actions.width.full");
  const widthFocusLabel = t("actions.width.focus");
  const lockLabel = settings.locked ? t("actions.unlock") : t("actions.lock");
  const importLabel = t("actions.import");
  const exportLabel = t("actions.export");

  const showHistory = visible(`${undoLabel} ${redoLabel}`, "撤回 重做 undo redo history");
  const showFonts = visible(`${t("common.font.default")} ${t("common.font.serif")} ${t("common.font.mono")}`, "字体 default serif mono 默认 衬线 等宽 typography");
  const showPresentation = Boolean(onPresent) && visible(presentLabel, "演示页面 present slideshow");
  const showLocalActions = showPresentation || [
    [archiveLabel, "archive database history 归档页面 解除归档"],
    [dbHistoryLabel, "database history 数据库历史"],
    [copyContentsLabel, "copy contents 复制页面内容"],
    [duplicateLabel, "duplicate 创建副本"],
    [duplicateIndependentLabel, "duplicate database independent 创建独立副本"],
    [saveTemplateLabel, "template 保存为页面模板"],
    [historyLabel, "versions history 页面历史"],
    [favoriteLabel, "favorite 添加到收藏 从收藏移除"],
    [moveLabel, "move folder 移动到"],
    [trashLabel, "trash delete 移到回收站"],
    [customizeLabel, "customize cover icon 自定义页面"],
  ].some(([label, keywords]) => visible(label, keywords));
  const showSettings = [
    [smallTextLabel, "small text 小号文字"],
    [`${widthDefaultLabel} ${widthFullLabel} ${widthFocusLabel}`, "presentation default full focus reading 默认宽 全宽 专注阅读"],
    [lockLabel, "lock unlock 锁定页面 解锁页面"],
  ].some(([label, keywords]) => visible(label, keywords));
  const showFiles = visible(importLabel, "import 导入") || visible(exportLabel, "export 导出");

  return (
    <div className="page-actions-menu ui-popover ui-menu" role="menu" aria-label={t("actions.buttonAria")} ref={ref} onKeyDown={handleKeyDown}>
      <label className="page-actions-search">
        <IconSearch size={17} stroke={1.7} />
        <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("actions.searchPlaceholder")} />
      </label>

      <div className="page-actions-scroll">
        {showHistory && (
          <section className="page-action-group page-action-history">
            {visible(undoLabel, "undo history 撤回") && (
              <MenuRow icon={IconArrowBackUp} label={undoLabel} shortcut="Ctrl+Z" disabled={!history.canUndo || settings.locked} onClick={onUndo} />
            )}
            {visible(redoLabel, "redo history 重做") && (
              <MenuRow icon={IconArrowForwardUp} label={redoLabel} shortcut="Ctrl+Shift+Z" disabled={!history.canRedo || settings.locked} onClick={onRedo} />
            )}
          </section>
        )}

        {showFonts && (
          <section className="page-action-group page-font-choices" aria-label={t("common.font.default")}>
            {[
              ["default", "Ag", t("common.font.default")],
              ["serif", "Ag", t("common.font.serif")],
              ["mono", "Ag", t("common.font.mono")],
            ].map(([id, sample, label]) => (
              <button
                type="button"
                key={id}
                className={`page-font-choice page-font-choice-${id} ${settings.fontFamily === id ? "is-selected" : ""}`}
                onClick={() => onSettingChange({ fontFamily: id })}
              >
                <strong>{sample}</strong>
                <span>{label}</span>
              </button>
            ))}
          </section>
        )}

        {showLocalActions && (
          <section className="page-action-group">
            {showPresentation && <MenuRow icon={IconPresentation} label={presentLabel} shortcut="Ctrl+Alt+P" onClick={onPresent} />}
            {visible(copyContentsLabel, "copy contents 复制页面内容") && <MenuRow icon={IconCopy} label={copyContentsLabel} onClick={onCopyContents} />}
            {visible(duplicateLabel, "duplicate 创建副本") && <MenuRow icon={IconCopy} label={duplicateLabel} onClick={onDuplicate} />}
            {onDuplicateIndependently && visible(duplicateIndependentLabel, "duplicate database independent 创建独立副本") && <MenuRow icon={IconCopy} label={duplicateIndependentLabel} onClick={onDuplicateIndependently} />}
            {onSaveTemplate && visible(saveTemplateLabel, "template 保存为页面模板") && <MenuRow icon={IconTemplate} label={`${saveTemplateLabel}…`} onClick={onSaveTemplate} />}
            {onOpenHistory && visible(historyLabel, "versions history 页面历史") && <MenuRow icon={IconHistory} label={historyLabel} onClick={onOpenHistory} />}
            {onOpenDatabaseHistory && visible(dbHistoryLabel, "database versions history 数据库历史") && <MenuRow icon={IconHistory} label={dbHistoryLabel} onClick={onOpenDatabaseHistory} />}
            {onArchive && visible(archiveLabel, "archive 归档页面 解除归档") && <MenuRow icon={IconFolder} label={archiveLabel} onClick={onArchive} />}
            {onToggleFavorite && visible(favoriteLabel, "favorite 添加到收藏 从收藏移除") && <MenuRow icon={IconStar} label={favoriteLabel} onClick={onToggleFavorite} />}
            {visible(moveLabel, "move folder 移动到") && <MenuRow icon={IconFolder} label={`${moveLabel}…`} onClick={onMove} />}
            {visible(customizeLabel, "customize cover icon 自定义页面") && <MenuRow icon={IconPalette} label={customizeLabel} onClick={onCustomize} />}
            {visible(trashLabel, "trash delete 移到回收站") && <MenuRow icon={IconTrash} label={trashLabel} danger onClick={onTrash} />}
          </section>
        )}

        {showSettings && (
          <section className="page-action-group">
            {visible(smallTextLabel, "small text 小号文字") && <MenuRow label={smallTextLabel} toggle={settings.smallText} onClick={() => onSettingChange({ smallText: !settings.smallText })} />}
            {visible(widthDefaultLabel, "presentation default 默认宽") && <MenuRow label={widthDefaultLabel} toggle={settings.presentationMode === "default"} onClick={() => onSettingChange({ presentationMode: "default", fullWidth: false })} />}
            {visible(widthFullLabel, "presentation full width 全宽") && <MenuRow icon={IconArrowsMaximize} label={widthFullLabel} toggle={settings.presentationMode === "full"} onClick={() => onSettingChange({ presentationMode: "full", fullWidth: true })} />}
            {visible(widthFocusLabel, "presentation focus reading 专注阅读") && <MenuRow label={widthFocusLabel} toggle={settings.presentationMode === "focus"} onClick={() => { onSettingChange({ presentationMode: "focus", fullWidth: true }); onClose(); }} />}
            {visible(lockLabel, "lock unlock 锁定页面 解锁页面") && (
              <MenuRow
                icon={settings.locked ? IconLockOpen : IconLock}
                label={lockLabel}
                toggle={settings.locked}
                onClick={() => onSettingChange({ locked: !settings.locked })}
              />
            )}
          </section>
        )}

        {showFiles && (
          <section className="page-action-group">
            {visible(importLabel, "import 导入") && <MenuRow icon={IconFileImport} label={importLabel} disabled={settings.locked} onClick={onImport} />}
            {visible(exportLabel, "export 导出") && <MenuRow icon={IconFileExport} label={exportLabel} onClick={onExport} />}
          </section>
        )}

        {needle && !showHistory && !showFonts && !showLocalActions && !showSettings && !showFiles && (
          <div className="page-actions-empty">{t("actions.empty")}</div>
        )}
      </div>
      <footer className="page-actions-footnote">{t("settings.about.subtitle")}</footer>
    </div>
  );
}
