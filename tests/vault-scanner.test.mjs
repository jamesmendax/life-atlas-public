import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import yazl from "yazl";
import { pipeline } from "node:stream/promises";
import { VAULT_TEST_RUNTIME } from "./fixtures/vault-items.mjs";

function setup(context) {
  fs.mkdirSync(VAULT_TEST_RUNTIME, { recursive: true }); const directory = fs.mkdtempSync(path.join(VAULT_TEST_RUNTIME, "scanner-"));
  const markers = path.join(directory, "markers.txt"); const marker = "LA-MARKER-scanner-unqiue"; fs.writeFileSync(markers, marker);
  context.after(() => { if (!path.resolve(directory).startsWith(`${path.resolve(VAULT_TEST_RUNTIME)}${path.sep}`)) throw new Error("unsafe cleanup"); fs.rmSync(directory, { recursive: true, force: true }); });
  const run = (target) => spawnSync(process.execPath, ["tools/scan-plaintext.mjs", target, "--markers", markers], { cwd: path.resolve("."), encoding: "utf8" });
  return { directory, marker, run };
}

test("finds utf8 and utf16le markers and exits with 1", (context) => {
  const { directory, marker, run } = setup(context); const file = path.join(directory, "data.bin"); fs.writeFileSync(file, Buffer.concat([Buffer.from(marker), Buffer.from(marker, "utf16le")]));
  const result = run(file); assert.equal(result.status, 1); assert.match(result.stdout, /utf8/); assert.match(result.stdout, /utf16le/);
});

test("finds markers across chunk boundaries", (context) => {
  const { directory, marker, run } = setup(context); const file = path.join(directory, "data.bin"); fs.writeFileSync(file, Buffer.concat([Buffer.alloc(1024 * 1024 - 10), Buffer.from(marker)]));
  const result = run(file); assert.equal(result.status, 1); assert.match(result.stdout, /1048566/);
});

test("scans inside zip entries", async (context) => {
  const { directory, marker, run } = setup(context); const zip = new yazl.ZipFile(); const file = path.join(directory, "package.lifeatlas");
  zip.addBuffer(Buffer.from(marker), "inside.txt"); zip.end(); await pipeline(zip.outputStream, fs.createWriteStream(file));
  const result = run(file); assert.equal(result.status, 1); assert.match(result.stdout, /!inside.txt/);
});

test("exits with 0 when nothing is found", (context) => {
  const { directory, run } = setup(context); const file = path.join(directory, "data.bin"); fs.writeFileSync(file, "clean data"); assert.equal(run(file).status, 0);
});
