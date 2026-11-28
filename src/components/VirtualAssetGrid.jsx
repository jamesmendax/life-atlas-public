import { useEffect, useMemo, useRef, useState } from "react";

export function VirtualAssetGrid({
  items,
  renderItem,
  className = "",
  minCellWidth = 56,
  rowHeight = 52,
  gap = 4,
  maxColumns = 12,
  height = 272,
  overscanRows = 2,
  emptyText = "没有匹配的项目",
  resetKey = "",
}) {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);

  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    const update = () => setWidth(node.clientWidth);
    update();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(update) : null;
    observer?.observe(node);
    return () => observer?.disconnect();
  }, []);

  useEffect(() => {
    setScrollTop(0);
    if (ref.current) ref.current.scrollTop = 0;
  }, [resetKey]);

  const columns = Math.max(1, Math.min(maxColumns, Math.floor((Math.max(width, minCellWidth) + gap) / (minCellWidth + gap))));
  const rows = Math.ceil(items.length / columns);
  const stride = rowHeight + gap;
  const visible = useMemo(() => {
    if (!items.length) return [];
    const startRow = Math.max(0, Math.floor(scrollTop / stride) - overscanRows);
    const endRow = Math.min(rows, Math.ceil((scrollTop + height) / stride) + overscanRows);
    const start = startRow * columns;
    const end = Math.min(items.length, endRow * columns);
    return items.slice(start, end).map((item, offset) => ({ item, index: start + offset }));
  }, [items, scrollTop, stride, overscanRows, rows, height, columns]);

  function focusIndex(nextIndex) {
    if (!ref.current || nextIndex < 0 || nextIndex >= items.length) return;
    const row = Math.floor(nextIndex / columns);
    const rowTop = row * stride;
    const rowBottom = rowTop + rowHeight;
    if (rowTop < ref.current.scrollTop) {
      ref.current.scrollTop = rowTop;
      setScrollTop(rowTop);
    } else if (rowBottom > ref.current.scrollTop + height) {
      const nextTop = Math.max(0, rowBottom - height);
      ref.current.scrollTop = nextTop;
      setScrollTop(nextTop);
    }
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        ref.current?.querySelector(`[data-index="${nextIndex}"] button, [data-index="${nextIndex}"] [tabindex]`)?.focus();
      });
    });
  }

  function handleKeyDown(event) {
    const cell = event.target.closest?.(".virtual-asset-cell");
    if (!cell || !ref.current?.contains(cell)) return;
    const currentIndex = Number(cell.dataset.index);
    if (!Number.isFinite(currentIndex)) return;
    const deltas = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -columns,
      ArrowDown: columns,
    };
    if (!(event.key in deltas)) return;
    event.preventDefault();
    focusIndex(Math.max(0, Math.min(items.length - 1, currentIndex + deltas[event.key])));
  }

  return (
    <div
      ref={ref}
      className={`virtual-asset-grid ${className}`}
      style={{ height }}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      onKeyDown={handleKeyDown}
      data-total-items={items.length}
      data-rendered-items={visible.length}
      data-columns={columns}
    >
      {items.length === 0 ? (
        <div className="virtual-asset-empty">{emptyText}</div>
      ) : (
        <div className="virtual-asset-grid-inner" style={{ height: Math.max(height, rows * stride - gap) }}>
          {visible.map(({ item, index }) => {
            const row = Math.floor(index / columns);
            const column = index % columns;
            const cellWidth = width > 0 ? (width - gap * (columns - 1)) / columns : minCellWidth;
            return (
              <div
                className="virtual-asset-cell"
                key={item.id ?? index}
                data-index={index}
                style={{
                  width: cellWidth,
                  height: rowHeight,
                  transform: `translate(${column * (cellWidth + gap)}px, ${row * stride}px)`,
                }}
              >
                {renderItem(item, index)}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
