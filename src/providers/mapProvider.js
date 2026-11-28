import land from "../assets/ne_110m_land.json";

// Offline low-resolution overview provider. No records or coordinates leave the
// browser. A future tile/geocoder adapter can implement the same projection API.
// Natural Earth 1:110m land is public domain; attribution in MAP_DATA_SOURCES.md.
export const offlineMapProvider = {
  id: "natural-earth-offline",
  label: "离线世界概览",
  attribution: "Made with Natural Earth · 1:110m",
  project(longitude, latitude) { return [longitude + 180, 90 - latitude]; },
  landPaths: land.features.flatMap((feature, index) => {
    const polygons = feature.geometry.type === "MultiPolygon" ? feature.geometry.coordinates : [feature.geometry.coordinates];
    return polygons.map((rings, part) => ({
      id: `${index}-${part}`,
      path: rings.map((ring) => ring.map(([longitude, latitude], point) => `${point ? "L" : "M"}${(longitude + 180).toFixed(3)},${(90 - latitude).toFixed(3)}`).join(" ") + " Z").join(" "),
    }));
  }),
};