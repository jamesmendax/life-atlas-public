import test from "node:test";
import assert from "node:assert/strict";
import { CURRENT_SCHEMA_VERSION } from "../src/persistence/migrations.js";
import { verifyPackage } from "../src/backup/verify.js";
import { filesToWorkspace, jsonBytes, parseJsonBytes } from "../src/backup/serialize.js";
import { sha256Hex } from "../src/backup/hash.js";
import { backupFixture, memoryReader } from "./fixtures/backup-helpers.mjs";

const fixture = await backupFixture();
const verify = (files) => verifyPackage(memoryReader(files), { currentSchemaVersion: CURRENT_SCHEMA_VERSION });
const changedManifest = (change) => {
  const files = new Map(fixture.files);
  const manifest = parseJsonBytes(files.get("manifest.json"));
  change(manifest);
  files.set("manifest.json", jsonBytes(manifest));
  return files;
};
const hasProblem = (report, code, path) => {
  assert.equal(report.ok, false);
  assert.ok(report.problems.some((problem) => problem.code === code && (!path || problem.path === path)), JSON.stringify(report.problems));
};

test("a well formed package verifies ok", async () => {
  const report = await verify(fixture.files);
  assert.equal(report.ok, true);
  assert.deepEqual(report.problems, []);
});
test("collection order must exactly enumerate known collection and entity IDs", async () => {
  const filePath = "workspace/meta.json";
  const cases = [
    [(meta) => { meta.collectionOrder = null; }, /必须是对象/],
    [(meta) => { delete meta.collectionOrder.databaseItems; }, /缺少 databaseItems/],
    [(meta) => { meta.collectionOrder.future = []; }, /未知集合 future/],
    [(meta) => { meta.collectionOrder.databaseItems.pop(); }, /实体数量不符/],
    [(meta) => { meta.collectionOrder.databaseItems[0] = 1; }, /顺序 ID 无效/],
    [(meta) => { meta.collectionOrder.databaseItems[0] = meta.collectionOrder.databaseItems[1]; }, /重复 ID/],
    [(meta) => { meta.collectionOrder.databaseItems[0] = "unknown"; }, /未知 ID/],
  ];
  for (const [change, expected] of cases) {
    const meta = parseJsonBytes(fixture.files.get(filePath));
    change(meta);
    const bytes = jsonBytes(meta);
    const sha256 = await sha256Hex(bytes);
    const files = changedManifest((manifest) => Object.assign(manifest.files.find((entry) => entry.path === filePath), { sha256, size: bytes.length }));
    files.set(filePath, bytes);
    const report = await verify(files);
    hasProblem(report, "BAD_COLLECTION_ORDER", filePath);
    assert.match(report.problems.find((problem) => problem.code === "BAD_COLLECTION_ORDER").detail, expected);
    assert.throws(() => filesToWorkspace((entry) => files.get(entry)), expected);
  }
});
test("tampered manifest is rejected", async () => {
  const files = new Map(fixture.files);
  files.set("manifest.json", new TextEncoder().encode("{"));
  hasProblem(await verify(files), "BAD_MANIFEST");
});
for (const [name, filePath] of [
  ["one changed byte in a jsonl file is rejected", "workspace/entities/pages.jsonl"],
  ["one changed byte in an asset is rejected", [...fixture.files.keys()].find((filePath) => /^assets\/[a-f0-9]{64}$/.test(filePath))],
]) test(name, async () => {
  const files = new Map(fixture.files);
  const bytes = new Uint8Array(files.get(filePath));
  bytes[Math.floor(bytes.length / 2)] ^= 1;
  files.set(filePath, bytes);
  hasProblem(await verify(files), "HASH_MISMATCH", filePath);
});
test("a missing file is rejected", async () => {
  const files = new Map(fixture.files);
  files.delete("workspace/entities/pages.jsonl");
  hasProblem(await verify(files), "MISSING_FILE", "workspace/entities/pages.jsonl");
});
test("a traversal path is rejected", async () => {
  hasProblem(await verify(changedManifest((manifest) => manifest.files.push({ path: "../evil.txt", size: 0, sha256: "a".repeat(64) }))), "BAD_PATH", "../evil.txt");
});
test("a newer format version is rejected", async () => hasProblem(await verify(changedManifest((manifest) => { manifest.formatVersion = 2; })), "FORMAT_TOO_NEW"));
test("a newer schema version is rejected", async () => hasProblem(await verify(changedManifest((manifest) => { manifest.workspace.schemaVersion = CURRENT_SCHEMA_VERSION + 1; })), "SCHEMA_TOO_NEW"));
test("manifest must be the first entry", async () => {
  const files = new Map([["extra.txt", new Uint8Array()], ...fixture.files]);
  hasProblem(await verify(files), "MANIFEST_NOT_FIRST");
});
test("count mismatch is rejected", async () => hasProblem(await verify(changedManifest((manifest) => { manifest.workspace.counts.pages += 1; })), "COUNT_MISMATCH"));
test("extra files only produce a warning", async () => {
  const files = new Map(fixture.files);
  files.set("extra.txt", new Uint8Array());
  const report = await verify(files);
  assert.equal(report.ok, true);
  assert.equal(report.problems[0].code, "EXTRA_FILE");
});
test("warnings cannot hide corruption beyond the problem limit", async () => {
  const files = new Map(fixture.files);
  for (let index = 0; index < 60; index += 1) files.set(`extra-${index}.txt`, new Uint8Array());
  files.set("workspace/entities/pages.jsonl", new Uint8Array());
  const report = await verify(files);
  hasProblem(report, "SIZE_MISMATCH");
  assert.ok(report.problems.length <= 50);
});
