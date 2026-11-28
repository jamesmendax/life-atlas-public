import { useEffect, useId, useRef, useState } from "react";
import { useI18n } from "../../i18n/workspaceRuntime.js";

export function AssistantConnection({ bridge = window.lifeAtlas?.assistant, onSaved }) {
  const { t } = useI18n();
  const [config, setConfig] = useState(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [searchBaseUrl, setSearchBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [clearKey, setClearKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const testRequest = useRef(null);
  const hints = useId();

  useEffect(() => {
    let live = true;
    if (bridge) bridge.getConfig().then((result) => {
      if (!live) return;
      if (!result.ok) throw new Error(result.error?.message || t("conn.readError"));
      setConfig(result.value);
      setBaseUrl(result.value.baseUrl || "");
      setModel(result.value.model || "");
      setSearchBaseUrl(result.value.searchBaseUrl || "");
    }).catch((error) => { if (live) setError(error.message); });
    return () => {
      live = false;
      if (testRequest.current) {
        void bridge?.cancel({ requestId: testRequest.current }).catch(() => {});
        testRequest.current = null;
      }
    };
  }, [bridge, t]);

  async function save(event) {
    event.preventDefault();
    if (!bridge || busy) return;
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const payload = { baseUrl: baseUrl.trim(), model: model.trim() };
      if (apiKey) payload.apiKey = apiKey;
      else if (clearKey) payload.clearApiKey = true;
      if (searchBaseUrl.trim() !== (config?.searchBaseUrl ?? "")) payload.searchBaseUrl = searchBaseUrl.trim();
      const result = await bridge.configure(payload);
      if (!result.ok) throw new Error(result.error?.message || t("conn.saveError"));
      setApiKey("");
      setClearKey(false);
      setConfig(result.value);
      setBaseUrl(result.value.baseUrl);
      setModel(result.value.model);
      setSearchBaseUrl(result.value.searchBaseUrl || "");
      setNotice(t("conn.saved"));
      window.dispatchEvent(new Event("lifeatlas:assistant-config-changed"));
      onSaved?.(result.value);
    } catch (error) { setError(error.message); }
    finally { setBusy(false); }
  }

  async function testConnection() {
    if (!config?.configured || busy) return;
    const requestId = crypto.randomUUID();
    testRequest.current = requestId;
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const result = await bridge.complete({ configurationId: config.configurationId, requestId, tools: false,
        messages: [{ role: "user", content: t("conn.testPrompt") }] });
      if (testRequest.current !== requestId) return;
      if (!result.ok) throw new Error(result.error?.message || t("conn.testFail"));
      setNotice(t("conn.testOk"));
    } catch (failure) {
      if (testRequest.current === requestId) setError(failure.message);
    } finally {
      if (testRequest.current === requestId) { testRequest.current = null; setBusy(false); }
    }
  }

  if (!bridge) return <p className="assistant-muted">{t("conn.desktopHint")}</p>;
  const modelChanged = baseUrl.trim() !== config?.baseUrl || model.trim() !== config?.model || Boolean(apiKey) || clearKey;
  const fieldsDisabled = busy || (!config && !error);
  return <form className="assistant-connection" onSubmit={save}>
    <p className="assistant-muted">{t("conn.intro")}</p>
    {!config && !error && <p className="assistant-muted" role="status">{t("conn.loading")}</p>}
    <label>{t("conn.baseUrl")}<input type="url" required className="mb-field" autoComplete="off" spellCheck={false} aria-describedby={`${hints}-url`} disabled={fieldsDisabled}
      value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://example.com/v1" />
      <span className="assistant-field-hint" id={`${hints}-url`}>{t("conn.baseUrlHint")}</span>
    </label>
    <label>{t("conn.model")}<input required className="mb-field" autoComplete="off" spellCheck={false} aria-describedby={`${hints}-model`} disabled={fieldsDisabled}
      value={model} onChange={(e) => setModel(e.target.value)} placeholder={t("conn.modelPh")} />
      <span className="assistant-field-hint" id={`${hints}-model`}>{t("conn.modelHint")}</span>
    </label>
    <label>{t("conn.apiKey")}<input type="password" className="mb-field" autoComplete="new-password" spellCheck={false} value={apiKey} disabled={fieldsDisabled || clearKey}
      onChange={(e) => setApiKey(e.target.value)} placeholder={config?.hasApiKey ? t("conn.apiKeySavedPh") : t("conn.apiKeyEmptyPh")} /></label>
    {config?.hasApiKey && <label className="assistant-remove-key"><input type="checkbox" checked={clearKey} disabled={fieldsDisabled} onChange={(e) => { setClearKey(e.target.checked); setApiKey(""); }} />{t("conn.clearKey")}</label>}
    <label>{t("conn.searx")}<input type="url" className="mb-field" autoComplete="off" spellCheck={false} aria-describedby={`${hints}-search`} disabled={fieldsDisabled}
      value={searchBaseUrl} onChange={(e) => setSearchBaseUrl(e.target.value)} placeholder="https://search.example.com" />
      <span className="assistant-field-hint" id={`${hints}-search`}>{t("conn.searxHint")}</span>
    </label>
    <p className="assistant-muted">{t("conn.privacy")}</p>
    {error && <p role="alert" className="assistant-error">{error}</p>}
    {notice && <p role="status" className="assistant-muted">{notice}</p>}
    <div className="assistant-connection-actions">
      <button className="mb-button mb-primary" type="submit" disabled={fieldsDisabled || !baseUrl.trim() || !model.trim()}>{busy && !testRequest.current ? t("conn.saving") : t("conn.save")}</button>
      <button className="mb-button" type="button" disabled={busy || !config?.configured || modelChanged} onClick={testConnection}>{testRequest.current ? t("conn.testing") : t("conn.test")}</button>
    </div>
  </form>;
}
