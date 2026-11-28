import { useContext, useRef, useState } from "react";
import { createReactInlineContentSpec } from "@blocknote/react";
import { filterSuggestionItems, insertOrUpdateBlockForSlashMenu } from "@blocknote/core";
import { LifeAtlasEditorRuntimeContext } from "./EditorRuntime.jsx";
import { mentionLabel } from "../domain/databaseProperties.js";
import { pageAvailability } from "../domain/trash.js";
import { isPageArchived } from "../domain/archive.js";
import { Dialog } from "../ui/Dialog.jsx";

function displayMention(inlineContent, workspace) {
  if (inlineContent.type === "dateMention" && inlineContent.props.kind === "reminder") {
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(inlineContent.props.value);
    if (match) return `⏰ ${Number(match[2])}月${Number(match[3])}日 ${match[4]}:${match[5]}`;
  }
  return mentionLabel(inlineContent, workspace);
}

function localDateTime() {
  const date = new Date(Date.now() + 60_000);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function ReminderDialog({ onConfirm, onClose }) {
  const [value, setValue] = useState(localDateTime);
  const inputRef = useRef(null);
  const valid = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) && Number.isFinite(new Date(value).getTime());
  const confirm = () => { if (valid) onConfirm(value); };
  return <Dialog title="提醒" className="life-editor-dialog life-reminder-dialog" dialogKind="reminder" initialFocusRef={inputRef} onClose={onClose}>
    <form onSubmit={(event) => { event.preventDefault(); confirm(); }}>
      <div className="mb-dialog-body"><label className="mb-field-group">提醒时间<input ref={inputRef} aria-label="提醒时间" type="datetime-local" value={value} onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => {
        event.stopPropagation();
        if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); confirm(); }
      }} /></label></div>
      <footer className="mb-dialog-footer"><button type="button" className="mb-button" onClick={onClose}>取消</button><button type="submit" className="mb-button mb-primary" disabled={!valid}>确定</button></footer>
    </form>
  </Dialog>;
}

function Mention({ inlineContent }) {
  const runtime = useContext(LifeAtlasEditorRuntimeContext);
  const label = displayMention(inlineContent, runtime?.workspace);
  const pageId = inlineContent.type === "pageMention" ? inlineContent.props.pageId : null;
  return <span className={`life-mention life-${inlineContent.type}`} contentEditable={false} data-mention-type={inlineContent.type}>
    {pageId ? <button type="button" disabled={pageAvailability(runtime?.workspace || {}, pageId) !== "ok"} onClick={() => runtime?.openPage?.(pageId)}>{label}</button> : label}
  </span>;
}

const implementation = {
  render: (props) => <Mention {...props} />,
  toExternalHTML: ({ inlineContent }) => <span>{displayMention(inlineContent, null)}</span>,
};
export const PageMention = createReactInlineContentSpec({ type: "pageMention", propSchema: { pageId: { default: "" }, labelSnapshot: { default: "页面" } }, content: "none" }, implementation);
export const UserMention = createReactInlineContentSpec({ type: "userMention", propSchema: { personId: { default: "" }, labelSnapshot: { default: "成员" } }, content: "none" }, implementation);
export const DateMention = createReactInlineContentSpec({ type: "dateMention", propSchema: { value: { default: "" }, kind: { default: "date" }, reminderId: { default: "" } }, content: "none" }, implementation);

export function getMentionMenuItems(editor, query, runtime) {
  const insert = (type, props) => editor.insertInlineContent([{ type, props }, " "]);
  const localDate = (offset) => {
    const date = new Date(); date.setDate(date.getDate() + offset);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  };
  const items = [
    ...(runtime?.workspace?.pages || []).filter((page) => !page.trashedAt && !isPageArchived(runtime.workspace, page.id)).map((page) => ({ title: page.title || "无标题页面", group: "页面", subtext: "引用页面", aliases: [page.id], onItemClick: () => insert("pageMention", { pageId: page.id, labelSnapshot: page.title || "页面" }) })),
    ...(runtime?.workspace?.people || []).map((person) => ({ title: person.displayName || "成员", group: "人员", subtext: "本地成员", onItemClick: () => insert("userMention", { personId: person.id, labelSnapshot: person.displayName || "成员" }) })),
    ...[["今天", 0], ["明天", 1]].map(([title, offset]) => ({ title, group: "日期", subtext: localDate(offset), aliases: [offset ? "tomorrow" : "today"], onItemClick: () => insert("dateMention", { value: localDate(offset), kind: "date" }) })),
    { title: "提醒", group: "日期", subtext: "设置本地提醒时间", aliases: ["reminder", "提醒"], onItemClick: () => { if (editor.isEditable && !runtime?.locked) runtime?.openReminderDialog?.(editor); } },
    { title: "选择日期", group: "日期", aliases: ["date", "日期"], onItemClick: async () => {
      const value = await runtime?.dialogs?.promptText({ title: "选择日期", label: "日期（YYYY-MM-DD）", inputType: "date", initialValue: localDate(0), confirmLabel: "插入日期" });
      if (value && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value))) insert("dateMention", { value, kind: "date" });
    } },
  ];
  // Keep the menu open while a date is being typed. Returning no items for the
  // first digit would close BlockNote's suggestion session before it becomes a
  // complete date, making a nominally supported YYYY-MM-DD impossible to enter.
  if (query && /^\d{1,4}(?:-\d{0,2})?(?:-\d{0,2})?$/.test(query)) {
    const complete = /^\d{4}-\d{2}-\d{2}$/.test(query) && Number.isFinite(Date.parse(query));
    items.unshift({ title: complete ? query : `${query} · 继续输入日期`, group: "日期", aliases: [query], onItemClick: async () => {
      if (complete) insert("dateMention", { value: query, kind: "date" });
      else {
        const value = await runtime?.dialogs?.promptText({ title: "选择日期", label: "完整日期（YYYY-MM-DD）", inputType: "date", initialValue: localDate(0), confirmLabel: "插入日期" });
        if (value && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value))) insert("dateMention", { value, kind: "date" });
      }
    } });
  }
  return Promise.resolve(filterSuggestionItems(items, query));
}

export function getPageLinkMenuItems(editor, query, runtime) {
  const insert = (pageId, label) => {
    if (editor.isEditable && !runtime?.locked) editor.insertInlineContent([{ type: "pageMention", props: { pageId, labelSnapshot: label } }, " "]);
  };
  const items = (runtime?.workspace?.pages || []).filter((page) => !page.trashedAt && !isPageArchived(runtime.workspace, page.id)).map((page) => ({
    title: page.title || "无标题页面",
    group: "页面",
    subtext: runtime?.workspace?.folders?.find((folder) => folder.id === page.folderId)?.name || "",
    aliases: [page.id],
    onItemClick: () => insert(page.id, page.title || "无标题页面"),
  }));
  const title = query.trim();
  const create = title ? [{ title: `新建页面「${title}」`, group: "新页面", onItemClick: () => {
    if (!editor.isEditable || runtime?.locked) return;
    const created = runtime?.createSubPage?.(title);
    if (created) insert(created.pageId, created.title || title);
  } }] : [];
  return Promise.resolve([...filterSuggestionItems(items, query), ...create]);
}

export function getPlusMenuItems(editor, query, runtime) {
  const title = query.trim();
  const insert = (pageId, label) => {
    if (editor.isEditable && !runtime?.locked) insertOrUpdateBlockForSlashMenu(editor, { type: "pageLink", props: { pageId, label } });
  };
  const create = {
    title: title ? `新建子页面「${title}」` : "新建子页面",
    group: "新建",
    onItemClick: () => {
      if (!editor.isEditable || runtime?.locked) return;
      const created = runtime?.createSubPage?.(title || "新页面");
      if (created) insert(created.pageId, created.title || title || "新页面");
    },
  };
  const pages = (runtime?.workspace?.pages || []).filter((page) => page.id !== runtime?.pageId && !page.trashedAt && !isPageArchived(runtime.workspace, page.id)).map((page) => ({
    title: page.title || "无标题页面",
    group: "链接到页面",
    subtext: runtime?.workspace?.folders?.find((folder) => folder.id === page.folderId)?.name || "",
    aliases: [page.id],
    onItemClick: () => insert(page.id, page.title || "无标题页面"),
  }));
  return Promise.resolve([create, ...filterSuggestionItems(pages, query).slice(0, 10)]);
}
