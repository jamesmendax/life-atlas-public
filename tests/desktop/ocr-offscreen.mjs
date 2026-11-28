import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
const entry = fileURLToPath(new URL("./ocr-offscreen-main.mjs", import.meta.url));
const appRoot = process.argv[2] ? path.resolve(process.argv[2]) : projectRoot;
const evidence = path.join(projectRoot, ".qa", "ocr");
await fs.mkdir(evidence, { recursive: true });
const fixture = await fs.mkdtemp(path.join(evidence, "native-"));
const report = path.join(fixture, "result.json");
const profile = path.join(fixture, "profile");
await fs.mkdir(profile);
await fs.writeFile(path.join(fixture, "package.json"), '{"name":"life-atlas-ocr-offscreen","type":"module","main":"index.mjs"}', "utf8");
await fs.writeFile(path.join(fixture, "index.mjs"), `import ${JSON.stringify(pathToFileURL(entry).href)};`, "utf8");
const env = { ...process.env, LIFE_ATLAS_OCR_TEST_CONFIG: JSON.stringify({ appRoot, profile, report }) };
delete env.ELECTRON_RUN_AS_NODE;
delete env.NODE_OPTIONS;
const executable = process.env.LIFE_ATLAS_OCR_TEST_ELECTRON || require("electron");
const result = spawnSync(executable, [fixture, `--user-data-dir=${profile}`], { env, windowsHide: true, encoding: "utf8", timeout: 35000 });
if (result.error) {
  const trace = await fs.readFile(`${report}.trace`, "utf8").catch(() => "");
  throw new Error(`Electron OCR could not finish (${result.error.message})\n${trace}`);
}
let evidenceText;
try {
  evidenceText = await fs.readFile(report, "utf8");
} catch {
  throw new Error(`Electron OCR terminated without a report (${result.status}, ${result.stderr})`);
}
console.log(evidenceText);
assert.equal(result.status, 0);
assert.equal(JSON.parse(evidenceText).ok, true);
console.log(`OCR_OFFSCREEN_REPORT ${report}`);
