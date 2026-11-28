import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { checkMasterPassword, isCommonPassword, loadCommonPasswords } from "../electron/main/vault/passwordPolicy.js";

const common = loadCommonPasswords(fs.readFileSync(new URL("../electron/main/vault/commonPasswords.txt", import.meta.url), "utf8"));

test("twelve code points are required", () => {
  assert.ok(checkMasterPassword("AbCdEf!2345", common).failures.includes("length"));
  assert.ok(!checkMasterPassword("AbCdEf!23456", common).failures.includes("length"));
  assert.ok(!checkMasterPassword("我的独立密钥库主密码很长啊", common).failures.includes("length"));
  assert.ok(checkMasterPassword("😀😃😄😁😆😅😂🤣😊😇🙂", common).failures.includes("length"));
});

test("five distinct characters are required", () => {
  assert.ok(checkMasterPassword("aaaabbbbccdd", common).failures.includes("distinct"));
  assert.ok(!checkMasterPassword("aaaabbbbccde", common).failures.includes("distinct"));
});

test("common passwords and padded common passwords are rejected", () => {
  for (const value of ["Password1234", "!!sunshine2026", "iloveyou!!!!"]) assert.equal(isCommonPassword(value, common), true);
  for (const value of ["Dragon!!12345", "Superman123456789", "monkey-business-42", "correct horse battery"]) assert.equal(isCommonPassword(value, common), false);
});

test("sequences and repeats are rejected", () => {
  for (const value of ["123456789012", "abcdefghijkl", "qwertyuiopas", "lkjihgfedcba", "abcabcabcabc"]) assert.ok(checkMasterPassword(value, common).failures.includes("pattern"));
  assert.ok(!checkMasterPassword("abcdefghijkx", common).failures.includes("pattern"));
});

test("strength matches the four reference values", () => {
  for (const [password, bits, strength] of [["abcdefghijkx", 56.4, "weak"], ["我的主密码很长很长很长", 73.1, "medium"], ["Correct-Horse-9", 98.5, "strong"], ["Tr0ub4dor&3xyz!!", 105.1, "strong"]]) {
    const result = checkMasterPassword(password, common); assert.equal(result.bits, bits); assert.equal(result.strength, strength);
  }
});
