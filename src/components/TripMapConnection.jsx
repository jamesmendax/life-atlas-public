import { useEffect, useState } from "react";
import { useI18n } from "../i18n/workspaceRuntime.js";
import "../ui/themes/mobai/trip-map-settings.css";

function TripAmapSdkSettings({ api }) {
  const { t } = useI18n();
  const [configured, setConfigured] = useState(false);
  const [credentials, setCredentials] = useState({ key: "", securityCode: "" });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const status = api.sdkStatus;
  useEffect(() => {
    if (!status) return;
    let active = true;
    status().then(result => {
      if (active && result.ok) setConfigured(result.value.configured);
    }).catch(() => { if (active) setMessage(t("map.sdkReadErr")); });
    return () => { active = false; };
  }, [status, t]);
  async function save(args) {
    setBusy(true); setMessage("");
    try {
      const result = await api.sdkConfigure(args);
      if (!result.ok) throw new Error(result.error.message);
      setConfigured(result.value.configured);
      setCredentials({ key: "", securityCode: "" });
      setMessage(args.clear ? t("map.sdkKeyRemoved") : t("map.sdkKeySaved"));
      window.dispatchEvent(new Event("lifeatlas-map-provider-changed"));
    } catch (error) { setMessage(error.message || t("map.sdkSaveErr")); }
    finally { setBusy(false); }
  }
  if (!status || !api.sdkConfigure) return null;
  return <details>
    <summary>{t("map.sdkPreviewSummary")}</summary>
    <form onSubmit={event => { event.preventDefault(); void save({ key: credentials.key.trim(), securityCode: credentials.securityCode.trim() }); }}>
      <div className="settings-row"><div className="settings-label">{t("map.sdkTitle")}<small>{t("map.sdkDesc")}</small></div>
        <div className="settings-control">{configured ? t("map.configured") : t("map.unconfigured")}</div></div>
      <label className="settings-row"><span className="settings-label">{t("map.sdkKeyLabel")}</span><span className="settings-control">
        <input className="mb-field" type="password" autoComplete="off" spellCheck={false} required maxLength={64} value={credentials.key}
          onChange={event => setCredentials({ ...credentials, key: event.target.value })}/></span></label>
      <label className="settings-row"><span className="settings-label">{t("map.sdkCodeLabel")}</span><span className="settings-control">
        <input className="mb-field" type="password" autoComplete="off" spellCheck={false} required maxLength={64} value={credentials.securityCode}
          onChange={event => setCredentials({ ...credentials, securityCode: event.target.value })}/></span></label>
      <div className="settings-actions">
        {configured && <button className="mb-button" type="button" disabled={busy} onClick={() => save({ clear: true })}>{t("map.sdkRemoveBtn")}</button>}
        <button className="mb-button mb-primary" type="submit" disabled={busy || !credentials.key.trim() || !credentials.securityCode.trim()}>{t("map.sdkSaveBtn")}</button>
      </div>
      {message && <p role="status">{message}</p>}
    </form>
  </details>;
}

function TripOfflineSettings({ api }) {
  const { t } = useI18n();
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const status = api.offlineStatus;
  useEffect(() => {
    if (!status) return;
    let active = true;
    status().then(result => {
      if (!active) return;
      if (result.ok) setState(result.value);
      else setMessage(result.error.message);
    }).catch(() => { if (active) setMessage(t("map.offlineReadErr")); });
    return () => { active = false; };
  }, [status, t]);
  async function choose(kind) {
    setBusy(true); setMessage("");
    try {
      const result = await api.offlineSetup({ kind });
      if (!result.ok) {
        if (result.error.code !== "E_CANCELLED") setMessage(result.error.message);
        return;
      }
      setState(result.value);
      setMessage(kind === "roads" ? t("map.roadsImported") : t("map.offlineUpdated"));
      window.dispatchEvent(new Event("lifeatlas-map-provider-changed"));
    } catch { setMessage(t("map.offlineSetupErr")); }
    finally { setBusy(false); }
  }
  if (!status || !api.offlineSetup) return null;
  return <section aria-label={t("map.offlineAria")}>
    <div className="settings-row"><div className="settings-label">{t("map.offlineTitle")}<small>{t("map.offlineDesc")}</small></div>
      <div className="settings-control">{state ? (state.ready ? t("map.offlineReady", { count: state.installedTiles.length }) : t("map.offlinePending")) : t("map.reading")}</div></div>
    <div className="settings-row"><div className="settings-label">{t("map.engineTitle")}<small>{state?.configured ? t("map.engineConfigured", { version: state.version }) : t("map.engineHint")}</small></div>
      <div className="settings-control"><button className="mb-button" type="button" disabled={busy} onClick={() => choose("runtime")}>{t("map.engineChoose")}</button></div></div>
    <div className="settings-row"><div className="settings-label">{t("map.javaTitle")}<small>{state?.javaReady ? t("map.javaReady") : t("map.javaHint")}</small></div>
      <div className="settings-control"><button className="mb-button" type="button" disabled={busy} onClick={() => choose("java")}>{t("map.javaChoose")}</button></div></div>
    <div className="settings-row"><div className="settings-label">{t("map.roadsTitle")}<small>{t("map.roadsHint")}</small></div>
      <div className="settings-control"><button className="mb-button" type="button" disabled={busy} onClick={() => choose("roads")}>{t("map.roadsChoose")}</button></div></div>
    {state && <div className="settings-actions">{[[state.runtimeUrl, t("map.linkRuntime")], [state.javaUrl, t("map.linkJava")], [state.segmentsUrl, t("map.linkSegments")]]
      .filter(([url]) => url).map(([url, label]) => <button className="mb-button" type="button" key={label}
        onClick={() => window.lifeAtlas?.app?.openExternal?.({ url })}>{label} ↗</button>)}</div>}
    {message && <p role="status">{message}</p>}
  </section>;
}

export function TripMapConnection({ api }) {
  const { t } = useI18n();
  const [state, setState] = useState(null);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    let active = true;
    api.status().then((result) => {
      if (!active) return;
      if (result.ok) setState(result.value);
      else setError(result.error.message);
    }).catch(() => { if (active) setError(t("map.webReadErr")); });
    return () => { active = false; };
  }, [api, t]);

  async function save(input) {
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await api.setProvider(input);
      if (!result.ok) throw new Error(result.error?.message || t("map.webSaveErr"));
      setState(result.value); setKey("");
      setNotice(input.clear ? t("map.sdkKeyRemoved") : t("map.webSaved"));
      window.dispatchEvent(new Event("lifeatlas-map-provider-changed"));
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  return <div className="trip-map-settings-pane"><form onSubmit={(event) => { event.preventDefault(); if (key.trim() && !busy) void save({ key: key.trim() }); }}>
    <div className="settings-row"><div className="settings-label">{t("map.webTitle")}<small>{t("map.webDesc")}</small></div>
      <div className="settings-control">{state ? (state.configured ? t("map.configured") : t("map.unconfigured")) : t("map.reading")}</div></div>
    <>
      <label className="settings-row"><span className="settings-label">{t("map.webKeyTitle")}<small>{t("map.webKeyDesc")}</small></span>
        <span className="settings-control"><input type="password" className="mb-field" value={key} maxLength={32} autoComplete="off" spellCheck={false}
          placeholder={state?.configured ? t("map.webKeyReplacePh") : t("map.webKeyNewPh")} onChange={(event) => setKey(event.target.value)} /></span></label>
      <div className="settings-actions">{(state?.configured || (!state && error)) && <button type="button" className="mb-button" disabled={busy} onClick={() => void save({ clear: true })}>{t("map.webRemoveBtn")}</button>}
        <button className="mb-button mb-primary" type="submit" disabled={busy || !key.trim()}>{t("map.webSaveBtn")}</button></div>
    </>
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert">{error}</p>}
  </form><TripAmapSdkSettings api={api}/><TripOfflineSettings api={api}/></div>;
}
