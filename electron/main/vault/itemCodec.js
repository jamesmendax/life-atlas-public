import { aesGcmDecrypt, aesGcmEncrypt, aadItem } from "./crypto.js";
import { VaultError } from "./errors.js";

export function encodeItem(item) {
  const json = Buffer.from(JSON.stringify(item), "utf8");
  const plaintext = Buffer.alloc(Math.ceil((json.length + 5) / 512) * 512);
  plaintext.writeUInt32BE(json.length);
  json.copy(plaintext, 4);
  json.fill(0);
  return plaintext;
}

export function decodeItem(plaintext) {
  if (plaintext.length < 512 || plaintext.length % 512 !== 0) throw new VaultError("E_CORRUPT", "条目已损坏，无法解密");
  const length = plaintext.readUInt32BE();
  if (!length || length > plaintext.length - 4 || plaintext.subarray(length + 4).some((value) => value !== 0)) throw new VaultError("E_CORRUPT", "条目已损坏，无法解密");
  try { return JSON.parse(plaintext.subarray(4, length + 4).toString("utf8")); } catch { throw new VaultError("E_CORRUPT", "条目已损坏，无法解密"); }
}

export function sealItem(dek, vaultId, item) {
  const plaintext = encodeItem(item);
  try { return aesGcmEncrypt(dek, plaintext, aadItem(vaultId, item.id)); } finally { plaintext.fill(0); }
}

export function openItem(dek, vaultId, itemId, blob) {
  let plaintext;
  try {
    plaintext = aesGcmDecrypt(dek, blob, aadItem(vaultId, itemId));
    const item = decodeItem(plaintext);
    if (item?.id !== itemId) throw new Error("item id mismatch");
    return item;
  } catch {
    throw new VaultError("E_CORRUPT", "条目已损坏，无法解密");
  } finally {
    plaintext?.fill(0);
  }
}
