import { useEffect, useRef } from "react";

// The native inbox acknowledges a receipt only after it can read the same ID
// from SQLite. A renderer restart between save and acknowledgment is harmless.
export function useSharedFormInbox(service, getWorkspace, collect) {
  const current = useRef(null);
  current.current = {getWorkspace, collect};
  useEffect(() => {
    if (!service?.onReceived || !service.pendingViews) return;
    const requested = new Set();
    let busy = false, live = true;
    async function drain(viewId) {
      if (!live || !viewId) return;
      requested.add(viewId);
      if (busy) return;
      busy = true;
      try {
        while (live && requested.size) {
          const id = requested.values().next().value;
          requested.delete(id);
          try {
            const workspace = current.current.getWorkspace();
            const view = workspace.databaseViews?.find(v => v.id === id && v.type === "form");
            if (!view) continue;
            const pending = await service.pending({viewId:id});
            const responses = pending?.value?.responses;
            if (!live || !pending.ok || !responses?.length) continue;
            await current.current.collect(view.sourceId, id, responses);
            if (!live) break;
            const ack = await service.ack({viewId:id,ids:responses.map(r => r.id)});
            if (ack.ok && ack.value?.acknowledged > 0) requested.add(id);
          } catch { /* Keep durable responses for the next notification or manual collection. */ }
        }
      } finally { busy = false; }
    }
    const unsubscribe = service.onReceived(event => { void drain(event?.viewId); });
    service.pendingViews().then(result => { if (live && result.ok) for (const id of result.value.viewIds) void drain(id); }).catch(() => {});
    return () => { live = false; unsubscribe?.(); };
  }, [service]);
}
