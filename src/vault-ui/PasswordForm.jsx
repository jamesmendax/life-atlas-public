import React, { useState } from "react";
import IconCheck from "@tabler/icons-react/dist/esm/icons/IconCheck.mjs";
import IconKey from "@tabler/icons-react/dist/esm/icons/IconKey.mjs";
import { passwordRules } from "./passwordRules.js";
import { useI18n } from "./i18n.js";

export function PasswordInput({ label, value, onChange, autoFocus, placeholder = label, ...props }) {
  return <label className="lock-field"><IconKey size={16} aria-hidden="true" /><input aria-label={label} type="password" value={value} onChange={(event) => onChange(event.target.value)} autoFocus={autoFocus} placeholder={placeholder} autoComplete="off" spellCheck={false} {...props} /></label>;
}

export function SetupSteps({ current, names }) {
  const { t } = useI18n();
  const labels = names || [t("vault.step.setMaster"), t("vault.step.saveRecovery"), t("vault.step.confirmRecovery")];
  return <nav aria-label={t("vault.stepsAria")} className="setup-steps">{labels.map((name, index) => <span className={`step ${current === index ? "is-on" : current > index ? "is-done" : ""}`} aria-current={current === index ? "step" : undefined} key={index}>{index + 1} {name}</span>)}</nav>;
}

export default function PasswordForm({ onSubmit, onCancel, busy, error, currentPasswordRequired = false, submitText }) {
  const { t } = useI18n();
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [current, setCurrent] = useState("");
  const rules = passwordRules(password);
  const commonFailed = error?.includes("common");
  const valid = rules.length && rules.distinct && rules.pattern && password === repeat && (!currentPasswordRequired || current);
  const strengthText = t(`vault.strength.${rules.strength}`);
  return <form onSubmit={async (event) => { event.preventDefault(); if (!valid || busy) return; await onSubmit(password, current); setPassword(""); setRepeat(""); setCurrent(""); }}>
    <div className="setup-form">
      {currentPasswordRequired && <PasswordInput label={t("vault.form.current")} value={current} onChange={setCurrent} autoFocus />}
      <PasswordInput label={t("vault.form.new")} value={password} onChange={setPassword} autoFocus={!currentPasswordRequired} />
      <PasswordInput label={t("vault.form.repeat")} value={repeat} onChange={setRepeat} />
      {repeat && repeat !== password && <p className="setup-mismatch">{t("vault.form.mismatch")}</p>}
      <div className="setup-strength"><span className="vw-strength">{[0, 1, 2].map((index) => <i key={index} className={index >= (rules.strength === "weak" ? 1 : rules.strength === "medium" ? 2 : 3) ? "is-off" : ""} />)}</span><em>{strengthText}</em></div>
      <ul className="rules">{[
        [t("vault.rule.length"), rules.length], [t("vault.rule.distinct"), rules.distinct], [t("vault.rule.common"), false, commonFailed], [t("vault.rule.pattern"), rules.pattern],
      ].map(([text, ok, failed]) => <li key={text} className={`${ok ? "is-ok" : ""} ${failed ? "is-failed" : ""}`}><span className="rule-mark">{ok && <IconCheck size={11} aria-hidden="true" />}</span>{text}</li>)}</ul>
      {error && <p role="alert" className="vault-error">{commonFailed ? t("vault.rule.commonError") : error}</p>}
    </div>
    <div className="setup-actions"><button type="button" className="btn-line" onClick={onCancel}>{t("common.cancel")}</button><button className="lock-submit" disabled={!valid || busy}>{busy ? t("common.processing") : (submitText ?? t("vault.form.next"))}</button></div>
  </form>;
}
