import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createMarketService, componentMime } from "../electron/main/market/service.js";
import { marketShelf } from "../src/domain/marketGallery.js";
import app from "../package.json" with { type: "json" };

const directory = fileURLToPath(new URL("../market/public/", import.meta.url));
const index = (name) => JSON.parse(fs.readFileSync(path.join(directory, name))).entries;
const ids = ["life-atlas.trip-itinerary", "life-atlas.travel-footprint", "life-atlas.pomodoro"];

test("legacy downloads retain their identity and title under a single shelf entry per work", async () => {
  const historical = index("catalog.json").filter((item) => ids.includes(item.id));
  const rows = historical.map((item) => ({ ...item, mime: componentMime, originalName: path.basename(item.packagePath) }));
  const assetStore = { list: () => rows };
  const service = createMarketService({ directory, appVersion: app.version, assetStore });
  const installed = service.installed().entries;
  assert.deepEqual(installed.map((item) => item.title), historical.map((item) => item.title));
  const catalog = (await service.catalogue()).entries;
  const all = marketShelf(catalog, installed, "all", "");
  assert.equal(all.length, new Set(catalog.map((item) => item.id)).size);
  assert.equal(marketShelf(catalog, installed, "installed", "").length, 3);
  for (const old of historical) {
    const group = all.find(([latest]) => latest.id === old.id);
    assert.ok(group[0].version.startsWith("2."));
    assert.equal(group[1].sha256, old.sha256);
    assert.equal(group[1].url, "life-asset://" + old.sha256);
  }
  assert.equal(marketShelf(catalog, installed, "component", "番茄").length, 1);
  const oldHost = createMarketService({ directory, appVersion: "1.3.3", assetStore });
  const oldCatalog = (await oldHost.catalogue()).entries;
  const oldShelf = marketShelf(oldCatalog, oldHost.installed().entries, "all", "");
  const trip = oldShelf.find(([first]) => first.id === "life-atlas.trip-itinerary");
  assert.equal(trip[0].sha256, historical.find(item => item.id === "life-atlas.trip-itinerary").sha256);
  assert.ok(trip.some(item => item.version.startsWith("2.") && item.compatible === false));
});

test("an imported newer version and a retired work stay available with a stale catalogue", () => {
  const id = ids[0];
  const published = { id, title: "行程", type: "component", version: "2.0.9", sha256: "a" };
  const local = { ...published, version: "2.0.10", sha256: "b", installed: true };
  const incompatible = { ...published, version: "3.0.0", sha256: "c", compatible: false };
  const retired = { ...local, id: "community.retired", sha256: "d" };
  const groups = marketShelf([published, incompatible], [local, retired], "component", "");
  assert.deepEqual(groups.map((group) => group.map((item) => item.sha256)), [["b","a","c"],["d"]]);
  assert.deepEqual(marketShelf([], [local, retired], "all", "").map(([item]) => item.id), [id, retired.id]);
  assert.equal(marketShelf([{ ...published, installed: true }], [], "all", "")[0][0].installed, false);
});
