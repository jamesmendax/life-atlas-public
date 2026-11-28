import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n/workspaceRuntime.js";
import { Dialog } from "../ui/Dialog.jsx";
import { version } from "../../package.json";

const licenses = [["React", "MIT"], ["BlockNote", "MPL-2.0"], ["Mantine", "MIT"], ["Tabler Icons", "MIT"], ["JSZip", "MIT"], ["jsPDF", "MIT"], ["html2canvas", "MIT"], ["Electron", "MIT"], ["DM Sans", "OFL-1.1"], ["Noto Sans SC", "OFL-1.1"], ["Noto Serif SC", "OFL-1.1"], ["hash-wasm", "MIT"], ["yazl / yauzl", "MIT"], ["SecLists", "MIT"], ["EFF Wordlist", "CC BY 3.0 US"]];

export function RenameWorkspaceDialog({ workspaceName, workspaceIcon, onClose, onSave }) {
  const { locale, t } = useI18n();
  const inputRef = useRef(null);
  const [name, setName] = useState(workspaceName);
  const [icon, setIcon] = useState(workspaceIcon || "");
  const nameInvalid = !name.trim() || [...name.trim()].length > 60;
  const graphemes = [...new Intl.Segmenter(locale, { granularity: "grapheme" }).segment(icon.trim())];
  const iconInvalid = icon.trim() && (graphemes.length !== 1 || !/[\p{Extended_Pictographic}\p{Regional_Indicator}\u20e3]/u.test(icon));
  return <Dialog title={t("settings.about.renameTitle")} onClose={onClose} initialFocusRef={inputRef} className="workspace-rename-dialog"><form onSubmit={(event) => { event.preventDefault(); if (!nameInvalid && !iconInvalid) onSave({ workspaceName: name.trim(), workspaceIcon: icon.trim() || null }); }}><div className="mb-dialog-body workspace-identity-fields"><label>{t("settings.workspace.nameTitle")}<input className="mb-field" ref={inputRef} aria-label={t("settings.workspace.nameAria")} maxLength={120} value={name} onChange={(event) => setName(event.target.value)} aria-invalid={nameInvalid} /></label><label>{t("settings.about.iconOptional")}<input className="mb-field" aria-label={t("settings.workspace.iconAria")} value={icon} onChange={(event) => setIcon(event.target.value)} aria-invalid={Boolean(iconInvalid)} /></label>{nameInvalid && <p role="alert">{t("settings.workspace.nameInvalid")}</p>}{iconInvalid && <p role="alert">{t("settings.workspace.iconInvalid")}</p>}</div><footer className="mb-dialog-footer"><button type="button" className="mb-button" onClick={onClose}>{t("common.cancel")}</button><button type="submit" className="mb-button mb-primary" disabled={Boolean(nameInvalid || iconInvalid)}>{t("common.save")}</button></footer></form></Dialog>;
}

export function AboutWorkspaceContent() {
  const { t } = useI18n();
  const [info, setInfo] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    if (window.lifeAtlas?.app?.getInfo) void window.lifeAtlas.app.getInfo().then((result) => { if (!active) return; if (result.ok) setInfo(result.value); else setError(result.error?.message || t("settings.about.versionUnavailable")); }).catch((issue) => { if (active) setError(issue.message); });
    return () => { active = false; };
  }, [t]);
  return <div className="mb-dialog-body workspace-about-body"><p>{t("settings.about.subtitle")}</p><table aria-label={t("settings.about.versionTableAria")}><tbody><tr><th>Life Atlas</th><td>{info?.appVersion || version}</td></tr>{info && <><tr><th>Electron</th><td>{info.versions.electron}</td></tr><tr><th>Chrome</th><td>{info.versions.chrome}</td></tr><tr><th>Node</th><td>{info.versions.node}</td></tr><tr><th>{t("settings.data.dirTitle")}</th><td>{info.dataRoot}</td></tr></>}</tbody></table>{error && <p role="alert">{error}</p>}<h3>{t("settings.about.licensesTitle")}</h3><table aria-label={t("settings.about.licensesTitle")}><thead><tr><th>{t("settings.about.component")}</th><th>{t("settings.about.license")}</th></tr></thead><tbody>{licenses.map(([component, license]) => <tr key={component}><td>{component}</td><td>{license}</td></tr>)}</tbody></table><p><small>{t("settings.about.noticesNote")}</small></p></div>;
}

export function AboutWorkspaceDialog({ onClose }) {
  const { t } = useI18n();
  return <Dialog title={t("settings.about.title")} onClose={onClose} className="workspace-about-dialog"><AboutWorkspaceContent /><footer className="mb-dialog-footer"><button type="button" className="mb-button mb-primary" onClick={onClose}>{t("common.close")}</button></footer></Dialog>;
}
