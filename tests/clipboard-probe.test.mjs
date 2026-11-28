import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { probeSyntheticClipboard } from "./desktop/clipboard-probe.mjs";

const MARKER = "Life-Atlas-Synthetic-Clipboard-Probe-48";
const FORMAT = 'electron application/osclipboard;format="ExcludeClipboardContentFromMonitorProcessing"';
const FOREIGN_TEXT = "Fake-Unowned-Clipboard-Value";
const FOREIGN_ERROR = "Fake-Unowned-Clipboard-Error";

function createClipboardFake({ changeBoundary, changeOccurrence = 1, restoreAfterMismatch = false, blankOnFormatWrite = false, writeErrorName = null, failOperation = null, payloadBytes = null } = {}) {
  const calls = { writeText: 0, readText: 0, read: 0, write: 0, getType: 0, arrayBuffer: 0, clear: 0 };
  const boundaries = new Map();
  const state = { text: "", types: [], payloadBytes: new Uint8Array(), ownershipChanged: false, afterLossMutations: 0, afterLossPayloadReads: 0 };
  const hit = (operation) => {
    calls[operation] += 1;
    if (state.ownershipChanged && ["writeText", "write", "clear"].includes(operation)) state.afterLossMutations += 1;
    if (state.ownershipChanged && ["getType", "arrayBuffer"].includes(operation)) state.afterLossPayloadReads += 1;
    if (operation === failOperation) throw new Error(FOREIGN_ERROR);
  };
  const change = (operation) => {
    const occurrence = (boundaries.get(operation) ?? 0) + 1;
    boundaries.set(operation, occurrence);
    if (operation !== changeBoundary || occurrence !== changeOccurrence) return false;
    state.text = FOREIGN_TEXT;
    state.types = ["text/plain", FORMAT];
    state.payloadBytes = new Uint8Array([9, 8, 7, 6]);
    state.ownershipChanged = true;
    return true;
  };
  class FakeClipboardItem {
    constructor(values) { this.values = values; }
  }
  const clipboard = {
    async writeText(value) {
      hit("writeText");
      await Promise.resolve();
      state.text = value;
      state.types = ["text/plain"];
      state.payloadBytes = new Uint8Array();
      change("writeText");
    },
    async readText() {
      hit("readText");
      await Promise.resolve();
      const changed = change("readText");
      const value = state.text;
      if (changed && restoreAfterMismatch) {
        state.text = MARKER;
        state.types = ["text/plain"];
        state.payloadBytes = new Uint8Array();
      }
      return value;
    },
    async read() {
      hit("read");
      const types = [...state.types];
      const bytes = state.payloadBytes.slice();
      await Promise.resolve();
      change("read");
      return [{ types, async getType() {
        hit("getType");
        await Promise.resolve();
        change("getType");
        return { async arrayBuffer() {
          hit("arrayBuffer");
          await Promise.resolve();
          change("arrayBuffer");
          return bytes.buffer;
        } };
      } }];
    },
    async write(entries) {
      hit("write");
      if (writeErrorName) {
        change("write");
        const error = new Error(FOREIGN_ERROR);
        error.name = writeErrorName;
        throw error;
      }
      const values = entries[0].values;
      state.text = values["text/plain"];
      state.types = Object.keys(values);
      state.payloadBytes = payloadBytes ? new Uint8Array(payloadBytes) : new Uint8Array(await values[FORMAT].arrayBuffer());
      if (blankOnFormatWrite) {
        state.text = "";
        state.types = [FORMAT];
        state.ownershipChanged = true;
      }
      change("write");
    },
    clear() {
      hit("clear");
      state.text = "";
      state.types = [];
      state.payloadBytes = new Uint8Array();
      change("clear");
    },
  };
  return { clipboard, ClipboardItem: FakeClipboardItem, calls, state };
}

async function captureProbe(fake, probe = probeSyntheticClipboard) {
  try { return { result: await probe({ clipboard: fake.clipboard, ClipboardItem: fake.ClipboardItem }), failure: null }; }
  catch (failure) { return { result: null, failure }; }
}

test("synthetic clipboard probe preserves text and the four-zero-byte format", async () => {
  const fake = createClipboardFake();
  const outcome = await captureProbe(fake);
  assert.equal(Boolean(outcome.failure), false);
  assert.equal(outcome.result.before.textPreserved, true);
  assert.equal(outcome.result.after.textPreserved, true);
  assert.equal(outcome.result.after.formats.includes(FORMAT), true);
  assert.equal(outcome.result.after.rawFourZeroBytes, true);
  assert.equal(outcome.result.fallback.textPreserved, true);
  assert.equal(outcome.result.excluded, true);
  assert.equal(outcome.result.formatWriteError, null);
  assert.equal(fake.calls.writeText, 1);
  assert.equal(fake.calls.write, 1);
  assert.equal(fake.calls.clear, 1);
  assert.equal(fake.state.text, "");
});

test("synthetic clipboard probe honestly reports unsupported format with preserved text", async () => {
  const fake = createClipboardFake({ writeErrorName: "NotSupportedError" });
  const outcome = await captureProbe(fake);
  assert.equal(Boolean(outcome.failure), false);
  assert.equal(outcome.result.formatWriteError, "NOT_SUPPORTED");
  assert.equal(outcome.result.excluded, false);
  assert.equal(outcome.result.fallback.textPreserved, true);
  assert.equal(fake.calls.writeText, 1);
  assert.equal(fake.calls.clear, 1);
});

test("synthetic clipboard probe sanitizes a format write failure without claiming exclusion", async () => {
  const fake = createClipboardFake({ writeErrorName: "Error" });
  const outcome = await captureProbe(fake);
  assert.equal(Boolean(outcome.failure), false);
  assert.equal(outcome.result.formatWriteError, "E_IO");
  assert.equal(outcome.result.excluded, false);
  assert.equal(outcome.result.fallback.textPreserved, true);
  assert.equal(JSON.stringify(outcome.result).includes(FOREIGN_ERROR), false);
});

for (const [label, payloadBytes] of [["wrong-sized", [0, 0, 0]], ["nonzero", [0, 0, 0, 1]]]) {
  test(`synthetic clipboard probe rejects ${label} exclusion bytes`, async () => {
    const fake = createClipboardFake({ payloadBytes });
    const outcome = await captureProbe(fake);
    assert.equal(Boolean(outcome.failure), false);
    assert.equal(outcome.result.after.rawFourZeroBytes, false);
    assert.equal(outcome.result.excluded, false);
    assert.equal(outcome.result.fallback.textPreserved, true);
  });
}

const ownershipCases = [
  ["after initial marker write", { changeBoundary: "writeText" }],
  ["when a mismatching marker read is followed by marker reappearance", { changeBoundary: "readText", restoreAfterMismatch: true }],
  ["while awaiting Clipboard.read", { changeBoundary: "read", changeOccurrence: 2 }],
  ["while awaiting format getType", { changeBoundary: "getType" }],
  ["while awaiting payload arrayBuffer", { changeBoundary: "arrayBuffer" }],
  ["while awaiting atomic format write", { changeBoundary: "write" }],
  ["while an unsupported format write rejects", { changeBoundary: "write", writeErrorName: "NotSupportedError" }],
  ["during the final fallback inspection", { changeBoundary: "read", changeOccurrence: 3 }],
  ["when format write leaves blank text", { blankOnFormatWrite: true }],
];

for (const [label, options] of ownershipCases) {
  test(`synthetic clipboard probe aborts ${label}`, async () => {
    const fake = createClipboardFake(options);
    const outcome = await captureProbe(fake);
    assert.ok(Boolean(outcome.failure), "detected ownership loss must abort the probe");
    assert.ok(/^E_CLIPBOARD_PROBE_OWNERSHIP:/.test(outcome.failure?.message ?? ""), "ownership failure must use a fixed safe code");
    assert.equal(fake.state.afterLossMutations, 0);
    assert.equal(fake.state.afterLossPayloadReads, 0);
    assert.equal(fake.calls.writeText, 1);
    assert.equal(fake.calls.clear, 0);
    assert.equal(JSON.stringify(outcome.result).includes(FOREIGN_TEXT), false);
    assert.equal((outcome.failure?.message ?? "").includes(FOREIGN_ERROR), false);
  });
}

for (const operation of ["read", "getType", "clear"]) {
  test(`synthetic clipboard probe sanitizes ${operation} errors`, async () => {
    const fake = createClipboardFake({ failOperation: operation });
    const outcome = await captureProbe(fake);
    assert.ok(Boolean(outcome.failure), "native probe errors must remain failures");
    assert.ok(/^E_CLIPBOARD_PROBE_IO:/.test(outcome.failure?.message ?? ""), "native failure must use a fixed safe code");
    assert.equal((outcome.failure?.message ?? "").includes(FOREIGN_ERROR), false);
    assert.equal(JSON.stringify(outcome.result).includes(FOREIGN_TEXT), false);
  });
}

test("synthetic clipboard probe remains closure-free for Electron evaluate serialization", async () => {
  const serialized = vm.runInNewContext(`(${probeSyntheticClipboard.toString()})`, { Blob, Uint8Array });
  const outcome = await captureProbe(createClipboardFake(), serialized);
  assert.equal(Boolean(outcome.failure), false);
  assert.equal(outcome.result.excluded, true);
  assert.equal(outcome.result.fallback.textPreserved, true);
});

test("synthetic clipboard probe awaits and sanitizes asynchronous clear rejection", async () => {
  const fake = createClipboardFake();
  const rejectedClear = Promise.reject(new Error(FOREIGN_ERROR));
  rejectedClear.catch(() => {});
  fake.clipboard.clear = () => {
    fake.calls.clear += 1;
    return rejectedClear;
  };
  const outcome = await captureProbe(fake);
  assert.ok(Boolean(outcome.failure), "asynchronous clear rejection must remain a probe failure");
  assert.ok(outcome.failure?.message === "E_CLIPBOARD_PROBE_IO:clear-marker", "asynchronous clear rejection must use a fixed safe code");
  assert.equal((outcome.failure?.message ?? "").includes(FOREIGN_ERROR), false);
  assert.equal(fake.calls.clear, 1);
  assert.equal(outcome.result, null);
});

test("synthetic clipboard probe waits for deferred clear completion before returning", async () => {
  const fake = createClipboardFake();
  let releaseClear;
  let signalClearStarted;
  const deferredClear = new Promise((resolve) => { releaseClear = resolve; });
  const clearStarted = new Promise((resolve) => { signalClearStarted = resolve; });
  let settled = false;
  fake.clipboard.clear = () => {
    fake.calls.clear += 1;
    signalClearStarted();
    return deferredClear.then(() => {
      fake.state.text = "";
      fake.state.types = [];
    });
  };
  const pendingProbe = captureProbe(fake).then((outcome) => {
    settled = true;
    return outcome;
  });
  await Promise.race([clearStarted, pendingProbe]);
  await new Promise((resolve) => { setImmediate(resolve); });
  const settledBeforeClear = settled;
  releaseClear();
  const outcome = await pendingProbe;
  assert.equal(settledBeforeClear, false, "probe must not return before its clear promise completes");
  assert.equal(Boolean(outcome.failure), false);
  assert.equal(outcome.result.fallback.textPreserved, true);
  assert.equal(fake.calls.clear, 1);
  assert.equal(fake.state.text, "");
});
