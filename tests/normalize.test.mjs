import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fullWorkspace, FIXTURE_TIME } from "./fixtures/full-workspace.mjs";
import { CURRENT_SCHEMA_VERSION, upgradeWorkspace } from "../src/persistence/migrations.js";
import { normalizeLoadedWorkspace } from "../src/persistence/normalize.js";
import { createBrowserWorkspaceRepository, workspaceStorageKey } from "../src/persistence/workspaceRepository.js";
import { listTrashGroups, trashFolder } from "../src/domain/trash.js";

const NOW = "2026-10-02T08:00:00.000Z";
const DAY = 86400000;
const options = { fallbackWorkspace: fullWorkspace(), now: NOW, idFactory: (prefix) => `${prefix}-test` };

class MemoryStorage {
  values = new Map();
  writeCount = 0;
  failure = null;
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) {
    if (this.failure) throw this.failure;
    this.writeCount += 1;
    this.values.set(key, String(value));
  }
  removeItem(key) { this.values.delete(key); }
}

test("normalize fills page defaults like the old browser loader", () => {
  const input = fullWorkspace();
  const page = input.pages[0];
  for (const field of ["icon", "iconColor", "cover", "summary", "summaryUpdatedAt", "tags", "createdAt", "updatedAt"]) delete page[field];
  page.contentRevision = NaN;
  page.summarySourceRevision = NaN;
  page.settings = { fontFamily: "invalid", smallText: true, fullWidth: true, locked: true };
  delete input.folders[0].createdAt;
  delete input.folders[0].updatedAt;
  input.ui.assetPreferences.recentEmojiIds = ["one", "one", "two", null];
  input.ui.assetPreferences.recentCoverIds = Array.from({ length: 50 }, (_, index) => `cover-${index}`);
  const before = structuredClone(input);
  const normalized = normalizeLoadedWorkspace(input, options);
  const restored = normalized.pages[0];
  assert.equal(normalized.schemaVersion, CURRENT_SCHEMA_VERSION);
  assert.equal(restored.icon, "📄");
  assert.equal(restored.iconColor, null);
  assert.equal(restored.cover, null);
  assert.equal(restored.trashedAt, null);
  assert.equal(restored.summary, "");
  assert.equal(restored.contentRevision, 0);
  assert.equal(restored.summarySourceRevision, 0);
  assert.equal(restored.summaryUpdatedAt, FIXTURE_TIME);
  assert.equal(restored.createdAt, FIXTURE_TIME);
  assert.equal(restored.updatedAt, FIXTURE_TIME);
  assert.deepEqual(restored.tags, []);
  assert.deepEqual(restored.settings, { fontFamily: "default", smallText: true, fullWidth: true, presentationMode: "full", locked: true });
  assert.equal(normalized.folders[0].createdAt, FIXTURE_TIME);
  assert.equal(normalized.folders[0].updatedAt, FIXTURE_TIME);
  assert.deepEqual(normalized.ui.assetPreferences.recentEmojiIds, ["one", "two"]);
  assert.equal(normalized.ui.assetPreferences.recentCoverIds.length, 32);
  assert.deepEqual(input, before);
});

test("normalize purges expired trash groups using the injected now", () => {
  const input = trashFolder(upgradeWorkspace(fullWorkspace()), "f-a", NOW);
  const day29 = normalizeLoadedWorkspace(input, { ...options, now: Date.parse(NOW) + 29 * DAY });
  assert.deepEqual(listTrashGroups(day29, Date.parse(NOW) + 29 * DAY).map((group) => group.id), ["f-a"]);
  assert.equal(day29.pages.some((page) => page.id === "p-b-solo"), false);
  const day31 = normalizeLoadedWorkspace(input, { ...options, now: new Date(Date.parse(NOW) + 31 * DAY).toISOString() });
  assert.deepEqual(listTrashGroups(day31, NOW), []);
  assert.deepEqual(day31.folders.map((folder) => folder.id), ["f-z", "f-empty", "system-inbox"]);
  assert.equal(day31.folders.find((folder) => folder.id === "system-inbox").system, "inbox");
  assert.deepEqual(day31.dataSources.map((source) => source.id), ["ds-full"]);
  assert.deepEqual(day31.databaseItems.map((item) => item.id), ["i-3", "i-4"]);
  assert.deepEqual(day31.databaseItems[0].values["rel-back"], []);
  assert.equal(day31.ui.trashRestoreState, undefined);
});

test("normalize is deterministic for identical inputs", () => {
  const input = fullWorkspace();
  assert.deepEqual(normalizeLoadedWorkspace(input, options), normalizeLoadedWorkspace(input, options));
  const source = fs.readFileSync(new URL("../src/persistence/normalize.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /Date\.now\(|new Date\(|Math\.random\(|node:/);
});

test("normalize adds a workspaceId only when missing", () => {
  const input = fullWorkspace();
  const calls = [];
  const normalized = normalizeLoadedWorkspace(input, { ...options, idFactory: (prefix) => { calls.push(prefix); return "ws-generated"; } });
  assert.equal(normalized.workspaceId, "ws-generated");
  assert.deepEqual(calls, ["ws"]);
  const kept = normalizeLoadedWorkspace({ ...input, workspaceId: "ws-original" }, { ...options, idFactory: () => { throw new Error("factory should not run"); } });
  assert.equal(kept.workspaceId, "ws-original");
  assert.equal(input.workspaceId, undefined);
});

test("normalize validates the theme and preserves all unrelated preferences", () => {
  const input = fullWorkspace();
  input.ui.preferences = { theme: "unknown", defaultFont: "serif", startPage: "home", extraPreference: { keep: true } };
  const before = structuredClone(input);
  const normalized = normalizeLoadedWorkspace(input, options);
  assert.deepEqual(normalized.ui.preferences, { ...input.ui.preferences, theme: "system" });
  for (const theme of ["system", "light", "dark"]) {
    const valid = normalizeLoadedWorkspace({ ...input, ui: { ...input.ui, preferences: { ...input.ui.preferences, theme } } }, options);
    assert.equal(valid.ui.preferences.theme, theme);
    assert.deepEqual(valid.ui.preferences.extraPreference, { keep: true });
  }
  assert.equal(normalizeLoadedWorkspace(fullWorkspace(), options).ui.preferences.theme, "system");
  assert.deepEqual(input, before);
});

test("suspended repository saves do nothing", () => {
  const storage = new MemoryStorage();
  const repository = createBrowserWorkspaceRepository(storage, { now: () => NOW, idFactory: options.idFactory });
  const loaded = repository.load(fullWorkspace());
  assert.equal(repository.save(loaded).ok, true);
  const original = storage.getItem(workspaceStorageKey);
  const writes = storage.writeCount;
  repository.suspendSaves();
  assert.equal(repository.save({ ...loaded, savedAt: "later" }), null);
  assert.equal(repository.save({ ...loaded, pages: [] }), null);
  assert.equal(storage.getItem(workspaceStorageKey), original);
  assert.equal(storage.writeCount, writes);
  repository.resumeSaves();
  assert.equal(repository.save({ ...loaded, pages: [] }).ok, true);
  assert.equal(storage.writeCount, writes + 1);
  assert.deepEqual(JSON.parse(storage.getItem(workspaceStorageKey)).pages, []);
});

test("browser repository reports failed saves without replacing the saved workspace", () => {
  const storage = new MemoryStorage();
  const repository = createBrowserWorkspaceRepository(storage, { now: () => NOW, idFactory: options.idFactory });
  const loaded = repository.load(fullWorkspace());
  repository.save(loaded);
  const original = storage.getItem(workspaceStorageKey);
  storage.failure = new Error("quota");
  const failed = repository.save({ ...loaded, pages: [] });
  assert.deepEqual(failed, { ok: false, error: { code: "E_IO", message: "quota" } });
  assert.equal(storage.getItem(workspaceStorageKey), original);
  storage.failure = null;
  assert.equal(repository.save({ ...loaded, pages: [] }).ok, true);
});

test("browser repository blocks saves after an unreadable load", () => {
  const storage = new MemoryStorage();
  storage.setItem(workspaceStorageKey, "not-json");
  const repository = createBrowserWorkspaceRepository(storage, { now: () => NOW, idFactory: options.idFactory });
  const warn = console.warn;
  let fallback;
  try {
    console.warn = () => {};
    fallback = repository.load(fullWorkspace());
  } finally { console.warn = warn; }
  const writes = storage.writeCount;
  assert.equal(repository.save(fallback).ok, false);
  assert.equal(storage.getItem(workspaceStorageKey), "not-json");
  assert.equal(storage.writeCount, writes);
});
