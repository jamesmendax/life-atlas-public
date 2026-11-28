import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { Worker } from "node:worker_threads";
import { VaultError } from "./errors.js";

export const KDF_PARAMS = Object.freeze({ alg: "argon2id", version: 19, memoryKiB: 131072, iterations: 3, parallelism: 1 });

export async function deriveKeyArgon2id(password, salt, params = KDF_PARAMS) {
  if (typeof password !== "string" || !Buffer.isBuffer(salt) || salt.length < 8) {
    throw new VaultError("E_INVALID_ARGUMENT", "口令派生参数不正确");
  }
  const passwordBytes = Buffer.from(password.normalize("NFKC"), "utf8");
  const worker = new Worker(new URL("./kdfWorker.js", import.meta.url));
  try {
    return await new Promise((resolve, reject) => {
      let settled = false;
      worker.once("message", (message) => {
        settled = true;
        if (message.error) reject(new VaultError("E_IO", "口令派生失败"));
        else {
          const key = Buffer.from(message.keyB64, "base64");
          if (key.length !== 32) reject(new VaultError("E_IO", "口令派生失败"));
          else resolve(key);
        }
      });
      worker.once("error", () => reject(new VaultError("E_IO", "口令派生失败")));
      worker.once("exit", () => {
        if (!settled) reject(new VaultError("E_IO", "口令派生线程提前结束"));
      });
      worker.postMessage({ passwordB64: passwordBytes.toString("base64"), saltB64: salt.toString("base64"), params });
    });
  } finally {
    passwordBytes.fill(0);
    await worker.terminate();
  }
}

export function hkdfRecoveryKek(recoveryKeyBytes, salt) {
  return Buffer.from(hkdfSync("sha256", recoveryKeyBytes, salt, "life-atlas/vault/v1/recovery-kek", 32));
}

export function aesGcmEncryptWithNonce(key, plaintext, aad, nonce) {
  if (key.length !== 32 || nonce.length !== 12) throw new VaultError("E_INVALID_ARGUMENT", "加密参数不正确");
  const cipher = createCipheriv("aes-256-gcm", key, nonce, { authTagLength: 16 });
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([nonce, ciphertext, cipher.getAuthTag()]);
}

export function aesGcmEncrypt(key, plaintext, aad) {
  return aesGcmEncryptWithNonce(key, plaintext, aad, randomBytes(12));
}

export function aesGcmDecrypt(key, blob, aad) {
  try {
    if (key.length !== 32 || blob.length < 28) throw new Error("invalid ciphertext");
    const decipher = createDecipheriv("aes-256-gcm", key, blob.subarray(0, 12), { authTagLength: 16 });
    decipher.setAAD(aad);
    decipher.setAuthTag(blob.subarray(blob.length - 16));
    return Buffer.concat([decipher.update(blob.subarray(12, blob.length - 16)), decipher.final()]);
  } catch {
    throw new VaultError("E_CORRUPT", "密文已损坏，无法解密");
  }
}

export function aadPasswordWrap(vaultId, kdf) {
  return Buffer.from(`LA-VAULT-1|wrap|password|${vaultId}|argon2id|${kdf.memoryKiB}|${kdf.iterations}|${kdf.parallelism}`, "utf8");
}

export function aadRecoveryWrap(vaultId) {
  return Buffer.from(`LA-VAULT-1|wrap|recovery|${vaultId}`, "utf8");
}

export function aadItem(vaultId, itemId) {
  return Buffer.from(`LA-VAULT-1|item|${vaultId}|${itemId}`, "utf8");
}
