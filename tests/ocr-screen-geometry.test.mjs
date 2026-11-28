import test from "node:test";
import assert from "node:assert/strict";
import { captureThumbnailSize, displayLocalRect, planSelection, rectangleBetween } from "../electron/main/ocr/screenGeometry.js";

const frames = [
  { id: "left", bounds: { x: -1280, y: -160, width: 1280, height: 960 }, size: { width: 1920, height: 1440 } },
  { id: "right", bounds: { x: 0, y: 0, width: 1920, height: 1080 }, size: { width: 1920, height: 1080 } },
];

test("maps a negative-origin display's rectangle to its high-DPI pixels", () => {
  const selected = rectangleBetween({ x: -920, y: 160 }, { x: -1110, y: -20 });
  assert.deepEqual(displayLocalRect(selected, frames[0].bounds), { x: 170, y: 140, width: 190, height: 180 });
  assert.deepEqual(planSelection(selected, frames).singleCrop.source, { x: 255, y: 210, width: 285, height: 270 });
});

test("composes a continuous crop across displays with different scale and vertical offset", () => {
  const selected = rectangleBetween({ x: 150, y: 250 }, { x: -200, y: -40 });
  const plan = planSelection(selected, frames);
  assert.deepEqual([plan.width, plan.height], [525, 435]);
  assert.deepEqual(plan.tiles.map(({ source }) => source), [
    { x: 1620, y: 180, width: 300, height: 435 },
    { x: 0, y: 0, width: 150, height: 250 },
  ]);
  assert.deepEqual(plan.tiles.map(({ destination }) => destination), [
    { x: 0, y: 0, width: 300, height: 435 },
    { x: 300, y: 60, width: 225, height: 375 },
  ]);
});

test("bounds thumbnail and composite dimensions conservatively", () => {
  const displays = Array.from({ length: 3 }, (_, index) => ({ bounds: { x: index * 3200, y: 0, width: 3200, height: 1800 }, scaleFactor: 2 }));
  const thumbnail = captureThumbnailSize(displays);
  assert.ok(thumbnail.width * thumbnail.height * displays.length <= 36_000_000);
  const frames = displays.map(({ bounds }) => ({ bounds, size: thumbnail }));
  const plan = planSelection({ x: 0, y: 0, width: 9600, height: 1800 }, frames);
  assert.ok(plan.width <= 8192 && plan.width * plan.height <= 24_000_000);
  assert.throws(() => planSelection({ x: 0, y: 0, width: 1, height: 80 }, frames), { code: "E_OCR_SELECTION" });
});
