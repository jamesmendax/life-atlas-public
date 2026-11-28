import React, { useEffect, useMemo, useState } from "react";
import IconAlertCircle from "@tabler/icons-react/dist/esm/icons/IconAlertCircle.mjs";
import IconCheck from "@tabler/icons-react/dist/esm/icons/IconCheck.mjs";
import IconFile from "@tabler/icons-react/dist/esm/icons/IconFile.mjs";
import IconLock from "@tabler/icons-react/dist/esm/icons/IconLock.mjs";
import IconPhoto from "@tabler/icons-react/dist/esm/icons/IconPhoto.mjs";
import { invokeVault } from "./api.js";
import { formatVaultFileSize, parseVaultNote } from "./vaultNoteModel.js";
import { useI18n } from "./i18n.js";

function ReadOnlyVaultImage({ itemId, attachmentId, name, size, caption, downloadButton }) {
  const { locale, t } = useI18n();
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    let generation = 0;
    const clear = () => {
      generation += 1;
      if (active) { setPreview(null); setLoading(false); }
    };
    window.addEventListener("blur", clear);
    const expected = ++generation;
    setLoading(true);
    invokeVault("readAttachmentPreview", { id: itemId, attachmentId })
      .then((result) => {
        if (!active || generation !== expected) return;
        setPreview(result.previewable ? result.dataUrl : null);
      })
      .catch(() => { if (active && generation === expected) setPreview(null); })
      .finally(() => { if (active && generation === expected) setLoading(false); });
    return () => {
      active = false;
      generation += 1;
      window.removeEventListener("blur", clear);
    };
  }, [itemId, attachmentId]);

  return (
    <figure className="vault-note-media-card is-image is-readonly">
      <div className="vault-note-media-head">
        <span className="vault-note-media-badge"><IconLock size={12} aria-hidden="true" />{t("vault.note.encryptedBadge")}</span>
        <span className="vault-note-media-name" title={name} dir="auto">{name}</span>
        {Number.isFinite(size) && <span className="vault-note-media-size">{formatVaultFileSize(size, locale)}</span>}
        {downloadButton}
      </div>
      {preview ? (
        <div className="vault-note-image-frame">
          <img src={preview} alt={caption || name} draggable={false} />
        </div>
      ) : (
        <div className="vault-note-image-fallback">
          <IconPhoto size={18} aria-hidden="true" />
          <span>{loading ? t("vault.note.decrypting") : t("vault.note.hiddenOnBlur")}</span>
        </div>
      )}
      {caption && <figcaption className="vault-note-caption">{caption}</figcaption>}
    </figure>
  );
}

export default function VaultNoteView({ value, itemId, attachments = [], renderDownload }) {
  const { locale, t } = useI18n();
  const blocks = useMemo(() => parseVaultNote(value), [value]);
  const attachmentById = useMemo(() => new Map(attachments.map((file) => [file.id, file])), [attachments]);

  if (!value) return <span className="vault-muted">{t("vault.details.emptyValue")}</span>;

  let numberedIndex = 0;

  return (
    <div className="vault-note-view">
      {blocks.map((block) => {
        if (block.type === "numbered") numberedIndex += 1;
        else numberedIndex = 0;

        if (block.type === "heading1") return <h3 key={block.id} className="vn-h1">{block.text}</h3>;
        if (block.type === "heading2") return <h4 key={block.id} className="vn-h2">{block.text}</h4>;
        if (block.type === "heading3") return <h5 key={block.id} className="vn-h3">{block.text}</h5>;
        if (block.type === "divider") return <hr key={block.id} className="vault-note-divider" />;
        if (block.type === "quote") return <blockquote key={block.id} className="vn-quote">{block.text}</blockquote>;
        if (block.type === "callout") {
          return (
            <div key={block.id} className="vn-callout">
              <IconAlertCircle size={16} aria-hidden="true" />
              <span>{block.text}</span>
            </div>
          );
        }
        if (block.type === "code") return <pre key={block.id} className="vn-code"><code>{block.text}</code></pre>;
        if (block.type === "bullet") {
          return <div key={block.id} className="vn-list-row"><span className="vault-note-marker" aria-hidden="true">•</span><span>{block.text}</span></div>;
        }
        if (block.type === "numbered") {
          return <div key={block.id} className="vn-list-row"><span className="vault-note-marker is-num" aria-hidden="true">{numberedIndex}.</span><span>{block.text}</span></div>;
        }
        if (block.type === "todo") {
          return (
            <div key={block.id} className={`vn-list-row is-todo${block.checked ? " is-done" : ""}`}>
              <span className={`vault-note-todo-box is-static${block.checked ? " is-checked" : ""}`} aria-hidden="true">
                {block.checked && <IconCheck size={12} />}
              </span>
              <span>{block.text}</span>
            </div>
          );
        }
        if (block.type === "image") {
          const meta = attachmentById.get(block.attachmentId);
          return (
            <ReadOnlyVaultImage
              key={block.id}
              itemId={itemId}
              attachmentId={block.attachmentId}
              name={meta?.name || block.name}
              size={meta?.size}
              caption={block.caption}
              downloadButton={renderDownload(meta)}
            />
          );
        }
        if (block.type === "file") {
          const meta = attachmentById.get(block.attachmentId);
          const displayName = meta?.name || block.name;
          return (
            <div key={block.id} className="vault-note-media-card is-file is-readonly">
              <IconFile size={18} className="vault-note-file-icon" aria-hidden="true" />
              <div className="vault-note-file-meta">
                <strong title={displayName} dir="auto">{displayName}</strong>
                <span>
                  <IconLock size={11} aria-hidden="true" /> {t("vault.note.encryptedBadge")}
                  {Number.isFinite(meta?.size) ? ` · ${formatVaultFileSize(meta.size, locale)}` : ""}
                </span>
              </div>
              {renderDownload(meta)}
            </div>
          );
        }
        return <p key={block.id} className="vn-p">{block.text || "\u00a0"}</p>;
      })}
    </div>
  );
}
