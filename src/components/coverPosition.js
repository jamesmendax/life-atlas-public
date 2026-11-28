export function clampCoverPosition(position) {
  const value = Number(position ?? 50);
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 50;
}

// With background-size: cover, only the pixels outside the frame can be dragged into view.
export function coverVerticalOverflow(frame, image) {
  if (!image?.naturalWidth || !image.naturalHeight || !frame.width || !frame.height) return 0;
  return Math.max(0, frame.width * image.naturalHeight / image.naturalWidth - frame.height);
}

export function draggedCoverPosition(startPosition, distanceY, overflow) {
  if (overflow <= 0) return startPosition;
  return clampCoverPosition(Math.round((startPosition - distanceY * 100 / overflow) * 100) / 100);
}

export function coverWithPosition(cover, position) {
  const fields = typeof cover === "string" ? { kind: "upload", value: cover } : cover;
  return { ...fields, position: clampCoverPosition(position) };
}
