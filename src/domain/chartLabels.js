import { formatCurrencyAmount } from "./currencyConversion.js";

export const CHART_AXIS_LABELS = Object.freeze({ none: "不显示", x: "仅横轴", y: "仅纵轴", both: "横轴和纵轴" });
export const DONUT_SECTOR_LABELS = Object.freeze({ none: "不显示", value: "数值", name: "名称", both: "名称和数值" });
const exact = new Intl.NumberFormat("zh-CN", { maximumSignificantDigits: 21 });

export function chartLabelValue(value, currency) {
  if (!Number.isFinite(value)) return "—";
  if (currency) return formatCurrencyAmount(value, currency);
  return Math.abs(value) >= 1e10 || (value !== 0 && Math.abs(value) < 0.0001) ? value.toExponential() : exact.format(value);
}

export function chartAxisTitles(config, categoryProperty, valueLabel) {
  const category = categoryProperty?.name || "记录";
  const horizontal = config.kind === "bar";
  const mode = config.axisTitles;
  return {
    x: mode === "x" || mode === "both" ? (horizontal ? valueLabel : category) : "",
    y: mode === "y" || mode === "both" ? (horizontal ? category : valueLabel) : "",
  };
}

const points = (center, radius, fraction) => ({
  x: center.x + radius * Math.sin(fraction * Math.PI * 2),
  y: center.y - radius * Math.cos(fraction * Math.PI * 2),
});
const shorten = (value, max) => {
  const characters = Array.from(value);
  return characters.length > max ? characters.slice(0, max - 1).join("") + "…" : value;
};

// Angles are kept intact while each side gets separate, evenly spaced labels.
// The same viewBox is used for the renderer and for image export.
export function donutSectorLabelLayout(slices, mode, displayValue) {
  if (typeof mode !== "string" || !Object.hasOwn(DONUT_SECTOR_LABELS, mode) || mode === "none" || !slices.length) return null;
  const sides = { left: [], right: [] };
  for (const { point, offset, end } of slices) {
    const fraction = (offset + end) / 2;
    const side = Math.sin(fraction * Math.PI * 2) < 0 ? "left" : "right";
    const name = [point.label, point.group].filter(Boolean).join(" / ");
    const value = displayValue(point.value);
    const title = mode === "both" ? `${name} · ${value}` : mode === "value" ? value : name;
    const label = mode === "both" ? `${shorten(name, 8)} · ${shorten(value, 10)}` : shorten(title, 13);
    sides[side].push({ point, fraction, label, title });
  }
  const widest = [...sides.left, ...sides.right].reduce((maximum, { label }) => {
    // Leave room for both proportional Latin glyphs and full-width labels.
    const estimatedWidth = Array.from(label).reduce((sum, glyph) => sum + (/^[\x20-\x7e]$/.test(glyph) ? 8 : 10), 0);
    return Math.max(maximum, estimatedWidth);
  }, 0);
  const width = Math.max(240, 2 * (60 + widest + 8));
  const height = Math.max(140, 24 + Math.max(sides.left.length, sides.right.length) * 16);
  const center = { x: width / 2, y: height / 2 };
  const radius = 44;
  const labels = Object.entries(sides).flatMap(([side, entries]) => {
    const isLeft = side === "left";
    const textX = center.x + (isLeft ? -60 : 60);
    return entries.sort((a, b) => points(center, radius, a.fraction).y - points(center, radius, b.fraction).y)
      .map(({ point, fraction, label, title }, index) => {
        const origin = points(center, radius + 8, fraction);
        const endY = center.y + (index - (entries.length - 1) / 2) * 16;
        return { key: point.key, title, label, x: textX, y: endY, anchor: isLeft ? "end" : "start",
          line: `M ${origin.x} ${origin.y} L ${textX + (isLeft ? 3 : -3)} ${endY}` };
      });
  });
  return { width, height, center, radius, labels };
}
