import L from "leaflet";
import { DATABASE_MAP_LAYERS } from "../domain/databaseMapViewport.js";

export function attachDatabaseTiles(map, api, layer, report) {
  const grid = L.gridLayer({ minZoom: 1, maxZoom: DATABASE_MAP_LAYERS[layer].maxZoom,
    updateWhenIdle: true, updateWhenZooming: false, keepBuffer: 0, attribution: "" });
  const requests = new Map();
  let frame = 0, active = true;
  function update() {
    if (!active || frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (!active) return;
      const viewport = map.getContainer().getBoundingClientRect();
      const counts = { ready: 0, failed: 0, loading: 0, noCoverage: 0 };
      for (const tile of grid.getContainer()?.querySelectorAll("img[data-tile-state]") || []) {
        if (Number(tile.dataset.z) !== map.getZoom()) continue;
        const box = tile.getBoundingClientRect();
        if (box.right <= viewport.left || box.left >= viewport.right || box.bottom <= viewport.top || box.top >= viewport.bottom) continue;
        counts[tile.dataset.tileState]++;
        if (tile.dataset.tileError === "E_NOT_FOUND") counts.noCoverage++;
      }
      report(counts);
    });
  }
  grid.createTile = (coords, done) => {
    const image = document.createElement("img");
    image.alt = ""; image.decoding = "async"; image.dataset.tileState = "loading";
    image.dataset.z = String(coords.z); image.dataset.x = String(coords.x); image.dataset.y = String(coords.y); image.dataset.layer = layer;
    const requestId = crypto.randomUUID();
    requests.set(image, requestId);
    const finish = (error) => {
      if (!active || !requests.has(image)) return;
      requests.delete(image);
      image.onload = null; image.onerror = null;
      image.dataset.tileState = error ? "failed" : "ready";
      if (error) image.dataset.tileError = error;
      done(error ? new Error(error) : null, image);
      update();
    };
    image.onload = () => finish();
    image.onerror = () => finish("E_IMAGE");
    api.tile({ layer, z: coords.z, x: coords.x, y: coords.y, requestId }).then(result => {
      if (!active || !requests.has(image)) return;
      const url = result?.value?.dataUrl;
      if (result?.ok && typeof url === "string" && /^data:image\/(png|jpeg|webp);base64,/i.test(url)) image.src = url;
      else finish(result?.error?.code || "E_IMAGE");
    }).catch(() => finish("E_IO"));
    return image;
  };
  function cancel(tile) {
    const id = requests.get(tile);
    if (!id) return;
    requests.delete(tile);
    tile.onload = null; tile.onerror = null;
    if (api.cancel) void api.cancel({ requestId: id }).catch(() => {});
  }
  grid.on("tileunload", ({ tile }) => { cancel(tile); update(); });
  grid.on("loading load tileloadstart", update);
  grid.addTo(map);
  map.on("moveend resize", update);
  update();
  return () => {
    active = false;
    cancelAnimationFrame(frame);
    map.off("moveend resize", update);
    for (const image of requests.keys()) cancel(image);
    grid.remove();
  };
}
