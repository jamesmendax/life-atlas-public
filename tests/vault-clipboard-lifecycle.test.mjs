import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import { randomBytes as secureRandomBytes } from "node:crypto";
import { installApplicationLifecycle } from "../electron/main/security.js";
import { lastTwoGroups } from "../electron/main/vault/recoveryKey.js";
import { parseTotpSecret } from "../electron/main/vault/totp.js";
import { TEST_PASSWORD, RFC_SHA1_BASE32, createVaultTestContext, fakeTimers, vaultItemInputs } from "./fixtures/vault-items.mjs";

const EXCLUSION_FORMAT = 'electron application/osclipboard;format="ExcludeClipboardContentFromMonitorProcessing"';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
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

function clipboardTimers() {
  const fake = fakeTimers(); const pending = [];
  const timers = { ...fake.timers, setTimeout: (callback, milliseconds) => fake.timers.setTimeout(() => { const result = callback(); pending.push(result); return result; }, milliseconds) };
  return { ...fake, timers, async settle() { while (pending.length) await Promise.all(pending.splice(0)); } };
}

async function ready(context, { confirm = true, ...options } = {}) {
  const clipboard = options.clipboard || asyncClipboard(); const fake = clipboardTimers(); const buffers = [];
  const fixture = createVaultTestContext(context, {
    clipboard, clock: fake.clock, timers: fake.timers,
    randomBytes: (size) => { const bytes = secureRandomBytes(size); if (size === 32) buffers.push(bytes); return bytes; },
    ...options,
  });
  const { recoveryKey } = await fixture.service.create({ password: TEST_PASSWORD });
  if (!confirm) return { ...fixture, clipboard, fake, buffers, recoveryKey };
  fixture.service.confirmRecoveryKey({ lastTwoGroups: lastTwoGroups(recoveryKey) });
  const input = vaultItemInputs()[0];
  input.fields.find((field) => field.kind === "secret").value = "Synthetic-Service-Secret-A";
  input.fields.find((field) => field.kind === "totp").value = RFC_SHA1_BASE32;
  const id = fixture.service.createItem({ input }).summary.id;
  const item = fixture.service.getItem({ id }).item;
  const fieldId = item.fields.find((field) => field.kind === "secret").id;
  const totpFieldId = item.fields.find((field) => field.kind === "totp").id;
  return { ...fixture, clipboard, fake, buffers, recoveryKey, id, fieldId, totpFieldId, item };
}

test("all service copy paths reject after locking while keys and status clear in the same turn", async (context) => {
  for (const method of ["field", "totp", "history", "pending-recovery"]) {
    const fixture = await ready(context, { confirm: method !== "pending-recovery" });
    const { service, clipboard, fake, buffers, id, fieldId, totpFieldId, item, recoveryKey } = fixture;
    if (method === "history") service.updateItem({ id, patch: { fields: item.fields.map((field) => ({ id: field.id, label: field.label, kind: field.kind, sensitive: field.sensitive, ...(field.id === fieldId ? { value: "Synthetic-Service-Secret-B" } : { keepValue: true }) })) } });
    const expected = method === "pending-recovery" ? recoveryKey : method === "totp" ? service.getTotp({ id, fieldId: totpFieldId }).code : "Synthetic-Service-Secret-A";
    const entered = deferred(); const release = deferred(); const write = clipboard.writeText;
    clipboard.writeText = async (value) => { entered.resolve(); await release.promise; return write(value); };
    const locked = []; const statuses = [];
    service.onLocked((value) => locked.push(value)); service.onStatusChanged((value) => statuses.push(value));
    const copying = method === "pending-recovery" ? service.copyPendingRecoveryKey() : method === "history" ? service.copyHistory({ id, fieldId, index: 0 }) : service.copyField({ id, fieldId: method === "totp" ? totpFieldId : fieldId });
    const rejected = assert.rejects(copying, { code: "E_LOCKED" });
    await entered.promise;
    let completed = false;
    const cleanup = service.lock("system-lock").then((result) => { completed = true; return result; });
    assert.equal(service.status().locked, true); assert.throws(() => service.list(), { code: "E_LOCKED" });
    assert.throws(() => service.copyPendingRecoveryKey(), { code: "E_LOCKED" });
    assert.ok(buffers.length >= 2); assert.ok(buffers.every((bytes) => bytes.every((value) => value === 0)));
    assert.deepEqual(locked, [{ reason: "system-lock" }]); assert.deepEqual(statuses, [{ exists: true, locked: true }]);
    assert.equal(completed, false); assert.equal(fake.pending(), 0);
    release.resolve(); await rejected; assert.deepEqual(await cleanup, {});
    assert.deepEqual(clipboard.writes.map((entry) => entry.value), [expected]); assert.equal(await clipboard.readText(), "");
    fake.advance(60000); await fake.settle(); assert.equal(await clipboard.readText(), ""); assert.equal(fake.pending(), 0);
  }
});

test("multiple queued service copies cannot write or reply successfully after a lock", async (context) => {
  const { service, clipboard, fake, id, fieldId } = await ready(context);
  const entered = deferred(); const release = deferred(); const write = clipboard.writeText;
  clipboard.writeText = async (value) => { entered.resolve(); await release.promise; return write(value); };
  const first = assert.rejects(service.copyField({ id, fieldId }), { code: "E_LOCKED" });
  await entered.promise;
  const second = assert.rejects(service.copyField({ id, fieldId }), { code: "E_LOCKED" });
  const third = assert.rejects(service.copyField({ id, fieldId }), { code: "E_LOCKED" });
  const cleanup = service.lock("window-closed");
  release.resolve(); await Promise.all([first, second, third]); assert.deepEqual(await cleanup, {});
  assert.equal(clipboard.writes.length, 1); assert.equal(await clipboard.readText(), ""); assert.equal(fake.pending(), 0);
});

test("service clipboard errors cannot prevent locking and the next quit cleanup retries ownership", async (context) => {
  const logs = [];
  const { service, clipboard, fake, id, fieldId } = await ready(context, { logger: (event, details) => logs.push({ event, details }) });
  await service.copyField({ id, fieldId });
  const read = clipboard.readText;
  clipboard.readText = async () => { throw Object.assign(new Error("Synthetic-Service-Never-Log-Message"), { code: "EACCES" }); };
  try {
    const cleanup = service.lock("manual"); assert.equal(service.status().locked, true); await assert.rejects(cleanup, { code: "EACCES" });
    assert.equal(await read(), "Synthetic-Service-Secret-A"); assert.equal(fake.pending(), 0);
    const failure = logs.filter((entry) => entry.event === "vault.clipboard.cleanup.failed");
    assert.deepEqual(failure, [{ event: "vault.clipboard.cleanup.failed", details: { errorCode: "E_IO" } }]);
    assert.equal(JSON.stringify(logs).includes("Synthetic-Service-Never-Log"), false);
  } finally {
    clipboard.readText = read; assert.deepEqual(await service.lock("app-quit"), {}); assert.equal(await read(), "");
  }
});

test("real service clipboard failure prevents application lifecycle shutdown until cleanup is retried", async (context) => {
  const logs = [];
  const { service, clipboard, fake, id, fieldId } = await ready(context, { logger: (event, details) => logs.push({ event, details }) });
  await service.copyField({ id, fieldId });
  const read = clipboard.readText; const sequence = []; const app = new EventEmitter();
  app.quit = () => sequence.push("quit");
  const lifecycle = installApplicationLifecycle({
    app, lockVault: (reason) => service.lock(reason),
    flushController: { request: async () => { sequence.push("flush"); return true; }, cancel: () => {} },
    shutdown: () => { sequence.push("shutdown"); service.closeDatabase(); },
    logger: { log: (event, details) => logs.push({ event, details }) }, onError: () => sequence.push("error"),
  });
  context.after(() => lifecycle.dispose());
  clipboard.readText = async () => { throw Object.assign(new Error("Synthetic-Lifecycle-Never-Log"), { code: "EACCES" }); };
  let prevented = 0;
  try {
    app.emit("before-quit", { preventDefault: () => { prevented += 1; } });
    assert.equal(service.status().locked, true); assert.equal(prevented, 1);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(lifecycle.permittingQuit, false); assert.deepEqual(sequence, ["error"]);
    assert.equal(await read(), "Synthetic-Service-Secret-A"); assert.equal(fake.pending(), 0);
    assert.equal(JSON.stringify(logs).includes("Synthetic-Lifecycle-Never-Log"), false);
    clipboard.readText = read;
    app.emit("before-quit", { preventDefault: () => { prevented += 1; } });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(prevented, 2); assert.equal(await read(), "");
    assert.deepEqual(sequence, ["error", "flush", "shutdown", "quit"]); assert.equal(lifecycle.permittingQuit, true);
  } finally {
    clipboard.readText = read; await service.lock("app-quit");
  }
});

test("an ignored system-event cleanup promise is handled without hiding its rejection", async (context) => {
  const { service, clipboard, id, fieldId } = await ready(context);
  await service.copyField({ id, fieldId });
  const read = clipboard.readText; const unhandled = [];
  const receive = (error) => unhandled.push(error);
  process.on("unhandledRejection", receive); context.after(() => process.removeListener("unhandledRejection", receive));
  clipboard.readText = async () => { throw Object.assign(new Error("Synthetic-System-Cleanup-Error"), { code: "EACCES" }); };
  try {
    const cleanup = service.lock("suspend");
    assert.equal(service.status().locked, true);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(unhandled, []); await assert.rejects(cleanup, { code: "EACCES" });
  } finally {
    clipboard.readText = read; await service.lock("app-quit");
  }
});

test("service clipboard deadlines preserve all four approved duration options exactly", async (context) => {
  const { service, clipboard, fake, id, fieldId } = await ready(context);
  for (const seconds of [10, 30, 60, 90]) {
    service.updateSettings({ patch: { clipboardClearSeconds: seconds } });
    assert.deepEqual(await service.copyField({ id, fieldId }), { clearsInSeconds: seconds });
    fake.advance(seconds * 1000 - 1); await fake.settle(); assert.equal(await clipboard.readText(), "Synthetic-Service-Secret-A");
    fake.advance(1); await fake.settle(); assert.equal(await clipboard.readText(), ""); assert.equal(service.status().locked, false);
  }
  await service.lock("app-quit"); assert.equal(fake.pending(), 0);
});

test("the service passes its ClipboardItem factory into the atomic guard", async (context) => {
  const { service, clipboard, id, fieldId } = await ready(context, { createClipboardItem });
  assert.deepEqual(await service.copyField({ id, fieldId }), { clearsInSeconds: 30 });
  assert.equal(clipboard.writes.length, 1); assert.equal(clipboard.writes[0].kind, "atomic");
  assert.deepEqual(clipboard.writes[0].entries[0].types, ["text/plain", EXCLUSION_FORMAT]);
  assert.deepEqual(Buffer.from(await (await clipboard.writes[0].entries[0].getType(EXCLUSION_FORMAT)).arrayBuffer()), Buffer.alloc(4));
  await service.lock("app-quit"); assert.equal(await clipboard.readText(), "");
});

test("a stale reveal confirmation cannot copy through a newly unlocked session", async (context) => {
  const entered = deferred(); const release = deferred();
  const { service, clipboard, id, fieldId } = await ready(context, { requestConfirmation: () => { entered.resolve(); return release.promise; } });
  service.updateSettings({ patch: { verifyBeforeReveal: true } });
  const rejected = assert.rejects(service.copyField({ id, fieldId }), { code: "E_LOCKED" });
  await entered.promise; await service.lock("system-lock"); await service.unlock({ password: TEST_PASSWORD });
  release.resolve("confirmed"); await rejected;
  assert.equal(service.status().locked, false); assert.equal(clipboard.writes.length, 0); assert.equal(await clipboard.readText(), "");
  await service.lock("app-quit");
});

test("reset finishes its original synchronous file transaction before awaiting clipboard cleanup", async (context) => {
  const { service, clipboard, fake, buffers, dataRoot, file, id, fieldId } = await ready(context);
  await service.copyField({ id, fieldId });
  const entered = deferred(); const release = deferred(); const read = clipboard.readText;
  clipboard.readText = async () => { entered.resolve(); await release.promise; return read(); };
  let completed = false;
  const resetting = service.resetVault({ confirmPhrase: "重置我的密钥库" }).then((value) => { completed = true; return value; });
  assert.equal(service.status().exists, false); assert.equal(service.status().locked, true); assert.equal(fs.existsSync(file), false);
  const snapshots = fs.readdirSync(path.join(dataRoot, "snapshots")); assert.equal(snapshots.length, 1);
  const snapshotRoot = path.join(dataRoot, "snapshots", snapshots[0]);
  assert.equal(fs.existsSync(path.join(snapshotRoot, "vault.db")), true);
  const metadata = JSON.parse(fs.readFileSync(path.join(snapshotRoot, "snapshot.json"), "utf8"));
  assert.equal(metadata.reason, "vault-reset"); assert.equal(metadata.counts.vaultItems, 1);
  assert.ok(buffers.every((bytes) => bytes.every((value) => value === 0))); assert.equal(fake.pending(), 0); assert.equal(completed, false);
  await entered.promise; release.resolve(); assert.deepEqual(await resetting, {}); assert.equal(await read(), "");
});

test("TOTP copy zeroes its decoded bytes after success rejection and locking", async (context) => {
  const expectedBytes = parseTotpSecret(RFC_SHA1_BASE32).secretBytes;
  const originalFrom = Buffer.from; const tracked = [];
  context.mock.method(Buffer, "from", function (value, ...options) {
    const bytes = originalFrom.call(Buffer, value, ...options);
    if (Array.isArray(value) && bytes.equals(expectedBytes)) tracked.push(bytes);
    return bytes;
  });
  context.after(() => expectedBytes.fill(0));
  for (const outcome of ["success", "reject", "lock"]) {
    const { service, clipboard, id, totpFieldId } = await ready(context);
    const entered = deferred(); const release = deferred(); const write = clipboard.writeText; const before = tracked.length;
    clipboard.writeText = async (value) => { entered.resolve(); await release.promise; if (outcome === "reject") throw Object.assign(new Error("Synthetic-TOTP-Write-Error"), { code: "EACCES" }); return write(value); };
    const copying = service.copyField({ id, fieldId: totpFieldId });
    const rejection = outcome === "success" ? null : assert.rejects(copying, { code: outcome === "lock" ? "E_LOCKED" : "EACCES" });
    await entered.promise;
    const cleanup = outcome === "lock" ? service.lock("system-lock") : null;
    release.resolve();
    if (rejection) await rejection; else assert.deepEqual(await copying, { clearsInSeconds: 30 });
    if (cleanup) await cleanup;
    const captured = tracked.slice(before); assert.ok(captured.length >= 1); assert.ok(captured.every((bytes) => bytes.every((value) => value === 0)));
    await service.lock("app-quit");
  }
});

test("TOTP decoded seed is zero before native clipboard IO settles", async (context) => {
  const { service, clipboard, id, totpFieldId } = await ready(context);
  const expectedBytes = parseTotpSecret(RFC_SHA1_BASE32).secretBytes;
  const originalFrom = Buffer.from; const tracked = [];
  context.mock.method(Buffer, "from", function (value, ...options) {
    const bytes = originalFrom.call(Buffer, value, ...options);
    if (Array.isArray(value) && bytes.equals(expectedBytes)) tracked.push(bytes);
    return bytes;
  });
  context.after(() => expectedBytes.fill(0));
  const entered = deferred(); const release = deferred(); const write = clipboard.writeText;
  clipboard.writeText = async (value) => { entered.resolve(); await release.promise; return write(value); };
  const copying = service.copyField({ id, fieldId: totpFieldId });
  copying.catch(() => {});
  try {
    await entered.promise;
    assert.ok(tracked.length >= 1); assert.ok(tracked.every((bytes) => bytes.every((value) => value === 0)));
    const cleanup = service.lock("system-lock");
    assert.ok(tracked.every((bytes) => bytes.every((value) => value === 0)));
    release.resolve(); await assert.rejects(copying, { code: "E_LOCKED" }); await cleanup;
  } finally {
    release.resolve(); await copying.catch(() => {}); await service.lock("app-quit");
  }
});
