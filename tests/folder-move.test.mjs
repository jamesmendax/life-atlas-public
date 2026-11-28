import test from "node:test";
import assert from "node:assert/strict";
import { fullWorkspace } from "./fixtures/full-workspace.mjs";
import { upgradeWorkspace } from "../src/persistence/migrations.js";
import { moveFolder } from "../src/domain/navigation.js";
import { trashFolder } from "../src/domain/trash.js";

const NOW = "2026-10-02T08:00:00.000Z";
const workspace = () => upgradeWorkspace(fullWorkspace());

test("moveFolder rejects moving a folder into itself", () => {
  assert.throws(() => moveFolder(workspace(), "f-a", "f-a", NOW), { message: "不能把文件夹移动到它自己或它的子文件夹里" });
});

test("moveFolder rejects moving a folder into its descendant", () => {
  assert.throws(() => moveFolder(workspace(), "f-a", "f-c", NOW), { message: "不能把文件夹移动到它自己或它的子文件夹里" });
});

test("moveFolder moves to top level and appends the sort index", () => {
  const input = workspace();
  const before = structuredClone(input);
  const moved = moveFolder(input, "f-b", null, NOW);
  const folder = moved.folders.find((entry) => entry.id === "f-b");
  assert.equal(folder.parentId, null);
  assert.equal(folder.sortIndex, 40);
  assert.equal(folder.updatedAt, NOW);
  assert.equal(moved.folders.find((entry) => entry.id === "f-c").parentId, "f-b");
  assert.deepEqual(moved.pages, input.pages);
  assert.deepEqual(input, before);
});

test("moveFolder rejects a trashed target", () => {
  const input = trashFolder(workspace(), "f-z", NOW);
  assert.throws(() => moveFolder(input, "f-b", "f-z", NOW), { message: "目标文件夹不可用" });
});

test("moveFolder rejects unavailable source and missing target folders", () => {
  const input = workspace();
  assert.throws(() => moveFolder(input, "missing", null, NOW), { message: "文件夹不可用" });
  assert.throws(() => moveFolder(trashFolder(input, "f-b", NOW), "f-b", null, NOW), { message: "文件夹不可用" });
  assert.throws(() => moveFolder(input, "f-b", "missing", NOW), { message: "目标文件夹不可用" });
});
