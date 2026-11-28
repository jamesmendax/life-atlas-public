import test from "node:test";
import assert from "node:assert/strict";
import { createClipboardGuard } from "../electron/main/vault/clipboardGuard.js";
import { createConfirmRequests } from "../electron/main/vault/confirmRequests.js";
import { createConfirmationQueue } from "../src/vault-ui/confirmationQueue.js";
import { lastTwoGroups } from "../electron/main/vault/recoveryKey.js";
import { TEST_PASSWORD, createVaultTestContext, fakeClipboard, fakeTimers } from "./fixtures/vault-items.mjs";

const EXCLUSION_FORMAT = 'electron application/osclipboard;format="ExcludeClipboardContentFromMonitorProcessing"';

function createClipboardItem(values) {
  return { types: Object.keys(values), async getType(type) { return typeof values[type] === "string" ? new Blob([values[type]]) : values[type]; } };
}

function clipboardTimers() {
  const fake = fakeTimers();
  const pending = [];
  const timers = { ...fake.timers, setTimeout: (callback, milliseconds) => fake.timers.setTimeout(() => { const result = callback(); pending.push(result); return result; }, milliseconds) };
  return { ...fake, timers, async settle() { while (pending.length) await Promise.all(pending.splice(0)); } };
}

test("clipboard is cleared when it still holds the copied value", async () => {
  const fake = clipboardTimers(); const clipboard = fakeClipboard(); const guard = createClipboardGuard({ clipboard, timers: fake.timers, clearAfterMs: 30000 });
  assert.equal((await guard.copy("hidden")).clearsInSeconds, 30); fake.advance(29999); await fake.settle(); assert.equal(clipboard.readText(), "hidden"); fake.advance(1); await fake.settle(); assert.equal(clipboard.readText(), "");
  await guard.copy("next"); await guard.clearIfOwned(); assert.equal(clipboard.readText(), "");
});

test("clipboard is kept when the user copied something else", async () => {
  const fake = clipboardTimers(); const clipboard = fakeClipboard(); const guard = createClipboardGuard({ clipboard, timers: fake.timers, clearAfterMs: 30000 });
  await guard.copy("hidden"); clipboard.writeText("something else"); fake.advance(30000); await fake.settle(); assert.equal(clipboard.readText(), "something else");
});

test("clipboard history format is retained when electron preserves text", async () => {
  const fake = fakeTimers(); const clipboard = fakeClipboard(); const formats = new Set();
  let contents = [];
  clipboard.write = async (entries) => {
    assert.equal(entries.length, 1);
    assert.deepEqual(entries[0].types, ["text/plain", EXCLUSION_FORMAT]);
    assert.deepEqual(Buffer.from(await (await entries[0].getType(EXCLUSION_FORMAT)).arrayBuffer()), Buffer.alloc(4));
    contents = entries; clipboard.writeText(await (await entries[0].getType("text/plain")).text()); formats.add("ExcludeClipboardContentFromMonitorProcessing");
  };
  clipboard.read = async () => contents;
  const guard = createClipboardGuard({ clipboard, createClipboardItem, timers: fake.timers });
  await guard.copy("synthetic-secret"); assert.equal(guard.exclusionSupported, true); assert.equal(clipboard.readText(), "synthetic-secret"); assert.ok(formats.has("ExcludeClipboardContentFromMonitorProcessing"));
  await guard.clearIfOwned(); assert.equal(clipboard.readText(), "");
});

test("clipboard falls back to text when an extra format replaces it", async () => {
  const fake = fakeTimers(); const clipboard = fakeClipboard(); let attempts = 0;
  let contents = [];
  clipboard.write = async (entries) => { attempts += 1; clipboard.writeText(""); contents = [createClipboardItem({ [EXCLUSION_FORMAT]: await entries[0].getType(EXCLUSION_FORMAT) })]; };
  clipboard.read = async () => contents;
  const guard = createClipboardGuard({ clipboard, createClipboardItem, timers: fake.timers });
  await guard.copy("synthetic-secret"); assert.equal(guard.exclusionSupported, false); assert.equal(clipboard.readText(), "synthetic-secret");
  await guard.copy("next-synthetic-secret"); assert.equal(attempts, 1); assert.equal(clipboard.readText(), "next-synthetic-secret");
  await guard.clearIfOwned(); assert.equal(clipboard.readText(), "");
});

async function setup(context) {
  const fixture = createVaultTestContext(context); const key = await fixture.service.create({ password: TEST_PASSWORD }); fixture.service.confirmRecoveryKey({ lastTwoGroups: lastTwoGroups(key.recoveryKey) });
  const delivered = []; let counter = 0;
  const requests = createConfirmRequests({ verifyPassword: fixture.service.verifyPassword, timers: fixture.fake.timers, idFactory: () => `request-${++counter}`, deliver: (value) => delivered.push(value), ttlMs: 120000 });
  return { ...fixture, requests, delivered };
}

test("confirm with the right password resolves confirmed and keeps the lock state", async (context) => {
  const { service, requests } = await setup(context);
  for (const locked of [false, true]) {
    if (locked) service.lock();
    const pending = requests.request({ kind: "export-backup", title: "导出", description: "确认" });
    await requests.confirm({ requestId: locked ? "request-2" : "request-1", password: TEST_PASSWORD }); assert.equal(await pending, "confirmed"); assert.equal(service.status().locked, locked);
  }
});

test("confirm with a wrong password counts a failure", async (context) => {
  const { service, requests } = await setup(context); service.lock();
  const pending = requests.request({ kind: "export-backup", title: "导出", description: "确认" });
  for (let iteration = 0; iteration < 5; iteration += 1) await assert.rejects(requests.confirm({ requestId: "request-1", password: "wrong" }), { code: "E_BAD_PASSWORD" });
  await assert.rejects(service.unlock({ password: TEST_PASSWORD }), { code: "E_THROTTLED", retryAfterMs: 30000 }); requests.reject({ requestId: "request-1" }); assert.equal(await pending, "cancelled");
});

test("reject resolves cancelled and expiry resolves expired", async (context) => {
  const { requests, fake } = await setup(context);
  const first = requests.request({ kind: "reveal-field", title: "显示", description: "确认" }); requests.reject({ requestId: "request-1" }); assert.equal(await first, "cancelled");
  const second = requests.request({ kind: "schedule-backup", title: "备份", description: "确认" }); fake.advance(120000); assert.equal(await second, "expired");
});

test("expired confirmation disappears from the vault queue at exactly 3000ms", async (context) => {
  const fake = fakeTimers();
  let visible = [];
  const queue = createConfirmationQueue({ onChange: (requests) => { visible = requests; }, clock: fake.clock, timers: fake.timers });
  context.after(() => queue.dispose());
  const requests = createConfirmRequests({ verifyPassword: async () => true, clock: fake.clock, timers: fake.timers, ttlMs: 3000, idFactory: () => "expiry-request", deliver: queue.receive });
  const pending = requests.request({ kind: "export-backup", title: "导出完整备份（包含密钥库）", description: "确认" });
  await Promise.resolve();
  assert.equal(visible.length, 1);
  assert.equal(visible[0].expiresAt, fake.clock.now() + 3000);
  fake.advance(2999);
  assert.equal(visible.length, 1);
  fake.advance(1);
  assert.equal(await pending, "expired");
  assert.equal(visible.length, 0);
  assert.equal(fake.pending(), 0);
});

test("a confirmation delivered after its deadline never enters the vault queue", async (context) => {
  const fake = fakeTimers();
  let visible = [];
  const queue = createConfirmationQueue({ onChange: (requests) => { visible = requests; }, clock: fake.clock, timers: fake.timers });
  context.after(() => queue.dispose());
  let releaseDelivery;
  const ready = new Promise((resolve) => { releaseDelivery = resolve; });
  let deliveryFinished;
  const finished = new Promise((resolve) => { deliveryFinished = resolve; });
  const requests = createConfirmRequests({ verifyPassword: async () => true, clock: fake.clock, timers: fake.timers, ttlMs: 3000, idFactory: () => "late-request", deliver: async (request) => { await ready; queue.receive(request); deliveryFinished(); } });
  const pending = requests.request({ kind: "export-backup", title: "导出", description: "确认" });
  await Promise.resolve();
  fake.advance(3000);
  assert.equal(await pending, "expired");
  releaseDelivery();
  await finished;
  assert.deepEqual(visible, []);
  assert.equal(fake.pending(), 0);
});

test("a confirmation settled before delivery is never sent to the vault", async () => {
  const fake = fakeTimers();
  const delivered = [];
  const requests = createConfirmRequests({ verifyPassword: async () => true, clock: fake.clock, timers: fake.timers, ttlMs: 3000, idFactory: () => "already-expired", deliver: (request) => delivered.push(request) });
  const pending = requests.request({ kind: "export-backup", title: "导出", description: "确认" });
  fake.advance(3000);
  assert.equal(await pending, "expired");
  await Promise.resolve();
  assert.deepEqual(delivered, []);
});

test("an old confirmation timeout cannot remove a new request", () => {
  const fake = fakeTimers();
  const callbacks = [];
  const timers = { ...fake.timers, setTimeout: (callback, milliseconds) => { callbacks.push(callback); return fake.timers.setTimeout(callback, milliseconds); } };
  let visible = [];
  const queue = createConfirmationQueue({ onChange: (requests) => { visible = requests; }, clock: fake.clock, timers });
  queue.receive({ requestId: "replacement", title: "旧请求", description: "旧确认", expiresAt: fake.clock.now() + 3000 });
  queue.remove("replacement");
  queue.receive({ requestId: "replacement", title: "新请求", description: "新确认", expiresAt: fake.clock.now() + 6000 });
  callbacks[0]();
  assert.equal(visible.length, 1);
  assert.equal(visible[0].title, "新请求");
  fake.advance(5999);
  assert.equal(visible.length, 1);
  fake.advance(1);
  assert.equal(visible.length, 0);
  assert.equal(fake.pending(), 0);
  queue.dispose();
});

test("expiry during password verification cannot confirm a finished request", async (context) => {
  const fake = fakeTimers();
  let visible = [];
  const queue = createConfirmationQueue({ onChange: (requests) => { visible = requests; }, clock: fake.clock, timers: fake.timers });
  context.after(() => queue.dispose());
  let finishVerification;
  const verification = new Promise((resolve) => { finishVerification = resolve; });
  const requests = createConfirmRequests({ verifyPassword: () => verification, clock: fake.clock, timers: fake.timers, ttlMs: 3000, idFactory: () => "verifying-request", deliver: queue.receive });
  const pending = requests.request({ kind: "export-backup", title: "导出", description: "确认" });
  await Promise.resolve();
  const confirming = requests.confirm({ requestId: "verifying-request", password: TEST_PASSWORD });
  fake.advance(3000);
  assert.equal(await pending, "expired");
  assert.equal(visible.length, 0);
  finishVerification(true);
  await assert.rejects(confirming, { code: "E_NOT_FOUND" });
});

test("confirmation queue disposal releases all expiry timers", () => {
  const fake = fakeTimers();
  let visible = [];
  const queue = createConfirmationQueue({ onChange: (requests) => { visible = requests; }, clock: fake.clock, timers: fake.timers });
  queue.receive({ requestId: "pending-request", title: "待确认", description: "确认", expiresAt: fake.clock.now() + 3000 });
  assert.equal(fake.pending(), 1);
  queue.dispose();
  assert.equal(fake.pending(), 0);
  fake.advance(3000);
  queue.receive({ requestId: "disposed-request", title: "结束后", description: "确认", expiresAt: fake.clock.now() + 3000 });
  assert.equal(visible.length, 1);
  assert.equal(visible[0].requestId, "pending-request");
  assert.equal(fake.pending(), 0);
});

test("a request id works only once", async (context) => {
  const { requests } = await setup(context); const pending = requests.request({ kind: "export-backup", title: "导出", description: "确认" });
  await requests.confirm({ requestId: "request-1", password: TEST_PASSWORD }); assert.equal(await pending, "confirmed");
  await assert.rejects(requests.confirm({ requestId: "request-1", password: TEST_PASSWORD }), { code: "E_NOT_FOUND" });
});
