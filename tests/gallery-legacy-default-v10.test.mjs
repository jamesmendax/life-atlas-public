import test from "node:test";
import assert from "node:assert/strict";
import { coreParityWorkspace } from "./fixtures/core-parity-workspace.mjs";
import { createDatabaseView } from "../src/domain/database.js";
import { normalizeViewConfig } from "../src/domain/viewRegistry.js";
import { migratePhase1, migratePhase2 } from "../src/persistence/migrations.js";

function workspace(schemaVersion, galleryConfig) {
  const input = coreParityWorkspace();
  input.schemaVersion = schemaVersion;
  input.pages = input.pages.map((page) => ({ ...page, content: [] }));
  input.syncedSources = [];
  const gallery = input.databaseViews.find((view) => view.id === "view-gallery");
  if (galleryConfig === undefined) delete gallery.config;
  else gallery.config = structuredClone(galleryConfig);
  return input;
}

const galleryOf = (value) => value.databaseViews.find((view) => view.id === "view-gallery");
const migrateTo8 = (input) => migratePhase2(input);

for (const schemaVersion of [6, 7]) {
  test(`schema ${schemaVersion} missing or invalid gallery preview uses historical cover`, () => {
    for (const config of [undefined, {}, { gallery: {} }, { gallery: { preview: {} } },
      { gallery: { preview: { kind: null } } }, { gallery: { preview: { kind: "invalid" } } }]) {
      const input = workspace(schemaVersion, config);
      const before = structuredClone(input);
      if (schemaVersion === 6) {
        const phase1 = migratePhase1(input);
        assert.equal(phase1.schemaVersion, 7);
        assert.equal(galleryOf(phase1).config.gallery.preview.kind, "page-cover");
        assert.equal(galleryOf(migrateTo8(phase1)).config.gallery.preview.kind, "page-cover");
      }
      const migrated = migrateTo8(input);
      assert.equal(migrated.schemaVersion, 8);
      assert.equal(galleryOf(migrated).config.gallery.preview.kind, "page-cover");
      assert.deepStrictEqual(input, before);
    }
  });

  test(`schema ${schemaVersion} keeps explicit gallery preview kinds and metadata`, () => {
    for (const kind of ["page-cover", "page-content", "none", "files-property"]) {
      const config = { extension: { top: "keep" }, gallery: { cardSize: "small", custom: { nested: true },
        preview: { kind, propertyId: "file-property", focus: "center" } } };
      const input = workspace(schemaVersion, config);
      const expected = normalizeViewConfig("gallery", config);
      if (schemaVersion === 6) assert.deepStrictEqual(galleryOf(migratePhase1(input)).config, expected);
      assert.deepStrictEqual(galleryOf(migrateTo8(input)).config, expected);
    }
  });
}

test("invalid gallery preview preserves unrelated config and preview metadata", () => {
  const config = { extension: { top: "keep" }, gallery: { cardSize: "large", custom: { nested: true },
    preview: { kind: "invalid", propertyId: "file-property", focus: "center" } } };
  for (const schemaVersion of [6, 7]) {
    const expected = normalizeViewConfig("gallery", config);
    expected.gallery.preview.kind = "page-cover";
    assert.deepStrictEqual(galleryOf(migrateTo8(workspace(schemaVersion, config))).config, expected);
  }
});

test("non-gallery views retain current normalization for both historical phases", () => {
  for (const schemaVersion of [6, 7]) {
    const input = workspace(schemaVersion, {});
    for (const view of input.databaseViews.filter((entry) => entry.type !== "gallery")) {
      view.config = { ...view.config, extension: { keep: view.id }, gallery: { preview: { kind: "invalid" } } };
    }
    const phases = schemaVersion === 6 ? [migratePhase1(input), migrateTo8(input)] : [migrateTo8(input)];
    for (const migrated of phases) for (const original of input.databaseViews.filter((entry) => entry.type !== "gallery")) {
      assert.deepStrictEqual(migrated.databaseViews.find((entry) => entry.id === original.id).config,
        normalizeViewConfig(original.type, original.config), original.id);
    }
  }
});

test("schema 8 and later are idempotent and do not rewrite gallery configs", () => {
  for (const schemaVersion of [8, 16, 17]) {
    const input = workspace(schemaVersion, { extension: true, gallery: { preview: { kind: "invalid" } } });
    assert.deepStrictEqual(migratePhase1(input), input);
    assert.deepStrictEqual(migrateTo8(input), input);
    assert.deepStrictEqual(migrateTo8(migrateTo8(input)), input);
  }
});

test("historical migrations preserve entity identities without duplication", () => {
  for (const schemaVersion of [6, 7]) {
    const input = workspace(schemaVersion, {});
    const before = structuredClone(input);
    const migrated = migrateTo8(input);
    for (const key of ["dataSources", "databaseItems", "databaseViews", "pages", "folders", "relations"]) {
      const ids = input[key].map((entity) => entity.id);
      assert.deepStrictEqual(migrated[key].map((entity) => entity.id), ids, key);
      assert.equal(new Set(migrated[key].map((entity) => entity.id)).size, ids.length, key);
    }
    assert.deepStrictEqual(migrated.dataSources, input.dataSources);
    assert.deepStrictEqual(migrated.databaseItems, input.databaseItems);
    assert.deepStrictEqual(input, before);
    assert.deepStrictEqual(migrateTo8(migrated), migrated);
  }
});

test("new gallery creation and current normalization still default to page content", () => {
  assert.equal(createDatabaseView({ id: "new-gallery", sourceId: "projects", type: "gallery" }).config.gallery.preview.kind, "page-content");
  assert.equal(normalizeViewConfig("gallery", {}).gallery.preview.kind, "page-content");
});

test("an explicitly set page-content config remains unchanged even when equal to the old test fixture", () => {
  const input = coreParityWorkspace();
  input.schemaVersion = 7;
  input.databaseViews[0] = { ...input.databaseViews[0],
    filter: { and: [{ propertyId: "amount", operator: "greater_than", value: 0 }, { propertyId: "title", operator: "contains", value: "项目" }] },
    groupBy: "status" };
  const explicit = structuredClone(input);
  galleryOf(explicit).config.gallery.preview.kind = "page-content";
  assert.deepStrictEqual(explicit, input);
  assert.equal(galleryOf(migrateTo8(explicit)).config.gallery.preview.kind, "page-content");
});
