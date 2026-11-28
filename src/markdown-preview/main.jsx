import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { markdownToBlocks, safeMarkdownHref } from "../domain/markdownBlocks.js";
import { I18nProvider, previewTranslator, useI18n } from "../i18n/surfaces.js";
import "./preview.css";

function inlineContent(content = []) {
  return content.map((node, index) => {
    if (node.type === "link") {
      const href = safeMarkdownHref(node.href);
      const children = inlineContent(node.content);
      return href ? <a key={index} href={href} target="_blank" rel="noreferrer">{children}</a> : <Fragment key={index}>{children}</Fragment>;
    }
    if (node.type === "inlineEquation") return <code key={index}>{node.props.expression}</code>;
    let text = node.text;
    if (node.styles?.code) text = <code>{text}</code>;
    if (node.styles?.strike) text = <del>{text}</del>;
    if (node.styles?.underline) text = <u>{text}</u>;
    if (node.styles?.italic) text = <em>{text}</em>;
    if (node.styles?.bold) text = <strong>{text}</strong>;
    return <Fragment key={index}>{text}</Fragment>;
  });
}

const listTypes = new Set(["bulletListItem", "numberedListItem", "checkListItem"]);

function blockContent(blocks, t) {
  const elements = [];
  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index];
    if (listTypes.has(block.type)) {
      const items = [block];
      while (blocks[index + 1]?.type === block.type) items.push(blocks[++index]);
      const List = block.type === "numberedListItem" ? "ol" : "ul";
      elements.push(<List key={block.id} className={block.type === "checkListItem" ? "checklist" : undefined}>
        {items.map(item => <li key={item.id}>{item.type === "checkListItem" && <input type="checkbox" checked={item.props.checked} disabled aria-label={t("preview.taskAria")} />}
          {inlineContent(item.content)}{blockContent(item.children, t)}</li>)}
      </List>);
    } else elements.push(<PreviewBlock key={block.id} block={block} t={t} />);
  }
  return elements;
}

function PreviewBlock({ block, t }) {
  if (block.type === "table") {
    const { rows, headerRows } = block.content;
    const row = (Cell, row, index) => <tr key={index}>{row.cells.map((cell, column) => <Cell key={column}>{inlineContent(cell)}</Cell>)}</tr>;
    return <div className="table-scroll"><table>
      <thead>{rows.slice(0, headerRows).map((entry, index) => row("th", entry, index))}</thead>
      <tbody>{rows.slice(headerRows).map((entry, index) => row("td", entry, index))}</tbody>
    </table></div>;
  }
  if (block.type === "divider") return <hr />;
  const content = inlineContent(block.content);
  if (block.type === "heading") {
    const Heading = `h${block.props.level}`;
    return <Heading>{content}</Heading>;
  }
  if (block.type === "codeBlock" || block.type === "equation") return <pre><code>{content}</code></pre>;
  if (block.type === "quote" || block.type === "callout") return <blockquote>{block.props.icon && <span aria-hidden="true">{block.props.icon} </span>}{content}</blockquote>;
  if (block.type === "toggleListItem") return <details><summary>{content}</summary>{blockContent(block.children, t)}</details>;
  return <p>{content}</p>;
}

function MarkdownBody({ text, t }) {
  const blocks = useMemo(() => {
    let count = 0;
    try {
      return markdownToBlocks(text, { extended: true, preserveLinks: true, idFactory: () => {
        count++;
        if (count > 30000) throw new RangeError();
        return String(count);
      }, checkTableSize: cells => { if (cells > 100000) throw new RangeError(); } });
    } catch { return null; }
  }, [text]);
  if (!blocks) return <><p className="preview-status">{t("preview.tooComplex")}</p><pre className="source-text">{text}</pre></>;
  return blocks.length ? blockContent(blocks, t) : <p className="preview-status">{t("preview.emptyBody")}</p>;
}

function MarkdownPreview({ bridge }) {
  const { t } = useI18n();
  const [selection, setSelection] = useState(null);
  const [activeId, setActiveId] = useState(null);
  const [result, setResult] = useState(null);
  const tabs = useRef(null);
  const active = selection?.files?.find(file => file.id === activeId) || selection?.files?.[0];
  const id = active?.id;
  useEffect(() => {
    if (!bridge) { setSelection({ errorKey: "preview.openFromWindows" }); return; }
    let current = true;
    const receive = next => { if (current) setSelection(next); };
    const unsubscribe = bridge.onChanged(receive);
    bridge.list().then(receive, () => receive({ errorKey: "preview.openFailed" }));
    return () => { current = false; unsubscribe(); };
  }, [bridge]);
  useEffect(() => {
    if (id === undefined) return;
    let current = true;
    const receive = next => { if (current) setResult({ id, ...next }); };
    bridge.read(id).then(receive, () => receive({ errorKey: "preview.readFailed" }));
    return () => { current = false; };
  }, [bridge, id]);

  const selectionError = selection?.errorKey ? t(selection.errorKey) : selection?.error;
  const fileError = result?.errorKey ? t(result.errorKey) : result?.error;

  return <main className="markdown-preview">
    <header className="preview-header">
      <h1>{t("preview.title")}</h1>
      {selection?.files?.length > 0 && <div ref={tabs} className="preview-tabs" role="tablist" aria-label={t("preview.tabsAria")} onKeyDown={event => {
        if (!event.target.matches('[role="tab"]') || !["Home", "End", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
        event.preventDefault();
        const length = selection.files.length;
        const index = selection.files.indexOf(active);
        const next = event.key === "Home" ? 0 : event.key === "End" ? length - 1 : (index + (event.key === "ArrowLeft" ? -1 : 1) + length) % length;
        setActiveId(selection.files[next].id);
        tabs.current.children[next].focus({ preventScroll: true });
        tabs.current.children[next].scrollIntoView({ block: "nearest", inline: "nearest" });
      }}>
        {selection.files.map(file => <button key={file.id} type="button" role="tab" id={`preview-file-${file.id}`} aria-controls="markdown-preview-panel"
          aria-selected={file.id === id} tabIndex={file.id === id ? 0 : -1} title={file.name} onClick={() => setActiveId(file.id)}>{file.name}</button>)}
      </div>}
      {selection?.overflow > 0 && <p className="preview-notice" role="status">{t("preview.overflow", { count: selection.overflow })}</p>}
    </header>
    {active ? <section key={id} className="preview-panel" role="tabpanel" id="markdown-preview-panel" aria-labelledby={`preview-file-${id}`} tabIndex={0}>
      <article aria-label={t("preview.title")}>
        {result?.id !== id ? <p className="preview-status" role="status">{t("common.loading")}</p> : fileError ? <p className="preview-status" role="alert">{fileError}</p> : <MarkdownBody text={result.text} t={t} />}
      </article>
    </section> : <p className="preview-status preview-empty" role={selectionError ? "alert" : "status"}>
      {selectionError || t("common.loading")}
    </p>}
  </main>;
}

createRoot(document.querySelector("#root")).render(
  <I18nProvider bridge={window.lifeAtlasMarkdownPreview?.locale} translator={previewTranslator}>
    <MarkdownPreview bridge={window.lifeAtlasMarkdownPreview} />
  </I18nProvider>,
);
