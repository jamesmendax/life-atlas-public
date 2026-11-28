import { expandSyncedBlocks, sourceReferences, walkBlocks } from "./blockDocument.js";
import { inlineSemanticText } from "./databaseProperties.js";
import { parseBlockLink } from "../editor/links.js";

function walkInline(content, visit, depth = 0) {
  if (depth > 128) return;
  if (Array.isArray(content)) { for (const entry of content) walkInline(entry, visit, depth + 1); return; }
  if (!content || typeof content !== "object") return;
  visit(content);
  walkInline(content.content, visit, depth + 1);
  for (const row of content.rows || []) for (const cell of row.cells || []) walkInline(cell, visit, depth + 1);
}

export function extractPageLinks(page, workspace) {
  const result = [];
  for (const block of walkBlocks(expandSyncedBlocks(page?.content, workspace))) {
    const text = inlineSemanticText(block.content, workspace).trim();
    const characters = Array.from(text);
    const snippet = characters.length > 80 ? `${characters.slice(0, 80).join("")}…` : text;
    const add = (targetPageId, kind) => {
      if (typeof targetPageId === "string" && targetPageId && targetPageId !== page.id) result.push({ targetPageId, blockId: block.id, kind, snippet });
    };
    if (block.type === "pageLink") add(block.props?.pageId, "pageLink");
    if (block.type === "editorialCard") add(block.props?.pageId, "editorialCard");
    walkInline(block.content, (entry) => {
      if (entry.type === "pageMention") add(entry.props?.pageId, "mention");
      if (entry.type === "link") add(parseBlockLink(entry.href)?.pageId, "blockLink");
    });
  }
  return result;
}

export function createBacklinkIndex() {
  const byTarget = new Map();
  const bySource = new Map();
  let indexedWorkspace = null;
  let pagesById = new Map();

  function removeSource(sourcePageId) {
    for (const target of bySource.get(sourcePageId) || []) {
      const sources = byTarget.get(target);
      sources.delete(sourcePageId);
      if (!sources.size) byTarget.delete(target);
    }
    bySource.delete(sourcePageId);
  }

  function addSource(page, workspace) {
    if (!page || page.trashedAt) return;
    const targets = new Set();
    for (const { targetPageId, ...link } of extractPageLinks(page, workspace)) {
      if (!byTarget.has(targetPageId)) byTarget.set(targetPageId, new Map());
      const sources = byTarget.get(targetPageId);
      if (!sources.has(page.id)) sources.set(page.id, []);
      sources.get(page.id).push(link);
      targets.add(targetPageId);
    }
    bySource.set(page.id, targets);
  }

  function rebuild(workspace) {
    byTarget.clear();
    bySource.clear();
    pagesById = new Map((workspace?.pages || []).map((page) => [page.id, page]));
    for (const page of pagesById.values()) addSource(page, workspace);
    indexedWorkspace = workspace;
  }

  function update(previous, next) {
    if (!previous || indexedWorkspace !== previous) { rebuild(next); return; }
    if (previous === next) return;
    const nextPages = new Map((next.pages || []).map((page) => [page.id, page]));
    const changedPages = new Set();
    for (const [id, page] of pagesById) {
      const replacement = nextPages.get(id);
      if (page === replacement) continue;
      changedPages.add(id);
      if (page.title !== replacement?.title || Boolean(page.trashedAt) !== Boolean(replacement?.trashedAt)) for (const sourceId of byTarget.get(id)?.keys() || []) changedPages.add(sourceId);
    }
    for (const id of nextPages.keys()) if (!pagesById.has(id)) {
      changedPages.add(id);
      for (const sourceId of byTarget.get(id)?.keys() || []) changedPages.add(sourceId);
    }
    if (next.syncedSources !== previous.syncedSources) {
      const previousSources = new Map((previous.syncedSources || []).map((source) => [source.id, source]));
      const nextSources = new Map((next.syncedSources || []).map((source) => [source.id, source]));
      const changedSources = new Set();
      for (const [id, source] of previousSources) if (nextSources.get(id) !== source) changedSources.add(id);
      for (const id of nextSources.keys()) if (!previousSources.has(id)) changedSources.add(id);
      const dependants = new Map();
      for (const source of [...previousSources.values(), ...nextSources.values()]) for (const referenced of sourceReferences(source.blocks)) {
        if (!dependants.has(referenced)) dependants.set(referenced, new Set());
        dependants.get(referenced).add(source.id);
      }
      const pending = [...changedSources];
      while (pending.length) for (const id of dependants.get(pending.pop()) || []) if (!changedSources.has(id)) { changedSources.add(id); pending.push(id); }
      for (const page of [...pagesById.values(), ...nextPages.values()]) if (sourceReferences(page.content).some((id) => changedSources.has(id))) changedPages.add(page.id);
    }
    for (const id of changedPages) removeSource(id);
    for (const id of changedPages) addSource(nextPages.get(id), next);
    pagesById = nextPages;
    indexedWorkspace = next;
  }

  function backlinksFor(targetPageId, workspace) {
    const lookup = workspace === indexedWorkspace ? pagesById : new Map((workspace?.pages || []).map((page) => [page.id, page]));
    const result = [];
    for (const [sourcePageId, links] of byTarget.get(targetPageId) || []) {
      const page = lookup.get(sourcePageId);
      if (page && !page.trashedAt) result.push({ sourcePageId, links: links.map((link) => ({ ...link })) });
    }
    return result.sort((first, second) => String(lookup.get(first.sourcePageId).title || "").localeCompare(String(lookup.get(second.sourcePageId).title || "")) || first.sourcePageId.localeCompare(second.sourcePageId));
  }

  return { rebuild, update, backlinksFor };
}
