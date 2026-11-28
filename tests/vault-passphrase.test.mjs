import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { generatePassword, getEffWords, loadEffWords } from "../electron/main/vault/passwordGenerator.js";

test("word list has 7776 unique words", () => {
  const words = loadEffWords(fs.readFileSync(new URL("../electron/main/vault/effLargeWordlist.txt", import.meta.url), "utf8")); assert.equal(words.length, 7776); assert.equal(new Set(words).size, 7776); assert.deepEqual(getEffWords(), words);
});

test("options control words separator capitals and number", () => {
  const generated = generatePassword({ mode: "passphrase", words: 4, separator: "_", capitalize: true, appendNumber: true }, (minimum) => minimum);
  assert.equal(generated, "Abacus_Abacus_Abacus_Abacus10");
  for (const options of [{ words: 3 }, { words: 11 }, { separator: "!" }]) assert.throws(() => generatePassword({ mode: "passphrase", ...options }), { code: "E_INVALID_ARGUMENT" });
});

test("ten thousand phrases only use listed words", () => {
  const listed = new Set(getEffWords());
  for (let index = 0; index < 10000; index += 1) {
    const words = generatePassword({ mode: "passphrase", words: 5, separator: " " }).split(" "); assert.equal(words.length, 5); for (const word of words) assert.ok(listed.has(word));
  }
});
