// The excerpt keeps inline marks and links together with the text they describe.
export function feedExcerpt(blocks, maxBlocks = 4, maxChars = 560) {
  let remaining = maxChars;
  let truncated = blocks.length > maxBlocks;
  function shorten(text) {
    if (text.length <= remaining) { remaining -= text.length; return text; }
    const clipped = text.slice(0, remaining);
    remaining = 0;
    truncated = true;
    return clipped + "…";
  }
  function inline(value) {
    if (typeof value === "string") return shorten(value);
    if (!Array.isArray(value)) return value;
    const result = [];
    for (const part of value) {
      if (!remaining) { truncated = true; break; }
      if (typeof part === "string") result.push(shorten(part));
      else if (typeof part?.text === "string") result.push({ ...part, text: shorten(part.text) });
      else if (part?.content) result.push({ ...part, content: inline(part.content) });
      else result.push(part);
    }
    return result;
  }
  const excerpt = [];
  for (const original of blocks.slice(0, maxBlocks)) {
    if (!remaining) { truncated = true; break; }
    const block = { ...original, children: [] };
    if (original.children?.length) truncated = true;
    if (block.type === "table") {
      const data = block.content || {};
      const rows = data.rows || (Array.isArray(data) ? data : []);
      if (rows.length > 3) truncated = true;
      const occupiedUntil = [];
      block.content = { ...data, rows: rows.slice(0, 3).map((row,rowIndex) => {
        const cells = row.cells || row;
        const visible = [];
        let column = 0;
        for (const cell of cells) {
          while (occupiedUntil[column] > rowIndex) column++;
          if (column >= 6) { truncated = true; break; }
          const width = Math.max(1, Number(cell?.props?.colspan) || 1);
          const height = Math.max(1, Number(cell?.props?.rowspan) || 1);
          const colspan = Math.min(width, 6 - column);
          const rowspan = Math.min(height, 3 - rowIndex);
          if (colspan !== width || rowspan !== height) truncated = true;
          if (cell && !Array.isArray(cell) && typeof cell === "object") {
            visible.push({ ...cell, props: { ...cell.props, colspan, rowspan }, content: inline(cell.content) });
          } else visible.push(inline(cell));
          for (let offset = 0; offset < colspan; offset++) occupiedUntil[column + offset] = rowIndex + rowspan;
          column += colspan;
        }
        return { cells: visible };
      }) };
    } else block.content = inline(block.content);
    excerpt.push(block);
  }
  return { blocks: truncated ? excerpt : blocks, truncated };
}
