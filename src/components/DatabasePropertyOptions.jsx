import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { OPTION_PALETTE } from "../domain/propertyChanges.js";
import { statusDefaultOptionId } from "../domain/statusGroups.js";
import { DatabasePopover } from "./DatabaseViewSettings.jsx";
import { OptionTag } from "./OptionPicker.jsx";
import { TaskRecurrenceSettings } from "./TaskRecurrenceSettings.jsx";
import { useI18n } from "../i18n/workspaceRuntime.js";

const GROUP_KEYS = ["todo", "inProgress", "complete"];
const GROUP_COLORS = { todo: "gray", inProgress: "blue", complete: "green" };
const optionGroup = (option) => GROUP_KEYS.includes(option?.group) ? option.group : "todo";
const composing = (event) => event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229;

export function DatabaseStatusPropertyOptions({ source, property, anchor, onClose, onChange, children }) {
  const { t } = useI18n();
  const groups = GROUP_KEYS.map((key) => [key, t(`dbx.statusGroup.${key}`)]);
  const [name, setName] = useState(property.name ?? "");
  const [selected, setSelected] = useState(null);
  const [optionName, setOptionName] = useState("");
  const [addingGroup, setAddingGroup] = useState(null);
  const [newName, setNewName] = useState("");
  const detailRef = useRef(null), inputRef = useRef(null), returnFocus = useRef(null);
  const optionRefs = useRef(new Map()), groupRefs = useRef(new Map());
  const optionsRef = useRef(property.options || []);
  useEffect(() => { optionsRef.current = property.options || []; }, [property.options]);
  const options = property.options || [];
  const current = options.find((option) => option.id === selected);
  useEffect(() => { if (selected) detailRef.current?.focus({ preventScroll: true }); }, [selected]);
  useEffect(() => { if (addingGroup) inputRef.current?.focus({ preventScroll: true }); }, [addingGroup]);
  useLayoutEffect(() => {
    if (selected || !returnFocus.current) return;
    const { id, group } = returnFocus.current;
    returnFocus.current = null;
    (optionRefs.current.get(id) || groupRefs.current.get(group))?.focus({ preventScroll: true });
  }, [selected]);
  const writeOptions = (next) => { optionsRef.current = next; onChange?.({ options: next }); };
  const update = (patch) => writeOptions(optionsRef.current.map((option) => option.id === selected ? { ...option, ...patch } : option));
  const back = () => { returnFocus.current = { id: selected, group: optionGroup(optionsRef.current.find((option) => option.id === selected)) }; setSelected(null); };
  const create = () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    const option = { id: `opt-${globalThis.crypto.randomUUID()}`, name: trimmed, color: GROUP_COLORS[addingGroup], group: addingGroup };
    writeOptions([...optionsRef.current, option]);
    setNewName("");
  };
  return <DatabasePopover anchor={anchor} label={t("dbx.statusCfg.editAria")} className="db-status-config db-status-live" onClose={onClose}>
    <div className="db-status-config-header"><strong>{current ? t("dbx.statusCfg.editOptTitle") : t("dbx.statusCfg.title")}</strong><button type="button" aria-label={t("db.ui.closePropAria")} onClick={() => onClose(true)}>×</button></div>
    {current ? <div className="db-status-detail">
      <button type="button" className="db-status-back" onClick={back}>{t("dbx.statusCfg.backOpts")}</button>
      <label>{t("dbx.propCfg.nameLabel")}<input ref={detailRef} aria-label={t("dbx.statusCfg.optNameAria")} value={optionName} onChange={(event) => setOptionName(event.target.value)} onKeyDown={(event) => { if (event.key !== "Enter" || composing(event)) return; event.preventDefault(); event.stopPropagation(); const trimmed = optionName.trim(); if (trimmed) { update({ name: trimmed }); back(); } }} /></label>
      <label>{t("db.ui.group")}<select aria-label={t("db.ui.group")} value={optionGroup(current)} onChange={(event) => update({ group: event.target.value })}>{groups.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <div className="db-status-colors" role="group" aria-label={t("dbx.statusCfg.colorLabel")}><span>{t("dbx.statusCfg.colorLabel")}</span>{OPTION_PALETTE.map((color) => <button type="button" key={color} className="db-status-color" data-color={color} aria-pressed={(current.color || "default") === color} onClick={() => update({ color })}><i aria-hidden="true" />{t(`dbx.statusCfg.color.${color}`)}{(current.color || "default") === color && <span aria-hidden="true">✓</span>}</button>)}</div>
      <button type="button" className="db-status-delete" onClick={() => { returnFocus.current = { group: optionGroup(current) }; writeOptions(optionsRef.current.filter((option) => option.id !== selected)); setSelected(null); }}>{t("dbx.pe.deleteOptionAria", { name: "" }).trim()}</button>
    </div> : <>
      <label className="db-status-name">{t("dbx.propCfg.nameLabel")}<input data-popover-initial aria-label={t("db.ui.propName")} placeholder={t("dbx.propCfg.namePlaceholder")} value={name} onChange={(event) => { const value = event.target.value; setName(value); onChange?.({ name: value }); }} /></label>
      <label className="db-status-default">{t("dbx.pe.noDefaultStatus")}<select value={statusDefaultOptionId(property) || ""} onChange={event => onChange?.({ config: { defaultOptionId: event.target.value || null } })}>
        <option value="">{t("dbx.pe.noDefaultStatus")}</option>
        {options.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
      </select></label>
      {groups.map(([group, label]) => <section key={group} className="db-status-group" aria-label={t("dbx.statusCfg.groupOptsAria", { label })}>
        <header><span>{label}</span><button ref={(element) => { if (element) groupRefs.current.set(group, element); else groupRefs.current.delete(group); }} type="button" aria-label={t("dbx.statusCfg.addGroupOptAria", { label })} onClick={() => { setNewName(""); setAddingGroup(group); }}>＋</button></header>
        {options.filter((option) => optionGroup(option) === group).map((option) => <button ref={(element) => { if (element) optionRefs.current.set(option.id, element); else optionRefs.current.delete(option.id); }} type="button" className="db-status-option" key={option.id} aria-label={t("dbx.statusCfg.editOptAria", { name: option.name || t("dbx.statusCfg.newOptFallback") })} onClick={() => { setAddingGroup(null); setOptionName(option.name ?? ""); setSelected(option.id); }}><OptionTag status choice={{ label: option.name || t("dbx.statusCfg.newOptFallback"), color: option.color, group: option.group }} /><span aria-hidden="true">›</span></button>)}
        {addingGroup === group && <input ref={inputRef} className="db-status-inline-input" aria-label={t("dbx.statusCfg.newOptGroupAria", { label })} placeholder={t("dbx.statusCfg.newOptFallback")} value={newName} onChange={(event) => setNewName(event.target.value)} onBlur={() => { setAddingGroup(null); setNewName(""); }} onKeyDown={(event) => { if (composing(event)) return; if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); create(); } else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setAddingGroup(null); setNewName(""); groupRefs.current.get(group)?.focus({ preventScroll: true }); } }} />}
      </section>)}
      {source && <TaskRecurrenceSettings source={source} property={property} onChange={onChange} />}
      {children}
    </>}
  </DatabasePopover>;
}
