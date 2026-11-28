import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createBackupService } from "../electron/main/backup/index.js";
import { createDialogs } from "../electron/main/dialogs.js";
import { sha256File } from "../electron/main/backup/files.js";
import { requiredCollections } from "../src/backup/format.js";
import { sortedEntities } from "./fixtures/backup-helpers.mjs";
import { NEXT_PASSWORD } from "./fixtures/vault-items.mjs";
import { createDesktopBackupContext, backupVaultFactory, seedBackupVault, readBackupVaultState, fastBackupDeriveKey } from "./desktop/backup-helpers.mjs";

function serviceFor(value) {
  const dialogs = createDialogs({ testHooksEnabled: true });
  const service = createBackupService({ ...value, dialogs, deriveKey: fastBackupDeriveKey, requestFlush: async () => true, requestConfirmation: async () => "confirmed" });
  return { service, dialogs };
}

async function fixture(context, { production = false, existingVault = false } = {}) {
  const source = await createDesktopBackupContext(context, { vaultService: backupVaultFactory({ production }) });
  const seeded = await seedBackupVault(source.vaultService);
  const sourceBackup = serviceFor(source);
  const filePath = path.join(source.dataRoot, "full-backup.lifeatlas");
  sourceBackup.dialogs.state.queue.showSaveDialog.push(filePath);
  await sourceBackup.service.exportFull({ includeVault: true, encryptPassword: null });
  await sourceBackup.service.stop();
  const destination = await createDesktopBackupContext(context, { seed: false, vaultService: backupVaultFactory({ production }) });
  const oldSeed = existingVault ? await seedBackupVault(destination.vaultService) : null;
  const backup = serviceFor(destination);
  context.after(() => backup.service.stop());
  const inspected = await backup.service.inspectFile(filePath);
  return { source, destination, seeded, oldSeed, filePath, service: backup.service, token: inspected.token };
}

function assertWorkspaceEqual(actual, expected) {
  for (const collection of requiredCollections(expected.schemaVersion)) assert.deepEqual(sortedEntities(actual[collection]), sortedEntities(expected[collection]), collection);
  assert.deepEqual(actual.ui, expected.ui);
  assert.equal(actual.workspaceId, expected.workspaceId);
  assert.equal(actual.savedAt, expected.savedAt);
}

test("vault restore round trips every item", async (context) => {
  const value = await fixture(context, { production: true });
  const expected = await readBackupVaultState(value.source.vaultService, value.seeded.ids);
  assert.equal(expected.items.length, 10);
  assert.equal(value.source.vaultService.exportCiphertext().header.kdf.memoryKiB, 131072);
  const generation = value.destination.workspaceService.getMeta("generation");
  await value.service.restore({ token: value.token, restoreVault: true });
  assert.equal(value.destination.vaultService.status().locked, true);
  const unlocked = await value.destination.vaultService.unlock({ password: value.seeded.password });
  assert.equal(unlocked.requiresRecoveryKeyRegeneration, false);
  assert.deepEqual(await readBackupVaultState(value.destination.vaultService, value.seeded.ids), expected);
  assertWorkspaceEqual(value.destination.workspaceService.readWorkspace(), value.source.workspaceService.readWorkspace());
  assert.notEqual(value.destination.workspaceService.getMeta("generation"), generation);
  for (const asset of value.source.assetStore.list()) assert.deepEqual(await sha256File(value.destination.assetStore.filePath(asset.sha256)), await sha256File(value.source.assetStore.filePath(asset.sha256)));
  context.diagnostic("WP08_PRODUCTION_KDF_MEMORY_KIB=131072; original and restored vaults use the real production derivation");
  await value.service.stop();
});

test("the recovery key also unlocks the restored vault", async (context) => {
  const value = await fixture(context);
  const expected = await readBackupVaultState(value.source.vaultService, value.seeded.ids);
  await value.service.restore({ token: value.token, restoreVault: true });
  const changed = await value.destination.vaultService.unlockWithRecoveryKey({ recoveryKey: value.seeded.recoveryKey, newPassword: NEXT_PASSWORD });
  value.destination.vaultService.confirmRecoveryKey({ lastTwoGroups: changed.recoveryKey.split("-").slice(-2).join("-") });
  assert.deepEqual(await readBackupVaultState(value.destination.vaultService, value.seeded.ids), expected);
  await value.service.stop();
});

test("restoring over an existing vault keeps the old one in the pre-restore snapshot", async (context) => {
  const value = await fixture(context, { existingVault: true });
  const oldCiphertext = value.destination.vaultService.exportCiphertext();
  const expectedOld = await readBackupVaultState(value.destination.vaultService, value.oldSeed.ids);
  await value.service.restore({ token: value.token, restoreVault: true });
  const snapshot = value.destination.snapshotService.listSnapshots().find((entry) => entry.reason === "pre-restore");
  assert.equal(snapshot.includesWorkspace, true);
  assert.equal(snapshot.includesVault, true);
  const db = new DatabaseSync(path.join(value.destination.dataRoot, "snapshots", snapshot.id, "vault.db"), { readOnly: true });
  try {
    assert.deepEqual(JSON.parse(db.prepare("SELECT json FROM vault_header WHERE id=1").get().json), oldCiphertext.header);
    assert.deepEqual(db.prepare("SELECT id,blob FROM vault_items ORDER BY id").all().map((entry) => ({ id: entry.id, blobB64: Buffer.from(entry.blob).toString("base64") })), oldCiphertext.items);
  } finally { db.close(); }
  value.destination.workspaceService.checkpoint();
  const before = await sha256File(value.destination.workspaceService.filePath);
  await value.service.restoreSnapshot({ id: snapshot.id, restoreWorkspace: false, restoreVault: true });
  assert.deepEqual(await sha256File(value.destination.workspaceService.filePath), before);
  await value.destination.vaultService.unlock({ password: value.oldSeed.password });
  assert.deepEqual(await readBackupVaultState(value.destination.vaultService, value.oldSeed.ids), expectedOld);
  await value.service.stop();
});

test("throttle counters are reset by restore", async (context) => {
  const value = await fixture(context, { existingVault: true });
  for (let attempt = 0; attempt < 5; attempt += 1) assert.equal(await value.destination.vaultService.verifyPassword("wrong-master-credential"), false);
  assert.ok(value.destination.vaultService.status().retryAfterMs > 0);
  assert.equal(value.destination.vaultService.status().retryAfterMs, 30000);
  await value.service.restore({ token: value.token, restoreVault: true });
  const db = new DatabaseSync(path.join(value.destination.dataRoot, "vault.db"), { readOnly: true });
  try {
    assert.equal(db.prepare("SELECT value FROM vault_state WHERE key='failedAttempts'").get().value, "0");
    assert.equal(db.prepare("SELECT value FROM vault_state WHERE key='lockoutUntil'").get().value, "");
    assert.equal(db.prepare("SELECT value FROM vault_state WHERE key='recoveryConfirmed'").get().value, "true");
  } finally { db.close(); }
  assert.equal(value.destination.vaultService.status().retryAfterMs, null);
  await value.service.stop();
});

test("restoring a vault reset snapshot brings the old vault back", async (context) => {
  const value = await createDesktopBackupContext(context, { vaultService: backupVaultFactory() });
  const seeded = await seedBackupVault(value.vaultService);
  const expected = await readBackupVaultState(value.vaultService, seeded.ids);
  value.vaultService.resetVault({ confirmPhrase: "重置我的密钥库" });
  assert.equal(value.vaultService.status().exists, false);
  const snapshot = value.snapshotService.listSnapshots().find((entry) => entry.reason === "vault-reset");
  const { service } = serviceFor(value);
  try {
    await assert.rejects(service.restoreSnapshot({ id: snapshot.id, restoreWorkspace: true, restoreVault: true }), { code: "E_INVALID_ARGUMENT" });
    await service.restoreSnapshot({ id: snapshot.id, restoreWorkspace: false, restoreVault: true });
    await value.vaultService.unlock({ password: seeded.password });
    assert.deepEqual(await readBackupVaultState(value.vaultService, seeded.ids), expected);
  } finally { await service.stop(); }
});

test("a failure during paired database swap preserves both original databases", async (context) => {
  const value = await fixture(context, { existingVault: true });
  value.destination.workspaceService.checkpoint();
  value.destination.vaultService.closeDatabase();
  value.destination.vaultService.reopenDatabase();
  const originalWorkspace = await sha256File(value.destination.workspaceService.filePath);
  const originalVault = await sha256File(path.join(value.destination.dataRoot, "vault.db"));
  let swaps = 0;
  await assert.rejects(value.service.restoreToken(value.token, { restoreVault: true, injectFailure: () => { if (++swaps === 2) throw Object.assign(new Error("injected second swap failure"), { code: "E_IO" }); } }), { code: "E_IO" });
  assert.deepEqual(await sha256File(value.destination.workspaceService.filePath), originalWorkspace);
  assert.deepEqual(await sha256File(path.join(value.destination.dataRoot, "vault.db")), originalVault);
  await value.destination.vaultService.unlock({ password: value.oldSeed.password });
  assert.equal(value.destination.vaultService.list().summaries.length, 10);
  await value.service.stop();
});
