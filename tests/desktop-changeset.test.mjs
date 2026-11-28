import test from "node:test";
import assert from "node:assert/strict";
import { createChangeTracker } from "../src/persistence/changeset.js";
import { createDesktopWorkspaceRepository } from "../src/persistence/desktopWorkspaceRepository.js";
import { upgradeWorkspace } from "../src/persistence/migrations.js";
import { fullWorkspace } from "./fixtures/full-workspace.mjs";

const fixture = () => ({ ...upgradeWorkspace(fullWorkspace()), workspaceId: "ws-diff" });

test("diff is empty when nothing changed", () => {
  const workspace = fixture();
  const tracker = createChangeTracker(workspace);
  assert.equal(tracker.isEmpty(tracker.diff(workspace)), true);
  assert.deepEqual(tracker.diff(workspace), { upserts: [], deletes: [], ui: null });
});

test("diff contains added, changed and deleted entities only", () => {
  const before = fixture();
  const changed = { ...before.pages[0], title: "changed" };
  const added = { ...changed, id: "new-page" };
  const next = { ...before, pages: [changed, ...before.pages.slice(2), added] };
  const diff = createChangeTracker(before).diff(next);
  assert.deepEqual(diff.upserts.map((entry) => entry.id), [changed.id, added.id]);
  assert.deepEqual(diff.deletes, [{ collection: "pages", id: before.pages[1].id }]);
  assert.equal(diff.ui, null);
});

test("ui changes are detected by value", () => {
  const before = fixture();
  const tracker = createChangeTracker(before);
  assert.equal(tracker.diff({ ...before, ui: structuredClone(before.ui) }).ui, null);
  const ui = { ...before.ui, privateExpanded: false };
  assert.deepEqual(tracker.diff({ ...before, ui }).ui, ui);
});

test("commit moves the baseline", () => {
  const before = fixture();
  const next = { ...before, pages: before.pages.map((page, index) => index === 0 ? { ...page, title: "saved" } : page) };
  const tracker = createChangeTracker(before);
  assert.equal(tracker.diff(next).upserts.length, 1);
  tracker.commit(next);
  assert.equal(tracker.isEmpty(tracker.diff(next)), true);
});

test("desktop repository keeps unsaved changes after a failed save", async () => {
  const before = fixture();
  const calls = [];
  const bridge = { workspace: { load: async () => ({ ok: true, value: { workspace: before, generation: "gen-loaded" } }), applyChanges: async (changeset) => { calls.push(changeset); return calls.length === 1 ? { ok: false, error: { code: "E_IO", message: "retry" } } : { ok: true, value: { savedAt: "2026-10-01T08:00:01.000Z" } }; } } };
  const repository = createDesktopWorkspaceRepository(bridge);
  assert.equal(await repository.load(), before);
  const first = { ...before, pages: before.pages.map((page, index) => index === 0 ? { ...page, title: "first" } : page) };
  assert.equal((await repository.save(first)).ok, false);
  const second = { ...first, pages: first.pages.map((page, index) => index === 1 ? { ...page, title: "second" } : page) };
  assert.equal((await repository.save(second)).ok, true);
  assert.deepEqual(calls[1].upserts.map((entry) => entry.id), before.pages.slice(0, 2).map((page) => page.id));
});

test("desktop repository sends the loaded generation", async () => {
  const before = fixture();
  let received;
  const repository = createDesktopWorkspaceRepository({ workspace: { load: async () => ({ ok: true, value: { workspace: before, generation: "gen-from-database" } }), applyChanges: async (args) => { received = args; return { ok: true, value: {} }; } } });
  await repository.load();
  await repository.save({ ...before, ui: { ...before.ui, privateExpanded: false } });
  assert.equal(received.generation, "gen-from-database");
});

test("a failed desktop load blocks all writes and never falls back to sample data", async () => {
  let writes = 0;
  const repository = createDesktopWorkspaceRepository({ workspace: { load: async () => ({ ok: false, error: { code: "E_CORRUPT", message: "corrupt" } }), applyChanges: async () => { writes += 1; } } }, { fallbackWorkspace: fixture() });
  await assert.rejects(repository.load(), { code: "E_CORRUPT" });
  assert.equal((await repository.save(fixture())).error.code, "E_CORRUPT");
  assert.equal(writes, 0);
});

test("a prepended page preserves array order without changing the public changeset shape", () => {
  const workspace = fixture();
  const added = { ...workspace.pages[0], id: "prepended" };
  const diff = createChangeTracker(workspace).diff({ ...workspace, pages: [added, ...workspace.pages] });
  assert.deepEqual(diff.upserts.map((entry) => entry.id), [added.id, ...workspace.pages.map((page) => page.id)]);
  assert.deepEqual(Object.keys(diff).sort(), ["deletes", "ui", "upserts"]);
});
