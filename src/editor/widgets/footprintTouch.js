const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function contacts(svg, event) {
  const points = Array.from(event.touches).filter(touch => svg.contains(touch.target))
    .sort((a, b) => a.identifier - b.identifier);
  if (!points.length) return null;
  const [first, second = first] = points;
  return {
    x: (first.clientX + second.clientX) / 2,
    y: (first.clientY + second.clientY) / 2,
    distance: Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY),
    multiple: points.length >= 2,
  };
}

export function listenForFootprintTouch(svg, map, setView, ignoreClick) {
  let origin = null;
  let view;

  function rebase(point) {
    if (!point) {
      origin = null;
      return;
    }
    if (!origin) {
      const box = svg.viewBox.baseVal;
      view = { zoom: map.width / box.width, x: (box.x + box.width / 2) / map.width, y: (box.y + box.height / 2) / map.height };
    }
    const rect = svg.getBoundingClientRect();
    // The SVG uses xMidYMid meet, including when the available width or height leaves margins.
    const fitScale = Math.min(rect.width / map.width, rect.height / map.height);
    const width = map.width * fitScale;
    const height = map.height * fitScale;
    if (!width || !height) { origin = null; return; }
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    origin = {
      point, zoom: view.zoom, centerX, centerY, width, height,
      mapX: view.x + (point.x - centerX) / (width * view.zoom),
      mapY: view.y + (point.y - centerY) / (height * view.zoom),
    };
  }

  function start(event) {
    const point = contacts(svg, event);
    if (!point) return;
    if (!origin) ignoreClick.current = false;
    if (point.multiple) {
      if (event.cancelable) event.preventDefault();
      ignoreClick.current = true;
    }
    rebase(point);
  }

  function move(event) {
    const point = contacts(svg, event);
    if (!origin || !point) return;
    if (!point.multiple && !ignoreClick.current) {
      if (origin.zoom <= 1 || Math.hypot(point.x - origin.point.x, point.y - origin.point.y) < 5) return;
    }
    if (event.cancelable) event.preventDefault();
    ignoreClick.current = true;
    const scale = point.multiple && origin.point.distance > 0 ? point.distance / origin.point.distance : 1;
    const zoom = clamp(origin.zoom * scale, 1, 6);
    const half = 0.5 / zoom;
    view = {
      zoom,
      x: clamp(origin.mapX - (point.x - origin.centerX) / (origin.width * zoom), half, 1 - half),
      y: clamp(origin.mapY - (point.y - origin.centerY) / (origin.height * zoom), half, 1 - half),
    };
    setView(view);
  }

  function end(event) {
    if (event.type === "touchcancel") ignoreClick.current = true;
    rebase(contacts(svg, event));
  }

  // A single finger at fit zoom can scroll the page. Two fingers belong to the map before the browser starts zooming.
  svg.addEventListener("touchstart", start, { passive: false });
  svg.addEventListener("touchmove", move, { passive: false });
  svg.addEventListener("touchend", end);
  svg.addEventListener("touchcancel", end);
  return () => {
    svg.removeEventListener("touchstart", start);
    svg.removeEventListener("touchmove", move);
    svg.removeEventListener("touchend", end);
    svg.removeEventListener("touchcancel", end);
  };
}
