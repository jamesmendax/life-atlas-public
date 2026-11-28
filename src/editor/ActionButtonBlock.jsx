import { useState } from "react";
import { createReactBlockSpec } from "@blocknote/react";
import { closeHistory } from "@tiptap/pm/history";
import "../ui/themes/mobai/database-actions.css";

function ActionButtonView({ editor, block }) {
  const [settings, setSettings] = useState(null);
  const [notice, setNotice] = useState("");
  function append(event) {
    if (!editor.isEditable || event.detail > 1) return;
    const current = editor.getBlock(block.id);
    if (!current?.props.text?.trim()) return;
    const today = new Date();
    const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const text = current.props.text.replaceAll("{date}", date);
    const view = editor.prosemirrorView;
    const boundary = () => view.dispatch(closeHistory(view.state.tr).setMeta("addToHistory", false));
    boundary();
    editor.transact(() => {
      const [entry] = editor.insertBlocks([{ type: "paragraph", content: text }], editor.document.at(-1), "after");
      editor.setTextCursorPosition(entry, "end");
    });
    boundary();
    editor.focus();
    setNotice("已追加到页面末尾");
  }
  return <div className="life-action-block" contentEditable={false}>
    <div className="life-action-controls">
      <button type="button" className="db-action-trigger" disabled={!editor.isEditable} onClick={append}>{block.props.label || "打卡"}</button>
      {editor.isEditable && <button type="button" className="life-action-config" aria-label="配置页面按钮" aria-expanded={Boolean(settings)} onClick={() => {
        setSettings(settings ? null : { label: block.props.label, text: block.props.text });
        setNotice("");
      }}>设置</button>}
      <small role="status">{notice}</small>
    </div>
    {settings && editor.isEditable && <div className="life-action-settings" onKeyDown={event => {
      event.stopPropagation();
      if (event.key === "Escape") setSettings(null);
    }}>
      <label>按钮名称<input value={settings.label} maxLength={80} onChange={event => setSettings({ ...settings, label: event.target.value })} /></label>
      <label>追加到页面末尾的文字<textarea value={settings.text} placeholder="例如：{date} 已完成打卡" onChange={event => setSettings({ ...settings, text: event.target.value })} /></label>
      <small>使用 {"{date}"} 插入当天日期。</small>
      <div className="life-action-controls">
        <button type="button" disabled={!settings.label.trim() || !settings.text.trim()} onClick={() => {
          if (!editor.isEditable || !editor.getBlock(block.id)) return;
          editor.updateBlock(block.id, { props: { label: settings.label.trim(), text: settings.text } });
          setSettings(null);
        }}>保存按钮</button>
        <button type="button" onClick={() => setSettings(null)}>取消</button>
      </div>
    </div>}
  </div>;
}

export const ActionButtonBlock = createReactBlockSpec({
  type: "actionButton",
  propSchema: { label: { default: "打卡" }, text: { default: "{date} 已打卡" } },
  content: "none",
}, { render: ActionButtonView });
