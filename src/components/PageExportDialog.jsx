import { useLayoutEffect, useRef, useState } from "react";
import { useModalFocus } from "../ui/Dialog.jsx";
import IconFileTypeCsv from "@tabler/icons-react/dist/esm/icons/IconFileTypeCsv.mjs";
import IconFileTypeHtml from "@tabler/icons-react/dist/esm/icons/IconFileTypeHtml.mjs";
import IconFileTypePdf from "@tabler/icons-react/dist/esm/icons/IconFileTypePdf.mjs";
import IconPackageExport from "@tabler/icons-react/dist/esm/icons/IconPackageExport.mjs";
import IconX from "@tabler/icons-react/dist/esm/icons/IconX.mjs";
import {
  createHtmlExport,
  createJsonBackup,
  createMarkdownCsvArchive,
  downloadBlob,
  exportPageElementToPdf,
} from "../domain/pageExport.js";
import { useI18n } from "../i18n/workspaceRuntime.js";

function Toggle({ label, checked, onChange, disabled = false }) {
  return (
    <button type="button" className={`export-toggle ${checked ? "is-on" : ""}`} aria-label={label} onClick={() => !disabled && onChange(!checked)} disabled={disabled} aria-pressed={checked}>
      <span />
    </button>
  );
}

export function PageExportDialog({ page, workspace, pageElement, onClose, restoreFocusRef, qaMode = false }) {
  const { t } = useI18n();
  const [format, setFormat] = useState("markdown-csv");
  const [includeTitle, setIncludeTitle] = useState(true);
  const [includeAppearance, setIncludeAppearance] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const dialog = useRef(null);
  const formatSelect = useRef(null);
  const exportButton = useRef(null);
  const wasSaving = useRef(false);
  useModalFocus(dialog, { initialFocusRef: formatSelect, restoreFocusRef, onClose, busy });
  useLayoutEffect(() => {
    if (wasSaving.current && !busy && (document.activeElement === document.body || document.activeElement === dialog.current)) {
      exportButton.current?.focus({ preventScroll: true });
    }
    wasSaving.current = busy;
  }, [busy]);

  const formats = [
    { id: "markdown-csv", label: "Markdown & CSV", detail: t("pageExport.mdDetail"), icon: IconFileTypeCsv },
    { id: "pdf", label: "PDF", detail: t("pageExport.pdfDetail"), icon: IconFileTypePdf },
    { id: "html", label: "HTML", detail: t("pageExport.htmlDetail"), icon: IconFileTypeHtml },
    { id: "json", label: "Life Atlas JSON", detail: t("pageExport.jsonDetail"), icon: IconPackageExport },
  ];
  const selected = formats.find((item) => item.id === format) ?? formats[0];
  const FormatIcon = selected.icon;

  async function exportNow() {
    if (!page || busy) return;
    setBusy(true);
    setError("");
    try {
      let result;
      if (format === "markdown-csv") {
        result = await createMarkdownCsvArchive(page, { includeTitle, workspace });
      } else if (format === "html") {
        result = createHtmlExport(page, { includeAppearance, workspace });
      } else if (format === "json") {
        result = createJsonBackup(page, { workspace });
      } else if (format === "pdf") {
        result = await exportPageElementToPdf(pageElement, page, { includeAppearance });
      }
      if (!result?.blob || !result?.fileName) throw new Error(t("pageExport.noFile"));
      const saved = await downloadBlob(result.blob, result.fileName);
      if (saved && !qaMode) onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("exportMd.failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="export-dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onClose();
    }}>
      <section ref={dialog} className="export-dialog" role="dialog" aria-modal="true" aria-busy={busy} aria-label={t("export.title")} tabIndex={-1}>
        <header className="export-dialog-header">
          <div>
            <span>{t("export.title")}</span>
            <small>{t("pageExport.subtitle")}</small>
          </div>
          <button type="button" className="export-dialog-close" aria-label={t("pageExport.closeAria")} onClick={onClose} disabled={busy}><IconX size={17} /></button>
        </header>

        <label className="export-field">
          <span>{t("pageExport.formatLabel")}</span>
          <select ref={formatSelect} value={format} disabled={busy} onChange={(event) => setFormat(event.target.value)} aria-label={t("pageExport.formatLabel")}>
            {formats.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}
          </select>
        </label>

        <div className="export-format-summary">
          <FormatIcon size={19} stroke={1.7} />
          <div><strong>{selected.label}</strong><span>{selected.detail}</span></div>
        </div>

        <div className="export-option-list">
          <div className="export-option-row is-static"><div><strong>{t("pageExport.contentTitle")}</strong><span>{t("pageExport.contentDesc")}</span></div><span className="export-option-value">{t("pageExport.contentValue")}</span></div>
          {format === "markdown-csv" && (
            <>
              <div className="export-option-row"><div><strong>{t("pageExport.includeTitle")}</strong><span>{t("pageExport.includeTitleDesc")}</span></div><Toggle label={t("pageExport.includeTitle")} disabled={busy} checked={includeTitle} onChange={setIncludeTitle} /></div>
              <div className="export-option-row is-static"><div><strong>{t("pageExport.tableCsvTitle")}</strong><span>{t("pageExport.tableCsvDesc")}</span></div><span className="export-option-value">{t("pageExport.auto")}</span></div>
            </>
          )}
          {format === "pdf" && (
            <>
              <div className="export-option-row"><div><strong>{t("pageExport.includeAppearancePdfTitle")}</strong><span>{t("pageExport.includeAppearancePdfDesc")}</span></div><Toggle label={t("pageExport.includeAppearancePdfTitle")} disabled={busy} checked={includeAppearance} onChange={setIncludeAppearance} /></div>
              <div className="export-option-row is-static"><div><strong>{t("pageExport.paginationTitle")}</strong><span>{t("pageExport.paginationDesc")}</span></div><span className="export-option-value">A4</span></div>
            </>
          )}
          {format === "html" && (
            <>
              <div className="export-option-row"><div><strong>{t("pageExport.includeAppearanceHtmlTitle")}</strong><span>{t("pageExport.includeAppearanceHtmlDesc")}</span></div><Toggle label={t("pageExport.includeAppearanceHtmlTitle")} disabled={busy} checked={includeAppearance} onChange={setIncludeAppearance} /></div>
              <div className="export-option-row is-static"><div><strong>{t("pageExport.assetModeTitle")}</strong><span>{t("pageExport.assetModeDesc")}</span></div><span className="export-option-value">{t("pageExport.offline")}</span></div>
            </>
          )}
          {format === "json" && (
            <div className="export-option-row is-static"><div><strong>{t("pageExport.jsonDepTitle")}</strong><span>{t("pageExport.jsonDepDesc")}</span></div><span className="export-option-value">v2</span></div>
          )}
          {format !== "json" && <div className="export-option-row is-static"><div><strong>{t("pageExport.scopeTitle")}</strong><span>{t("pageExport.scopeDesc")}</span></div><span className="export-option-value">{t("pageExport.scopeValue")}</span></div>}
        </div>

        {error && <div className="export-error" role="alert">{error}</div>}
        <footer className="export-dialog-actions">
          <button type="button" className="ghost-button" onClick={onClose} disabled={busy}>{t("common.cancel")}</button>
          <button type="button" ref={exportButton} className="primary-button export-confirm" onClick={exportNow} disabled={busy}>{busy ? t("pageExport.generating") : t("actions.export")}</button>
        </footer>
      </section>
    </div>
  );
}
