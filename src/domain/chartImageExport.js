import { orderedDonutPoints } from "./chartCategories.js";
import { chartBarScale, chartDonutLayout } from "./chartLayout.js";
import { cartesianChartLayout, chartAreaPath, chartLinePath } from "./cartesianChart.js";
import { EXPORT_COLORS } from "./roadmapExport.js";
import { chartAxisTitles, chartLabelValue, donutSectorLabelLayout } from "./chartLabels.js";

const seriesNames = ["accent", "purple", "green", "orange", "red", "yellow", "pink", "brown"];
const typeNames = { bar: "横向条形图", column: "纵向柱状图", line: "折线图", donut: "环形图", number: "数字图" };
const aggregations = { count: "计数", sum: "总和", average: "平均值", min: "最小值", max: "最大值" };
const exact = new Intl.NumberFormat("zh-CN", { maximumSignificantDigits: 21 });
const ticks = new Intl.NumberFormat("zh-CN", { maximumSignificantDigits: 5 });
const share = new Intl.NumberFormat("zh-CN", { style: "percent", maximumFractionDigits: 1 });
const escape = value => String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character])
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, "");
const short = (value, length) => value.length <= length ? value : value.slice(0, length - 1) + "…";
const number = (value, axis = false) => !Number.isFinite(value) ? "—" : Math.abs(value) >= 1e9 || (value && Math.abs(value) < 0.0001)
  ? (axis ? Number(value.toPrecision(4)) : value).toExponential() : (axis ? ticks : exact).format(value);
const pointName = point => [point.label, point.group].filter(Boolean).join(" / ");
const text = (value, x, y, size, fill, options = "") => `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" ${options}>${escape(value)}</text>`;
const line = (x1, y1, x2, y2, stroke) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}"/>`;
const rect = (x, y, width, height, fill, r = 0) => `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${fill}" rx="${r}"/>`;
const circle = (x, y, radius, fill) => `<circle cx="${x}" cy="${y}" r="${radius}" fill="${fill}"/>`;
const path = (d, attributes) => `<path d="${d}" ${attributes}/>`;
const titled = (name, geometry) => `<g><title>${escape(name)}</title>${geometry}</g>`;
function color(palette, index, preferred) {
  const fallback = seriesNames[index % seriesNames.length];
  return (Object.hasOwn(palette.user, preferred) && palette.user[preferred]) || palette.user[fallback] || palette.accent;
}

function bars(points, config, palette, count, axis) {
  const extraTop = axis.y ? 21 : 0, extraBottom = axis.x ? 19 : 0;
  const width = 860, height = Math.max(240, 156 + points.length * 35) + extraTop + extraBottom;
  const top = 94 + extraTop, bottom = height - 48 - extraBottom, left = 206, right = width - 110;
  const scale = chartBarScale(points.map(point => point.value), { count });
  const x = value => left + scale.position(value) * (right - left) / 100;
  const origin = x(0);
  const groupIndices = new Map();
  const grid = scale.ticks.map(tick => (tick === 0 || config.showGrid !== false ?
    line(x(tick), top, x(tick), bottom, tick === 0 ? palette.faint : palette.line) : "") +
    text(number(tick, true), x(tick), bottom + 18, 12, palette.muted, 'text-anchor="middle"')).join("");
  const marks = points.map((point, index) => {
    const label = pointName(point);
    const y = top + index * 35 + 14;
    const endpoint = Number.isFinite(point.value) ? x(point.value) : origin;
    const key = point.seriesKey ?? point.group;
    if (!groupIndices.has(key)) groupIndices.set(key, groupIndices.size);
    const fill = color(palette, groupIndices.get(key), point.seriesColor);
    return titled(`${label} · ${number(point.value)}`, text(short(label, 20), 28, y + 4, 13, palette.ink) +
      (endpoint !== origin ? rect(Math.min(origin, endpoint), y - 8, Math.abs(endpoint - origin), 16, fill, 2) : "") +
      (config.showValues !== false ? text(number(point.value), width - 27, y + 4, 13, palette.ink, 'text-anchor="end"') : ""));
  }).join("");
  const titles = (axis.y ? text(axis.y, 28, top - 14, 13, palette.ink, 'data-chart-axis="y"') : "") +
    (axis.x ? text(axis.x, (left + right) / 2, bottom + 42, 13, palette.ink, 'data-chart-axis="x" text-anchor="middle"') : "");
  return { width, height, content: grid + marks + titles };
}

function cartesian(projection, config, palette, categoryProperty, groupProperty, aggregation, axis) {
  const { points, categories } = projection;
  const kind = config.kind;
  const isLine = kind === "line";
  const plot = cartesianChartLayout(points, { kind, categories, categoryProperty, groupProperty, count: aggregation === "count",
    stacked: config.stacked === true && ["count", "sum"].includes(aggregation) });
  const showLegend = config.showLegend !== false && (groupProperty || plot.series.length > 1);
  const legendRows = showLegend ? Math.ceil(plot.series.length / 5) : 0;
  const width = Math.max(760, Math.min(4200, 134 + plot.slots.length * 96));
  const extraBottom = axis.x ? 22 : 0;
  const height = 365 + legendRows * 23 + extraBottom;
  const left = axis.y ? 104 : 79, right = width - 32, top = 99, bottom = height - 62 - legendRows * 23 - extraBottom;
  const slotWidth = (right - left) / Math.max(1, plot.slots.length);
  const x = index => left + (index + 0.5) * slotWidth;
  const y = value => bottom - plot.scale.position(value) * (bottom - top) / 100;
  const seriesColors = plot.series.map(series => color(palette, series.index, series.color));
  const guides = plot.scale.ticks.map(tick => (tick === 0 || config.showGrid !== false ?
    line(left, y(tick), right, y(tick), tick === 0 ? palette.faint : palette.line) : "") +
    text(number(tick, true), left - 9, y(tick) + 4, 11, palette.muted, 'text-anchor="end"')).join("");
  const stride = Math.max(1, Math.ceil(86 / slotWidth));
  const labels = plot.slots.map((slot, index) => index % stride === 0 ?
    text(short(slot.label, 16), x(index), bottom + 29, 12, palette.muted, 'text-anchor="middle"') : "").join("");
  const curves = isLine ? plot.series.map(({ runs, index }) => {
    const coordinates = runs.filter(run => run.length > 1).map(run => run.map(mark => [x(mark.index), y(mark.end)]));
    const stroke = seriesColors[index];
    return (config.gradientArea && coordinates.length ? `<defs><linearGradient id="area-${index}" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="${stroke}" stop-opacity=".31"/><stop offset="100%" stop-color="${stroke}" stop-opacity=".04"/></linearGradient></defs>` +
      path(coordinates.map(run => chartAreaPath(run, config.smoothLine, y(0))).join(" "), `fill="url(#area-${index})"`) : "") +
      (coordinates.length ? path(coordinates.map(run => chartLinePath(run, config.smoothLine)).join(" "), `fill="none" stroke="${stroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"`) : "");
  }).join("") : "";
  const groupWidth = Math.min(slotWidth * 0.8, (plot.combine ? 44 : 32 * plot.series.length));
  const columnWidth = plot.combine ? groupWidth : groupWidth / Math.max(1, plot.series.length);
  const marks = plot.slots.flatMap(slot => slot.marks.map(({ point, index, seriesIndex, start, end }) => {
    const center = isLine || plot.combine ? x(index) : x(index) - groupWidth / 2 + (seriesIndex + 0.5) * columnWidth;
    const fill = seriesColors[seriesIndex];
    const top = Math.min(y(start), y(end));
    const size = Math.abs(y(start) - y(end));
    const shape = isLine ? circle(center, y(end), 4, fill) : size === 0 ? line(center - 5, top, center + 5, top, fill) :
      rect(center - (columnWidth - 3) / 2, top, Math.max(0.2, columnWidth - 3), size, fill, plot.combine ? 0 : 2);
    const labelY = plot.combine ? top + size / 2 + 4 : point.value < 0 && !isLine ? y(end) + 14 : y(end) - 9;
    const label = config.showValues === true && (!plot.combine || size > 23) ?
      text(number(point.value), center, labelY, 11, palette.ink, 'text-anchor="middle"') : "";
    return titled(`${pointName(point)} · ${number(point.value)}`, shape + label);
  })).join("");
  const legend = showLegend ? plot.series.map(({ label, index }) => {
    const left = 30 + index % 5 * (width - 60) / 5;
    const top = bottom + 48 + extraBottom + Math.floor(index / 5) * 23;
    return rect(left, top - 8, 9, 9, seriesColors[index], 2) + text(short(label || "未分组", 15), left + 15, top, 12, palette.ink);
  }).join("") : "";
  const empty = !plot.hasValues ? text("没有可绘制的数值。", left + 18, top + 31, 14, palette.muted) : "";
  const centerY = (top + bottom) / 2;
  const titles = (axis.y ? text(axis.y, 29, centerY, 13, palette.ink, `data-chart-axis="y" text-anchor="middle" transform="rotate(-90 29 ${centerY})"`) : "") +
    (axis.x ? text(axis.x, (left + right) / 2, bottom + 52, 13, palette.ink, 'data-chart-axis="x" text-anchor="middle"') : "");
  return { width, height, content: guides + labels + curves + marks + legend + empty + titles };
}

function donut(projection, config, palette, categoryProperty, groupProperty, aggregation) {
  const points = orderedDonutPoints(projection.points, groupProperty || categoryProperty, Boolean(groupProperty), config.sort);
  const { distributable, parts, total, hasNegative } = chartDonutLayout(points, aggregation);
  const visible = parts.filter(part => part.share > 0);
  const showLegend = config.showLegend !== false || !visible.length;
  const displayValue = value => chartLabelValue(value, projection.currency);
  const labelLayout = donutSectorLabelLayout(visible, config.donutLabels, displayValue);
  const width = 820, height = Math.max(345, showLegend ? 117 + points.length * 28 : 0, labelLayout ? labelLayout.height + 128 : 0);
  const labelLeft = labelLayout && (showLegend ? 25 : (width - labelLayout.width) / 2);
  const labelTop = labelLayout && (height - labelLayout.height + 80) / 2;
  const cx = labelLayout ? labelLeft + labelLayout.center.x : showLegend ? 157 : width / 2;
  const cy = labelLayout ? labelTop + labelLayout.center.y : 199;
  const radius = labelLayout?.radius ?? 73;
  const at = fraction => `${cx + radius * Math.sin(fraction * 2 * Math.PI)},${cy - radius * Math.cos(fraction * 2 * Math.PI)}`;
  const paletteFor = (point, index) => color(palette, index, groupProperty ? point.seriesColor : point.categoryColor);
  const ring = parts.map(({ point, share: part, offset, end }, index) => {
    if (part <= 0) return "";
    const stroke = paletteFor(point, index);
    const style = `fill="none" stroke="${stroke}" stroke-width="${labelLayout ? 14 : 23}"`;
    const mark = part >= 1 ? `<circle cx="${cx}" cy="${cy}" r="${radius}" ${style}/>` :
      path(`M${at(offset)} A${radius},${radius} 0 ${end - offset > 0.5 ? 1 : 0} 1 ${at(end)}`, style);
    return titled(`${pointName(point)} · ${number(point.value)} · ${share.format(part)}`, mark);
  }).join("");
  const center = visible.length && config.showCenter !== false ?
    text(number(total), cx, cy + 2, labelLayout ? 18 : 30, palette.ink, 'text-anchor="middle" font-weight="650"') +
    text(aggregation === "count" ? "条记录" : hasNegative ? "正值合计" : "合计", cx, cy + (labelLayout ? 16 : 24), labelLayout ? 10 : 13, palette.muted, 'text-anchor="middle"') : "";
  const sectorLabels = labelLayout ? `<g transform="translate(${labelLeft} ${labelTop})">` + labelLayout.labels.map(label =>
    `<g data-chart-sector-label="${escape(label.key)}"><title>${escape(label.title)}</title>` +
    path(label.line, `fill="none" stroke="${palette.faint}" stroke-width=".7"`) +
    text(label.label, label.x, label.y, 10, palette.ink, `text-anchor="${label.anchor}" dominant-baseline="central"`) + "</g>").join("") + "</g>" : "";
  const rows = showLegend ? parts.map(({ point, share: part }, index) => {
    const left = labelLayout ? 445 : 274;
    const y = 112 + index * 28;
    return rect(left, y - 8, 9, 9, part ? paletteFor(point, index) : palette.line2, 2) +
      text(short(pointName(point), labelLayout ? 14 : 32), left + 20, y, 14, palette.ink) +
      text(number(point.value), 685, y, 14, palette.ink, 'text-anchor="end"') +
      (visible.length && Number.isFinite(point.value) && point.value >= 0 ? text(part && part < 0.001 ? "<0.1%" : share.format(part), 786, y, 13, palette.muted, 'text-anchor="end"') : "");
  }).join("") : "";
  const note = !distributable ? "各分类的聚合值无法组成总量。" : !visible.length ? "没有可用于环形图的正值。" : hasNegative ? "占比按正值合计计算。" : "";
  return { width, height, content: ring + center + sectorLabels + rows + (note ? text(note, 28, height - 22, 12, palette.muted) : "") };
}

export function buildChartSvg({ title = "图表", projection, config, categoryProperty, groupProperty, theme = "light", background = true }) {
  const palette = EXPORT_COLORS[theme] || EXPORT_COLORS.light;
  const { kind = "bar", aggregation = "count" } = config;
  const axis = chartAxisTitles({ ...config, kind }, categoryProperty, projection.valueLabel);
  let figure;
  if (kind === "number") {
    figure = { width: 520, height: 225, content: text(number(projection.total), 29, 151, 53, palette.ink, 'font-weight="650"') +
      text(`${projection.visibleCount} 条记录`, 31, 185, 15, palette.muted) };
  } else if (kind === "donut") figure = donut(projection, config, palette, categoryProperty, groupProperty, aggregation);
  else if (kind === "column" || kind === "line") figure = cartesian(projection, config, palette, categoryProperty, groupProperty, aggregation, axis);
  else figure = bars(projection.points, config, palette, aggregation === "count", axis);
  const { width, height, content } = figure;
  const caption = `${typeNames[kind]} · ${projection.valueLabel} · ${aggregations[aggregation]}${projection.cumulative ? " · 累计" : ""}`;
  const empty = kind !== "number" && !projection.points.length ? text("当前图表没有可显示的数据。", 30, 122, 14, palette.muted) : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img"><title>${escape(title)}</title><desc>${escape(caption)}</desc>` +
    (background ? rect(0, 0, width, height, palette.paper) : "") +
    '<g font-family="Segoe UI, Microsoft YaHei UI, Noto Sans SC, sans-serif">' +
    text(short(title, Math.floor((width - 55) / 24)), 28, 47, 25, palette.ink, 'font-weight="650"') +
    text(caption, 29, 71, 13, palette.muted) + (empty || content) + "</g></svg>";
  return { svg, width, height };
}
