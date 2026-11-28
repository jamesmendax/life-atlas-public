import React, { useState } from "react";
import { invokeVault } from "./api.js";
import PasswordBoxImport from "./PasswordBoxImport.jsx";
import { useI18n } from "./i18n.js";

export default function Settings({
  settings,
  mergeGroupsCount = 0,
  onSettings,
  onFlow,
  onImport,
  onOpenMerge,
  onPasswordBoxImported,
  onError,
}) {
  const { t } = useI18n();
  const [passwordBoxOpen, setPasswordBoxOpen] = useState(false);
  const update = async (patch) => {
    try {
      onSettings((await invokeVault("updateSettings", { patch })).settings);
    } catch (error) {
      onError(error);
    }
  };

  return (
    <section className="notion-page vault-settings" aria-label={t("vault.settings.aria")}>
      <h2>{t("vault.settings.title")}</h2>

      <div className="vault-setting-group-label">{t("vault.settings.groupSecurity")}</div>
      <div className="vault-setting-row">
        <div><b>{t("vault.settings.autoLock")}</b><p>{t("vault.settings.autoLockDesc")}</p></div>
        <select aria-label={t("vault.settings.autoLockAria")} value={settings.autoLockMinutes} onChange={(event) => update({ autoLockMinutes: Number(event.target.value) })}>
          {[1, 5, 15, 30, 60].map((value) => <option value={value} key={value}>{t("vault.settings.minutes", { value })}</option>)}
        </select>
      </div>
      <div className="vault-setting-row">
        <div><b>{t("vault.settings.clipboardClear")}</b><p>{t("vault.settings.clipboardClearDesc")}</p></div>
        <select aria-label={t("vault.settings.clipboardClearAria")} value={settings.clipboardClearSeconds} onChange={(event) => update({ clipboardClearSeconds: Number(event.target.value) })}>
          {[10, 30, 60, 90].map((value) => <option value={value} key={value}>{t("vault.settings.seconds", { value })}</option>)}
        </select>
      </div>
      <div className="vault-setting-row">
        <label htmlFor="lock-minimize"><b>{t("vault.settings.lockOnMin")}</b></label>
        <input id="lock-minimize" type="checkbox" checked={settings.lockOnMinimize} onChange={(event) => update({ lockOnMinimize: event.target.checked })} />
      </div>
      <div className="vault-setting-row">
        <label htmlFor="verify-reveal"><b>{t("vault.settings.verifyReveal")}</b></label>
        <input id="verify-reveal" type="checkbox" checked={settings.verifyBeforeReveal} onChange={(event) => update({ verifyBeforeReveal: event.target.checked })} />
      </div>

      <div className="vault-setting-group-label">{t("vault.settings.groupImport")}</div>
      <div className="vault-setting-row">
        <div>
          <b>{t("vault.settings.pboxTitle")}</b>
          <p>{t("vault.settings.pboxDesc")}</p>
        </div>
        <button type="button" className="btn-line btn-sm" onClick={() => setPasswordBoxOpen(true)}>{t("vault.settings.pboxBtn")}</button>
      </div>
      <div className="vault-setting-row">
        <div><b>{t("vault.settings.csvTitle")}</b><p>{t("vault.settings.csvDesc")}</p></div>
        <button type="button" className="btn-line btn-sm" onClick={onImport}>{t("vault.settings.csvBtn")}</button>
      </div>
      <div className="vault-setting-row">
        <div>
          <b>{t("vault.settings.mergeTitle")}</b>
          <p>{mergeGroupsCount > 0 ? t("vault.settings.mergeFound", { count: mergeGroupsCount }) : t("vault.settings.mergeClean")}</p>
        </div>
        <button type="button" className="btn-line btn-sm" disabled={mergeGroupsCount === 0} onClick={onOpenMerge}>
          {mergeGroupsCount > 0 ? t("vault.settings.mergeBtn", { count: mergeGroupsCount }) : t("vault.settings.mergeNoNeed")}
        </button>
      </div>

      <div className="vault-setting-group-label">{t("vault.settings.groupMaster")}</div>
      <div className="vault-setting-row">
        <div><b>{t("vault.settings.changePass")}</b><p>{t("vault.settings.changePassDesc")}</p></div>
        <button type="button" className="btn-line btn-sm" onClick={() => onFlow("change-password")}>{t("vault.settings.changePass")}</button>
      </div>
      <div className="vault-setting-row">
        <div><b>{t("vault.settings.regen")}</b><p>{t("vault.settings.regenDesc")}</p></div>
        <button type="button" className="btn-line btn-sm" onClick={() => onFlow("regenerate")}>{t("vault.settings.regenBtn")}</button>
      </div>
      <div className="vault-setting-row">
        <div><b>{t("vault.reset.title")}</b><p>{t("vault.settings.resetDesc")}</p></div>
        <button type="button" className="btn-line btn-sm" onClick={() => onFlow("reset")}>{t("vault.reset.title")}</button>
      </div>

      {passwordBoxOpen && (
        <PasswordBoxImport
          onClose={() => setPasswordBoxOpen(false)}
          onImported={(result) => {
            setPasswordBoxOpen(false);
            onPasswordBoxImported(result);
          }}
        />
      )}

      <section className="vault-security-notes" aria-label={t("vault.settings.securityAria")}>
        <h3>{t("vault.settings.securityTitle")}</h3>
        <h4>{t("vault.settings.protectsAgainst")}</h4>
        <ul>
          <li>{t("vault.settings.p1")}</li>
          <li>{t("vault.settings.p2")}</li>
          <li>{t("vault.settings.p3")}</li>
          <li>{t("vault.settings.p4")}</li>
          <li>{t("vault.settings.p5")}</li>
          <li>{t("vault.settings.p6")}</li>
        </ul>
        <h4>{t("vault.settings.doesNotProtect")}</h4>
        <ul>
          <li>{t("vault.settings.np1")}</li>
          <li>{t("vault.settings.np2")}</li>
          <li>{t("vault.settings.np3")}</li>
        </ul>
        <p>{t("vault.settings.masterRule")}</p>
        <p>{t("vault.settings.clipboardRule")}</p>
      </section>

      <section className="vault-about">
        <h3>{t("vault.settings.about")}</h3>
        <p>{t("vault.settings.eff")}</p>
        <p>{t("vault.settings.offlineOnly")}</p>
      </section>
    </section>
  );
}
