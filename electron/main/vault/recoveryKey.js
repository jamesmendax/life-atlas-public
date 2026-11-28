import { createHash, randomBytes as secureRandomBytes, timingSafeEqual } from "node:crypto";
import { VaultError } from "./errors.js";

export const RECOVERY_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function formatRecoveryKey(bytes) {
  if (bytes.length !== 32) throw new VaultError("E_INVALID_ARGUMENT", "恢复密钥有误");
  const checksum = createHash("sha256").update(bytes).digest().subarray(0, 2);
  const payload = Buffer.concat([bytes, checksum]);
  let value = BigInt(`0x${payload.toString("hex")}`) << 3n;
  const characters = Array(55);
  for (let position = 54; position >= 0; position -= 1) {
    characters[position] = RECOVERY_ALPHABET[Number(value & 31n)];
    value >>= 5n;
  }
  payload.fill(0);
  return `LA1-${characters.join("").match(/.{5}/g).join("-")}`;
}

export function generateRecoveryKey(randomBytes = secureRandomBytes) {
  const bytes = randomBytes(32);
  return { bytes, formatted: formatRecoveryKey(bytes) };
}

export function normalizeRecoveryText(input) {
  if (typeof input !== "string") throw new VaultError("E_INVALID_ARGUMENT", "恢复密钥有误");
  return input.toUpperCase().replace(/[\s-]/g, "").replace(/^LA1/, "").replace(/O/g, "0").replace(/[IL]/g, "1");
}

export function parseRecoveryKey(input) {
  const normalized = normalizeRecoveryText(input);
  if (normalized.length !== 55) throw new VaultError("E_INVALID_ARGUMENT", "恢复密钥有误");
  let value = 0n;
  for (const character of normalized) {
    const index = RECOVERY_ALPHABET.indexOf(character);
    if (index < 0) throw new VaultError("E_INVALID_ARGUMENT", "恢复密钥有误");
    value = (value << 5n) | BigInt(index);
  }
  if ((value & 7n) !== 0n) throw new VaultError("E_INVALID_ARGUMENT", "恢复密钥有误");
  value >>= 3n;
  const payload = Buffer.alloc(34);
  for (let position = 33; position >= 0; position -= 1) {
    payload[position] = Number(value & 255n);
    value >>= 8n;
  }
  const bytes = Buffer.from(payload.subarray(0, 32));
  const checksum = createHash("sha256").update(bytes).digest().subarray(0, 2);
  const valid = timingSafeEqual(checksum, payload.subarray(32));
  payload.fill(0);
  if (!valid) {
    bytes.fill(0);
    throw new VaultError("E_INVALID_ARGUMENT", "恢复密钥有误");
  }
  return bytes;
}

export function lastTwoGroups(formatted) {
  const bytes = parseRecoveryKey(formatted);
  try {
    return formatRecoveryKey(bytes).split("-").slice(-2).join("-");
  } finally {
    bytes.fill(0);
  }
}
