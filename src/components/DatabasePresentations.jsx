import { lazy, Suspense, useEffect, useId, useMemo, useRef, useState } from "react";
import { itemDisplayTitle, itemsForSource, resolvePropertyValue } from "../domain/database.js";
import { chartProjection, formDefaults, formFields, formForView, activeFormFields, changeFormAnswer, mapRelatedPlaceSource, validateFormValues } from "../domain/viewProjections.js";
import { chartBarScale, chartDonutLayout } from "../domain/chartLayout.js";
import { canAccumulateChart, chartOptionEntries, orderedDonutPoints } from "../domain/chartCategories.js";
import { normalizeViewConfig } from "../domain/viewRegistry.js";

import { PropertyEditor } from "./PropertyEditor.jsx";
import { Dialog } from "../ui/Dialog.jsx";
import { DatabaseFormShare } from "./DatabaseFormShare.jsx";
import { DatabaseCartesianChart } from "./DatabaseCartesianChart.jsx";
import { DatabaseChartExport } from "./DatabaseChartExport.jsx";
import IconAdjustmentsHorizontal from "@tabler/icons-react/dist/esm/icons/IconAdjustmentsHorizontal.mjs";
import { formatPropertyValue } from "../domain/databaseProperties.js";
import { formatCurrencyAmount } from "../domain/currencyConversion.js";
import { OPTION_PALETTE } from "../domain/propertyChanges.js";
import { CHART_AXIS_LABELS, DONUT_SECTOR_LABELS, chartAxisTitles, chartLabelValue, donutSectorLabelLayout } from "../domain/chartLabels.js";
import { useI18n } from "../i18n/workspaceRuntime.js";
import "./databaseChartLabels.css";

const AGGREGATION_KEYS = ["count", "sum", "average", "min", "max"];
const CHART_KIND_KEYS = ["column", "bar", "line", "donut", "number"];
const DATE_INTERVAL_KEYS = ["exact", "day", "week", "month", "quarter", "year"];
const CHART_SORT_KEYS = ["source", "category_asc", "category_desc", "value_asc", "value_desc"];
const numberText = (value, locale) => value == null ? "—" : new Intl.NumberFormat(locale, { maximumFractionDigits: 4 }).format(value);
const pointLabel = (point) => [point.label, point.group].filter(Boolean).join(" / ");
const tickValue = (value, locale) => Math.abs(value) >= 1e7 || (value !== 0 && Math.abs(value) < 0.0001) ?
  Number(value.toPrecision(4)).toExponential() : new Intl.NumberFormat(locale, { maximumSignificantDigits: 5 }).format(value);
const shareValue = (share, locale) => share > 0 && share < 0.001 ? "<0.1%" : new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 }).format(share);
const GeographicMap = lazy(() => import("./DatabaseMap.jsx").then(module => ({ default: module.DatabaseMap })));

export function DatabaseMap(props) {
  const { t } = useI18n();
  return <Suspense fallback={<p className="db-surface-message" role="status">{t("db.ui.loadingMap")}</p>}><GeographicMap {...props}/></Suspense>;
}

const toggledKeys = (keys, key) => {
  const next = new Set(Array.isArray(keys) ? keys : []);
  if (!next.delete(key)) next.add(key);
  return [...next];
};

function ChartVisibility({ options, label, onToggle }) {
  const { t } = useI18n();
  if (!options.length) return null;
  const repeats = new Map();
  for (const option of options) repeats.set(option.label, (repeats.get(option.label) || 0) + 1);
  const shown = new Map();
  return <fieldset className="db-chart-visibility-list"><legend>{label}</legend>{options.map(option => {
    const ordinal = (shown.get(option.label) || 0) + 1;
    shown.set(option.label, ordinal);
    const name = `${option.label || t("dbx.chart.unsetOpt")}${repeats.get(option.label) > 1 ? ` (${ordinal})` : ""}`;
    return <label key={option.key}><input type="checkbox" checked={!option.hidden} aria-label={t("dbx.chart.showOptAria", { group: label, name })} onChange={() => onToggle(option.key)} />{name}</label>;
  })}</fieldset>;
}

export function ChartSettings({ source, workspace, projection, config = {}, onChange, prefix }) {
  const { t } = useI18n();
  const effectivePrefix = prefix ?? t("dbx.chart.prefixDefault");
  const numberProperties = source.properties.filter((property) => ["number", "converted_amount", "formula", "rollup"].includes(property.type));
  const kind = config.kind || "bar";
  const aggregation = config.aggregation || "count";
  const x = source.properties.find(property => property.id === config.xPropertyId);
  const group = source.properties.find(property => property.id === config.groupPropertyId);
  const cartesian = kind === "column" || kind === "line";
  const catalogue = useMemo(() => projection || (workspace ? chartProjection(workspace, source, itemsForSource(workspace, source.id), config) : null),
    [projection, workspace, source, config]);
  const categoryOptions = catalogue?.categoryOptions || chartOptionEntries(x);
  const seriesOptions = catalogue?.seriesOptions || chartOptionEntries(group);
  const set = (key, value) => onChange({ ...config, [key]: value });
  const keyChoices = (keys, prefixKey) => keys.map((value) => <option key={value} value={value}>{t(`${prefixKey}.${value}`)}</option>);
  const choices = object => Object.entries(object).map(([value, name]) => <option key={value} value={value}>{name}</option>);
  const fields = source.properties.map(property => <option key={property.id} value={property.id}>{property.name}</option>);
  return <div className="db-specific-settings db-chart-settings">
    <label>{t("dbx.chart.kindLabel")}<select aria-label={t("dbx.chart.kindAria", { prefix: effectivePrefix })} value={kind} onChange={event => set("kind", event.target.value)}>{keyChoices(CHART_KIND_KEYS, "dbx.chart.kind")}</select></label>
    {kind !== "number" && <label>{kind === "donut" ? t("dbx.chart.donutCat") : kind === "bar" ? t("dbx.chart.yAxisCat") : t("dbx.chart.xAxisCat")}<select aria-label={t("dbx.chart.axisAria", { prefix: effectivePrefix })} value={config.xPropertyId || ""} onChange={event => set("xPropertyId", event.target.value || null)}><option value="">{t("dbx.chart.perRecord")}</option>{fields}</select></label>}
    {kind !== "number" && x?.type === "date" && <label>{t("dbx.chart.dateGran")}<select aria-label={t("dbx.chart.dateGranAria", { prefix: effectivePrefix })} value={config.dateInterval || "exact"} onChange={event => set("dateInterval", event.target.value)}>{keyChoices(DATE_INTERVAL_KEYS, "dbx.chart.dateInt")}</select></label>}
    <label>{t("dbx.chart.calcLabel")}<select aria-label={t("dbx.chart.aggAria", { prefix: effectivePrefix })} value={aggregation} onChange={event => set("aggregation", event.target.value)}>{keyChoices(AGGREGATION_KEYS, "dbx.chart.agg")}</select></label>
    {aggregation !== "count" && <label>{t("dbx.chart.valPropLabel")}<select aria-label={t("dbx.chart.valPropAria", { prefix: effectivePrefix })} value={config.valuePropertyId || ""} onChange={event => set("valuePropertyId", event.target.value || null)}><option value="">{t("dbx.chart.chooseNumProp")}</option>{numberProperties.map(property => <option key={property.id} value={property.id}>{property.name}</option>)}</select></label>}
    {kind !== "number" && <><label>{t("dbx.chart.groupLabel")}<select aria-label={t("dbx.chart.groupAria", { prefix: effectivePrefix })} value={config.groupPropertyId || ""} onChange={event => set("groupPropertyId", event.target.value || null)}><option value="">{t("dbx.group.none")}</option>{fields}</select></label>
      <label>{t("dbx.chart.sortLabel")}<select aria-label={t("dbx.chart.sortAria", { prefix: effectivePrefix })} value={config.sort || "source"} onChange={event => set("sort", event.target.value)}>{keyChoices(CHART_SORT_KEYS, "dbx.chart.sort")}</select></label></>}
    {["column", "bar", "line"].includes(kind) && <label>{t("dbx.chart.axisTitlesLabel")}<select aria-label={t("dbx.chart.axisTitlesAria", { prefix: effectivePrefix })} value={config.axisTitles || "none"} onChange={event => set("axisTitles", event.target.value)}>{choices(CHART_AXIS_LABELS)}</select></label>}
    {kind === "donut" && <label>{t("dbx.chart.donutLabelsLabel")}<select aria-label={t("dbx.chart.donutLabelsAria", { prefix: effectivePrefix })} value={config.donutLabels || "none"} onChange={event => set("donutLabels", event.target.value)}>{choices(DONUT_SECTOR_LABELS)}</select></label>}
    {kind !== "number" && <><div className="db-chart-display-options">
      {((cartesian && group) || kind === "donut") && <label><input type="checkbox" aria-label={t("dbx.chart.showLegendAria", { prefix: effectivePrefix })} checked={config.showLegend !== false} onChange={event => set("showLegend", event.target.checked)} />{t("dbx.chart.legendText")}</label>}
      {kind !== "donut" && <><label><input type="checkbox" aria-label={t("dbx.chart.showGridAria", { prefix: effectivePrefix })} checked={config.showGrid !== false} onChange={event => set("showGrid", event.target.checked)} />{t("dbx.chart.gridText")}</label>
      <label><input type="checkbox" aria-label={t("dbx.chart.showValuesAria", { prefix: effectivePrefix })} checked={kind === "bar" ? config.showValues !== false : config.showValues === true} onChange={event => set("showValues", event.target.checked)} />{t("dbx.chart.valuesText")}</label></>}
      {kind === "column" && config.groupPropertyId && ["count", "sum"].includes(aggregation) && <label><input type="checkbox" aria-label={t("dbx.chart.stackedAria", { prefix: effectivePrefix })} checked={config.stacked === true} onChange={event => set("stacked", event.target.checked)} />{t("dbx.chart.stackedText")}</label>}
      {canAccumulateChart(config) && <label><input type="checkbox" aria-label={t("dbx.chart.cumulativeAria", { prefix: effectivePrefix })} checked={config.cumulative === true} onChange={event => set("cumulative", event.target.checked)} />{t("dbx.chart.cumulativeText")}</label>}
      {kind === "line" && <><label><input type="checkbox" aria-label={t("dbx.chart.smoothAria", { prefix: effectivePrefix })} checked={config.smoothLine === true} onChange={event => set("smoothLine", event.target.checked)} />{t("dbx.chart.smoothText")}</label>
        <label><input type="checkbox" aria-label={t("dbx.chart.gradAria", { prefix: effectivePrefix })} checked={config.gradientArea === true} onChange={event => set("gradientArea", event.target.checked)} />{t("dbx.chart.gradText")}</label></>}
      {kind === "donut" && <label><input type="checkbox" aria-label={t("dbx.chart.showCenterAria", { prefix: effectivePrefix })} checked={config.showCenter !== false} onChange={event => set("showCenter", event.target.checked)} />{t("dbx.chart.centerText")}</label>}
      {chartOptionEntries(x).length > 0 && <label><input type="checkbox" checked={config.showEmptyCategories === true} onChange={event => set("showEmptyCategories", event.target.checked)} />{t("dbx.chart.showEmptyCat")}</label>}
      {chartOptionEntries(group).length > 0 && <label><input type="checkbox" checked={config.showEmptySeries === true} onChange={event => set("showEmptySeries", event.target.checked)} />{t("dbx.chart.showEmptySeries")}</label>}
    </div><details className="db-chart-visibility"><summary>{t("dbx.chart.visibilitySummary")}</summary>
      <ChartVisibility options={categoryOptions} label={t("dbx.chart.categoryFallback")} onToggle={key => set("hiddenCategories", toggledKeys(config.hiddenCategories, key))} />
      {group && <ChartVisibility options={seriesOptions} label={t("dbx.chart.seriesLabel")} onToggle={key => set("hiddenSeries", toggledKeys(config.hiddenSeries, key))} />}
    </details></>}
  </div>;
}

function chartSeriesClass(index, color) {
  return color && color !== "default" && OPTION_PALETTE.includes(color) ? `chart-color-${color}` : `series-${index % 8}`;
}

function ChartBars({ points, valueLabel, displayValue, count, showGrid, showValues, axisTitles, showUnit, onSelect }) {
  const { locale, t } = useI18n();
  const { ticks, position } = chartBarScale(points.map(point => point.value), { count });
  const zero = position(0);
  const series = new Map([...new Set(points.map(point => point.seriesKey))].map((group, index) => [group, index]));
  const grid = ticks.map(value => ({ value, left: `${position(value)}%` }));
  return <div className="db-real-bars" data-tick-count={ticks.length}>
    {axisTitles.y && <div className="db-real-bar-category-title" data-chart-axis="y">{axisTitles.y}</div>}
    {points.map(point => {
      const endpoint = Number.isFinite(point.value) ? position(point.value) : zero;
      const color = chartSeriesClass(series.get(point.seriesKey), point.seriesColor);
      return <button type="button" className="db-real-bar-row" key={point.key}
        aria-label={t("dbx.chart.viewRawAria", { name: pointLabel(point) })} aria-description={`${valueLabel} ${displayValue(point.value)}`}
        onClick={() => onSelect(point.key)}>
        <span title={pointLabel(point)}>{pointLabel(point)}</span>
        <span className="db-real-bar-track" aria-hidden="true">
          {grid.filter(({ value }) => showGrid || value === 0).map(({ value, left }) => <b key={value} data-zero={value === 0 || undefined} style={{ left }} />)}
          {endpoint !== zero && <i className={color} style={{ left: `${Math.min(zero, endpoint)}%`, width: `${Math.abs(endpoint - zero)}%` }} />}
        </span>
        {showValues && <strong>{displayValue(point.value)}</strong>}
      </button>;
    })}
    <div className="db-real-bar-axis">
      <div className="db-real-bar-ticks" role="group" aria-label={t("dbx.chart.scaleAria", { label: valueLabel })}>
        {grid.map(({ value, left }, index) => <span key={value} data-zero={value === 0 || undefined}
          data-edge={index === 0 ? "start" : index === grid.length - 1 ? "end" : undefined} style={{ left }}>
          {tickValue(value, locale)}
        </span>)}
      </div>
      {showUnit && <span className="db-real-bar-unit">{valueLabel}</span>}
    </div>
    {axisTitles.x && <div className="db-real-bar-value-title" data-chart-axis="x">{axisTitles.x}</div>}
  </div>;
}

function donutPosition(fraction, radius, center) {
  const angle = fraction * 2 * Math.PI;
  return `${center.x + radius * Math.sin(angle)} ${center.y - radius * Math.cos(angle)}`;
}

function donutArc(offset, end, center) {
  return `M ${donutPosition(offset, 44, center)} A 44 44 0 ${end - offset > 0.5 ? 1 : 0} 1 ${donutPosition(end, 44, center)}`;
}

function ChartDonut({ points, aggregation, displayValue, categoryProperty, groupProperty, sort, showLegend, showCenter, labelMode, onSelect }) {
  const { locale, t } = useI18n();
  const property = groupProperty || categoryProperty;
  const orderedPoints = orderedDonutPoints(points, property, Boolean(groupProperty), sort);
  const { total, hasNegative, parts, distributable } = chartDonutLayout(orderedPoints, aggregation);
  const hasPlot = parts.some(part => part.share > 0);
  const totalLabel = aggregation === "count" ? t("dbx.chart.recordUnit") : hasNegative ? t("dbx.chart.posTotal") : t("dbx.chart.sumTotal");
  const slices = parts.map((part, index) => ({
    ...part,
    color: chartSeriesClass(index, groupProperty ? part.point.seriesColor : part.point.categoryColor),
  }));
  const visibleSlices = slices.filter(part => part.share > 0);
  const labelLayout = donutSectorLabelLayout(visibleSlices, labelMode, displayValue);
  const center = labelLayout?.center || { x: 60, y: 60 };

  return <div className="db-real-donut-wrap">
    {hasPlot && <div className={`db-real-donut-graphic${labelLayout ? " has-sector-labels" : ""}`} style={labelLayout ? { "--chart-label-width": `${labelLayout.width}px` } : undefined}>
      <svg viewBox={`0 0 ${labelLayout?.width || 120} ${labelLayout?.height || 120}`} className="db-real-donut" aria-hidden="true">
        {visibleSlices.map(({ point, share, offset, end, color }) => {
          const props = { className: `db-donut-segment ${color}`, onClick: () => onSelect(point.key) };
          const title = <title>{pointLabel(point)} · {displayValue(point.value)} · {shareValue(share, locale)}</title>;
          return share >= 1 ? <circle key={point.key} {...props} cx={center.x} cy={center.y} r="44">{title}</circle> :
            <path key={point.key} {...props} d={donutArc(offset, end, center)}>{title}</path>;
        })}
        {visibleSlices.length > 1 && visibleSlices.map(({ point, offset, color }, index) =>
          color === (visibleSlices[index - 1] || visibleSlices.at(-1)).color &&
          <path key={`divider-${point.key}`} className="db-donut-divider" d={`M ${donutPosition(offset, 36, center)} L ${donutPosition(offset, 52, center)}`} />)}
        {labelLayout?.labels.map(label => <g className="db-chart-sector-label" key={label.key} data-chart-sector-label={label.key}>
          <title>{label.title}</title><path d={label.line} /><text x={label.x} y={label.y} textAnchor={label.anchor} dominantBaseline="central">{label.label}</text>
        </g>)}
      </svg>
      {showCenter && <div className="db-real-donut-total"><strong title={displayValue(total)}>{displayValue(total)}</strong><span>{totalLabel}</span></div>}
    </div>}
    {(!hasPlot || showLegend) && <div className="db-chart-legend" aria-label={hasPlot ? t("dbx.chart.donutAriaShare") : t("dbx.chart.donutAriaVals")}>
      {slices.map(({ point, share, color }) => {
        const showShare = hasPlot && Number.isFinite(point.value) && point.value >= 0;
        const shareLabel = showShare ? shareValue(share, locale) : null;
        return <button type="button" className="db-chart-legend-row" key={point.key}
          aria-label={t("dbx.chart.viewRawAria", { name: pointLabel(point) })}
          aria-description={`${displayValue(point.value)}${aggregation === "count" ? ` ${t("dbx.chart.recordUnit")}` : ""}${shareLabel ? ` · ${shareLabel}` : ""}`}
          onClick={() => onSelect(point.key)}>
          <span className="db-chart-legend-label" title={pointLabel(point)}>
            {hasPlot && <i className={`db-chart-legend-dot ${share ? color : "is-empty"}`} aria-hidden="true" />}
            {pointLabel(point)}
          </span>
          <strong>{displayValue(point.value)}</strong>
          {hasPlot && <span className="db-chart-share">{shareLabel || "—"}</span>}
        </button>;
      })}
    </div>}
    {!distributable && <p className="db-chart-note">{t("dbx.chart.nonDistribNote", { label: t(`dbx.chart.agg.${aggregation}`) })}</p>}
    {distributable && !hasPlot && <p className="db-chart-note">{t("dbx.chart.noPositiveNote")}</p>}
    {hasPlot && hasNegative && <p className="db-chart-note">{t("dbx.chart.negShareNote")}</p>}
  </div>;
}

export function ChartView(props) {
  const { t } = useI18n();
  const { workspace, source, items, view, config: override, embedded, runtime, onUpdateView } = props;
  const config = useMemo(() => override || normalizeViewConfig("chart", view?.config).chart, [override, view?.config]);
  const projection = useMemo(() => chartProjection(workspace, source, items, config), [workspace, source, items, config]);
  const [editing, setEditing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const exportButton = useRef(null);
  const settingsId = useId();
  if (override || embedded) return <ChartPlot {...props} config={config} projection={projection} />;
  const category = config.kind !== "number" && source.properties.find(property => property.id === config.xPropertyId);
  const writable = onUpdateView && !runtime?.locked;
  const update = next => onUpdateView(view.id, { config: { ...view.config, chart: next } });
  return <section className="db-chart-workspace">
    <div className="db-chart-toolbar"><div><strong>{t(`dbx.chart.kind.${config.kind || "bar"}`)}</strong>{category && <span>{category.name}</span>}</div>
      <div className="db-chart-toolbar-actions">
        {writable && <button type="button" aria-label={t("dbx.chart.configChart")} aria-expanded={editing} aria-controls={settingsId} onClick={() => setEditing(!editing)}><IconAdjustmentsHorizontal size={16} aria-hidden="true" />{t("dbx.chart.configChart")}</button>}
        <button ref={exportButton} type="button" disabled={projection.missingValueProperty || Boolean(projection.currencyIssue)} onClick={() => setExporting(true)}>{t("dbx.chart.saveChartEllipsis")}</button>
      </div>
    </div>
    {editing && writable && <section id={settingsId} className="db-chart-inline-settings" aria-label={t("dbx.chart.chartSettingsAria")}><ChartSettings source={source} projection={projection} config={config} onChange={update} /></section>}
    <ChartPlot {...props} config={config} projection={projection} onToggleSeries={writable && config.groupPropertyId ? key => update({ ...config, hiddenSeries: toggledKeys(config.hiddenSeries, key) }) : null} />
    {exporting && <DatabaseChartExport title={view.name || source.title || t("dbx.chart.prefixDefault")} projection={projection} config={config} categoryProperty={category}
      groupProperty={source.properties.find(property => property.id === config.groupPropertyId)} restoreFocusRef={exportButton} onClose={() => setExporting(false)} />}
  </section>;
}

function ChartPlot({ workspace, source, items, config, projection, onOpenItemPage, onSaveDrilldown, onToggleSeries }) {
  const { locale, t } = useI18n();
  const { points, total, valueLabel, missingValueProperty, cumulative } = projection;
  const displayValue = value => chartLabelValue(value, projection.currency);
  const labelId = useId();
  const aggregation = config.aggregation || "count";
  const [selection, setSelection] = useState(null);
  const selected = selection === "total" ? { label: t("dbx.chart.allRecords"), group: "", key: null, itemIds: items.map(item => item.id) } : points.find(point => point.key === selection);
  const selectedIds = new Set(selected?.itemIds);
  const columns = source.properties.filter(property => property.type !== "title" && [config.xPropertyId, config.groupPropertyId, config.valuePropertyId].includes(property.id));
  const activate = (key, label) => ({
    role: "button", tabIndex: 0, "aria-label": t("dbx.chart.viewRawAria", { name: label }),
    onClick: () => setSelection(key),
    onKeyDown: event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelection(key); } },
  });
  if (missingValueProperty) return <p className="db-surface-message">{t("dbx.chart.chooseNumPropMsg")}</p>;
  if (projection.currencyIssue) return <p className="db-surface-message" role="status">{projection.currencyIssue}</p>;
  if (!points.length && config.kind !== "number") return <p className="db-surface-message">{items.length ? t("dbx.chart.noCategoriesMsg") : t("dbx.chart.noMatchMsg")}</p>;
  const groupProperty = source.properties.find(property => property.id === config.groupPropertyId);
  const xProperty = source.properties.find(property => property.id === config.xPropertyId);
  const axisTitles = chartAxisTitles(config, xProperty, valueLabel);
  return <figure className={`db-chart-surface db-chart-${config.kind || "bar"}`} aria-labelledby={labelId}>
    <figcaption id={labelId}>{valueLabel} · {t(`dbx.chart.agg.${aggregation}`)}{cumulative ? t("dbx.chart.cumulativeSuffix") : ""}</figcaption>
    {config.kind === "number" ? <div className="db-number-chart" {...activate("total", t("dbx.chart.allRecords"))}><strong>{projection.currency && total != null ? formatCurrencyAmount(total, projection.currency) : numberText(total, locale)}</strong><small>{t("dbx.chart.numRecordsCount", { count: items.length })}</small></div>
      : config.kind === "column" || config.kind === "line" ? <DatabaseCartesianChart points={points} currency={projection.currency} categories={projection.categories} kind={config.kind} valueLabel={valueLabel}
        count={aggregation === "count"} groupProperty={groupProperty} categoryProperty={xProperty} showLegend={config.showLegend !== false} showGrid={config.showGrid !== false}
        showValues={config.showValues === true} stacked={config.stacked === true && ["count", "sum"].includes(aggregation)} smoothLine={config.smoothLine === true}
        gradientArea={config.gradientArea === true} axisTitles={axisTitles} onSelect={setSelection} onToggleSeries={onToggleSeries} />
      : config.kind === "donut" ?
      <ChartDonut points={points} displayValue={displayValue} aggregation={aggregation} categoryProperty={xProperty} groupProperty={groupProperty} sort={config.sort}
        showLegend={config.showLegend !== false} showCenter={config.showCenter !== false} labelMode={config.donutLabels} onSelect={setSelection} /> :
      <ChartBars points={points} displayValue={displayValue} valueLabel={valueLabel} count={aggregation === "count"} showGrid={config.showGrid !== false} showValues={config.showValues !== false}
        axisTitles={axisTitles} showUnit={config.axisTitles === undefined} onSelect={setSelection} />}
    {projection.cumulativeMissingCategories && <p className="db-chart-note">{t("dbx.chart.cumulativeMissingNote")}</p>}
    <details className="db-chart-data"><summary>{t("dbx.chart.viewChartData")}</summary><table><thead><tr><th>{t("dbx.chart.categoryFallback")}</th>{groupProperty && <th>{t("dbx.chart.seriesLabel")}</th>}<th>{valueLabel}</th>{aggregation !== "count" && <th>{t("dbx.chart.colRecordCount")}</th>}</tr></thead><tbody>{points.map((point) => <tr key={point.key}><td><button type="button" onClick={() => setSelection(point.key)}>{point.label}</button></td>{groupProperty && <td>{point.group}</td>}<td>{displayValue(point.value)}</td>{aggregation !== "count" && <td>{point.itemCount ?? point.itemIds.length}</td>}</tr>)}</tbody></table></details>
    {selected && <Dialog title={t("dbx.chart.rawDialogTitle", { label: pointLabel(selected) })} description={t("dbx.chart.rawDialogDesc", { source: source.title, cumulative: selected.cumulative ? t("dbx.chart.cumulativePrefix") : "", count: selectedIds.size })} className="db-chart-drilldown" onClose={() => setSelection(null)}>
      <div className="db-chart-records"><table><thead><tr><th>{t("db.prop.title")}</th>{columns.map(property => <th key={property.id}>{property.name}</th>)}</tr></thead><tbody>{items.filter(item => selectedIds.has(item.id)).map(item => <tr key={item.id}><td>{onOpenItemPage ? <button type="button" onClick={event => { setSelection(null); onOpenItemPage(item.pageId, event.currentTarget.closest(".database-view") || undefined); }}>{itemDisplayTitle(workspace,source,item)}</button> : itemDisplayTitle(workspace,source,item)}</td>{columns.map(property => <td key={property.id}>{formatPropertyValue(workspace, property, resolvePropertyValue(workspace, source, item, property)) || "—"}</td>)}</tr>)}</tbody></table></div>
      {onSaveDrilldown && <footer><button type="button" onClick={() => {
        const bucketKeys = selected.sliceBucketKeys || (selected.stableKey ? [selected.stableKey] : undefined);
        onSaveDrilldown({ key: selected.key, label: pointLabel(selected), bucketKeys,
          xPropertyId: config.xPropertyId || null, groupPropertyId: config.groupPropertyId || null, dateInterval: projection.dateInterval,
          valuePropertyId: selected.cumulative && aggregation === "sum" ? config.valuePropertyId : undefined });
        setSelection(null);
      }}>{t("dbx.chart.saveAsTableView")}</button></footer>}
    </Dialog>}
  </figure>;
}

export function FormSettings({ workspace, source, config, onChange, runtime }) {
  const { t } = useI18n();
  const fields = formFields(source, config).map(({ property, ...field }) => field);
  const changeField = (index, patch) => onChange({ ...config, fields: fields.map((field, position) => position === index ? { ...field, ...patch } : field) });
  const move = (index, offset) => { const next = fields.slice(); const target = Math.max(0, Math.min(fields.length - 1, index + offset)); const [field] = next.splice(index, 1); next.splice(target, 0, field); onChange({ ...config, fields: next }); };
  return <div className="db-form-settings">
    <div className="db-specific-settings"><label>{t("dbx.form.title")}<input aria-label={t("dbx.form.title")} value={config.title} onChange={(event) => onChange({ ...config, title: event.target.value })} /></label><label>{t("dbx.form.desc")}<input aria-label={t("dbx.form.descAria")} value={config.description} onChange={(event) => onChange({ ...config, description: event.target.value })} /></label><label>{t("dbx.form.successMsg")}<input aria-label={t("dbx.form.successMsg")} value={config.successMessage} onChange={(event) => onChange({ ...config, successMessage: event.target.value })} /></label></div>
    <div className="db-setting-toggles"><label><input type="checkbox" checked={config.open} onChange={(event) => onChange({ ...config, open: event.target.checked })} />{t("dbx.form.openLocal")}</label><label><input type="checkbox" checked={config.anonymous} onChange={(event) => onChange({ ...config, anonymous: event.target.checked })} />{t("dbx.form.anonymousSubmit")}</label></div>
    {fields.map((field, index) => { const property = source.properties.find((entry) => entry.id === field.propertyId);
      const triggers = fields.slice(0, index).filter(f => !f.hidden).map(f => source.properties.find(p => p.id === f.propertyId)).filter(p => ["select","multi_select","status","checkbox"].includes(p?.type));
      const trigger = triggers.find(p => p.id === field.showWhen?.propertyId);
      const choices = p => p?.type === "checkbox" ? [{id:"true", name:t("db.ui.checked")},{id:"false", name:t("db.ui.unchecked")}] : p?.options || [];
      return <div className="db-form-field-setting" key={field.propertyId}>
      <strong>{property.name}</strong><label><input type="checkbox" aria-label={t("dbx.form.reqAria", { name: property.name })} checked={Boolean(field.required)} onChange={(event) => changeField(index, { required: event.target.checked })} />{t("dbx.form.required")}</label><label><input type="checkbox" aria-label={t("dbx.form.hiddenAria", { name: property.name })} checked={Boolean(field.hidden)} onChange={(event) => changeField(index, { hidden: event.target.checked })} />{t("db.ui.hideProp")}</label>
      <button type="button" aria-label={t("dbx.form.moveUpAria", { name: property.name })} disabled={index === 0} onClick={() => move(index, -1)}>↑</button><button type="button" aria-label={t("dbx.form.moveDownAria", { name: property.name })} disabled={index === fields.length - 1} onClick={() => move(index, 1)}>↓</button>
      {(triggers.length > 0 || field.showWhen) && <details><summary>{t("dbx.form.showWhen")}</summary><label>{t("dbx.form.basedOnPrev")}<select aria-label={t("dbx.form.condPropAria", { name: property.name })} value={field.showWhen?.propertyId || ""} onChange={e => {
        const prior = triggers.find(p => p.id === e.target.value);
        changeField(index, { showWhen: prior ? { propertyId: prior.id, value: choices(prior)[0]?.id || "" } : null });
      }}><option value="">{t("dbx.form.alwaysShow")}</option>{field.showWhen && !trigger && <option value={field.showWhen.propertyId}>{t("dbx.form.prevUnavailable")}</option>}{triggers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      {trigger && <label>{t("dbx.form.whenAnswer")}<select aria-label={t("dbx.form.condAnsAria", { name: property.name })} value={String(field.showWhen.value)} onChange={e => changeField(index,{ showWhen: { propertyId: trigger.id, value: e.target.value } })}>{choices(trigger).map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>}</details>}
      <details><summary>{t("dbx.form.defaultVal")}</summary><PropertyEditor workspace={workspace} source={source} property={property} label={t("dbx.form.defaultValAria", { name: property.name })} value={field.defaultValue} runtime={runtime} onChange={(defaultValue) => changeField(index, { defaultValue })} /><button type="button" onClick={() => { const next = { ...field }; delete next.defaultValue; onChange({ ...config, fields: fields.map((entry, position) => position === index ? next : entry) }); }}>{t("dbx.form.clearDefault")}</button></details>
    </div>; })}
  </div>;
}

export function DatabaseForm({ workspace, source, view, onCreateItem, runtime }) {
  const { t } = useI18n();
  const config = formForView(source, view, normalizeViewConfig("form", view.config).form);
  const [values, setValues] = useState(() => formDefaults(source, config));
  const [errors, setErrors] = useState({});
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  useEffect(() => { setValues(formDefaults(source, config)); setErrors({}); setSuccess(""); }, [view.id]);
  const fields = activeFormFields(source, config, values);
  const submit = async (event) => {
    event.preventDefault();
    if (submitting.current || !config.open || runtime?.locked) return;
    const result = validateFormValues(source, config, values);
    setErrors(result.errors); setSuccess("");
    if (!result.valid) return;
    submitting.current = true; setBusy(true);
    try {
      const created = await onCreateItem?.(source.id, { values: result.values, submission: { viewId: view.id, personId: config.anonymous ? null : workspace.ui?.currentPersonId || "person-local", anonymous: config.anonymous } });
      if (!created) throw new Error(t("dbx.form.saveRetryErr"));
      setValues(formDefaults(source, config)); setSuccess(config.successMessage);
    } catch (error) { setErrors({ form: error.message }); }
    finally { submitting.current = false; setBusy(false); }
  };
  return <><form className="db-form-surface" onSubmit={submit} noValidate>
    <h3>{config.title}</h3>{config.description && <p>{config.description}</p>}
    {!config.open ? <p className="db-surface-message">{t("dbx.form.closedMsg")}</p> : <>
      {fields.filter((field) => !field.hidden).map((field) => <div className="db-form-field" key={field.propertyId}><span>{field.property.name}{field.required && <span aria-label={t("dbx.form.required")}> *</span>}</span><PropertyEditor workspace={workspace} source={source} property={field.property} value={values[field.propertyId]} runtime={runtime} onChange={(value) => setValues((current) => changeFormAnswer(source, config, current, field.propertyId, value))} />{errors[field.propertyId] && <small className="db-field-error" role="alert">{errors[field.propertyId]}</small>}</div>)}
      {fields.filter((field) => field.hidden && errors[field.propertyId]).map((field) => <p className="db-field-error" role="alert" key={field.propertyId}>{errors[field.propertyId]}</p>)}
      <button type="submit" disabled={busy || runtime?.locked}>{busy ? t("dbx.form.saving") : t("dbx.form.submit")}</button><small>{config.anonymous ? t("dbx.form.anonNote") : t("dbx.form.memberNote")}</small>
    </>}
    {errors.form && <p className="db-field-error" role="alert">{errors.form}</p>}{success && <p className="db-form-success" role="status">{success}</p>}
  </form><DatabaseFormShare key={view.id} {...{workspace, source, view, runtime}}/></>;
}

export { DashboardSettings } from "./DashboardSettings.jsx";
export { DatabaseDashboard } from "./DatabaseDashboard.jsx";

export function MapSettings({ workspace, source, config, onChange }) {
  const { t } = useI18n();
  const relations = source.properties.filter(property => property.type === "relation")
    .map(property => ({ property, places: mapRelatedPlaceSource(workspace, source, property)?.properties.filter(target => target.type === "place") || [] }))
    .filter(entry => entry.places.length);
  const selected = relations.find(entry => entry.property.id === config.relationPropertyId);
  const relatedPlaceId = selected?.places.find(property => property.id === config.relatedPlacePropertyId)?.id || "";
  return <div className="db-specific-settings">
    <label>{t("dbx.map.placeProp")}<select aria-label={t("dbx.map.placePropAria")} value={config.placePropertyId || ""} onChange={event => onChange({ ...config, placePropertyId: event.target.value || null })}>
      <option value="">{t("dbx.map.firstPlaceProp")}</option>{source.properties.filter(property => property.type === "place").map(property => <option key={property.id} value={property.id}>{property.name}</option>)}
    </select></label>
    {relations.length > 0 && <label>{t("dbx.map.relPlaceSource")}<select aria-label={t("dbx.map.relPlaceSourceAria")} value={selected?.property.id || ""} onChange={event => onChange({ ...config, relationPropertyId: event.target.value || null, relatedPlacePropertyId: null })}>
      <option value="">{t("dbx.map.noRelPlace")}</option>{relations.map(({ property }) => <option key={property.id} value={property.id}>{property.name}</option>)}
    </select></label>}
    {selected && <label>{t("dbx.map.targetPlaceProp")}<select aria-label={t("dbx.map.targetPlacePropAria")} value={relatedPlaceId} onChange={event => onChange({ ...config, relatedPlacePropertyId: event.target.value || null })}>
      <option value="">{t("dbx.map.choosePlaceProp")}</option>{selected.places.map(property => <option key={property.id} value={property.id}>{property.name}</option>)}
    </select></label>}
    {selected && <p className="db-field-hint">{t("dbx.map.relCoordHint")}</p>}
    <label>{t("dbx.map.markerName")}<select aria-label={t("dbx.map.markerNameAria")} value={config.labelPropertyId || ""} onChange={event => onChange({ ...config, labelPropertyId: event.target.value || null })}>
      <option value="">{t("dbx.map.recordTitleOpt")}</option>{source.properties.map(property => <option key={property.id} value={property.id}>{property.name}</option>)}
    </select></label>
    <p className="db-field-hint">{t("dbx.map.tilePrivacyHint")}</p>
  </div>;
}
