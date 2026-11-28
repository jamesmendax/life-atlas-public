import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { aesGcmEncrypt, aadItem } from "../electron/main/vault/crypto.js";
import { encodeItem, decodeItem, sealItem, openItem } from "../electron/main/vault/itemCodec.js";

test("sealed blobs are 28 plus a multiple of 512 bytes", () => {
  for (const [length, padded] of [[1, 512], [507, 512], [508, 1024], [1000, 1024], [5000, 5120]]) {
    const json = Buffer.from(length === 1 ? "0" : JSON.stringify("x".repeat(length - 2)));
    const plaintext = Buffer.alloc(Math.ceil((length + 5) / 512) * 512); plaintext.writeUInt32BE(length); json.copy(plaintext, 4);
    assert.equal(aesGcmEncrypt(randomBytes(32), plaintext, aadItem("vault", "item")).length, 28 + padded);
    assert.equal(encodeItem(length === 1 ? 0 : "x".repeat(length - 2)).length, padded);
  }
});

test("open returns the exact item", () => {
  const key = randomBytes(32); const item = { id: "vi_test", title: "中文", fields: [{ value: "hidden" }] };
  assert.deepEqual(openItem(key, "vault", item.id, sealItem(key, "vault", item)), item);
  assert.deepEqual(decodeItem(encodeItem(item)), item);
});

test("a blob opened under another item id fails", () => {
  const key = randomBytes(32); const item = { id: "first" };
  assert.throws(() => openItem(key, "vault", "second", sealItem(key, "vault", item)), { code: "E_CORRUPT" });
});

test("a flipped byte fails with a readable error", () => {
  const key = randomBytes(32); const blob = sealItem(key, "vault", { id: "item" }); blob[20] ^= 1;
  assert.throws(() => openItem(key, "vault", "item", blob), { code: "E_CORRUPT", message: "条目已损坏，无法解密" });
});
