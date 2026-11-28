import { useMemo, useRef, useState } from "react";
import JSZip from "jszip";
import { Dialog } from "../ui/Dialog.jsx";
import { buildMarkdownExport } from "../export/markdownExport.js";
import { attachmentIdFromUrl, readBrowserAttachmentBlob } from "../domain/attachments.js";
import { downloadBlob } from "../domain/pageExport.js";
import { ImportExportCounts } from "./NotionImportDialog.jsx";
import { useI18n } from "../i18n/workspaceRuntime.js";

const localDay = (now) => { const date = new Date(now); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; };

export function MarkdownExportDialog({ workspace, runtime, onClose }) {
  const { t } = useI18n();
  const [now] = useState(() => new Date().toISOString());
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const buttonRef = useRef(null);
  const exported = useMemo(() => {
    try { return { value: buildMarkdownExport(workspace, { now, appVersion: runtime?.appVersion || "0.1.0" }), error: "" }; }
    catch (issue) { return { value: null, error: issue.message || t("exportMd.buildError") }; }
  }, [workspace, now, runtime?.appVersion, t]);
  const desktop = runtime?.platform === "desktop";
  const exportFiles = async () => {
    if (busy || !exported.value) return;
    setBusy(true); setError("");
    try {
      const { files, assets } = exported.value;
      if (desktop) {
        const response = await window.lifeAtlas.exports.writeMarkdownFolder({ files, assets: assets.map(({ path, sha256 }) => ({ path, ...(sha256 ? { sha256 } : {}) })) });
        if (!response?.ok) {
          if (response?.error?.code === "E_CANCELLED") return;
          throw new Error(response?.error?.message || t("exportMd.failed"));
        }
        setResult(response.value);
      } else {
        const zip = new JSZip();
        for (const file of files) zip.file(file.path, file.text, { createFolders: false });
        const missingAssets = [];
        for (const asset of assets) {
          try {
            const id = attachmentIdFromUrl(asset.url) || asset.url;
            const attachment = workspace.attachments?.find((entry) => entry.id === id || entry.storageKey === id || `life-asset://${entry.storageKey}` === asset.url);
            const blob = await readBrowserAttachmentBlob(attachment?.storageKey || id);
            if (!blob) { missingAssets.push(asset.path); continue; }
            zip.file(asset.path, await blob.arrayBuffer(), { createFolders: false });
          } catch { missingAssets.push(asset.path); }
        }
        const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });
        const fileName = t("exportMd.zipName", { day: localDay(now) });
        if (!await downloadBlob(new Blob([bytes], { type: "application/zip" }), fileName)) return;
        setResult({ fileName, fileCount: files.length + assets.length - missingAssets.length, missingAssets });
      }
    } catch (issue) { setError(issue.message || t("exportMd.failed")); }
    finally { setBusy(false); }
  };
  const skippedSuffix = result?.missingAssets?.length ? t("exportMd.skipped", { count: result.missingAssets.length }) : "";
  return <Dialog title={t("exportMd.title")} ariaLabel={t("exportMd.title")} className="im-dialog ui-dialog im-markdown-dialog" onClose={onClose} busy={busy} initialFocusRef={buttonRef}>
    <div className="im-body"><p className="im-export-note">{t("exportMd.note")}</p>{exported.value && <ImportExportCounts counts={exported.value.counts} exporting />}{busy && <p role="status" className="im-note">{t("exportMd.exporting")}</p>}{result && <p role="status" className="im-result">{desktop ? t("exportMd.doneDesktop", { folder: result.folder, skipped: skippedSuffix }) : t("exportMd.doneBrowser", { file: result.fileName, skipped: skippedSuffix })}</p>}{(error || exported.error) && <p role="alert" className="im-error">{error || exported.error}</p>}</div>
    <footer className="mb-dialog-footer"><button type="button" className="mb-button" onClick={onClose} disabled={busy}>{result ? t("common.close") : t("common.cancel")}</button>{!result && <button ref={buttonRef} type="button" className="mb-button mb-primary" onClick={exportFiles} disabled={busy || !exported.value}>{busy ? t("exportMd.exporting") : t("actions.export")}</button>}</footer>
  </Dialog>;
}
