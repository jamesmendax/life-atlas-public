import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import yauzl from "yauzl";
import { createZipFileWriter, openZipFileReader } from "../electron/main/backup/zipNode.js";
import { verifyPackage } from "../src/backup/verify.js";
import { CURRENT_SCHEMA_VERSION } from "../src/persistence/migrations.js";
import { jsonBytes, parseJsonBytes } from "../src/backup/serialize.js";
import { backupFixture, memoryReader } from "./fixtures/backup-helpers.mjs";
import { createIsolatedDirectory, removeIsolatedDirectory } from "./desktop/helpers.mjs";

function directory(context) {
  const root = createIsolatedDirectory("zip-node");
  context.after(() => removeIsolatedDirectory(root));
  return root;
}

async function writeFiles(target, files) {
  const writer = createZipFileWriter(target);
  try {
    for (const [entryPath, bytes] of files) writer.addBuffer(entryPath, bytes);
    await writer.finish();
  } catch (error) { await writer.abort(); throw error; }
}

test("writer keeps entry order and never writes directory entries", async (context) => {
  const target = path.join(directory(context), "order.zip");
  const writer = createZipFileWriter(target);
  writer.addBuffer("manifest.json", Buffer.from("{}"));
  writer.addBuffer("workspace/z.json", Buffer.from("z"));
  writer.addBuffer("workspace/a.json", Buffer.from("a"));
  assert.throws(() => writer.addBuffer("workspace/", Buffer.alloc(0)), { code: "E_INVALID_ARGUMENT" });
  assert.throws(() => writer.addBuffer("../bad", Buffer.alloc(0)), { code: "E_INVALID_ARGUMENT" });
  await writer.finish();
  const reader = await openZipFileReader(target);
  try { assert.deepEqual(reader.entries(), ["manifest.json", "workspace/z.json", "workspace/a.json"]); }
  finally { reader.close(); }
});

test("store and deflate follow the option", async (context) => {
  const target = path.join(directory(context), "compression.zip");
  const writer = createZipFileWriter(target);
  writer.addBuffer("store.bin", Buffer.alloc(1000, 1), { store: true });
  writer.addBuffer("deflate.json", Buffer.alloc(1000, 2), { store: false });
  await writer.finish();
  const zip = await yauzl.openPromise(target);
  const methods = [];
  for await (const entry of zip.eachEntry()) methods.push(entry.compressionMethod);
  assert.deepEqual(methods, [0, 8]);
});

test("reader hashes large entries by streaming", async (context) => {
  const root = directory(context);
  const bytes = Buffer.alloc(5 * 1024 * 1024, 0x37);
  const source = path.join(root, "source.bin");
  fs.writeFileSync(source, bytes);
  const target = path.join(root, "large.zip");
  const writer = createZipFileWriter(target);
  writer.addFile("assets/large", source, { store: true });
  await writer.finish();
  const reader = await openZipFileReader(target);
  try {
    assert.equal(reader.size("assets/large"), bytes.length);
    assert.deepEqual(await reader.stat("assets/large"), { size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
    assert.equal(await reader.sha256("assets/large"), createHash("sha256").update(bytes).digest("hex"));
  } finally { reader.close(); }
});

test("verifyPackage accepts the node reader", async (context) => {
  const root = directory(context);
  const fixture = await backupFixture();
  const target = path.join(root, "browser.lifeatlas");
  fs.writeFileSync(target, fixture.bytes);
  const reader = await openZipFileReader(target);
  try { assert.equal((await verifyPackage(reader, { currentSchemaVersion: CURRENT_SCHEMA_VERSION })).ok, true); }
  finally { reader.close(); }
  const mutateManifest = (change) => {
    const files = new Map(fixture.files);
    const manifest = parseJsonBytes(files.get("manifest.json"));
    change(manifest);
    files.set("manifest.json", jsonBytes(manifest));
    return files;
  };
  const mutateBytes = (filePath) => {
    const files = new Map(fixture.files);
    const bytes = new Uint8Array(files.get(filePath));
    bytes[Math.floor(bytes.length / 2)] ^= 1;
    files.set(filePath, bytes);
    return files;
  };
  const badManifest = new Map(fixture.files);
  badManifest.set("manifest.json", Buffer.from("{"));
  const missing = new Map(fixture.files);
  missing.delete("workspace/entities/pages.jsonl");
  const extra = new Map(fixture.files);
  extra.set("extra.txt", Buffer.alloc(0));
  const assetPath = [...fixture.files.keys()].find((entryPath) => /^assets\/[a-f0-9]{64}$/.test(entryPath));
  const cases = [
    badManifest, mutateBytes("workspace/entities/pages.jsonl"), mutateBytes(assetPath), missing,
    mutateManifest((manifest) => manifest.files.push({ path: "../evil.txt", size: 0, sha256: "a".repeat(64) })),
    mutateManifest((manifest) => { manifest.formatVersion = 2; }),
    mutateManifest((manifest) => { manifest.workspace.schemaVersion = CURRENT_SCHEMA_VERSION + 1; }),
    new Map([["extra.txt", Buffer.alloc(0)], ...fixture.files]),
    mutateManifest((manifest) => { manifest.workspace.counts.pages += 1; }), extra,
    mutateManifest((manifest) => { manifest.files.find((entry) => entry.path === "workspace/meta.json").size += 1; }),
  ];
  for (let index = 0; index < cases.length; index += 1) {
    const file = path.join(root, `broken-${index}.lifeatlas`);
    await writeFiles(file, cases[index]);
    const expected = await verifyPackage(memoryReader(cases[index]), { currentSchemaVersion: CURRENT_SCHEMA_VERSION });
    const nodeReader = await openZipFileReader(file);
    try {
      const actual = await verifyPackage(nodeReader, { currentSchemaVersion: CURRENT_SCHEMA_VERSION });
      assert.equal(actual.ok, expected.ok, `case ${index}`);
      assert.deepEqual(actual.problems.map((problem) => problem.code), expected.problems.map((problem) => problem.code), `case ${index}`);
    } finally { nodeReader.close(); }
  }
});
