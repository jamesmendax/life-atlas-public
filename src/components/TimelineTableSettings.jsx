import { CALCULATIONS, availableCalculations } from "../domain/databaseStats.js";
import { timelineLoadLimit, timelineSideColumns, TIMELINE_LOAD_LIMITS } from "../domain/timelineViewOptions.js";

export function TimelineTableSettings({ source, config, onChange }) {
  const columns = timelineSideColumns(source, config);
  const movable = columns.filter(property => property.type !== "title").map(property => property.id);
  const order = [...columns, ...source.properties.filter(property => !columns.includes(property))];
  const patch = changes => onChange({ ...config, ...changes });
  const move = (index, delta) => {
    const next = movable.slice();
    [next[index], next[index + delta]] = [next[index + delta], next[index]];
    patch({ tablePropertyIds: next });
  };
  return <>
    <label>每次加载记录数<select aria-label="时间线每次加载记录数" value={timelineLoadLimit(config.loadLimit) ?? ""} onChange={event => patch({ loadLimit: timelineLoadLimit(event.target.value) })}>
      <option value="">全部</option>{TIMELINE_LOAD_LIMITS.map(limit => <option key={limit} value={limit}>{limit}</option>)}
    </select></label>
    <label><input type="checkbox" aria-label="显示时间线侧表" checked={config.showTable === true} onChange={event => patch({ showTable: event.target.checked })} />显示侧表</label>
    {config.showTable === true && <details className="db-timeline-table-settings"><summary>侧表列与计算</summary>
      {order.map(property => {
        const index = movable.indexOf(property.id);
        const fixed = property.type === "title";
        const shown = fixed || index >= 0;
        const choices = availableCalculations(property);
        const setting = config.tableCalculations?.[property.id];
        return <div className="db-timeline-column-setting" key={property.id}><label>
          <input type="checkbox" aria-label={`侧表显示 ${property.name}`} checked={shown} disabled={fixed}
            onChange={event=>patch({tablePropertyIds:event.target.checked ? [...movable,property.id] : movable.filter(id=>id!==property.id)})}/>
          {property.name}</label>
          {shown && <select aria-label={`侧表计算 ${property.name}`} value={choices.includes(setting) ? setting : "none"}
            onChange={event => patch({ tableCalculations: { ...config.tableCalculations, [property.id]: event.target.value } })}>
            {choices.map(calculation => <option value={calculation} key={calculation}>{CALCULATIONS[calculation]}</option>)}
          </select>}
          {index >= 0 && <div className="db-timeline-column-order"><button type="button" className="db-v9-panel-icon" disabled={index === 0} aria-label={`上移侧表属性 ${property.name}`} onClick={()=>move(index,-1)}>↑</button>
            <button type="button" className="db-v9-panel-icon" disabled={index === movable.length - 1} aria-label={`下移侧表属性 ${property.name}`} onClick={()=>move(index,1)}>↓</button></div>}
        </div>;
      })}
    </details>}
  </>;
}
