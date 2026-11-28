import test from "node:test";
import assert from "node:assert/strict";
import { createClipboardGuard } from "../electron/main/vault/clipboardGuard.js";
import { fakeTimers } from "./fixtures/vault-items.mjs";

const EXCLUSION_FORMAT = 'electron application/osclipboard;format="ExcludeClipboardContentFromMonitorProcessing"';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function clipboardTimers() {
  const fake = fakeTimers();
  const callbacks = [];
  const pending = [];
  const timers = {
    ...fake.timers,
    setTimeout: (callback, milliseconds) => {
      const tracked = () => { const result = callback(); pending.push(result); return result; };
      callbacks.push(tracked);
      return fake.timers.setTimeout(tracked, milliseconds);
    },
  };
  return { ...fake, timers, callbacks, async settle() { while (pending.length) await Promise.all(pending.splice(0)); } };
}

function createClipboardItem(values) {
  return { types: Object.keys(values), async getType(type) { return typeof values[type] === "string" ? new Blob([values[type]]) : values[type]; } };
}

function asyncClipboard() {
  let text = "";
  let contents = [];
  const writes = [];
  return {
    writes,
    async readText() { return text; },
    async writeText(value) { text = value; contents = [createClipboardItem({ "text/plain": value })]; writes.push({ kind: "text", value }); },
    async write(entries) { text = await (await entries[0].getType("text/plain")).text(); contents = entries; writes.push({ kind: "atomic", entries }); },
    async read() { return contents; },
    clear() { text = ""; contents = []; },
  };
}

test("async clipboard values are awaited before clearing owned content", async () => {
  const clipboard = asyncClipboard();
  const fake = fakeTimers();
  const guard = createClipboardGuard({ clipboard, timers: fake.timers, clearAfterMs: 30000 });
  assert.equal((await guard.copy("Synthetic-Async-48")).clearsInSeconds, 30);
  assert.equal(await clipboard.readText(), "Synthetic-Async-48");
  await guard.clearIfOwned();
  assert.equal(await clipboard.readText(), "");
  assert.equal(fake.pending(), 0);
});

test("clipboard copy waits for the native write and starts the exact deadline afterward", async () => {
  const clipboard = asyncClipboard(); const fake = clipboardTimers();
  const entered = deferred(); const release = deferred(); const write = clipboard.writeText;
  clipboard.writeText = async (value) => { entered.resolve(); await release.promise; return write(value); };
  const guard = createClipboardGuard({ clipboard, timers: fake.timers });
  let completed = false;
  const copying = guard.copy("Synthetic-Write-A").then((value) => { completed = true; return value; });
  await entered.promise;
  fake.advance(60000); await fake.settle();
  assert.equal(completed, false); assert.equal(fake.pending(), 0); assert.equal(await clipboard.readText(), "");
  release.resolve(); assert.deepEqual(await copying, { clearsInSeconds: 30 });
  fake.advance(29999); await fake.settle(); assert.equal(await clipboard.readText(), "Synthetic-Write-A");
  fake.advance(1); await fake.settle(); assert.equal(await clipboard.readText(), ""); assert.equal(fake.pending(), 0);
});

test("clipboard copy waits for verification before reporting success or scheduling cleanup", async () => {
  const clipboard = asyncClipboard(); const fake = clipboardTimers();
  const entered = deferred(); const release = deferred(); const read = clipboard.readText;
  clipboard.readText = async () => { entered.resolve(); await release.promise; return read(); };
  const guard = createClipboardGuard({ clipboard, timers: fake.timers });
  let completed = false;
  const copying = guard.copy("Synthetic-Verify-A").then((value) => { completed = true; return value; });
  await entered.promise; fake.advance(60000); await fake.settle();
  assert.equal(completed, false); assert.equal(fake.pending(), 0);
  release.resolve(); await copying;
  fake.advance(29999); await fake.settle(); assert.equal(await read(), "Synthetic-Verify-A");
  fake.advance(1); await fake.settle(); assert.equal(await read(), "");
});

test("old clipboard timers cannot clear a newer copy even when both values are equal", async () => {
  for (const replacement of ["Synthetic-Replace-B", "Synthetic-Replace-A"]) {
    const clipboard = asyncClipboard(); const fake = clipboardTimers(); const guard = createClipboardGuard({ clipboard, timers: fake.timers });
    await guard.copy("Synthetic-Replace-A"); fake.advance(10000);
    await guard.copy(replacement); assert.equal(fake.pending(), 1);
    await fake.callbacks[0](); await fake.settle(); assert.equal(await clipboard.readText(), replacement); assert.equal(fake.pending(), 1);
    fake.advance(29999); await fake.settle(); assert.equal(await clipboard.readText(), replacement);
    fake.advance(1); await fake.settle(); assert.equal(await clipboard.readText(), ""); assert.equal(fake.pending(), 0);
  }
});

test("a delayed old timer read drains before a replacement write and cannot later clear it", async () => {
  const clipboard = asyncClipboard(); const fake = clipboardTimers(); const guard = createClipboardGuard({ clipboard, timers: fake.timers });
  await guard.copy("Synthetic-Late-A");
  const entered = deferred(); const release = deferred(); const read = clipboard.readText; let hold = true;
  clipboard.readText = async () => { if (hold) { hold = false; entered.resolve(); await release.promise; } return read(); };
  fake.advance(30000); await entered.promise;
  const replacement = guard.copy("Synthetic-Late-B");
  assert.equal(await read(), "Synthetic-Late-A");
  release.resolve(); await fake.settle(); await replacement;
  await fake.callbacks[0](); await fake.settle(); assert.equal(await read(), "Synthetic-Late-B"); assert.equal(fake.pending(), 1);
  fake.advance(29999); await fake.settle(); assert.equal(await read(), "Synthetic-Late-B");
  fake.advance(1); await fake.settle(); assert.equal(await read(), "");
});

test("timer and lock cleanup preserve a different value copied by the user", async () => {
  for (const trigger of ["timer", "lock"]) {
    const clipboard = asyncClipboard(); const fake = clipboardTimers(); const guard = createClipboardGuard({ clipboard, timers: fake.timers });
    await guard.copy("Synthetic-Owned-A"); await clipboard.writeText("Synthetic-External-C");
    if (trigger === "timer") { fake.advance(30000); await fake.settle(); } else await guard.clearIfOwned();
    assert.equal(await clipboard.readText(), "Synthetic-External-C"); assert.equal(fake.pending(), 0);
    await guard.clearIfOwned(); assert.equal(await clipboard.readText(), "Synthetic-External-C");
  }
});

test("lock invalidates all queued copies and drains an already pending native write", async () => {
  const clipboard = asyncClipboard(); const fake = clipboardTimers();
  const entered = deferred(); const release = deferred(); const write = clipboard.writeText;
  clipboard.writeText = async (value) => { entered.resolve(); await release.promise; return write(value); };
  const guard = createClipboardGuard({ clipboard, timers: fake.timers });
  const first = guard.copy("Synthetic-Pending-A"); const rejectedFirst = assert.rejects(first, { code: "E_LOCKED" });
  await entered.promise;
  const second = guard.copy("Synthetic-Queued-B"); const rejectedSecond = assert.rejects(second, { code: "E_LOCKED" });
  const third = guard.copy("Synthetic-Queued-D"); const rejectedThird = assert.rejects(third, { code: "E_LOCKED" });
  let cleaned = false;
  const cleanup = guard.clearIfOwned().then(() => { cleaned = true; });
  assert.equal(cleaned, false); assert.equal(fake.pending(), 0);
  release.resolve(); await Promise.all([rejectedFirst, rejectedSecond, rejectedThird, cleanup]);
  assert.deepEqual(clipboard.writes.map((entry) => entry.value), ["Synthetic-Pending-A"]);
  assert.equal(await clipboard.readText(), ""); assert.equal(fake.pending(), 0);
  await guard.copy("Synthetic-Queue-Recovered"); await guard.clearIfOwned(); assert.equal(await clipboard.readText(), "");
});

test("timer read rejection is handled with safe logging and ownership remains retryable", async () => {
  const clipboard = asyncClipboard(); const fake = clipboardTimers(); const logs = [];
  const guard = createClipboardGuard({ clipboard, timers: fake.timers, logger: (event, details) => logs.push({ event, details }) });
  await guard.copy("Synthetic-Retry-A");
  const read = clipboard.readText;
  clipboard.readText = async () => { const error = new Error("Synthetic-Never-Log-Message"); error.code = "Synthetic-Never-Log-Code"; throw error; };
  fake.advance(30000); await fake.settle();
  assert.deepEqual(logs, [{ event: "vault.clipboard.cleanup.failed", details: { errorCode: "E_IO" } }]);
  assert.equal(await read(), "Synthetic-Retry-A"); assert.equal(fake.pending(), 0);
  clipboard.readText = read; await guard.clearIfOwned(); assert.equal(await read(), "");
});

test("direct clear failure rejects and retains ownership for the next cleanup", async () => {
  const clipboard = asyncClipboard(); const fake = clipboardTimers(); const guard = createClipboardGuard({ clipboard, timers: fake.timers });
  await guard.copy("Synthetic-Clear-Retry-A");
  const clear = clipboard.clear; clipboard.clear = () => { throw Object.assign(new Error("Synthetic-Clear-Error"), { code: "EACCES" }); };
  await assert.rejects(guard.clearIfOwned(), { code: "EACCES" }); assert.equal(await clipboard.readText(), "Synthetic-Clear-Retry-A");
  clipboard.clear = clear; await guard.clearIfOwned(); assert.equal(await clipboard.readText(), ""); assert.equal(fake.pending(), 0);
});

test("write and verification errors reject the copy and the queue still recovers", async () => {
  for (const failure of ["write", "committed-write", "read"]) {
    const clipboard = asyncClipboard(); const fake = clipboardTimers(); const guard = createClipboardGuard({ clipboard, timers: fake.timers });
    const write = clipboard.writeText; const read = clipboard.readText; const error = Object.assign(new Error("Synthetic-Copy-Failure"), { code: "EACCES" });
    if (failure !== "read") clipboard.writeText = async (value) => { if (failure === "committed-write") await write(value); throw error; };
    else { let remaining = 1; clipboard.readText = async () => { if (remaining-- > 0) throw error; return read(); }; }
    await assert.rejects(guard.copy("Synthetic-Error-A"), { code: "EACCES" }); assert.equal(await read(), ""); assert.equal(fake.pending(), 0);
    clipboard.writeText = write; clipboard.readText = read;
    await guard.copy("Synthetic-Error-Recovered-B"); await guard.clearIfOwned(); assert.equal(await read(), "");
  }
});

test("clipboard exclusion uses one atomic item with exact text and four zero bytes", async () => {
  const clipboard = asyncClipboard(); const fake = clipboardTimers(); const guard = createClipboardGuard({ clipboard, createClipboardItem, timers: fake.timers });
  await guard.copy("Synthetic-Atomic-A");
  assert.equal(clipboard.writes.length, 1); assert.equal(clipboard.writes[0].kind, "atomic");
  const entry = clipboard.writes[0].entries[0]; assert.deepEqual(entry.types, ["text/plain", EXCLUSION_FORMAT]);
  assert.equal(await (await entry.getType("text/plain")).text(), "Synthetic-Atomic-A");
  assert.deepEqual(Buffer.from(await (await entry.getType(EXCLUSION_FORMAT)).arrayBuffer()), Buffer.alloc(4));
  assert.equal(guard.exclusionSupported, true);
  await guard.clearIfOwned(); assert.equal(await clipboard.readText(), "");
});

test("a malformed exclusion payload never counts as supported or causes a text rewrite", async () => {
  for (const payload of [new Uint8Array(3), new Uint8Array([0, 0, 0, 1])]) {
    const clipboard = asyncClipboard(); const fake = clipboardTimers(); const write = clipboard.write;
    clipboard.write = (entries) => write([createClipboardItem({ "text/plain": "Synthetic-Bad-Format-A", [EXCLUSION_FORMAT]: new Blob([payload]) })]);
    const guard = createClipboardGuard({ clipboard, createClipboardItem, timers: fake.timers });
    await guard.copy("Synthetic-Bad-Format-A"); assert.equal(guard.exclusionSupported, false); assert.equal(clipboard.writes.length, 1);
    await guard.copy("Synthetic-Bad-Format-B"); assert.deepEqual(clipboard.writes.map((entry) => entry.kind), ["atomic", "text"]);
    await guard.clearIfOwned();
  }
});

test("format read failures reject the copy without leaving the written secret behind", async () => {
  for (const operation of ["read", "getType", "arrayBuffer"]) {
    const clipboard = asyncClipboard(); const fake = clipboardTimers(); const error = Object.assign(new Error("Synthetic-Format-Error"), { code: "EACCES" });
    if (operation === "read") clipboard.read = async () => { throw error; };
    else clipboard.read = async () => [{ types: [EXCLUSION_FORMAT], async getType() { if (operation === "getType") throw error; return { async arrayBuffer() { throw error; } }; } }];
    const guard = createClipboardGuard({ clipboard, createClipboardItem, timers: fake.timers });
    await assert.rejects(guard.copy("Synthetic-Format-A"), { code: "EACCES" });
    assert.equal(await clipboard.readText(), ""); assert.equal(fake.pending(), 0);
  }
});

test("an external copy during exclusion verification is preserved rather than mistaken for compatibility loss", async () => {
  const clipboard = asyncClipboard(); const fake = clipboardTimers(); const entered = deferred(); const release = deferred();
  clipboard.read = async () => [{ types: [EXCLUSION_FORMAT], async getType() { entered.resolve(); await release.promise; return new Blob([new Uint8Array(4)]); } }];
  const guard = createClipboardGuard({ clipboard, createClipboardItem, timers: fake.timers });
  const copying = guard.copy("Synthetic-Format-Race-A"); const rejected = assert.rejects(copying, { code: "E_IO" });
  await entered.promise; await clipboard.writeText("Synthetic-External-C"); release.resolve(); await rejected;
  assert.equal(await clipboard.readText(), "Synthetic-External-C"); assert.equal(fake.pending(), 0);
  assert.deepEqual(clipboard.writes.map((entry) => entry.kind), ["atomic", "text"]);
  await guard.clearIfOwned(); assert.equal(await clipboard.readText(), "Synthetic-External-C");
});

test("lock during exclusion verification forbids fallback and clears the pending owned write", async () => {
  const clipboard = asyncClipboard(); const fake = clipboardTimers(); const entered = deferred(); const release = deferred();
  clipboard.read = async () => [{ types: [EXCLUSION_FORMAT], async getType() { entered.resolve(); await release.promise; return new Blob([new Uint8Array(4)]); } }];
  const guard = createClipboardGuard({ clipboard, createClipboardItem, timers: fake.timers });
  const copying = guard.copy("Synthetic-Format-Lock-A"); const rejected = assert.rejects(copying, { code: "E_LOCKED" });
  await entered.promise; const cleanup = guard.clearIfOwned(); release.resolve(); await Promise.all([rejected, cleanup]);
  assert.equal(await clipboard.readText(), ""); assert.equal(fake.pending(), 0); assert.deepEqual(clipboard.writes.map((entry) => entry.kind), ["atomic"]);
});

test("unsupported atomic formats fall back once only while the original clipboard is unchanged", async () => {
  const clipboard = asyncClipboard(); const fake = clipboardTimers(); let attempts = 0;
  clipboard.write = async () => { attempts += 1; throw Object.assign(new Error("Synthetic-Unsupported"), { name: "NotSupportedError" }); };
  const guard = createClipboardGuard({ clipboard, createClipboardItem, timers: fake.timers });
  await guard.copy("Synthetic-Unsupported-A"); assert.equal(guard.exclusionSupported, false); assert.equal(await clipboard.readText(), "Synthetic-Unsupported-A");
  await guard.copy("Synthetic-Unsupported-B"); assert.equal(attempts, 1); assert.equal(await clipboard.readText(), "Synthetic-Unsupported-B");
  await guard.clearIfOwned();
});

test("unsupported-format fallback cannot overwrite an external copy or run after locking", async () => {
  for (const trigger of ["external", "lock"]) {
    const clipboard = asyncClipboard(); const fake = clipboardTimers(); const entered = deferred(); const release = deferred();
    clipboard.write = async () => { entered.resolve(); await release.promise; throw Object.assign(new Error("Synthetic-Unsupported"), { name: "NotSupportedError" }); };
    const guard = createClipboardGuard({ clipboard, createClipboardItem, timers: fake.timers });
    const copying = guard.copy("Synthetic-Fallback-A"); const rejected = assert.rejects(copying, { code: trigger === "lock" ? "E_LOCKED" : "E_IO" });
    await entered.promise;
    const cleanup = trigger === "lock" ? guard.clearIfOwned() : clipboard.writeText("Synthetic-External-C");
    release.resolve(); await Promise.all([rejected, cleanup]);
    assert.equal(await clipboard.readText(), trigger === "lock" ? "" : "Synthetic-External-C"); assert.equal(fake.pending(), 0);
    assert.deepEqual(clipboard.writes.map((entry) => entry.value), trigger === "lock" ? [] : ["Synthetic-External-C"]);
  }
});
