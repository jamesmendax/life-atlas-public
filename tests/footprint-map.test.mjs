import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { findRegions, footprintMap, historicalDistrictPath, macauGeoJsonText, provinces, recordFor, regionById } from "../src/editor/widgets/footprint-data/footprintMap.js";
import { buildWidgetUi } from "../scripts/market-widget-bundles.mjs";

test("the national map and provincial maps share individual city and district records", () => {
  const country = footprintMap("china");
  const ids = country.regions.map((region) => region.id);
  assert.equal(ids.length, 477);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every((id) => id.startsWith("city-")));
  assert.deepEqual(provinces.flatMap((province) => footprintMap("china", province.id).regions.map((r) => r.id)).sort(), [...ids].sort());
  for (const map of [country, footprintMap("japan"), footprintMap("world")]) {
    assert.ok(map.regions.every((region) => region.point.every(Number.isFinite) && /^M.+Z$/u.test(region.path)));
  }
  const records = { "city-510100": { status: "visited", note: "成都之行" } };
  assert.equal(recordFor(records, "city-510100").status, "visited");
  assert.equal(recordFor(records, "city-510700").status, "unvisited");
  assert.equal(recordFor(records, "cn-510000").status, "unvisited");
});

test("current maps and historic details preserve every original Chinese, Japanese and world record ID", () => {
  const regions = [...regionById.values()];
  const additions = new Set(["city-460300", "city-500157", "city-659011", "city-659012"]);
  const digest = (ids) => createHash("sha256").update(ids.sort().join("\n")).digest("hex");
  assert.equal(digest(regions.filter((r) => r.mode === "china" && !additions.has(r.id)).map((r) => r.id)), "c98779b6befcfecad002b5654abcc6e05a8899cabc36326344ba23d145daea05");
  assert.equal(digest(regions.filter((r) => r.mode === "japan").map((r) => r.id)), "5b2ef012eb7dd6e03eb6edcfca7c7bcbf47f7e8e963e5114caa3b078525fcde7");
  assert.equal(digest(regions.filter((r) => r.mode === "world").map((r) => r.id)), "ffc599aa3e34d104e0b873ffef954c7fb4485b002a9e96df6a70759736595ba9");
  const chongqing = footprintMap("china", "cn-500000").regions.map((r) => r.id);
  for (const [id, name] of [["city-500105", "江北区"], ["city-500112", "渝北区"]]) {
    const saved = { [id]: { note: "旧游记", status: "visited" } };
    const region = findRegions(name).find((match) => match.region.id === id).region;
    assert.equal(region.historicalYear, 2025);
    assert.match(historicalDistrictPath(region), /^M[\d., LZM-]+Z$/);
    assert.equal(findRegions(id)[0].region.id, id);
    assert.equal(recordFor(saved, id).note, "旧游记");
    assert.equal(recordFor(saved, "city-500157").status, "unvisited");
    assert.ok(!chongqing.includes(id));
  }
  assert.ok(chongqing.includes("city-500157"));
  assert.equal(findRegions("Kyōto Fu")[0].region.id, "jp-26");
});

test("island inset and special administrative regions expose their actual mapped units", () => {
  for (const map of [footprintMap("china"), footprintMap("china", "cn-460000")]) {
    const [x, y] = map.regions.find((r) => r.id === "city-460300").point;
    assert.ok(x > map.inset.x && x < map.inset.x + map.inset.width);
    assert.ok(y > map.inset.y && y < map.inset.y + map.inset.height);
  }
  const hk = footprintMap("china", "cn-810000").regions, tw = footprintMap("china", "cn-710000").regions;
  assert.equal(hk.length, 18);
  assert.equal(hk.find((region) => region.id === "city-810006").name, "深水埗区");
  assert.deepEqual(tw.map((region) => region.id), ["city-710000"]);
  const data = JSON.parse(macauGeoJsonText());
  assert.equal(data.features.length, 8); assert.equal(new Set(data.features.map((f) => f.properties.osmRelation)).size, 8);
  assert.equal(data.features.find((f) => f.properties.kind === "reclamation").id, "city-820007");
  assert.deepEqual(data.features.map((f) => f.id), footprintMap("china", "cn-820000").regions.map((r) => r.id));
  assert.ok(data.features.every((f) => ["Polygon", "MultiPolygon"].includes(f.geometry.type)));
  assert.match(data.license, /odbl\/1-0/);
});

test("the optional footprint package carries the independent Macau database once and includes all attributions", async () => {
  const files = await buildWidgetUi("travel-footprint");
  const path = "assets/maps/macau-parishes.json";
  assert.deepEqual(files.get(path), await readFile(new URL("../src/editor/widgets/footprint-data/macau-parishes.json", import.meta.url)));
  assert.ok(files.get("ui.js").includes(path));
  assert.ok(!files.get("ui.js").includes("9506156"), "OSM features are read from the standalone asset");
  assert.match(files.get("assets/licenses/footprint-sources.md").toString(), /Cheng.+Xiao.+Wang.+Hu/);
  assert.match(files.get("assets/licenses/odbl-1.0.txt").toString(), /Open Database License/);
  assert.match(files.get("assets/licenses/cc-by-4.0.txt").toString(), /Attribution 4.0 International/);
});

test("landmark search opens its locality and legacy city keys preserve their notes", () => {
  assert.equal(findRegions("九寨沟")[0].region.id, "city-513200");
  assert.equal(findRegions("成都")[0].region.id, "city-510100");
  assert.equal(findRegions("三亚")[0].region.id, "city-460200");
  assert.deepEqual(findRegions(""), []);
  const records = { "cn-510100": { status: "visited", note: "旧手记", spots: ["自定义地点"] } };
  assert.deepEqual(recordFor(records, "city-510100"), { ...records["cn-510100"], date: "" });
  records["city-510100"] = { status: "planned", note: "新手记" };
  assert.equal(recordFor(records, "city-510100").note, "新手记");
});
