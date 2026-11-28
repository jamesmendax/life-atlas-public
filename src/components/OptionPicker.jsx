import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { dataSourceById, itemDisplayTitle, relationDefinition } from "../domain/database.js";
import { normalizeIdValues } from "../domain/databaseProperties.js";
import { OPTION_PALETTE } from "../domain/propertyChanges.js";
import { isPageArchived } from "../domain/archive.js";

const OPTION_TYPES = ["select", "multi_select", "status"];
const GROUP_LABELS = { todo: "待办", inProgress: "进行中", complete: "完成" };
const COLORS = new Set(OPTION_PALETTE);

function selectedChoice(workspace, source, property, id) {
  if (OPTION_TYPES.includes(property.type)) {
    const option = property.options?.find((entry) => entry.id === id);
    return { id, label: option?.name || "不可用选项", color: option?.color, group: option?.group, available: Boolean(option) };
  }
  if (property.type === "people") { const person = workspace.people?.find((entry) => entry.id === id); return { id, label: person?.displayName || "未知成员", available: Boolean(person) }; }
  if (property.type === "files") { const file = workspace.attachments?.find((entry) => entry.id === id && !entry.deletedAt); return { id, label: file?.name || "不可用附件", available: Boolean(file) }; }
  const item = workspace.databaseItems?.find((entry) => entry.id === id);
  const relation = relationDefinition(workspace, source?.id, property);
  const target = dataSourceById(workspace, relation?.targetSourceId || item?.sourceId);
  const page = workspace.pages?.find((entry) => entry.id === item?.pageId);
  const available = Boolean(item && target && item.sourceId === target.id && page && !page.trashedAt);
  return { id, label: available ? itemDisplayTitle(workspace, target, item) : "不可用记录", available };
}

export function OptionTag({ choice, status = false, showStatusDot = true }) {
  const group = Object.hasOwn(GROUP_LABELS, choice.group) ? choice.group : "todo";
  const color = status && (!COLORS.has(choice.color) || choice.color === "default") ? { todo: "gray", inProgress: "blue", complete: "green" }[group] : COLORS.has(choice.color) ? choice.color : "default";
  return <span className={status ? "db-status-tag" : "db-option-tag"} data-color={color} data-group={status ? group : undefined}>{status && showStatusDot && <i aria-hidden="true" />}<span className="db-tag-label">{choice.label}</span></span>;
}

export function OptionPicker({ workspace, source, property, value, onChange, runtime, label, disabled = false, children }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const [position, setPosition] = useState({ left: 8, top: 8 });
  const detailsRef = useRef(null), summaryRef = useRef(null), searchRef = useRef(null), panelRef = useRef(null);
  const singleRelation = property.type === "relation" && property.config?.relationLimit === 1;
  const multiple = !["select", "status"].includes(property.type) && !singleRelation;
  const selected = multiple || singleRelation ? normalizeIdValues(value) : value ? [value] : [];
  const selectedChoices = selected.map((id) => selectedChoice(workspace, source, property, id));
  const choices = useMemo(() => {
    if (!open) return [];
    let entries;
    if (OPTION_TYPES.includes(property.type)) entries = (property.options || []).map((option) => ({ ...option, label: option.name }));
    else if (property.type === "people") entries = (workspace.people || []).map((person) => ({ id: person.id, label: person.displayName }));
    else if (property.type === "files") entries = (workspace.attachments || []).filter((file) => !file.deletedAt).map((file) => ({ id: file.id, label: file.name }));
    else {
      const relation = relationDefinition(workspace, source?.id, property);
      const target = dataSourceById(workspace, relation?.targetSourceId);
      const pagesById = new Map((workspace.pages || []).map((page) => [page.id, page]));
      entries = target ? (workspace.databaseItems || []).filter((item) => item.sourceId === target.id && pagesById.has(item.pageId) && !pagesById.get(item.pageId).trashedAt && !isPageArchived(workspace, item.pageId)).map((item) => ({ id: item.id, label: itemDisplayTitle(workspace, target, item) })) : [];
    }
    const needle = query.trim().toLocaleLowerCase();
    const filtered = entries.filter((choice) => choice.label.toLocaleLowerCase().includes(needle));
    return property.type === "relation" ? filtered.slice(0, 50) : filtered;
  }, [open, property, query, source?.id, workspace]);
  const canCreate = Boolean(query.trim() && !choices.some((choice) => choice.label.toLocaleLowerCase() === query.trim().toLocaleLowerCase()) && (OPTION_TYPES.includes(property.type) && runtime?.updateDatabaseProperty || property.type === "people" && runtime?.createPerson));
  useLayoutEffect(() => {
    if (!open) return undefined;
    const place = () => {
      const anchor = summaryRef.current?.getBoundingClientRect(), panel = panelRef.current;
      if (!anchor || !panel) return;
      const left = Math.max(8, Math.min(anchor.left, window.innerWidth - panel.offsetWidth - 8));
      const top = window.innerHeight - anchor.bottom - 8 >= panel.offsetHeight ? anchor.bottom + 4 : Math.max(8, anchor.top - panel.offsetHeight - 4);
      setPosition((current) => current.left === left && current.top === top ? current : { left, top });
    };
    place();
    window.addEventListener("resize", place);
    document.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); document.removeEventListener("scroll", place, true); };
  }, [open, choices.length, canCreate]);
  useEffect(() => { if (open) { setQuery(""); setHighlighted(0); searchRef.current?.focus(); } }, [open]);
  useEffect(() => { setHighlighted(0); }, [query]);
  useEffect(() => {
    if (!open) return undefined;
    const outside = (event) => { if (!detailsRef.current?.contains(event.target)) setOpen(false); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  const close = (restoreFocus = true) => { setOpen(false); if (restoreFocus) summaryRef.current?.focus(); };
  const select = (id) => {
    if (disabled || runtime?.locked) return;
    if (singleRelation) onChange([id]);
    else onChange(multiple ? selected.includes(id) ? selected.filter((entry) => entry !== id) : [...selected, id] : id);
    if (!multiple) close();
  };
  const create = () => {
    if (!canCreate || disabled || runtime?.locked) return;
    const name = query.trim();
    if (property.type === "people") {
      const person = runtime.createPerson(name);
      if (person?.id) onChange([...selected, person.id]);
    } else {
      const options = property.options || [];
      const option = { id: `opt-${globalThis.crypto.randomUUID()}`, name, color: OPTION_PALETTE[options.length % OPTION_PALETTE.length], ...(property.type === "status" ? { group: "todo" } : {}) };
      runtime.updateDatabaseProperty(source.id, property.id, { options: [...options, option] });
      onChange(multiple ? [...selected, option.id] : option.id);
    }
    close();
  };
  const keyboard = (event) => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); summaryRef.current?.closest("td[data-property-id]")?.focus(); return; }
    if (!["ArrowUp", "ArrowDown", "Enter"].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const actions = [...(panelRef.current?.querySelectorAll("[data-option-action]") || [])];
    if (!actions.length) return;
    if (event.key === "Enter") actions[Math.min(highlighted, actions.length - 1)]?.click();
    else {
      const next = (highlighted + (event.key === "ArrowDown" ? 1 : -1) + actions.length) % actions.length;
      setHighlighted(next);
      actions[next].scrollIntoView({ block: "nearest" });
    }
  };
  let actionIndex = !multiple && selected.length > 0 ? 1 : 0;
  const optionRows = (entries) => entries.map((choice) => {
    const index = actionIndex++;
    const content = <OptionTag choice={choice} status={property.type === "status"} />;
    if (multiple) return <label className={`db-option-row${index === highlighted ? " is-highlighted" : ""}`} key={choice.id}><input data-option-action type="checkbox" aria-label={`${label}: ${choice.label}`} checked={selected.includes(choice.id)} disabled={disabled} onChange={() => select(choice.id)} />{content}</label>;
    return <button type="button" data-option-action className={`db-option-row${index === highlighted ? " is-highlighted" : ""}`} key={choice.id} role="option" aria-selected={selected.includes(choice.id)} onClick={() => select(choice.id)}>{content}</button>;
  });
  return <details ref={detailsRef} className="db-option-picker" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary ref={summaryRef} aria-label={label} aria-disabled={disabled || runtime?.locked || undefined} onClick={(event) => { if (disabled || runtime?.locked) event.preventDefault(); }}>{selectedChoices.length ? selectedChoices.map((choice) => <OptionTag key={choice.id} choice={choice} status={property.type === "status"} />) : <span className="db-empty-value">—</span>}</summary>
    {open && <div ref={panelRef} className="db-option-panel" style={position} role="group" aria-label={label} onKeyDown={keyboard}>
      <input ref={searchRef} className="db-picker-search" aria-label={`${label} 搜索`} value={query} onChange={(event) => setQuery(event.target.value)} />
      <div className="db-option-list" role={multiple ? "group" : "listbox"} aria-label={`${label} 选项`}>
        {!multiple && selected.length > 0 && <button type="button" data-option-action className={`db-option-row${highlighted === 0 ? " is-highlighted" : ""}`} onClick={() => { onChange(singleRelation ? [] : null); close(); }}>清除</button>}
        {property.type === "status" ? Object.entries(GROUP_LABELS).map(([group, title]) => <div key={group}><h4>{title}</h4>{optionRows(choices.filter((choice) => (Object.hasOwn(GROUP_LABELS, choice.group) ? choice.group : "todo") === group))}</div>) : optionRows(choices)}
        {!choices.length && <span className="db-field-hint">暂无可选项</span>}
        {canCreate && <button type="button" data-option-action className={`db-option-row db-create-option${actionIndex++ === highlighted ? " is-highlighted" : ""}`} onClick={create}><span aria-hidden="true">+</span>{property.type === "people" ? `新建成员「${query.trim()}」` : `创建「${query.trim()}」`}</button>}
        {selectedChoices.filter((choice) => !choice.available && !query).map((choice) => <label className={`db-option-row${actionIndex++ === highlighted ? " is-highlighted" : ""}`} key={`missing-${choice.id}`}><input data-option-action type="checkbox" checked disabled={disabled} aria-label={`${label}: 不可用引用 ${choice.id}`} onChange={() => onChange(multiple || singleRelation ? selected.filter((entry) => entry !== choice.id) : null)} />不可用引用（取消以移除）</label>)}
      </div>
      {children}
    </div>}
  </details>;
}
