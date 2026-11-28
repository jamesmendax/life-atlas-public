import test from "node:test";
import assert from "node:assert/strict";
import { mergeImportedWorkspace } from "../src/import/mergeImportedWorkspace.js";

const baseline = { workspaceId: "original", ui: { preferences: { theme: "system" } }, pages: [{ id: "old", title: "Old" }, { id: "deleted", title: "Deleted while importing" }], folders: [{ id: "old-folder", name: "Old folder" }], pageVersions: [{ id: "history-before", pageId: "old" }] };
const imported = { ...baseline, pages: [...baseline.pages, { id: "new", title: "New", content: [{ id: "block", type: "paragraph", content: "Imported" }] }], folders: [...baseline.folders, { id: "new-folder", name: "Import" }], attachments: [{ id: "new-asset", provider: "asset", storageKey: "a".repeat(64) }] };

test("Notion import commit preserves concurrent page edits and removals", () => {
  const current = { ...baseline, pages: [{ id: "old", title: "Edited while importing" }, { id: "concurrent", title: "Created while importing" }] };
  const result = mergeImportedWorkspace(current, baseline, imported);
  assert.deepEqual(result.pages.map(({ id, title }) => ({ id, title })), [{ id: "old", title: "Edited while importing" }, { id: "concurrent", title: "Created while importing" }, { id: "new", title: "New" }]);
  assert.equal(result.pages[0], current.pages[0]);
  assert.equal(result.pages.some((entry) => entry.id === "deleted"), false);
});

test("Notion import commit preserves current UI history and workspace identity", () => {
  const current = { ...baseline, ui: { preferences: { theme: "dark" }, selectedPageId: "old" }, pageVersions: [...baseline.pageVersions, { id: "history-during", pageId: "old" }] };
  const result = mergeImportedWorkspace(current, baseline, { ...imported, workspaceId: "stale", ui: {}, pageVersions: [] });
  assert.equal(result.ui, current.ui);
  assert.equal(result.pageVersions, current.pageVersions);
  assert.equal(result.workspaceId, "original");
  assert.equal(result.attachments.length, 1);
});

test("Notion import commit is replay safe and owns its imported entities", () => {
  const result = mergeImportedWorkspace(baseline, baseline, imported);
  assert.equal(mergeImportedWorkspace(result, baseline, imported), result);
  result.pages.at(-1).content[0].content = "Edited after import";
  assert.equal(imported.pages.at(-1).content[0].content, "Imported");
  assert.equal(baseline.pages.length, 2);
});

test("Notion import commit rejects collisions without changing existing data", () => {
  const current = { ...baseline, pages: [...baseline.pages, { id: "new", title: "Unrelated" }] };
  const before = structuredClone(current);
  assert.throws(() => mergeImportedWorkspace(current, baseline, imported), /冲突/);
  assert.deepEqual(current, before);
});
