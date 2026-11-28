import test from "node:test";
import assert from "node:assert/strict";
import { validateVaultBackupHeader, validateVaultExport } from "../src/backup/verify.js";
import { validateVaultHeader } from "../electron/main/vault/vaultService.js";

function headerFixture() {
  return {
    kind: "life-atlas-vault", formatVersion: 1, vaultId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", padding: 512, createdAt: "2026-10-02T00:00:00.000Z",
    kdf: { alg: "argon2id", version: 19, memoryKiB: 131072, iterations: 3, parallelism: 1, saltB64: Buffer.alloc(16, 1).toString("base64") },
    wraps: { password: { alg: "A256GCM", blobB64: Buffer.alloc(60, 2).toString("base64") }, recovery: { alg: "A256GCM", kdf: "hkdf-sha256", saltB64: Buffer.alloc(16, 3).toString("base64"), blobB64: Buffer.alloc(60, 4).toString("base64") } },
  };
}

test("browser backup vault header checks agree with the authoritative vault validator", () => {
  assert.equal(validateVaultBackupHeader(headerFixture()), true);
  for (const mutate of [
    (header) => { header.kind = "wrong"; },
    (header) => { header.vaultId = "not-a-uuid"; },
    (header) => { header.createdAt = "not-a-date"; },
    (header) => { header.padding = 0; },
    (header) => { header.kdf.memoryKiB = 8192; },
    (header) => { header.kdf.iterations = 1; },
    (header) => { header.kdf.saltB64 = "AQ=="; },
    (header) => { header.wraps.password.alg = "unknown"; },
    (header) => { header.wraps.password.blobB64 = "A".repeat(80) + "\n"; },
    (header) => { header.wraps.recovery.kdf = "unknown"; },
    (header) => { header.wraps.recovery.saltB64 = "AZ=="; },
    (header) => { header.wraps.recovery.blobB64 = "AQ=="; },
  ]) {
    const header = headerFixture();
    mutate(header);
    assert.equal(validateVaultBackupHeader(header), validateVaultHeader(header));
    assert.equal(validateVaultBackupHeader(header), false);
  }
});

test("vault export rejects duplicate IDs and noncanonical or short ciphertext", () => {
  const header = headerFixture();
  const item = { id: "vi_synthetic", blobB64: Buffer.alloc(540, 5).toString("base64") };
  const vault = { kind: "life-atlas-vault-export", formatVersion: 1, header, items: [item], state: { settings: {} } };
  const manifest = { vault: { included: true, vaultId: header.vaultId, itemCount: 1 } };
  assert.equal(validateVaultExport(vault, manifest), true);
  assert.equal(validateVaultExport({ ...vault, items: [item, item] }, { vault: { ...manifest.vault, itemCount: 2 } }), false);
  for (const blobB64 of ["", "AQ==", `${item.blobB64}\n`, `${"AAAA".repeat(9)}AZ==`]) assert.equal(validateVaultExport({ ...vault, items: [{ ...item, blobB64 }] }, manifest), false);
});
