import { useEffect, useRef, useState } from "react";
import { useBlockNoteEditor } from "@blocknote/react";

function codeText(content) {
  if (typeof content === "string") return content;
  return (content || []).map((entry) => typeof entry === "string" ? entry : entry.text || "").join("");
}

export function CodeBlockCopyButton() {
  const editor = useBlockNoteEditor();
  const [position, setPosition] = useState(null);
  const [label, setLabel] = useState("复制");
  const buttonRef = useRef(null);
  const activeBlock = useRef(null);
  const hideTimer = useRef(null);
  const resetTimer = useRef(null);

  useEffect(() => {
    const container = editor.prosemirrorView.dom.closest(".life-editor");
    if (!container) return undefined;
    const clearHide = () => window.clearTimeout(hideTimer.current);
    const show = (event) => {
      const block = event.target.closest?.('[data-content-type="codeBlock"]');
      if (!block || block.closest(".bn-editor") !== editor.prosemirrorView.dom) return;
      clearHide();
      const rect = block.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      activeBlock.current = block;
      setPosition({ top: rect.top - containerRect.top + container.scrollTop + 6, right: containerRect.right - rect.right + 8 });
    };
    const hide = (event) => {
      if (!activeBlock.current?.contains(event.target)) return;
      if (activeBlock.current.contains(event.relatedTarget) || buttonRef.current?.contains(event.relatedTarget)) return;
      hideTimer.current = window.setTimeout(() => { activeBlock.current = null; setPosition(null); }, 300);
    };
    container.addEventListener("mouseover", show);
    container.addEventListener("mouseout", hide);
    return () => { container.removeEventListener("mouseover", show); container.removeEventListener("mouseout", hide); clearHide(); window.clearTimeout(resetTimer.current); };
  }, [editor]);

  if (!position) return null;
  return <button ref={buttonRef} type="button" className="life-code-copy" aria-label="复制代码" style={position} onMouseEnter={() => window.clearTimeout(hideTimer.current)} onMouseLeave={() => {
    hideTimer.current = window.setTimeout(() => { activeBlock.current = null; setPosition(null); }, 300);
  }} onMouseDown={(event) => event.preventDefault()} onClick={async () => {
    const id = activeBlock.current?.closest(".bn-block-outer")?.dataset.id;
    const block = id ? editor.getBlock(id) : null;
    if (!block) return;
    try {
      await navigator.clipboard.writeText(codeText(block.content));
      setLabel("已复制");
    } catch { setLabel("复制失败"); }
    window.clearTimeout(resetTimer.current);
    resetTimer.current = window.setTimeout(() => setLabel("复制"), 1500);
  }}>{label}</button>;
}
