import { Fragment, useMemo } from "react";
import katex from "katex";
import { useAttachmentMediaUrl } from "./AttachmentMedia.jsx";
import { attachmentUrlWithId } from "../domain/attachments.js";
import { inlineSemanticText, safePropertyHref } from "../domain/databaseProperties.js";
import { OPTION_PALETTE } from "../domain/propertyChanges.js";
import { parseBlockLink } from "../editor/links.js";

function formattedColor(value, background = false) {
  return value && value !== "default" && OPTION_PALETTE.includes(value) ? `var(--mb-u-${value}${background ? "-bg" : ""})` : undefined;
}

function MathText({ expression, display = false }) {
  const math = useMemo(() => katex.renderToString(expression, { displayMode: display, output: "mathml", throwOnError: false, trust: false }), [expression, display]);
  return <span className="db-feed-math" dangerouslySetInnerHTML={{ __html: math }} />;
}

function Inline({ content }) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;
  return content.map((part, index) => {
    if (typeof part === "string") return part;
    if (!part) return null;
    if (part.type === "inlineEquation") return <MathText key={index} expression={String(part.props?.expression || "")} />;
    if (part.type === "link") {
      const raw = String(part.href || part.props?.href || "").trim();
      const href = parseBlockLink(raw) ? raw : /^mailto:/i.test(raw) ? safePropertyHref("email", raw.slice(7)) : safePropertyHref("url", raw);
      const children = <Inline content={part.content} />;
      return href ? <a key={index} href={href} target="_blank" rel="noreferrer">{children}</a> : <Fragment key={index}>{children}</Fragment>;
    }
    const styles = part.styles || {};
    let node = part.text ?? <Inline content={part.content}/>;
    if (styles.code) node = <code>{node}</code>;
    if (styles.bold) node = <strong>{node}</strong>;
    if (styles.italic) node = <em>{node}</em>;
    if (styles.underline) node = <u>{node}</u>;
    if (styles.strike) node = <s>{node}</s>;
    const color = formattedColor(styles.textColor);
    const backgroundColor = formattedColor(styles.backgroundColor, true);
    return color || backgroundColor ? <span key={index} style={{ color, backgroundColor }}>{node}</span> : <Fragment key={index}>{node}</Fragment>;
  });
}

function FeedMedia({ block }) {
  const props = block.props || {};
  const original = props.url || (props.attachmentId && attachmentUrlWithId("blob:attachment", props.attachmentId));
  const resolved = useAttachmentMediaUrl(original);
  const name = props.name || props.caption || ({image:"图片",video:"视频",audio:"音频"})[block.type] || "附件";
  if (!resolved) return <p className="db-feed-media-name">{name}<small> · 未载入</small></p>;
  let media;
  if (block.type === "image") media = <img loading="lazy" src={resolved} alt={name}/>;
  else if (block.type === "video") media = <video controls preload="metadata" src={resolved} aria-label={name}/>;
  else if (block.type === "audio") media = <audio controls preload="metadata" src={resolved} aria-label={name}/>;
  else media = <a href={resolved} download={name}>{name}</a>;
  return <figure className="db-feed-image">{media}{props.caption && <figcaption>{props.caption}</figcaption>}</figure>;
}

function ReadBlock({ block }) {
  const children = block.children?.length ? <div className="db-feed-children"><FeedDocument blocks={block.children}/></div> : null;
  const inline = <Inline content={block.content}/>;
  let body;
  switch (block.type) {
    case "heading": {
      const Heading = "h" + Math.min(6, Math.max(2, (Number(block.props?.level) || 1) + 1));
      body = <Heading>{inline}</Heading>;
      break;
    }
    case "checkListItem": body = <p><input type="checkbox" checked={Boolean(block.props?.checked)} disabled aria-label={block.props?.checked ? "已完成" : "未完成"}/> {inline}</p>; break;
    case "quote": case "callout": body = <blockquote>{inline}</blockquote>; break;
    case "codeBlock": body = <pre><code>{inlineSemanticText(block.content)}</code></pre>; break;
    case "equation": body = <MathText expression={inlineSemanticText(block.content) || block.props?.expression || ""} display/>; break;
    case "divider": body = <hr/>; break;
    case "image": case "video": case "audio": case "file": case "attachment": body = <FeedMedia block={block}/>; break;
    case "table": {
      const rows = block.content?.rows || (Array.isArray(block.content) ? block.content : []);
      body = <div className="db-feed-table"><table><tbody>{rows.map((row, i) => <tr key={i}>{(row.cells || row).map((cell, j) => {
        const Cell = i < (block.content?.headerRows || 0) || j < (block.content?.headerCols || 0) ? "th" : "td";
        const props = cell?.props || {};
        return <Cell key={j} colSpan={props.colspan} rowSpan={props.rowspan} style={{
          textAlign: ["left","center","right"].includes(props.textAlignment) ? props.textAlignment : undefined,
          color: formattedColor(props.textColor), backgroundColor: formattedColor(props.backgroundColor,true),
        }}><Inline content={cell?.content ?? cell}/></Cell>;
      })}</tr>)}</tbody></table></div>;
      break;
    }
    default: body = <p>{inline}</p>;
  }
  return <>{body}{children}</>;
}

export function FeedDocument({ blocks }) {
  const groups = [];
  for (const block of blocks) {
    const list = block.type === "bulletListItem" ? "ul" : block.type === "numberedListItem" ? "ol" : null;
    if (list && groups.at(-1)?.list === list) groups.at(-1).items.push(block);
    else groups.push({ list, items: [block] });
  }
  return groups.map(({list: List, items}, index) => List ? <List key={items[0].id || index}>
    {items.map((block, j) => <li key={block.id || j}><Inline content={block.content}/>{block.children?.length > 0 && <FeedDocument blocks={block.children}/>}</li>)}
  </List> : <ReadBlock key={items[0].id || index} block={items[0]}/>);
}
