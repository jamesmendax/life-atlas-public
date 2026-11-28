import assert from "node:assert/strict";
import { test } from "node:test";
import { amapDisplayPoint } from "../src/editor/widgets/trip-data/amapLinks.js";
import { localExactTravelPlace, travelPlaceChoices, tripPlaceDetails, withTravelEntrance } from "../src/editor/widgets/trip-data/placeChoices.js";

const station = {
  id: "rail", name: "凤凰古城", category: "railway", type: "station",
  point: [28.0205093, 109.5991902], address: "吉信镇 凤凰县 湖南省", source: "OpenStreetMap",
};
const attraction = {
  id: "sight", name: "凤凰古城", type: "风景名胜;风景名胜;景区",
  point: [27.9525, 109.5956], address: "沱江镇 凤凰县 湖南省", source: "高德地图",
};

test("tourism intent favors the actual attraction and retains distinguishable train stations", () => {
  const names = travelPlaceChoices("凤凰古城", [station, attraction], []);
  assert.deepEqual(names.map(place => place.id), ["sight", "rail"]);
  assert.match(tripPlaceDetails(station), /铁路站 · 吉信镇/u);
  assert.match(tripPlaceDetails(attraction), /景区 · 沱江镇/u);
  assert.equal(localExactTravelPlace("凤凰古城", [station]), null);
  const explicitStation = { ...station, name: "凤凰古城站" };
  assert.equal(localExactTravelPlace(explicitStation.name, [explicitStation]), explicitStation);
});

test("selecting a provider entrance preserves the original POI data and points the live map at the selected entrance", () => {
  const place = { ...attraction, amap: { poiId: "public-synthetic", location: [109.599, 27.949], entrance: [109.6, 27.951] } };
  const entrance = withTravelEntrance(place);
  assert.equal(entrance.name, "凤凰古城（入口）");
  assert.equal(entrance.amap.poiId, place.amap.poiId);
  assert.deepEqual(entrance.amap.location, place.amap.location);
  assert.deepEqual(amapDisplayPoint(entrance), [27.951, 109.6]);
  assert.notDeepEqual(entrance.point, place.point);
  assert.equal(withTravelEntrance(entrance), null);
});
