import { useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { useResolvedTheme } from "../ui/useResolvedTheme.js";
import { isAltGraphKeyboardEvent, isComposingKeyboardEvent } from "../ui/keyboard.js";
import { SuggestionMenuController, useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import { zh } from "@blocknote/core/locales";
import { syntaxHighlighter } from "@blocknote/code-block";
import { blockContext, changeTab, cloneBlockDocument, copyJson, stableJson, walkBlocks } from "../domain/blockDocument.js";
import { LifeAtlasEditorRuntimeContext } from "./EditorRuntime.jsx";
import { TabPanelsExtension } from "./TabPanelsExtension.js";
import { ColumnWidthsExtension } from "./ColumnWidthsExtension.js";
import { BlockInteractionsExtension, placePassiveEditorCaret } from "./BlockInteractionsExtension.js";
import { LayoutTrailingExtension } from "./LayoutTrailingExtension.js";
import { CalloutEnterExtension } from "./CalloutEnterExtension.js";
import { LifeAtlasSideMenuController } from "./LifeAtlasSideMenuController.jsx";
import { duplicateEditorBlocks } from "./LifeAtlasDragHandleMenu.jsx";
import { ownsEditorKeyboardTarget } from "./editorCommandContext.js";
import { CodeBlockCopyButton } from "./CodeBlockCopyButton.jsx";
import { getPageLinkMenuItems, getPlusMenuItems } from "./Mentions.jsx";
import { SUGGESTION_MENU_FLOATING } from "./suggestionMenuFloating.js";
import { isAllowedEditorLink } from "./links.js";
import { isRemoteUrl, resolveEditorFileUrl } from "./remoteMedia.js";
import { useDialogs } from "../ui/DialogProvider.jsx";
import { resolveAttachmentMediaUrl } from "../domain/attachmentUrls.js";
import { TableCellControls } from "./TableCellControls.jsx";
import { restoreTableHeaders, simpleTableOptions } from "./simpleTableCells.js";

function useDocumentRevision(editor) {
  const [, update] = useState(0);
  useEffect(() => editor.onChange(() => update((revision) => revision + 1)), [editor]);
}

function firstEditable(blocks) {
  return walkBlocks(blocks).find((block) => !["tabs", "tabPanel", "columnList", "column", "syncedBlock", "databaseView"].includes(block.type));
}

export function TabsHeader({ block, editor }) {
  const dialogs = useDialogs();
  useDocumentRevision(editor);
  const runtime = useContext(LifeAtlasEditorRuntimeContext);
  const locked = runtime?.locked || !editor.isEditable;
  const current = editor.getBlock(block.id) || block;
  const panels = current.children || [];
  const activeId = current.props.activeTabId || panels[0]?.props.tabId;
  const active = panels.find((panel) => panel.props.tabId === activeId) || panels[0];
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState("");
  const rootRef = useRef(null);
  const commit = (action) => {
    if (locked && action.type !== "activate") return;
    const updated = changeTab(editor.getBlock(block.id) || current, action);
    // Move the document cursor before hiding/removing its current panel. Toolbar
    // focus is restored below, so keyboard selection never remains in hidden text.
    if (["activate", "delete"].includes(action.type)) {
      const target = updated.children.find((panel) => panel.props.tabId === updated.props.activeTabId);
      const editable = firstEditable(target?.children);
      if (editable && editor.getBlock(editable.id)) editor.setTextCursorPosition(editable.id, "start");
    }
    editor.updateBlock(block.id, { props: updated.props, children: updated.children });
    setEditingName(false);
    requestAnimationFrame(() => rootRef.current?.querySelector(`[data-tab-id="${updated.props.activeTabId}"]`)?.focus());
  };
  const switchKey = (event, id) => {
    const index = panels.findIndex((panel) => panel.props.tabId === id);
    let next = index;
    if (event.key === "ArrowRight" || (event.ctrlKey && event.key === "PageDown")) next = (index + 1) % panels.length;
    else if (event.key === "ArrowLeft" || (event.ctrlKey && event.key === "PageUp")) next = (index + panels.length - 1) % panels.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = panels.length - 1;
    else return;
    event.preventDefault();
    event.stopPropagation();
    commit({ type: "activate", tabId: panels[next].props.tabId });
  };
  return <div className="life-tabs-header" ref={rootRef} contentEditable={false}>
    <div className="life-tabs-strip" role="tablist" aria-label="内容标签页">
      {panels.map((panel) => <button type="button" key={panel.props.tabId} id={`tab-${panel.props.tabId}`} data-tab-id={panel.props.tabId}
        role="tab" aria-selected={panel.props.tabId === activeId} aria-controls={`panel-${panel.props.tabId}`}
        tabIndex={panel.props.tabId === activeId ? 0 : -1} className={panel.props.tabId === activeId ? "is-active" : ""}
        onClick={() => commit({ type: "activate", tabId: panel.props.tabId })} onKeyDown={(event) => switchKey(event, panel.props.tabId)}>{panel.props.icon}{panel.props.label}</button>)}
      {!locked && <button type="button" aria-label="添加标签页" className="life-tab-add" onClick={() => commit({ type: "add" })}>＋</button>}
      {!locked && active && <details className="life-tab-menu"><summary aria-label="标签页操作">···</summary><div>
        <button type="button" onClick={(event) => { event.currentTarget.closest("details").open = false; setName(active.props.label); setEditingName(true); }}>重命名标签</button>
        <button type="button" onClick={() => commit({ type: "move", tabId: activeId, offset: -1 })}>向左移动</button>
        <button type="button" onClick={() => commit({ type: "move", tabId: activeId, offset: 1 })}>向右移动</button>
        <button type="button" onClick={() => editor.insertBlocks(cloneBlockDocument([current]), block.id, "after")}>复制标签容器</button>
        <button type="button" disabled={panels.length <= 1} onClick={async () => {
          const hasText = JSON.stringify(active.children || []).replace(/"id":"[^"]*"/g, "");
          if (!hasText.includes('"text":"') || await dialogs.confirm({ title: `删除「${active.props.label}」及其内容？`, description: "可用撤销恢复。", confirmLabel: "删除标签", danger: true })) commit({ type: "delete", tabId: activeId });
        }}>删除当前标签</button>
      </div></details>}
    </div>
    {editingName && <form className="life-tab-rename" onSubmit={(event) => { event.preventDefault(); commit({ type: "rename", tabId: activeId, label: name }); }}>
      <input autoFocus aria-label="标签名称" value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { event.stopPropagation(); if (event.key === "Escape") setEditingName(false); }} />
      <button type="submit">保存</button><button type="button" onClick={() => setEditingName(false)}>取消</button>
    </form>}
  </div>;
}

export function TabPanelMarker({ block, editor }) {
  useDocumentRevision(editor);
  const parent = blockContext(editor.document, block.id)?.parent;
  const active = !parent || parent.props.activeTabId === block.props.tabId || (!parent.props.activeTabId && parent.children?.[0]?.id === block.id);
  return <div className="life-tab-panel-marker" data-active={active} contentEditable={false}>
    {editor.isEditable && <button type="button" aria-label={`在 ${block.props.label} 中添加区块`} onClick={() => {
      const panel = editor.getBlock(block.id) || block;
      const children = [...(panel.children || []), { type: "paragraph", content: "" }];
      const next = editor.updateBlock(block.id, { children });
      const last = next.children?.at(-1);
      if (last) { editor.setTextCursorPosition(last.id, "start"); editor.focus(); }
    }}>＋ 添加区块</button>}
  </div>;
}

function CanonicalSourceEditor({ source, store, schema, getSlashItems, getMentionItems, runtime }) {
  const resolvedTheme = useResolvedTheme();
  const runtimeRef = useRef(runtime);
  runtimeRef.current = runtime;
  const resolveFileUrl = useCallback((url) => isRemoteUrl(url) ? resolveEditorFileUrl(url) : resolveAttachmentMediaUrl(url, runtimeRef.current), []);
  const uploadFile = useCallback(async (file) => {
    const created = await runtimeRef.current?.createEditorAttachment?.(file);
    if (!created?.url) throw new Error("当前页面没有可用的本地附件提供器");
    return created.url;
  }, []);
  const editor = useCreateBlockNote({
    schema,
    dictionary: zh,
    disableExtensions: ["sideMenu", "dropCursor", "trailingNode"],
    extensions: [CalloutEnterExtension(), TabPanelsExtension, ColumnWidthsExtension, BlockInteractionsExtension(), LayoutTrailingExtension(), syntaxHighlighter],
    initialContent: copyJson(source.blocks),
    resolveFileUrl,
    uploadFile,
    links: { isValidLink: isAllowedEditorLink, onClick: (event) => runtimeRef.current?.handleEditorLinkClick?.(event) || false },
    tables: simpleTableOptions,
  }, [source.id]);
  const applying = useRef(false);
  const revision = useRef(source.revision);
  const [error, setError] = useState("");
  useLayoutEffect(() => {
    restoreTableHeaders(editor, source.blocks);
    placePassiveEditorCaret(editor);
  }, [editor]);
  const loadSource = useCallback((blocks) => {
    applying.current = true;
    try {
      editor.transact((tr) => {
        tr.setMeta("addToHistory", false);
        editor.replaceBlocks(editor.document, copyJson(blocks));
        restoreTableHeaders(editor, blocks);
      });
      placePassiveEditorCaret(editor);
    } finally { applying.current = false; }
  }, [editor]);
  useEffect(() => {
    revision.current = source.revision;
    if (stableJson(copyJson(editor.document)) === stableJson(source.blocks)) return;
    loadSource(source.blocks);
  }, [editor, loadSource, source]);
  const save = () => {
    if (applying.current || runtime?.locked) return;
    try {
      const next = store.updateSource(source.id, editor.document, revision.current);
      revision.current = next.revision;
      setError("");
    } catch (failure) {
      setError(failure.message);
      const current = store.getSource(source.id);
      if (current && !current.deletedAt) {
        loadSource(current.blocks);
        revision.current = current.revision;
      }
    }
  };
  return <div className="life-synced-editor" onKeyDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()} onKeyDownCapture={(event) => {
    if (runtime?.locked || isComposingKeyboardEvent(event) || editor.prosemirrorView.composing || isAltGraphKeyboardEvent(event) || !ownsEditorKeyboardTarget(editor, event.target)) return;
    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "d") {
      event.preventDefault();
      event.stopPropagation();
      duplicateEditorBlocks(editor);
    }
  }} onDoubleClick={(event) => {
    const outer = event.target.closest?.(".bn-block-outer");
    const block = outer?.dataset.id ? editor.getBlock(outer.dataset.id) : null;
    if (isRemoteUrl(block?.props.url)) { event.preventDefault(); event.stopPropagation(); runtime?.openEditorExternalUrl?.(block.props.url); }
  }}>
    {error && <p role="alert" className="life-inline-error">{error}</p>}
    <BlockNoteView editor={editor} theme={resolvedTheme} editable={!runtime?.locked} slashMenu={false} sideMenu={false} formattingToolbar={false} tableHandles={false} onChange={save}>
      {!runtime?.locked && <TableCellControls />}
      {!runtime?.presentation && <LifeAtlasSideMenuController />}
      <CodeBlockCopyButton />
      <SuggestionMenuController triggerCharacter="/" getItems={(query) => getSlashItems(editor, query, runtime)} floatingUIOptions={SUGGESTION_MENU_FLOATING} />
      <SuggestionMenuController triggerCharacter="@" getItems={(query) => getMentionItems(editor, query, runtime)} floatingUIOptions={SUGGESTION_MENU_FLOATING} />
      <SuggestionMenuController triggerCharacter="[[" getItems={(query) => getPageLinkMenuItems(editor, query, runtime)} floatingUIOptions={SUGGESTION_MENU_FLOATING} />
      <SuggestionMenuController triggerCharacter="+" shouldOpen={(tr) => tr.selection.$from.parent.type.name === "paragraph" && tr.selection.$from.parent.textContent === ""} getItems={(query) => getPlusMenuItems(editor, query, runtime)} floatingUIOptions={SUGGESTION_MENU_FLOATING} />
    </BlockNoteView>
  </div>;
}

export function SyncedContentReference({ block, editor, schema, getSlashItems, getMentionItems }) {
  const dialogs = useDialogs();
  const runtime = useContext(LifeAtlasEditorRuntimeContext);
  const store = runtime?.syncedStore;
  const sourceId = block.props.sourceId;
  const subscribe = useCallback((listener) => store?.subscribe(sourceId, listener) || (() => {}), [store, sourceId]);
  const getSnapshot = useCallback(() => store?.getSource(sourceId) || null, [store, sourceId]);
  const source = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const recursive = (runtime?.syncedAncestry || []).includes(sourceId);
  const unavailable = !source || source.deletedAt || recursive;
  const closeMenu = (details) => {
    details.open = false;
    details.querySelector("summary")?.focus({ preventScroll: true });
  };
  return <div className={`life-synced-source ${unavailable ? "is-unavailable" : ""}`} data-source-id={sourceId} contentEditable={false}>
    <header><span>⟳ 同步内容</span><small>{unavailable ? "内容源不可用" : "此处的编辑会更新所有引用"}</small>
      {!runtime?.locked && <details onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false;
      }} onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape" && event.currentTarget.open) {
          event.preventDefault();
          closeMenu(event.currentTarget);
        }
      }}><summary aria-label="同步内容操作">···</summary><div className="life-source-actions" onClick={(event) => {
        if (event.target.closest("button")) closeMenu(event.currentTarget.parentElement);
      }}>
        {!unavailable && <>
          <button type="button" onClick={() => editor.insertBlocks([{ type: "syncedBlock", props: { sourceId } }], block.id, "after")}>在下方添加引用</button>
          <button type="button" onClick={() => editor.replaceBlocks([block.id], cloneBlockDocument(source.blocks))}>取消同步并保留副本</button>
          <button type="button" onClick={async () => { if (await dialogs.confirm({ title: "删除这个同步源？", description: "所有引用将显示不可用提示，源内容仍可恢复。", confirmLabel: "删除同步源", danger: true })) store.deleteSource(sourceId); }}>删除同步源</button>
        </>}
        {source?.deletedAt && <button type="button" onClick={() => store.restoreSource(sourceId)}>恢复同步源</button>}
        <button type="button" onClick={() => editor.removeBlocks([block.id])}>仅删除此引用</button>
      </div></details>}
    </header>
    {unavailable ? <p>同步内容暂不可用。{source?.deletedAt ? "可从操作菜单恢复内容源。" : "请检查导入数据是否包含内容源。"}</p> :
      <LifeAtlasEditorRuntimeContext.Provider value={{ ...runtime, syncedAncestry: [...(runtime?.syncedAncestry || []), sourceId] }}>
        <CanonicalSourceEditor source={source} store={store} schema={schema} getSlashItems={getSlashItems} getMentionItems={getMentionItems} runtime={{ ...runtime, syncedAncestry: [...(runtime?.syncedAncestry || []), sourceId] }} />
      </LifeAtlasEditorRuntimeContext.Provider>}
  </div>;
}
