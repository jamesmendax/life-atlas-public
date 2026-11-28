import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

test("source never calls window prompt", () => {
  const inspect = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) inspect(file);
      else if (/\.(js|jsx)$/.test(file)) assert.doesNotMatch(readFileSync(file, "utf8"), /window\.prompt/, file);
    }
  };
  inspect(fileURLToPath(new URL("../src/", import.meta.url)));
});
