import test from "node:test";
import assert from "node:assert/strict";
import { mapViewport, recordBounds, storeMapViewport } from "../src/domain/databaseMapViewport.js";

test("default old world fits records while explicit origin and native street scale survive reopening", () => {
  assert.equal(mapViewport({ center: [0, 0], zoom: 1 }), null);
  assert.deepEqual(mapViewport({ center: [115, 22], zoom: 8 }), { center:[115,22], zoom:4 });
  const current = storeMapViewport({ lat:0, lng:0 }, 19);
  assert.deepEqual(mapViewport(current), { center:[0,0], zoom:19 });
  assert.equal(mapViewport({ ...current, layer:"satellite" }).zoom,14);
  assert.equal(mapViewport({ ...current, layer:"offline" }).zoom,5);
});
test("record extent follows the shortest longitudinal arc and keeps polar coordinates renderable", () => {
  const extent = points => recordBounds(points.map(([latitude,longitude]) => ({place:{latitude,longitude}})));
  assert.equal(extent([]),null);
  assert.deepEqual(extent([[30,104],[31,105]]),[[30,104],[31,105]]);
  assert.deepEqual(extent([[10,179],[-10,-179]]),[[-10,179],[10,181]]);
  const [[south],[north]]=extent([[-90,0],[90,0]]);
  assert(south < -85 && south > -86 && north > 85 && north < 86);
});
