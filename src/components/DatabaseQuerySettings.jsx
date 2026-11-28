import { dateGroupInterval, groupOptionsInDisplayOrder, groupViewItems, groupViewLabel, itemDisplayTitle, relationDefinition, UNASSIGNED_GROUP_KEY } from "../domain/database.js";
import { RELATIVE_DATE_PERIODS, RELATIVE_DATE_TARGETS, relativeDateTarget } from "../domain/databaseDateRange.js";
import { computedListTextOptions, filterGroup, filterHasNoValue, isComputedFilterProperty, isComputedNumberEquality, isDateComparison, isDateFilterProperty, isEqualityFilter, isNumberComparison, isNumberFilterProperty, numericFilterValue } from "../domain/databaseFilters.js";
import { computedPropertyKinds } from "../domain/computedPropertyKinds.js";
import { useI18n } from "../i18n/workspaceRuntime.js";

const GROUPABLE = new Set(["select", "status", "multi_select", "people", "date"]);
const NUMBER_OP_IDS = ["equals", "not_equals", "greater_than", "greater_than_or_equal", "less_than", "less_than_or_equal", "is_empty", "is_not_empty"];
const TEXT_OP_IDS = ["contains", "not_contains", "equals", "not_equals", "starts_with", "is_empty", "is_not_empty"];
const CHECKBOX_OP_IDS = ["checked", "unchecked"];
const DATE_OP_IDS = ["equals", "not_equals", "before", "after", "on_or_before", "on_or_after"];

function operatorsFor(workspace, source, property, rule, t) {
  const opPair = (id, key = `dbx.filter.op.${id}`) => [id, t(key)];
  const numberOperators = NUMBER_OP_IDS.map((id) => opPair(id));
  const textOperators = TEXT_OP_IDS.map((id) => opPair(id));
  const checkboxOperators = CHECKBOX_OP_IDS.map((id) => opPair(id));
  const dateOperators = DATE_OP_IDS.map((id) => [id, id === "equals" ? t("dbx.filter.op.date_equals") : id === "not_equals" ? t("dbx.filter.op.date_not_equals") : t(`dbx.filter.op.${id}`)]);
  const computedDateOperators = dateOperators.map(([id, label]) => [isEqualityFilter(id) ? `date_${id}` : id, label]);
  const emptyOperators = ["is_empty", "is_not_empty"].map((id) => opPair(id));
  const computedListOps = computedListTextOptions.map(([id, fallback]) => [id, t(`dbx.filter.op.${id}`) === `dbx.filter.op.${id}` ? fallback : t(`dbx.filter.op.${id}`)]);
  const computedOperators = [...checkboxOperators, opPair("any_checked"), opPair("any_unchecked"), ...computedListOps, opPair("relative_date")];
  const numericComputedOperators = [...numberOperators, ...textOperators.flatMap(([operator, label]) => {
    if (isEqualityFilter(operator)) return [[`text_${operator}`, t("dbx.filter.op.textSuffix", { label })]];
    return numberOperators.some(([id]) => id === operator) ? [] : [[operator, label]];
  })];
  const type = property?.type;
  if (isComputedFilterProperty(property)) {
    const kinds = computedPropertyKinds(workspace, source, property);
    const dateOnly = isDateFilterProperty(property) || (kinds.size === 1 && kinds.has("date"));
    if (dateOnly && rule?.valueType !== "text" && !isNumberComparison(rule?.operator) && !isComputedNumberEquality(property, rule)) {
      return [...computedDateOperators, opPair("relative_date"), ...emptyOperators];
    }
    const numeric = isNumberComparison(rule?.operator) || isComputedNumberEquality(property, rule) ||
      isNumberFilterProperty(property) || kinds.has("number") || !kinds.size;
    const date = kinds.has("date") || !kinds.size || rule?.valueType === "date" || isDateComparison(rule?.operator);
    return [...(numeric ? numericComputedOperators : textOperators), ...(date ? computedDateOperators : []), ...computedOperators];
  }
  if (isNumberFilterProperty(property)) return numberOperators;
  if (isDateFilterProperty(property)) return [...dateOperators, opPair("relative_date"), ...emptyOperators];
  if (type === "checkbox") return checkboxOperators;
  if (type === "status") return [opPair("equals", "dbx.filter.op.is"), opPair("not_equals", "dbx.filter.op.is_not"), opPair("status_group_is"), ...emptyOperators];
  if (["select", "status"].includes(type)) return [opPair("equals", "dbx.filter.op.is"), opPair("not_equals", "dbx.filter.op.is_not"), ...emptyOperators];
  if (type === "relation") return [opPair("equals", "dbx.filter.op.rel_contains"), opPair("not_equals", "dbx.filter.op.rel_not_contains"), opPair("contains", "dbx.filter.op.rel_contains_text"), opPair("does_not_contain", "dbx.filter.op.rel_not_contains_text"), ...emptyOperators];
  if (["people", "files", "multi_select"].includes(type)) return [opPair("contains"), opPair("does_not_contain"), ...emptyOperators];
  return textOperators;
}

function filterSelection(property, selection, options) {
  if (selection.startsWith("date_")) return { operator: selection.slice(5), valueType: "date" };
  if (selection.startsWith("text_")) return { operator: selection.slice(5), valueType: "text" };
  let valueType;
  if (isComputedFilterProperty(property)) {
    if (isDateComparison(selection)) valueType = "date";
    else if (options.some(([id]) => id === `text_${selection}`)) valueType = "number";
    else if (isEqualityFilter(selection)) valueType = "text";
  }
  return { operator: selection, valueType };
}

export function newFilterCondition(workspace, source, property) {
  const options = operatorsFor(workspace, source, property, undefined, (k) => k);
  return { propertyId: property?.id || "", ...filterSelection(property, options[0][0], options), value: "" };
}

export function FilterOperatorSelect({ workspace, source, property, rule, label, onChange, dashboard = false }) {
  const { t } = useI18n();
  const available = operatorsFor(workspace, source, property, rule, t);
  const options = dashboard && property?.type === "date" ? [["this_week", t("dbx.filter.op.this_week")], ["this_month", t("dbx.filter.op.this_month")], ...available] : available;
  const textOperator = `text_${rule.operator}`;
  const dateOperator = `date_${rule.operator}`;
  let current = rule.operator;
  if (options.some(([id]) => id === dateOperator) && (rule.valueType === "date" || !options.some(([id]) => id === rule.operator))) current = dateOperator;
  else if (options.some(([id]) => id === textOperator) && !isComputedNumberEquality(property, rule)) current = textOperator;
  return <select aria-label={label} value={current || available[0][0]} onChange={event => {
    onChange(filterSelection(property, event.target.value, options));
  }}>
    {current && !options.some(([id]) => id === current) && <option value={current}>{current}</option>}
    {options.map(([id, text]) => <option key={id} value={id}>{text}</option>)}
  </select>;
}

function filterInputType(property, rule, workspace, source) {
  if (isNumberComparison(rule.operator) || isComputedNumberEquality(property, rule) || (!isComputedFilterProperty(property) && isNumberFilterProperty(property))) return "number";
  if (rule.valueType === "text") return "text";
  if (isDateFilterProperty(property) || rule.valueType === "date" || isDateComparison(rule.operator)) return "date";
  if (property?.type === "formula" && isEqualityFilter(rule.operator)) {
    const kinds = computedPropertyKinds(workspace, source, property);
    if (kinds.size === 1 && kinds.has("date")) return "date";
  }
  return "text";
}

export function FilterValueInput({ workspace, source, property, rule, onChange, label }) {
  const { t } = useI18n();
  if (rule.operator === "relative_date") return <select aria-label={label} value={rule.value ?? ""} onChange={event => onChange(event.target.value)}>
    <option value="" disabled>{t("dbx.filter.chooseRelPlaceholder")}</option>
    {Object.entries(RELATIVE_DATE_PERIODS).map(([id, name]) => <option value={id} key={id}>{name}</option>)}
  </select>;
  const type = filterInputType(property, rule, workspace, source);
  return <input aria-label={label} type={type} step={type === "number" ? "any" : undefined} value={rule.value ?? ""} onChange={event => {
    const value = event.target.value;
    onChange(type === "number" ? numericFilterValue(value) ?? "" : value);
  }} />;
}

function filterEditorNode(filter) {
  const group = filterGroup(filter);
  if (group) return { kind:"group", op:group.op, children:group.children.map(filterEditorNode) };
  return filter ? { ...filter, kind:"condition" } : { kind:"group", op:"and", children:[] };
}

export function normalizeRoot(filter) {
  const node = filterEditorNode(filter);
  return node.kind === "group" ? node : { kind:"group", op:"and", children:[node] };
}
const replaceAtPath = (root, path, next) => {
  if (!path.length) return next;
  const [index, ...rest] = path;
  return { ...root, children: root.children.map((child, childIndex) => childIndex === index ? replaceAtPath(child, rest, next) : child) };
};
const removeAtPath = (root, path) => {
  const index = path.at(-1);
  const parentPath = path.slice(0,-1);
  const parent = parentPath.reduce((node, childIndex) => node.children[childIndex], root);
  return replaceAtPath(root, parentPath, { ...parent, children: parent.children.filter((_, childIndex) => childIndex !== index) });
};

function ConditionValue({ workspace, source, property, node, onChange, label }) {
  const { t } = useI18n();
  if (!property || filterHasNoValue(node.operator)) return null;
  const value = node.value ?? "";
  if (property.type === "relation" && ["equals", "not_equals"].includes(node.operator)) {
    const targetId = relationDefinition(workspace, source.id, property)?.targetSourceId;
    const target = workspace.dataSources?.find(entry => entry.id === targetId);
    const trashedPages = new Set(workspace.pages?.filter(page => page.trashedAt).map(page => page.id));
    const records = (workspace.databaseItems || []).filter(item => item.sourceId === targetId && !trashedPages.has(item.pageId));
    return <select aria-label={label} value={value} onChange={event => onChange(event.target.value)}>
      <option value="">{t("dbx.filter.chooseRelation")}</option>
      {value && !records.some(item => item.id === value) && <option value={value}>{t("dbx.filter.relationMissing")}</option>}
      {records.map(item => <option key={item.id} value={item.id}>{itemDisplayTitle(workspace, target, item)}</option>)}
    </select>;
  }
  if (property.type === "status" && node.operator === "status_group_is") return <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}><option value="">{t("common.none")}</option><option value="todo">{t("dbx.statusGroup.todo")}</option><option value="inProgress">{t("dbx.statusGroup.inProgress")}</option><option value="complete">{t("dbx.statusGroup.complete")}</option></select>;
  if (["select","status","multi_select"].includes(property.type)) return <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}><option value="">{t("common.none")}</option>{property.options?.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select>;
  if (property.type === "people") return <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}><option value="">{t("common.none")}</option>{workspace.people?.map((person) => <option key={person.id} value={person.id}>{person.displayName}</option>)}</select>;
  return <FilterValueInput workspace={workspace} source={source} property={property} rule={node} label={label} onChange={onChange} />;
}
function FilterNode({ workspace, source, node, path, root, onRootChange }) {
  const { t } = useI18n();
  const pathLabel = path.length ? path.join(".") : "root";
  if (node.kind === "condition") {
    const property = source.properties.find((entry) => entry.id === node.propertyId) || source.properties[0];
    const setNode = (patch) => onRootChange(replaceAtPath(root, path, { ...node, ...patch }));
    return <div className="db-filter-condition" data-filter-path={pathLabel}>
      <select aria-label={t("dbx.filter.propAria", { path: pathLabel })} value={property?.id || ""} onChange={(event) => {
        const next = source.properties.find(entry => entry.id === event.target.value);
        setNode({ valueType:undefined, dateTarget:undefined, ...newFilterCondition(workspace, source, next) });
      }}>{source.properties.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select>
      <FilterOperatorSelect workspace={workspace} source={source} property={property} rule={node} label={t("dbx.filter.opAria", { path: pathLabel })} onChange={next => {
        let value = node.value;
        if (next.operator === "relative_date") value = "today";
        else if (node.operator === "relative_date" || property?.type === "relation") value = "";
        else if (filterInputType(property, next, workspace, source) === "number") value = numericFilterValue(value) ?? "";
        else if (filterInputType(property, node, workspace, source) === "number") value = String(value ?? "");
        setNode({ ...next, value, dateTarget:undefined });
      }} />
      {node.operator === "relative_date" && <select aria-label={t("dbx.filter.dateTargetAria", { path: pathLabel })} value={relativeDateTarget(node.value, node.dateTarget)} onChange={event => setNode({ dateTarget:event.target.value })}>
        {Object.entries(RELATIVE_DATE_TARGETS).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
      </select>}
      <ConditionValue workspace={workspace} source={source} property={property} node={node} label={t("dbx.filter.valAria", { path: pathLabel })} onChange={(value) => setNode({ value })} />
      <button type="button" aria-label={t("dbx.filter.delAria", { path: pathLabel })} onClick={() => onRootChange(removeAtPath(root,path))}>×</button>
    </div>;
  }
  const append = (child) => onRootChange(replaceAtPath(root, path, { ...node, children:[...(node.children || []), child] }));
  return <fieldset className="db-filter-group" data-filter-path={pathLabel}><legend>{t("dbx.filter.groupLegend")}</legend>
    <label>{t("dbx.filter.logicLabel")}<select aria-label={t("dbx.filter.logicAria", { path: pathLabel })} value={node.op || "and"} onChange={(event) => onRootChange(replaceAtPath(root,path,{...node,op:event.target.value}))}><option value="and">AND</option><option value="or">OR</option></select></label>
    {(node.children || []).map((child,index) => <FilterNode key={index} workspace={workspace} source={source} node={child} path={[...path,index]} root={root} onRootChange={onRootChange} />)}
    <div className="db-filter-actions"><button type="button" onClick={() => append({ kind:"condition", ...newFilterCondition(workspace, source, source.properties[0]) })}>{t("dbx.filter.addCondition")}</button><button type="button" onClick={() => append({ kind:"group", op:"and", children:[] })}>{t("dbx.filter.addGroup")}</button>{path.length > 0 && <button type="button" onClick={() => onRootChange(removeAtPath(root,path))}>{t("dbx.filter.delGroup")}</button>}</div>
  </fieldset>;
}

export function DatabaseQuerySettings({ workspace, source, view, onUpdateView, section = "all" }) {
  const { t } = useI18n();
  const root = normalizeRoot(view.filter);
  const sorts = Array.isArray(view.sorts) ? view.sorts : [];
  const grouping = view.grouping || (view.groupBy ? { primaryPropertyId:view.groupBy, secondaryPropertyId:null, hiddenGroupKeys:[], order:[], showEmpty:true } : { primaryPropertyId:null, secondaryPropertyId:null, hiddenGroupKeys:[], order:[], showEmpty:true });
  const groupable = source.properties.filter((entry) => GROUPABLE.has(entry.type));
  const secondaryProperties = groupable.filter(entry => entry.type !== "date" && entry.id !== grouping.primaryPropertyId);
  const primary = source.properties.find((entry) => entry.id === grouping.primaryPropertyId);
  const dateGroups = primary?.type === "date";
  const updateGrouping = (patch) => {
    const next = { ...grouping, ...patch };
    onUpdateView(view.id, { grouping:next, groupBy:next.primaryPropertyId || null });
  };
  const changePrimary = (primaryPropertyId) => {
    const next = { ...grouping, primaryPropertyId, order: [], hiddenGroupKeys: [] };
    if (primaryPropertyId === next.secondaryPropertyId) next.secondaryPropertyId = null;
    delete next.dateInterval;
    delete next.dateSort;
    if (source.properties.find(property => property.id === primaryPropertyId)?.type === "date") {
      next.dateInterval = "month";
      next.dateSort = "desc";
    }
    onUpdateView(view.id, { grouping: next, groupBy: primaryPropertyId });
  };
  const moveSort = (index, delta) => {
    const target = index + delta;
    if (target < 0 || target >= sorts.length) return;
    const next = [...sorts];
    [next[index], next[target]] = [next[target], next[index]];
    onUpdateView(view.id,{ sorts:next });
  };
  const groupLabels = new Map(groupOptionsInDisplayOrder(primary).map(option => [String(option.id), option.name]));
  const hidden = (grouping.hiddenGroupKeys || []).map(String);
  if (dateGroups && (section === "all" || section === "group")) {
    const overview = { ...view, grouping: { ...grouping, hiddenGroupKeys: [], showEmpty: true } };
    const keys = [...groupViewItems(workspace, overview).map(group => group.key), ...hidden];
    for (const key of keys) {
      const label = groupViewLabel(workspace, overview, key);
      if (label !== key) groupLabels.set(key, label);
    }
  }
  groupLabels.set(UNASSIGNED_GROUP_KEY, t("db.unassignedGroup"));
  const savedOrder = (grouping.order || []).map(String);
  const ordered = [...new Set([...savedOrder.filter(key => groupLabels.has(key)), ...groupLabels.keys()])];
  const moveGroup = (index, delta) => {
    const target = index + delta;
    const next = [...ordered];
    [next[index], next[target]] = [next[target], next[index]];
    const positionsUnassigned = savedOrder.includes(UNASSIGNED_GROUP_KEY) || [ordered[index], ordered[target]].includes(UNASSIGNED_GROUP_KEY);
    updateGrouping({ order: positionsUnassigned ? next : next.filter(key => key !== UNASSIGNED_GROUP_KEY) });
  };
  const show = (name) => section === "all" || section === name;
  return <div className={`db-query-settings${section === "all" ? "" : " is-subpanel"}`}>
    {show("filter") && <details open><summary>{t("db.ui.filter")}</summary><FilterNode workspace={workspace} source={source} node={root} path={[]} root={root} onRootChange={(filter) => onUpdateView(view.id,{ filter:filter.children.length ? filter : null })} /><button type="button" onClick={() => onUpdateView(view.id,{filter:null})}>{t("dbx.filter.clearFilter")}</button></details>}
    {show("sort") && <details open><summary>{t("dbx.sort.title")}</summary><div className="db-sort-list">{sorts.map((sort,index)=><div className="db-sort-row" key={index}>
      <select aria-label={t("dbx.sort.propAria", { index: index + 1 })} value={sort.propertyId} onChange={(event)=>onUpdateView(view.id,{sorts:sorts.map((entry,i)=>i===index?{...entry,propertyId:event.target.value}:entry)})}>{source.properties.map((entry)=><option key={entry.id} value={entry.id}>{entry.name}</option>)}</select>
      <select aria-label={t("dbx.sort.dirAria", { index: index + 1 })} value={sort.direction || "asc"} onChange={(event)=>onUpdateView(view.id,{sorts:sorts.map((entry,i)=>i===index?{...entry,direction:event.target.value}:entry)})}><option value="asc">{t("dbx.sort.asc")}</option><option value="desc">{t("dbx.sort.desc")}</option></select>
      <button type="button" aria-label={t("dbx.sort.upAria", { index: index + 1 })} onClick={()=>moveSort(index,-1)}>↑</button><button type="button" aria-label={t("dbx.sort.downAria", { index: index + 1 })} onClick={()=>moveSort(index,1)}>↓</button><button type="button" aria-label={t("dbx.sort.delAria", { index: index + 1 })} onClick={()=>onUpdateView(view.id,{sorts:sorts.filter((_,i)=>i!==index)})}>×</button>
    </div>)}</div><button type="button" onClick={()=>onUpdateView(view.id,{sorts:[...sorts,{propertyId:source.properties[0]?.id || "",direction:"asc"}]})}>{t("dbx.sort.add")}</button></details>}
    {show("group") && <details open><summary>{t("db.ui.group")}</summary>
      <label>{t("dbx.group.primary")}<select aria-label={t("dbx.group.primary")} value={grouping.primaryPropertyId || ""} onChange={event=>changePrimary(event.target.value || null)}><option value="">{t("dbx.group.none")}</option>{groupable.map((entry)=><option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>
      {dateGroups && <>
        <label>{t("dbx.group.dateInterval")}<select aria-label={t("dbx.group.dateInterval")} value={dateGroupInterval(grouping)} onChange={event=>updateGrouping({dateInterval:event.target.value,order:[],hiddenGroupKeys:[]})}><option value="month">{t("dbx.group.month")}</option><option value="year">{t("dbx.group.year")}</option></select></label>
        <label>{t("dbx.group.dateSort")}<select aria-label={t("dbx.group.dateSort")} value={grouping.dateSort === "asc" ? "asc" : "desc"} onChange={event=>updateGrouping({dateSort:event.target.value,order:[]})}><option value="desc">{t("dbx.group.newest")}</option><option value="asc">{t("dbx.group.oldest")}</option></select></label>
      </>}
      {section === "all" && <label>{t("dbx.group.secondary")}<select aria-label={t("dbx.group.secondary")} value={grouping.secondaryPropertyId || ""} onChange={(event)=>updateGrouping({secondaryPropertyId:event.target.value || null})}><option value="">{t("dbx.group.secondaryNone")}</option>{secondaryProperties.map((entry)=><option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>}
      <label><input aria-label={t("dbx.group.showEmpty")} type="checkbox" checked={grouping.showEmpty !== false} onChange={(event)=>updateGrouping({showEmpty:event.target.checked})} />{t("dbx.group.showEmpty")}</label>
      {primary && <div className="db-group-order">{ordered.map((key, index) => <div key={key}>
        <span>{groupLabels.get(key) || key}</span>
        <label><input type="checkbox" aria-label={key === UNASSIGNED_GROUP_KEY ? t("dbx.group.showUnassignedAria") : dateGroups ? t("dbx.group.showNamedAria", { name: groupLabels.get(key) }) : undefined} checked={!hidden.includes(key)}
          onChange={event => updateGrouping({ hiddenGroupKeys: event.target.checked ? hidden.filter(entry => entry !== key) : [...hidden, key] })} />{t("dbx.group.showLabel")}</label>
        <button type="button" disabled={index === 0} onClick={() => moveGroup(index, -1)}>↑</button>
        <button type="button" disabled={index === ordered.length - 1} onClick={() => moveGroup(index, 1)}>↓</button>
      </div>)}</div>}
    </details>}
    {section === "subgroup" && <label className="db-subgroup-control">{t("dbx.group.secondary")}<select aria-label={t("dbx.group.secondary")} value={grouping.secondaryPropertyId || ""} onChange={(event)=>updateGrouping({secondaryPropertyId:event.target.value || null})}><option value="">{t("dbx.group.secondaryNone")}</option>{secondaryProperties.map((entry)=><option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>}
  </div>;
}
