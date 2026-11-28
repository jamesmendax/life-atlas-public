import { readFileSync } from "node:fs";
import { randomInt as secureRandomInt } from "node:crypto";
import { invalidArgument } from "./errors.js";

let wordlist;

export function loadEffWords(text) {
  return text.split(/\r?\n/).filter((line) => /^\d{5}\s+\S+/.test(line)).map((line) => line.trim().split(/\s+/)[1]);
}

export function getEffWords() {
  if (!wordlist) {
    wordlist = loadEffWords(readFileSync(new URL("./effLargeWordlist.txt", import.meta.url), "utf8"));
    if (wordlist.length !== 7776 || new Set(wordlist).size !== 7776) throw new Error("invalid EFF wordlist");
    Object.freeze(wordlist);
  }
  return wordlist;
}

export function generatePassword(options = {}, randomInt = secureRandomInt) {
  if (options.mode === "passphrase") {
    const { words = 5, separator = "-", capitalize = false, appendNumber = false } = options;
    if (!Number.isInteger(words) || words < 4 || words > 10 || !["-", " ", ".", "_"].includes(separator) || typeof capitalize !== "boolean" || typeof appendNumber !== "boolean") invalidArgument("口令短语选项不正确");
    const dictionary = getEffWords();
    const selected = Array.from({ length: words }, () => {
      const word = dictionary[randomInt(0, dictionary.length)];
      return capitalize ? word[0].toUpperCase() + word.slice(1) : word;
    });
    if (appendNumber) selected[selected.length - 1] += String(randomInt(10, 100));
    return selected.join(separator);
  }
  const { mode = "random", length = 20, upper = true, lower = true, digits = true, symbols = true, excludeAmbiguous = false } = options;
  if (mode !== "random" || !Number.isInteger(length) || length < 8 || length > 128 || [upper, lower, digits, symbols, excludeAmbiguous].some((value) => typeof value !== "boolean")) invalidArgument("密码生成选项不正确");
  const classes = [
    upper && "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
    lower && "abcdefghijklmnopqrstuvwxyz",
    digits && "0123456789",
    symbols && "!@#$%^&*()-_=+[]{};:,.<>/?~|",
  ].filter(Boolean).map((characters) => excludeAmbiguous ? characters.replace(/[Il1O0]/g, "") : characters);
  if (!classes.length) invalidArgument("至少选择一类字符");
  const combined = classes.join("");
  const result = classes.map((characters) => characters[randomInt(0, characters.length)]);
  while (result.length < length) result.push(combined[randomInt(0, combined.length)]);
  for (let position = result.length - 1; position > 0; position -= 1) {
    const selected = randomInt(0, position + 1);
    [result[position], result[selected]] = [result[selected], result[position]];
  }
  return result.join("");
}
