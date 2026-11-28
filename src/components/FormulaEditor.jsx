import { useId, useMemo, useRef } from "react";
import { dataSourceById, itemDisplayTitle, resolveDisplayPropertyValue } from "../domain/database.js";
import { renderFormulaResult } from "./formulaResult.js";
import { FORMULA_HELP } from "../domain/formula/help.js";
import { formulaSyntaxError } from "../domain/formula/validation.js";

export function FormulaEditor({ workspace, source, property, expression, onChange }) {
  const textareaRef = useRef(null);
  const previewId = useId();
  const syntaxError = useMemo(() => formulaSyntaxError(expression), [expression]);
  const first = useMemo(() => {
    const pagesById = new Map((workspace.pages || []).map((page) => [page.id, page]));
    return (workspace.databaseItems || []).find((item) => item.sourceId === source.id && pagesById.has(item.pageId) && !pagesById.get(item.pageId).trashedAt);
  }, [workspace.databaseItems, workspace.pages, source.id]);
  const result = useMemo(() => first && !syntaxError ? resolveDisplayPropertyValue(workspace, source, first, {
    ...property, type: "formula", config: { ...property?.config, expression },
  }) : null, [expression, workspace, source, first, property, syntaxError]);
  const insert = (text) => {
    const textarea = textareaRef.current;
    const start = textarea?.selectionStart ?? expression.length;
    const end = textarea?.selectionEnd ?? start;
    onChange(`${expression.slice(0, start)}${text}${expression.slice(end)}`);
    requestAnimationFrame(() => { textarea?.focus(); textarea?.setSelectionRange(start + text.length, start + text.length); });
  };
  const groups = [...new Set(FORMULA_HELP.map((entry) => entry.group))];
  const title = first ? itemDisplayTitle(workspace, dataSourceById(workspace, first.sourceId), first) : "";
  const error = syntaxError || result?.error?.message;
  const preview = error ? `错误：${error}` : !first ? "预览：没有记录" : <>{`预览（${title}）：`}{renderFormulaResult(workspace, property || { type: "formula" }, result, source) || "—"}</>;
  return <div className="db-formula-editor">
    <label>公式<textarea ref={textareaRef} aria-label="公式表达式" aria-invalid={Boolean(syntaxError)} aria-describedby={previewId} rows={4} value={expression} onChange={(event) => onChange(event.target.value)} /></label>
    <div className="db-formula-properties"><strong>属性</strong><div>{source.properties.filter((entry) => entry.id !== property?.id).map((entry) => <button type="button" className="db-formula-insert" key={entry.id} onMouseDown={(event) => event.preventDefault()} onClick={() => insert(`prop(${JSON.stringify(entry.name)})`)}>{entry.name}</button>)}</div></div>
    <details className="db-formula-functions" open><summary>函数</summary>{groups.map((group) => <section key={group}><h4>{group}</h4><div>{FORMULA_HELP.filter((entry) => entry.group === group).map((entry) => <button type="button" className="db-formula-insert" key={entry.name} title={entry.description} onMouseDown={(event) => event.preventDefault()} onClick={() => insert(`${entry.name}(`)}>{entry.signature}</button>)}</div></section>)}</details>
    <div id={previewId} className={`db-formula-preview${error ? " is-error" : ""}`} role="status">{preview}</div>
  </div>;
}
