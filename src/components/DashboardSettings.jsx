import IconChartDonut from "@tabler/icons-react/dist/esm/icons/IconChartDonut.mjs";
import IconDatabase from "@tabler/icons-react/dist/esm/icons/IconDatabase.mjs";
import IconList from "@tabler/icons-react/dist/esm/icons/IconList.mjs";
import IconSum from "@tabler/icons-react/dist/esm/icons/IconSum.mjs";
import { availableViews, compatibleFields, dashboardChartTitle, dashboardSources, duplicateWidget, insertWidget, moveWidgetToRow, relativePeriod, removeWidget, resizeWidget, widgetNames, widgetResizeBounds, widthOf } from "../domain/dashboard.js";
import { suggestedChart, VIEW_REGISTRY } from "../domain/viewRegistry.js";
import { ChartSettings } from "./DatabasePresentations.jsx";
import { FilterOperatorSelect, FilterValueInput, newFilterCondition } from "./DatabaseQuerySettings.jsx";
import { filterHasNoValue } from "../domain/databaseFilters.js";

const aggregations = {count:"计数",sum:"总和",average:"平均值",min:"最小值",max:"最大值"};
const chartDefault = {kind:"bar",aggregation:"count"};
const widgetChoices = {
  view: [IconDatabase, "显示一张已有的表格、看板或日历"],
  metric: [IconSum, "统计数量或汇总数值"],
  chart: [IconChartDonut, "比较数量、占比或趋势"],
  list: [IconList, "列出可以点开的记录"],
};

export function AddDashboardWidgets({ config, source, workspace, onChange, targetId = null, onAdded, expanded = false }) {
  function add(type) {
    const firstView = availableViews(workspace, source.id)[0];
    const widget = {id:crypto.randomUUID(), type, title:["view", "chart"].includes(type) ? "" : "新" + widgetNames[type], size:type === "metric" ? "small" : "wide"};
    if (type === "view") widget.viewId = firstView?.id || null;
    if (type === "chart") widget.chart = suggestedChart(source);
    if (type === "metric") widget.aggregation = "count";
    if (type === "list") widget.limit = 8;
    onChange({...config, widgets:insertWidget(config.widgets, widget, targetId)});
    onAdded(widget.id);
  }
  return <div className="db-dashboard-add" data-expanded={expanded}>{Object.entries(widgetChoices).map(([type, [Icon, description]]) => <button type="button" key={type} aria-label={"＋ " + widgetNames[type]} onClick={() => add(type)}><Icon size={18} stroke={1.65} aria-hidden="true"/><span><strong>{widgetNames[type]}</strong>{expanded && <small>{description}</small>}</span></button>)}</div>;
}

export function WidgetSettings({config, widget, workspace, source, onChange, onSelectWidget}) {
  const widgets = config.widgets;
  const index = widgets.findIndex(entry => entry.id === widget.id);
  const names = "组件 " + (index + 1) + " ";
  const sources = dashboardSources(workspace);
  const selected = sources.find(entry => entry.id === (widget.sourceId || source.id));
  const views = availableViews(workspace, selected?.id);
  const update = patch => onChange({...config, widgets:widgets.map(entry => entry.id === widget.id ? {...widget,...patch} : entry)});
  const setLayout = next => onChange({ ...config, widgets: next });
  const bounds = widgetResizeBounds(widgets, widget.id);
  function changeSource(sourceId) {
    const patch = {sourceId};
    if (widget.type === "view") patch.viewId = availableViews(workspace, sourceId)[0]?.id || null;
    if (widget.type === "metric") patch.valuePropertyId = null;
    if (widget.type === "chart") {
      const suggestion = suggestedChart(sources.find(entry => entry.id === sourceId));
      const previous = suggestedChart(selected);
      const keptSuggestion = widget.chart?.kind === previous.kind && widget.chart?.xPropertyId === previous.xPropertyId && widget.chart?.aggregation === "count";
      patch.chart = keptSuggestion || !widget.chart ? suggestion : { ...suggestion, kind: widget.chart.kind };
    }
    update(patch);
  }
  return <div className="db-dashboard-widget-settings"><div className="db-specific-settings">
    <label>数据源<select aria-label={names + "数据源"} value={selected?.id || ""} onChange={e => changeSource(e.target.value)}>{!selected && <option value="">原数据源不可用</option>}{sources.map(entry => <option key={entry.id} value={entry.id}>{entry.title}</option>)}</select></label>
    {widget.type === "view" && <label>已保存视图<select aria-label={names + "已保存视图"} value={views.some(v=>v.id===widget.viewId) ? widget.viewId : ""} onChange={e=>update({viewId:e.target.value || null})}><option value="">选择视图</option>{views.map(v=><option key={v.id} value={v.id}>{v.name} · {VIEW_REGISTRY[v.type].label}</option>)}</select></label>}
    <label>标题<input aria-label={names + "标题"} placeholder={widget.type === "chart" ? dashboardChartTitle(selected, widget.chart) : views.find(v=>v.id === widget.viewId)?.name || widgetNames[widget.type]} value={widget.title || ""} onChange={e=>update({title:e.target.value})}/></label>
    <label>宽度<select aria-label={names + "宽度"} value={widthOf(widget)} onChange={e=>setLayout(resizeWidget(widgets,widget.id,Number(e.target.value)))}>{["四分之一","半宽","四分之三","整行"].map((label,i)=><option key={label} value={i+1} disabled={i+1<bounds.min || i+1>bounds.max}>{label}</option>)}</select></label>
    {widget.type === "metric" && <><label>聚合<select aria-label={names+"聚合"} value={widget.aggregation || "count"} onChange={e=>update({aggregation:e.target.value})}>{Object.entries(aggregations).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label><label>数值属性<select aria-label={names+"数值属性"} value={widget.valuePropertyId || ""} onChange={e=>update({valuePropertyId:e.target.value || null})}><option value="">无</option>{selected?.properties.filter(p=>["number","converted_amount","formula","rollup"].includes(p.type)).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label></>}
    {widget.type === "list" && <label>最多记录数<input aria-label={names+"记录数"} type="number" min="1" max="100" value={widget.limit || 8} onChange={e=>update({limit:Math.max(1,Math.min(100,Number(e.target.value)||8))})}/></label>}
    <button type="button" aria-label={"上移组件 "+(index+1)} disabled={!index} onClick={()=>setLayout(moveWidgetToRow(widgets,widget.id,widgets[index-1].id,"before"))}>上移</button>
    <button type="button" aria-label={"下移组件 "+(index+1)} disabled={index===widgets.length-1} onClick={()=>setLayout(moveWidgetToRow(widgets,widget.id,widgets[index+1].id,"after"))}>下移</button>
    <button type="button" onClick={()=>setLayout(moveWidgetToRow(widgets,widget.id))}>移到新行</button>
    <button type="button" onClick={()=>{const id=crypto.randomUUID();setLayout(duplicateWidget(widgets,widget.id,id));onSelectWidget(id);}}>复制组件</button>
    <button type="button" onClick={()=>{setLayout(removeWidget(widgets,widget.id));onSelectWidget(null);}}>删除组件</button>
  </div>{widget.type === "chart" && selected && <ChartSettings source={selected} workspace={workspace} config={widget.chart || chartDefault} prefix={names+"图表"} onChange={chart=>update({chart})}/>}</div>;
}

function FilterValue({workspace, source, property, rule, label, onChange}) {
  if (relativePeriod(rule.operator)) return <small>{rule.operator === "this_week" ? "周一至周日" : "自然月"} · 按本地日期，含相交的日期范围</small>;
  if (filterHasNoValue(rule.operator)) return null;
  const choices = rule.operator === "status_group_is" ? [["todo","待办"],["inProgress","进行中"],["complete","完成"]] : ["select","status","multi_select"].includes(property?.type) ? (property.options || []).map(o=>[["contains","does_not_contain"].includes(rule.operator) ? o.name : o.id,o.name]) : null;
  if (choices) return <select aria-label={label} value={rule.value ?? ""} onChange={e=>onChange(e.target.value)}><option value="">选择值</option>{choices.map(([id,name])=><option key={id} value={id}>{name}</option>)}</select>;
  return <FilterValueInput workspace={workspace} source={source} property={property} rule={rule} label={label} onChange={onChange}/>;
}

export function DashboardFilters({source, workspace, config, onChange}) {
  const filters = config.globalFilters || [];
  const referenced = new Set(config.widgets.map(w=>w.sourceId).filter(Boolean));
  const targets = dashboardSources(workspace).filter(s=>s.id!==source.id && referenced.has(s.id));
  function change(index, patch) {
    onChange({...config,globalFilters:filters.map((entry,i)=>i===index ? {...entry,...patch} : entry)});
  }
  return <div className="db-dashboard-filters">{filters.map((rule,index)=>{
    const prefix = "仪表盘筛选 " + (index+1) + " ";
    const prop = source.properties.find(p=>p.id===rule.propertyId);
    return <fieldset key={index}><legend>条件 {index+1}</legend><div className="db-specific-settings">
      <label>{source.title}<select aria-label={prefix+"属性"} value={rule.propertyId} onChange={e=>{const p=source.properties.find(entry=>entry.id===e.target.value);change(index,{valueType:undefined,...newFilterCondition(workspace,source,p),mappings:{}});}}>{source.properties.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label>条件<FilterOperatorSelect workspace={workspace} source={source} property={prop} rule={rule} label={prefix+"操作"} onChange={patch=>change(index,{...patch,value:patch.operator === "relative_date" ? "today" : ""})} dashboard/></label>
      <FilterValue workspace={workspace} source={source} property={prop} rule={rule} label={prefix+"值"} onChange={value=>change(index,{value})}/>
      {targets.map(s=><label key={s.id}>{s.title}<select aria-label={prefix+"映射 "+s.title} value={rule.mappings?.[s.id] || ""} onChange={e=>change(index,{mappings:{...rule.mappings,[s.id]:e.target.value}})}><option value="">不对这个数据源应用</option>{s.properties.filter(p=>compatibleFields(prop,p)).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>)}
      <button type="button" onClick={()=>onChange({...config,globalFilters:filters.filter((_,i)=>i!==index)})}>移除筛选</button>
    </div></fieldset>;
  })}<button type="button" disabled={!source.properties.length} onClick={()=>onChange({...config,globalFilters:[...filters,newFilterCondition(workspace,source,source.properties[0])]})}>＋ 全局筛选</button></div>;
}

export function DashboardSettings(props) {
  return <div className="db-dashboard-settings"><AddDashboardWidgets {...props}/>{props.config.widgets.map(widget=><details key={widget.id} className="db-widget-setting"><summary>{widget.title || availableViews(props.workspace,widget.sourceId || props.source.id).find(v=>v.id===widget.viewId)?.name || widgetNames[widget.type]}</summary><WidgetSettings {...props} widget={widget}/></details>)}<details className="db-dashboard-filter-settings"><summary>仪表盘全局筛选</summary><DashboardFilters {...props}/></details></div>;
}
