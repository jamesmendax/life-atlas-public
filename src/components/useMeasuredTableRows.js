import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { measuredTableLayout } from "../domain/measuredTableLayout.js";

export function useMeasuredTableRows({ enabled, rows, geometry, containerRef, viewport, setViewport }) {
  const heights = useMemo(() => new Map(), [geometry]);
  const [revision, setRevision] = useState(0);
  const previous = useRef(null);
  const layout = useMemo(() => enabled ? measuredTableLayout(rows, heights) : null, [enabled, rows, heights, revision]);
  const headerHeight = viewport.headerHeight ?? 34;
  const range = layout?.windowAt(viewport.scrollTop - headerHeight, viewport.height);

  useLayoutEffect(() => {
    const old = previous.current;
    previous.current = layout;
    const container = containerRef.current;
    if (!layout || !old || layout === old || !container || !rows.length) return;
    // Spacers change as rows are measured or columns resize. Preserve the
    // first visible row and its offset rather than keeping an obsolete pixel.
    const scrollTop = viewport.scrollTop;
    if (scrollTop <= 0) return;
    // The sticky header covers its original height at the viewport edge.
    const row = old.rowAt(scrollTop);
    if (rows[row]?.key !== old.rows[row]?.key) return;
    const height = layout.offsets[row + 1] - layout.offsets[row];
    const within = Math.min(scrollTop - old.offsets[row], Math.max(0, height - 1));
    const next = viewport.atBottom ? container.scrollHeight - container.clientHeight : layout.offsets[row] + within;
    if (Math.abs(next - container.scrollTop) < 1) return;
    container.scrollTop = Math.max(0, next);
    const actual = container.scrollTop;
    setViewport(state => state.scrollTop === actual ? state : { ...state, scrollTop: actual });
  }, [layout, rows, containerRef, viewport.scrollTop, viewport.atBottom, setViewport]);

  useLayoutEffect(() => {
    if (!enabled || !containerRef.current) return;
    const observer = new ResizeObserver(entries => {
      let changed = false;
      for (const entry of entries) {
        const node = entry.target;
        const row = rows[Number(node.dataset.measureIndex)];
        if (!node.isConnected || !row || row.key !== node.dataset.measureKey) continue;
        const height = entry.borderBoxSize?.[0]?.blockSize ?? node.offsetHeight;
        if (height > 0 && Math.abs((heights.get(row.key) || 0) - height) > 0.05) {
          heights.set(row.key, height);
          changed = true;
        }
      }
      if (changed) setRevision(value => value + 1);
    });
    for (const node of containerRef.current.querySelectorAll("tbody > tr[data-measure-index]")) {
      observer.observe(node, { box: "border-box" });
    }
    return () => observer.disconnect();
  }, [enabled, rows, heights, range?.start, range?.end, containerRef]);

  return { layout, range };
}
