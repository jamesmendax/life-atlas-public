import { cloneBlockDocument, sourceReferences } from "../domain/blockDocument.js";

function isEmptyParagraph(block) {
  if (block.type !== "paragraph" || block.children?.length) return false;
  if (typeof block.content === "string") return block.content.length === 0;
  return !block.content?.length || block.content.every((item) => item.type === "text" && !item.text);
}

export function createPresentationSlides(content) {
  const slides = [];
  let current = [];
  const finish = () => {
    if (current.some((block) => !isEmptyParagraph(block))) slides.push(cloneBlockDocument(current));
    current = [];
  };
  for (const block of content || []) {
    if (block.type === "divider") finish();
    else current.push(block);
  }
  finish();
  return slides;
}

export function snapshotPresentationSources(content, store) {
  const sources = new Map();
  const pending = [...sourceReferences(content)];
  while (pending.length) {
    const id = pending.pop();
    if (sources.has(id)) continue;
    const source = store?.getSource(id);
    sources.set(id, source ? { ...source, blocks: cloneBlockDocument(source.blocks) } : null);
    if (source && !source.deletedAt) pending.push(...sourceReferences(source.blocks));
  }
  return { getSource: (id) => sources.get(id) ?? null, subscribe: () => () => {} };
}
