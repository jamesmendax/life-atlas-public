import assert from "node:assert/strict";
import test from "node:test";
import { createDatabaseView, updateDatabaseView } from "../src/domain/database.js";
import { mapProjection } from "../src/domain/viewProjections.js";

const title = { id: "title", type: "title" };
const relation = { id: "place-ref", type: "relation", config: { targetSourceId: "places" } };
const localPlace = { id: "local-place", type: "place" };
const coordinates = { id: "coordinates", type: "place" };
const place = (name, latitude, longitude) => ({ name, latitude, longitude });
const item = (sourceId, id, values) => ({ sourceId, id, pageId: id, values: { title: id, ...values } });
const path = { relationPropertyId: relation.id, relatedPlacePropertyId: coordinates.id };

function fixture() {
  const source = { id: "itinerary", properties: [title, relation, localPlace] };
  const places = { id: "places", properties: [title, coordinates] };
  const foreign = { id: "foreign", properties: [title, coordinates] };
  const rows = [
    item(source.id, "direct", { "local-place": place("Direct coordinates", 0, 0), "place-ref": ["first"] }),
    item(source.id, "fallback", { "local-place": { name: "Address only" }, "place-ref": ["foreign-row", "trashed", "incomplete", "first", "second"] }),
    item(source.id, "legacy", { "place-ref": "second" }),
    item(source.id, "unlocated", { "place-ref": ["foreign-row", "trashed", "incomplete", "missing"] }),
  ];
  const workspace = {
    dataSources: [source, places, foreign],
    databaseItems: [...rows,
      item(places.id, "first", { coordinates: place("First", 12, 24) }),
      item(places.id, "second", { coordinates: place("Second", 30, 60) }),
      item(places.id, "incomplete", { coordinates: place("Out of bounds", 91, 20) }),
      item(places.id, "trashed", { coordinates: place("Trashed", 3, 4) }),
      item(foreign.id, "foreign-row", { coordinates: place("Wrong source", 7, 8) }),
    ],
    pages: [{ id: "trashed", trashedAt: "2026-11-26" }],
  };
  return { workspace, source, rows };
}

test("map uses an explicit route, prefers local coordinates, and skips unavailable or foreign places", () => {
  const { workspace, source, rows } = fixture();
  const old = mapProjection(workspace, source, rows);
  assert.deepEqual(old.located.map(entry => entry.item.id), ["direct"]);
  assert.equal(old.unlocated.length, 3);
  const map = mapProjection(workspace, source, rows, path);
  assert.deepEqual(map.located.map(entry => [entry.item.id, entry.place.name, entry.placeProperty.id]), [
    ["direct", "Direct coordinates", localPlace.id],
    ["fallback", "First", coordinates.id],
    ["legacy", "Second", coordinates.id],
  ]);
  assert.deepEqual(map.unlocated.map(entry => entry.item.id), ["unlocated"]);
  assert.equal(mapProjection(workspace, source, rows, { ...path, relatedPlacePropertyId: "title" }).located.length, 1);
  assert.equal(mapProjection(workspace, source, rows, { ...path, relationPropertyId: "title" }).located.length, 1);
});

test("map relation settings persist and location updates are read from the source record", () => {
  const { workspace, source, rows } = fixture();
  const view = createDatabaseView({ sourceId: source.id, type: "map", config: { map: { ...path, layer: "offline" } } });
  const reopened = updateDatabaseView(view, { config: JSON.parse(JSON.stringify(view.config)) });
  assert.equal(reopened.config.map.relationPropertyId, path.relationPropertyId);
  assert.equal(reopened.config.map.relatedPlacePropertyId, path.relatedPlacePropertyId);
  assert.equal(reopened.config.map.layer, "offline");
  assert.equal(updateDatabaseView(view, { config: { map: { relatedPlacePropertyId: coordinates.id } } }).config.map.relatedPlacePropertyId, null);
  const withoutLocalProperty = { ...source, properties: [title, relation] };
  workspace.databaseItems.find(entry => entry.id === "first").values.coordinates = place("Updated", -11, 19);
  const result = mapProjection(workspace, withoutLocalProperty, rows, reopened.config.map);
  assert.deepEqual(result.located.find(entry => entry.item.id === "fallback").place, place("Updated", -11, 19));
  assert.equal(result.placeProperty, undefined);
  assert.equal(result.relatedPlaceProperty, coordinates);
  assert.deepEqual(rows.find(entry => entry.id === "fallback").values["local-place"], { name: "Address only" });
});
