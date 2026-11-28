import { splitTickLabel } from "./roadmapLayout.js";

export const EXPORT_COLORS = Object.freeze({
  light: Object.freeze({
    paper: "#ffffff", ink: "#37352f", muted: "#787774", faint: "#a19f9a", line: "#e9e9e7", line2: "#dfdedb", accent: "#2383e2", today: "#eb5757",
    user: Object.freeze({ gray: "#787774", brown: "#9f6b53", orange: "#d9730d", yellow: "#cb912f", green: "#448361", blue: "#337ea9", purple: "#9065b0", pink: "#c14c8a", red: "#d44c47" }),
    tag: Object.freeze({ gray: "#e3e2e0", brown: "#eee0da", orange: "#fadec9", yellow: "#fdecc8", green: "#dbeddb", blue: "#d3e5ef", purple: "#e8deee", pink: "#f5e0e9", red: "#ffe2dd" }),
  }),
  dark: Object.freeze({
    paper: "#191919", ink: "#d4d4d4", muted: "#9b9b9b", faint: "#6f6f6f", line: "#2f2f2f", line2: "#3a3a3a", accent: "#2383e2", today: "#eb5757",
    user: Object.freeze({ gray: "#9b9b9b", brown: "#ba856f", orange: "#c77d48", yellow: "#ca9849", green: "#529e72", blue: "#379ad3", purple: "#9d68d3", pink: "#d15796", red: "#df5452" }),
    tag: Object.freeze({ gray: "#5a5a5a", brown: "#603b2c", orange: "#854c1d", yellow: "#89632a", green: "#2b593f", blue: "#28456c", purple: "#492f64", pink: "#69314c", red: "#6e3630" }),
  }),
});

const FONT_STACK = '"Segoe UI Variable Text", "Segoe UI", "Noto Sans SC", "Microsoft YaHei UI", sans-serif';
const ROCKET_PATHS = [
  "M4 13a8 8 0 0 1 7 7a6 6 0 0 0 3 -5a9 9 0 0 0 6 -8a3 3 0 0 0 -3 -3a9 9 0 0 0 -8 6a6 6 0 0 0 -5 3",
  "M7 14a6 6 0 0 0 -3 6a6 6 0 0 0 6 -3",
  "M14 9a1 1 0 1 0 2 0a1 1 0 1 0 -2 0",
];
const escapeXml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character]).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
const text = (value, x, y, color, size, weight = 400, attributes = "") => `<text x="${x}" y="${y}" style="fill:${color};font-size:${size}px;font-weight:${weight}"${attributes}>${escapeXml(value)}</text>`;
const shortDate = (time) => {
  const date = new Date(time);
  return `${date.getUTCMonth() + 1}月${date.getUTCDate()}日`;
};

function phaseColors(phase, palette) {
  if (palette.user[phase.color]) return { complete: palette.user[phase.color], remainder: palette.tag[phase.color] };
  if (phase.fill >= 1) return { complete: palette.user.green, remainder: palette.user.green };
  if (phase.fill > 0) return { complete: palette.accent, remainder: palette.tag.blue };
  return { complete: palette.tag.gray, remainder: palette.tag.gray };
}

function milestoneMarker(milestone, y, palette) {
  const color = palette.user[milestone.color] || palette.ink;
  const fill = milestone.past ? color : palette.paper;
  const common = `style="fill:${fill};stroke:${color};stroke-width:1.5"`;
  if (milestone.marker === "major") return `<circle cx="${milestone.x}" cy="${y}" r="14" style="fill:${palette.accent};stroke:${palette.paper};stroke-width:3"/><g transform="translate(${milestone.x - 7} ${y - 7}) scale(${14 / 24})" style="fill:none;stroke:${EXPORT_COLORS.light.paper};stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round">${ROCKET_PATHS.map((path) => `<path d="${path}"/>`).join("")}</g>`;
  if (milestone.marker === "circle") return `<circle cx="${milestone.x}" cy="${y}" r="6" ${common}/>`;
  if (milestone.marker === "ring") return `<circle cx="${milestone.x}" cy="${y}" r="7" style="fill:${palette.paper};stroke:${color};stroke-width:3"/>`;
  const size = milestone.marker === "square" ? 11 : 12;
  return `<rect x="${milestone.x - size / 2}" y="${y - size / 2}" width="${size}" height="${size}" rx="2"${milestone.marker === "square" ? "" : ` transform="rotate(45 ${milestone.x} ${y})"`} ${common}/>`;
}

export function buildRoadmapSvg({ layout, title = "", rangeLabel = "", background = "white", mode = "light" }) {
  const palette = EXPORT_COLORS[background === "theme" && mode === "dark" ? "dark" : "light"];
  const axis = layout.axis;
  const verticalScale = Math.min(1, 800 / Math.max(1, layout.height));
  const result = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080" style="font-family:${escapeXml(FONT_STACK)};font-variant-numeric:tabular-nums">`,
    `<title>${escapeXml(title)} · 时间脉络</title>`,
  ];
  if (background !== "transparent") result.push(`<rect width="1920" height="1080" style="fill:${palette.paper}"/>`);
  result.push(text(title, 80, 120, palette.ink, 40, 700), text(rangeLabel, 80, 156, palette.muted, 16), `<g transform="translate(80 200) scale(1 ${verticalScale})">`);
  for (const tick of layout.ticks) {
    const label = splitTickLabel(tick.label);
    result.push(`<line x1="${tick.x}" x2="${tick.x}" y1="0" y2="${layout.height}" style="stroke:${palette.line};stroke-width:1"/>`);
    result.push(`<text x="${tick.x + 10}" y="${label.small ? 26 : 30}"><tspan style="fill:${palette.ink};font-size:${label.small ? 22 : 26}px;font-weight:600">${escapeXml(label.numeral)}</tspan><tspan dx="2" style="fill:${palette.muted};font-size:15px;font-weight:500">${escapeXml(label.unit)}</tspan></text>`);
    if (label.note) result.push(text(label.note, tick.x + 10, 48, palette.faint, 12));
  }
  result.push(`<line x1="${axis.x0}" x2="${axis.x1}" y1="${axis.y}" y2="${axis.y}" style="stroke:${palette.line2};stroke-width:1"/>`);
  const pastX = Number.isFinite(layout.domain.start) && Number.isFinite(layout.now) ? axis.x0 + Math.max(0, Math.min(1, (layout.now - layout.domain.start) / (layout.domain.end - layout.domain.start))) * (axis.x1 - axis.x0) : layout.today?.x || axis.x0;
  if (pastX > axis.x0) result.push(`<line x1="${axis.x0}" x2="${pastX}" y1="${axis.y}" y2="${axis.y}" style="stroke:${palette.ink};stroke-width:3;stroke-linecap:round"/>`);
  for (const [index, phase] of layout.phases.entries()) {
    const colors = phaseColors(phase, palette);
    const clipId = `roadmap-phase-${index}`;
    result.push(`<g><title>${escapeXml(phase.title || phase.label)}</title><defs><clipPath id="${clipId}"><rect x="${phase.x}" y="${phase.y}" width="${phase.width}" height="8" rx="4"/></clipPath></defs><rect x="${phase.x}" y="${phase.y}" width="${phase.width}" height="8" rx="4" style="fill:${colors.remainder}"/>`);
    if (phase.fill > 0) result.push(`<rect x="${phase.x}" y="${phase.y}" width="${phase.width * phase.fill}" height="8" style="fill:${colors.complete};clip-path:url(#${clipId})"/>`);
    if (phase.labelVisible) result.push(`<text x="${phase.x}" y="${phase.y + 27}"><tspan style="fill:${palette.ink};font-size:14px;font-weight:600">${escapeXml(phase.label)}</tspan>${phase.subtitleVisible && phase.subtitle ? `<tspan dx="8" style="fill:${palette.muted};font-size:12px;font-weight:400">${escapeXml(phase.subtitle)}</tspan>` : ""}</text>`);
    result.push("</g>");
  }
  for (const milestone of layout.milestones) {
    const anchor = milestone.align === "end" ? "end" : "start";
    const cardX = milestone.align === "end" ? milestone.card.x + milestone.card.width : milestone.card.x;
    const compact = milestone.card.height === 48;
    result.push(`<g><title>${escapeXml(milestone.title)}</title><line x1="${milestone.x}" x2="${milestone.x}" y1="${milestone.card.y}" y2="${axis.y - 6}" style="stroke:${palette.line2};stroke-width:1"/>`);
    result.push(text(shortDate(milestone.start), cardX, milestone.card.y + 12, palette.muted, 12, 400, ` text-anchor="${anchor}"`));
    result.push(text(milestone.title, cardX, milestone.card.y + (compact ? 30 : 34), milestone.marker === "major" ? palette.accent : palette.ink, milestone.marker === "major" ? 16 : 15, 600, ` text-anchor="${anchor}"`));
    if (milestone.subtitle) result.push(text(milestone.subtitle, cardX, milestone.card.y + (compact ? 46 : 54), palette.faint, 12, 400, ` text-anchor="${anchor}"`));
    result.push(milestoneMarker(milestone, axis.y, palette), "</g>");
  }
  if (layout.today) {
    const pillX = layout.today.x + 8;
    const date = shortDate(layout.today.t ?? layout.now);
    const pillWidth = 38 + date.length * 12;
    result.push(`<line x1="${layout.today.x}" x2="${layout.today.x}" y1="64" y2="${layout.height - 26}" style="stroke:${palette.today};stroke-width:2"/><circle cx="${layout.today.x}" cy="64" r="5" style="fill:${palette.today}"/><rect x="${pillX}" y="${layout.height - 38}" width="${pillWidth}" height="20" rx="10" style="fill:${palette.today}"/>`);
    result.push(`<text x="${pillX + 7}" y="${layout.height - 24}" style="fill:${EXPORT_COLORS.light.paper};font-size:12px">今天 <tspan style="font-weight:600">${escapeXml(date)}</tspan></text>`);
  }
  result.push("</g></svg>");
  return result.join("");
}

export function roadmapExportFileName(databaseName, extension, now) {
  const date = new Date(now);
  const day = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
  const name = String(databaseName || "数据库").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").replace(/[. ]+$/g, "") || "数据库";
  return `${name}-时间脉络-${day}.${extension === "svg" ? "svg" : "png"}`;
}

export async function svgToPngBlob(svgString, { scale = 2, width = 1920, height = 1080 } = {}) {
  if (!Number.isFinite(scale) || scale <= 0) throw new TypeError("导出比例无效");
  if (![width, height].every(size => Number.isFinite(size) && size > 0)) throw new TypeError("导出尺寸无效");
  const blob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error("无法渲染 SVG"));
      image.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法创建 PNG 画布");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error("无法导出 PNG")), "image/png"));
  } finally {
    URL.revokeObjectURL(url);
  }
}
