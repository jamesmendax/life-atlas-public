export function createAutosaveController(repository, { onState = () => {}, timers = globalThis, debounceMs = 450, retryMs = 3000 } = {}) {
  let latest = null;
  let saved = null;
  let inFlight = null;
  let timer = null;
  let disposed = false;
  let lastResult = { ok: true };
  const clear = () => { if (timer !== null) timers.clearTimeout(timer); timer = null; };
  const schedule = (delay) => {
    clear();
    if (!disposed) timer = timers.setTimeout(() => { timer = null; void flush(); }, delay);
  };
  async function flush() {
    clear();
    if (inFlight) return inFlight;
    if (latest === saved || !latest || disposed) return lastResult;
    inFlight = (async () => {
      while (latest !== saved && !disposed) {
        const snapshot = latest;
        onState({ status: "saving" });
        let result;
        try { result = await repository.save(snapshot); } catch (error) { result = { ok: false, error: { code: "E_IO", message: error.message || "无法保存工作区" } }; }
        if (!result?.ok && !result?.error) result = { ok: false, error: { code: "E_IO", message: "无法保存工作区" } };
        lastResult = result;
        if (result?.ok) {
          saved = snapshot;
          if (!disposed) onState({ status: latest === saved ? "saved" : "saving", savedAt: result.savedAt ?? result.value?.savedAt });
        } else {
          if (!disposed) {
            onState({ status: "error", error: result?.error || { code: "E_IO", message: "无法保存工作区" } });
            schedule(retryMs);
          }
          return result;
        }
      }
      return lastResult;
    })().finally(() => { inFlight = null; });
    return inFlight;
  }
  return {
    update(snapshot) {
      if (disposed || latest === snapshot) return;
      latest = snapshot;
      onState({ status: "saving" });
      if (!inFlight) schedule(debounceMs);
    },
    flush,
    dispose() { disposed = true; clear(); },
    getPendingSnapshot() { return latest; },
  };
}
