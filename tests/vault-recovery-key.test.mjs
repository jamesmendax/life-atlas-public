import test from "node:test";
import assert from "node:assert/strict";
import { randomInt } from "node:crypto";
import { RECOVERY_ALPHABET, formatRecoveryKey, generateRecoveryKey, lastTwoGroups, parseRecoveryKey } from "../electron/main/vault/recoveryKey.js";

test("recovery key format matches the two reference vectors", () => {
  assert.equal(formatRecoveryKey(Buffer.alloc(32)), "LA1-00000-00000-00000-00000-00000-00000-00000-00000-00000-00000-06CT0");
  assert.equal(formatRecoveryKey(Buffer.from(Array.from({ length: 32 }, (_, index) => index))), "LA1-000G4-0R40M-30E20-9185G-R38E1-W8124-GK2GA-HC5RR-34D1P-70X3R-FP638");
});

test("one thousand generated keys parse back", () => {
  const seen = new Set();
  for (let iteration = 0; iteration < 1000; iteration += 1) {
    const key = generateRecoveryKey(); assert.deepEqual(parseRecoveryKey(key.formatted), key.bytes); seen.add(key.formatted); key.bytes.fill(0);
  }
  assert.equal(seen.size, 1000);
});

test("single character changes are detected", () => {
  let detected = 0;
  for (let iteration = 0; iteration < 200; iteration += 1) {
    const key = generateRecoveryKey(); const body = key.formatted.slice(4).replace(/-/g, "").split("");
    const position = randomInt(0, body.length); const old = RECOVERY_ALPHABET.indexOf(body[position]);
    body[position] = RECOVERY_ALPHABET[(old + randomInt(1, 32)) % 32];
    try { const bytes = parseRecoveryKey(body.join("")); bytes.fill(0); } catch (error) { assert.equal(error.message, "恢复密钥有误"); detected += 1; }
    key.bytes.fill(0);
  }
  assert.ok(detected / 200 >= 0.99);
});

test("O I and L are normalized", () => {
  const bytes = Buffer.from(Array.from({ length: 32 }, (_, index) => index));
  const text = formatRecoveryKey(bytes);
  assert.deepEqual(parseRecoveryKey(`LA1 ${text.slice(4).toLowerCase().replace(/0/g, "o").replace(/1/g, "i").replace(/-/g, " ")}`), bytes);
  assert.deepEqual(parseRecoveryKey(text.slice(4).replace(/1/g, "L")), bytes);
});

test("wrong length, bad characters and non-zero padding bits are rejected", () => {
  const valid = formatRecoveryKey(Buffer.alloc(32));
  for (const text of [valid.slice(0, -1), valid + "0", valid.replace(/0/, "U"), valid.slice(0, -1) + "1"]) assert.throws(() => parseRecoveryKey(text), { code: "E_INVALID_ARGUMENT" });
});

test("lastTwoGroups returns groups ten and eleven", () => {
  assert.equal(lastTwoGroups(formatRecoveryKey(Buffer.alloc(32))), "00000-06CT0");
});
