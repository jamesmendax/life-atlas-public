import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Menu } from "@mantine/core";
import { SuggestionMenu } from "@blocknote/core/extensions";
import { useBlockNoteEditor } from "@blocknote/react";
import IconGripVertical from "@tabler/icons-react/dist/esm/icons/IconGripVertical.mjs";
import IconPlus from "@tabler/icons-react/dist/esm/icons/IconPlus.mjs";
import { LifeAtlasEditorRuntimeContext } from "./EditorRuntime.jsx";
import { LifeAtlasDragHandleMenu, selectedEditorBlocks } from "./LifeAtlasDragHandleMenu.jsx";
import { convertEditorBlocks } from "./blockCommands.js";
import { beginEditorBlockDrag, cancelEditorBlockDrag } from "./blockDrag.js";
import { runEditorTransaction } from "./editorTransactions.js";
import { ownsEditorKeyboardTarget } from "./editorCommandContext.js";
import { isAltGraphKeyboardEvent, isComposingKeyboardEvent } from "../ui/keyboard.js";

const conversionKeys = ["paragraph", "heading-1", "heading-2", "heading-3", "checkListItem", "bulletListItem", "numberedListItem", "toggleListItem", "codeBlock", "quote"];
const structuralTypes = new Set(["column", "columnList"]);

function blockContent(outer) {
  return outer?.querySelector(":scope > .bn-block > .bn-block-content, :scope > .bn-block > .react-renderer > .bn-block-content");
}

function currentEditorBlock(editor) {
  try { return editor.getTextCursorPosition().block; }
  catch { return editor.getSelection()?.blocks?.[0] ?? null; }
}

export function LifeAtlasSideMenuController() {
  const editor = useBlockNoteEditor();
  const runtime = useContext(LifeAtlasEditorRuntimeContext);
  const [anchor, setAnchor] = useState(null);
  const [opened, setOpened] = useState(false);
  const [selectionIds, setSelectionIds] = useState([]);
  const [, setRevision] = useState(0);
  const stateRef = useRef({ opened, anchor, runtime });
  stateRef.current = { opened, anchor, runtime };
  const actionRef = useRef(null);
  const contextFocus = useRef(null);
  const dragging = useRef(false);
  const frame = useRef(null);
  const locked = Boolean(runtime?.locked || !editor.isEditable);

  const positionBlock = useCallback((blockId) => {
    const view = editor.prosemirrorView;
    if (!view || view.isDestroyed) return;
    const block = editor.getBlock(blockId);
    if (!block || structuralTypes.has(block.type)) return;
    const outer = view.dom.querySelector(`.bn-block-outer[data-id="${CSS.escape(blockId)}"]`);
    const content = blockContent(outer);
    if (!content || outer.closest(".bn-editor") !== view.dom) return;
    const rect = content.getBoundingClientRect();
    if (!rect.width || (!rect.height && block.type !== "divider")) return;
    const lineHeight = Number.parseFloat(getComputedStyle(content).lineHeight) || 24;
    const next = {
      blockId,
      left: Math.max(4, rect.left - 42),
      top: rect.top + Math.max(0, Math.min(lineHeight, rect.height) - 24) / 2,
      right: rect.right,
      bottom: rect.bottom,
    };
    setAnchor((previous) => previous?.blockId === next.blockId && previous.left === next.left && previous.top === next.top && previous.bottom === next.bottom && previous.right === next.right ? previous : next);
  }, [editor]);

  useEffect(() => {
    const refresh = () => {
      setRevision((revision) => revision + 1);
      const blockId = stateRef.current.anchor?.blockId;
      if (blockId && editor.getBlock(blockId)) positionBlock(blockId);
      else { setOpened(false); setAnchor(null); }
    };
    return editor.onChange(refresh);
  }, [editor, positionBlock]);

  useEffect(() => {
    const view = editor.prosemirrorView;
    const documentNode = view.dom.ownerDocument;
    const windowNode = documentNode.defaultView;
    let pendingPointer = null;
    const isOwnAction = (target) => Boolean(actionRef.current?.contains(target));
    const handlePointer = () => {
      frame.current = null;
      const event = pendingPointer;
      const state = stateRef.current;
      if (!event || state.runtime?.locked || !editor.isEditable || state.opened || dragging.current || event.buttons) return;
      const target = event.target instanceof Element ? event.target : null;
      if (isOwnAction(target)) return;
      const ownEditor = target?.closest(".bn-editor");
      if (ownEditor === view.dom) {
        const outer = target.closest(".bn-block-outer[data-id]");
        const block = outer ? editor.getBlock(outer.dataset.id) : null;
        if (block && !structuralTypes.has(block.type)) { positionBlock(block.id); return; }
      }
      const active = state.anchor;
      const insideBridge = active && event.clientX >= active.left - 3 && event.clientX <= active.left + 65 && event.clientY >= active.top - 6 && event.clientY <= active.top + 32;
      if (!insideBridge && !isOwnAction(documentNode.activeElement)) setAnchor(null);
    };
    const pointerMove = (event) => {
      pendingPointer = event;
      if (frame.current === null) frame.current = windowNode.requestAnimationFrame(handlePointer);
    };
    const updatePosition = () => {
      const blockId = stateRef.current.anchor?.blockId;
      if (blockId) positionBlock(blockId);
    };
    const onImageContextMenu = (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target?.matches("img.bn-visual-media") || target.closest(".bn-editor") !== view.dom) return;
      const outer = target.closest(".bn-block-outer[data-id]");
      const block = outer && editor.getBlock(outer.dataset.id);
      if (block?.type !== "image") return;
      event.preventDefault();
      event.stopPropagation();
      contextFocus.current = documentNode.activeElement;
      positionBlock(block.id);
      setSelectionIds([block.id]);
      setOpened(true);
    };
    const onKeyDown = (event) => {
      if (stateRef.current.runtime?.locked || isAltGraphKeyboardEvent(event) || !ownsEditorKeyboardTarget(editor, event.target)) return;
      const menuRequested = event.key === "ContextMenu" || (event.shiftKey && event.key === "F10");
      const digit = /^\d$/.test(event.key) ? Number(event.key) : -1;
      const conversionRequested = (event.ctrlKey || event.metaKey) && event.altKey && !event.shiftKey && digit >= 0;
      const duplicateRequested = (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "d";
      if (isComposingKeyboardEvent(event) || view.composing) {
        if (menuRequested || conversionRequested || duplicateRequested) { event.preventDefault(); event.stopPropagation(); }
        return;
      }
      if (!menuRequested && !conversionRequested) return;
      const block = currentEditorBlock(editor);
      if (!block || structuralTypes.has(block.type)) return;
      const blockIds = selectedEditorBlocks(editor).map((entry) => entry.id);
      if (menuRequested) {
        event.preventDefault();
        event.stopPropagation();
        positionBlock(block.id);
        setSelectionIds(blockIds);
        setOpened(true);
        return;
      }
      if (conversionRequested) {
        event.preventDefault();
        event.stopPropagation();
        const result = convertEditorBlocks(editor, blockIds, conversionKeys[digit]);
        if (!result.ok) stateRef.current.runtime?.showEditorStatus?.(result.message);
        positionBlock(block.id);
      }
    };
    documentNode.addEventListener("pointermove", pointerMove, true);
    documentNode.addEventListener("scroll", updatePosition, true);
    view.dom.addEventListener("keydown", onKeyDown, true);
    view.dom.addEventListener("contextmenu", onImageContextMenu, true);
    windowNode.addEventListener("resize", updatePosition);
    return () => {
      documentNode.removeEventListener("pointermove", pointerMove, true);
      documentNode.removeEventListener("scroll", updatePosition, true);
      view.dom.removeEventListener("keydown", onKeyDown, true);
      view.dom.removeEventListener("contextmenu", onImageContextMenu, true);
      windowNode.removeEventListener("resize", updatePosition);
      if (frame.current !== null) windowNode.cancelAnimationFrame(frame.current);
      frame.current = null;
      cancelEditorBlockDrag(editor);
    };
  }, [editor, positionBlock]);

  useEffect(() => {
    if (!locked) return;
    setOpened(false);
    setAnchor(null);
    dragging.current = false;
    cancelEditorBlockDrag(editor);
  }, [editor, locked]);

  const block = anchor ? editor.getBlock(anchor.blockId) : null;
  if (!block || (locked && !opened)) return null;

  const changeOpened = (next) => {
    if (next) {
      const blocks = selectedEditorBlocks(editor, block);
      const current = currentEditorBlock(editor);
      if (!blocks.some((entry) => entry.id === current?.id)) editor.setTextCursorPosition(block.id, "start");
      setSelectionIds(blocks.map((entry) => entry.id));
    }
    setOpened(next);
  };

  const restoreFocusAfterMenu = (closingOnEscape = false) => {
    const view = editor.prosemirrorView;
    if ((!closingOnEscape && stateRef.current.opened) || !view || view.isDestroyed || stateRef.current.runtime?.locked || !editor.isEditable || view.composing) return;
    const focused = view.dom.ownerDocument.activeElement;
    if (!focused || focused === view.dom.ownerDocument.body || actionRef.current?.contains(focused)) {
      if (contextFocus.current?.isConnected && contextFocus.current !== view.dom.ownerDocument.body) contextFocus.current.focus();
      else if (editor.isEditable) view.focus();
    }
    contextFocus.current = null;
  };

  const addBlock = () => {
    const current = editor.getBlock(block.id);
    if (!current || structuralTypes.has(current.type)) return;
    const emptyParagraph = current.type === "paragraph" && Array.isArray(current.content) && current.content.length === 0;
    if (emptyParagraph) editor.setTextCursorPosition(current.id, "start");
    else {
      const result = runEditorTransaction(editor, "insert:paragraph", () => {
        const inserted = editor.insertBlocks([{ type: "paragraph" }], current.id, "after")[0];
        editor.setTextCursorPosition(inserted.id, "start");
      }, { preserveSelection: false, focus: true });
      if (!result.ok) { runtime?.showEditorStatus?.(result.message); return; }
    }
    editor.focus();
    editor.getExtension(SuggestionMenu).openSuggestionMenu("/");
  };

  return createPortal(<div ref={actionRef} className="bn-side-menu life-block-actions" role="toolbar" aria-label="区块操作" data-block-id={block.id} style={{ position: "fixed", left: anchor.left, top: anchor.top }}>
    {!locked && <button type="button" className="bn-button life-block-action" aria-label="添加区块" title="在下方添加区块" onMouseDown={(event) => event.preventDefault()} onClick={addBlock}><IconPlus size={17} stroke={1.7} data-test="dragHandleAdd" /></button>}
    <Menu opened={opened} onChange={changeOpened} onExitTransitionEnd={restoreFocusAfterMenu} position="bottom-start" width={232} withinPortal={false} returnFocus={false} closeOnEscape={false} transitionProps={{ duration: 90 }}>
      <Menu.Target><button type="button" className="bn-button life-block-action life-block-handle" aria-label="区块菜单" title="点击打开区块菜单，拖动移动区块" style={locked ? { visibility: "hidden" } : undefined} draggable={!locked} onDragStart={(event) => {
        setOpened(false);
        dragging.current = true;
        const result = beginEditorBlockDrag(editor, event.nativeEvent, selectedEditorBlocks(editor, block).map((entry) => entry.id));
        if (result === false || result?.ok === false) { event.preventDefault(); dragging.current = false; }
      }} onDragEnd={() => { dragging.current = false; cancelEditorBlockDrag(editor); }}><IconGripVertical size={18} stroke={1.7} data-test="dragHandle" /></button></Menu.Target>
      <LifeAtlasDragHandleMenu block={block} blockIds={selectionIds.length ? selectionIds : [block.id]} opened={opened} onDismiss={() => {
        changeOpened(false);
        // Restore the retained editor selection before the next key, not after the exit animation.
        restoreFocusAfterMenu(true);
      }} />
    </Menu>
  </div>, editor.portalElement);
}
