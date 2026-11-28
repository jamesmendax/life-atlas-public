import { useEffect, useRef, useState } from "react";
import IconArrowDownToArc from "@tabler/icons-react/dist/esm/icons/IconArrowDownToArc.mjs";
import IconArrowUpFromArc from "@tabler/icons-react/dist/esm/icons/IconArrowUpFromArc.mjs";
import IconHistory from "@tabler/icons-react/dist/esm/icons/IconHistory.mjs";
import IconShieldCheck from "@tabler/icons-react/dist/esm/icons/IconShieldCheck.mjs";
import IconClock from "@tabler/icons-react/dist/esm/icons/IconClock.mjs";
import { Dialog } from "../ui/Dialog.jsx";
import { ConfirmDialog } from "../ui/ConfirmDialog.jsx";
import { exportBrowserBackup, inspectBrowserBackup, restoreBrowserBackup } from "../backup/browserBackup.js";
import { WORKSPACE_RESCUE_SCOPE } from "../backup/manifest.js";
import { BACKUP_DESTINATIONS } from "../backup/scheduleDestinations.js";
import { workspaceStorageKey, workspaceSchemaVersion } from "../persistence/workspaceRepository.js";
import { format, useI18n } from "../i18n/workspaceRuntime.js";

export function formatBackupSize(bytes = 0) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function unwrap(result, fallbackMessage) {
  if (!result?.ok) {
    const error = new Error(result?.error?.message || fallbackMessage);
    error.code = result?.error?.code;
    throw error;
  }
  return result.value;
}

export function BackupSummary({ summary }) {
  const { locale, t } = useI18n();
  const rescue = summary.scope === WORKSPACE_RESCUE_SCOPE;
  const dateLabel = (value) => value ? format.formatDateTime(value, locale, { includeSeconds: true }) : t("common.noRecord");
  return <dl className="mb-backup-summary">
    <div><dt>{t("backup.summary.time")}</dt><dd>{dateLabel(summary.createdAt)}</dd></div><div><dt>{t("backup.summary.source")}</dt><dd>{rescue ? t("backup.summary.sourceRescue") : summary.platform === "browser" ? t("backup.summary.sourceBrowser") : t("backup.summary.sourceDesktop")} · v{summary.appVersion}</dd></div>
    <div><dt>{t("backup.summary.contents")}</dt><dd>{t("backup.summary.counts", { pages: summary.counts.pages, dataSources: summary.counts.dataSources, databaseItems: summary.counts.databaseItems })}</dd></div>
    {rescue && <div><dt>{t("backup.summary.rescueScope")}</dt><dd>{t("backup.summary.rescueScopeDesc")}</dd></div>}
    <div><dt>{t("backup.summary.assets")}</dt><dd>{t("backup.summary.assetsValue", { count: summary.assets.count, size: formatBackupSize(summary.assets.totalBytes) })}</dd></div>
    <div><dt>{t("backup.summary.vault")}</dt><dd>{summary.vault.included ? t("backup.summary.vaultIncluded", { count: summary.vault.itemCount }) : t("backup.summary.vaultExcluded")}</dd></div><div><dt>{t("backup.summary.encrypted")}</dt><dd>{summary.encrypted ? t("backup.summary.encryptedYes") : t("backup.summary.encryptedNo")}</dd></div>
  </dl>;
}

export function WorkspaceRescueDialog({ getWorkspaceSnapshot, onClose }) {
  const { t } = useI18n();
  const api = window.lifeAtlas.backup;
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => api.onProgress((value) => {
    if (value.kind === "export-rescue") setProgress(value);
  }), [api]);

  const exportRescue = async () => {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const value = unwrap(await api.exportRescue(getWorkspaceSnapshot()), t("common.opIncomplete"));
      setMessage(t("backup.rescue.saved", { path: value.filePath }));
    } catch (failure) {
      if (failure.code === "E_CANCELLED") setMessage(t("backup.rescue.cancelled"));
      else setError(failure.message || t("backup.rescue.writeFailed"));
    } finally {
      setProgress(null);
      setBusy(false);
    }
  };

  return <Dialog title={t("backup.rescue.title")} description={t("backup.rescue.desc")} onClose={onClose} busy={busy} className="mb-backup-dialog" dialogKind="workspace-rescue">
    <div className="mb-dialog-body">
      <p>{t("backup.rescue.body")}</p>
      {error && <p className="mb-danger-text" role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      {busy && <p role="status">{progress?.phase === "verify" ? t("backup.rescue.phaseVerify") : progress?.phase === "write" ? t("backup.rescue.phaseWrite") : t("backup.rescue.phasePick")}</p>}
    </div>
    <footer className="mb-dialog-footer">
      <button type="button" className="mb-button" onClick={onClose} disabled={busy}>{t("common.close")}</button>
      {busy && progress && <button type="button" className="mb-button" onClick={() => void api.cancel({ jobId: progress.jobId })}>{t("backup.rescue.cancel")}</button>}
      <button type="button" className="mb-button mb-primary" disabled={busy} onClick={exportRescue}>{error ? t("backup.rescue.retryPick") : t("backup.rescue.pickAndExport")}</button>
    </footer>
  </Dialog>;
}

export function BackupDialog({ getWorkspaceSnapshot, flushWorkspace, repository, onClose, initialTab = "backup", initialSchedule, recoveryMode = false }) {
  const { locale, t } = useI18n();
  const api = window.lifeAtlas?.backup;
  const dateLabel = (value) => value ? format.formatDateTime(value, locale, { includeSeconds: true }) : t("common.noRecord");
  const destinationLabel = (id) => t(`backup.dest.${id}`) || BACKUP_DESTINATIONS[id] || id;
  const desktop = Boolean(api);
  const exportRef = useRef(null);
  const inputRef = useRef(null);
  const [tab, setTab] = useState(initialTab);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [inspection, setInspection] = useState(null);
  const [progress, setProgress] = useState(null);
  const [includeVault, setIncludeVault] = useState(false);
  const [vaultExists, setVaultExists] = useState(false);
  const [encrypt, setEncrypt] = useState(false);
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [passwordInspection, setPasswordInspection] = useState(null);
  const [restoreVault, setRestoreVault] = useState(true);
  const [snapshots, setSnapshots] = useState([]);
  const [selectedSnapshot, setSelectedSnapshot] = useState(null);
  const [snapshotWorkspace, setSnapshotWorkspace] = useState(true);
  const [snapshotVault, setSnapshotVault] = useState(false);
  const [verification, setVerification] = useState(null);
  const [confirmation, setConfirmation] = useState(null);
  const [status, setStatus] = useState(null);
  const [savedSchedule, setSavedSchedule] = useState(null);
  const [schedule, setSchedule] = useState({ destination: "local", enabled: false, folder: null, weekday: 0, hour: 20, keepLast: 8, includeVault: false, encrypt: false });
  const [schedulePassword, setSchedulePassword] = useState("");
  const cloudDestination = schedule.destination !== "local";
  const scheduleCanSave = Boolean(savedSchedule) && (!schedule.enabled || Boolean(schedule.folder)) && (!schedule.encrypt || Boolean(schedulePassword)) && Number.isInteger(schedule.keepLast) && schedule.keepLast >= 1 && schedule.keepLast <= 52;

  const run = async (operation) => {
    if (busy) return;
    setBusy(true); setError(""); setMessage("");
    try { await operation(); } catch (failure) { if (failure.code !== "E_CANCELLED") setError(failure.message); }
    finally { setBusy(false); setProgress(null); }
  };

  const refreshSnapshots = async () => setSnapshots(unwrap(await api.listSnapshots(), t("common.opIncomplete")).snapshots);
  useEffect(() => {
    if (!api) return undefined;
    let active = true;
    const stop = api.onProgress((value) => { if (active) setProgress(value); });
    Promise.all([api.getStatus(), api.listSnapshots(), api.getSchedule(), window.lifeAtlas.app.getVaultStatus()]).then(([backupStatus, snapshotResult, scheduleResult, vaultStatus]) => {
      if (!active) return;
      if (backupStatus?.ok) setStatus(backupStatus.value);
      if (snapshotResult?.ok) setSnapshots(snapshotResult.value.snapshots);
      if (scheduleResult?.ok && scheduleResult.value.schedule) {
        const saved = scheduleResult.value.schedule;
        setSavedSchedule(saved);
        setSchedule(initialSchedule ? { ...saved, ...initialSchedule } : saved);
      }
      if (vaultStatus?.ok) { setVaultExists(vaultStatus.value.exists); setIncludeVault(vaultStatus.value.exists); }
    }).catch((failure) => { if (active) setError(failure.message); });
    return () => { active = false; stop?.(); };
  }, [api, initialSchedule]);

  const exportBackup = () => run(async () => {
    if (desktop) {
      if (encrypt && (!password || password !== passwordConfirmation)) throw new Error(t("backup.export.passwordMismatch"));
      const flushed = await flushWorkspace();
      if (!flushed?.ok) throw new Error(flushed?.error?.message || t("backup.saveIncomplete"));
      const value = unwrap(await api.exportFull({ includeVault, encryptPassword: encrypt ? password : null }), t("common.opIncomplete"));
      setPassword("");
      setPasswordConfirmation("");
      setMessage(t("backup.export.doneDesktop", { path: value.filePath }));
      setStatus(unwrap(await api.getStatus(), t("common.opIncomplete")));
    } else {
      await flushWorkspace?.();
      const exported = await exportBrowserBackup({ workspace: getWorkspaceSnapshot(), now: new Date() });
      const url = URL.createObjectURL(exported.blob);
      const link = document.createElement("a");
      link.href = url; link.download = exported.fileName; document.body.append(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      const skipped = exported.skippedAttachmentIds.length ? t("backup.export.browserSkipped", { count: exported.skippedAttachmentIds.length }) : "";
      setMessage(t("backup.export.doneBrowser", { name: exported.fileName, size: formatBackupSize(exported.blob.size), skipped }));
    }
  });

  const acceptInspection = (value, kind = "restore") => {
    if (value.cancelled) return;
    if (value.needsPassword) { setPassword(""); setPasswordInspection({ ...value, kind }); return; }
    if (kind === "verify") setVerification(value.report);
    else { setInspection(value); setRestoreVault(Boolean(value.summary?.vault?.included)); }
  };

  const inspectFile = () => desktop ? run(async () => { setInspection(null); acceptInspection(unwrap(await api.inspect(), t("common.opIncomplete"))); }) : inputRef.current?.click();
  const inspectScheduled = () => run(async () => {
    const value = unwrap(await api.inspectScheduled(), t("common.opIncomplete"));
    if (value.cancelled) return;
    setInspection(null);
    setTab("backup");
    acceptInspection(value);
  });
  const browserFile = (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) void run(async () => setInspection(await inspectBrowserBackup(new Uint8Array(await file.arrayBuffer()), { fileName: file.name })));
  };

  const performRestore = () => run(async () => {
    if (!recoveryMode && flushWorkspace) {
      const flushed = await flushWorkspace();
      if (!flushed?.ok) throw new Error(flushed?.error?.message || t("backup.unsavedChanges"));
    }
    repository?.suspendSaves?.();
    try {
      if (desktop) unwrap(await api.restore({ token: inspection.token, restoreVault: inspection.summary.vault.included && restoreVault }), t("common.opIncomplete"));
      else await restoreBrowserBackup(inspection.token, { storage: window.localStorage, storageKey: workspaceStorageKey, legacyKeys: Array.from({ length: workspaceSchemaVersion - 1 }, (_, index) => `life-atlas.workspace.v${workspaceSchemaVersion - index - 1}`) });
      window.location.reload();
    } catch (failure) { repository?.resumeSaves?.(); setInspection(null); throw failure; }
  });

  const performSnapshotRestore = () => run(async () => {
    if (!recoveryMode) {
      const result = await flushWorkspace();
      if (!result?.ok) throw new Error(t("backup.unsavedChanges"));
    }
    repository?.suspendSaves?.();
    try { unwrap(await api.restoreSnapshot({ id: selectedSnapshot.id, restoreWorkspace: snapshotWorkspace, restoreVault: snapshotVault }), t("common.opIncomplete")); window.location.reload(); }
    catch (failure) { repository?.resumeSaves?.(); throw failure; }
  });

  const saveSchedule = () => run(async () => {
    if (!scheduleCanSave) return;
    const value = unwrap(await api.setSchedule({ destination: schedule.destination, enabled: schedule.enabled, folder: schedule.folder, weekday: schedule.weekday, hour: schedule.hour, keepLast: schedule.keepLast, includeVault: schedule.includeVault, encryptPassword: schedule.encrypt ? schedulePassword : null }), t("common.opIncomplete"));
    setSavedSchedule(value.schedule);
    setSchedule(value.schedule);
    setSchedulePassword("");
    setMessage(t("backup.schedule.saved"));
  });
  const runSchedule = () => run(async () => {
    const flushed = await flushWorkspace();
    if (!flushed?.ok) throw new Error(flushed?.error?.message || t("backup.saveIncomplete"));
    const value = unwrap(await api.runScheduleNow(), t("common.opIncomplete"));
    setSavedSchedule(value.schedule);
    setSchedule(value.schedule);
    if (!value.filePath) throw new Error(value.schedule.lastResult?.message || t("backup.schedule.writeFailed"));
    setMessage(t("backup.schedule.ranNow", { destination: destinationLabel(value.schedule.destination) }));
    setStatus(unwrap(await api.getStatus(), t("common.opIncomplete")));
  });

  return <>
    <Dialog title={t("backup.title")} description={t("backup.description")} onClose={onClose} initialFocusRef={exportRef} busy={busy} className="mb-backup-dialog">
      {desktop && <nav className="mb-dialog-tabs" aria-label={t("backup.tabsAria")}>{[["backup", t("backup.tab.backup"), IconArrowUpFromArc], ["snapshots", t("backup.tab.snapshots"), IconHistory], ["verify", t("backup.tab.verify"), IconShieldCheck], ["schedule", t("backup.tab.schedule"), IconClock]].map(([id, label, Icon]) => <button type="button" key={id} className={tab === id ? "is-active" : ""} aria-pressed={tab === id} onClick={() => setTab(id)} disabled={busy}><Icon size={15} />{label}</button>)}</nav>}
      <div className="mb-dialog-body">
        {error && <div role="alert" className="mb-alert mb-alert-error">{error}</div>}
        {message && <div role="status" className="mb-alert">{message}</div>}
        {snapshots.some((snapshot) => snapshot.integrity === "failed") && <div role="alert" className="mb-alert mb-alert-error">{t("backup.integrityFailed")}</div>}
        {progress && <div className="mb-backup-progress" role="status"><span>{progress.phase === "confirm-vault" ? t("backup.progressVaultConfirm") : `${progress.phase} · ${progress.total ? `${Math.round(progress.done / progress.total * 100)}%` : t("common.processing")}`}</span><progress max={progress.total || 1} value={progress.done || 0} />{progress.kind === "export" && <button type="button" className="mb-button" onClick={() => api.cancel({ jobId: progress.jobId })}>{t("backup.rescue.cancel")}</button>}</div>}
        {tab === "backup" && <>
          <section className="mb-backup-section"><h3><IconArrowUpFromArc size={17} />{t("backup.export.title")}</h3><p>{t("backup.export.desc")}</p>
            {!desktop && <p>{t("backup.export.browserHint")}</p>}
            {desktop && <><p className="mb-secondary">{t("backup.export.lastFull", { time: dateLabel(status?.lastFullBackupAt) })}</p><label className="mb-check-row"><input type="checkbox" checked={includeVault} disabled={!vaultExists || busy} onChange={(event) => setIncludeVault(event.target.checked)} />{t("backup.export.includeVault")}<span>{vaultExists ? t("backup.export.vaultEncrypted") : t("backup.export.noVault")}</span></label><label className="mb-check-row"><input type="checkbox" checked={encrypt} disabled={busy} onChange={(event) => { setEncrypt(event.target.checked); setPassword(""); setPasswordConfirmation(""); }} />{t("backup.export.encryptAll")}</label>{encrypt && <div className="mb-field-group"><label htmlFor="backup-encrypt-password">{t("backup.export.password")}</label><input className="mb-field" id="backup-encrypt-password" type="password" value={password} autoComplete="new-password" onChange={(event) => setPassword(event.target.value)} /><label htmlFor="backup-confirm-password">{t("backup.export.confirmPassword")}</label><input className="mb-field" id="backup-confirm-password" type="password" value={passwordConfirmation} autoComplete="new-password" onChange={(event) => setPasswordConfirmation(event.target.value)} />{passwordConfirmation && password !== passwordConfirmation && <p className="mb-danger-text">{t("backup.export.passwordMismatch")}</p>}<p className="mb-alert">{t("backup.export.passwordWarn")}</p></div>}</>}
            <button ref={exportRef} type="button" className="mb-button mb-primary" disabled={busy || recoveryMode || (encrypt && (!password || password !== passwordConfirmation))} onClick={exportBackup}>{busy && !progress ? t("common.processing") : t("backup.export.action")}</button>{recoveryMode && <p className="mb-secondary">{t("backup.export.recoveryNotice")}</p>}
          </section>
          <section className="mb-backup-section"><h3><IconArrowDownToArc size={17} />{t("backup.restore.title")}</h3><p>{t("backup.restore.desc")}</p><input ref={inputRef} type="file" accept=".lifeatlas,application/zip" aria-label={t("backup.restore.selectAria")} hidden onChange={browserFile} /><button type="button" className="mb-button" onClick={inspectFile} disabled={busy}>{t("backup.restore.selectBtn")}</button>
            {inspection?.problems?.length > 0 && <ul className="mb-problem-list" role="alert">{inspection.problems.slice(0, 10).map((problem, index) => <li key={index}>{problem.code} {problem.path}: {problem.detail}</li>)}</ul>}
            {inspection?.token && <><BackupSummary summary={inspection.summary} />{inspection.summary.vault.included && <label className="mb-check-row"><input type="checkbox" checked={restoreVault} onChange={(event) => setRestoreVault(event.target.checked)} />{t("backup.restore.restoreVault")}<span>{t("backup.restore.restoreVaultHint")}</span></label>}<p className="mb-danger-text">{desktop ? t("backup.restore.replaceDesktop") : t("backup.restore.replaceBrowser")}</p><button type="button" className="mb-button mb-danger-button" disabled={busy} onClick={() => setConfirmation("backup")}>{t("common.restore")}</button></>}
          </section>
        </>}
        {tab === "snapshots" && <section className="mb-backup-section"><h3>{t("backup.snapshots.title")}</h3><p>{t("backup.snapshots.desc")}</p><button type="button" className="mb-button" disabled={busy || recoveryMode} onClick={() => run(async () => { if (recoveryMode) return; const flushed = await flushWorkspace(); if (!flushed?.ok) throw new Error(t("backup.snapshots.saveFirst")); unwrap(await api.createSnapshot(), t("common.opIncomplete")); await refreshSnapshots(); setMessage(t("backup.snapshots.created")); })}>{t("backup.snapshots.create")}</button>
          <div className="mb-snapshot-list">{snapshots.length === 0 ? <p className="mb-secondary">{t("backup.snapshots.empty")}</p> : snapshots.map((snapshot) => <button type="button" key={snapshot.id} className={selectedSnapshot?.id === snapshot.id ? "is-selected" : ""} onClick={() => { setSelectedSnapshot(snapshot); setSnapshotWorkspace(snapshot.includesWorkspace); setSnapshotVault(false); }}><IconHistory size={16} /><span><strong>{t(`backup.reason.${snapshot.reason}`) || snapshot.reason}</strong><small>{dateLabel(snapshot.createdAt)}{snapshot.integrity === "failed" ? t("backup.snapshots.failedBadge") : ""}</small></span><small>{formatBackupSize(snapshot.sizeBytes)}</small></button>)}</div>
          {selectedSnapshot && <div className="mb-snapshot-restore"><label className="mb-check-row"><input type="checkbox" disabled={!selectedSnapshot.includesWorkspace} checked={snapshotWorkspace} onChange={(event) => setSnapshotWorkspace(event.target.checked)} />{t("backup.snapshots.restoreWorkspace")}</label><label className="mb-check-row"><input type="checkbox" disabled={!selectedSnapshot.includesVault} checked={snapshotVault} onChange={(event) => setSnapshotVault(event.target.checked)} />{t("backup.snapshots.restoreVault")}</label>{snapshotVault && <p className="mb-danger-text">{t("backup.snapshots.vaultWarn")}</p>}<button type="button" className="mb-button mb-danger-button" disabled={busy || (!snapshotWorkspace && !snapshotVault)} onClick={() => setConfirmation("snapshot")}>{t("backup.snapshots.restoreBtn")}</button></div>}
        </section>}
        {tab === "verify" && <section className="mb-backup-section"><h3>{t("backup.verify.title")}</h3><p>{t("backup.verify.desc")}</p><button type="button" className="mb-button" disabled={busy} onClick={() => run(async () => acceptInspection(unwrap(await api.verify(), t("common.opIncomplete")), "verify"))}>{t("backup.verify.btn")}</button>{verification && <><p role="status" className={verification.ok ? "" : "mb-danger-text"}>{verification.ok ? t("backup.verify.ok") : t("backup.verify.fail")}</p>{verification.summary && <BackupSummary summary={verification.summary} />}<ul className="mb-problem-list">{verification.problems?.slice(0, 50).map((problem, index) => <li key={index}>{problem.code} {problem.path}: {problem.detail}</li>)}</ul></>}</section>}
        {tab === "schedule" && <>
          <section className="mb-backup-section">
            <h3>{t("backup.schedule.title")}</h3>
            <div className="mb-form-row"><label>{t("backup.schedule.to")}<select value={schedule.destination} disabled={busy || !savedSchedule} onChange={(event) => setSchedule({ ...schedule, destination: event.target.value, folder: null })}>
              {Object.keys(BACKUP_DESTINATIONS).map((id) => <option key={id} value={id}>{destinationLabel(id)}</option>)}
            </select></label></div>
            {schedule.destination === "onedrive" && <p>{t("backup.schedule.onedriveHint")}</p>}
            {schedule.destination === "google-drive" && <p>{t("backup.schedule.gdriveHint")}</p>}
            {cloudDestination && <p>{t("backup.schedule.cloudHint")}</p>}
            <div className="mb-folder-choice"><span>{schedule.folder || t("backup.schedule.noFolder")}</span><button type="button" className="mb-button" disabled={busy || !savedSchedule} onClick={() => run(async () => { const value = unwrap(await api.chooseScheduleFolder(), t("common.opIncomplete")); if (!value.cancelled) setSchedule({ ...schedule, folder: value.folder }); })}>{t("backup.schedule.chooseFolder")}</button></div>
            <label className="mb-check-row"><input type="checkbox" checked={schedule.enabled} disabled={busy || !savedSchedule} onChange={(event) => setSchedule({ ...schedule, enabled: event.target.checked })} />{t("backup.schedule.enable")}</label>
            <p>{t("backup.schedule.weeklyDesc")}</p>
            <div className="mb-form-row">
              <label>{t("backup.schedule.weekday")}<select value={schedule.weekday} disabled={busy} onChange={(event) => setSchedule({ ...schedule, weekday: Number(event.target.value) })}>{Array.from({ length: 7 }, (_, index) => <option key={index} value={index}>{format.formatWeekday(index, locale)}</option>)}</select></label>
              <label>{t("backup.schedule.hour")}<select value={schedule.hour} disabled={busy} onChange={(event) => setSchedule({ ...schedule, hour: Number(event.target.value) })}>{Array.from({ length: 24 }, (_, hour) => <option key={hour} value={hour}>{String(hour).padStart(2, "0")}:00</option>)}</select></label>
              <label>{t("backup.schedule.keep")}<input type="number" min="1" max="52" value={schedule.keepLast} disabled={busy} onChange={(event) => setSchedule({ ...schedule, keepLast: Number(event.target.value) })} />{t("backup.schedule.keepUnit")}</label>
            </div>
            {cloudDestination && <p>{t("backup.schedule.cloudPrune")}</p>}
            <label className="mb-check-row"><input type="checkbox" checked={schedule.includeVault} disabled={busy || !vaultExists} onChange={(event) => setSchedule({ ...schedule, includeVault: event.target.checked })} />{t("backup.export.includeVault")}</label>
            <label className="mb-check-row"><input type="checkbox" checked={schedule.encrypt} disabled={busy} onChange={(event) => { setSchedule({ ...schedule, encrypt: event.target.checked }); setSchedulePassword(""); }} />{t("backup.export.encryptAll")}</label>
            {schedule.encrypt && <div className="mb-field-group"><label htmlFor="schedule-password">{t("backup.schedule.password")}</label><input id="schedule-password" type="password" value={schedulePassword} disabled={busy} autoComplete="new-password" onChange={(event) => setSchedulePassword(event.target.value)} /><p>{t("backup.schedule.passwordHint")}</p></div>}
            <div className="mb-form-row">
              <button type="button" className="mb-button mb-primary" disabled={busy || recoveryMode || !scheduleCanSave} onClick={saveSchedule}>{t("backup.schedule.save")}</button>
              {cloudDestination && <button type="button" className="mb-button" disabled={busy || recoveryMode || schedule !== savedSchedule || !savedSchedule?.folder} onClick={runSchedule}>{t("backup.schedule.runNow")}</button>}
            </div>
            {savedSchedule?.lastResult && savedSchedule.destination === schedule.destination && savedSchedule.folder === schedule.folder && <p className={savedSchedule.lastResult.ok ? "mb-secondary" : "mb-danger-text"}>{dateLabel(savedSchedule.lastResult.at)} · {savedSchedule.lastResult.message}</p>}
          </section>
          {cloudDestination && <section className="mb-backup-section"><h3>{t("backup.schedule.cloudRestoreTitle")}</h3><p>{t("backup.schedule.cloudRestoreDesc")}</p><button type="button" className="mb-button" disabled={busy} onClick={inspectScheduled}>{t("backup.schedule.cloudRestoreBtn")}</button></section>}
        </>}
      </div>
    </Dialog>
    {confirmation && <ConfirmDialog title={confirmation === "backup" ? t("backup.confirm.backupTitle") : t("backup.confirm.snapshotTitle")} description={t("backup.confirm.desc")} confirmLabel={t("backup.confirm.ok")} danger onClose={() => setConfirmation(null)} onConfirm={() => { const mode = confirmation; setConfirmation(null); if (mode === "backup") void performRestore(); else void performSnapshotRestore(); }} />}
    {passwordInspection && <Dialog title={t("backup.passwordModal.title")} description={t("backup.passwordModal.desc")} onClose={() => { setPasswordInspection(null); setPassword(""); }}><form className="mb-dialog-body" onSubmit={(event) => { event.preventDefault(); void run(async () => { const context = passwordInspection; const value = unwrap(await (context.kind === "verify" ? api.verifyWithPassword({ inspectId: context.inspectId, password }) : api.inspectWithPassword({ inspectId: context.inspectId, password })), t("common.opIncomplete")); setPasswordInspection(null); setPassword(""); acceptInspection(value, context.kind); }); }}><label className="mb-field-group">{t("backup.passwordModal.label")}<input type="password" autoFocus value={password} autoComplete="current-password" onChange={(event) => setPassword(event.target.value)} /></label>{error && <p role="alert" className="mb-danger-text">{error}</p>}<button type="submit" className="mb-button mb-primary" disabled={busy || !password}>{t("backup.passwordModal.submit")}</button></form></Dialog>}
  </>;
}
