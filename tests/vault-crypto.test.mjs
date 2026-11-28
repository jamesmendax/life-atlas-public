import test from "node:test";
import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { performance } from "node:perf_hooks";
import { KDF_PARAMS, deriveKeyArgon2id, hkdfRecoveryKek, aesGcmEncrypt, aesGcmEncryptWithNonce, aesGcmDecrypt, aadPasswordWrap, aadRecoveryWrap, aadItem } from "../electron/main/vault/crypto.js";

test("argon2id matches the reference vector", async () => {
  for (const [parallelism, expected] of [[1, "09316115d5cf24ed5a15a31a3ba326e5cf32edc24702987c02b6566f61913cf7"], [4, "1a9677b0afe81fda7b548895e7a1bfeb8668ffc19a530e37e088a668fab1c02a"]]) {
    const key = await deriveKeyArgon2id("password", Buffer.from("somesalt"), { ...KDF_PARAMS, memoryKiB: 65536, iterations: 2, parallelism });
    assert.equal(key.toString("hex"), expected); key.fill(0);
  }
});

test("argon2id matches node crypto for random inputs", async () => {
  if (!crypto.argon2Sync) { console.log("argon2Sync unavailable, cross-check not run"); return; }
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const password = crypto.randomBytes(24).toString("hex");
    const salt = crypto.randomBytes(16);
    const params = { ...KDF_PARAMS, memoryKiB: 8192, iterations: 2 };
    const key = await deriveKeyArgon2id(password, salt, params);
    const expected = crypto.argon2Sync("argon2id", { message: password, nonce: salt, parallelism: 1, tagLength: 32, memory: 8192, passes: 2 });
    assert.deepEqual(key, expected); key.fill(0); expected.fill(0);
  }
});

test("argon2id runs in a worker without blocking the event loop", async () => {
  const started = performance.now();
  let previous = started;
  const delays = [];
  const interval = setInterval(() => { const current = performance.now(); delays.push(current - previous - 10); previous = current; }, 10);
  try {
    const key = await deriveKeyArgon2id("Official-Parameters-9", crypto.randomBytes(16));
    const elapsed = performance.now() - started;
    console.log(`WP06_KDF_MS=${elapsed.toFixed(1)} MAX_EVENT_LOOP_DELAY_MS=${Math.max(...delays).toFixed(1)}`);
    assert.ok(delays.length > 1); assert.ok(Math.max(...delays) < 100); assert.ok(elapsed < 2000); key.fill(0);
  } finally { clearInterval(interval); }
});

test("hkdf matches the two reference vectors", () => {
  assert.equal(hkdfRecoveryKek(Buffer.alloc(32), Buffer.alloc(16)).toString("hex"), "c46567b0ad7d87efd6c722eb29a94293f72ca1bdecbbde1ca3558953d8019fab");
  assert.equal(hkdfRecoveryKek(Buffer.from(Array.from({ length: 32 }, (_, index) => index)), Buffer.from(Array.from({ length: 16 }, (_, index) => 255 - index))).toString("hex"), "03d284dbe6a0c1c64560db1aac622dd3bdbd3bd51dee778f58762d4219718810");
});

test("aes-gcm matches the reference layout", () => {
  const blob = aesGcmEncryptWithNonce(Buffer.alloc(32, 0x11), Buffer.from("hello vault"), aadItem("vault-test", "vi_test"), Buffer.alloc(12, 0x22));
  assert.equal(blob.toString("hex"), "2222222222222222222222227f926b25afefe93e9053aa14ce8361ff7983e0535b79ae5f4a3690");
});

test("aes-gcm rejects a flipped byte and a wrong aad", () => {
  const key = crypto.randomBytes(32); const aad = aadItem("vault", "item");
  const blob = aesGcmEncrypt(key, Buffer.from("hidden"), aad);
  assert.equal(aesGcmDecrypt(key, blob, aad).toString(), "hidden");
  const changed = Buffer.from(blob); changed[14] ^= 1;
  assert.throws(() => aesGcmDecrypt(key, changed, aad), { code: "E_CORRUPT" });
  assert.throws(() => aesGcmDecrypt(key, blob, aadItem("vault", "other")), { code: "E_CORRUPT" });
});

test("aad strings match the specification byte for byte", () => {
  assert.equal(aadPasswordWrap("vault-test", KDF_PARAMS).toString(), "LA-VAULT-1|wrap|password|vault-test|argon2id|131072|3|1");
  assert.equal(aadRecoveryWrap("vault-test").toString(), "LA-VAULT-1|wrap|recovery|vault-test");
  assert.equal(aadItem("vault-test", "vi_test").toString(), "LA-VAULT-1|item|vault-test|vi_test");
});
