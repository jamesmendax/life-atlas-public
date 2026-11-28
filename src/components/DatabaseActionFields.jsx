import { itemDisplayTitle, relationDefinition } from "../domain/database.js";
import { normalizeIdValues } from "../domain/databaseProperties.js";

const literalTypes = ["text", "number", "checkbox", "select", "status", "date", "url", "email", "phone"];
const editTypes = [...literalTypes, "title", "multi_select", "relation", "people", "files", "place"];

function initialValue(property) {
  if (property.type === "checkbox") return false;
  if (["select", "status"].includes(property.type)) return property.options?.[0]?.id || "";
  return "";
}

function LiteralField({ property, value, onChange, editing, workspace, target }) {
  const label = `${editing ? "编辑" : "预填"}${property.name}`;
  if (["multi_select", "relation", "people", "files"].includes(property.type)) {
    let options = property.options || [];
    if (property.type === "relation") {
      const related = workspace.dataSources.find(entry => entry.id === relationDefinition(workspace, target.id, property)?.targetSourceId);
      const activePages = new Set(workspace.pages.filter(page => !page.trashedAt).map(page => page.id));
      options = workspace.databaseItems.filter(item => item.sourceId === related?.id && !item.trashedAt && activePages.has(item.pageId))
        .map(item => ({ id: item.id, name: itemDisplayTitle(workspace, related, item) }));
    }
    if (property.type === "people") options = (workspace.people || []).filter(person => !person.trashedAt).map(person => ({ id: person.id, name: person.displayName }));
    if (property.type === "files") options = (workspace.attachments || []).filter(file => !file.trashedAt);
    const single = property.type === "relation" && property.config?.relationLimit === 1;
    const ids = normalizeIdValues(value);
    return <select aria-label={label} multiple={!single} value={single ? ids[0] || "" : ids}
      onChange={event => onChange(Array.from(event.target.selectedOptions, option => option.value).filter(Boolean))}>
      {single && <option value="">清空</option>}{options.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
    </select>;
  }
  if (property.type === "place") return <span>{[["name", "名称"], ["address", "地址"], ["latitude", "纬度"], ["longitude", "经度"]].map(([key, name]) =>
    <input key={key} aria-label={`${label} · ${name}`} placeholder={name} value={value?.[key] ?? ""} onChange={event => onChange({ ...value, [key]: event.target.value })} />)}</span>;
  if (["select", "status"].includes(property.type)) return <select aria-label={label} value={value || ""} onChange={event => onChange(event.target.value)}>
    <option value="">清空</option>{property.options?.map(option => <option value={option.id} key={option.id}>{option.name}</option>)}
  </select>;
  if (property.type === "checkbox") return <input aria-label={label} type="checkbox" checked={Boolean(value)} onChange={event => onChange(event.target.checked)} />;
  return <input aria-label={label} type={["number", "date", "email", "url"].includes(property.type) ? property.type : "text"} step={property.type === "number" ? "any" : undefined}
    value={typeof value === "object" ? value?.start || "" : value ?? ""} onChange={event => onChange(event.target.value)} />;
}

export function DatabaseActionFields({ workspace, source, action, onChange }) {
  const draft = action || { type: "createRecord", targetSourceId: "" };
  const editing = draft.type === "updateRecord";
  const change = patch => onChange({ ...draft, ...patch });
  const targets = (workspace?.dataSources || []).filter(entry => !entry.trashedAt);
  const target = targets.find(entry => entry.id === draft.targetSourceId);
  const links = target?.properties.filter(property => property.type === "relation") || [];
  const targetLink = links.find(property => property.id === draft.targetRelationPropertyId);
  const linkSourceId = relationDefinition(workspace, target?.id, targetLink)?.targetSourceId;
  const sourceLinks = (source?.properties || []).filter(property => property.type === "relation" && relationDefinition(workspace, source.id, property)?.targetSourceId === linkSourceId);
  const defaults = draft.values || {};
  const allowedTypes = editing ? editTypes : literalTypes;
  const available = (target?.properties || []).filter(property => allowedTypes.includes(property.type) && !Object.hasOwn(defaults, property.id));
  const editLinks = (source?.properties || []).filter(property => property.type === "relation" && targets.some(entry => entry.id === relationDefinition(workspace, source.id, property)?.targetSourceId));
  return <fieldset className="db-action-fields"><legend>记录动作</legend>
    <label>动作类型<select aria-label="动作类型" value={draft.type} onChange={event => onChange(
      event.target.value === "updateRecord" ? { type: "updateRecord", targetSourceId: source.id, values: {} } : { type: "createRecord", targetSourceId: "" }
    )}><option value="createRecord">创建记录</option><option value="updateRecord">编辑记录</option></select></label>
    {editing ? <label>编辑目标<select aria-label="编辑目标" value={draft.sourceRelationPropertyId || ""} onChange={event => {
      const link = editLinks.find(property => property.id === event.target.value);
      change({ sourceRelationPropertyId: event.target.value, targetSourceId: link ? relationDefinition(workspace, source.id, link).targetSourceId : source.id, values: {} });
    }}><option value="">当前记录</option>{editLinks.map(property => <option key={property.id} value={property.id}>关联记录 · {property.name}</option>)}</select></label> : <label>目标数据库<select aria-label="动作目标数据库" value={draft.targetSourceId || ""} onChange={event => change({ targetSourceId: event.target.value, templateId: "", targetRelationPropertyId: "", sourceRelationPropertyId: "", values: {} })}>
      <option value="">选择数据库</option>{targets.map(entry => <option key={entry.id} value={entry.id}>{entry.title}</option>)}
    </select></label>}
    {target && !editing && <>
      <label>新记录标题<input aria-label="新记录标题" value={draft.title || ""} placeholder="可用 {title} 引用当前记录名称" onChange={event => change({ title: event.target.value })} /></label>
      <label>记录模板<select aria-label="动作记录模板" value={draft.templateId || ""} onChange={event => change({ templateId: event.target.value })}>
        <option value="">空白记录</option>{(workspace.databaseTemplates || []).filter(entry => entry.sourceId === target.id).map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
      </select></label>
      <label>填入关联字段<select aria-label="目标关联字段" value={draft.targetRelationPropertyId || ""} onChange={event => {
        const property = links.find(entry => entry.id === event.target.value);
        const targetId = relationDefinition(workspace, target.id, property)?.targetSourceId;
        const first = source?.properties?.find(entry => entry.type === "relation" && relationDefinition(workspace, source.id, entry)?.targetSourceId === targetId);
        change({ targetRelationPropertyId: event.target.value, sourceRelationPropertyId: targetId && targetId !== source?.id ? first?.id || "" : "" });
      }}>
        <option value="">无需关联</option>{links.filter(property => {
          const targetId = relationDefinition(workspace, target.id, property)?.targetSourceId;
          return targetId && (targetId === source?.id || source?.properties.some(entry => entry.type === "relation" && relationDefinition(workspace, source.id, entry)?.targetSourceId === targetId));
        }).map(property => <option key={property.id} value={property.id}>{property.name}</option>)}
      </select></label>
      {targetLink && <label>关联来源<select aria-label="关联来源" value={draft.sourceRelationPropertyId || ""} onChange={event => change({ sourceRelationPropertyId: event.target.value })}>
        {linkSourceId === source?.id && <option value="">当前记录</option>}
        {sourceLinks.map(property => <option key={property.id} value={property.id}>{property.name}</option>)}
      </select></label>}
    </>}
    {target && <>
      {Object.entries(defaults).map(([id, value]) => {
        const property = target.properties.find(entry => entry.id === id);
        return <div key={id} className="db-action-default"><label>{property?.name || id}{property && allowedTypes.includes(property.type) && <LiteralField workspace={workspace} target={target} editing={editing} property={property} value={value} onChange={next => change({ values: { ...defaults, [id]: next } })} />}</label>
          <button type="button" aria-label={`移除${editing ? "编辑" : "预填"}${property?.name || id}`} onClick={() => {
            const next = { ...defaults }; delete next[id]; change({ values: next });
          }}>移除</button></div>;
      })}
      {available.length > 0 && <label>{editing ? "编辑字段" : "预填字段"}<select aria-label={editing ? "添加编辑字段" : "添加预填字段"} value="" onChange={event => {
        const property = available.find(entry => entry.id === event.target.value);
        if (property) change({ values: { ...defaults, [property.id]: initialValue(property) } });
      }}><option value="">选择字段</option>{available.map(property => <option key={property.id} value={property.id}>{property.name}</option>)}</select></label>}
    </>}
  </fieldset>;
}
