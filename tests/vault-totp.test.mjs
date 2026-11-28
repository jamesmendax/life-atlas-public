import test from "node:test";
import assert from "node:assert/strict";
import { parseTotpSecret, totpCode } from "../electron/main/vault/totp.js";
import { RFC_SHA1_BASE32 } from "./fixtures/vault-items.mjs";

test("rfc 6238 vectors match for sha1 sha256 and sha512", () => {
  const vectors = [
    [59, "94287082", "46119246", "90693936"], [1111111109, "07081804", "68084774", "25091201"],
    [1111111111, "14050471", "67062674", "99943326"], [1234567890, "89005924", "91819424", "93441116"],
    [2000000000, "69279037", "90698825", "38618901"], [20000000000, "65353130", "77737706", "47863826"],
  ];
  const secrets = ["12345678901234567890", "12345678901234567890123456789012", "1234567890".repeat(7).slice(0, 64)];
  for (const [seconds, ...expected] of vectors) for (const [index, algorithm] of ["SHA1", "SHA256", "SHA512"].entries()) assert.equal(totpCode({ secretBytes: Buffer.from(secrets[index]), algorithm, digits: 8, period: 30 }, seconds), expected[index]);
});

test("otpauth links are parsed with defaults", () => {
  const defaults = parseTotpSecret(`otpauth://totp/Example:alice?secret=${RFC_SHA1_BASE32}`);
  assert.equal(defaults.issuer, "Example"); assert.equal(defaults.account, "alice"); assert.equal(defaults.algorithm, "SHA1"); assert.equal(defaults.digits, 6); assert.equal(defaults.period, 30);
  const custom = parseTotpSecret(`otpauth://totp/Prefix:user?secret=${RFC_SHA1_BASE32}&issuer=Issuer&period=60&digits=8&algorithm=SHA256`);
  assert.equal(custom.issuer, "Issuer"); assert.equal(custom.algorithm, "SHA256"); assert.equal(custom.digits, 8); assert.equal(custom.period, 60);
});

test("bare base32 secrets are accepted", () => {
  assert.equal(parseTotpSecret(RFC_SHA1_BASE32.toLowerCase().replace(/.{4}/g, "$& ")).secretBytes.toString(), "12345678901234567890");
});

test("invalid secrets are rejected", () => {
  for (const value of ["", "NOT-BASE32", "A", "AB", `otpauth://hotp/name?secret=${RFC_SHA1_BASE32}`, `otpauth://totp/name?secret=${RFC_SHA1_BASE32}&algorithm=MD5`, `otpauth://totp/name?secret=${RFC_SHA1_BASE32}&digits=7`]) assert.throws(() => parseTotpSecret(value), { code: "E_INVALID_ARGUMENT" });
});
