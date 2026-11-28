import test from "node:test";
import assert from "node:assert/strict";
import { generatePassword } from "../electron/main/vault/passwordGenerator.js";

test("length bounds are enforced", () => {
  for (const length of [7, 129]) assert.throws(() => generatePassword({ length }), { code: "E_INVALID_ARGUMENT" });
  for (const length of [8, 128]) assert.equal(generatePassword({ length }).length, length);
});

test("every selected class appears at least once", () => {
  for (let iteration = 0; iteration < 1000; iteration += 1) {
    const password = generatePassword({ length: 8 });
    for (const expression of [/[A-Z]/, /[a-z]/, /\d/, /[^A-Za-z0-9]/]) assert.match(password, expression);
  }
});

test("ambiguous characters are excluded on request", () => {
  for (let iteration = 0; iteration < 100; iteration += 1) assert.doesNotMatch(generatePassword({ length: 128, excludeAmbiguous: true }), /[Il1O0]/);
});

test("the random source is injectable", () => {
  const first = generatePassword({ length: 8 }, (minimum) => minimum);
  assert.equal(first, generatePassword({ length: 8 }, (minimum) => minimum));
  assert.equal(first, "a0!AAAAA");
});
