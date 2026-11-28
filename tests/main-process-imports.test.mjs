import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { builtinModules } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENTRIES = ["electron/main/index.js", "electron/preload/workspace.cjs", "electron/preload/vault.cjs", "electron/preload/setup.cjs"];
const ALLOWED = new Set(["electron", "yazl", "yauzl", "hash-wasm", ...builtinModules, ...builtinModules.map((name) => `node:${name}`)]);
const SPECIFIER = /(?:import\s[^'"]*?from\s*|import\s*\(\s*|export\s[^'"]*?from\s*|require\s*\(\s*)['"]([^'"]+)['"]|new\s+URL\(\s*['"](\.[^'"]+)['"]\s*,\s*import\.meta\.url/g;

function collectImports() {
  const seen = new Set();
  const found = [];
  const visit = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const match of fs.readFileSync(file, "utf8").matchAll(SPECIFIER)) {
      const spec = match[1] ?? match[2];
      if (!spec.startsWith(".")) { found.push({ spec, file }); continue; }
      let target = path.resolve(path.dirname(file), spec);
      if (!fs.existsSync(target)) target = [".js", ".mjs", ".cjs"].map((extension) => target + extension).find((candidate) => fs.existsSync(candidate)) || target;
      if (fs.existsSync(target) && fs.statSync(target).isFile()) visit(target);
      else found.push({ spec: `（找不到的相对路径）${spec}`, file });
    }
  };
  for (const entry of ENTRIES) if (fs.existsSync(path.join(root, entry))) visit(path.join(root, entry));
  return { seen, found };
}

test("main process code only loads packages that ship with the app", () => {
  const { seen, found } = collectImports();
  assert.ok(seen.size > 0, "electron/main/index.js 不存在");
  const packageName = (spec) => spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0];
  const bad = found.filter(({ spec }) => !ALLOWED.has(spec) && !ALLOWED.has(packageName(spec)));
  assert.deepEqual(bad.map(({ spec, file }) => `${spec} ← ${path.relative(root, file)}`), []);
});
