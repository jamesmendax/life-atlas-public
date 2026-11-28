import { useContext, useLayoutEffect, useRef, useState } from "react";
import { LifeAtlasEditorRuntimeContext } from "./EditorRuntime.jsx";
import {
  abortColumnResize,
  beginColumnResize,
  getColumnListContext,
  getColumnResizeContext,
  measureColumnResize,
  positiveColumnWeight,
  resizeColumnWithKeyboard,
} from "./columnResize.js";

function useColumnContext(editor, blockId, list = false) {
  const read = () => list
    ? getColumnListContext(editor.prosemirrorState.doc, blockId)
    : getColumnResizeContext(editor.prosemirrorState.doc, blockId);
  const [context, setContext] = useState(read);
  useLayoutEffect(() => {
    setContext(read());
    return editor.onChange(() => setContext(read()));
  }, [editor, blockId, list]);
  return context;
}

export function ColumnListLayout({ block, editor }) {
  const context = useColumnContext(editor, block.id, true);
  const count = context?.columns.length ?? 0;
  return <div className="life-column-list-marker" data-column-list-id={block.id} data-column-count={count} aria-label={`${count} 列布局`} />;
}

export function ColumnLayout({ block, editor }) {
  const runtime = useContext(LifeAtlasEditorRuntimeContext);
  const runtimeRef = useRef(runtime);
  runtimeRef.current = runtime;
  const markerRef = useRef(null);
  const context = useColumnContext(editor, block.id);
  const [geometry, setGeometry] = useState(null);
  const [active, setActive] = useState(false);
  const [preview, setPreview] = useState(null);
  const locked = runtime?.locked === true || !editor.isEditable;
  const index = context?.index ?? -1;
  const count = context?.columns.length ?? 0;
  const width = positiveColumnWeight(context?.columns[index]?.width ?? block.props.width);
  const hasNext = index >= 0 && index < count - 1;

  useLayoutEffect(() => {
    const marker = markerRef.current;
    const windowObject = marker?.ownerDocument?.defaultView;
    if (!marker || !windowObject || !hasNext) {
      setGeometry(null);
      return;
    }
    const measure = () => {
      const next = measureColumnResize(editor, marker, block.id);
      setGeometry((previous) => previous?.availableWidth === next?.availableWidth && previous?.gap === next?.gap && previous?.group === next?.group ? previous : next);
    };
    const observer = typeof windowObject.ResizeObserver === "function" ? new windowObject.ResizeObserver(measure) : null;
    const group = marker.closest(".bn-block-outer[data-id]")?.parentElement;
    if (group) observer?.observe(group);
    windowObject.addEventListener("resize", measure);
    measure();
    return () => {
      observer?.disconnect();
      windowObject.removeEventListener("resize", measure);
    };
  }, [editor, block.id, hasNext, count]);

  useLayoutEffect(() => {
    if (locked) abortColumnResize(editor, "locked", { leftId: block.id });
    return () => { abortColumnResize(editor, "page-changed", { leftId: block.id }); };
  }, [editor, block.id, locked, runtime?.pageId]);

  const startResize = (event) => beginColumnResize(editor, event, {
    element: event.currentTarget,
    leftId: block.id,
    readGeometry: () => measureColumnResize(editor, markerRef.current, block.id),
    isLocked: () => runtimeRef.current?.locked === true,
    getPageId: () => runtimeRef.current?.pageId,
    onActiveChange: setActive,
    onPreview: setPreview,
    onEnd: () => setPreview(null),
  });
  const keyboardResize = (event) => resizeColumnWithKeyboard(editor, block.id, measureColumnResize(editor, markerRef.current, block.id), event, { locked });
  const leftWeight = preview?.left ?? width;
  const rightWeight = preview?.right ?? positiveColumnWeight(context?.columns[index + 1]?.width);
  const share = leftWeight / (leftWeight + rightWeight) * 100;

  return <div
    ref={markerRef}
    className="life-column-marker"
    data-column-id={block.id}
    data-column-index={index}
    data-column-count={count}
    data-column-width={width}
  >
    {hasNext && geometry && !locked && <button
      type="button"
      role="separator"
      className="life-column-resizer"
      data-resize-state={active ? "active" : "idle"}
      aria-label={`调整第 ${index + 1}、${index + 2} 列栏宽`}
      aria-orientation="vertical"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Number(share.toFixed(2))}
      aria-valuetext={`第 ${index + 1} 列占相邻两列的 ${Math.round(share)}%`}
      aria-keyshortcuts="ArrowLeft ArrowRight Shift+ArrowLeft Shift+ArrowRight"
      title="拖动调整栏宽；方向键每次 16 像素，Shift 加方向键每次 4 像素"
      style={{ "--life-column-resizer-width": `${geometry.hitWidth}px`, "--life-column-resizer-offset": `${-geometry.hitWidth}px` }}
      onPointerDown={startResize}
      onKeyDown={keyboardResize}
    />}
  </div>;
}
