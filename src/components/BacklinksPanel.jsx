import { useEffect, useId, useState } from "react";
import IconLink from "@tabler/icons-react/dist/esm/icons/IconLink.mjs";
import { folderAncestors } from "../domain/navigation.js";
import { AppearanceGlyph } from "./AppearanceGlyph.jsx";
import { useI18n } from "../i18n/workspaceRuntime.js";

export function BacklinksPanel({ workspace, pageId, index, runtime }) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  useEffect(() => setExpanded(false), [pageId]);
  const entries = index?.backlinksFor(pageId, workspace) || [];
  if (!entries.length) return null;
  const pages = new Map(workspace.pages.map((page) => [page.id, page]));
  const emptySnippetLabels = {
    mention: t("backlinks.mention"),
    blockLink: t("backlinks.blockLink"),
    pageLink: t("backlinks.pageLink"),
    editorialCard: t("backlinks.editorialCard"),
  };
  return <div className="backlinks-panel">
    <button type="button" className="backlinks-toggle" aria-expanded={expanded} aria-controls={listId} onClick={() => setExpanded((value) => !value)}><IconLink size={14} aria-hidden="true" />{t("backlinks.toggle", { count: entries.length })}</button>
    {expanded && <ul className="backlinks-list" id={listId} aria-label={t("backlinks.title")}>{entries.map((entry) => {
      const source = pages.get(entry.sourcePageId);
      const path = folderAncestors(workspace.folders, source.folderId).map((folder) => folder.name).join(" / ");
      return <li className="backlink-source" key={source.id}>
        <div className="backlink-title-row"><AppearanceGlyph icon={source.icon} color={source.iconColor} className="backlink-icon" /><button type="button" className="backlink-title" onClick={() => runtime.openPageAt(source.id, entry.links[0]?.blockId)}>{source.title || t("backlinks.untitled")}</button><span className="backlink-path">{path}</span></div>
        <div className="backlink-snippets">{entry.links.slice(0, 2).map((link, position) => <p key={`${link.blockId}:${link.kind}:${position}`}>{link.snippet || emptySnippetLabels[link.kind]}</p>)}</div>
      </li>;
    })}</ul>}
  </div>;
}

export default BacklinksPanel;
