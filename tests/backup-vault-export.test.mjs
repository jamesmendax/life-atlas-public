import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createBackupService } from "../electron/main/backup/index.js";
import { createDialogs } from "../electron/main/dialogs.js";
import { openZipFileReader } from "../electron/main/backup/zipNode.js";
import { createDesktopBackupContext, backupVaultFactory, seedBackupVault, fastBackupDeriveKey } from "./desktop/backup-helpers.mjs";
import { TEST_PASSWORD } from "./fixtures/vault-items.mjs";

async function fixture(context, extra = {}) {
  const value = await createDesktopBackupContext(context, { vaultService: backupVaultFactory() });
  const seeded = await seedBackupVault(value.vaultService);
  const dialogs = createDialogs({ testHooksEnabled: true });
  const filePath = path.join(value.dataRoot, "with-vault.lifeatlas");
  dialogs.state.queue.showSaveDialog.push(filePath);
  const service = createBackupService({ ...value, deriveKey: fastBackupDeriveKey, dialogs, requestFlush: async () => true, requestConfirmation: async () => "confirmed", ...extra });
  context.after(() => service.stop());
  return { ...value, seeded, dialogs, filePath, service };
}

test("vault ciphertext is copied without decryption", async (context) => {
  const value = await fixture(context);
  const ciphertext = value.vaultService.exportCiphertext();
  let openedItems = 0;
  value.vaultService.getItem = () => { openedItems += 1; throw new Error("item decryption forbidden during export"); };
  value.vaultService.revealField = () => { openedItems += 1; throw new Error("field decryption forbidden during export"); };
  value.vaultService.openItem = () => { openedItems += 1; throw new Error("item decryption forbidden during export"); };
  await value.service.exportFull({ includeVault: true, encryptPassword: null });
  assert.equal(openedItems, 0);
  const reader = await openZipFileReader(value.filePath);
  const db = new DatabaseSync(path.join(value.dataRoot, "vault.db"), { readOnly: true });
  try {
    const exported = JSON.parse(Buffer.from(await reader.read("vault/vault.json")).toString("utf8"));
    assert.deepEqual(exported.header, ciphertext.header);
    assert.deepEqual(exported.header, JSON.parse(db.prepare("SELECT json FROM vault_header WHERE id=1").get().json));
    assert.deepEqual(exported.state.settings, ciphertext.settings);
    const rows = db.prepare("SELECT id,blob FROM vault_items ORDER BY id").all();
    assert.equal(rows.length, 10);
    assert.deepEqual(exported.items.map((entry) => entry.id), rows.map((entry) => entry.id));
    for (const [index, row] of rows.entries()) assert.deepEqual(Buffer.from(exported.items[index].blobB64, "base64"), Buffer.from(row.blob));
  } finally { db.close(); reader.close(); await value.service.stop(); }
});

test("export with vault requires a confirmed request", async (context) => {
  for (const outcome of ["cancelled", "expired"]) {
    const requests = [];
    const value = await fixture(context, { requestConfirmation: async (args) => { requests.push(args); return outcome; } });
    await assert.rejects(value.service.exportFull({ includeVault: true, encryptPassword: null }), { code: "E_CANCELLED" });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].kind, "export-backup");
    assert.equal(value.dialogs.state.calls.filter((call) => call.kind === "showSaveDialog").length, 0);
    assert.equal(fs.existsSync(value.filePath), false);
    await value.service.stop();
  }
});

test("export is refused while the recovery key is unconfirmed", async (context) => {
  const value = await createDesktopBackupContext(context, { vaultService: backupVaultFactory() });
  await value.vaultService.create({ password: TEST_PASSWORD });
  const dialogs = createDialogs({ testHooksEnabled: true });
  const filePath = path.join(value.dataRoot, "unconfirmed.lifeatlas");
  dialogs.state.queue.showSaveDialog.push(filePath);
  const service = createBackupService({ ...value, dialogs, requestConfirmation: async () => "confirmed" });
  try {
    await assert.rejects(service.exportFull({ includeVault: true, encryptPassword: null }), { code: "E_LOCKED", message: "recovery-unconfirmed" });
    assert.equal(fs.existsSync(filePath), false);
    assert.equal(dialogs.state.calls.length, 0);
  } finally { await service.stop(); }
});

test("manifest records the vault", async (context) => {
  const value = await fixture(context);
  try {
    const { manifest } = await value.service.exportFull({ includeVault: true, encryptPassword: null });
    assert.deepEqual(manifest.vault, { included: true, vaultId: value.vaultService.exportCiphertext().header.vaultId, formatVersion: 1, itemCount: 10 });
    assert.equal(manifest.files.filter((entry) => entry.path === "vault/vault.json").length, 1);
    assert.equal(value.vaultService.exportCiphertext().header.kdf.memoryKiB, 131072);
  } finally { await value.service.stop(); }
});
