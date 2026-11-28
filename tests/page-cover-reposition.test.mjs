import assert from "node:assert/strict";
import test from "node:test";
import { clampCoverPosition, coverVerticalOverflow, draggedCoverPosition, coverWithPosition } from "../src/components/coverPosition.js";
import { galleryCoverImage, normalizeCoverChoice } from "../src/data/coverGallery.js";

test("cover dragging matches the visible image displacement and clamps to the actual crop", () => {
  const frame = { width: 800, height: 200 };
  const photo = { naturalWidth: 1600, naturalHeight: 1200 };
  const overflow = coverVerticalOverflow(frame, photo);
  assert.equal(overflow, 400);
  assert.equal(draggedCoverPosition(50, 40, overflow), 40);
  assert.equal(draggedCoverPosition(50, -80, overflow), 70);
  assert.equal(draggedCoverPosition(50, 220, overflow), 0);
  assert.equal(draggedCoverPosition(50, -245, overflow), 100);
  assert.equal(draggedCoverPosition(10, -1, 4000), 10.03);
  assert.equal(coverVerticalOverflow(frame, { naturalWidth: 2000, naturalHeight: 200 }), 0);
  assert.equal(coverVerticalOverflow(frame, { naturalWidth: 0, naturalHeight: 0 }), 0);
  assert.equal(draggedCoverPosition(17, -80, 0), 17);
});

test("saving a position retains the original cover reference, metadata and both boundaries", () => {
  const address = `life-asset://${"a".repeat(64)}`;
  const upload = Object.freeze({ kind: "upload", value: address, position: 40, description: "local" });
  assert.deepEqual(coverWithPosition(upload, -10), { ...upload, position: 0 });
  assert.equal(galleryCoverImage(coverWithPosition(upload, 0)).url, address);
  const oldPreset = { kind: "preset", value: "indigo", position: 12 };
  const updated = coverWithPosition(oldPreset, 120);
  assert.deepEqual(updated, { ...oldPreset, position: 100 });
  assert.equal(galleryCoverImage(updated).position, 100);
  assert.equal(oldPreset.position, 12);
  assert.deepEqual(coverWithPosition(address, 0), { kind: "upload", value: address, position: 0 });
  assert.deepEqual(normalizeCoverChoice(address), { kind: "upload", value: address, position: 50 });
  assert.equal(clampCoverPosition(undefined), 50);
});
