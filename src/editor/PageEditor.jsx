import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useResolvedTheme } from "../ui/useResolvedTheme.js";
import { isAltGraphKeyboardEvent, isComposingKeyboardEvent } from "../ui/keyboard.js";
import { SuggestionMenuController, useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import { zh } from "@blocknote/core/locales";
import { getMentionMenuItems, getPageLinkMenuItems, getPlusMenuItems, ReminderDialog } from "./Mentions.jsx";
import { syntaxHighlighter } from "@blocknote/code-block";
import { TabPanelsExtension } from "./TabPanelsExtension.js";
import { ColumnWidthsExtension } from "./ColumnWidthsExtension.js";
import { ColumnEditingExtension } from "./ColumnEditingExtension.js";
import { BlockInteractionsExtension, placePassiveEditorCaret } from "./BlockInteractionsExtension.js";
import { LayoutTrailingExtension } from "./LayoutTrailingExtension.js";
import { CalloutEnterExtension } from "./CalloutEnterExtension.js";
import { BlockFocusExtension, setEditorBlockFocus } from "./BlockFocusExtension.js";
import { LifeAtlasSideMenuController } from "./LifeAtlasSideMenuController.jsx";
import "./coreParity.css";
import { redo as redoCommand, undo as undoCommand } from "@tiptap/pm/history";
import { NodeSelection, Selection, TextSelection } from "@tiptap/pm/state";
import { TableCellControls } from "./TableCellControls.jsx";
import { restoreTableHeaders, simpleTableOptions } from "./simpleTableCells.js";
import { resolveAttachmentMediaUrl } from "../domain/attachmentUrls.js";
import { attachmentIdFromUrl } from "../domain/attachments.js";
import { SUGGESTION_MENU_FLOATING } from "./suggestionMenuFloating.js";
import { CodeBlockCopyButton } from "./CodeBlockCopyButton.jsx";
import { duplicateEditorBlocks } from "./LifeAtlasDragHandleMenu.jsx";
import { ownsEditorKeyboardTarget, topLevelEditorBlocks } from "./editorCommandContext.js";
import { removeEditorBlocks } from "./blockDrag.js";
import { InlineEquationDialog } from "./InlineEquation.jsx";
import { MoveBlockDialog } from "./MoveBlockDialog.jsx";
import { isAllowedEditorLink, parseBlockLink } from "./links.js";
import { isRemoteUrl, resolveEditorFileUrl } from "./remoteMedia.js";
import { revealEditorBlock } from "./revealEditorBlock.js";
import {
  LifeAtlasEditorRuntimeContext,
  filterLifeAtlasSlashMenuItems,
  lifeAtlasSchema,
} from "./lifeAtlasSchema.jsx";

const columnsVisualQaContent = [
  {
    type: "heading",
    props: { level: 2 },
    content: "多栏布局",
  },
  {
    type: "paragraph",
    content: "每一栏都是独立的 Block 容器；默认无分界线，悬停栏间区域可调整宽度。",
  },
  {
    type: "columnList",
    props: { columns: 3 },
    children: [
      {
        type: "column",
        props: { width: 52, index: 0, count: 3 },
        children: [
          { type: "heading", props: { level: 3 }, content: "研究" },
          { type: "paragraph", content: "记录论文、想法与长期主题。" },
          { type: "bulletListItem", content: "文献阅读" },
          { type: "bulletListItem", content: "实验记录" },
        ],
      },
      {
        type: "column",
        props: { width: 28, index: 1, count: 3 },
        children: [
          { type: "heading", props: { level: 3 }, content: "本周" },
          { type: "checkListItem", props: { checked: true }, content: "整理数据库" },
          { type: "checkListItem", props: { checked: false }, content: "复盘笔记" },
        ],
      },
      {
        type: "column",
        props: { width: 20, index: 2, count: 3 },
        children: [
          { type: "heading", props: { level: 3 }, content: "灵感" },
          { type: "paragraph", content: "每栏都可以继续添加任意区块。" },
        ],
      },
    ],
  },
];

function walkBlocks(blocks, visit) {
  for (const block of blocks || []) {
    visit(block);
    walkBlocks(block.children, visit);
  }
}

export function PageEditor({
  pageId,
  initialContent,
  onChange,
  locked = false,
  onEditorApiChange,
  onHistoryStateChange,
  databaseRuntime = null,
  focusBlockId = null,
  onBlockFocused,
  presentation = false,
}) {
  const resolvedTheme = useResolvedTheme();
  const runtimeRef = useRef(databaseRuntime);
  runtimeRef.current = databaseRuntime;
  const blockFocusedCallback = useRef(onBlockFocused);
  blockFocusedCallback.current = onBlockFocused;
  const statusTimer = useRef(null);
  const [status, setStatus] = useState("");
  const [insertDialog, setInsertDialog] = useState(null);
  const [moveDialog, setMoveDialog] = useState(null);
  const [selectionActivated, setSelectionActivated] = useState(false);
  const showEditorStatus = useCallback((message) => {
    window.clearTimeout(statusTimer.current);
    setStatus(message);
    statusTimer.current = window.setTimeout(() => setStatus(""), 2000);
  }, []);
  const openExternalUrl = useCallback((url) => {
    if (window.lifeAtlas?.platform === "desktop") {
      Promise.resolve(window.lifeAtlas.app.openExternal({ url })).catch(() => showEditorStatus("未能打开外部链接"));
    } else window.open(url, "_blank", "noopener,noreferrer");
  }, [showEditorStatus]);
  const handleLinkClick = useCallback((event) => {
    const target = event.target instanceof Element ? event.target : event.target?.parentElement;
    const link = target?.closest("a[href]");
    const href = link?.getAttribute("href");
    if (!href) return false;
    const blockLink = parseBlockLink(href);
    if (blockLink) {
      event.preventDefault();
      event.stopPropagation();
      runtimeRef.current?.openPageAt?.(blockLink.pageId, blockLink.blockId);
      return true;
    }
    if (/^(?:https?|mailto):/i.test(href)) {
      event.preventDefault();
      event.stopPropagation();
      openExternalUrl(href);
      return true;
    }
    return false;
  }, [openExternalUrl]);
  const resolveFileUrl = useCallback((url) => isRemoteUrl(url) ? resolveEditorFileUrl(url) : resolveAttachmentMediaUrl(url, runtimeRef.current), []);
  const uploadFile = useCallback(async (file) => {
    if (!databaseRuntime?.createEditorAttachment) throw new Error("当前页面没有可用的本地附件提供器");
    const created = await databaseRuntime.createEditorAttachment(file);
    if (!created?.url) throw new Error("附件提供器没有返回可渲染引用");
    return created.url;
  }, [databaseRuntime]);
  const columnsVisualQa =
    !presentation && import.meta.env.DEV &&
    new URLSearchParams(window.location.search).get("columns") === "1";

  const editor = useCreateBlockNote(
    {
      initialContent:
        columnsVisualQa
          ? columnsVisualQaContent
          : Array.isArray(initialContent) && initialContent.length > 0
          ? initialContent
          : [{ type: "paragraph", content: "" }],
      dictionary: zh,
      uploadFile,
      resolveFileUrl,
      schema: lifeAtlasSchema,
      disableExtensions: ["sideMenu", "dropCursor", "trailingNode"],
      extensions: [ColumnEditingExtension(), CalloutEnterExtension(), TabPanelsExtension, ColumnWidthsExtension, BlockInteractionsExtension(), LayoutTrailingExtension(), BlockFocusExtension, syntaxHighlighter],
      links: { isValidLink: isAllowedEditorLink, onClick: handleLinkClick },
      tables: simpleTableOptions,
    },
    [pageId, columnsVisualQa],
  );

  useLayoutEffect(() => {
    restoreTableHeaders(editor, initialContent);
    placePassiveEditorCaret(editor);
  }, [editor]);

  useEffect(() => { setSelectionActivated(false); }, [editor]);

  const editorRuntime = useMemo(() => ({
    ...databaseRuntime,
    locked,
    pageId,
    handleEditorLinkClick: handleLinkClick,
    openEditorExternalUrl: openExternalUrl,
    openInlineEquationDialog: (targetEditor = editor) => {
      if (!locked && targetEditor.isEditable) setInsertDialog({ kind: "inlineEquation", editor: targetEditor });
    },
    openReminderDialog: (targetEditor = editor) => {
      if (!locked && targetEditor.isEditable) setInsertDialog({ kind: "reminder", editor: targetEditor });
    },
    openBlockMoveDialog: (blocks, targetEditor = editor) => {
      if (!locked && targetEditor.isEditable && blocks.length) setMoveDialog({ blocks, editor: targetEditor });
    },
    showEditorStatus,
  }), [databaseRuntime, editor, handleLinkClick, locked, openExternalUrl, pageId, showEditorStatus]);

  useEffect(() => () => window.clearTimeout(statusTimer.current), []);

  useEffect(() => {
    setInsertDialog(null);
    setMoveDialog(null);
  }, [editor, locked]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (presentation || runtime?.platform !== "browser" || !runtime.resolveEditorAttachmentUrl) return undefined;
    const repairs = [];
    walkBlocks(editor.document, (block) => {
      const url = block.props?.url;
      if (typeof url !== "string" || !/^blob:/i.test(url)) return;
      const attachmentId = attachmentIdFromUrl(url);
      const attachment = runtime.workspace?.attachments?.find((entry) => entry.id === attachmentId);
      if (attachmentId && attachment?.provider === "local-ref") repairs.push({ block, attachmentId, url });
    });
    let alive = true;
    const repairUrl = async (repair) => {
      try {
        const freshUrl = await runtimeRef.current?.resolveEditorAttachmentUrl?.(repair.attachmentId);
        if (alive && freshUrl && freshUrl !== repair.url && /^blob:/i.test(freshUrl) && attachmentIdFromUrl(freshUrl) === repair.attachmentId && editor.getBlock(repair.block.id)?.props.url === repair.url) {
          editor.updateBlock(repair.block, { props: { url: freshUrl } });
        }
      } catch {}
    };
    repairs.forEach((repair) => { void repairUrl(repair); });
    return () => { alive = false; };
  }, [editor, databaseRuntime?.workspace?.attachments, presentation]);

  useEffect(() => {
    if (!focusBlockId) return undefined;
    let highlightTimer;
    let focusFrame;
    let highlighted = false;
    const frame = requestAnimationFrame(() => {
      focusFrame = revealEditorBlock(editor.prosemirrorView.dom, focusBlockId, () => {
        setEditorBlockFocus(editor, focusBlockId);
        highlighted = true;
        highlightTimer = window.setTimeout(() => { setEditorBlockFocus(editor, null); blockFocusedCallback.current?.(); }, 1200);
      });
      if (focusFrame === undefined) blockFocusedCallback.current?.();
    });
    return () => { cancelAnimationFrame(frame); if (focusFrame !== undefined) cancelAnimationFrame(focusFrame); window.clearTimeout(highlightTimer); if (highlighted) setEditorBlockFocus(editor, null); };
  }, [editor, focusBlockId]);

  const reportHistory = useCallback(() => {
    onHistoryStateChange?.({
      canUndo: editor.canExec(undoCommand),
      canRedo: editor.canExec(redoCommand),
    });
  }, [editor, onHistoryStateChange]);

  useEffect(() => {
    editor.isEditable = !locked;
  }, [editor, locked]);

  useEffect(() => {
    const scrollingContainer = () => editor.prosemirrorView.dom.closest(".record-peek-body, .workspace-scroll");
    const api = {
      getViewState() {
        const view = editor.prosemirrorView;
        if (view.hasFocus() && !view.composing) view.domObserver.flush();
        const scroll = scrollingContainer();
        return { selection: view.state.selection.toJSON(), scrollTop: scroll?.scrollTop || 0, scrollLeft: scroll?.scrollLeft || 0 };
      },
      restoreViewState(state) {
        if (!state) return;
        const scroll = scrollingContainer();
        if (scroll && Number.isFinite(state.scrollTop) && Number.isFinite(state.scrollLeft)) {
          scroll.scrollTo({ top: state.scrollTop, left: state.scrollLeft, behavior: "instant" });
        }
        if (!state.selection) return;
        try {
          editor.transact((tr) => {
            const selection = Selection.fromJSON(tr.doc, state.selection);
            if (selection instanceof TextSelection && (!selection.$anchor.parent.inlineContent || !selection.$head.parent.inlineContent)) return;
            if (selection instanceof NodeSelection && !NodeSelection.isSelectable(selection.node)) return;
            if (!selection.eq(tr.selection)) tr.setSelection(selection).setMeta("addToHistory", false);
          });
        } catch { /* The saved position can disappear when the document changes. */ }
      },
      focus() { editor.focus(); },
      undo() {
        const changed = editor.undo();
        reportHistory();
        return changed;
      },
      redo() {
        const changed = editor.redo();
        reportHistory();
        return changed;
      },
      getHistoryState() {
        return {
          canUndo: editor.canExec(undoCommand),
          canRedo: editor.canExec(redoCommand),
        };
      },
    };
    onEditorApiChange?.(api);
    reportHistory();
    const unsubscribe = editor.onChange(() => reportHistory());
    return () => {
      unsubscribe?.();
      onEditorApiChange?.(null);
    };
  }, [editor, onEditorApiChange, reportHistory]);

  const slashItems = useCallback(
    async (query) => filterLifeAtlasSlashMenuItems(editor, editorRuntime, query),
    [editor, editorRuntime],
  );

  return (
    <LifeAtlasEditorRuntimeContext.Provider value={editorRuntime}>
      <div className={`life-editor document-canvas ${locked ? "is-locked" : ""} ${selectionActivated ? "has-editor-selection" : ""}`} data-page-id={pageId} data-editor-surface="blocks" onFocusCapture={(event) => {
        if (event.target === editor.prosemirrorView.dom || editor.portalElement.contains(event.target) && event.target.closest?.(".life-block-handle")) setSelectionActivated(true);
      }} onKeyDownCapture={(event) => {
        const view = editor.prosemirrorView;
        if (locked || isComposingKeyboardEvent(event) || view.composing || isAltGraphKeyboardEvent(event) || !ownsEditorKeyboardTarget(editor, event.target)) return;
        if ((event.ctrlKey || event.metaKey) && !event.altKey && !view.composing && view.hasFocus()) view.domObserver.flush();
        if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "d") {
          event.preventDefault();
          event.stopPropagation();
          duplicateEditorBlocks(editor);
        }
      }} onClickCapture={(event) => {
        if (locked && event.target.closest?.("a[href]")) { event.preventDefault(); handleLinkClick(event); }
      }} onDoubleClick={(event) => {
        const outer = event.target.closest?.(".bn-block-outer");
        const block = outer?.dataset.id ? editor.getBlock(outer.dataset.id) : null;
        if (isRemoteUrl(block?.props.url)) { event.preventDefault(); openExternalUrl(block.props.url); }
      }}>
        <BlockNoteView
          editor={editor}
          theme={resolvedTheme}
          editable={!locked}
          formattingToolbar={false}
          tableHandles={false}
          slashMenu={false}
          sideMenu={false}
          onChange={() => {
            if (!presentation) onChange?.(editor.document);
            reportHistory();
          }}
        >
          {!locked && <TableCellControls />}
          {!presentation && <LifeAtlasSideMenuController />}
          <CodeBlockCopyButton />
          <SuggestionMenuController triggerCharacter="/" getItems={slashItems} floatingUIOptions={SUGGESTION_MENU_FLOATING} />
          <SuggestionMenuController triggerCharacter="@" getItems={(query) => getMentionMenuItems(editor, query, editorRuntime)} floatingUIOptions={SUGGESTION_MENU_FLOATING} />
          <SuggestionMenuController triggerCharacter="[[" getItems={(query) => getPageLinkMenuItems(editor, query, editorRuntime)} floatingUIOptions={SUGGESTION_MENU_FLOATING} />
          <SuggestionMenuController triggerCharacter="+" shouldOpen={(tr) => tr.selection.$from.parent.type.name === "paragraph" && tr.selection.$from.parent.textContent === ""} getItems={(query) => getPlusMenuItems(editor, query, editorRuntime)} floatingUIOptions={SUGGESTION_MENU_FLOATING} />
        </BlockNoteView>
      </div>
      {status && <div className="life-editor-status" role="status">{status}</div>}
      {insertDialog?.kind === "inlineEquation" && <InlineEquationDialog onClose={() => setInsertDialog(null)} onConfirm={(expression) => {
        if (!locked && insertDialog.editor.isEditable) insertDialog.editor.insertInlineContent([{ type: "inlineEquation", props: { expression } }, " "]);
        setInsertDialog(null);
      }} />}
      {insertDialog?.kind === "reminder" && <ReminderDialog onClose={() => setInsertDialog(null)} onConfirm={(value) => {
        if (!locked && insertDialog.editor.isEditable) insertDialog.editor.insertInlineContent([{ type: "dateMention", props: { value, kind: "reminder", reminderId: `rem-${crypto.randomUUID()}` } }, " "]);
        setInsertDialog(null);
      }} />}
      {moveDialog && <MoveBlockDialog workspace={databaseRuntime?.workspace} currentPageId={pageId} onClose={() => setMoveDialog(null)} onMove={(targetPageId) => {
        if (locked || !moveDialog.editor.isEditable) return;
        const target = runtimeRef.current?.workspace?.pages?.find((page) => page.id === targetPageId && !page.trashedAt);
        if (!target || target.settings?.locked) throw new Error("目标页面不存在、已锁定或已在回收站");
        const blocks = topLevelEditorBlocks(moveDialog.editor, moveDialog.blocks.map((block) => block.id));
        if (!blocks.length) return;
        if (!runtimeRef.current?.appendBlocksToPage) throw new Error("当前页面无法移动区块");
        const removed = removeEditorBlocks(moveDialog.editor, blocks.map((block) => block.id), { focus: false });
        if (!removed.ok) throw new Error(removed.message || "区块内容已变化，移动已取消");
        try { runtimeRef.current.appendBlocksToPage(targetPageId, blocks); }
        catch (error) {
          if (removed.changed) moveDialog.editor.exec(undoCommand);
          throw error;
        }
      }} />}
    </LifeAtlasEditorRuntimeContext.Provider>
  );
}
