import { useEffect, useRef, useState } from "react";
import IconChevronRight from "@tabler/icons-react/dist/esm/icons/IconChevronRight.mjs";
import IconFileZip from "@tabler/icons-react/dist/esm/icons/IconFileZip.mjs";
import { Dialog } from "../ui/Dialog.jsx";
import { MAX_NOTION_ZIP_BYTES, readNotionExport, planNotionImport } from "../import/notionImport.js";
import { useI18n } from "../i18n/workspaceRuntime.js";

const byteLabel = (bytes) => bytes < 1024 ? [String(bytes), "B"] : bytes < 1024 * 1024 ? [(bytes / 1024).toFixed(1), "KB"] : bytes < 1024 * 1024 * 1024 ? [(bytes / 1024 / 1024).toFixed(1), "MB"] : [(bytes / 1024 / 1024 / 1024).toFixed(1), "GB"];
const localDay = (now) => { const date = new Date(now); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; };

export function ImportExportCounts({ counts, exporting = false }) {
  const { t } = useI18n();
  const [size, unit] = byteLabel(counts.attachmentBytes || 0);
  const values = [
    ["pages", counts.pages, t("importNotion.pages")],
    ["databases", counts.databases, t("importNotion.databases")],
    ["records", counts.records, t("importNotion.records")],
    ["attachments", counts.attachments, t("importNotion.attachments")],
    exporting ? ["files", counts.fileCount, t("importNotion.files")] : ["size", size, t("importNotion.attachmentSize"), unit],
  ];
  return <dl className="im-counts" aria-label={exporting ? t("importNotion.countsExport") : t("importNotion.countsImport")}>{values.map(([key, value, label, suffix]) => <div key={key} data-count={key}><dd>{value}{suffix && <small>{suffix}</small>}</dd><dt>{label}</dt></div>)}</dl>;
}

export function NotionImportDialog({ workspace, runtime, onClose }) {
  const { t } = useI18n();
  const inputRef = useRef(null);
  const viewInputRef = useRef(null);
  const sequence = useRef(0);
  const viewSequence = useRef(0);
  const mounted = useRef(true);
  const [file, setFile] = useState(null);
  const [plan, setPlan] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [viewFile, setViewFile] = useState(null);
  const [viewConfigurations, setViewConfigurations] = useState(null);
  const [viewError, setViewError] = useState("");
  const [readingViews, setReadingViews] = useState(false);
  const [result, setResult] = useState(null);
  const [importTime, setImportTime] = useState(() => new Date().toISOString());
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; sequence.current += 1; viewSequence.current += 1; }; }, []);
  const clearViews = () => {
    viewSequence.current += 1;
    setViewFile(null); setViewConfigurations(null); setViewError(""); setReadingViews(false);
    if (viewInputRef.current) viewInputRef.current.value = "";
  };
  const readViews = async (candidate) => {
    const current = ++viewSequence.current;
    setViewFile(candidate || null); setViewConfigurations(null); setViewError(""); setReadingViews(Boolean(candidate));
    if (!candidate) return;
    try {
      const value = JSON.parse(await candidate.text());
      if (!Array.isArray(value)) throw new Error(t("importNotion.viewsArrayErr"));
      if (mounted.current && viewSequence.current === current) setViewConfigurations(value);
    } catch (issue) {
      if (mounted.current && viewSequence.current === current) setViewError(t("importNotion.viewsReadErr", { reason: issue.message || t("importNotion.corruptFile") }));
    } finally { if (mounted.current && viewSequence.current === current) setReadingViews(false); }
  };
  const readFile = async (candidate) => {
    const current = ++sequence.current;
    setFile(candidate || null); setPlan(null); setError(""); setResult(null);
    clearViews();
    setReading(Boolean(candidate));
    if (!candidate) return;
    try {
      if (runtime?.platform !== "desktop" && candidate.size > 200 * 1024 * 1024) throw new Error(t("importNotion.browserLimit"));
      if (candidate.size > MAX_NOTION_ZIP_BYTES) throw new Error(t("importNotion.zipTooLarge"));
      const read = await readNotionExport(await candidate.arrayBuffer());
      const planned = planNotionImport(read.entries);
      if (mounted.current && sequence.current === current) { setPlan({ ...planned, skipped: read.problems }); setImportTime(new Date().toISOString()); }
    } catch (issue) { if (mounted.current && sequence.current === current) setError(t("importNotion.readErr", { reason: issue.message || t("importNotion.corruptFile") })); }
    finally { if (mounted.current && sequence.current === current) setReading(false); }
  };
  const importFolderName = t("importNotion.folderPrefix", { day: localDay(importTime) });
  const importPlan = async () => {
    if (busy || reading || readingViews || viewError || !plan || plan.errors.length || typeof runtime?.importNotion !== "function") return;
    setBusy(true); setError("");
    try {
      const imported = await runtime.importNotion(plan, { now: importTime, folderName: importFolderName, ...(viewConfigurations === null ? {} : { sourceViewConfigurations: viewConfigurations }) });
      if (!imported?.rootFolderId || !imported?.report) throw new Error(imported?.error?.message || t("importNotion.incomplete"));
      if (mounted.current) setResult(imported);
    } catch (issue) { if (mounted.current) setError(t("importNotion.importErr", { reason: issue.message || t("importNotion.retry") })); }
    finally { if (mounted.current) setBusy(false); }
  };
  const step = result || busy ? 3 : plan ? 2 : 1;
  const counts = result ? { ...result.report, attachmentBytes: plan.counts.attachmentBytes } : plan?.counts;
  const [fileSize, fileUnit] = byteLabel(file?.size || 0);
  const issue = error || viewError || plan?.errors?.[0];
  return <Dialog title={t("importNotion.title")} ariaLabel={t("importNotion.title")} className="im-dialog ui-dialog" onClose={onClose} busy={busy || reading} initialFocusRef={inputRef}>
    <ol className="im-steps" aria-label={t("importNotion.stepsAria")}>{[t("importNotion.step1"), t("importNotion.step2"), t("importNotion.step3")].map((label, index) => <li key={index} className={step === index + 1 ? "is-current" : step > index + 1 ? "is-done" : ""} aria-current={step === index + 1 ? "step" : undefined}>{index + 1} {label}</li>)}</ol>
    <div className="im-body">
      {!plan && !result && <><p className="im-instructions">{t("importNotion.instructionsBefore")}<strong>Markdown &amp; CSV</strong>{t("importNotion.instructionsOr")}<strong>HTML</strong>{t("importNotion.instructionsAfter")}</p><input ref={inputRef} type="file" accept=".zip" aria-label={t("importNotion.pickZipAria")} disabled={busy || reading} onChange={(event) => readFile(event.target.files?.[0])} /></>}
      {file && plan && <div className="im-file"><IconFileZip size={18} aria-hidden="true" /><b>{file.name}</b><span>{fileSize} {fileUnit}</span></div>}
      {counts && !plan?.errors.length && <ImportExportCounts counts={counts} />}
      {plan && !result && !plan.errors.length && <section className="im-view-settings" aria-label={t("importNotion.viewsAria")}>
        <p className="im-note">{t("importNotion.viewsNote")}</p>
        <input ref={viewInputRef} type="file" accept=".json,application/json" aria-label={t("importNotion.pickViewsAria")} disabled={busy || reading} onChange={(event) => readViews(event.target.files?.[0])} />
        {viewFile && <div className="im-file"><b>{viewFile.name}</b><button type="button" className="mb-button" aria-label={t("importNotion.clearViews")} onClick={clearViews} disabled={busy}>{t("importNotion.clearViews")}</button></div>}
        {readingViews ? <p role="status" className="im-note">{t("importNotion.readingViews")}</p> : viewConfigurations !== null && <p role="status" className="im-note">{t("importNotion.loadedViews", { count: viewConfigurations.length })}</p>}
      </section>}
      {plan && !result && !plan.errors.length && <><details className="im-unknown"><summary><IconChevronRight size={15} aria-hidden="true" />{t("importNotion.unrecognized", { count: plan.unrecognized.length })}</summary>{plan.unrecognized.map((entry, index) => <p key={`${entry.path}-${index}`}>{entry.path} · {entry.reason}</p>)}</details><p className="im-note">{t("importNotion.targetNote", { folder: importFolderName })}</p></>}
      {reading && <p role="status" className="im-note">{t("importNotion.reading")}</p>}
      {busy && <p role="status" className="im-note">{t("importNotion.importing")}</p>}
      {result && <><p role="status" className="im-result">{t("importNotion.result", { pages: result.report.pages, databases: result.report.databases, records: result.report.records, attachments: result.report.attachments })}</p>{result.report.skipped?.length > 0 && <details className="im-unknown"><summary><IconChevronRight size={15} aria-hidden="true" />{t("importNotion.skipped", { count: result.report.skipped.length })}</summary>{result.report.skipped.map((entry, index) => <p key={`${entry.path}-${index}`}>{entry.path} · {entry.reason}</p>)}</details>}{result.report.unrecognizedValues?.length > 0 && <p className="im-note">{t("importNotion.unrecognizedRel", { count: result.report.unrecognizedValues.length })}</p>}</>}
      {result?.report.warnings?.length > 0 && <details className="im-unknown"><summary><IconChevronRight size={15} aria-hidden="true" />{t("importNotion.warnings", { count: result.report.warnings.length })}</summary>{result.report.warnings.map((entry, index) => <p key={`${entry.path}-${entry.property}-${index}`}>{entry.property || entry.view ? `${entry.property || entry.view} · ` : ""}{entry.reason}</p>)}</details>}
      {issue && <p role="alert" className="im-error">{issue}</p>}
    </div>
    <footer className="mb-dialog-footer"><button type="button" className="mb-button" onClick={onClose} disabled={busy || reading}>{result ? t("common.close") : t("common.cancel")}</button>{result ? <button type="button" className="mb-button mb-primary" onClick={() => { runtime.openFolder?.(result.rootFolderId); onClose(); }}>{t("importNotion.openFolder")}</button> : plan && !plan.errors.length ? <button type="button" className="mb-button mb-primary" onClick={importPlan} disabled={busy || reading || readingViews || Boolean(viewError) || typeof runtime?.importNotion !== "function"}>{busy ? t("importNotion.importing") : t("importNotion.importAction")}</button> : null}{plan && !result && <button type="button" className="mb-button im-reselect" disabled={busy || reading} onClick={() => readFile(null)}>{t("importNotion.reselect")}</button>}</footer>
  </Dialog>;
}
