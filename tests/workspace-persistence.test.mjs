import test from "node:test";
import assert from "node:assert/strict";

import { seedWorkspace } from "../src/domain/workspaceSeed.js";
import {
  createBrowserWorkspaceRepository,
  workspaceSchemaVersion,
  workspaceStorageKey,
} from "../src/persistence/workspaceRepository.js";

class MemoryStorage {
  constructor() {
    this.values = new Map();
  }
  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }
  setItem(key, value) {
    this.values.set(key, String(value));
  }
  removeItem(key) {
    this.values.delete(key);
  }
}

test("legacy workspaces migrate to the current schema preserving appearance, trash, and database collections", () => {
  const storage = new MemoryStorage();
  const oldWorkspace = {
    ...seedWorkspace,
    schemaVersion: 2,
    ui: {
      ...seedWorkspace.ui,
      assetPreferences: undefined,
    },
  };
  storage.setItem("life-atlas.workspace.v2", JSON.stringify(oldWorkspace));
  const repo = createBrowserWorkspaceRepository(storage);
  const loaded = repo.load(seedWorkspace);

  assert.ok(workspaceSchemaVersion >= 7);
  assert.equal(loaded.schemaVersion, workspaceSchemaVersion);
  assert.deepEqual(loaded.dataSources, []);
  assert.deepEqual(loaded.databaseItems, []);
  assert.deepEqual(loaded.databaseViews, []);
  assert.deepEqual(loaded.relations, []);
  assert.deepEqual(loaded.ui.assetPreferences, {
    recentEmojiIds: [],
    recentIconIds: [],
    recentCoverIds: [],
    favoriteCoverIds: [],
  });
  assert.equal(loaded.pages.find((page) => page.id === "chemistry")?.iconColor, "#a887df");
  assert.deepEqual(loaded.pages.find((page) => page.id === "chemistry")?.settings, {
    fontFamily: "default",
    smallText: false,
    fullWidth: false,
    presentationMode: "default",
    locked: false,
  });
  assert.equal(loaded.pages.find((page) => page.id === "chemistry")?.trashedAt, null);
  repo.save(loaded);
  assert.equal(storage.getItem("life-atlas.workspace.v2"), JSON.stringify(oldWorkspace));
  assert.ok(Array.isArray(loaded.syncedSources));
  assert.ok(loaded.people.some((person) => person.id === "person-local"));
});

test("schema v5 database collections migrate without losing existing pages", () => {
  const storage = new MemoryStorage();
  const source = { id: "source-1", title: "Tasks", properties: [{ id: "title", name: "Name", type: "title" }] };
  const item = { id: "item-1", sourceId: "source-1", pageId: "chemistry", parentItemId: null, values: { title: "Chemistry" } };
  const view = { id: "view-1", sourceId: "source-1", name: "Table", type: "table", filter: null, sorts: [], groupBy: null, visiblePropertyIds: ["title"], config: {}, linked: false };
  const relation = { id: "rel-1", sourceId: "source-1", propertyId: "related", targetSourceId: "source-1", reciprocalPropertyId: null };
  storage.setItem("life-atlas.workspace.v5", JSON.stringify({
    ...seedWorkspace,
    schemaVersion: 5,
    dataSources: [source],
    databaseItems: [item],
    databaseViews: [view],
    relations: [relation],
  }));
  const loaded = createBrowserWorkspaceRepository(storage).load(seedWorkspace);
  assert.equal(loaded.schemaVersion, workspaceSchemaVersion);
  assert.equal(loaded.pages.find((page) => page.id === "chemistry")?.title, "化学");
  assert.deepEqual(loaded.dataSources, [source]);
  assert.deepEqual(loaded.databaseItems, [{ ...item, dependencyIds: [] }]);
  assert.deepEqual(loaded.databaseViews, [view]);
  assert.deepEqual(loaded.relations, [relation]);
});

test("repository load permanently purges only trash older than 30 days", () => {
  const storage = new MemoryStorage();
  const DAY = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const oldPage = {
    ...seedWorkspace.pages[0],
    id: "trash-old",
    trashedAt: new Date(now - 31 * DAY).toISOString(),
  };
  const recentPage = {
    ...seedWorkspace.pages[0],
    id: "trash-recent",
    trashedAt: new Date(now - 5 * DAY).toISOString(),
  };
  const activePage = {
    ...seedWorkspace.pages[0],
    id: "active-page",
    trashedAt: null,
  };
  storage.setItem("life-atlas.workspace.v4", JSON.stringify({
    ...seedWorkspace,
    schemaVersion: 4,
    pages: [oldPage, recentPage, activePage],
  }));
  const repo = createBrowserWorkspaceRepository(storage);
  const loaded = repo.load(seedWorkspace);
  assert.equal(loaded.pages.some((page) => page.id === "trash-old"), false);
  assert.equal(loaded.pages.some((page) => page.id === "trash-recent"), true);
  assert.equal(loaded.pages.some((page) => page.id === "active-page"), true);
});

test("appearance preferences, cover and icon color persist and normalize on reload", () => {
  const storage = new MemoryStorage();
  const repo = createBrowserWorkspaceRepository(storage);
  const workspace = repo.load(seedWorkspace);
  const chemistry = workspace.pages.find((page) => page.id === "chemistry");
  chemistry.icon = "icon:atom";
  chemistry.iconColor = "#6fa8dc";
  chemistry.cover = { kind: "gallery", value: "van-gogh-starry-night", position: 37 };
  chemistry.settings = { fontFamily: "mono", smallText: true, fullWidth: true, locked: true };
  chemistry.trashedAt = null;
  workspace.ui.assetPreferences = {
    recentEmojiIds: ["fire", "fire", "books"],
    recentIconIds: ["atom", "flask", "atom"],
    recentCoverIds: ["van-gogh-starry-night", "nature-01", "van-gogh-starry-night"],
    favoriteCoverIds: ["van-gogh-starry-night", "astronomy-01"],
  };

  repo.save(workspace);
  assert.ok(storage.getItem(workspaceStorageKey));
  assert.equal(storage.getItem("life-atlas.workspace.v2"), null);

  const reloaded = repo.load(seedWorkspace);
  const restored = reloaded.pages.find((page) => page.id === "chemistry");
  assert.equal(restored.icon, "icon:atom");
  assert.equal(restored.iconColor, "#6fa8dc");
  assert.deepEqual(restored.cover, { kind: "gallery", value: "van-gogh-starry-night", position: 37 });
  assert.deepEqual(restored.settings, { fontFamily: "mono", smallText: true, fullWidth: true, presentationMode: "full", locked: true });
  assert.equal(restored.trashedAt, null);
  assert.deepEqual(reloaded.ui.assetPreferences.recentEmojiIds, ["fire", "books"]);
  assert.deepEqual(reloaded.ui.assetPreferences.recentIconIds, ["atom", "flask"]);
  assert.deepEqual(reloaded.ui.assetPreferences.recentCoverIds, ["van-gogh-starry-night", "nature-01"]);
  assert.deepEqual(reloaded.ui.assetPreferences.favoriteCoverIds, ["van-gogh-starry-night", "astronomy-01"]);
});
