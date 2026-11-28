import { useMemo, useState } from "react";
import { formatDateTime } from "../domain/content.js";
import { materializeDocument } from "../domain/documentSemantics.js";
import { feedExcerpt } from "../domain/feedPreview.js";
import { FeedDocument } from "./FeedDocument.jsx";
import { itemDisplayTitle, resolvePropertyValue } from "../domain/database.js";
import { formatPropertyValue } from "../domain/databaseProperties.js";
import { pageDiscussions, pageAnchor } from "../domain/comments.js";
import { listVisiblePropertyIds } from "../domain/viewRegistry.js";
import { AppearanceGlyph } from "./AppearanceGlyph.jsx";
import { parseBlockLink } from "../editor/links.js";

function FeedPost({ workspace, source, item, page, columns, showIcon, onOpenItemPage, runtime }) {
  const [expanded, setExpanded] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const content = useMemo(() => materializeDocument(page.content, workspace, new Set(), 0, { preserveMedia: true }), [page.content, workspace]);
  const excerpt = useMemo(() => feedExcerpt(content), [content]);
  const threads = pageDiscussions(workspace, page.id);
  const comments = threads.flatMap(thread => thread.comments).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  const locked = runtime?.locked || page.settings?.locked;
  const submit = event => {
    event.preventDefault();
    if (!locked && draft.trim() && runtime?.addDiscussion?.(page.id, pageAnchor(), draft.trim())) setDraft("");
  };
  return <article className="db-feed-post" data-feed-page={page.id}>
    <header><button type="button" className="db-feed-title" onClick={event => onOpenItemPage?.(page.id, event.currentTarget)}>
      {showIcon && page.icon && <AppearanceGlyph icon={page.icon} color={page.iconColor}/>}
      {itemDisplayTitle(workspace, source, item)}
    </button><time dateTime={item.createdAt}>{formatDateTime(item.createdAt)}</time></header>
    {columns.map(property => {
      const value = formatPropertyValue(workspace, property, resolvePropertyValue(workspace, source, item, property));
      return value ? <span className="db-feed-property" key={property.id}>{property.name} · {value}</span> : null;
    })}
    <div className="db-feed-body db-feed-document" onClick={event => {
      const href = event.target.closest?.("a[href]")?.getAttribute("href");
      if (!href) return;
      const internal = parseBlockLink(href);
      if (internal) {
        event.preventDefault();
        runtime?.openPageAt?.(internal.pageId, internal.blockId);
      } else if (/^(?:https?|mailto):/i.test(href) && window.lifeAtlas?.app?.openExternal) {
        event.preventDefault();
        void window.lifeAtlas.app.openExternal({url:href});
      }
    }}><FeedDocument blocks={expanded ? content : excerpt.blocks}/></div>
    {excerpt.truncated && <button type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? "收起正文" : "展开正文"}</button>}
    <footer><button type="button" aria-expanded={commentsOpen} onClick={() => setCommentsOpen(!commentsOpen)}>评论 {comments.length}</button>
      <small>{workspace.ui?.pageOpenCounts?.[page.id] || 0} 次本机浏览</small></footer>
    {commentsOpen && <section aria-label="页面评论" className="db-feed-comments">
      {comments.map(comment => <div key={comment.id}><strong>{workspace.people?.find(person => person.id === comment.authorId)?.displayName || "本地成员"}</strong><span>{comment.body}</span></div>)}
      {!comments.length && <small>还没有评论</small>}
      {!locked && runtime?.addDiscussion && <form onSubmit={submit}><label><span className="db-v9-sr-only">添加页面评论</span><input aria-label="添加页面评论" placeholder="写下评论…" value={draft} maxLength={20000} onChange={e => setDraft(e.target.value)}/></label><button type="submit" disabled={!draft.trim()}>发送</button></form>}
    </section>}
  </article>;
}

export function DatabaseFeed({ workspace, source, view, items, onOpenItemPage, runtime }) {
  const [limit, setLimit] = useState(20);
  const pages = useMemo(() => new Map(workspace.pages.map(page => [page.id, page])), [workspace.pages]);
  const columns = listVisiblePropertyIds(source, view).map(id => source.properties.find(p => p.id === id)).filter(p => p && p.type !== "title");
  const ordered = useMemo(() => view.sorts?.length ? items : [...items].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))), [items, view.sorts]);
  if (!items.length) return <p className="db-surface-message">还没有符合条件的动态。</p>;
  return <div className="db-feed" aria-label="数据库动态">
    {ordered.slice(0, limit).map(item => {
      const page = pages.get(item.pageId);
      return page && !page.trashedAt && <FeedPost key={item.id} {...{ workspace, source, item, page, columns, onOpenItemPage, runtime }} showIcon={view.config?.showPageIcon !== false}/>;
    })}
    {limit < ordered.length && <button type="button" onClick={() => setLimit(limit + 20)}>查看更多动态</button>}
  </div>;
}
