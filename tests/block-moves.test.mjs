import test from "node:test";
import assert from "node:assert/strict";
import { fullWorkspace } from "./fixtures/full-workspace.mjs";
import { upgradeWorkspace } from "../src/persistence/migrations.js";
import { appendBlocksToPage } from "../src/domain/blockMoves.js";
import { cloneBlockDocument, walkBlocks } from "../src/domain/blockDocument.js";

test("appending blocks keeps their ids and children", () => {
  const workspace = upgradeWorkspace(fullWorkspace());
  const before = structuredClone(workspace);
  const target = workspace.pages.find((page) => page.id === "p-z1");
  const blocks = [{ id: "move-parent", type: "paragraph", content: "父区块", children: [{ id: "move-child", type: "paragraph", content: "子区块" }] }];
  const now = "2026-11-07T09:00:00.000Z";
  const result = appendBlocksToPage(workspace, { pageId: "p-z1", blocks, now });
  const updated = result.pages.find((page) => page.id === "p-z1");
  assert.equal(updated.content.at(-1).id, "move-parent");
  assert.equal(updated.content.at(-1).children[0].id, "move-child");
  assert.equal(updated.updatedAt, now);
  assert.equal(updated.contentRevision, target.contentRevision + 1);
  assert.equal(updated.content.length, target.content.length + 1);
  for (const page of workspace.pages.filter((page) => page.id !== "p-z1")) assert.equal(result.pages.find((entry) => entry.id === page.id), page);
  assert.deepEqual(workspace, before);
  blocks[0].content = "之后变化";
  assert.equal(updated.content.at(-1).content, "父区块");
});

test("appending to a missing or trashed page is refused", () => {
  const workspace = upgradeWorkspace(fullWorkspace());
  for (const pageId of ["p-missing", "p-b-solo"]) assert.throws(() => appendBlocksToPage(workspace, { pageId, blocks: [], now: "2026-11-07T09:00:00.000Z" }), /目标页面不存在或已在回收站/);
});

test("duplicating a block gives fresh ids to it and its children", () => {
  const blocks = [{ id: "parent", type: "paragraph", content: "相同内容", children: [{ id: "child", type: "paragraph", content: "子内容" }] }];
  let sequence = 0;
  const copies = cloneBlockDocument(blocks, (prefix) => `${prefix}-fresh-${++sequence}`);
  const original = walkBlocks(blocks);
  const duplicated = walkBlocks(copies);
  assert.equal(original.length, duplicated.length);
  const ids = new Set(original.map((block) => block.id));
  duplicated.forEach((block, index) => { assert.equal(ids.has(block.id), false); assert.equal(block.content, original[index].content); });
  assert.equal(new Set(duplicated.map((block) => block.id)).size, duplicated.length);
});
