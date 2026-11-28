import { useRef, useState } from "react";
import { formatNumber } from "../domain/numberFormat.js";
import { DatabasePopover } from "./DatabaseViewSettings.jsx";

function NumberEditor({ value, label, anchor, onChange, onClose, onNext }) {
  const [draft, setDraft] = useState(value == null ? "" : String(value));
  const composing = useRef(false);
  const lastValue = useRef(value ?? null);
  const trimmed = draft.trim();
  const invalid = trimmed !== "" && !Number.isFinite(Number(trimmed));
  const update = (text) => {
    setDraft(text);
    const value = text.trim() === "" ? null : Number(text);
    if (value !== null && !Number.isFinite(value)) return;
    if (!Object.is(lastValue.current, value)) { lastValue.current = value; onChange(value); }
  };
  return <DatabasePopover anchor={anchor} label={`编辑数字 ${label}`} className="db-table-number-popover" overlap onClose={onClose}>
    <input data-popover-initial aria-label={label} aria-invalid={invalid} inputMode="decimal" value={draft} onChange={(event) => {
      if (composing.current || event.nativeEvent.isComposing) setDraft(event.target.value);
      else update(event.target.value);
    }} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={(event) => { composing.current = false; update(event.currentTarget.value); }} onKeyDown={(event) => {
      if (composing.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) { event.stopPropagation(); return; }
      if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); onNext(); }
    }} />
    {invalid && <small className="db-field-error" role="alert">请输入有效数字</small>}
  </DatabasePopover>;
}

export function DatabaseTableNumberCell({ property, value, label, locked, onChange, onNext }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef(null);
  const close = (restoreFocus) => {
    const cell = anchor.current?.closest("td[data-property-id]");
    setOpen(false);
    if (restoreFocus && cell) requestAnimationFrame(() => { if (cell.isConnected) cell.focus({ preventScroll: true }); });
  };
  const text = formatNumber(value, property.config?.numberFormat);
  if (locked) return <span className="db-readonly-cell" data-value-kind="number">{text}</span>;
  return <><button ref={anchor} type="button" className="db-table-number-read" aria-label={label} aria-haspopup="dialog" onClick={() => setOpen(true)}>{text}</button>
    {open && <NumberEditor value={value} label={label} anchor={anchor.current} onChange={onChange} onClose={close} onNext={() => { setOpen(false); onNext(); }} />}
  </>;
}
