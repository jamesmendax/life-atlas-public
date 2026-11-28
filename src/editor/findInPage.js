export function findTextMatches(texts, query) {
  const needle = String(query ?? "");
  if (!needle.trim()) return [];
  const pattern = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu");
  const matches = [];
  texts.forEach((text, unit) => {
    for (const match of String(text).matchAll(pattern)) matches.push({ unit, start: match.index, end: match.index + match[0].length });
  });
  return matches;
}

export function collectFindUnits(root) {
  const document = root.ownerDocument;
  const walker = document.createTreeWalker(root, document.defaultView.NodeFilter.SHOW_TEXT);
  const unitsByElement = new Map();
  let node;
  while ((node = walker.nextNode())) {
    const parent = node.parentElement;
    if (!parent || parent.closest("script, style, input, textarea, select, option, [data-find-ignore]") || !parent.checkVisibility()) continue;
    const element = parent.closest(".bn-inline-content, td, th, li, p, h1, h2, h3, h4, button, a, label, [data-find-unit]") || parent;
    let unit = unitsByElement.get(element);
    if (!unit) { unit = { element, text: "", nodes: [] }; unitsByElement.set(element, unit); }
    unit.nodes.push({ node, start: unit.text.length });
    unit.text += node.textContent;
  }
  return [...unitsByElement.values()];
}

export function createRanges(units, matches) {
  return matches.map((match) => {
    const unit = units[match.unit];
    const start = unit.nodes.find((entry) => match.start < entry.start + entry.node.textContent.length);
    const end = unit.nodes.find((entry) => match.end <= entry.start + entry.node.textContent.length);
    const range = unit.element.ownerDocument.createRange();
    range.setStart(start.node, match.start - start.start);
    range.setEnd(end.node, match.end - end.start);
    return range;
  });
}
