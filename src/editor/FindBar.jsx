import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import IconChevronDown from "@tabler/icons-react/dist/esm/icons/IconChevronDown.mjs";
import IconChevronUp from "@tabler/icons-react/dist/esm/icons/IconChevronUp.mjs";
import IconX from "@tabler/icons-react/dist/esm/icons/IconX.mjs";
import { collectFindUnits, createRanges, findTextMatches } from "./findInPage.js";
import { isComposingKeyboardEvent } from "../ui/keyboard.js";
import { useI18n } from "../i18n/workspaceRuntime.js";

export function FindBar({ rootRef, onClose, focusKey = 0 }) {
  const { t } = useI18n();
  const inputRef = useRef(null);
  const previousFocus = useRef(null);
  const [query, setQuery] = useState("");
  const [ranges, setRanges] = useState([]);
  const [active, setActive] = useState(0);

  useLayoutEffect(() => {
    if (!previousFocus.current) previousFocus.current = document.activeElement;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusKey]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const find = () => {
      const units = collectFindUnits(root);
      const matches = findTextMatches(units.map((unit) => unit.text), query);
      setRanges(createRanges(units, matches));
      setActive((current) => Math.min(current, Math.max(0, matches.length - 1)));
    };
    find();
    let timer;
    const observer = new MutationObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(find, 200);
    });
    observer.observe(root, { subtree: true, childList: true, characterData: true });
    return () => { observer.disconnect(); window.clearTimeout(timer); };
  }, [query, rootRef]);

  useEffect(() => {
    CSS.highlights.set("la-find", new Highlight(...ranges));
    CSS.highlights.set("la-find-active", new Highlight(...(ranges[active] ? [ranges[active]] : [])));
    ranges[active]?.startContainer.parentElement?.scrollIntoView({ block: "center" });
  }, [active, ranges]);

  useEffect(() => () => {
    CSS.highlights.delete("la-find");
    CSS.highlights.delete("la-find-active");
  }, []);

  const move = useCallback((offset) => {
    if (ranges.length) setActive((current) => (current + offset + ranges.length) % ranges.length);
  }, [ranges.length]);

  function close() {
    const previous = previousFocus.current;
    const target = previous?.isConnected && previous !== document.body ? previous : rootRef.current?.querySelector(".page-title-input, .bn-editor");
    onClose();
    target?.focus({ preventScroll: true });
  }

  return <div className="life-find-bar" role="search" aria-label={t("find.aria")} data-find-ignore onKeyDown={(event) => {
    if (event.key === "Escape" && !isComposingKeyboardEvent(event)) { event.preventDefault(); event.stopPropagation(); close(); }
  }}>
    <input ref={inputRef} aria-label={t("find.inputAria")} aria-invalid={Boolean(query) && ranges.length === 0} value={query} onChange={(event) => { setActive(0); setQuery(event.target.value); }} onKeyDown={(event) => {
      if (event.key === "Enter" && !isComposingKeyboardEvent(event)) { event.preventDefault(); event.stopPropagation(); move(event.shiftKey ? -1 : 1); }
    }} />
    <span className={ranges.length ? "" : "is-empty"} data-testid="find-count">{ranges.length ? active + 1 : 0}/{ranges.length}</span>
    <button type="button" aria-label={t("find.prevAria")} disabled={!ranges.length} onClick={() => move(-1)}><IconChevronUp size={16} /></button>
    <button type="button" aria-label={t("find.nextAria")} disabled={!ranges.length} onClick={() => move(1)}><IconChevronDown size={16} /></button>
    <button type="button" aria-label={t("find.closeAria")} onClick={close}><IconX size={16} /></button>
  </div>;
}
