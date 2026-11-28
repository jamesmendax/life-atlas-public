import test from "node:test";
import assert from "node:assert/strict";
import { VIEW_REGISTRY, VIEW_TYPES, normalizeViewConfig } from "../src/domain/viewRegistry.js";
import { ROADMAP_DEFAULTS } from "../src/domain/roadmapLayout.js";

test("roadmap is registered with its label", () => {
  assert.equal(VIEW_REGISTRY.roadmap.label, "时间脉络");
  assert.equal(VIEW_REGISTRY.roadmap.description, "像幻灯片一样按时间展示里程碑和阶段");
  assert.ok(VIEW_TYPES.includes("roadmap"));
  assert.equal(VIEW_TYPES.length, 12);
});

test("roadmap config gets defaults and keeps unknown fields", () => {
  assert.deepEqual(normalizeViewConfig("roadmap").roadmap, ROADMAP_DEFAULTS);
  const input = { otherView: { future: true }, roadmap: { datePropertyId: "time", future: { enabled: true }, scale: "wrong", density: "wrong", zoom: 1.25, markerMap: { first: "major", second: "ring", invalid: "star" } } };
  const original = structuredClone(input);
  const normalized = normalizeViewConfig("roadmap", input);
  assert.equal(normalized.roadmap.scale, "auto");
  assert.equal(normalized.roadmap.density, "comfortable");
  assert.equal(normalized.roadmap.zoom, 1);
  assert.equal(normalized.roadmap.datePropertyId, "time");
  assert.deepEqual(normalized.roadmap.markerMap, { first: "major", second: "ring" });
  assert.deepEqual(normalized.roadmap.future, { enabled: true });
  assert.deepEqual(normalized.otherView, input.otherView);
  assert.deepEqual(input, original);
  assert.equal(normalizeViewConfig("roadmap", { roadmap: { datePropertyId: null, showToday: false, zoom: 3, density: "compact", scale: "year" } }).roadmap.datePropertyId, null);
  assert.equal(normalizeViewConfig("roadmap", { roadmap: { showToday: false } }).roadmap.showToday, false);
});
