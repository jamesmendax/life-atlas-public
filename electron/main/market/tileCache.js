import fs from "node:fs";
import path from "node:path";
import { assertPhysicalPath, writeAtomicJson } from "../storage/dataRoot.js";
import { StorageError } from "../storage/workspaceDb.js";

const digest = /^[a-f0-9]{64}$/u;
const budget = 64 * 1024 * 1024;
const pending = () => ({ cacheReleasedBytes: 0, cacheCleanupPending: true });
const empty = () => ({ cacheReleasedBytes: 0, cacheCleanupPending: false });
const unavailable = () => new StorageError("E_CONFLICT", "地图缓存正在清理。");

export function createMarketTileCache({ session, directory = path.join(session.defaultSession.storagePath, "market-tile-index") }) {
  const root = assertPhysicalPath(directory);
  const partitions = new Map();
  function marker(hash) {
    if (typeof hash !== "string" || !digest.test(hash)) throw new StorageError("E_INVALID_ARGUMENT", "地图组件标识无效。");
    return assertPhysicalPath(path.join(root, hash + ".json"), { root });
  }
  function get(hash) {
    if (!partitions.has(hash)) {
      const store = session.fromPartition(`persist:life-atlas-market-tiles-${hash}`, { cache: true });
      partitions.set(hash, { store, requests: new Set(), uses: 0, budgetCheck: null, clear: null, pending: false });
    }
    return partitions.get(hash);
  }

  async function clear(hash) {
    const file = marker(hash);
    if (!partitions.has(hash) && !fs.existsSync(file)) return empty();
    const entry = get(hash);
    if (!entry.clear) {
      // Register the user's removal before touching the HTTP cache. Only these
      // markers are eligible for retry after a restart.
      writeAtomicJson(file, { pending: true });
      entry.pending = true;
      const active = [...entry.requests];
      const operation = (async () => {
        let released = 0;
        async function evict() {
          const before = await entry.store.getCacheSize();
          await entry.store.clearCache();
          const after = await entry.store.getCacheSize();
          released += Math.max(0, before - after);
          return after;
        }
        for (const request of active) request.abort();
        await entry.budgetCheck;
        let remaining = await evict();
        if (active.length) {
          await Promise.all(active.map((request) => request.finished));
          remaining = await evict();
        }
        if (remaining > 0) return { cacheReleasedBytes: released, cacheCleanupPending: true };
        fs.unlinkSync(file);
        partitions.delete(hash);
        return { cacheReleasedBytes: released, cacheCleanupPending: false };
      })().catch(pending);
      entry.clear = operation;
      void operation.then(() => { entry.clear = null; });
    }
    let timer;
    try {
      // An in-flight network stack may take time to cancel. The last eviction
      // still runs in the background and its marker survives an app exit.
      return await Promise.race([entry.clear, new Promise((resolve) => { timer = setTimeout(() => resolve(pending()), 1800); timer.unref?.(); })]);
    } finally { clearTimeout(timer); }
  }

  async function fetchTile(url, options, hash) {
    const file = marker(hash);
    const current = partitions.get(hash);
    if (current?.clear) throw unavailable();
    if (current?.pending || !current && fs.existsSync(file) && JSON.parse(fs.readFileSync(file, "utf8"))?.pending) {
      if ((await clear(hash)).cacheCleanupPending) throw unavailable();
    }
    if (!partitions.has(hash)) {
      if (!fs.existsSync(file)) writeAtomicJson(file, { pending: false });
    }
    const entry = get(hash);
    if (entry.clear) throw unavailable();
    if (entry.uses++ % 8 === 0 && !entry.budgetCheck) {
      entry.budgetCheck = (async () => {
        if (await entry.store.getCacheSize() > budget) await entry.store.clearCache();
      })().finally(() => { entry.budgetCheck = null; });
    }
    // Keep the request registered through body completion, not merely until
    // Chromium returns the headers. Late writes cannot resurrect a removed cache.
    const cancel = new AbortController();
    let done, reader;
    const record = { finished: new Promise((resolve) => { done = resolve; }), abort() { cancel.abort(); if (reader) void reader.cancel().catch(() => {}).finally(finish); } };
    function finish() { entry.requests.delete(record); done(); }
    entry.requests.add(record);
    try {
      await entry.budgetCheck;
      cancel.signal.throwIfAborted();
      const signal = options.signal ? AbortSignal.any([options.signal, cancel.signal]) : cancel.signal;
      const response = await entry.store.fetch(url, { ...options, signal });
      if (!response.body) { finish(); return response; }
      reader = response.body.getReader();
      if (cancel.signal.aborted) { await reader.cancel(); throw unavailable(); }
      const body = new ReadableStream({
        async pull(controller) {
          try {
            const chunk = await reader.read();
            if (chunk.done) { controller.close(); finish(); }
            else controller.enqueue(chunk.value);
          } catch (error) { controller.error(error); finish(); }
        },
        async cancel(reason) { try { await reader.cancel(reason); } finally { finish(); } },
      });
      return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
    } catch (error) { finish(); throw error; }
  }

  async function retryPending() {
    if (!fs.existsSync(root)) return;
    for (const file of fs.readdirSync(root)) {
      const hash = file.endsWith(".json") && file.slice(0, -5);
      if (typeof hash === "string" && digest.test(hash) && JSON.parse(fs.readFileSync(marker(hash), "utf8"))?.pending === true) await clear(hash);
    }
  }
  return { fetchTile, clear, retryPending };
}
