import test from "node:test";
import assert from "node:assert/strict";
import { moveVisibleProperty } from "../src/domain/viewPropertyOrder.js";

test("visible properties move without changing fixed or unrecognized saved identifiers", () => {
  const visible = ["title", "status", "group", "notes", "old-property", "date"];
  const movable = ["status", "notes", "date"];
  assert.deepEqual(moveVisibleProperty(visible, movable, "date", "status"), [
    "title", "date", "group", "status", "old-property", "notes",
  ]);
  assert.deepEqual(moveVisibleProperty(visible, movable, "status", "date"), [
    "title", "notes", "group", "date", "old-property", "status",
  ]);
  assert.deepEqual(visible, ["title", "status", "group", "notes", "old-property", "date"]);
});

test("fixed, hidden, and identical fields cannot be moved or used as destinations", () => {
  const visible = ["title", "status", "notes"];
  const movable = ["status", "notes"];
  for (const [property, target] of [["title", "notes"], ["hidden", "notes"], ["status", "title"], ["notes", "notes"]]) {
    assert.equal(moveVisibleProperty(visible, movable, property, target), visible);
  }
});
