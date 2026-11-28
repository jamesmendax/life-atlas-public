import { useRef, useState } from "react";
import { createReactInlineContentSpec } from "@blocknote/react";
import katex from "katex";
import { Dialog } from "../ui/Dialog.jsx";

export function InlineEquationDialog({ initialExpression = "", onConfirm, onClose }) {
  const [expression, setExpression] = useState(initialExpression);
  const inputRef = useRef(null);
  const confirm = () => { if (expression.trim()) onConfirm(expression); };
  return <Dialog title="行内公式" className="life-editor-dialog life-inline-equation-dialog" dialogKind="inline-equation" onClose={onClose} initialFocusRef={inputRef}>
    <div className="mb-dialog-body">
      <textarea ref={inputRef} aria-label="LaTeX 公式" rows={3} value={expression} onChange={(event) => setExpression(event.target.value)} onKeyDown={(event) => {
        event.stopPropagation();
        if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); confirm(); }
      }} />
      <div className="life-inline-equation-preview" aria-label="公式预览" dangerouslySetInnerHTML={{ __html: katex.renderToString(expression || "\\square", { displayMode: false, throwOnError: false, trust: false }) }} />
    </div>
    <footer className="mb-dialog-footer"><button className="mb-button" type="button" onClick={onClose}>取消</button><button className="mb-button mb-primary" type="button" disabled={!expression.trim()} onClick={confirm}>确定</button></footer>
  </Dialog>;
}

function InlineEquationView({ inlineContent, updateInlineContent, editor }) {
  const [editing, setEditing] = useState(false);
  const expression = inlineContent.props.expression;
  return <>
    <span className="life-inline-equation" contentEditable={false} role={editor.isEditable ? "button" : undefined} tabIndex={editor.isEditable ? 0 : undefined} aria-label="编辑行内公式" onClick={() => { if (editor.isEditable) setEditing(true); }} onKeyDown={(event) => {
      if (editor.isEditable && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); event.stopPropagation(); setEditing(true); }
    }} dangerouslySetInnerHTML={{ __html: katex.renderToString(expression, { displayMode: false, throwOnError: false, trust: false }) }} />
    {editing && <InlineEquationDialog initialExpression={expression} onClose={() => setEditing(false)} onConfirm={(next) => {
      if (editor.isEditable) updateInlineContent({ type: "inlineEquation", props: { expression: next } });
      setEditing(false);
    }} />}
  </>;
}

export const InlineEquation = createReactInlineContentSpec(
  { type: "inlineEquation", propSchema: { expression: { default: "" } }, content: "none" },
  {
    render: (props) => <InlineEquationView {...props} />,
    toExternalHTML: ({ inlineContent }) => <span dangerouslySetInnerHTML={{ __html: katex.renderToString(inlineContent.props.expression, { displayMode: false, throwOnError: false, output: "mathml", trust: false }) }} />,
  },
);
