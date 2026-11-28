import React, { useState } from "react";
import { invokeVault } from "./api.js";
import { useI18n } from "./i18n.js";

export default function Generator({ onUse, onError }) {
  const { t } = useI18n();
  const [mode, setMode] = useState("random");
  const [random, setRandom] = useState({ length: 20, upper: true, lower: true, digits: true, symbols: true, excludeAmbiguous: false });
  const [phrase, setPhrase] = useState({ words: 5, separator: "-", capitalize: false, appendNumber: false });
  const [value, setValue] = useState("");
  return <section className="vault-generator" aria-label={t("vault.gen.aria")}>
    <div className="vault-tabs"><button type="button" className={mode === "random" ? "is-active" : ""} onClick={() => { setMode("random"); setValue(""); }}>{t("vault.gen.random")}</button><button type="button" className={mode === "passphrase" ? "is-active" : ""} onClick={() => { setMode("passphrase"); setValue(""); }}>{t("vault.gen.passphrase")}</button></div>
    {mode === "random" ? <>
      <label className="generator-range">{t("vault.gen.length")} <input aria-label={t("vault.gen.lengthAria")} type="range" min="8" max="128" value={random.length} onChange={(event) => setRandom({ ...random, length: Number(event.target.value) })} /><span>{random.length}</span></label>
      <div className="generator-options">{[["upper", t("vault.gen.upper")], ["lower", t("vault.gen.lower")], ["digits", t("vault.gen.digits")], ["symbols", t("vault.gen.symbols")], ["excludeAmbiguous", t("vault.gen.exclude")]].map(([key, text]) => <label key={key}><input type="checkbox" checked={random[key]} onChange={(event) => setRandom({ ...random, [key]: event.target.checked })} />{text}</label>)}</div>
    </> : <div className="generator-options"><label>{t("vault.gen.words")} <input aria-label={t("vault.gen.words")} type="number" min="4" max="10" value={phrase.words} onChange={(event) => setPhrase({ ...phrase, words: Number(event.target.value) })} /></label><label>{t("vault.gen.separator")} <select aria-label={t("vault.gen.separator")} value={phrase.separator} onChange={(event) => setPhrase({ ...phrase, separator: event.target.value })}>{["-", " ", ".", "_"].map((separator) => <option key={separator} value={separator}>{separator === " " ? t("vault.gen.space") : separator}</option>)}</select></label><label><input type="checkbox" checked={phrase.capitalize} onChange={(event) => setPhrase({ ...phrase, capitalize: event.target.checked })} />{t("vault.gen.capitalize")}</label><label><input type="checkbox" checked={phrase.appendNumber} onChange={(event) => setPhrase({ ...phrase, appendNumber: event.target.checked })} />{t("vault.gen.appendNumber")}</label></div>}
    {value && <output className="generated-value">{value}</output>}
    <div className="vault-actions"><button type="button" className="btn-line btn-sm" onClick={async () => { try { setValue((await invokeVault("generatePassword", { options: { mode, ...(mode === "random" ? random : phrase) } })).value); } catch (error) { onError(error); } }}>{t("vault.gen.generate")}</button><button type="button" className="btn-line btn-sm" disabled={!value} onClick={() => { onUse(value); setValue(""); }}>{t("vault.gen.use")}</button></div>
  </section>;
}
