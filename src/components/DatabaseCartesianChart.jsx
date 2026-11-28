import { Fragment, useId, useMemo, useRef, useState } from "react";
import { formatCurrencyAmount } from "../domain/currencyConversion.js";
import { cartesianChartLayout, chartAreaPath, chartLinePath } from "../domain/cartesianChart.js";
import { OPTION_PALETTE } from "../domain/propertyChanges.js";
import { useI18n } from "../i18n/workspaceRuntime.js";

const exponent = value => Math.abs(value) >= 1e7 || (value !== 0 && Math.abs(value) < 0.0001);
const pointName = point => [point.label, point.group].filter(Boolean).join(" / ");

function seriesColor(index, optionColor) {
  return optionColor && optionColor !== "default" && OPTION_PALETTE.includes(optionColor)
    ? `chart-color-${optionColor}` : `series-${index % 8}`;
}

export function DatabaseCartesianChart({ points, categories, kind, valueLabel, currency, count, groupProperty, categoryProperty, axisTitles,
  showLegend = true, showGrid = true, showValues = false, stacked = false, smoothLine = false, gradientArea = false, onSelect, onToggleSeries }) {
  const { locale, t } = useI18n();
  const exactNumber = useMemo(() => new Intl.NumberFormat(locale, { maximumSignificantDigits: 21 }), [locale]);
  const axisNumber = useMemo(() => new Intl.NumberFormat(locale, { maximumSignificantDigits: 5 }), [locale]);
  const exactValue = value => exponent(value) ? value.toExponential() : exactNumber.format(value);
  const axisValue = value => exponent(value) ? Number(value.toPrecision(4)).toExponential() : axisNumber.format(value);
  const displayAmount = value => currency ? formatCurrencyAmount(value, currency) : exactValue(value);
  const plot = useMemo(() => cartesianChartLayout(points, { kind, count, stacked, categories, categoryProperty, groupProperty }),
    [points, kind, count, stacked, categories, categoryProperty, groupProperty]);
  const root = useRef(null);
  const [tooltip, setTooltip] = useState(null);
  const gradientId = "chart-area-" + useId().replace(/[^\w-]/g, "");
  if (!plot.hasValues) return <p className="db-surface-message" role="status">{t("dbx.chart.noValues")}</p>;

  const isLine = kind === "line";
  const options = new Map((groupProperty?.options || []).map(option => [option.name, option.color]));
  const colors = plot.series.map(({ label, index, color }) => seriesColor(index, color || options.get(label)));
  const x = index => (index + 0.5) / plot.slots.length * 100;
  const y = value => 100 - plot.scale.position(value);
  const ticks = plot.scale.ticks.map(value => ({ value, label: axisValue(value), offset: `${y(value)}%` }));
  const tickWidth = Math.max(46, 14 + Math.max(...ticks.map(tick => tick.label.length)) * 6.5);
  const minimumSlot = Math.max(plot.isDate ? 110 : 70, isLine || plot.combine ? 0 : 14 * plot.series.length + 14);
  const plotName = isLine ? t("dbx.chart.line") : plot.combine ? t("dbx.chart.stackedColumn") : t("dbx.chart.column");
  const tooltipAt = (button, point) => {
    const box = button.getBoundingClientRect();
    const frame = root.current.getBoundingClientRect();
    return { button, point, x: box.left + box.width / 2 - frame.left, y: box.top - frame.top };
  };
  const activate = (event, point) => setTooltip(tooltipAt(event.currentTarget, point));
  const clearTooltip = point => setTooltip(current => current?.point.key === point.key ? null : current);

  return <div className={`db-cartesian-chart${plot.combine ? " is-stacked" : ""}`} ref={root}
    role="group" aria-label={`${valueLabel} ${plotName}`}>
    {showLegend && (groupProperty || plot.series.length > 1) && <ul className="db-cartesian-legend" aria-label={t("dbx.chart.legendAria")}>
      {plot.series.map(({ key, label, index }) => {
        const seriesName = !label || label === "未分组" ? t("db.unassignedGroup") : label;
        return <li key={key}>{onToggleSeries ? <button type="button" aria-label={t("dbx.chart.hideSeriesAria", { name: seriesName })} onClick={() => onToggleSeries(key)}>
          <i className={colors[index]} aria-hidden="true" />{seriesName}</button> : <><i className={colors[index]} aria-hidden="true" />{seriesName}</>}</li>;
      })}
    </ul>}
    <div className="db-cartesian-frame">
      {axisTitles?.y && <span className="db-cartesian-axis-title db-axis-title-y" data-chart-axis="y">{axisTitles.y}</span>}
      <div className="db-cartesian-scale" role="group" aria-label={t("dbx.chart.scaleAria", { label: valueLabel })} style={{ width: tickWidth }}>
        {ticks.map(tick => <span key={tick.value} data-zero={tick.value === 0 || undefined} style={{ top: tick.offset }}>{tick.label}</span>)}
      </div>
      <div className="db-cartesian-viewport" role="region" aria-label={plot.isDate ? t("dbx.chart.datePlotAria") : t("dbx.chart.plotAria")}
        tabIndex={0} onScroll={() => setTooltip(current => current?.button === document.activeElement ? tooltipAt(current.button, current.point) : null)}>
        <div className="db-cartesian-canvas" style={{ minWidth: minimumSlot * plot.slots.length, "--chart-slot-count": plot.slots.length }}>
          <div className="db-cartesian-plot">
            <div className="db-cartesian-grid" aria-hidden="true">
              {ticks.filter(tick => showGrid || tick.value === 0).map(tick =>
                <i key={tick.value} data-zero={tick.value === 0 || undefined} style={{ top: tick.offset }} />)}
            </div>
            {isLine && <svg className="db-cartesian-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              {gradientArea && <defs>{plot.series.map(({ key, index }) => <linearGradient key={key} id={`${gradientId}-${index}`} className={colors[index]} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="var(--series)" stopOpacity=".31" /><stop offset="100%" stopColor="var(--series)" stopOpacity=".04" />
              </linearGradient>)}</defs>}
              {plot.series.map(({ key, label, index, runs }) => {
                const coordinates = runs.filter(run => run.length > 1).map(run => run.map(mark => [x(mark.index), y(mark.end)]));
                if (!coordinates.length) return null;
                return <Fragment key={key}>
                  {gradientArea && <path className="db-cartesian-area" fill={`url(#${gradientId}-${index})`}
                    d={coordinates.map(run => chartAreaPath(run, smoothLine, y(0))).join(" ")} />}
                  <path className={`db-cartesian-line ${colors[index]}`} data-series={label} d={coordinates.map(run => chartLinePath(run, smoothLine)).join(" ")} />
                </Fragment>;
              })}
            </svg>}
            <div className="db-cartesian-slots">
              {plot.slots.map(slot => <div className="db-cartesian-slot" key={slot.id}>
                <div className="db-cartesian-band" style={{ "--chart-series-count": plot.series.length }}>
                  {slot.marks.map(({ point, seriesIndex, start, end }) => {
                    const top = Math.min(y(start), y(end));
                    const height = Math.abs(y(start) - y(end));
                    const onBaseline = point.value === 0;
                    const left = isLine || plot.combine ? 50 : (seriesIndex + 0.5) / plot.series.length * 100;
                    const displayValue = showValues && (!plot.combine || height >= 11);
                    return <button key={point.key} type="button" data-series={point.group || undefined} data-point={point.key}
                      className={`db-cartesian-mark ${colors[seriesIndex]} ${isLine ? "is-point" : onBaseline ? "is-zero" : "is-column"}`}
                      data-negative={point.value < 0 || undefined}
                      style={{ left: `${left}%`, top: `${isLine ? y(end) : top}%`, "--chart-mark-height": `${height}%` }}
                      aria-label={t("dbx.chart.viewRawAria", { name: pointName(point) })} aria-description={`${valueLabel} ${displayAmount(point.value)}`}
                      onClick={() => onSelect?.(point.key)} onFocus={e => activate(e, point)} onBlur={() => clearTooltip(point)}
                      onPointerEnter={e => activate(e, point)} onPointerLeave={e => { if (e.currentTarget !== document.activeElement) clearTooltip(point); }}>
                      {displayValue && <span className="db-cartesian-value" aria-hidden="true">{displayAmount(point.value)}</span>}
                    </button>;
                  })}
                </div>
              </div>)}
            </div>
          </div>
          <ul className="db-cartesian-categories" aria-label={categoryProperty?.name || t("dbx.chart.categoryFallback")}>
            {plot.slots.map(slot => <li title={slot.label} key={slot.id}>{slot.label}</li>)}
          </ul>
        </div>
      </div>
    </div>
    {axisTitles?.x && <div className="db-cartesian-axis-title db-axis-title-x" data-chart-axis="x">{axisTitles.x}</div>}
    {tooltip && <div className="db-cartesian-tooltip" aria-hidden="true" style={{ "--tip-x": `${tooltip.x}px`, "--tip-y": `${tooltip.y}px` }}>
      <span>{pointName(tooltip.point)}</span><strong>{displayAmount(tooltip.point.value)}</strong>
    </div>}
    {plot.overflow && <p className="db-chart-note">{t("dbx.chart.overflowNote")}</p>}
  </div>;
}
