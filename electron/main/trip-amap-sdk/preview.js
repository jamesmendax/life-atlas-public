(() => {
  const status = document.getElementById("status");
  let map, initialized = false;
  const timer = setTimeout(failed, 16_000);

  function failed() {
    clearTimeout(timer);
    status.dataset.state = "error";
    status.textContent = "高德地图没有完成初始化。请检查网络、JS API 凭据和域名授权，或关闭本窗口返回行程路网。";
  }

  function showRoute(sections) {
    if (initialized || status.dataset.state === "error") return;
    initialized = true;
    try {
      const { Map, Polyline } = window.AMap;
      map = new Map("map", { viewMode: "2D", center: sections[0][0], zoom: 13, rotateEnable: false, showIndoorMap: false });
      const overlays = sections.map(path => new Polyline({ path, strokeColor: "#2563eb", strokeOpacity: 0.96, strokeWeight: 5,
        isOutline: true, outlineColor: "#ffffff", borderWeight: 2, lineJoin: "round", lineCap: "round" }));
      map.add(overlays);
      map.setFitView(overlays, true, [36, 36, 36, 36], 17);
      map.on("complete", () => {
        clearTimeout(timer);
        status.dataset.state = "ready";
        status.textContent = "已显示所选路段的保存轨迹";
      });
    } catch { failed(); }
  }

  fetch("./route.json", { credentials: "omit", cache: "no-store" }).then(response => {
    if (!response.ok) throw new Error("route unavailable");
    return response.json();
  }).then(({ key, serviceHost, sections }) => {
    if (status.dataset.state === "error") return;
    window._AMapSecurityConfig = { serviceHost };
    window.lifeAtlasAmapReady = () => showRoute(sections);
    const script = document.createElement("script");
    const url = new URL("https://webapi.amap.com/maps");
    url.search = new URLSearchParams({ v: "2.0", key, callback: "lifeAtlasAmapReady" }).toString();
    script.src = url.href;
    script.async = true;
    script.onerror = failed;
    document.head.append(script);
  }).catch(failed);

  window.addEventListener("pagehide", () => {
    clearTimeout(timer);
    map?.destroy();
  }, { once: true });
})();
