import L from "leaflet";

// Group by screen distance so a long national route and a compact city walk
// share the same controls. Actual coordinates remain on their original markers.
export function attachTripClusters(map, enabled, onOpen) {
  const members = new Set();
  const overlays = L.layerGroup().addTo(map);
  let frame = 0;

  function hide(marker, value) {
    const icon = marker.getElement();
    if (!icon) return;
    icon.classList.toggle("trip-marker-grouped", value);
    if (value) { marker.closeTooltip(); icon.setAttribute("aria-hidden", "true"); }
    else icon.removeAttribute("aria-hidden");
  }
  function update() {
    frame = 0;
    overlays.clearLayers();
    for (const marker of members) hide(marker, false);
    if (!enabled() || map.getZoom() > 7) return;
    const groups = [];
    const radius = 33, visible = map.getBounds().pad(.08);
    for (const marker of members) {
      const point = marker.getLatLng();
      if (!visible.contains(point)) continue;
      const xy = map.latLngToContainerPoint(point);
      let group = groups.find((g) => g.anchor.distanceTo(xy) <= radius);
      if (!group) { group = { anchor: xy, sum: L.point(0, 0), markers: [] }; groups.push(group); }
      group.sum = group.sum.add(xy);
      group.markers.push(marker);
    }
    for (const { markers, sum } of groups) {
      if (markers.length < 2) continue;
      markers.forEach((marker) => hide(marker, true));
      const at = map.containerPointToLatLng(sum.divideBy(markers.length));
      const face = document.createElement("span");
      face.textContent = String(markers.length);
      const label = "展开 " + markers.length + " 个相邻行程地点";
      const cluster = L.marker(at, {
        title: label, alt: label, keyboard: true, autoPanOnFocus: false, zIndexOffset: 300,
        icon: L.divIcon({ className: "trip-marker-cluster", html: face, iconSize: [29, 29], iconAnchor: [14, 14] }),
      }).addTo(overlays);
      cluster.getElement().setAttribute("aria-label", label);
      cluster.on("click", () => onOpen(markers));
      cluster.getElement().addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); onOpen(markers); }
      });
    }
  }
  function schedule() { if (!frame) frame = requestAnimationFrame(update); }
  function track({ type, layer }) {
    if (!layer.options?.tripLocation) return;
    if (type === "layeradd") members.add(layer);
    else members.delete(layer);
    schedule();
  }
  map.on("layeradd layerremove", track);
  map.on("moveend resize", schedule);
  return { update: schedule, remove() {
    cancelAnimationFrame(frame);
    map.off("layeradd layerremove", track);
    map.off("moveend resize", schedule);
    overlays.remove();
    members.clear();
  } };
}
