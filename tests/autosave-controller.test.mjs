import test from "node:test";
import assert from "node:assert/strict";
import { createAutosaveController } from "../src/persistence/autosaveController.js";

function fakeTimers() {
  const scheduled = new Map();
  let sequence = 0;
  return {
    scheduled,
    setTimeout(callback, delay) { sequence += 1; scheduled.set(sequence, { callback, delay }); return sequence; },
    clearTimeout(id) { scheduled.delete(id); },
    async fire() { const entry = scheduled.entries().next().value; if (entry) { scheduled.delete(entry[0]); entry[1].callback(); await new Promise((resolve) => setImmediate(resolve)); } },
  };
}

test("autosave debounces edits for 450ms and saves only the latest snapshot", async () => {
  const timers = fakeTimers();
  const writes = [];
  const controller = createAutosaveController({ save: async (value) => { writes.push(value); return { ok: true }; } }, { timers });
  controller.update({ revision: 1 });
  const latest = { revision: 2 };
  controller.update(latest);
  assert.equal(timers.scheduled.size, 1);
  assert.equal([...timers.scheduled.values()][0].delay, 450);
  assert.deepEqual(writes, []);
  await timers.fire();
  assert.deepEqual(writes, [latest]);
  controller.dispose();
});

test("flush waits for durable success and serializes edits made during a save", async () => {
  const timers = fakeTimers();
  const writes = [];
  const completions = [];
  const states = [];
  const controller = createAutosaveController({ save: (value) => { writes.push(value); return new Promise((resolve) => completions.push(resolve)); } }, { timers, onState: (state) => states.push(state) });
  controller.update({ revision: 1 });
  let finished = false;
  const first = controller.flush().then((result) => { finished = true; return result; });
  controller.update({ revision: 2 });
  const second = controller.flush();
  assert.equal(writes.length, 1);
  assert.equal(finished, false);
  completions.shift()({ ok: true, savedAt: "first" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(writes.map((value) => value.revision), [1, 2]);
  assert.equal(finished, false);
  completions.shift()({ ok: true, savedAt: "second" });
  assert.equal((await first).ok, true);
  assert.equal((await second).savedAt, "second");
  assert.equal(states.at(-1).status, "saved");
  assert.equal(states.at(-1).savedAt, "second");
  controller.dispose();
});

for (const failure of ["throws", "returns failure", "returns null"]) test(`autosave ${failure} keeps edits and retries after 3 seconds`, async () => {
  const timers = fakeTimers();
  const states = [];
  const snapshot = { revision: 1 };
  let attempts = 0;
  const controller = createAutosaveController({ save: async () => {
    attempts += 1;
    if (attempts > 1) return { ok: true };
    if (failure === "throws") throw new Error("disk full");
    return failure === "returns null" ? null : { ok: false, error: { code: "E_IO", message: "disk full" } };
  } }, { timers, onState: (state) => states.push(state) });
  controller.update(snapshot);
  assert.equal((await controller.flush()).ok, false);
  assert.equal(controller.getPendingSnapshot(), snapshot);
  assert.equal(states.at(-1).status, "error");
  assert.equal([...timers.scheduled.values()][0].delay, 3000);
  await timers.fire();
  assert.equal(attempts, 2);
  assert.equal(states.at(-1).status, "saved");
  controller.dispose();
});

test("disposing autosave clears pending timers and prevents later writes", async () => {
  const timers = fakeTimers();
  let writes = 0;
  const controller = createAutosaveController({ save: async () => { writes += 1; return { ok: true }; } }, { timers });
  controller.update({ revision: 1 });
  controller.dispose();
  controller.update({ revision: 2 });
  await controller.flush();
  assert.equal(timers.scheduled.size, 0);
  assert.equal(writes, 0);
});
