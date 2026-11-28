import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("runtime dependencies are only main process packages", () => {
  const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const allowed = ["yazl", "yauzl", "hash-wasm", "tesseract.js-core"];
  for (const name of Object.keys(pkg.dependencies || {})) assert.ok(allowed.includes(name), `${name} cannot ship as a main-process runtime dependency`);
});
