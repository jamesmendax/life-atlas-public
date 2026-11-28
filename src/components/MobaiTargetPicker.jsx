import { useEffect, useId, useMemo, useRef, useState } from "react";
import IconCheck from "@tabler/icons-react/dist/esm/icons/IconCheck.mjs";
import IconChevronDown from "@tabler/icons-react/dist/esm/icons/IconChevronDown.mjs";
import IconFileText from "@tabler/icons-react/dist/esm/icons/IconFileText.mjs";
import IconFolder from "@tabler/icons-react/dist/esm/icons/IconFolder.mjs";
import IconSearch from "@tabler/icons-react/dist/esm/icons/IconSearch.mjs";
import { isComposingKeyboardEvent } from "../ui/keyboard.js";

export function MobaiTargetPicker({
  ariaLabel,
  kind = "page",
  options = [],
  value = "",
  placeholder = "请选择目标",
  searchPlaceholder = "搜索名称…",
  emptyText = "没有可选项",
  disabled = false,
  onChange,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const searchRef = useRef(null);
  const listboxId = useId();

  const selected = useMemo(
    () => options.find((item) => item.id === value) || options[0] || null,
    [options, value],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    if (!q) return options;
    return options.filter((item) =>
      `${item.label} ${item.sublabel || ""}`.toLocaleLowerCase().includes(q),
    );
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    setActiveIndex(0);
    const frame = window.requestAnimationFrame(() => searchRef.current?.focus());
    const onPointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [open]);

  function returnToTrigger() {
    setOpen(false);
    setQuery("");
    triggerRef.current?.focus();
  }

  function selectOption(option) {
    if (!option) return;
    onChange?.(option.id);
    returnToTrigger();
  }

  function handleSearchKeyDown(event) {
    if (isComposingKeyboardEvent(event)) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((idx) => (filtered.length ? (idx + 1) % filtered.length : 0));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((idx) => (filtered.length ? (idx - 1 + filtered.length) % filtered.length : 0));
    } else if (event.key === "Enter" && filtered[activeIndex]) {
      event.preventDefault();
      selectOption(filtered[activeIndex]);
    }
  }

  const KindIcon = kind === "folder" ? IconFolder : IconFileText;

  return (
    <div ref={rootRef} className={`mb-target-picker${open ? " is-open" : ""}`}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (open && event.key === "Escape" && !event.defaultPrevented && !isComposingKeyboardEvent(event)) {
          event.preventDefault();
          event.stopPropagation();
          returnToTrigger();
        }
      }}>
      <button
        ref={triggerRef}
        type="button"
        className="mb-target-trigger"
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={listboxId}
        aria-haspopup="listbox"
        data-value={selected?.id || ""}
        disabled={disabled || !options.length}
        onClick={() => {
          if (disabled || !options.length) return;
          setOpen((prev) => !prev);
          setQuery("");
        }}
      >
        <span className="mb-target-trigger-icon" aria-hidden="true">
          <KindIcon size={15} />
        </span>
        <span className="mb-target-trigger-text">
          {selected ? selected.label : placeholder}
        </span>
        {selected?.sublabel && (
          <span className="mb-target-trigger-sub">{selected.sublabel}</span>
        )}
        <IconChevronDown size={15} className="mb-target-trigger-chevron" aria-hidden="true" />
      </button>

      {open && (
        <div className="mb-target-popover" role="presentation">
          <div className="mb-target-search-wrap">
            <IconSearch size={14} className="mb-target-search-icon" aria-hidden="true" />
            <input
              ref={searchRef}
              type="text"
              role="combobox"
              aria-expanded="true"
              aria-autocomplete="list"
              aria-controls={listboxId}
              aria-activedescendant={filtered[activeIndex] ? `${listboxId}-option-${activeIndex}` : undefined}
              className="mb-target-search"
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActiveIndex(0);
              }}
              onKeyDown={handleSearchKeyDown}
            />
          </div>
          <div id={listboxId} className="mb-target-list" role="listbox" aria-label={ariaLabel}>
            {filtered.length ? filtered.map((option, idx) => {
              const isSelected = option.id === selected?.id;
              const isActive = idx === activeIndex;
              return (
                <button
                  key={option.id}
                  id={`${listboxId}-option-${idx}`}
                  type="button"
                  role="option"
                  tabIndex={-1}
                  aria-selected={isSelected}
                  className={`mb-target-option${isSelected ? " is-selected" : ""}${isActive ? " is-active" : ""}`}
                  onMouseEnter={() => setActiveIndex(idx)}
                  onClick={() => selectOption(option)}
                >
                  <span className="mb-target-option-icon" aria-hidden="true">
                    <KindIcon size={14} />
                  </span>
                  <span className="mb-target-option-body">
                    <span className="mb-target-option-label">{option.label}</span>
                    {option.sublabel && <span className="mb-target-option-sub">{option.sublabel}</span>}
                  </span>
                  {isSelected && <IconCheck size={14} className="mb-target-option-check" aria-hidden="true" />}
                </button>
              );
            }) : <p className="mb-target-empty">{emptyText}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
