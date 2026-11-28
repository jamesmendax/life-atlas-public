import { useEffect, useRef, useState } from "react";
import IconFileText from "@tabler/icons-react/dist/esm/icons/IconFileText.mjs";
import { AppearanceGlyph, SpriteIcon } from "./AppearanceGlyph.jsx";

export function DatabaseTitleCell({ title, displayTitle, icon, iconColor, depth, locked, onChange, onOpen, autoEdit, onAutoEditStarted, showIcon = true }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const editingRef = useRef(false);
  const selectOnFocus = useRef(false);
  const wrapperRef = useRef(null);

  useEffect(() => {
    if (locked && editingRef.current) { editingRef.current = false; setEditing(false); }
  }, [locked]);

  useEffect(() => {
    if (!autoEdit) return;
    if (!locked) { setDraft(title); selectOnFocus.current = true; editingRef.current = true; setEditing(true); }
    onAutoEditStarted?.();
  }, [autoEdit]);

  const begin = () => {
    if (locked) return;
    setDraft(title);
    editingRef.current = true;
    setEditing(true);
  };
  const finish = (save, returnFocus = false) => {
    if (!editingRef.current) return;
    editingRef.current = false;
    if (save && !locked && draft !== title) onChange?.(draft);
    setEditing(false);
    if (returnFocus) wrapperRef.current?.closest("td")?.focus();
  };

  return <div ref={wrapperRef} className="db-title-control" style={{ paddingLeft: `${9 + depth * 15}px` }} onMouseDownCapture={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
    {depth > 0 && <span className="db-subitem-mark" aria-hidden="true">↳</span>}
    {editing ? <input autoFocus className="db-title-editor" aria-label={`编辑标题 ${displayTitle}`} placeholder="无标题" value={draft} onFocus={(event) => { if (selectOnFocus.current) { event.currentTarget.select(); selectOnFocus.current = false; } }} onChange={(event) => setDraft(event.target.value)} onBlur={() => finish(true)} onKeyDown={(event) => {
      event.stopPropagation();
      if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
      if (event.key === "Enter") { event.preventDefault(); finish(true, true); }
      else if (event.key === "Escape") { event.preventDefault(); finish(false, true); }
    }} /> : <button type="button" className="db-title-cell" aria-label={locked ? `标题 ${displayTitle}（只读）` : `编辑标题 ${displayTitle}`} onClick={begin}>{showIcon && <span className="db-record-glyph" aria-hidden="true">{icon ? <AppearanceGlyph icon={icon} color={iconColor} /> : <SpriteIcon id="file-description" size={15} />}</span>}<span className="db-title-label">{displayTitle}</span></button>}
    <button type="button" className="db-title-open" aria-label={`打开 ${displayTitle}`} title="打开记录" onClick={onOpen}><IconFileText size={15} aria-hidden="true" /></button>
  </div>;
}
