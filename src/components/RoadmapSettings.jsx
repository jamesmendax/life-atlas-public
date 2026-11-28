import { ROADMAP_DEFAULTS } from "../domain/roadmapLayout.js";

const SHAPES = [["diamond", "菱形"], ["circle", "圆"], ["ring", "圆环"], ["square", "方块"], ["major", "重大节点"]];

export function RoadmapSettings({ source, config = {}, onChange }) {
  const settings = { ...ROADMAP_DEFAULTS, ...config };
  const properties = source.properties || [];
  const change = (patch) => onChange?.({ ...settings, ...patch });
  const propertyField = (label, key, candidates) => <label>{label}<select aria-label={`时间脉络${label}`} value={settings[key] || ""} onChange={(event) => change({ [key]: event.target.value || null })}><option value="">不设置</option>{candidates.map((property) => <option key={property.id} value={property.id}>{property.name}</option>)}</select></label>;
  const markerProperty = properties.find((property) => property.id === settings.markerPropertyId && property.type === "select");
  return <div className="db-specific-settings db-roadmap-settings"><strong>时间脉络</strong>
    {propertyField("日期属性", "datePropertyId", properties.filter((property) => property.type === "date"))}
    {propertyField("颜色属性", "colorPropertyId", properties.filter((property) => ["select", "status"].includes(property.type)))}
    {propertyField("标记属性", "markerPropertyId", properties.filter((property) => property.type === "select"))}
    {markerProperty?.options?.map((option) => <label className="db-roadmap-marker-setting" key={option.id}>{option.name}<select aria-label={`${option.name} 标记形状`} value={settings.markerMap?.[option.id] || "diamond"} onChange={(event) => change({ markerMap: { ...settings.markerMap, [option.id]: event.target.value } })}>{SHAPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>)}
    {propertyField("副标题属性", "subtitlePropertyId", properties)}
    {propertyField("进度属性", "progressPropertyId", properties.filter((property) => ["number", "rollup", "formula"].includes(property.type)))}
    <label>刻度<select aria-label="时间脉络刻度" value={settings.scale} onChange={(event) => change({ scale: event.target.value })}>{[["auto", "自动"], ["week", "周"], ["month", "月"], ["quarter", "季度"], ["year", "年"]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    <label>密度<select aria-label="时间脉络密度" value={settings.density} onChange={(event) => change({ density: event.target.value })}><option value="comfortable">舒适</option><option value="compact">紧凑</option></select></label>
    <label><input type="checkbox" aria-label="时间脉络显示今天" checked={settings.showToday !== false} onChange={(event) => change({ showToday: event.target.checked })}/>显示今天</label>
  </div>;
}
