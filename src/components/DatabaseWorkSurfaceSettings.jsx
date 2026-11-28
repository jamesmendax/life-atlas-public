import { dayMs, scaleWindow } from "../domain/databaseDateRange.js";
import { boardCardAppearance } from "../domain/cardPreview.js";
import { surfaceDateChoices, surfaceDateProperty } from "../domain/workSurfaceDates.js";
import { LayoutChoice } from "./GallerySettings.jsx";
import { TimelineTableSettings } from "./TimelineTableSettings.jsx";

export function BoardCardSettings({ source, config, onChange }) {
  const appearance = boardCardAppearance(config);
  const files = source.properties.filter(property => property.type === "files");
  return <div className="db-gallery-settings">
    <LayoutChoice label="看板卡片大小" value={appearance.cardSize} choices={[{value:"small",label:"小"},{value:"medium",label:"中"},{value:"large",label:"大"}]} onChange={cardSize => onChange({...appearance,cardSize})}/>
    <LayoutChoice label="看板卡片预览" value={appearance.preview.kind} choices={[{value:"none",label:"无"},{value:"page-cover",label:"页面封面"},{value:"page-content",label:"页面内容"},{value:"files-property",label:"附件属性"}]} onChange={kind => onChange({...appearance,preview:{...appearance.preview,kind}})}/>
    {appearance.preview.kind === "files-property" && <LayoutChoice label="看板附件属性" value={appearance.preview.propertyId || ""} choices={[{value:"",label:"选择"},...files.map(property=>({value:property.id,label:property.name}))]} onChange={propertyId=>onChange({...appearance,preview:{...appearance.preview,propertyId:propertyId || null}})}/>}
    {appearance.preview.kind !== "none" && <button type="button" className="db-v9-menu-row db-gallery-fit" role="switch" aria-label="适应看板媒体" aria-checked={appearance.imageFit === "contain"} onClick={()=>onChange({...appearance,imageFit:appearance.imageFit === "contain" ? "cover" : "contain"})}><span>适应媒体</span><i aria-hidden="true"/></button>}
  </div>;
}

function dateOptions(dates, selection) {
  return <>{selection && !dates.some(property => property.id === selection) &&
    <option value={selection} disabled>已选日期属性不可用</option>}
    {dates.map(property => <option key={property.id} value={property.id}>{property.name}</option>)}</>;
}

export function CalendarSettings({ workspace, source, config, onChange }) {
  const dates = surfaceDateChoices(workspace, source, [config.datePropertyId]);
  return <div className="db-specific-settings"><strong>日历</strong>
    <label>日期属性<select aria-label="日历日期属性" value={config.datePropertyId || ""} onChange={(event)=>onChange({...config,datePropertyId:event.target.value || null})}><option value="">自动</option>{dateOptions(dates, config.datePropertyId)}</select></label>
    <label>模式<select aria-label="日历模式" value={config.mode} onChange={(event)=>onChange({...config,mode:event.target.value})}><option value="month">月</option><option value="week">周</option></select></label>
    <label>每周开始日<select aria-label="日历每周开始日" value={config.startOfWeek} onChange={(event)=>onChange({...config,startOfWeek:Number(event.target.value)})}><option value={1}>周一</option><option value={0}>周日</option></select></label>
    <label><input aria-label="显示周末" type="checkbox" checked={config.showWeekends !== false} onChange={(event)=>onChange({...config,showWeekends:event.target.checked})} />显示周末</label>
  </div>;
}
export function TimelineSettings({ workspace, source, config, onChange }) {
  const dates = surfaceDateChoices(workspace, source, [config.datePropertyId, config.endDatePropertyId]);
  const startId = config.datePropertyId || surfaceDateProperty(source)?.id;
  return <div className="db-specific-settings"><strong>时间线</strong>
    <label>开始日期属性<select aria-label="时间线日期属性" value={config.datePropertyId || ""} onChange={event=>{ const id=event.target.value || null; onChange({...config,datePropertyId:id,endDatePropertyId:(id || surfaceDateProperty(source)?.id)===config.endDatePropertyId ? null : config.endDatePropertyId}); }}><option value="">第一个日期属性</option>{dateOptions(dates, config.datePropertyId)}</select></label>
    <label>结束日期属性<select aria-label="时间线结束日期属性" value={config.endDatePropertyId || ""} onChange={event=>onChange({...config,endDatePropertyId:event.target.value || null})}><option value="">使用开始属性的日期范围</option>{dateOptions(dates.filter(property => property.id !== startId), config.endDatePropertyId)}</select></label>
    <label>比例<select aria-label="时间线设置比例" value={config.scale} onChange={(event)=>onChange({ ...config, scale:event.target.value, ...(config.windowStart && config.windowEnd ? scaleWindow(event.target.value,(dayMs(config.windowStart)+dayMs(config.windowEnd))/2) : {windowStart:null,windowEnd:null}) })}><option value="hour">小时</option><option value="day">日</option><option value="week">周</option><option value="month">月</option><option value="quarter">季度</option><option value="year">年</option></select></label>
    <label>窗口开始<input aria-label="时间线窗口开始" type="date" value={config.windowStart || ""} onChange={(event)=>onChange({...config,windowStart:event.target.value || null})} /></label>
    <label>窗口结束<input aria-label="时间线窗口结束" type="date" value={config.windowEnd || ""} onChange={(event)=>onChange({...config,windowEnd:event.target.value || null})} /></label>
    <TimelineTableSettings source={source} config={config} onChange={onChange} />
  </div>;
}
export { GallerySettings } from "./GallerySettings.jsx";
