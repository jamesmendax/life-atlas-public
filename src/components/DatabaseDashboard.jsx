import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import IconGripVertical from "@tabler/icons-react/dist/esm/icons/IconGripVertical.mjs";
import IconPlus from "@tabler/icons-react/dist/esm/icons/IconPlus.mjs";
import { itemDisplayTitle, resolvePropertyValue } from "../domain/database.js";
import { dashboardChartTitle, dashboardProjection, dashboardRowHeight, dashboardRows, moveWidgetToRow, relativePeriod, resizeWidget, widgetNames, widgetResizeBounds, widthOf } from "../domain/dashboard.js";
import { formatNumber as formatPropertyNumber } from "../domain/numberFormat.js";
import { aggregateNumbers } from "../domain/viewProjections.js";
import { currencyAggregationIssue, formatCurrencyAmount, reportedCurrency } from "../domain/currencyConversion.js";
import { normalizeViewConfig, VIEW_REGISTRY } from "../domain/viewRegistry.js";
import { AddDashboardWidgets, DashboardFilters, WidgetSettings } from "./DashboardSettings.jsx";
import { ChartView } from "./DatabasePresentations.jsx";
import { useDashboardFilters } from "./useDashboardFilters.js";
import { isPageArchived } from "../domain/archive.js";
import { filterUsesRelativeDate } from "../domain/databaseFilters.js";
import { useFilterDay } from "./useFilterDay.js";

const formatNumber = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 4 });
const dragType = "application/x-life-atlas-dashboard-widget";

export function DashboardSavedView({ component: View, workspace, source, saved, items, runtime, readOnlyReference, onUpdateView, ...actions }) {
  const locked = Boolean(runtime?.locked || readOnlyReference || isPageArchived(workspace, source.ownerPageId) || workspace.pages?.some(page => page.id === source.ownerPageId && page.settings?.locked));
  const [navigation, setNavigation] = useState(null);
  // A locked calendar or timeline may still browse dates. Keep its viewport local.
  const local = locked && navigation?.base === saved ? navigation.view : null;
  const currentWorkspace = local ? { ...workspace, databaseViews: workspace.databaseViews.map(entry => entry.id === saved.id ? local : entry) } : workspace;
  const update = locked ? (id, patch) => {
    if (id === saved.id && patch.config) setNavigation({ base:saved, view:{ ...saved, config:patch.config } });
  } : onUpdateView;
  return <View workspace={currentWorkspace} sourceId={source.id} viewId={saved.id} viewIdsJson={JSON.stringify([saved.id])}
    embeddedItems={items} inline readOnlyReference={readOnlyReference} onUpdateView={update} onOpenItemPage={actions.onOpenItemPage}
    onUpdateItemValue={locked ? undefined : actions.onUpdateItemValue} onCreateItem={locked ? undefined : actions.onCreateItem}
    onAddProperty={locked ? undefined : actions.onAddProperty} runtime={{ ...runtime, locked }} />;
}

function ResizeHandle({ axis, label, value, step, scale, min, max, onCommit }) {
  const start = useRef(null);
  const [preview, setPreview] = useState(null);
  const vertical = axis === "width";
  const clamp = n => Math.min(max, Math.max(min, Math.round(n)));
  function position(e) { return vertical ? e.clientX : e.clientY; }
  function next(e) { return clamp(value + Math.round((position(e) - start.current.pos) / start.current.scale) * step); }
  return <div role="separator" className={"db-dashboard-resize is-" + axis} tabIndex={0} aria-label={label} title={label + " · 拖动或使用方向键"} aria-orientation={vertical ? "vertical" : "horizontal"} aria-valuenow={preview ?? value} aria-valuemin={min} aria-valuemax={max} data-resizing={preview !== null || undefined}
    onKeyDown={e => {
      const keys = vertical ? ["ArrowLeft","ArrowRight"] : ["ArrowUp","ArrowDown"];
      if (!keys.includes(e.key)) return;
      e.preventDefault(); e.stopPropagation();
      onCommit(clamp(value + (e.key === keys[0] ? -step : step)));
    }}
    onPointerDown={e => {
      if (e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      start.current = {id:e.pointerId, pos:position(e), scale:scale(e.currentTarget)};
      e.currentTarget.setPointerCapture(e.pointerId);
      setPreview(value);
    }}
    onPointerMove={e => { if (start.current?.id === e.pointerId) setPreview(next(e)); }}
    onPointerUp={e => {
      if (start.current?.id !== e.pointerId) return;
      const n = next(e);
      start.current = null; setPreview(null);
      e.currentTarget.releasePointerCapture(e.pointerId);
      if (n !== value) onCommit(n);
    }}
    onLostPointerCapture={() => { start.current = null; setPreview(null); }}
    >{preview !== null && <output>{preview + (vertical ? " / 4" : " px")}</output>}</div>;
}

function DashboardWidgetBody({ result, widget, workspace, onOpenItemPage, renderSavedView }) {
  const {source, view, items, error} = result;
  if (error) return <p className="db-surface-message" role="status">{error}</p>;
  if (view) return <div className="db-dashboard-embedded">{renderSavedView({source,view,items})}</div>;
  if (widget.type === "chart") return <ChartView workspace={workspace} source={source} items={items} onOpenItemPage={onOpenItemPage} config={widget.chart || {kind:"bar",aggregation:"count"}}/>;
  if (widget.type === "metric") {
    const property = source.properties.find(p=>p.id===widget.valuePropertyId);
    const values = property ? items.map(item=>resolvePropertyValue(workspace,source,item,property)) : [];
    const value = aggregateNumbers(values,widget.aggregation || "count",items.length);
    const count = !widget.aggregation || widget.aggregation === "count";
    const issue = !count && currencyAggregationIssue(source, property, items, values);
    if (issue) return <p className="db-surface-message" role="status">{issue.error.message}</p>;
    const currency = !count && reportedCurrency(workspace, property, source);
    const amount = currency ? formatCurrencyAmount(value, currency) : !count && property?.config?.numberFormat ? formatPropertyNumber(value, property.config.numberFormat) : formatNumber.format(value);
    const unit = count ? "条记录" : property ? ({sum:"合计",average:"平均",min:"最小值",max:"最大值"}[widget.aggregation]) : "请选择数值属性";
    return <div className="db-dashboard-metric"><strong>{value == null || (!count && !property) ? "—" : amount}</strong><small>{unit}</small></div>;
  }
  if (widget.type === "list") return <div className="db-list-view">{items.length ? items.slice(0,widget.limit || 8).map(item=><button type="button" className="db-list-row" key={item.id} onClick={event=>onOpenItemPage?.(item.pageId,event.currentTarget)}>{itemDisplayTitle(workspace,source,item)}</button>) : <p className="db-surface-message">当前没有符合条件的记录。</p>}</div>;
  return <p className="db-surface-message">此组件类型暂不可用。</p>;
}

export function DatabaseDashboard({ workspace, source, view, items, searchQuery, runtime, onUpdateView, onOpenItemPage, renderSavedView }) {
  const config = useMemo(()=>normalizeViewConfig("dashboard",view.config).dashboard,[view.config]);
  const [editing, setEditing] = useState(() => config.widgets.length === 0);
  const [configId, setConfigId] = useState(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [overId, setOverId] = useState(null);
  const [addTarget, setAddTarget] = useState(null);
  const dragging = useRef(null);
  const canvas = useRef(null);
  const inspector = useRef(null);
  const writable = Boolean(!runtime?.locked && onUpdateView);
  const edit = editing && writable;
  const filters = useDashboardFilters(workspace.workspaceId, workspace.ui?.currentPersonId || "local", view.id, config.globalFilters);
  const rows = dashboardRows(config.widgets);
  const relativeSavedView = config.widgets.some(widget => widget.type === "view" && filterUsesRelativeDate(workspace.databaseViews?.find(saved => saved.id === widget.viewId)?.filter));
  const day = useFilterDay(relativeSavedView || filterUsesRelativeDate(view.filter) || filters.rules.some(rule => relativePeriod(rule.operator) || filterUsesRelativeDate(rule)));
  const results = useMemo(()=>new Map(config.widgets.map(widget=>[widget.id,dashboardProjection({workspace,primary:source,dashboard:view,widget,globalFilters:filters.rules,items,query:searchQuery,now:new Date(day)})])),[workspace,source,view,config,filters.rules,items,searchQuery,day]);
  const save = next => { if (writable) onUpdateView(view.id,{config:{...view.config,dashboard:next}}); };
  const settings = {workspace,source,config,onChange:save};
  const renameLayout = (ids, patch) => save({...config,widgets:config.widgets.map(w=>ids.includes(w.id) ? {...w,...patch} : w)});
  const setLayout = widgets => save({ ...config, widgets });
  const reorder = (id, targetId, side) => setLayout(moveWidgetToRow(config.widgets, id, targetId, side));
  useEffect(() => {
    if (edit && configId) inspector.current?.querySelector("select, input")?.focus();
  }, [edit, configId]);
  function dropSide(event) {
    const bounds = event.currentTarget.getBoundingClientRect();
    return (canvas.current?.clientWidth <= 540 ? event.clientY < bounds.top + bounds.height / 2 : event.clientX < bounds.left + bounds.width / 2) ? "before" : "after";
  }
  function dragOver(event, location) {
    if (!edit || !dragging.current || !event.dataTransfer.types.includes(dragType)) return;
    event.preventDefault(); event.dataTransfer.dropEffect = "move";
    setOverId(location);
  }
  function drop(event, targetId, side) {
    if (!edit || !dragging.current || !event.dataTransfer.types.includes(dragType)) return;
    event.preventDefault(); event.stopPropagation();
    reorder(dragging.current, targetId, side);
    dragging.current = null; setOverId(null); setAddTarget(null);
  }
  const addPicker = (targetId, heading, empty = false) => <section className="db-dashboard-add-zone" data-target={targetId || "new"} data-empty={empty || undefined} aria-label={heading}>
    <h3>{heading}</h3>
    {empty && <p>先选一个组件，再选择要显示的数据源。</p>}
    <AddDashboardWidgets {...settings} targetId={targetId} expanded={empty} onAdded={id=>{setConfigId(id);setAddTarget(null);}}/>
  </section>;
  function moveWithKeys(event, widget, index) {
    if (!["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const before = event.key === "ArrowUp" || event.key === "ArrowLeft";
    const target = config.widgets[index + (before ? -1 : 1)];
    if (target) reorder(widget.id, target.id, before ? "before" : "after");
    requestAnimationFrame(()=>Array.from(canvas.current?.querySelectorAll("[data-widget-id]") || []).find(card=>card.dataset.widgetId===widget.id)?.querySelector(".db-dashboard-drag")?.focus());
  }
  const selected = edit && config.widgets.find(w=>w.id===configId);
  return <div className="db-dashboard-workspace">
    <div className="db-dashboard-toolbar">{edit && rows.length > 0 && <span>拖动组件调整位置，拖动边界调整宽高。</span>}<button type="button" aria-expanded={filtersOpen} onClick={()=>setFiltersOpen(!filtersOpen)}>统一筛选{filters.rules.length ? " · "+filters.rules.length : ""}</button>
      {writable && <button type="button" className="db-dashboard-edit" aria-pressed={edit} onClick={()=>{setEditing(!edit);setConfigId(null);setAddTarget(null);}}>{edit ? "完成编辑" : "编辑仪表盘"}</button>}
    </div>
    {filtersOpen && <section className="db-dashboard-filter-scope" aria-label="仪表盘筛选">
      <div className="db-dashboard-toolbar"><span>{filters.isPersonal ? "正在使用我的筛选" : "正在使用视图默认筛选"}</span>
        {filters.isPersonal && <button type="button" onClick={() => filters.set(null)}>恢复视图默认</button>}
        {filters.isPersonal && writable && <button type="button" onClick={() => { save({ ...config, globalFilters: filters.rules }); filters.set(null); }}>保存为视图默认</button>}
      </div>
      <DashboardFilters {...settings} config={{ ...config, globalFilters: filters.rules }} onChange={next => filters.set(next.globalFilters)} />
    </section>}
    {selected && <section ref={inspector} className="db-dashboard-inspector" aria-label="配置组件"><header><strong>配置组件</strong><button type="button" onClick={()=>setConfigId(null)}>关闭配置</button></header><WidgetSettings {...settings} widget={selected} onSelectWidget={setConfigId}/></section>}
    <div className="db-configured-dashboard" data-editing={edit} ref={canvas}>
      {!rows.length && (edit ? addPicker(null, "从空白搭建仪表盘", true) : <div className="db-dashboard-empty-view"><p>此仪表盘还没有组件。</p>{writable && <button type="button" onClick={()=>setEditing(true)}>添加第一个组件</button>}</div>)}
      {rows.map((row,rowIndex)=>{
        const height = dashboardRowHeight(row);
        const lastId = row.at(-1).id;
        return <Fragment key={row[0].id}>{edit && <div className="db-dashboard-row-control"><span>第 {rowIndex+1} 行</span>{row.length < 4 && <button type="button" aria-label={"添加到第 "+(rowIndex+1)+" 行"} aria-expanded={addTarget === lastId} onClick={()=>{setAddTarget(addTarget === lastId ? null : lastId);setConfigId(null);}}><IconPlus size={14} aria-hidden="true"/> 添加组件</button>}</div>}
        {edit && addTarget === lastId && addPicker(lastId, "添加到第 "+(rowIndex+1)+" 行")}
        <div className="db-dashboard-row" data-row={rowIndex+1} style={{"--dashboard-height":height+"px"}}>
          {row.map(widget=>{
            const result = results.get(widget.id);
            const title = widget.title || result.view?.name || (widget.type === "chart" ? dashboardChartTitle(result.source, widget.chart) : widgetNames[widget.type]) || "组件";
            const index = config.widgets.indexOf(widget);
            const bounds = edit ? widgetResizeBounds(config.widgets, widget.id) : null;
            return <section className={"db-configured-widget is-"+(widget.size || "wide")} key={widget.id} data-widget-id={widget.id} data-widget-type={widget.type} data-widget-source={result.source?.id} data-saved-view={result.view?.id} data-drop-edge={overId === widget.id + "/before" ? "before" : overId === widget.id + "/after" ? "after" : undefined} style={{"--dashboard-span":widthOf(widget)}}
              onDragOver={e=>dragOver(e,widget.id + "/" + dropSide(e))} onDrop={e=>drop(e,widget.id,dropSide(e))}>
              <header className="db-dashboard-widget-title"><div><h3>{title}</h3><small>{result.source?.title}{result.view && " · "+ VIEW_REGISTRY[result.view.type].label}</small></div>
                {edit && <div className="db-dashboard-edit-actions"><button type="button" aria-label={"配置 "+title} aria-expanded={configId===widget.id} onClick={()=>setConfigId(widget.id)}>配置</button><button type="button" className="db-dashboard-drag" draggable aria-label={"移动 "+title} title="拖动排序，或按方向键移动" onDragStart={e=>{dragging.current=widget.id;e.dataTransfer.setData(dragType,widget.id);e.dataTransfer.effectAllowed="move";}} onDragEnd={()=>{dragging.current=null;setOverId(null);}} onClick={()=>setConfigId(widget.id)} onKeyDown={e=>moveWithKeys(e,widget,index)}><IconGripVertical size={15} aria-hidden="true"/></button></div>}
              </header>
              {Boolean(result.unmapped) && <small className="db-dashboard-unmapped">{result.unmapped} 项统一筛选未映射到此库</small>}
              <div className="db-dashboard-widget-body"><DashboardWidgetBody workspace={workspace} result={result} widget={widget} onOpenItemPage={onOpenItemPage} renderSavedView={renderSavedView}/></div>
              {edit && bounds.max>bounds.min && <ResizeHandle axis="width" label={"调整 "+title+" 列宽"} value={widthOf(widget)} min={bounds.min} max={bounds.max} step={1} scale={el=>Math.max(1,el.closest(".db-dashboard-row").getBoundingClientRect().width/4)} onCommit={span=>setLayout(resizeWidget(config.widgets,widget.id,span))}/>}
            </section>;
          })}
          {edit && <ResizeHandle axis="height" label={"调整第 "+(rowIndex+1)+" 行高度"} value={height} min={140} max={1000} step={10} scale={()=>10} onCommit={rowHeight=>renameLayout(row.map(w=>w.id),{rowHeight})}/>}
        </div></Fragment>;
      })}
      {edit && rows.length > 0 && <div className="db-dashboard-new-row" data-drop={overId === "new" || undefined} onDragOver={e=>dragOver(e,"new")} onDrop={e=>drop(e,null)}>
        {addTarget ? <button type="button" onClick={()=>setAddTarget(null)}><IconPlus size={15} aria-hidden="true"/> 在新行添加组件</button> : addPicker(null, "在新行添加组件")}
      </div>}
    </div>
  </div>;
}
