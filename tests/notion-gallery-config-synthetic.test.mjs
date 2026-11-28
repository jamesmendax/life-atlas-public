import assert from "node:assert/strict";
import test from "node:test";
import { createDatabaseView, createProperty } from "../src/domain/database.js";
import { mapNotionSourceViewConfiguration, notionSourceViewConfigurationFor, prepareNotionSourceViewConfigurations } from "../src/import/notionSourceViewConfig.js";

// These are synthetic names and entities. The retained import156 workspace and
// its supplied settings are required by the separate historical regression.
function freeze(value) {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

const source = freeze({
  id: "synthetic-exhibits",
  properties: [
    createProperty({ id: "local-title", name: "展品", type: "title" }),
    createProperty({ id: "local-photo", name: "展品照片", type: "files" }),
    createProperty({ id: "local-summary", name: "说明", type: "text" }),
  ],
});

function mapGallery(config, overrides = {}) {
  const input = { name: "合成展品画廊", type: "gallery", ...overrides };
  if (config !== undefined) input.config = config;
  const before = structuredClone({ input, source });
  const mapped = mapNotionSourceViewConfiguration(freeze(input), source);
  assert.deepEqual({ input, source }, before);
  return mapped;
}

function saved(result) {
  assert.equal(result.valid, true, result.reason);
  const local = createDatabaseView({ ...result.view, id: "synthetic-gallery", sourceId: source.id });
  return JSON.parse(JSON.stringify(local));
}

test("synthetic Gallery configuration maps exported property names and preserves display order through persistence", () => {
  const result = mapGallery({ openRecordsIn: "page", gallery: {
    preview: { kind: "files-property", propertyId: "展品照片" }, cardSize: "large", imageFit: "contain",
    visiblePropertyIds: ["说明", "展品照片"],
  } }, { visiblePropertyIds: ["展品照片", "说明"] });
  const local = saved(result);
  assert.deepEqual(local.config.gallery, {
    preview: { kind: "files-property", propertyId: "local-photo" }, cardSize: "large", imageFit: "contain",
    visiblePropertyIds: ["local-summary", "local-photo"],
  });
  assert.deepEqual(local.visiblePropertyIds, ["local-photo", "local-summary"]);
  assert.equal(local.config.openRecordsIn, "page");
  assert.deepEqual(result.missingFields, ["filter", "sorts", "groupBy", "grouping"]);
});

test("synthetic Gallery accepts every supported preview, card size and image fit", () => {
  for (const [kind, cardSize, imageFit] of [
    ["page-cover", "small", "contain"], ["page-content", "medium", "cover"],
    ["files-property", "large", "contain"], ["none", "medium", "cover"],
  ]) {
    const inputPropertyId = kind === "files-property" ? "展品照片" : null;
    const gallery = saved(mapGallery({ gallery: { preview: { kind, propertyId: inputPropertyId }, cardSize, imageFit } })).config.gallery;
    assert.deepEqual([gallery.preview.kind, gallery.preview.propertyId, gallery.cardSize, gallery.imageFit],
      [kind, inputPropertyId ? "local-photo" : null, cardSize, imageFit]);
  }
});

test("synthetic Gallery rejects explicit unknown enums and ambiguous or unmapped field references", () => {
  for (const [field, config] of [
    ["preview.kind", value => ({ preview: { kind: value } })],
    ["cardSize", value => ({ cardSize: value })],
    ["imageFit", value => ({ imageFit: value })],
  ]) for (const value of ["future", "", null, true, 1]) {
    const result = mapGallery({ gallery: config(value) });
    assert.equal(result.valid, false);
    assert.match(result.reason, new RegExp(`gallery\\.${field.replaceAll(".", "\\.")}`));
    assert.equal(Object.hasOwn(result, "view"), false);
  }
  for (const propertyId of ["不存在", "local-photo"]) {
    assert.equal(mapGallery({ gallery: { preview: { kind: "files-property", propertyId } } }).valid, false);
  }
  assert.equal(mapGallery({ gallery: { visiblePropertyIds: ["说明", "说明"] } }).valid, false);
  const ambiguous = { ...source, properties: [...source.properties, { ...source.properties[1], id: "another-file" }] };
  assert.equal(mapNotionSourceViewConfiguration({ type: "gallery", config: { gallery: { preview: { kind: "files-property", propertyId: "展品照片" } } } }, ambiguous).valid, false);
});

test("synthetic Gallery reports absent fields and uses the existing default presentation", () => {
  for (const config of [undefined, {}, { gallery: {} }, { gallery: { preview: { kind: undefined }, cardSize: undefined, imageFit: undefined } }]) {
    const result = mapGallery(config);
    const gallery = saved(result).config.gallery;
    assert.deepEqual([gallery.preview.kind, gallery.cardSize, gallery.imageFit], ["page-content", "medium", "cover"]);
    if (config === undefined) {
      assert.ok(result.missingFields.includes("config"));
      assert.equal(Object.hasOwn(result.view, "config"), false);
    } else {
      assert.deepEqual(result.view.config, config);
      assert.deepEqual(result.missingFields.filter(field => field.startsWith("config.gallery.")), [
        "config.gallery.preview.kind", "config.gallery.preview.propertyId", "config.gallery.cardSize",
        "config.gallery.imageFit", "config.gallery.visiblePropertyIds",
      ]);
    }
  }
});

test("synthetic import configuration binds the original page and collection index exactly", () => {
  const path = "合成档案/展品.html";
  const descriptor = { path, collections: [{ title: "另一库" }, { title: "展品库" }] };
  const sameTitle = { path: "其他目录/展品.html", collections: [{ title: "展品库" }] };
  const plan = { pages: [descriptor, sameTitle], databases: [] };
  const views = [{ type: "gallery", config: { gallery: { preview: { kind: "files-property", propertyId: "展品照片" } } } }];
  const configuration = { path, collectionIndex: 1, currentViewIndex: 0, views };
  const warnings = [];
  const prepared = prepareNotionSourceViewConfigurations(plan, [configuration], warnings);
  assert.deepEqual(warnings, []);
  assert.equal(notionSourceViewConfigurationFor(prepared, descriptor, 0), undefined);
  assert.equal(notionSourceViewConfigurationFor(prepared, sameTitle, 0), undefined);
  const retained = notionSourceViewConfigurationFor(prepared, descriptor, 1);
  assert.equal(retained.descriptor, descriptor);
  const local = saved(mapNotionSourceViewConfiguration(retained.entry.views[retained.currentViewIndex], source));
  assert.equal(local.config.gallery.preview.propertyId, "local-photo");
});

test("synthetic non-Gallery view keeps unknown Gallery metadata intact", () => {
  const config = { gallery: { preview: { kind: "future-preview" }, cardSize: "future-size", imageFit: "future-fit" } };
  const mapped = mapGallery(config, { type: "list" });
  assert.deepEqual(mapped.view.config, config);
  assert.deepEqual(saved(mapped).config, config);
});
