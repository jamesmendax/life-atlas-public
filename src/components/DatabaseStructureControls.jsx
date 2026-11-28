import { useId, useMemo, useState } from "react";
import IconChevronRight from "@tabler/icons-react/dist/esm/icons/IconChevronRight.mjs";
import { itemDisplayTitle } from "../domain/database.js";
import { DEPENDENCY_MODES, normalizeDependencyConfig } from "../domain/databaseDependencies.js";
import { databaseRecords, subitemRows, subitemViewConfig } from "../domain/databaseSubitems.js";
import "./databaseStructure.css";

export function SubitemSettings({ view, onChange }) {
  const config = subitemViewConfig(view);
  const rows = view.type === "table" || view.type === "list";
  return <div className="db-structure-fields">
    {view.type !== "calendar" && <label>子项布局<select value={config.display} onChange={(event) => onChange({ ...config, display: event.target.value })}>
      <option value="nested">{rows ? "可折叠层级" : "在父卡片内显示"}</option><option value="flat">平铺</option>
    </select></label>}
    <label>显示记录<select value={config.filter} onChange={(event) => onChange({ ...config, filter: event.target.value })}>
      <option value="all">父项和子项</option><option value="parents">仅父项</option>{rows && <option value="children">仅子项</option>}
    </select></label>
  </div>;
}

export function DependencySettings({ source, onChange }) {
  const config = normalizeDependencyConfig(source);
  const dateProperties = source.properties.filter((property) => property.type === "date");
  return <div className="db-structure-fields">
    <label>排期日期<select value={config.datePropertyId || ""} onChange={(event) => onChange({ ...config, datePropertyId: event.target.value || null })}>
      <option value="">选择日期属性</option>{dateProperties.map((property) => <option value={property.id} key={property.id}>{property.name}</option>)}
    </select></label>
    {!dateProperties.length && <p>先在数据源中添加日期属性，即可开启依赖排期。</p>}
    <label>排期方式<select value={config.mode} disabled={!config.datePropertyId} onChange={(event) => onChange({ ...config, mode: event.target.value })}>
      {Object.entries(DEPENDENCY_MODES).map(([id, label]) => <option value={id} key={id}>{label}</option>)}
    </select></label>
    <label className="db-structure-check"><input type="checkbox" disabled={!config.datePropertyId || config.mode === "none"} checked={config.skipWeekends} onChange={(event) => onChange({ ...config, skipWeekends: event.target.checked })} />自动排期跳过周末</label>
    <p>在表格的记录菜单中选择前置记录。手工修改前置日期后，安排其后续记录。</p>
  </div>;
}

export function RecordStructureForm({ kind, workspace, source, item, onApply, onClose }) {
  const dependencies = kind === "dependencies";
  const [parentId, setParentId] = useState(item.parentItemId || "");
  const [ids, setIds] = useState(() => new Set(item.dependencyIds || []));
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const errorId = useId();
  const choices = useMemo(() => {
    const records = databaseRecords(workspace);
    const items = (workspace.databaseItems || []).filter((entry) => entry.sourceId === source.id);
    const excluded = new Set([item.id]);
    if (!dependencies) {
      const children = new Map();
      for (const entry of items) {
        if (!children.has(entry.parentItemId)) children.set(entry.parentItemId, []);
        children.get(entry.parentItemId).push(entry.id);
      }
      for (const id of excluded) for (const child of children.get(id) || []) excluded.add(child);
    }
    return items.filter((entry) => !excluded.has(entry.id) && records.available(entry) && (dependencies || !records.pages.get(entry.pageId)?.settings?.locked))
      .map((entry) => ({ id: entry.id, title: itemDisplayTitle(workspace, source, entry) }));
  }, [dependencies, item.id, source, workspace]);
  const visible = dependencies ? choices.filter((entry) => entry.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) : choices;
  const unavailable = dependencies ? [...ids].filter((id) => !choices.some((entry) => entry.id === id)) : [];
  const toggle = (id) => setIds((current) => {
    const next = new Set(current);
    if (!next.delete(id)) next.add(id);
    return next;
  });
  const save = (event) => {
    event.preventDefault();
    try {
      if (onApply(dependencies ? [...ids] : parentId || null) === false) {
        setError("无法保存这次修改。请检查记录状态和排期设置。");
        return;
      }
      onClose(true);
    } catch (failure) { setError(failure.message); }
  };
  return <form className="db-v9-panel-body db-structure-fields" onSubmit={save} aria-describedby={error ? errorId : undefined}>
    {dependencies ? <>
      <label>搜索前置记录<input type="search" data-popover-initial value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      <div className="db-structure-choices" role="group" aria-label="前置记录">
        {visible.map((entry) => <label className="db-structure-check" key={entry.id}><input type="checkbox" checked={ids.has(entry.id)} onChange={() => toggle(entry.id)} />{entry.title}</label>)}
        {!visible.length && <p>没有匹配的记录。</p>}
        {unavailable.map((id) => <label className="db-structure-check" key={id}><input type="checkbox" checked onChange={() => toggle(id)} />不可用的前置记录</label>)}
      </div>
    </> : <label>父项<select data-popover-initial value={parentId} onChange={(event) => setParentId(event.target.value)}>
      <option value="">无父项</option>{choices.map((entry) => <option value={entry.id} key={entry.id}>{entry.title}</option>)}
      {parentId && !choices.some((entry) => entry.id === parentId) && <option value={parentId} disabled>当前父项不可用</option>}
    </select></label>}
    {error && <p role="alert" id={errorId}>{error}</p>}
    <div className="db-structure-actions"><button type="button" onClick={() => onClose(true)}>取消</button><button type="submit">保存</button></div>
  </form>;
}

export function SubitemToggle({ title, collapsed, onToggle }) {
  return <button className="db-structure-toggle" type="button" aria-label={`${collapsed ? "展开" : "折叠"} ${title} 的子项`} aria-expanded={!collapsed} onClick={onToggle}>
    <IconChevronRight size={14} aria-hidden="true" />
  </button>;
}

export function cardSubitemIndex(items, display) {
  if (display === "flat") return null;
  const unique = [...new Map(items.map((item) => [item.id, item])).values()];
  const cards = new Map();
  let children;
  for (const { item, depth } of subitemRows(unique, display)) {
    if (depth === 0) {
      children = [];
      cards.set(item.id, children);
    } else children.push({ item, depth });
  }
  return cards;
}

export function cardSubitemRows(items, index) {
  return items.filter((item) => !index || index.has(item.id)).map((item) => ({ item, subitems: index?.get(item.id) }));
}

export function CardSubitems({ workspace, source, children, onOpenItemPage }) {
  if (!children?.length) return null;
  return <details className="db-card-subitems">
    <summary>{children.length} 个子项</summary>
    <div>{children.map(({ item, depth }) => <button type="button" key={item.id} data-subitem-id={item.id} style={{ paddingInlineStart: `${Math.min(depth, 8) * 12}px` }} onClick={(event) => onOpenItemPage?.(item.pageId, event.currentTarget)}>{itemDisplayTitle(workspace, source, item)}</button>)}</div>
  </details>;
}
