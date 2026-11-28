import test from "node:test";
import assert from "node:assert/strict";

import { createPageVersion } from "../src/domain/pageHistory.js";
import { mergeImportedWorkspace } from "../src/import/mergeImportedWorkspace.js";
import { upgradeWorkspace } from "../src/persistence/migrations.js";
import { createBrowserWorkspaceRepository, workspaceStorageKey } from "../src/persistence/workspaceRepository.js";
import { fullWorkspace, FIXTURE_TIME } from "./fixtures/full-workspace.mjs";
import { memoryStorage } from "./fixtures/backup-helpers.mjs";

const now = Date.parse(FIXTURE_TIME);

function fixture() {
  const workspace = { ...upgradeWorkspace(fullWorkspace()), workspaceId: "history56-fixture", savedAt: FIXTURE_TIME };
  workspace.pageVersions = [
    createPageVersion(workspace.pages.find((page) => page.id === "p-a1-child"), { id: "history-1", now: now - 3600000, reason: "before-edit" }),
    createPageVersion(workspace.pages.find((page) => page.id === "p-b-solo"), { id: "history-2", now: now - 1800000, reason: "idle" }),
  ];
  assert.ok(workspace.pageVersions.every((version) => version && workspace.pages.some((page) => page.id === version.pageId)));
  return workspace;
}

test("raw browser seed retains valid history in memory through import merge but save drops it on reload", () => {
  const source = fixture();
  const storage = memoryStorage({ [workspaceStorageKey]: JSON.stringify(source) });
  const repository = createBrowserWorkspaceRepository(storage, { now: () => now });
  const baseline = repository.load(source);
  assert.deepEqual(baseline.pageVersions, source.pageVersions);
  const importedPage = { ...structuredClone(baseline.pages[0]), id: "imported-history56-page", title: "Imported page" };
  const imported = { ...baseline, pages: [...baseline.pages, importedPage] };
  const merged = mergeImportedWorkspace(baseline, baseline, imported);
  assert.deepEqual(merged.pageVersions, source.pageVersions);
  const original = structuredClone(merged);
  const result = repository.save(merged);
  assert.equal(result.ok, true);
  assert.deepEqual(merged, original);
  assert.deepEqual(JSON.parse(storage.getItem(workspaceStorageKey)).pageVersions, []);
  const reloaded = repository.load(source);
  assert.deepEqual(reloaded.pageVersions, []);
  assert.deepEqual(reloaded.pages.find((page) => page.id === importedPage.id), importedPage);
  for (const page of baseline.pages) assert.deepEqual(reloaded.pages.find((entry) => entry.id === page.id), page);
});

test("quota failure returns E_IO and leaves prior stored workspace intact", () => {
  const source = fixture();
  const previous = JSON.stringify(source);
  const storage = memoryStorage({ [workspaceStorageKey]: previous }, () => { throw new DOMException("Quota exceeded", "QuotaExceededError"); });
  const repository = createBrowserWorkspaceRepository(storage, { now: () => now });
  const loaded = repository.load(source);
  const result = repository.save({ ...loaded, pages: [...loaded.pages, { ...loaded.pages[0], id: "new-page" }] });
  assert.deepEqual(result, { ok: false, error: { code: "E_IO", message: "Quota exceeded" } });
  assert.equal(storage.getItem(workspaceStorageKey), previous);
  assert.deepEqual(repository.load(source).pageVersions, source.pageVersions);
});

test("corrupt browser data prevents an automatic save from overwriting it", () => {
  const source = fixture();
  const storage = memoryStorage({ [workspaceStorageKey]: "{corrupt" });
  const repository = createBrowserWorkspaceRepository(storage, { now: () => now });
  const originalWarn = console.warn;
  let fallback;
  try { console.warn = () => {}; fallback = repository.load(source); } finally { console.warn = originalWarn; }
  const result = repository.save(fallback);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "E_CORRUPT");
  assert.equal(storage.getItem(workspaceStorageKey), "{corrupt");
});
