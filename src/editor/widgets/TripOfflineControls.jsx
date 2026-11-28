import { useEffect, useRef, useState } from "react";
import { MAX_ROUTE_STOPS, VALID_POINT } from "../../domain/tripRoutes.js";

export default function TripOfflineControls({ trip, stops, connected, onReady }) {
  const disclosure = useRef(null);
  const [check, setCheck] = useState(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const points = stops.map(stop => stop.point);
  const scope = points.length >= 2 && points.length <= MAX_ROUTE_STOPS && points.every(VALID_POINT) ? JSON.stringify(points) : "";
  const status = trip?.offlineStatus;
  const current = check?.scope === scope ? check.result : null;
  const supported = Boolean(status);
  useEffect(() => {
    if (!status) return;
    let active = true;
    async function refresh() {
      try {
        const result = await status(scope ? { points: JSON.parse(scope) } : {});
        if (active) setCheck({ scope, result: result?.ok ? result.value : null });
      } catch { if (active) setCheck({ scope, result: null }); }
    }
    void refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener("lifeatlas-map-provider-changed", refresh);
    return () => {
      active = false;
      window.removeEventListener("focus", refresh);
      window.removeEventListener("lifeatlas-map-provider-changed", refresh);
    };
  }, [status, scope]);
  useEffect(() => { onReady?.(Boolean(scope && current?.ready)); }, [scope, current?.ready, onReady]);
  useEffect(() => { setNotice(""); }, [scope]);
  useEffect(() => {
    const element = disclosure.current;
    if (!element) return;
    const doc = element.ownerDocument;
    const dismiss = (event) => {
      if (element.open && !element.contains(event.target)) element.open = false;
    };
    doc.addEventListener("pointerdown", dismiss);
    doc.addEventListener("focusin", dismiss);
    return () => {
      doc.removeEventListener("pointerdown", dismiss);
      doc.removeEventListener("focusin", dismiss);
    };
  }, [supported]);

  async function download() {
    if (!scope || busy || !trip.offlineDownload || !connected) return;
    setBusy(true); setNotice("");
    try {
      const result = await trip.offlineDownload({ points: JSON.parse(scope) });
      if (!result?.ok) throw new Error(result?.error?.message || "未能下载沿线路网。");
      const value = result.value;
      setCheck({ scope, result: value });
      setNotice(value.missingTiles.length ? "部分路网尚未取得，可重试或在设置中导入。"
        : value.ready ? "沿线路网已下载。选择「离线」后可算路。" : "沿线路网已下载。");
    } catch (failure) { setNotice(failure.message); }
    finally { setBusy(false); }
  }

  if (!supported) return null;
  return <details ref={disclosure} className="trip-offline-controls" onKeyDown={(event) => {
    if (event.key !== "Escape" || !event.currentTarget.open) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.open = false;
    event.currentTarget.querySelector("summary").focus();
  }}>
    <summary className="mw-btn">离线路网</summary>
    <div className="trip-offline-panel">
      <span>{current?.ready && scope ? "所选路段的离线路网已就绪。" : current && !current.configured
        ? "在地图服务设置中选择本机 BRouter。" : current && !current.javaReady
          ? "需要配置可用的 Java 17 或更新版本。" : !scope
            ? "定位所有站点后，可以下载沿线路网。长行程可逐段准备。"
            : current ? "沿线缺少 " + current.missingTiles.length + " 个路网分区。" : "正在检查离线路网…"}</span>
      {scope && (current?.missingTiles.length ?? 0) > 0 && <button type="button" className="mw-btn" disabled={busy || !connected}
        onClick={download}>{busy ? "正在下载…" : "下载沿线路网"}</button>}
      {notice && <small role="status">{notice}</small>}
    </div>
  </details>;
}
