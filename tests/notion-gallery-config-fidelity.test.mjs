import test from "node:test";
import assert from "node:assert/strict";
import { mapNotionSourceViewConfiguration } from "../src/import/notionSourceViewConfig.js";
import { createDatabaseView } from "../src/domain/database.js";
import { workspace156, source156, deepFreeze } from "../.qa/LOCAL-NOTION-001/v14-wiki-real133/import156/fixture156.mjs";
import { W1Gallery } from "../.qa/LOCAL-NOTION-001/v14-wiki-real133/import156/source-configurations156.mjs";

const source = source156("文章");
const galleryMissingFields = [
  "config.gallery.preview.kind", "config.gallery.preview.propertyId",
  "config.gallery.cardSize", "config.gallery.imageFit", "config.gallery.visiblePropertyIds",
];

function mapRetained(config, type = "gallery") {
  const input = structuredClone({ ...W1Gallery.views[0], type, config });
  if (config === undefined) delete input.config;
  const before = structuredClone({ input, source, workspace: workspace156 });
  deepFreeze(input);
  const result = mapNotionSourceViewConfiguration(input, source);
  assert.deepEqual({ input, source, workspace: workspace156 }, before, "mapping preserves the complete input and retained workspace");
  return result;
}

for (const [field, galleryFor] of [
  ["preview.kind", (value) => ({ preview: { kind: value } })],
  ["cardSize", (value) => ({ cardSize: value })],
  ["imageFit", (value) => ({ imageFit: value })],
]) test(`explicit unsupported Gallery ${field} is rejected before normalization`, () => {
  for (const value of ["unsupported", "", null, true, 1]) {
    const result = mapRetained({ gallery: galleryFor(value) });
    assert.equal(result.valid, false, `${field}=${JSON.stringify(value)} must reject the supplied view`);
    assert.ok(result.reason.includes(`gallery.${field}`));
    assert.equal(Object.hasOwn(result, "view"), false);
  }
});

test("supported Gallery enums survive mapping and final view normalization", () => {
  for (const gallery of [
    { preview: { kind: "page-cover", propertyId: null }, cardSize: "small", imageFit: "contain" },
    { preview: { kind: "page-content", propertyId: null }, cardSize: "medium", imageFit: "cover" },
    { preview: { kind: "files-property", propertyId: "摘要" }, cardSize: "large", imageFit: "contain" },
    { preview: { kind: "none", propertyId: null }, cardSize: "medium", imageFit: "cover" },
  ]) {
    const result = mapRetained({ gallery });
    assert.equal(result.valid, true, result.reason);
    const persisted = createDatabaseView({ ...result.view, id: "gallery-fidelity167", sourceId: source.id });
    assert.equal(persisted.config.gallery.preview.kind, gallery.preview.kind);
    assert.equal(persisted.config.gallery.cardSize, gallery.cardSize);
    assert.equal(persisted.config.gallery.imageFit, gallery.imageFit);
    assert.equal(persisted.config.gallery.preview.propertyId, gallery.preview.propertyId === null ? null : source.properties.find((property) => property.name === "摘要").id);
    assert.deepEqual(result.missingFields, ["groupBy", "grouping", "config.openRecordsIn", "config.gallery.visiblePropertyIds"]);
  }
});

test("absent and undefined Gallery enums retain legacy defaults and missing-field disclosure", () => {
  for (const config of [undefined, {}, { gallery: {} }, { gallery: { preview: {} } },
    { gallery: { preview: { kind: undefined }, cardSize: undefined, imageFit: undefined } }]) {
    const result = mapRetained(config);
    assert.equal(result.valid, true, result.reason);
    if (config === undefined) {
      assert.equal(Object.hasOwn(result.view, "config"), false);
      assert.deepEqual(result.missingFields, ["groupBy", "grouping", "config"]);
    } else {
      assert.deepEqual(result.view.config, config);
      assert.deepEqual(result.missingFields, ["groupBy", "grouping", "config.openRecordsIn", ...galleryMissingFields]);
    }
    const persisted = createDatabaseView({ ...result.view, id: "gallery-fidelity167", sourceId: source.id });
    assert.equal(persisted.config.gallery.preview.kind, "page-content");
    assert.equal(persisted.config.gallery.cardSize, "medium");
    assert.equal(persisted.config.gallery.imageFit, "cover");
  }
});

test("unselected Gallery metadata remains unchanged on a non-Gallery view", () => {
  const config = { gallery: { preview: { kind: "future-preview" }, cardSize: "future-size", imageFit: "future-fit" } };
  const result = mapRetained(config, "list");
  assert.equal(result.valid, true, result.reason);
  assert.deepEqual(result.view.config, config);
  assert.deepEqual(createDatabaseView({ ...result.view, id: "gallery-fidelity167", sourceId: source.id }).config, config);
});
