export function TemplatePreview({ previewId, size = "card" }) {
  if (previewId !== "roadmap-thumb") return <div className="tpl-cover-text" aria-hidden="true"><span /><span /><span /></div>;
  return <svg className={`thumb${size === "large" ? " is-big" : ""}`} viewBox="0 0 320 180" aria-hidden="true">
    <g className="thumb-num"><text x="14" y="34">10</text><text x="112" y="34">11</text><text x="210" y="34">12</text></g>
    <line className="thumb-grid" x1="10" y1="14" x2="10" y2="166" /><line className="thumb-grid" x1="108" y1="14" x2="108" y2="166" /><line className="thumb-grid" x1="206" y1="14" x2="206" y2="166" />
    <line className="thumb-axis" x1="10" y1="100" x2="310" y2="100" /><line className="thumb-done" x1="10" y1="100" x2="122" y2="100" />
    <rect className="thumb-ms" x="52" y="96" width="8" height="8" transform="rotate(45 56 100)" /><rect className="thumb-ms is-done" x="104" y="96" width="8" height="8" transform="rotate(45 108 100)" /><rect className="thumb-ms" x="166" y="96" width="8" height="8" transform="rotate(45 170 100)" /><circle className="thumb-major" cx="276" cy="100" r="8" />
    <rect className="thumb-phase is-done" x="10" y="120" width="70" height="4" /><rect className="thumb-phase" x="88" y="120" width="96" height="4" /><rect className="thumb-phase" x="224" y="120" width="60" height="4" /><rect className="thumb-phase" x="60" y="146" width="62" height="4" /><rect className="thumb-phase" x="140" y="146" width="104" height="4" />
    <line className="thumb-today" x1="122" y1="44" x2="122" y2="160" />
  </svg>;
}
