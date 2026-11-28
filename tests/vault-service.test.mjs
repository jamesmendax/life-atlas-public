import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { KDF_PARAMS, deriveKeyArgon2id, aesGcmDecrypt, aadPasswordWrap } from "../electron/main/vault/crypto.js";
import { formatRecoveryKey, lastTwoGroups } from "../electron/main/vault/recoveryKey.js";
import { openItem } from "../electron/main/vault/itemCodec.js";
import * as store from "../electron/main/vault/vaultStore.js";
import { TEST_PASSWORD, NEXT_PASSWORD, createMarkers, createVaultTestContext, vaultItemInputs } from "./fixtures/vault-items.mjs";

async function ready(context, options) {
  const fixture = createVaultTestContext(context, options);
  const { recoveryKey } = await fixture.service.create({ password: TEST_PASSWORD });
  fixture.service.confirmRecoveryKey({ lastTwoGroups: lastTwoGroups(recoveryKey) });
  return { ...fixture, recoveryKey };
}

function insert(service, type = 0) { return service.createItem({ input: vaultItemInputs(createMarkers())[type] }).summary; }

function editSecret(service, id, value) {
  const item = service.getItem({ id }).item;
  const secret = item.fields.find((field) => field.sensitive);
  const fields = item.fields.map((field) => ({ id: field.id, label: field.label, kind: field.kind, sensitive: field.sensitive, ...(field.id === secret.id ? { value } : { keepValue: true }) }));
  service.updateItem({ id, patch: { fields } });
  return secret.id;
}

test("API keys derive expiry from localized date labels on create and edit", async (context) => {
  const { service } = await ready(context);
  const date = (label, value) => ({ label, kind: "date", sensitive: false, value });
  for (const label of ["到期日", "有効期限", "Expiry Date", "Expiration Date"]) {
    const fields = [date(label, "2027-03-15")];
    const { summary } = service.createItem({ input: { type: "apiKey", title: label, fields } });
    assert.equal(summary.expiresAt, "2027-03-15");
    const { id: fieldId } = service.getItem({ id: summary.id }).item.fields[0];
    const updated = service.updateItem({ id: summary.id, patch: { fields: [{ id: fieldId, ...date(label, "2027-04-16") }] } });
    assert.equal(updated.summary.expiresAt, "2027-04-16");
  }
  const fields = [date("Expiry Date", "2027-05-01"), date("到期日", "2027-06-01")];
  assert.equal(service.createItem({ input: { type: "apiKey", title: "Canonical date", fields } }).summary.expiresAt, "2027-06-01");
  assert.equal(service.createItem({ input: { type: "apiKey", title: "Explicit date", fields, expiresAt: null } }).summary.expiresAt, null);
});

test("create lock unlock round trip with official parameters", async (context) => {
  const { service } = await ready(context, { kdfParams: KDF_PARAMS });
  const ids = vaultItemInputs().map((input) => service.createItem({ input }).summary.id);
  const before = ids.map((id) => service.getItem({ id }).item);
  const exported = service.exportCiphertext();
  assert.deepEqual(Object.keys(exported.header).sort(), ["createdAt", "formatVersion", "kdf", "kind", "padding", "vaultId", "wraps"]);
  assert.deepEqual({ ...exported.header.kdf, saltB64: undefined }, { ...KDF_PARAMS, saltB64: undefined });
  service.lock(); assert.throws(() => service.list(), { code: "E_LOCKED" });
  const unlocked = await service.unlock({ password: TEST_PASSWORD }); assert.equal(unlocked.requiresRecoveryKeyRegeneration, false);
  assert.deepEqual(ids.map((id) => service.getItem({ id }).item), before);
  assert.equal(unlocked.summaries.length, 7);
});

test("create starts in the recovery unconfirmed state", async (context) => {
  const { service } = createVaultTestContext(context);
  const { recoveryKey } = await service.create({ password: TEST_PASSWORD });
  assert.equal(service.status().recoveryConfirmed, false);
  assert.throws(() => service.list(), { code: "E_LOCKED", reason: "recovery-unconfirmed" });
  assert.throws(() => service.createItem({ input: vaultItemInputs()[0] }), { code: "E_LOCKED" });
  assert.throws(() => service.confirmRecoveryKey({ lastTwoGroups: "WRONG-WRONG" }), { code: "E_INVALID_ARGUMENT" });
  service.confirmRecoveryKey({ lastTwoGroups: lastTwoGroups(recoveryKey) }); assert.deepEqual(service.list(), { summaries: [] });
});

test("unlock after a restart without confirmation requires regeneration", async (context) => {
  const { service, open } = createVaultTestContext(context);
  await service.create({ password: TEST_PASSWORD }); service.lock(); service.closeDatabase();
  const restarted = open(); const result = await restarted.unlock({ password: TEST_PASSWORD });
  assert.equal(result.requiresRecoveryKeyRegeneration, true); assert.deepEqual(result.summaries, []);
  assert.throws(() => restarted.list(), { code: "E_LOCKED" });
  const next = await restarted.regenerateRecoveryKey({ password: TEST_PASSWORD }); restarted.confirmRecoveryKey({ lastTwoGroups: lastTwoGroups(next.recoveryKey) });
  assert.deepEqual(restarted.list().summaries, []);
});

test("tampering with an item blob affects only that item", async (context) => {
  const { service, file } = await ready(context); const first = insert(service); const second = insert(service, 1);
  const db = store.openVaultDatabase(file); const blob = store.getItemBlob(db, first.id); blob[50] ^= 1; store.putItemBlob(db, first.id, blob); db.close();
  assert.throws(() => service.getItem({ id: first.id }), { code: "E_CORRUPT", message: "条目已损坏，无法解密" });
  assert.equal(service.getItem({ id: second.id }).item.id, second.id);
  service.lock(); await service.unlock({ password: TEST_PASSWORD }); assert.equal(service.list().summaries.length, 1);
});

test("swapping two blobs breaks both", async (context) => {
  const { service, file } = await ready(context); const first = insert(service); const second = insert(service, 1);
  const db = store.openVaultDatabase(file); const firstBlob = store.getItemBlob(db, first.id); const secondBlob = store.getItemBlob(db, second.id);
  store.inTransaction(db, () => { store.putItemBlob(db, first.id, secondBlob); store.putItemBlob(db, second.id, firstBlob); }); db.close();
  for (const id of [first.id, second.id]) assert.throws(() => service.getItem({ id }), { code: "E_CORRUPT" });
});

test("tampering with the header fails unlock", async (context) => {
  const { service, file } = await ready(context); const original = service.exportCiphertext().header; service.lock();
  const db = store.openVaultDatabase(file); store.writeHeader(db, { ...original, kdf: { ...original.kdf, memoryKiB: 16384 } }); db.close();
  await assert.rejects(service.unlock({ password: TEST_PASSWORD }), { code: "E_BAD_PASSWORD" });
  const second = store.openVaultDatabase(file); const modified = structuredClone(original); const bytes = Buffer.from(modified.wraps.password.blobB64, "base64"); bytes[15] ^= 1;
  modified.wraps.password.blobB64 = bytes.toString("base64"); store.writeHeader(second, modified); second.close();
  await assert.rejects(service.unlock({ password: TEST_PASSWORD }), { code: "E_BAD_PASSWORD" });
});

test("throttling follows the formula and skips the kdf", async (context) => {
  let calls = 0;
  const fixture = await ready(context, { deriveKey: async (...args) => { calls += 1; return deriveKeyArgon2id(...args); } });
  const { service, fake, open } = fixture; service.lock();
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    await assert.rejects(service.unlock({ password: "wrong-password" }), { code: "E_BAD_PASSWORD" });
    const wait = attempt < 5 ? 0 : Math.min(30000 * 2 ** (attempt - 5), 900000);
    assert.equal(service.status().retryAfterMs || 0, wait);
    if (wait) {
      const before = calls;
      await assert.rejects(service.unlock({ password: TEST_PASSWORD }), { code: "E_THROTTLED", retryAfterMs: wait }); assert.equal(calls, before);
      if (attempt < 10) fake.advance(wait);
    }
  }
  service.closeDatabase(); const restarted = open(); const before = calls;
  await assert.rejects(restarted.unlock({ password: TEST_PASSWORD }), { code: "E_THROTTLED", retryAfterMs: 900000 }); assert.equal(calls, before);
  fake.advance(900000); await restarted.unlock({ password: TEST_PASSWORD }); assert.equal(restarted.status().retryAfterMs, null);
});

test("recovery key paths", async (context) => {
  const { service, recoveryKey } = await ready(context); insert(service); service.lock();
  assert.throws(() => service.unlockWithRecoveryKey({ recoveryKey: recoveryKey.slice(0, -1) + (recoveryKey.endsWith("0") ? "1" : "0"), newPassword: NEXT_PASSWORD }), { code: "E_INVALID_ARGUMENT" });
  await assert.rejects(service.unlockWithRecoveryKey({ recoveryKey: formatRecoveryKey(randomBytes(32)), newPassword: NEXT_PASSWORD }), { code: "E_BAD_PASSWORD" });
  const result = await service.unlockWithRecoveryKey({ recoveryKey, newPassword: NEXT_PASSWORD });
  assert.notEqual(result.recoveryKey, recoveryKey); assert.equal(service.status().recoveryConfirmed, false);
  service.confirmRecoveryKey({ lastTwoGroups: lastTwoGroups(result.recoveryKey) }); assert.equal(service.list().summaries.length, 1);
});

test("changing the password rotates keys", async (context) => {
  const { service, recoveryKey } = await ready(context); const id = insert(service).id; const before = service.getItem({ id }).item;
  const changed = await service.changePassword({ currentPassword: TEST_PASSWORD, newPassword: NEXT_PASSWORD }); service.confirmRecoveryKey({ lastTwoGroups: lastTwoGroups(changed.recoveryKey) });
  service.lock(); await assert.rejects(service.unlock({ password: TEST_PASSWORD }), { code: "E_BAD_PASSWORD" }); await service.unlock({ password: NEXT_PASSWORD });
  assert.deepEqual(service.getItem({ id }).item, before); service.lock();
  await assert.rejects(service.unlockWithRecoveryKey({ recoveryKey, newPassword: TEST_PASSWORD }), { code: "E_BAD_PASSWORD" });
  const recovered = await service.unlockWithRecoveryKey({ recoveryKey: changed.recoveryKey, newPassword: TEST_PASSWORD }); service.confirmRecoveryKey({ lastTwoGroups: lastTwoGroups(recovered.recoveryKey) });
  assert.deepEqual(service.getItem({ id }).item, before);
});

test("old wraps cannot decrypt rotated items", async (context) => {
  const { service, dataRoot } = await ready(context); vaultItemInputs().forEach((input) => service.createItem({ input }));
  const snapshot = path.join(dataRoot, "before.db"); service.snapshotTo(snapshot);
  const oldDb = store.openVaultDatabase(snapshot); const oldHeader = store.readHeader(oldDb); oldDb.close();
  const kek = await deriveKeyArgon2id(TEST_PASSWORD, Buffer.from(oldHeader.kdf.saltB64, "base64"), oldHeader.kdf);
  const oldDek = aesGcmDecrypt(kek, Buffer.from(oldHeader.wraps.password.blobB64, "base64"), aadPasswordWrap(oldHeader.vaultId, oldHeader.kdf)); kek.fill(0);
  await service.changePassword({ currentPassword: TEST_PASSWORD, newPassword: NEXT_PASSWORD });
  for (const item of service.exportCiphertext().items) assert.throws(() => openItem(oldDek, oldHeader.vaultId, item.id, Buffer.from(item.blobB64, "base64")), { code: "E_CORRUPT" });
  oldDek.fill(0);
});

test("a failed rotation leaves the vault byte for byte unchanged", async (context) => {
  let failing = false;
  const { service, file, open } = await ready(context, { injectFailure: (name) => { if (failing && name === "vault-rotate") throw new Error("injected"); } });
  vaultItemInputs().forEach((input) => service.createItem({ input }));
  service.closeDatabase(); const before = fs.readFileSync(file); service.reopenDatabase(); failing = true;
  await assert.rejects(service.changePassword({ currentPassword: TEST_PASSWORD, newPassword: NEXT_PASSWORD }), { code: "E_IO" });
  service.lock(); service.closeDatabase(); assert.deepEqual(fs.readFileSync(file), before);
  const restarted = open(); await restarted.unlock({ password: TEST_PASSWORD }); assert.equal(restarted.list().summaries.length, 7);
});

test("idle and system idle both lock the vault", async (context) => {
  let systemIdle = 0;
  let observedDek;
  const { service, fake } = await ready(context, { getSystemIdleSeconds: () => systemIdle, randomBytes: (length) => { const bytes = randomBytes(length); if (length === 32 && !observedDek) observedDek = bytes; return bytes; } });
  insert(service); fake.advance(300000); assert.equal(service.status().locked, true); assert.ok(observedDek.every((byte) => byte === 0));
  assert.throws(() => service.list(), { code: "E_LOCKED" });
  await service.unlock({ password: TEST_PASSWORD }); service.activity(); systemIdle = 301; fake.advance(15000); assert.equal(service.status().locked, true);
});

test("history keeps ten values per sensitive field", async (context) => {
  const { service } = await ready(context); const id = insert(service).id; let fieldId;
  for (let iteration = 0; iteration < 12; iteration += 1) fieldId = editSecret(service, id, `changed-${iteration}`);
  const entries = service.getHistory({ id, fieldId }).entries; assert.equal(entries.length, 10);
  assert.equal((await service.revealHistory({ id, fieldId, index: 0 })).value, "changed-1");
  assert.ok(!JSON.stringify(service.getItem({ id })).includes("changed-"));
});

test("trash older than thirty days is purged on unlock", async (context) => {
  const { service, fake } = await ready(context); const first = insert(service).id; service.trashItem({ id: first }); fake.advance(2 * 86400000);
  await service.unlock({ password: TEST_PASSWORD }); const second = insert(service).id; service.trashItem({ id: second }); fake.advance(29 * 86400000);
  await service.unlock({ password: TEST_PASSWORD }); assert.throws(() => service.getItem({ id: first }), { code: "E_NOT_FOUND" }); assert.ok(service.getItem({ id: second }).item.deletedAt);
});

test("summaries never include sensitive values", async (context) => {
  const { service } = await ready(context); const input = vaultItemInputs()[0]; input.fields[0].sensitive = true; const id = service.createItem({ input }).summary.id;
  const item = service.getItem({ id }).item; const secretField = item.fields.find((field) => field.kind === "secret");
  service.updateItem({ id, patch: { subtitleFieldId: secretField.id } });
  const summary = service.list().summaries[0]; assert.equal(summary.subtitle, null); assert.equal(summary.host, null);
  for (const field of input.fields.filter((entry) => entry.sensitive)) assert.ok(!JSON.stringify(summary).includes(field.value));
  for (const field of item.fields.filter((entry) => entry.sensitive)) assert.equal(Object.hasOwn(field, "value"), false);
});

test("reset moves the vault into a snapshot and keeps it usable", async (context) => {
  const { service, dataRoot, open } = await ready(context, { appVersion: "0.1.0" }); insert(service); service.lock();
  assert.throws(() => service.resetVault({ confirmPhrase: "wrong" }), { code: "E_INVALID_ARGUMENT" });
  service.resetVault({ confirmPhrase: "重置我的密钥库" }); assert.equal(service.status().exists, false);
  const snapshots = fs.readdirSync(path.join(dataRoot, "snapshots")); assert.equal(snapshots.length, 1); assert.match(snapshots[0], /vault-reset$/);
  const metadata = JSON.parse(fs.readFileSync(path.join(dataRoot, "snapshots", snapshots[0], "snapshot.json"), "utf8")); assert.equal(metadata.includesVault, true); assert.equal(metadata.includesWorkspace, false);
  const archivedBytes = fs.readFileSync(path.join(dataRoot, "snapshots", snapshots[0], "vault.db"));
  assert.equal(metadata.appVersion, "0.1.0"); assert.deepEqual(metadata.counts, { vaultItems: 1 }); assert.equal(metadata.sizeBytes, archivedBytes.length);
  assert.deepEqual(metadata.files, [{ name: "vault.db", size: archivedBytes.length, sha256: createHash("sha256").update(archivedBytes).digest("hex") }]);
  const archived = open({ dataRoot: path.join(dataRoot, "snapshots", snapshots[0]) }); await archived.unlock({ password: TEST_PASSWORD }); assert.equal(archived.list().summaries.length, 1);
});

test("a reset metadata failure restores the original vault byte for byte", async (context) => {
  const { service, file, dataRoot } = await ready(context); insert(service); service.closeDatabase();
  const before = fs.readFileSync(file); service.reopenDatabase();
  const writeFile = fs.writeFileSync;
  fs.writeFileSync = (target, ...args) => {
    if (path.basename(String(target)) === "snapshot.json") throw new Error("injected metadata failure");
    return writeFile(target, ...args);
  };
  try { assert.throws(() => service.resetVault({ confirmPhrase: "重置我的密钥库" }), { code: "E_IO" }); }
  finally { fs.writeFileSync = writeFile; }
  assert.equal(service.status().exists, true); assert.equal(service.status().locked, true); assert.deepEqual(fs.readFileSync(file), before);
  assert.deepEqual(fs.readdirSync(path.join(dataRoot, "snapshots")), []);
  await service.unlock({ password: TEST_PASSWORD }); assert.equal(service.list().summaries.length, 1);
});

test("settings are validated and persisted", async (context) => {
  const { service, open } = await ready(context);
  for (const patch of [{ autoLockMinutes: 2 }, { clipboardClearSeconds: 15 }, { verifyBeforeReveal: 1 }, { unexpected: true }]) assert.throws(() => service.updateSettings({ patch }), { code: "E_INVALID_ARGUMENT" });
  const expected = service.updateSettings({ patch: { autoLockMinutes: 15, clipboardClearSeconds: 60, lockOnMinimize: true, verifyBeforeReveal: true } }).settings;
  service.lock(); service.closeDatabase(); assert.deepEqual(open().status().settings, expected);
});

test("a system lock during derivation cannot restore an unlocked key", async (context) => {
  let release;
  let deferred = false;
  const { service } = await ready(context, { deriveKey: async (...args) => { const key = await deriveKeyArgon2id(...args); if (deferred) await new Promise((resolve) => { release = resolve; }); return key; } });
  service.lock(); deferred = true;
  const pending = service.unlock({ password: TEST_PASSWORD });
  while (!release) await new Promise((resolve) => setTimeout(resolve, 5));
  service.lock("system-lock"); release(); await assert.rejects(pending, { code: "E_LOCKED" }); assert.equal(service.status().locked, true);
});
