import fs from "node:fs/promises";
import { createCipheriv, createDecipheriv, createHash } from "node:crypto";
import { assertPhysicalPath } from "../storage/dataRoot.js";
import { VaultError } from "../vault/errors.js";
import { KDF_PARAMS } from "../vault/crypto.js";
import { checkCancelled } from "./files.js";

export const CONTAINER_MAGIC = Buffer.from("LAENC1\0\0", "latin1");
export const ENCRYPTED_CONTAINER_FORMAT_VERSION = 1;
const TAG_BYTES = 16;
const badContainer = () => new VaultError("E_BAD_PASSWORD", "备份密码错误或文件已损坏");
const base64Bytes = (value, length) => {
  if (typeof value !== "string") throw badContainer();
  const bytes = Buffer.from(value, "base64");
  if (bytes.length !== length || bytes.toString("base64") !== value) throw badContainer();
  return bytes;
};
const nonceFor = (prefix, index, last) => {
  if (index > 0xffffffff) throw badContainer();
  const nonce = Buffer.alloc(12);
  prefix.copy(nonce);
  nonce.writeUInt32BE(index, 7);
  nonce[11] = last ? 1 : 0;
  return nonce;
};

export function isEncryptedContainer(firstBytes) {
  return firstBytes?.byteLength >= 8 && Buffer.from(firstBytes).subarray(0, 8).equals(CONTAINER_MAGIC);
}

async function readExactly(file, length, position) {
  const buffer = Buffer.alloc(length);
  let done = 0;
  while (done < length) {
    const result = await file.read(buffer, done, length - done, position + done);
    if (!result.bytesRead) throw badContainer();
    done += result.bytesRead;
  }
  return buffer;
}

async function readHeader(file) {
  const first = await readExactly(file, 12, 0);
  if (!isEncryptedContainer(first)) throw badContainer();
  const length = first.readUInt32BE(8);
  if (length < 2 || length > 8192) throw badContainer();
  const bytes = await readExactly(file, length, 12);
  let header;
  try { header = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { throw badContainer(); }
  if (header?.kind !== "life-atlas-encrypted-backup" || header.formatVersion !== 1 || header.cipher !== "A256GCM-STREAM"
    || !Number.isSafeInteger(header.chunkSize) || header.chunkSize < 1 || header.chunkSize > 1048576
    || Object.entries(KDF_PARAMS).some(([key, value]) => header.kdf?.[key] !== value)) throw badContainer();
  base64Bytes(header.kdf.saltB64, 16);
  const prefix = base64Bytes(header.noncePrefixB64, 7);
  const canonical = {
    kind: header.kind, formatVersion: 1, kdf: { ...KDF_PARAMS, saltB64: header.kdf.saltB64 },
    cipher: header.cipher, chunkSize: header.chunkSize, noncePrefixB64: header.noncePrefixB64,
  };
  if (!bytes.equals(Buffer.from(JSON.stringify(canonical)))) throw badContainer();
  return { header, prefix, offset: 12 + length, aad: createHash("sha256").update(first).update(bytes).digest() };
}

export async function encryptFileToContainer({ sourceFile, targetFile, key, saltB64, noncePrefix, chunkSize = 1048576, signal, onProgress }) {
  if (!Buffer.isBuffer(key) || key.length !== 32 || !Buffer.isBuffer(noncePrefix) || noncePrefix.length !== 7 || !Number.isSafeInteger(chunkSize) || chunkSize < 1 || chunkSize > 1048576) throw new VaultError("E_INVALID_ARGUMENT", "加密参数不正确");
  base64Bytes(saltB64, 16);
  const source = assertPhysicalPath(sourceFile, { allowMissing: false });
  const target = assertPhysicalPath(targetFile);
  let input;
  let output;
  let created = false;
  const plaintext = Buffer.alloc(chunkSize);
  try {
    checkCancelled(signal);
    input = await fs.open(source, "r");
    const { size } = await input.stat();
    if (!Number.isSafeInteger(size) || Math.floor(size / chunkSize) > 0xffffffff) throw new VaultError("E_INVALID_ARGUMENT", "备份文件过大");
    output = await fs.open(target, "wx");
    created = true;
    const header = {
      kind: "life-atlas-encrypted-backup", formatVersion: ENCRYPTED_CONTAINER_FORMAT_VERSION, kdf: { ...KDF_PARAMS, saltB64 },
      cipher: "A256GCM-STREAM", chunkSize, noncePrefixB64: noncePrefix.toString("base64"),
    };
    const headerBytes = Buffer.from(JSON.stringify(header));
    const lengthBytes = Buffer.alloc(4);
    lengthBytes.writeUInt32BE(headerBytes.length);
    const envelope = Buffer.concat([CONTAINER_MAGIC, lengthBytes, headerBytes]);
    const aad = createHash("sha256").update(envelope).digest();
    await output.writeFile(envelope);
    let position = 0;
    let index = 0;
    while (true) {
      checkCancelled(signal);
      const length = Math.min(chunkSize, size - position);
      let read = 0;
      while (read < length) {
        const result = await input.read(plaintext, read, length - read, position + read);
        if (!result.bytesRead) throw new VaultError("E_IO", "备份来源文件在读取中发生变化");
        read += result.bytesRead;
      }
      const last = length < chunkSize;
      const cipher = createCipheriv("aes-256-gcm", key, nonceFor(noncePrefix, index, last));
      cipher.setAAD(aad);
      await output.writeFile(cipher.update(plaintext.subarray(0, length)));
      await output.writeFile(cipher.final());
      await output.writeFile(cipher.getAuthTag());
      position += length;
      onProgress?.({ phase: "encrypt", done: position, total: size });
      checkCancelled(signal);
      if (last) break;
      index += 1;
    }
    if ((await input.stat()).size !== size) throw new VaultError("E_IO", "备份来源文件在读取中发生变化");
    await output.sync();
    return { header };
  } catch (error) {
    await output?.close();
    output = undefined;
    if (created) await fs.unlink(assertPhysicalPath(target)).catch(() => {});
    throw error;
  } finally {
    plaintext.fill(0);
    await input?.close();
    await output?.close();
  }
}

async function decryptChunks({ sourceFile, key, deriveKey, password, signal, write }) {
  const input = await fs.open(assertPhysicalPath(sourceFile, { allowMissing: false }), "r");
  let ownedKey;
  try {
    checkCancelled(signal);
    const { header, prefix, offset, aad } = await readHeader(input);
    if (!key) {
      if (typeof deriveKey !== "function" || typeof password !== "string") throw badContainer();
      ownedKey = Buffer.from(await deriveKey(password, base64Bytes(header.kdf.saltB64, 16), header.kdf));
      key = ownedKey;
    }
    if (!Buffer.isBuffer(key) || key.length !== 32) throw badContainer();
    const { size } = await input.stat();
    let position = offset;
    let index = 0;
    let lastSeen = false;
    const hash = createHash("sha256");
    let plaintextSize = 0;
    while (position < size) {
      checkCancelled(signal);
      const length = Math.min(header.chunkSize + TAG_BYTES, size - position);
      if (length < TAG_BYTES || index > 0xffffffff) throw badContainer();
      const last = length < header.chunkSize + TAG_BYTES;
      const encrypted = await readExactly(input, length, position);
      let plaintext;
      try {
        const decipher = createDecipheriv("aes-256-gcm", key, nonceFor(prefix, index, last));
        decipher.setAAD(aad);
        decipher.setAuthTag(encrypted.subarray(length - TAG_BYTES));
        plaintext = Buffer.concat([decipher.update(encrypted.subarray(0, length - TAG_BYTES)), decipher.final()]);
      } catch { throw badContainer(); }
      try {
        hash.update(plaintext);
        plaintextSize += plaintext.length;
        await write?.(plaintext);
      } finally { plaintext.fill(0); }
      position += length;
      index += 1;
      if (last) { lastSeen = true; break; }
    }
    if (!lastSeen || position !== size || (await input.stat()).size !== size) throw badContainer();
    checkCancelled(signal);
    return { header, size: plaintextSize, sha256: hash.digest("hex") };
  } finally {
    ownedKey?.fill(0);
    await input.close();
  }
}

async function decryptToFile(options) {
  const target = assertPhysicalPath(options.targetFile);
  let output;
  let created = false;
  try {
    checkCancelled(options.signal);
    output = await fs.open(target, "wx");
    created = true;
    const result = await decryptChunks({ ...options, write: (bytes) => output.writeFile(bytes) });
    await output.sync();
    return { header: result.header };
  } catch (error) {
    await output?.close();
    output = undefined;
    if (created) await fs.unlink(assertPhysicalPath(target)).catch(() => {});
    if (error?.code === "E_CANCELLED" || error instanceof VaultError) throw error;
    throw badContainer();
  } finally { await output?.close(); }
}

export const decryptContainerToFile = (options) => decryptToFile(options);
export const decryptContainerToFileWithKey = (options) => decryptToFile(options);
export const verifyEncryptedContainerWithKey = (options) => decryptChunks(options);
