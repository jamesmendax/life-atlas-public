import test from "node:test";
import assert from "node:assert/strict";
import { KDF_PARAMS, validateVaultHeader } from "../electron/main/vault/index.js";

function validHeader() {
  return {
    kind: "life-atlas-vault", formatVersion: 1, vaultId: "11111111-1111-4111-8111-111111111111", createdAt: "2026-11-07T00:00:00.000Z", padding: 512,
    kdf: { ...KDF_PARAMS, saltB64: Buffer.alloc(16, 1).toString("base64") },
    wraps: {
      password: { alg: "A256GCM", blobB64: Buffer.alloc(60, 2).toString("base64") },
      recovery: { alg: "A256GCM", kdf: "hkdf-sha256", saltB64: Buffer.alloc(16, 3).toString("base64"), blobB64: Buffer.alloc(60, 4).toString("base64") },
    },
  };
}

test("vault headers require the official format and kdf", () => {
  const header = validHeader();
  assert.equal(validateVaultHeader(header), true);
  for (const patch of [{ kind: "other" }, { formatVersion: 2 }, { padding: 256 }, { vaultId: "not-a-uuid" }, { createdAt: "invalid" }, { createdAt: 0 }]) assert.equal(validateVaultHeader({ ...header, ...patch }), false);
  for (const patch of [{ alg: "argon2i" }, { version: 16 }, { memoryKiB: 8192 }, { iterations: 2 }, { parallelism: 2 }]) assert.equal(validateVaultHeader({ ...header, kdf: { ...header.kdf, ...patch } }), false);
  assert.equal(validateVaultHeader(null), false);
});

test("vault headers reject malformed salts and wraps", () => {
  for (const saltB64 of ["invalid", Buffer.alloc(15).toString("base64"), validHeader().kdf.saltB64.replace(/=+$/, "")]) {
    const header = validHeader(); header.kdf.saltB64 = saltB64; assert.equal(validateVaultHeader(header), false);
  }
  for (const key of ["password", "recovery"]) {
    const header = validHeader(); header.wraps[key].blobB64 = Buffer.alloc(59).toString("base64"); assert.equal(validateVaultHeader(header), false);
    header.wraps[key].blobB64 = Buffer.alloc(60).toString("base64"); header.wraps[key].alg = "other"; assert.equal(validateVaultHeader(header), false);
  }
  const header = validHeader(); header.wraps.recovery.kdf = "other"; assert.equal(validateVaultHeader(header), false);
});
