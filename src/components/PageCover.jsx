import { useEffect, useLayoutEffect, useRef, useState } from "react";
import IconPhoto from "@tabler/icons-react/dist/esm/icons/IconPhoto.mjs";
import { galleryCoverImage } from "../data/coverGallery.js";
import { useAttachmentMediaUrl } from "./AttachmentMedia.jsx";
import { clampCoverPosition, coverVerticalOverflow, draggedCoverPosition } from "./coverPosition.js";

export function PageCover({ cover, readOnly, onChangeCover, onSavePosition, focusChangeOnMount }) {
  const image = galleryCoverImage(cover);
  const imageUrl = useAttachmentMediaUrl(image?.url);
  const savedPosition = clampCoverPosition(cover?.position ?? image?.position);
  const [draft, setDraft] = useState(null);
  const editing = !readOnly && draft !== null;
  const imageRef = useRef(null);
  const sliderRef = useRef(null);
  const triggerRef = useRef(null);
  const drag = useRef(null);
  const returnFocus = useRef(false);

  useEffect(() => {
    drag.current = null;
    setDraft(null);
  }, [image?.url, savedPosition, readOnly]);

  useLayoutEffect(() => {
    if (editing) sliderRef.current?.focus({ preventScroll: true });
    else if (returnFocus.current) triggerRef.current?.focus({ preventScroll: true });
    returnFocus.current = false;
  }, [editing]);

  function finish(save, restoreFocus = true) {
    if (save && draft !== savedPosition) onSavePosition(draft);
    drag.current = null;
    returnFocus.current = restoreFocus;
    setDraft(null);
  }

  function startDrag(event) {
    if (!event.isPrimary || event.button !== 0 || drag.current) return;
    event.preventDefault();
    const slider = event.currentTarget;
    slider.focus({ preventScroll: true });
    drag.current = {
      id: event.pointerId,
      startY: event.clientY,
      position: draft,
      overflow: coverVerticalOverflow(slider.getBoundingClientRect(), imageRef.current),
    };
    slider.setPointerCapture(event.pointerId);
  }

  function moveDrag(event) {
    const current = drag.current;
    if (current?.id !== event.pointerId) return;
    setDraft(draggedCoverPosition(current.position, event.clientY - current.startY, current.overflow));
  }

  function cancelDrag(event) {
    if (drag.current?.id !== event.pointerId) return;
    setDraft(drag.current.position);
    drag.current = null;
  }

  function keyDown(event) {
    if (!editing) return;
    if (event.key === "Escape") finish(false);
    else if (event.target !== sliderRef.current) return;
    else if (event.key === "Enter") finish(true);
    else if (event.key === "Home") setDraft(0);
    else if (event.key === "End") setDraft(100);
    else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      const step = event.shiftKey ? 10 : 1;
      setDraft((value) => clampCoverPosition(value + (event.key === "ArrowUp" ? step : -step)));
    } else return;
    event.preventDefault();
    event.stopPropagation();
  }

  const upload = cover.kind === "upload" || typeof cover === "string";
  const tint = upload ? "linear-gradient(rgba(0,0,0,.08), rgba(0,0,0,.14))" : "linear-gradient(rgba(0,0,0,.04), rgba(0,0,0,.12))";
  return (
    <div
      className={`page-cover page-cover-${cover.kind || "custom"}${editing ? " is-repositioning" : ""}`}
      style={{
        backgroundImage: imageUrl ? `${tint}, url(${JSON.stringify(imageUrl)})` : undefined,
        backgroundPosition: `center ${editing ? draft : savedPosition}%`,
      }}
      onKeyDown={keyDown}
      onBlur={(event) => {
        if (editing && event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) finish(false, false);
      }}
    >
      {imageUrl && <img hidden ref={imageRef} src={imageUrl} alt="" />}
      {editing && (
        <div
          ref={sliderRef}
          className="page-cover-drag-surface"
          role="slider"
          tabIndex={0}
          aria-label="封面垂直位置"
          aria-orientation="vertical"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={draft}
          aria-valuetext={`距顶部 ${Math.round(draft)}%`}
          data-html2canvas-ignore="true"
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={(event) => {
            if (drag.current?.id !== event.pointerId) return;
            moveDrag(event);
            drag.current = null;
          }}
          onPointerCancel={cancelDrag}
          onLostPointerCapture={cancelDrag}
        >
          <span>拖动以调整位置</span>
        </div>
      )}
      {!readOnly && (
        <div className="page-cover-controls" role="group" aria-label="封面操作" data-html2canvas-ignore="true">
          {editing ? <>
            <button type="button" className="cover-action" onClick={() => finish(true)}>保存位置</button>
            <button type="button" className="cover-action" onClick={() => finish(false)}>取消</button>
          </> : <>
            <button type="button" className="cover-action" onClick={onChangeCover} autoFocus={focusChangeOnMount}><IconPhoto size={14} stroke={1.8} />更换封面</button>
            <button type="button" ref={triggerRef} className="cover-action" onClick={() => setDraft(savedPosition)}>调整位置</button>
          </>}
        </div>
      )}
    </div>
  );
}
