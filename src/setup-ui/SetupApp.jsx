import { useEffect, useState } from "react";
import IconAlertTriangle from "@tabler/icons-react/dist/esm/icons/IconAlertTriangle.mjs";
import IconCheck from "@tabler/icons-react/dist/esm/icons/IconCheck.mjs";
import IconFolder from "@tabler/icons-react/dist/esm/icons/IconFolder.mjs";
import IconArrowRight from "@tabler/icons-react/dist/esm/icons/IconArrowRight.mjs";
import IconFileImport from "@tabler/icons-react/dist/esm/icons/IconFileImport.mjs";
import IconFilePlus from "@tabler/icons-react/dist/esm/icons/IconFilePlus.mjs";
import IconArrowLeft from "@tabler/icons-react/dist/esm/icons/IconArrowLeft.mjs";
import IconShieldLock from "@tabler/icons-react/dist/esm/icons/IconShieldLock.mjs";
import { useI18n } from "../i18n/surfaces.js";

export function SetupApp() {
  const api = window.lifeAtlasSetup;
  const { locale, locales, metadata, setLocale, t, format } = useI18n();
  const [step, setStep] = useState(0);
  const [dataRoot, setDataRoot] = useState("");
  const [suggestedRoot, setSuggestedRoot] = useState("");
  const [validation, setValidation] = useState(null);
  const [start, setStart] = useState("blank");
  const [inspection, setInspection] = useState(null);
  const [passwordRequest, setPasswordRequest] = useState(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [acknowledge, setAcknowledge] = useState(false);

  const unwrap = (result) => {
    if (!result?.ok) throw new Error(result?.error?.message || t("common.opIncomplete"));
    return result.value;
  };

  const validate = async (folder) => {
    const result = unwrap(await api.validateFolder({ path: folder }));
    setValidation(result);
    setAcknowledge(false);
    return result;
  };
  useEffect(() => {
    let active = true;
    if (!api) { setError(t("setup.openViaDesktop")); return undefined; }
    api.getDefaults().then(async (result) => {
      const value = unwrap(result);
      if (active) { setDataRoot(value.suggestedDataRoot); setSuggestedRoot(value.suggestedDataRoot); await validate(value.suggestedDataRoot); }
    }).catch((failure) => { if (active) setError(failure.message); });
    document.documentElement.dataset.laSetupReady = "1";
    return () => { active = false; };
  }, [api]);

  const run = async (operation) => {
    if (busy) return;
    setBusy(true); setError("");
    try { await operation(); } catch (failure) { setError(failure.message); } finally { setBusy(false); }
  };
  const chooseFolder = () => run(async () => {
    const value = unwrap(await api.chooseFolder());
    if (value.cancelled) return;
    setDataRoot(value.path);
    await validate(value.path);
  });
  const selectBackup = () => run(async () => {
    setInspection(null);
    const value = unwrap(await api.inspectBackup());
    if (value.cancelled) return;
    if (value.needsPassword) { setPasswordRequest(value.inspectId); setPassword(""); }
    else setInspection(value);
  });
  const next = () => run(async () => {
    if (step === 0) {
      const value = unwrap(await api.validateFolder({ path: dataRoot }));
      setValidation(value);
      if (value.level === "error" || value.level === "warning" && !acknowledge) return;
      setStep(1);
    } else if (step === 1 && (start === "blank" || inspection?.token)) setStep(2);
    else if (step === 2) unwrap(await api.finish({ dataRoot, start, ...(start === "restore" ? { token: inspection.token } : {}) }));
  });

  const stepLabels = [t("setup.step.location"), t("setup.step.import"), t("setup.step.done")];

  return <main className="wizard">
    <aside className="wiz-side">
      <div className="wiz-brand-mark" aria-hidden="true">L</div>
      <h1>Life Atlas</h1>
      <p>{t("setup.tagline")}</p>
      <ol className="wiz-steps">{stepLabels.map((label, index) => <li key={index} className={step === index ? "is-current" : step > index ? "is-done" : ""} aria-current={step === index ? "step" : undefined}><span>{step > index ? <IconCheck size={12} /> : index + 1}</span>{label}</li>)}</ol>
      <label className="wiz-lang">
        <span>{t("setup.languageLabel")}</span>
        <select aria-label={t("setup.languageLabel")} value={locale} disabled={busy} onChange={(event) => {
          const nextLocale = event.target.value;
          void setLocale(nextLocale).catch((failure) => setError(failure.message));
        }}>
          {locales.map((code) => <option key={code} value={code}>{metadata[code].selectorLabel}</option>)}
        </select>
      </label>
      <div className="wiz-local"><IconShieldLock size={15} /><span>{t("setup.localBadge")}</span></div>
    </aside>
    <section className="wiz-main" aria-busy={busy}>
      <div className="wiz-content">
        {error && <div className="wiz-error" role="alert">{error}</div>}
        {step === 0 && <><h2>{t("setup.step0.title")}</h2><p className="wiz-description">{t("setup.step0.desc")}</p>
          <button type="button" aria-pressed={Boolean(dataRoot === suggestedRoot)} className={`wiz-choice ${dataRoot === suggestedRoot ? "is-selected" : ""}`} disabled={busy || !suggestedRoot} onClick={() => run(async () => { setDataRoot(suggestedRoot); await validate(suggestedRoot); })}><span className="wiz-radio" /><span><strong className="wiz-path">{suggestedRoot || t("setup.step0.checking")}</strong><small>{t("setup.step0.suggested")}</small></span></button>
          <button type="button" aria-pressed={Boolean(dataRoot && dataRoot !== suggestedRoot)} className={`wiz-choice ${dataRoot && dataRoot !== suggestedRoot ? "is-selected" : ""}`} disabled={busy} onClick={chooseFolder}><span className="wiz-radio" /><span><strong>{dataRoot && dataRoot !== suggestedRoot ? <span className="wiz-path">{dataRoot}</span> : t("setup.step0.chooseOther")}</strong><small>{t("setup.step0.chooseHint")}</small></span><IconFolder size={18} /></button>
          {validation?.message && <p className={validation.level === "error" ? "wiz-error" : "wiz-validation"} role="status">{validation.message}</p>}
          <div className="wiz-warn"><IconAlertTriangle size={16} /><span>{t("setup.step0.syncWarn")}</span></div>{validation?.level === "warning" && <label className="wiz-check"><input type="checkbox" checked={acknowledge} onChange={(event) => setAcknowledge(event.target.checked)} />{t("setup.step0.ack")}</label>}
        </>}
        {step === 1 && <><h2>{t("setup.step1.title")}</h2><p className="wiz-description">{t("setup.step1.desc")}</p><button type="button" aria-pressed={Boolean(start === "blank")} className={`wiz-choice ${start === "blank" ? "is-selected" : ""}`} onClick={() => setStart("blank")}><IconFilePlus size={20} /><span><strong>{validation?.kind === "existing-data-root" ? t("setup.step1.openExisting") : t("setup.step1.newBlank")}</strong><small>{validation?.kind === "existing-data-root" ? t("setup.step1.openExistingHint") : t("setup.step1.newBlankHint")}</small></span></button><button type="button" aria-pressed={Boolean(start === "restore")} className={`wiz-choice ${start === "restore" ? "is-selected" : ""}`} onClick={() => setStart("restore")}><IconFileImport size={20} /><span><strong>{t("setup.step1.restore")}</strong><small>{t("setup.step1.restoreHint")}</small></span></button>{start === "restore" && <><button type="button" className="btn-line" disabled={busy} onClick={selectBackup}>{t("setup.step1.chooseBackup")}</button>{inspection?.summary && <dl className="wiz-summary"><div><dt>{t("setup.summary.time")}</dt><dd>{format.formatDateTime(inspection.summary.createdAt, locale, { includeSeconds: true })}</dd></div><div><dt>{t("setup.summary.source")}</dt><dd>{inspection.summary.platform === "browser" ? t("setup.summary.sourceBrowser") : t("setup.summary.sourceDesktop")}</dd></div><div><dt>{t("setup.summary.contents")}</dt><dd>{t("setup.summary.counts", { pages: inspection.summary.counts.pages, dataSources: inspection.summary.counts.dataSources, databaseItems: inspection.summary.counts.databaseItems })}</dd></div><div><dt>{t("setup.summary.vault")}</dt><dd>{inspection.summary.vault.included ? t("setup.summary.vaultIncluded") : t("setup.summary.vaultExcluded")}</dd></div></dl>}</>}
        </>}
        {step === 2 && <><div className="wiz-complete-mark"><IconCheck size={28} /></div><h2>{t("setup.step2.title")}</h2><p className="wiz-description">{start === "restore" ? t("setup.step2.descRestore") : t("setup.step2.descBlank")}</p><dl className="wiz-summary"><div><dt>{t("setup.summary.location")}</dt><dd className="wiz-path">{dataRoot}</dd></div><div><dt>{t("setup.summary.mode")}</dt><dd>{start === "restore" ? t("setup.step1.restore") : validation?.kind === "existing-data-root" ? t("setup.step1.openExisting") : t("setup.step1.newBlank")}</dd></div></dl><div className="wiz-warn"><IconAlertTriangle size={16} /><span>{t("setup.step2.warn")}</span></div></>}
      </div>
      <footer className="wiz-footer"><span>{step > 0 && <button type="button" className="btn-line" disabled={busy} onClick={() => setStep(step - 1)}><IconArrowLeft size={14} />{t("setup.nav.prev")}</button>}</span><div><button type="button" className="btn-line" disabled={busy} onClick={() => window.close()}>{t("setup.nav.quit")}</button><button type="button" className="btn-primary" disabled={busy || !api || (step === 0 && (!dataRoot || !validation || validation.level === "error" || validation.level === "warning" && !acknowledge)) || (step === 1 && start === "restore" && !inspection?.token)} onClick={next}>{busy ? t("common.processing") : step === 2 ? t("setup.nav.start") : t("setup.nav.continue")}{!busy && <IconArrowRight size={14} />}</button></div></footer>
    </section>
    {passwordRequest && <div className="wiz-password-backdrop"><form className="wiz-password-dialog" onSubmit={(event) => { event.preventDefault(); void run(async () => { setInspection(unwrap(await api.inspectBackupWithPassword({ inspectId: passwordRequest, password }))); setPasswordRequest(null); setPassword(""); }); }}><h2>{t("setup.password.title")}</h2><p>{t("setup.password.desc")}</p><label>{t("setup.password.label")}<input type="password" autoFocus autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>{error && <p className="wiz-error" role="alert">{error}</p>}<footer><button type="button" className="btn-line" onClick={() => { setPasswordRequest(null); setPassword(""); }}>{t("common.cancel")}</button><button type="submit" className="btn-primary" disabled={busy || !password}>{t("setup.password.unlock")}</button></footer></form></div>}
  </main>;
}
