import { useRef, useState } from "react";
import { RECURRENCE_UNITS, recurrenceConfigIssue } from "../domain/taskRecurrence.js";
import { statusOptionGroup } from "../domain/statusGroups.js";

function PropertyChoice({ label, options, value, onChange }) {
  return <label>{label}<select value={value || ""} onChange={event => onChange(event.target.value)}>
    <option value="">请选择</option>
    {options.map(option => <option key={option.id} value={option.id}>{option.name || "未命名"}</option>)}
  </select></label>;
}

function RecurrenceForm({ property, source, onChange, close }) {
  const dates = source.properties.filter(entry => entry.type === "date");
  const numbers = source.properties.filter(entry => entry.type === "number");
  const options = property.options || [];
  const completed = options.filter(option => statusOptionGroup(option) === "complete");
  const unfinished = options.filter(option => statusOptionGroup(option) !== "complete");
  const existing = property.config?.recurrence;
  const [draft, setDraft] = useState(() => existing || {
    completeOptionId: completed[0]?.id || "",
    resetOptionId: (unfinished.find(option => statusOptionGroup(option) === "todo") || unfinished[0])?.id || "",
    datePropertyId: dates[0]?.id || "", intervalPropertyId: numbers[0]?.id || "", unit: "days",
  });
  const issue = recurrenceConfigIssue(source, property, draft);
  const set = key => value => setDraft(current => ({ ...current, [key]: value }));
  const save = recurrence => { onChange({ config: { recurrence } }); close(); };
  return <div className="db-status-detail">
    <PropertyChoice label="触发完成状态" options={completed} value={draft.completeOptionId} onChange={set("completeOptionId")} />
    <PropertyChoice label="顺延后重置为" options={unfinished} value={draft.resetOptionId} onChange={set("resetOptionId")} />
    <PropertyChoice label="顺延日期属性" options={dates} value={draft.datePropertyId} onChange={set("datePropertyId")} />
    <PropertyChoice label="重复间隔属性" options={numbers} value={draft.intervalPropertyId} onChange={set("intervalPropertyId")} />
    <label>重复间隔单位<select value={draft.unit} onChange={event => set("unit")(event.target.value)}>
      {Object.entries(RECURRENCE_UNITS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
    </select></label>
    <small>间隔留空的任务会直接完成。</small>
    {issue && <small role="status" className="db-field-error">{issue}</small>}
    <footer>
      {existing && <button type="button" onClick={() => save(null)}>停用周期任务</button>}
      <button type="button" onClick={close}>取消</button>
      <button type="button" className="db-status-save" disabled={Boolean(issue)} onClick={() => save(draft)}>保存周期规则</button>
    </footer>
  </div>;
}

export function TaskRecurrenceSettings({ source, property, onChange }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef(null);
  function close() {
    setOpen(false);
    trigger.current?.focus({ preventScroll: true });
  }
  return <section className="db-status-group" aria-label="周期任务">
    <button ref={trigger} type="button" className="db-status-option" aria-label="周期任务设置" aria-expanded={open} onClick={() => setOpen(!open)}>
      <span>周期任务</span><span>{property.config?.recurrence ? "已启用" : "未启用"} {open ? "⌄" : "›"}</span>
    </button>
    {open && <RecurrenceForm property={property} source={source} onChange={onChange} close={close} />}
  </section>;
}
