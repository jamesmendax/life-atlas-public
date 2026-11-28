import { useMemo, useRef, useState } from "react";
import IconFile from "@tabler/icons-react/dist/esm/icons/IconFile.mjs";
import IconSearch from "@tabler/icons-react/dist/esm/icons/IconSearch.mjs";
import { Dialog } from "../ui/Dialog.jsx";

function pageLocation(workspace, page) {
  const segments = [];
  const seen = new Set();
  let folder = workspace.folders?.find((entry) => entry.id === page.folderId);
  while (folder && !seen.has(folder.id)) {
    seen.add(folder.id);
    segments.unshift(folder.name || "未命名文件夹");
    folder = workspace.folders.find((entry) => entry.id === folder.parentId);
  }
  const parents = [];
  let parent = workspace.pages?.find((entry) => entry.id === page.parentPageId);
  while (parent && !seen.has(parent.id)) {
    seen.add(parent.id);
    parents.unshift(parent.title || "无标题页面");
    parent = workspace.pages.find((entry) => entry.id === parent.parentPageId);
  }
  return [...segments, ...parents].join(" / ");
}

export function MoveBlockDialog({ workspace, currentPageId, onMove, onClose }) {
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const inputRef = useRef(null);
  const pages = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    const available = (workspace?.pages || []).filter((page) => page.id !== currentPageId && !page.trashedAt);
    return needle ? available.filter((page) => (page.title || "无标题页面").toLocaleLowerCase().includes(needle)) : available.sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt))).slice(0, 20);
  }, [currentPageId, query, workspace]);
  return <Dialog title="移动到" className="life-editor-dialog life-block-move-dialog" dialogKind="move-block" initialFocusRef={inputRef} onClose={onClose}>
    <div className="mb-dialog-body">
      <label className="life-block-move-search"><IconSearch size={16} /><input ref={inputRef} aria-label="搜索目标页面" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => event.stopPropagation()} /></label>
      <div className="life-block-move-pages" role="group" aria-label="目标页面">
        {pages.map((page) => <button key={page.id} type="button" className="life-block-move-page" onClick={() => {
          try { onMove(page.id); onClose(); } catch (failure) { setError(failure.message); }
        }}><IconFile size={17} /><span><strong>{page.title || "无标题页面"}</strong><small>{pageLocation(workspace, page)}</small></span></button>)}
        {!pages.length && <p className="life-editor-empty">没有匹配的页面</p>}
      </div>
      {error && <p className="life-editor-error" role="alert">{error}</p>}
    </div>
  </Dialog>;
}
