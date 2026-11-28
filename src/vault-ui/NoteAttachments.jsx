import React, { useId } from "react";
import IconFile from "@tabler/icons-react/dist/esm/icons/IconFile.mjs";
import { useI18n } from "./i18n.js";

function fileSize(bytes, locale, format) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${format.formatNumber(bytes / 1024, locale, { maximumFractionDigits: 1 })} KiB`;
  return `${format.formatNumber(bytes / (1024 * 1024), locale, { maximumFractionDigits: 1 })} MiB`;
}

export default function NoteAttachments({ files, action, fileAction, children }) {
  const heading = useId();
  const { locale, t, format } = useI18n();
  return <section className="vault-note-attachments" aria-labelledby={heading}>
    <div className="vault-attachment-head"><h3 id={heading}>{t("vault.att.title")}</h3>{action}</div>
    {files.length > 0 && <ul className="vault-attachment-list">
      {files.map((file) => <li key={file.id} className="vault-attachment-row">
        <IconFile size={17} aria-hidden="true" />
        <span className="vault-attachment-name" title={file.name} dir="auto">{file.name}</span>
        <span className="vault-attachment-size">{fileSize(file.size, locale, format)}</span>
        {fileAction(file)}
      </li>)}
    </ul>}
    {children}
  </section>;
}
