import { createHmac } from "node:crypto";
import { invalidArgument } from "./errors.js";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function decodeBase32(input) {
  const normalized = input.toUpperCase().replace(/\s/g, "").replace(/=+$/, "");
  if (!normalized || !/^[A-Z2-7]+$/.test(normalized) || [1, 3, 6].includes(normalized.length % 8)) invalidArgument("两步验证密钥有误");
  const result = [];
  let accumulator = 0;
  let bitCount = 0;
  for (const character of normalized) {
    accumulator = (accumulator << 5) | BASE32_ALPHABET.indexOf(character);
    bitCount += 5;
    if (bitCount >= 8) {
      bitCount -= 8;
      result.push((accumulator >>> bitCount) & 255);
      accumulator &= (1 << bitCount) - 1;
    }
  }
  if (accumulator !== 0 || !result.length) invalidArgument("两步验证密钥有误");
  return Buffer.from(result);
}

export function parseTotpSecret(value) {
  if (typeof value !== "string") invalidArgument("两步验证密钥有误");
  let secret = value;
  let algorithm = "SHA1";
  let digits = 6;
  let period = 30;
  let issuer = "";
  let account = "";
  if (/^otpauth:/i.test(value)) {
    let parsed;
    try { parsed = new URL(value); } catch { invalidArgument("两步验证链接有误"); }
    if (parsed.protocol !== "otpauth:" || parsed.hostname !== "totp" || parsed.username || parsed.password) invalidArgument("只支持 TOTP 两步验证");
    let label;
    try { label = decodeURIComponent(parsed.pathname.replace(/^\//, "")); } catch { invalidArgument("两步验证链接有误"); }
    const separator = label.indexOf(":");
    issuer = parsed.searchParams.get("issuer") || (separator >= 0 ? label.slice(0, separator) : "");
    account = separator >= 0 ? label.slice(separator + 1) : label;
    secret = parsed.searchParams.get("secret") || "";
    algorithm = (parsed.searchParams.get("algorithm") || "SHA1").toUpperCase();
    digits = Number(parsed.searchParams.get("digits") || 6);
    period = Number(parsed.searchParams.get("period") || 30);
  }
  if (!["SHA1", "SHA256", "SHA512"].includes(algorithm) || ![6, 8].includes(digits) || ![30, 60].includes(period)) invalidArgument("两步验证参数不支持");
  return { secretBytes: decodeBase32(secret), algorithm, digits, period, issuer, account };
}

export function totpCode({ secretBytes, algorithm = "SHA1", digits = 6, period = 30 }, unixSeconds) {
  if (!Number.isFinite(unixSeconds) || unixSeconds < 0 || !["SHA1", "SHA256", "SHA512"].includes(algorithm) || ![6, 8].includes(digits) || ![30, 60].includes(period)) invalidArgument("两步验证参数不正确");
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(unixSeconds / period)));
  const digest = createHmac(algorithm.toLowerCase(), secretBytes).update(counter).digest();
  const offset = digest[digest.length - 1] & 15;
  const truncated = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(truncated % (10 ** digits)).padStart(digits, "0");
}
