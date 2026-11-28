import { webcrypto } from 'node:crypto';

const { subtle } = webcrypto;
const iterations = 600_000;
const tagBytes = 16;
const dataKeyBytes = 32;
const optionalStringFields = [
  'website',
  'url',
  'username',
  'notes',
  'expiresAt',
  'imageDataUrl',
  'sourceText',
  'createdAt',
  'updatedAt',
];

function formatError() {
  return new Error('Invalid PasswordBox v1 encrypted backup format.');
}

function vaultError() {
  return new Error('Invalid PasswordBox v1 vault contents.');
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readBase64(value) {
  if (typeof value !== 'string') throw formatError();
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value) throw formatError();
  return bytes;
}

function readEnvelope(envelope, ciphertextLength) {
  if (!isRecord(envelope)) throw formatError();
  const iv = readBase64(envelope.iv);
  const data = readBase64(envelope.data);
  if (iv.length !== 12 || !ciphertextLength(data.length)) throw formatError();
  return { iv, data };
}

function decrypt(key, envelope) {
  return subtle.decrypt({ name: 'AES-GCM', iv: envelope.iv }, key, envelope.data);
}

function validateEntries(vault) {
  if (!isRecord(vault) || vault.version !== 1 || !Array.isArray(vault.entries)) {
    throw vaultError();
  }
  for (const entry of vault.entries) {
    if (
      !isRecord(entry)
      || typeof entry.id !== 'string'
      || entry.id.length === 0
      || typeof entry.title !== 'string'
      || typeof entry.secret !== 'string'
      || optionalStringFields.some(field => Object.hasOwn(entry, field) && typeof entry[field] !== 'string')
      || (Object.hasOwn(entry, 'tags') && (
        !Array.isArray(entry.tags) || entry.tags.some(tag => typeof tag !== 'string')
      ))
    ) {
      throw vaultError();
    }
  }
  return vault.entries;
}

export async function decodePasswordBoxBackup(text, password) {
  if (typeof text !== 'string' || typeof password !== 'string') throw formatError();
  let backup;
  try {
    backup = JSON.parse(text);
  } catch {
    throw formatError();
  }
  if (
    !isRecord(backup)
    || backup.kind !== 'encrypted-key-vault-backup'
    || !isRecord(backup.meta)
    || backup.meta.version !== 1
    || backup.meta.kdf !== 'PBKDF2-SHA256'
    || backup.meta.iterations !== iterations
  ) {
    throw formatError();
  }
  const salt = readBase64(backup.meta.salt);
  if (salt.length !== 16) throw formatError();
  const wrappedKey = readEnvelope(backup.meta.passwordWrappedKey, length => length === dataKeyBytes + tagBytes);
  const ciphertext = readEnvelope(backup.cipher, length => length > tagBytes);

  let plaintext;
  const passwordBytes = new TextEncoder().encode(password);
  try {
    const passwordKey = await subtle.importKey('raw', passwordBytes, 'PBKDF2', false, ['deriveKey']);
    passwordBytes.fill(0);
    const wrappingKey = await subtle.deriveKey(
      { name: 'PBKDF2', hash: 'SHA-256', iterations, salt },
      passwordKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt'],
    );
    const rawDataKey = new Uint8Array(await decrypt(wrappingKey, wrappedKey));
    let dataKey;
    try {
      dataKey = await subtle.importKey('raw', rawDataKey, 'AES-GCM', false, ['decrypt']);
    } finally {
      rawDataKey.fill(0);
    }
    plaintext = new Uint8Array(await decrypt(dataKey, ciphertext));
  } catch {
    throw new Error('PasswordBox master password is incorrect or the backup is damaged.');
  } finally {
    passwordBytes.fill(0);
  }

  let vault;
  try {
    vault = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plaintext));
  } catch {
    throw vaultError();
  } finally {
    plaintext.fill(0);
  }
  return { entries: validateEntries(vault) };
}
