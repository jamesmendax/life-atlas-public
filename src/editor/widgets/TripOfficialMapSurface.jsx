import { useLayoutEffect, useRef } from "react";

export default function TripOfficialMapSurface({ trip, url }) {
  const anchor = useRef(null);
  const embed = trip?.embedMap;
  useLayoutEffect(() => {
    if (!embed || !url) return;
    const element = anchor.current;
    let queued = 0, previous;
    function measure() {
      queued = 0;
      const box = element.getBoundingClientRect();
      const modal = document.querySelector("dialog[open], [aria-modal=true]");
      const covered = modal && !modal.contains(element);
      const rect = { x: box.x, y: box.y, width: box.width, height: box.height, hidden: Boolean(covered) };
      const snapshot = JSON.stringify(rect);
      if (snapshot !== previous) { previous = snapshot; embed({ url, rect }); }
    }
    function schedule() { if (!queued) queued = requestAnimationFrame(measure); }
    const resize = new ResizeObserver(schedule);
    for (let el = element; el; el = el.parentElement) resize.observe(el);
    const changes = new MutationObserver(schedule);
    changes.observe(document.body, { subtree: true, childList: true, attributes: true });
    window.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    measure();
    return () => {
      cancelAnimationFrame(queued); resize.disconnect(); changes.disconnect();
      window.removeEventListener("scroll", schedule, true); window.removeEventListener("resize", schedule);
      embed(null);
    };
  }, [embed, url]);
  return <div ref={anchor} className="trip-official-map-anchor" style={{ width: "100%", height: "100%", minWidth: 0 }} />;
}
