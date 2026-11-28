import { OcrError } from "./errors.js";
import { MAX_IMAGE_EDGE, MAX_IMAGE_PIXELS } from "./images.js";

const MAX_CAPTURE_PIXELS = 36_000_000;

export function rectangleBetween(start, end) {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(start.x - end.x),
    height: Math.abs(start.y - end.y),
  };
}

export function intersectRect(a, b) {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const width = Math.min(a.x + a.width, b.x + b.width) - x;
  const height = Math.min(a.y + a.height, b.y + b.height) - y;
  return width > 0 && height > 0 ? { x, y, width, height } : null;
}

export function displayLocalRect(rect, bounds) {
  const hit = intersectRect(rect, bounds);
  return hit ? { ...hit, x: hit.x - bounds.x, y: hit.y - bounds.y } : null;
}

export function captureThumbnailSize(displays) {
  const width = Math.max(...displays.map(({ bounds, scaleFactor }) => Math.round(bounds.width * scaleFactor)));
  const height = Math.max(...displays.map(({ bounds, scaleFactor }) => Math.round(bounds.height * scaleFactor)));
  const scale = Math.min(1, 5120 / Math.max(width, height), Math.sqrt(MAX_CAPTURE_PIXELS / (width * height * displays.length)));
  return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) };
}

function sourceRectangle(hit, bounds, imageSize) {
  const scaleX = imageSize.width / bounds.width;
  const scaleY = imageSize.height / bounds.height;
  const x = Math.floor((hit.x - bounds.x) * scaleX);
  const y = Math.floor((hit.y - bounds.y) * scaleY);
  return {
    x,
    y,
    width: Math.min(imageSize.width, Math.ceil((hit.x + hit.width - bounds.x) * scaleX)) - x,
    height: Math.min(imageSize.height, Math.ceil((hit.y + hit.height - bounds.y) * scaleY)) - y,
  };
}

export function planSelection(selection, frames) {
  const pieces = frames.flatMap((frame) => {
    const hit = intersectRect(selection, frame.bounds);
    return hit ? [{ frame, hit, source: sourceRectangle(hit, frame.bounds, frame.size) }] : [];
  });
  if (!pieces.length || selection.width < 4 || selection.height < 4) throw new OcrError("E_OCR_SELECTION");

  if (pieces.length === 1) {
    const { frame, source } = pieces[0];
    if (source.width <= MAX_IMAGE_EDGE && source.height <= MAX_IMAGE_EDGE && source.width * source.height <= MAX_IMAGE_PIXELS) {
      return { singleCrop: { frame, source } };
    }
  }

  const area = {
    x: Math.min(...pieces.map(({ hit }) => hit.x)),
    y: Math.min(...pieces.map(({ hit }) => hit.y)),
  };
  area.width = Math.max(...pieces.map(({ hit }) => hit.x + hit.width)) - area.x;
  area.height = Math.max(...pieces.map(({ hit }) => hit.y + hit.height)) - area.y;
  const densest = Math.max(...pieces.map(({ frame }) => Math.min(frame.size.width / frame.bounds.width, frame.size.height / frame.bounds.height)));
  const scale = Math.min(densest, MAX_IMAGE_EDGE / Math.max(area.width, area.height), Math.sqrt(MAX_IMAGE_PIXELS / (area.width * area.height)));
  const width = Math.max(1, Math.floor(area.width * scale));
  const height = Math.max(1, Math.floor(area.height * scale));
  const destination = ({ x: left, y: top, width: w, height: h }) => {
    const x = Math.round((left - area.x) * width / area.width);
    const y = Math.round((top - area.y) * height / area.height);
    return { x, y, width: Math.round((left + w - area.x) * width / area.width) - x, height: Math.round((top + h - area.y) * height / area.height) - y };
  };
  return { width, height, tiles: pieces.map(({ frame, hit, source }) => ({ frame, source, destination: destination(hit) })) };
}
