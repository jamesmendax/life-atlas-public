import { useRef, useState } from "react";
import { databaseActionConfigIssue } from "../domain/databaseActions.js";
import { DatabaseActionFields } from "./DatabaseActionControls.jsx";

export function StatusActionSettings({ workspace, source, property, onChange }) {
  const saved = property.config?.statusAction;
  const [optionId, setOptionId] = useState(saved?.optionId || "");
  const [action, setAction] = useState(saved?.action);
  const [error, setError] = useState("");
  const panel = useRef(null);
  const trigger = useRef(null);

  function close() {
    if (panel.current) panel.current.open = false;
    trigger.current?.focus();
  }

  function save() {
    const issue = (property.options || []).some(option => option.id === optionId)
      ? databaseActionConfigIssue(workspace, source, action) : "请选择触发动作的状态。";
    setError(issue || "");
    if (issue) return;
    onChange({ config: { statusAction: { optionId, action } } });
    close();
  }

  return <details ref={panel} className="db-status-action">
    <summary ref={trigger}>状态触发动作{saved ? " · 已启用" : ""}</summary>
    <div className="db-property-form">
      <label>进入状态时执行<select aria-label="动作触发状态" value={optionId} onChange={event => { setOptionId(event.target.value); setError(""); }}>
        <option value="">选择状态</option>
        {(property.options || []).map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
      </select></label>
      <DatabaseActionFields workspace={workspace} source={source} action={action} onChange={(next) => { setAction(next); setError(""); }} />
      {error && <p className="db-field-error" role="alert">{error}</p>}
      <footer>
        {saved && <button type="button" className="mb-button" onClick={() => { onChange({ config: { statusAction: null } }); setOptionId(""); setAction(undefined); setError(""); close(); }}>关闭动作</button>}
        <button type="button" className="mb-button mb-primary" onClick={save}>保存状态动作</button>
      </footer>
    </div>
  </details>;
}
