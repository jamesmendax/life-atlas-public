import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import IconAlertCircle from "@tabler/icons-react/dist/esm/icons/IconAlertCircle.mjs";
import IconBlockquote from "@tabler/icons-react/dist/esm/icons/IconBlockquote.mjs";
import IconCheck from "@tabler/icons-react/dist/esm/icons/IconCheck.mjs";
import IconCode from "@tabler/icons-react/dist/esm/icons/IconCode.mjs";
import IconFile from "@tabler/icons-react/dist/esm/icons/IconFile.mjs";
import IconH1 from "@tabler/icons-react/dist/esm/icons/IconH1.mjs";
import IconH2 from "@tabler/icons-react/dist/esm/icons/IconH2.mjs";
import IconH3 from "@tabler/icons-react/dist/esm/icons/IconH3.mjs";
import IconList from "@tabler/icons-react/dist/esm/icons/IconList.mjs";
import IconListCheck from "@tabler/icons-react/dist/esm/icons/IconListCheck.mjs";
import IconListNumbers from "@tabler/icons-react/dist/esm/icons/IconListNumbers.mjs";
import IconLock from "@tabler/icons-react/dist/esm/icons/IconLock.mjs";
import IconMinus from "@tabler/icons-react/dist/esm/icons/IconMinus.mjs";
import IconPhoto from "@tabler/icons-react/dist/esm/icons/IconPhoto.mjs";
import IconPlus from "@tabler/icons-react/dist/esm/icons/IconPlus.mjs";
import IconSlash from "@tabler/icons-react/dist/esm/icons/IconSlash.mjs";
import IconTrash from "@tabler/icons-react/dist/esm/icons/IconTrash.mjs";
import IconTypography from "@tabler/icons-react/dist/esm/icons/IconTypography.mjs";
import { invokeVault } from "./api.js";
import { useI18n } from "./i18n.js";
import {
  createVaultBlock,
  filterVaultSlashCommands,
  formatVaultFileSize,
  isVaultImageName,
  parseVaultNote,
  serializeVaultNote,
} from "./vaultNoteModel.js";

const COMMAND_ICONS = {
  image: IconPhoto,
  file: IconFile,
  heading1: IconH1,
  heading2: IconH2,
  heading3: IconH3,
  todo: IconListCheck,
  bullet: IconList,
  numbered: IconListNumbers,
  callout: IconAlertCircle,
  quote: IconBlockquote,
  code: IconCode,
  divider: IconMinus,
  paragraph: IconTypography,
};

function AutoGrowTextarea({ value, onChange, onKeyDown, inputRef, className, placeholder, ariaLabel, disabled, dataRevealEpoch }) {
  const localRef = useRef(null);
  const assignRef = (node) => {
    localRef.current = node;
    if (typeof inputRef === "function") inputRef(node);
    else if (inputRef) inputRef.current = node;
  };
  useLayoutEffect(() => {
    const node = localRef.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${Math.max(node.scrollHeight, 26)}px`;
  }, [value]);
  return (
    <textarea
      ref={assignRef}
      rows={1}
      className={className}
      value={value}
      placeholder={placeholder}
      aria-label={ariaLabel}
      disabled={disabled}
      data-reveal-epoch={dataRevealEpoch}
      onChange={onChange}
      onKeyDown={onKeyDown}
    />
  );
}

function VaultImagePreview({ attachmentId, itemId, draftId, isSavedAttachment, name, size, caption, onCaptionChange, onRemove, downloadButton, disabled }) {
  const { locale, t } = useI18n();
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    let generation = 0;
    const clear = () => {
      generation += 1;
      if (active) { setPreview(null); setLoading(false); }
    };
    window.addEventListener("blur", clear);
    const args = isSavedAttachment && itemId
      ? { id: itemId, attachmentId }
      : draftId
        ? { draftId, attachmentId }
        : null;
    if (!args) {
      setLoading(false);
      return () => { active = false; generation += 1; window.removeEventListener("blur", clear); };
    }
    const expected = ++generation;
    setLoading(true);
    invokeVault("readAttachmentPreview", args)
      .then((result) => {
        if (!active || generation !== expected) return;
        setPreview(result.previewable ? result.dataUrl : null);
      })
      .catch(() => { if (active && generation === expected) setPreview(null); })
      .finally(() => { if (active && generation === expected) setLoading(false); });
    return () => {
      active = false;
      generation += 1;
      window.removeEventListener("blur", clear);
    };
  }, [attachmentId, itemId, draftId, isSavedAttachment]);

  return (
    <figure className="vault-note-media-card is-image">
      <div className="vault-note-media-head">
        <span className="vault-note-media-badge"><IconLock size={12} aria-hidden="true" />{t("vault.note.encryptedBadge")}</span>
        <span className="vault-note-media-name" title={name} dir="auto">{name}</span>
        {Number.isFinite(size) && <span className="vault-note-media-size">{formatVaultFileSize(size, locale)}</span>}
        {downloadButton}
        <button type="button" className="mini" title={t("vault.note.removeImageTitle")} aria-label={t("vault.note.removeImageAria", { name })} disabled={disabled} onClick={onRemove}>
          <IconTrash size={14} />
        </button>
      </div>
      {preview ? (
        <div className="vault-note-image-frame">
          <img src={preview} alt={caption || name} draggable={false} />
        </div>
      ) : (
        <div className="vault-note-image-fallback">
          <IconPhoto size={18} aria-hidden="true" />
          <span>{loading ? t("vault.note.decrypting") : t("vault.note.hiddenOnBlur")}</span>
        </div>
      )}
      <input
        type="text"
        className="vault-note-caption-input"
        value={caption}
        disabled={disabled}
        placeholder={t("vault.note.insertCaption")}
        aria-label={t("vault.note.captionAria", { name })}
        onChange={(event) => onCaptionChange(event.target.value)}
      />
    </figure>
  );
}

export default function VaultNoteEditor({
  value,
  ariaLabel,
  disabled = false,
  canAttach = true,
  attachments = [],
  savedAttachmentIds,
  itemId = null,
  draftId = null,
  revealEpoch = 0,
  onChange,
  onPickFiles,
  onRemoveAttachment,
  renderDownload,
}) {
  const { locale, t } = useI18n();
  const [blocks, setBlocks] = useState(() => parseVaultNote(value));
  const [slashMenu, setSlashMenu] = useState(null); // { blockId, query, activeIndex, triggerViaButton, placement }
  const lastSerialized = useRef(serializeVaultNote(blocks));
  const textRefs = useRef(new Map());
  const blockRefs = useRef(new Map());
  const slashMenuRef = useRef(null);
  const pendingFocus = useRef(null);

  function slashPlacementFor(blockId) {
    const node = blockRefs.current.get(blockId);
    if (!node) return "bottom";
    const rect = node.getBoundingClientRect();
    return window.innerHeight - rect.bottom < 320 && rect.top > 280 ? "top" : "bottom";
  }

  useEffect(() => {
    if (value !== lastSerialized.current) {
      const parsed = parseVaultNote(value);
      lastSerialized.current = serializeVaultNote(parsed);
      setBlocks(parsed);
    }
  }, [value]);

  useEffect(() => {
    if (!pendingFocus.current) return;
    const targetId = pendingFocus.current;
    pendingFocus.current = null;
    requestAnimationFrame(() => {
      const node = textRefs.current.get(targetId);
      if (node) {
        node.focus();
        const end = node.value.length;
        node.setSelectionRange(end, end);
      }
    });
  }, [blocks]);

  useEffect(() => {
    if (!slashMenu) return undefined;
    const handleOutside = (event) => {
      if (!slashMenuRef.current?.contains(event.target)) setSlashMenu(null);
    };
    document.addEventListener("pointerdown", handleOutside);
    return () => document.removeEventListener("pointerdown", handleOutside);
  }, [slashMenu]);

  const attachmentById = useMemo(() => new Map(attachments.map((file) => [file.id, file])), [attachments]);
  const slashCommands = useMemo(() => {
    if (!slashMenu) return [];
    const list = filterVaultSlashCommands(slashMenu.query, t);
    return canAttach ? list : list.filter((item) => item.id !== "image" && item.id !== "file");
  }, [slashMenu, canAttach, t]);

  function commit(nextBlocks, focusId = null) {
    const safeBlocks = nextBlocks.length ? nextBlocks : [createVaultBlock("paragraph", { text: "" })];
    const serialized = serializeVaultNote(safeBlocks);
    lastSerialized.current = serialized;
    if (focusId) pendingFocus.current = focusId;
    setBlocks(safeBlocks);
    onChange(serialized);
  }

  function updateBlock(blockId, patch) {
    commit(blocks.map((block) => (block.id === blockId ? { ...block, ...patch } : block)));
  }

  function removeBlock(blockId) {
    const index = blocks.findIndex((block) => block.id === blockId);
    if (index === -1) return;
    const removed = blocks[index];
    if ((removed.type === "image" || removed.type === "file") && removed.attachmentId) {
      const file = attachmentById.get(removed.attachmentId);
      if (file) onRemoveAttachment?.(file);
    }
    const remaining = blocks.filter((block) => block.id !== blockId);
    const focusTarget = remaining[Math.max(0, index - 1)]?.id ?? null;
    commit(remaining, focusTarget);
  }

  function handleTextChange(block, nextText) {
    if (block.type === "paragraph") {
      const shortcuts = [
        [/^###\s+(.*)$/, "heading3"],
        [/^##\s+(.*)$/, "heading2"],
        [/^#\s+(.*)$/, "heading1"],
        [/^-\s+\[\s?\]\s+(.*)$/, "todo"],
        [/^-\s+\[[xX]\]\s+(.*)$/, "todo-checked"],
        [/^[-*]\s+(.*)$/, "bullet"],
        [/^1\.\s+(.*)$/, "numbered"],
        [/^>\s+(.*)$/, "quote"],
      ];
      for (const [pattern, targetType] of shortcuts) {
        const match = pattern.exec(nextText);
        if (match) {
          setSlashMenu(null);
          if (targetType === "todo-checked") {
            updateBlock(block.id, { type: "todo", checked: true, text: match[1] });
          } else {
            updateBlock(block.id, { type: targetType, text: match[1], ...(targetType === "todo" ? { checked: false } : {}) });
          }
          return;
        }
      }
      if (nextText.trim() === "---") {
        setSlashMenu(null);
        const index = blocks.findIndex((entry) => entry.id === block.id);
        const nextParagraph = createVaultBlock("paragraph", { text: "" });
        const nextBlocks = [...blocks];
        nextBlocks.splice(index, 1, createVaultBlock("divider"), nextParagraph);
        commit(nextBlocks, nextParagraph.id);
        return;
      }
    }

    const slashMatch = /(?:^|\s)\/([^\s/]*)$/.exec(nextText);
    if (slashMatch && block.type !== "code") {
      setSlashMenu({ blockId: block.id, query: slashMatch[1], activeIndex: 0, triggerViaButton: false, placement: slashPlacementFor(block.id) });
    } else if (slashMenu?.blockId === block.id) {
      setSlashMenu(null);
    }
    updateBlock(block.id, { text: nextText });
  }

  async function runSlashCommand(command, blockId) {
    const index = blocks.findIndex((block) => block.id === blockId);
    if (index === -1) return;
    const current = blocks[index];
    const cleanedText = slashMenu?.triggerViaButton
      ? (current.text ?? "")
      : String(current.text ?? "").replace(/(?:^|\s)\/[^\s/]*$/, "").trimEnd();
    setSlashMenu(null);

    if (command.id === "image" || command.id === "file") {
      if (!canAttach || !onPickFiles) return;
      const added = await onPickFiles({ filter: command.id === "image" ? "images" : undefined });
      if (!added?.length) return;
      const mediaBlocks = added.map((file) => {
        const blockType = command.id === "image" || isVaultImageName(file.name) ? "image" : "file";
        return createVaultBlock(blockType, { attachmentId: file.id, name: file.name, caption: "" });
      });
      const trailing = createVaultBlock("paragraph", { text: "" });
      const nextBlocks = [...blocks];
      if (!cleanedText && ["paragraph", "todo", "bullet", "numbered"].includes(current.type)) {
        nextBlocks.splice(index, 1, ...mediaBlocks, trailing);
      } else {
        nextBlocks[index] = { ...current, text: cleanedText };
        nextBlocks.splice(index + 1, 0, ...mediaBlocks, trailing);
      }
      commit(nextBlocks, trailing.id);
      return;
    }

    if (command.id === "divider") {
      const trailing = createVaultBlock("paragraph", { text: "" });
      const nextBlocks = [...blocks];
      if (!cleanedText && ["paragraph", "todo", "bullet", "numbered"].includes(current.type)) {
        nextBlocks.splice(index, 1, createVaultBlock("divider"), trailing);
      } else {
        nextBlocks[index] = { ...current, text: cleanedText };
        nextBlocks.splice(index + 1, 0, createVaultBlock("divider"), trailing);
      }
      commit(nextBlocks, trailing.id);
      return;
    }

    const nextBlocks = [...blocks];
    if (slashMenu?.triggerViaButton && cleanedText) {
      const inserted = createVaultBlock(command.id, { text: "", ...(command.id === "todo" ? { checked: false } : {}) });
      nextBlocks.splice(index + 1, 0, inserted);
      commit(nextBlocks, inserted.id);
      return;
    }
    nextBlocks[index] = createVaultBlock(command.id, { id: current.id, text: cleanedText, ...(command.id === "todo" ? { checked: false } : {}) });
    commit(nextBlocks, current.id);
  }

  function handleBlockKeyDown(event, block, index) {
    if (slashMenu?.blockId === block.id && slashCommands.length > 0) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSlashMenu((current) => current && { ...current, activeIndex: (current.activeIndex + 1) % slashCommands.length });
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSlashMenu((current) => current && { ...current, activeIndex: (current.activeIndex - 1 + slashCommands.length) % slashCommands.length });
        return;
      }
      if (event.key === "Enter" && !event.nativeEvent.isComposing) {
        event.preventDefault();
        void runSlashCommand(slashCommands[slashMenu.activeIndex] ?? slashCommands[0], block.id);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setSlashMenu(null);
        return;
      }
    }

    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && block.type !== "code") {
      event.preventDefault();
      if (["bullet", "numbered", "todo", "quote"].includes(block.type) && !block.text.trim()) {
        updateBlock(block.id, { type: "paragraph", text: "" });
        return;
      }
      const nextType = ["bullet", "numbered", "todo"].includes(block.type) ? block.type : "paragraph";
      const inserted = createVaultBlock(nextType, { text: "", ...(nextType === "todo" ? { checked: false } : {}) });
      const nextBlocks = [...blocks];
      nextBlocks.splice(index + 1, 0, inserted);
      commit(nextBlocks, inserted.id);
      return;
    }

    if (event.key === "Backspace" && !block.text) {
      if (block.type !== "paragraph") {
        event.preventDefault();
        updateBlock(block.id, { type: "paragraph", text: "" });
        return;
      }
      if (blocks.length > 1) {
        event.preventDefault();
        removeBlock(block.id);
        return;
      }
    }

    if (event.key === "ArrowUp" && event.currentTarget.selectionStart === 0 && index > 0) {
      const previous = [...blocks.slice(0, index)].reverse().find((entry) => entry.type !== "divider" && entry.type !== "image" && entry.type !== "file");
      if (previous) {
        event.preventDefault();
        textRefs.current.get(previous.id)?.focus();
      }
    }
    if (event.key === "ArrowDown" && event.currentTarget.selectionEnd === event.currentTarget.value.length && index < blocks.length - 1) {
      const following = blocks.slice(index + 1).find((entry) => entry.type !== "divider" && entry.type !== "image" && entry.type !== "file");
      if (following) {
        event.preventDefault();
        textRefs.current.get(following.id)?.focus();
      }
    }
  }

  let numberedIndex = 0;
  let assignedPrimaryAriaLabel = false;
  const lastTextBlockId = [...blocks].reverse().find((entry) => !["divider", "image", "file"].includes(entry.type))?.id ?? blocks.at(-1)?.id;

  return (
    <div className="vault-note-editor" role="group" aria-label={`${ariaLabel} ${t("vault.note.editorGroupSuffix")}`}>
      <div className="vault-note-toolbar">
        <span className="vault-note-isolation-hint">
          <IconLock size={13} aria-hidden="true" />
          <span>{t("vault.note.encryptedBadge")} · {canAttach ? t("vault.note.insertMediaBtn") : t("vault.note.slashBtn")}</span>
        </span>
        <button
          type="button"
          className="vault-note-slash-trigger"
          disabled={disabled}
          onClick={() => {
            const targetId = lastTextBlockId ?? blocks[0]?.id;
            if (!targetId) return;
            setSlashMenu((current) => current?.blockId === targetId && current.triggerViaButton
              ? null
              : { blockId: targetId, query: "", activeIndex: 0, triggerViaButton: true, placement: slashPlacementFor(targetId) });
          }}
        >
          <IconSlash size={13} aria-hidden="true" />
          <span>{t("vault.note.slashBtn")}</span>
        </button>
      </div>

      <div className="vault-note-blocks">
        {blocks.map((block, index) => {
          if (block.type === "numbered") numberedIndex += 1;
          else numberedIndex = 0;

          const isTextBlock = !["divider", "image", "file"].includes(block.type);
          const blockAriaLabel = isTextBlock && !assignedPrimaryAriaLabel ? ariaLabel : `${ariaLabel} #${index + 1}`;
          if (isTextBlock && !assignedPrimaryAriaLabel) assignedPrimaryAriaLabel = true;
          const fileMeta = block.attachmentId ? attachmentById.get(block.attachmentId) : null;
          const showSlash = slashMenu?.blockId === block.id;

          return (
            <div
              key={block.id}
              ref={(node) => {
                if (node) blockRefs.current.set(block.id, node);
                else blockRefs.current.delete(block.id);
              }}
              className={`vault-note-block is-${block.type}`}
            >
              <div className="vault-note-block-gutter">
                <button
                  type="button"
                  className="vault-note-gutter-btn"
                  title={`${t("vault.note.slashBtn")} (/)`}
                  aria-label={`${t("vault.note.slashBtn")} #${index + 1}`}
                  disabled={disabled}
                  onClick={() => setSlashMenu((current) => current?.blockId === block.id && current.triggerViaButton
                    ? null
                    : { blockId: block.id, query: "", activeIndex: 0, triggerViaButton: true, placement: slashPlacementFor(block.id) })}
                >
                  <IconPlus size={13} />
                </button>
                {(blocks.length > 1 || !isTextBlock) && (
                  <button
                    type="button"
                    className="vault-note-gutter-btn"
                    title={t("common.delete")}
                    aria-label={`${t("common.delete")} #${index + 1}`}
                    disabled={disabled}
                    onClick={() => removeBlock(block.id)}
                  >
                    <IconTrash size={12} />
                  </button>
                )}
              </div>

              <div className="vault-note-block-body">
                {block.type === "divider" && <hr className="vault-note-divider" />}

                {block.type === "image" && (
                  <VaultImagePreview
                    attachmentId={block.attachmentId}
                    itemId={itemId}
                    draftId={draftId}
                    isSavedAttachment={Boolean(savedAttachmentIds?.has(block.attachmentId))}
                    name={fileMeta?.name || block.name}
                    size={fileMeta?.size}
                    caption={block.caption || ""}
                    disabled={disabled}
                    onCaptionChange={(caption) => updateBlock(block.id, { caption })}
                    onRemove={() => removeBlock(block.id)}
                    downloadButton={renderDownload(fileMeta)}
                  />
                )}

                {block.type === "file" && (
                  <div className="vault-note-media-card is-file">
                    <IconFile size={18} className="vault-note-file-icon" aria-hidden="true" />
                    <div className="vault-note-file-meta">
                      <strong title={fileMeta?.name || block.name} dir="auto">{fileMeta?.name || block.name}</strong>
                      <span>
                        <IconLock size={11} aria-hidden="true" /> {t("vault.note.encryptedBadge")}
                        {Number.isFinite(fileMeta?.size) ? ` · ${formatVaultFileSize(fileMeta.size, locale)}` : ""}
                      </span>
                    </div>
                    {renderDownload(fileMeta)}
                    <button
                      type="button"
                      className="mini"
                      title={t("vault.editor.removeAttachment")}
                      aria-label={t("vault.editor.removeAttachmentAria", { name: fileMeta?.name || block.name })}
                      disabled={disabled}
                      onClick={() => removeBlock(block.id)}
                    >
                      <IconTrash size={14} />
                    </button>
                  </div>
                )}

                {isTextBlock && (
                  <div className="vault-note-text-row">
                    {block.type === "bullet" && <span className="vault-note-marker" aria-hidden="true">•</span>}
                    {block.type === "numbered" && <span className="vault-note-marker is-num" aria-hidden="true">{numberedIndex}.</span>}
                    {block.type === "todo" && (
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={block.checked}
                        aria-label={t("vault.note.ph.todo")}
                        className={`vault-note-todo-box${block.checked ? " is-checked" : ""}`}
                        disabled={disabled}
                        onClick={() => updateBlock(block.id, { checked: !block.checked })}
                      >
                        {block.checked && <IconCheck size={12} />}
                      </button>
                    )}
                    {block.type === "callout" && <IconAlertCircle size={16} className="vault-note-callout-icon" aria-hidden="true" />}
                    <AutoGrowTextarea
                      inputRef={(node) => {
                        if (node) textRefs.current.set(block.id, node);
                        else textRefs.current.delete(block.id);
                      }}
                      className={`vault-note-input is-${block.type}${block.type === "todo" && block.checked ? " is-done" : ""}`}
                      value={block.text}
                      placeholder={index === 0 || block.type !== "paragraph" ? t(`vault.note.ph.${block.type}`) : "/"}
                      ariaLabel={blockAriaLabel}
                      disabled={disabled}
                      dataRevealEpoch={revealEpoch}
                      onChange={(event) => handleTextChange(block, event.target.value)}
                      onKeyDown={(event) => handleBlockKeyDown(event, block, index)}
                    />
                  </div>
                )}

                {showSlash && (
                  <div ref={slashMenuRef} className={`vault-slash-menu${slashMenu.placement === "top" ? " is-top" : ""}`} role="listbox" aria-label={t("vault.note.slashBtn")}>
                    <div className="vault-slash-list">
                      {slashCommands.length > 0 ? slashCommands.map((command, cmdIndex) => {
                        const Icon = COMMAND_ICONS[command.id] || IconTypography;
                        return (
                          <button
                            key={command.id}
                            type="button"
                            role="option"
                            aria-selected={cmdIndex === slashMenu.activeIndex}
                            className={`vault-slash-item${cmdIndex === slashMenu.activeIndex ? " is-active" : ""}`}
                            onMouseEnter={() => setSlashMenu((current) => current && { ...current, activeIndex: cmdIndex })}
                            onMouseDown={(event) => {
                              event.preventDefault();
                              void runSlashCommand(command, block.id);
                            }}
                          >
                            <span className="vault-slash-icon"><Icon size={16} aria-hidden="true" /></span>
                            <span className="vault-slash-copy">
                              <strong>{command.label}</strong>
                              <small>{command.description}</small>
                            </span>
                          </button>
                        );
                      }) : <div className="vault-slash-empty">{t("vault.note.noCommands")}</div>}
                    </div>
                    <div className="vault-slash-footer">
                      <IconLock size={12} aria-hidden="true" />
                      <span>{t("vault.note.encryptedBadge")}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {canAttach && (
        <div className="vault-note-foot">
          <span>{t("vault.editor.attachmentHint")}</span>
        </div>
      )}
    </div>
  );
}
