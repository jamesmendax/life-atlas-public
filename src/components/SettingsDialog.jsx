import { useEffect, useRef, useState } from "react";
import IconArchive from "@tabler/icons-react/dist/esm/icons/IconArchive.mjs";
import IconCheck from "@tabler/icons-react/dist/esm/icons/IconCheck.mjs";
import IconCircleHalf2 from "@tabler/icons-react/dist/esm/icons/IconCircleHalf2.mjs";
import IconDatabase from "@tabler/icons-react/dist/esm/icons/IconDatabase.mjs";
import IconInfoCircle from "@tabler/icons-react/dist/esm/icons/IconInfoCircle.mjs";
import IconKeyboard from "@tabler/icons-react/dist/esm/icons/IconKeyboard.mjs";
import IconMap from "@tabler/icons-react/dist/esm/icons/IconMap.mjs";
import { TripMapConnection } from "./TripMapConnection.jsx";
import IconMoon from "@tabler/icons-react/dist/esm/icons/IconMoon.mjs";
import IconPalette from "@tabler/icons-react/dist/esm/icons/IconPalette.mjs";
import IconShieldLock from "@tabler/icons-react/dist/esm/icons/IconShieldLock.mjs";
import IconSparkles from "@tabler/icons-react/dist/esm/icons/IconSparkles.mjs";
import { AssistantConnection } from "./assistant/AssistantConnection.jsx";
import IconSun from "@tabler/icons-react/dist/esm/icons/IconSun.mjs";
import IconUser from "@tabler/icons-react/dist/esm/icons/IconUser.mjs";
import IconX from "@tabler/icons-react/dist/esm/icons/IconX.mjs";
import { navigateChoiceGroup } from "../ui/keyboard.js";
import { Dialog } from "../ui/Dialog.jsx";
import { useDialogs } from "../ui/DialogProvider.jsx";
import { CONTRAST_PREFERENCES, DATABASE_VIEW_TAB_DISPLAYS, SIDEBAR_SECTIONS } from "../ui/devicePreferences.js";
import { getContrastLabels, getThemeLabels, THEME_PREFERENCES } from "../ui/theme.js";
import { getShortcuts } from "../editor/shortcuts.js";
import { formatBackupSize } from "./BackupDialog.jsx";
import { BACKUP_DESTINATIONS } from "../backup/scheduleDestinations.js";
import { AboutWorkspaceContent } from "./WorkspaceIdentityDialogs.jsx";
import { format, LOCALE_METADATA, SUPPORTED_LOCALES, useI18n } from "../i18n/workspaceRuntime.js";

const SECTION_ICONS = [
  ["appearance", IconPalette],
  ["workspace", IconUser],
  ["data", IconDatabase],
  ["backup", IconArchive],
  ["vault", IconShieldLock],
  ["assistant", IconSparkles],
  ["maps", IconMap],
  ["shortcuts", IconKeyboard],
  ["about", IconInfoCircle],
];
const modeIcons = { system: IconCircleHalf2, light: IconSun, dark: IconMoon };
const unwrap = (result, fallbackMessage) => {
  if (!result?.ok) throw new Error(result?.error?.message || fallbackMessage);
  return result.value;
};

function SettingRow({ title, description, children }) {
  return <div className="settings-row"><div className="settings-label">{title}{description && <small>{description}</small>}</div><div className="settings-control">{children}</div></div>;
}

function WorkspaceSettings({ workspace, onChange }) {
  const { locale, t } = useI18n();
  const [name, setName] = useState(workspace.ui?.workspaceName || (locale === "zh-CN" ? "medax的工作空间" : "Life Atlas"));
  const [icon, setIcon] = useState(workspace.ui?.workspaceIcon || "");
  const validName = Boolean(name.trim() && [...name.trim()].length <= 60);
  const graphemes = [...new Intl.Segmenter(locale, { granularity: "grapheme" }).segment(icon.trim())];
  const validIcon = !icon.trim() || graphemes.length === 1 && /[\p{Extended_Pictographic}\p{Regional_Indicator}\u20e3]/u.test(icon);
  return <form onSubmit={(event) => { event.preventDefault(); if (validName && validIcon) onChange({ workspaceName: name.trim(), workspaceIcon: icon.trim() || null }); }}>
    <SettingRow title={t("settings.workspace.nameTitle")} description={t("settings.workspace.nameDesc")}><input className="mb-field" aria-label={t("settings.workspace.nameAria")} value={name} maxLength={120} onChange={(event) => setName(event.target.value)} aria-invalid={!validName} /></SettingRow>
    <SettingRow title={t("settings.workspace.iconTitle")} description={t("settings.workspace.iconDesc")}><input className="mb-field settings-icon-input" aria-label={t("settings.workspace.iconAria")} value={icon} onChange={(event) => setIcon(event.target.value)} aria-invalid={!validIcon} /></SettingRow>
    {!validName && <p role="alert" className="settings-error">{t("settings.workspace.nameInvalid")}</p>}{!validIcon && <p role="alert" className="settings-error">{t("settings.workspace.iconInvalid")}</p>}
    <div className="settings-actions"><button type="submit" className="mb-button mb-primary" disabled={!validName || !validIcon}>{t("settings.workspace.save")}</button></div>
  </form>;
}

export function SettingsDialog({ workspace, devicePreferences, onDevicePreferenceChange, onPreferenceChange, onIdentityChange, onOpenBackup, onClose, initialSection = "appearance" }) {
  const { locale, setLocale, t } = useI18n();
  const api = window.lifeAtlas;
  const desktop = api?.platform === "desktop";
  const dialogs = useDialogs();
  const sections = SECTION_ICONS.map(([id, Icon]) => [id, t(`settings.tab.${id}`), Icon]);
  const sidebarSectionLabels = {
    private: t("settings.sidebar.private"),
    favorites: t("settings.sidebar.favorites"),
    recents: t("settings.sidebar.recents"),
  };
  const databaseTabLabels = {
    "icon-text": t("settings.dbTab.icon-text"),
    text: t("settings.dbTab.text"),
    icon: t("settings.dbTab.icon"),
  };
  const fontLabels = {
    default: t("common.font.default"),
    serif: t("common.font.serif"),
    mono: t("common.font.mono"),
  };
  const themeLabels = getThemeLabels(t);
  const contrastLabels = getContrastLabels(t);
  const dateLabel = (value) => value ? format.formatDateTime(value, locale, { includeSeconds: true }) : t("common.noRecord");
  const tabs = sections.filter(([id]) => (desktop || id !== "data") && (id !== "maps" || Boolean(api?.trip?.setProvider)));
  const [section, setSection] = useState(() => tabs.some(([id]) => id === initialSection) ? initialSection : "appearance");
  const [info, setInfo] = useState(null);
  const [backup, setBackup] = useState(null);
  const [assets, setAssets] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [batches, setBatches] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const firstTab = useRef(null);
  const tabRefs = useRef(new Map());
  const preferences = workspace.ui?.preferences || {};
  const theme = preferences.theme || "system";
  const font = preferences.defaultFont || "default";
  const title = sections.find(([id]) => id === section)[1];
  const schedule = backup?.schedule;
  const cloudDestination = schedule?.folder && schedule.destination !== "local" ? BACKUP_DESTINATIONS[schedule.destination] : null;

  useEffect(() => {
    if (!desktop) return undefined;
    let active = true;
    const load = async () => {
      try {
        if (section === "data") {
          const [details, trash] = await Promise.all([api.app.getInfo(), api.assets.listTrash()]);
          if (active) { setInfo(unwrap(details, t("common.opIncomplete"))); setBatches(unwrap(trash, t("common.opIncomplete")).batches); }
        }
        if (section === "backup") {
          const result = await api.backup.getStatus();
          if (active) setBackup(unwrap(result, t("common.opIncomplete")));
        }
      } catch (failure) { if (active) setError(failure.message); }
    };
    void load();
    return () => { active = false; };
  }, [api, desktop, section, t]);

  const run = async (operation) => {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try { await operation(); } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  };
  const scan = async () => {
    const result = unwrap(await api.assets.scanUnreferenced(), t("common.opIncomplete"));
    setAssets(result.candidates); setSelected(new Set());
  };
  const moveAssets = () => run(async () => {
    if (!selected.size || !await dialogs.confirm({ title: t("settings.data.moveConfirmTitle"), description: t("settings.data.moveConfirmDesc"), confirmLabel: t("settings.data.moveToTrash"), danger: true })) return;
    const result = unwrap(await api.assets.moveToTrash({ sha256s: [...selected] }), t("common.opIncomplete"));
    await scan();
    setBatches(unwrap(await api.assets.listTrash(), t("common.opIncomplete")).batches);
    setNotice(t("settings.data.movedNotice", { count: result.movedCount }));
  });
  const selectSection = (next) => { setSection(next); setError(""); setNotice(""); };

  return <Dialog title={t("settings.title")} ariaLabel={t("settings.title")} onClose={onClose} initialFocusRef={firstTab} className="settings-dialog ui-dialog" busy={busy} dialogKind="settings">
    <div className="settings-layout">
      <aside className="settings-tabs" role="tablist" aria-label={t("settings.sectionsAria")} aria-orientation="vertical" onKeyDown={(event) => {
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const position = tabs.findIndex(([id]) => id === section);
        const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (position + (event.key === "ArrowDown" ? 1 : -1) + tabs.length) % tabs.length;
        selectSection(tabs[next][0]); tabRefs.current.get(tabs[next][0])?.focus();
      }}><div className="settings-caption">{t("settings.caption")}</div>{tabs.map(([id, label, Icon], index) => <button key={id} ref={(element) => { tabRefs.current.set(id, element); if (index === 0) firstTab.current = element; }} type="button" role="tab" id={`settings-tab-${id}`} aria-controls="settings-panel" aria-selected={section === id} tabIndex={section === id ? 0 : -1} className={section === id ? "is-active" : ""} onClick={() => selectSection(id)}><Icon size={17} aria-hidden="true" />{label}</button>)}</aside>
      <section className="settings-content" id="settings-panel" role="tabpanel" aria-labelledby={`settings-tab-${section}`}><header className="settings-heading"><h3>{title}</h3><button type="button" className="ui-icon-button" aria-label={t("settings.closeAria")} disabled={busy} onClick={onClose}><IconX size={18} /></button></header>
        <div className="settings-content-scroll" tabIndex={0} role="region" aria-label={t("settings.contentAria", { title })}>
          {section === "assistant" && <AssistantConnection />}
          {section === "maps" && <TripMapConnection api={api.trip} />}
          {section === "appearance" && <>
            <SettingRow title={t("common.locale.title")} description={t("common.locale.description")}>
              <select className="mb-field" aria-label={t("common.locale.title")} value={locale} disabled={busy}
                onChange={(event) => void setLocale(event.target.value).catch((failure) => setError(failure.message))}>
                {SUPPORTED_LOCALES.map((code) => <option key={code} value={code}>{LOCALE_METADATA[code].selectorLabel}</option>)}
              </select>
            </SettingRow>
            <SettingRow title={t("settings.appearance.styleTitle")} description={t("settings.appearance.styleDesc")}><div className="settings-style-choice" aria-label={t("settings.appearance.styleAria")}><span className="settings-style-preview" aria-hidden="true"><i /><i /><i /></span><b>{t("settings.appearance.styleName")}</b><small>{t("settings.appearance.styleSummary")}</small><span className="settings-style-check"><IconCheck size={12} /></span></div></SettingRow>
            <SettingRow title={t("settings.appearance.modeTitle")} description={t("settings.appearance.modeDesc")}><div className="settings-mode-options" role="radiogroup" onKeyDown={navigateChoiceGroup} aria-label={t("settings.appearance.modeTitle")}>{THEME_PREFERENCES.map((value) => { const Icon = modeIcons[value]; return <button type="button" role="radio" tabIndex={theme === value ? 0 : -1} aria-checked={theme === value} className={theme === value ? "is-active" : ""} key={value} onClick={() => onPreferenceChange({ theme: value })}><Icon size={16} />{themeLabels[value]}</button>; })}</div></SettingRow>
            <SettingRow title={t("settings.appearance.contrastTitle")} description={t("settings.appearance.contrastDesc")}>
              <div className="settings-mode-options" role="radiogroup" onKeyDown={navigateChoiceGroup} aria-label={t("settings.appearance.contrastTitle")}>
                {CONTRAST_PREFERENCES.map((value) => <button key={value} type="button" role="radio" tabIndex={devicePreferences.contrast === value ? 0 : -1}
                  aria-checked={devicePreferences.contrast === value} className={devicePreferences.contrast === value ? "is-active" : ""}
                  onClick={() => onDevicePreferenceChange({ contrast: value })}>{contrastLabels[value]}</button>)}
              </div>
            </SettingRow>
            <SettingRow title={t("settings.appearance.sidebarTitle")} description={t("settings.appearance.sidebarDesc")}>
              <div className="settings-sidebar-sections">{SIDEBAR_SECTIONS.map((id) => <label key={id}>
                <input type="checkbox" checked={devicePreferences.sidebarSections[id]}
                  onChange={(event) => onDevicePreferenceChange({ sidebarSections: { [id]: event.target.checked } })} />{sidebarSectionLabels[id]}
              </label>)}</div>
            </SettingRow>
            <SettingRow title={t("settings.appearance.dbTabsTitle")}>
              <select className="mb-field" aria-label={t("settings.appearance.dbTabsTitle")} value={devicePreferences.databaseViewTabDisplay}
                onChange={(event) => onDevicePreferenceChange({ databaseViewTabDisplay: event.target.value })}>
                {DATABASE_VIEW_TAB_DISPLAYS.map((value) => <option value={value} key={value}>{databaseTabLabels[value]}</option>)}
              </select>
            </SettingRow>
            <SettingRow title={t("settings.appearance.defaultFontTitle")} description={t("settings.appearance.defaultFontDesc")}><div className="settings-font-options" role="radiogroup" onKeyDown={navigateChoiceGroup} aria-label={t("settings.appearance.defaultFontAria")}>{Object.entries(fontLabels).map(([value, label]) => <button type="button" role="radio" tabIndex={font === value ? 0 : -1} aria-label={label} aria-checked={font === value} key={value} className={`settings-font-${value}${font === value ? " is-active" : ""}`} onClick={() => onPreferenceChange({ defaultFont: value })}><b>{t("settings.appearance.fontSample")}</b><small>{label}</small></button>)}</div></SettingRow>
            <SettingRow title={t("settings.appearance.startPageTitle")}><select className="mb-field" aria-label={t("settings.appearance.startPageTitle")} value={preferences.startPage || "last"} onChange={(event) => onPreferenceChange({ startPage: event.target.value })}><option value="last">{t("settings.appearance.startPageLast")}</option><option value="home">{t("settings.appearance.startPageHome")}</option></select></SettingRow>
            <SettingRow title={t("settings.appearance.reopenTabsTitle")} description={t("settings.appearance.reopenTabsDesc")}>
              <label className="settings-sidebar-sections"><input type="checkbox" aria-label={t("settings.appearance.reopenTabsAria")} checked={devicePreferences.reopenPageTabs}
                onChange={(event) => onDevicePreferenceChange({ reopenPageTabs: event.target.checked })} />{t("common.enable")}</label>
            </SettingRow>
          </>}
          {section === "workspace" && <WorkspaceSettings workspace={workspace} onChange={(patch) => { onIdentityChange(patch); setNotice(t("settings.workspace.updated")); }} />}
          {section === "data" && desktop && <>
            <SettingRow title={t("settings.data.dirTitle")} description={t("settings.data.dirDesc")}><span className="settings-data-path">{info?.dataRoot || t("settings.data.reading")}</span></SettingRow>
            <div className="settings-actions"><button type="button" className="mb-button" disabled={busy} onClick={() => run(async () => { unwrap(await api.app.openDataFolder(), t("common.opIncomplete")); })}>{t("settings.data.openFolder")}</button><button type="button" className="mb-button" disabled={busy} onClick={() => run(async () => { const result = unwrap(await api.app.changeDataRoot(), t("common.opIncomplete")); if (!result.changed) setNotice(t("settings.data.keptFolder")); })}>{t("settings.data.changeFolder")}</button></div>
            <SettingRow title={t("settings.data.cleanupTitle")} description={t("settings.data.cleanupDesc")}><button type="button" className="mb-button" disabled={busy} onClick={() => run(scan)}>{t("settings.data.scanUnused")}</button></SettingRow>
            {assets && <div className="settings-asset-list">{assets.length ? <><label className="settings-select-all"><input type="checkbox" aria-label={t("common.selectAll")} checked={assets.length > 0 && selected.size === assets.length} onChange={(event) => setSelected(new Set(event.target.checked ? assets.map((asset) => asset.sha256) : []))} />{t("common.selectAll")}</label>{assets.map((asset) => <label className="settings-asset-row" key={asset.sha256}><input type="checkbox" aria-label={t("settings.data.selectAsset", { name: asset.originalName })} checked={selected.has(asset.sha256)} onChange={(event) => setSelected((current) => { const next = new Set(current); if (event.target.checked) next.add(asset.sha256); else next.delete(asset.sha256); return next; })} /><span>{asset.originalName}<small>{dateLabel(asset.createdAt)}</small></span><small>{formatBackupSize(asset.size)}</small></label>)}<div className="settings-actions"><button type="button" className="mb-button" disabled={busy || !selected.size} onClick={moveAssets}>{t("settings.data.moveToTrash")}</button></div></> : <p className="settings-muted">{t("settings.data.noUnused")}</p>}</div>}
            <SettingRow title={t("settings.data.trashTitle")} description={t("settings.data.trashDesc")} />{batches.length ? batches.map((batch) => <div className="settings-trash-row" key={batch.trashId}><span>{dateLabel(batch.createdAt)}<small>{t("settings.data.trashMeta", { count: batch.count, size: formatBackupSize(batch.sizeBytes), days: Math.max(0, Math.ceil((new Date(batch.expiresAt).getTime() - Date.now()) / 86400000)) })}</small></span><button type="button" className="mb-button" disabled={busy} onClick={() => run(async () => { const result = unwrap(await api.assets.restoreTrash({ trashId: batch.trashId }), t("common.opIncomplete")); setBatches(unwrap(await api.assets.listTrash(), t("common.opIncomplete")).batches); setAssets(null); setNotice(t("settings.data.restoredNotice", { count: result.restoredCount })); })}>{t("common.restore")}</button></div>) : <p className="settings-muted">{t("settings.data.trashEmpty")}</p>}
          </>}
          {section === "backup" && <>
            {desktop && <>
              <SettingRow title={t("settings.backup.cloudTitle")} description={cloudDestination ? t("settings.backup.cloudActive", { destination: t(`backup.dest.${schedule.destination}`) || cloudDestination, status: schedule.enabled ? t("settings.backup.scheduleOn") : t("settings.backup.scheduleOff") }) : t("settings.backup.cloudDesc")}>
                <button type="button" className="mb-button" onClick={() => { onClose(); onOpenBackup("schedule"); }}>{t("settings.backup.cloudAction")}</button>
              </SettingRow>
              <SettingRow title={t("settings.backup.lastFull")}><span>{backup?.lastFullBackupAt ? dateLabel(backup.lastFullBackupAt) : t("settings.backup.neverExported")}</span></SettingRow>
              <SettingRow title={t("settings.backup.schedule")}><span>{schedule?.enabled ? t("settings.backup.scheduleRule", { weekday: format.formatWeekday(schedule.weekday, locale), hour: `${String(schedule.hour).padStart(2, "0")}:00`, folder: schedule.folder }) : t("settings.backup.scheduleOffShort")}</span></SettingRow>
            </>}
            <div className="settings-actions"><button type="button" className="mb-button" onClick={() => { onClose(); onOpenBackup(); }}>{t("settings.backup.openDialog")}</button></div>
          </>}
          {section === "vault" && <SettingRow title={t("settings.vault.title")} description={t("settings.vault.desc")}>{desktop ? <button type="button" className="mb-button" disabled={busy} onClick={() => run(async () => { unwrap(await api.app.openVaultWindow({ section: "settings" }), t("common.opIncomplete")); })}>{t("settings.vault.open")}</button> : <span className="settings-muted">{t("settings.vault.desktopOnly")}</span>}</SettingRow>}
          {section === "shortcuts" && <table className="settings-shortcuts" aria-label={t("settings.shortcuts.aria")}><tbody>{getShortcuts(t).map((shortcut) => <tr key={shortcut.id}><td>{shortcut.description}</td><td><kbd>{shortcut.keys}</kbd></td></tr>)}</tbody></table>}
          {section === "about" && <AboutWorkspaceContent />}
          {error && <p role="alert" className="settings-error">{error}</p>}{notice && <p role="status" className="settings-muted">{notice}</p>}
        </div>
      </section>
    </div>
  </Dialog>;
}
