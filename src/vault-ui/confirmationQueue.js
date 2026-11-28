export function createConfirmationQueue({ onChange, clock = Date, timers = globalThis }) {
  let requests = [];
  let disposed = false;
  const timeouts = new Map();

  function receive(request) {
    if (disposed || !request || typeof request.requestId !== "string" || !Number.isFinite(request.expiresAt) || requests.some((entry) => entry.requestId === request.requestId)) return;
    const remainingMs = request.expiresAt - clock.now();
    if (remainingMs <= 0) return;
    const timeout = timers.setTimeout(() => {
      if (timeouts.get(request.requestId) === timeout) remove(request.requestId);
    }, remainingMs);
    timeout?.unref?.();
    timeouts.set(request.requestId, timeout);
    requests = [...requests, request];
    onChange(requests);
  }

  function remove(requestId) {
    if (disposed || !timeouts.has(requestId)) return;
    timers.clearTimeout(timeouts.get(requestId));
    timeouts.delete(requestId);
    requests = requests.filter((entry) => entry.requestId !== requestId);
    onChange(requests);
  }

  function dispose() {
    disposed = true;
    for (const timeout of timeouts.values()) timers.clearTimeout(timeout);
    timeouts.clear();
    requests = [];
  }

  return { receive, remove, dispose };
}
