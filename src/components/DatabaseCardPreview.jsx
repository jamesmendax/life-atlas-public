import { useEffect, useRef, useState } from "react";
import { resolvePropertyValue } from "../domain/database.js";
import { normalizeIdValues } from "../domain/databaseProperties.js";
import { pageCardPreview } from "../domain/cardPreview.js";
import { galleryCoverImage } from "../data/coverGallery.js";
import { SpriteIcon } from "./AppearanceGlyph.jsx";
import { useAttachmentMediaUrl } from "./AttachmentMedia.jsx";

function MediaPreview({ url, kind, name, className, config, position = 50, children }) {
  const resolved = useAttachmentMediaUrl(url);
  const [failed, setFailed] = useState(null);
  const address = resolved && resolved !== failed ? resolved : null;
  const fit = config.imageFit;
  const focus = `${config.focusPositionX ?? 50}% ${config.focusPosition ?? position}%`;
  if (kind === "video") {
    return <div className={className} data-preview-kind="video">
      {address ? <video src={address} preload="metadata" muted playsInline draggable={false}
        aria-label={name || "视频预览"} onError={() => setFailed(address)} style={{ objectFit: fit, objectPosition: focus }} />
        : <span className="db-card-preview-file"><SpriteIcon id="file-description" size={20} />{name || "视频"}</span>}
    </div>;
  }
  return <div className={className} data-has-image={String(Boolean(address))} data-preview-kind={address ? "image" : undefined}
    style={{ backgroundImage: address ? `url("${address.replace(/"/g, "%22")}")` : "none", backgroundSize: fit, backgroundRepeat: "no-repeat", backgroundPosition: focus }}>
    {address && <img hidden src={address} alt="" aria-hidden="true" onError={() => setFailed(address)} />}
    {children}
  </div>;
}

function FilePreview({ file, runtime, config, className }) {
  const runtimeRef = useRef(runtime);
  runtimeRef.current = runtime;
  const fileKey = `${file?.id || ""}:${file?.storageKey || ""}:${file?.updatedAt || ""}`;
  const kind = /^(image|video)\//i.exec(file?.mime || file?.mimeType || "")?.[1]?.toLowerCase() || null;
  const [address, setAddress] = useState(null);
  useEffect(() => {
    if (!kind) return undefined;
    let active = true;
    Promise.resolve().then(() => runtimeRef.current?.attachmentUrl?.(file))
      .then(url => { if (active) setAddress({ key: fileKey, url }); })
      .catch(() => { if (active) setAddress({ key: fileKey, url: null }); });
    return () => { active = false; };
  }, [fileKey, kind]);
  const url = kind && address?.key === fileKey && typeof address.url === "string" ? address.url : null;
  return <MediaPreview url={url} kind={kind} name={file?.name} className={className} config={config}>
    {file && !kind && <span className="db-card-preview-file"><SpriteIcon id="file-description" size={24} /><span className="db-gallery-file-name">{file.name}</span></span>}
  </MediaPreview>;
}

export function DatabaseCardPreview({ workspace, source, item, page, config, runtime, surface }) {
  const kind = config.preview.kind;
  if (kind === "none") return null;
  const board = surface === "board";
  const prefix = board ? "db-board-preview" : "db-gallery-preview";
  if (kind === "page-content") {
    const content = pageCardPreview(page, board);
    return <MediaPreview url={content.url} kind={content.kind} name={content.name} className={prefix + (board ? "" : " db-gallery-content")} config={config}>
      {!content.url && content.text}
    </MediaPreview>;
  }
  if (kind === "files-property") {
    const property = source.properties.find(entry => entry.id === config.preview.propertyId && entry.type === "files");
    const ids = property ? normalizeIdValues(resolvePropertyValue(workspace, source, item, property)) : [];
    const file = ids.map(id => workspace.attachments?.find(entry => entry.id === id && !entry.deletedAt)).find(Boolean);
    return <FilePreview file={file} runtime={runtime} config={config} className={prefix + (board ? "" : " db-gallery-file")} />;
  }
  const image = galleryCoverImage(page?.cover);
  return <MediaPreview url={image?.url} className={prefix + (board ? "" : " db-gallery-cover")} config={config} position={image?.position ?? 50} />;
}
