import { createHash } from "node:crypto";
import { VaultError } from "./errors.js";

const EXCLUSION_FORMAT = 'electron application/osclipboard;format="ExcludeClipboardContentFromMonitorProcessing"';

export function createClipboardGuard({ clipboard, createClipboardItem, timers = globalThis, clearAfterMs = 30000, logger }) {
  let owned = null;
  let timeout = null;
  let exclusionSupported = null;
  let generation = 0;
  let tail = Promise.resolve();
  const fingerprint = (text) => createHash("sha256").update(text).digest("hex");

  function cancelTimeout() {
    if (timeout !== null) timers.clearTimeout(timeout);
    timeout = null;
  }

  function enqueue(operation) {
    const result = tail.then(operation);
    tail = result.catch(() => {});
    return result;
  }

  function checkGeneration(expected) {
    if (generation !== expected) throw new VaultError("E_LOCKED", "locked");
  }

  function reportCleanupFailure() {
    try { logger?.("vault.clipboard.cleanup.failed", { errorCode: "E_IO" }); } catch {}
  }

  async function clearOwned(candidate) {
    if (!candidate || owned !== candidate) return;
    cancelTimeout();
    const current = await clipboard.readText();
    if (owned !== candidate) return;
    if (fingerprint(current) !== candidate.hash) { owned = null; return; }
    await clipboard.clear();
    if (owned === candidate) owned = null;
  }

  function clearIfOwned() {
    generation += 1;
    cancelTimeout();
    return enqueue(() => clearOwned(owned));
  }

  function checkText(current, text, candidate) {
    if (current === text) return;
    if (owned === candidate) owned = null;
    throw new VaultError("E_IO", "剪贴板内容已变化，复制未完成");
  }

  async function readExclusion(expected) {
    const entries = await clipboard.read();
    checkGeneration(expected);
    const entry = entries.find((value) => value.types.includes(EXCLUSION_FORMAT));
    if (!entry) return false;
    const payload = await entry.getType(EXCLUSION_FORMAT);
    checkGeneration(expected);
    if (typeof payload?.arrayBuffer !== "function") return false;
    const bytes = new Uint8Array(await payload.arrayBuffer());
    checkGeneration(expected);
    return bytes.length === 4 && bytes.every((value) => value === 0);
  }

  async function writeText(text, expected, candidate) {
    checkGeneration(expected);
    owned = candidate;
    await clipboard.writeText(text);
    checkGeneration(expected);
    const current = await clipboard.readText();
    checkGeneration(expected);
    checkText(current, text, candidate);
  }

  async function writeValue(text, expected, candidate) {
    if (exclusionSupported === false || typeof createClipboardItem !== "function" || typeof clipboard.write !== "function" || typeof clipboard.read !== "function") {
      exclusionSupported = false;
      await writeText(text, expected, candidate);
      return;
    }
    const before = await clipboard.readText();
    checkGeneration(expected);
    const entry = createClipboardItem({ "text/plain": text, [EXCLUSION_FORMAT]: new Blob([new Uint8Array(4)]) });
    owned = candidate;
    try { await clipboard.write([entry]); }
    catch (error) {
      checkGeneration(expected);
      if (error?.name !== "NotSupportedError") throw error;
      const current = await clipboard.readText();
      checkGeneration(expected);
      if (current !== text && current !== before) checkText(current, text, candidate);
      exclusionSupported = false;
      if (current !== text) await writeText(text, expected, candidate);
      return;
    }
    checkGeneration(expected);
    const current = await clipboard.readText();
    checkGeneration(expected);
    const excluded = await readExclusion(expected);
    const latest = await clipboard.readText();
    checkGeneration(expected);
    if (current === "" && latest === "" && excluded) {
      exclusionSupported = false;
      await writeText(text, expected, candidate);
      return;
    }
    checkText(latest, text, candidate);
    exclusionSupported = excluded;
  }

  function copy(text, options = {}) {
    const expected = generation;
    const milliseconds = options.clearAfterMs ?? clearAfterMs;
    return enqueue(async () => {
      checkGeneration(expected);
      await clearOwned(owned);
      checkGeneration(expected);
      const candidate = { hash: fingerprint(text) };
      try {
        await writeValue(text, expected, candidate);
        checkGeneration(expected);
        timeout = timers.setTimeout(() => {
          if (owned === candidate) timeout = null;
          return enqueue(() => clearOwned(candidate)).catch(reportCleanupFailure);
        }, milliseconds);
        timeout?.unref?.();
        return { clearsInSeconds: milliseconds / 1000 };
      } catch (error) {
        try { await clearOwned(candidate); } catch { reportCleanupFailure(); }
        throw error;
      }
    });
  }

  return { copy, check: clearIfOwned, clearIfOwned, get exclusionSupported() { return exclusionSupported; } };
}
