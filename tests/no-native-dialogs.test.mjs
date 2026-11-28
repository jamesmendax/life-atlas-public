import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

test("source never calls window confirm or alert", () => {
  const files = (directory) => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? files(path.join(directory, entry.name)) : /\.(jsx?|tsx?)$/.test(entry.name) ? [path.join(directory, entry.name)] : []);
  for (const file of files("src")) assert.doesNotMatch(readFileSync(file, "utf8"), /window\.(?:confirm|alert|prompt)\s*\(/, file);
});
