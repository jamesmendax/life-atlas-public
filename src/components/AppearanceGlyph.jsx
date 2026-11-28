export function SpriteIcon({ id, color, size = 22, className = "" }) {
  const name = id || "file-description";
  return (
    <svg
      className={`page-glyph-vector sprite-icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      style={{ color: color || undefined }}
      aria-hidden="true"
      focusable="false"
    >
      <use href={`/icons/tabler-picker-sprite.svg#ti-${name}`} />
    </svg>
  );
}

export function AppearanceGlyph({ icon, color, className = "" }) {
  const value = icon || "📄";
  const resolved = useAttachmentMediaUrl(value);
  if (typeof value === "string" && /^(data:image\/|life-asset:\/\/|blob:)/.test(value)) {
    return resolved ? <img className={`page-glyph-image ${className}`} src={resolved} alt="" aria-hidden="true" /> : <span className={className} aria-hidden="true">📄</span>;
  }
  if (typeof value === "string" && value.startsWith("icon:")) {
    return <SpriteIcon id={value.slice(5)} color={color} className={className} />;
  }
  return <span className={className} aria-hidden="true">{value}</span>;
}
import { useAttachmentMediaUrl } from "./AttachmentMedia.jsx";

