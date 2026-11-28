import test from "node:test";
import assert from "node:assert/strict";
import { BACKUP_COLLECTIONS } from "../src/backup/format.js";
import { sha256Hex } from "../src/backup/hash.js";
import { filesToWorkspace, parseJsonBytes } from "../src/backup/serialize.js";
import { verifyPackage } from "../src/backup/verify.js";
import { CURRENT_SCHEMA_VERSION } from "../src/persistence/migrations.js";
import { fullWorkspaceAttachmentBytes } from "./fixtures/full-workspace.mjs";
import { backupFixture, backupWorkspace } from "./fixtures/backup-helpers.mjs";

test("manifest is the first entry and lists every file with correct hashes", async () => {
  const { reader, manifest } = await backupFixture();
  const entries = reader.entries();
  assert.equal(entries[0], "manifest.json");
  assert.equal(manifest.kind, "life-atlas-backup");
  assert.equal(manifest.app.platform, "browser");
  assert.deepEqual(entries.slice(1), manifest.files.map((file) => file.path));
  assert.deepEqual(entries.slice(1), [...entries.slice(1)].sort());
  assert.ok(entries.every((entry) => !entry.endsWith("/")));
  for (const file of manifest.files) {
    const bytes = await reader.read(file.path);
    assert.equal(file.size, bytes.length);
    assert.equal(file.sha256, await sha256Hex(bytes));
    if (/^assets\/[a-f0-9]{64}$/.test(file.path)) assert.equal(file.path, `assets/${file.sha256}`);
  }
});
test("export then parse returns every entity deeply equal", async () => {
  const { files, workspace } = await backupFixture();
  const parsed = filesToWorkspace((filePath) => files.get(filePath));
  for (const collection of BACKUP_COLLECTIONS) assert.deepEqual(parsed[collection], workspace[collection] ?? []);
  assert.deepEqual(parsed.ui, workspace.ui);
  assert.equal(parsed.savedAt, workspace.savedAt);
});
test("attachment bytes survive the round trip", async () => {
  const { files, attachments } = await backupFixture();
  const index = parseJsonBytes(files.get("assets/index.json"));
  assert.equal(index.length, 3);
  for (const entry of index) assert.deepEqual(files.get(`assets/${entry.sha256}`), attachments.get(entry.legacyAttachmentId));
});
test("missing attachment bytes are skipped and reported", async () => {
  const attachments = fullWorkspaceAttachmentBytes();
  attachments.delete("att-file");
  const fixture = await backupFixture({ attachments });
  assert.deepEqual(fixture.skippedAttachmentIds, ["att-file"]);
  assert.equal((await verifyPackage(fixture.reader, { currentSchemaVersion: CURRENT_SCHEMA_VERSION })).ok, true);
});
test("identical attachment contents are stored once", async () => {
  const workspace = backupWorkspace();
  workspace.attachments = [workspace.attachments[0], { ...workspace.attachments[0], id: "second-image", storageKey: "second-image" }];
  const original = fullWorkspaceAttachmentBytes().get("att-img");
  const fixture = await backupFixture({ workspace, attachments: new Map([["att-img", original], ["second-image", original]]) });
  assert.equal(fixture.manifest.assets.count, 1);
  assert.equal(fixture.reader.entries().filter((entry) => /^assets\/[a-f0-9]{64}$/.test(entry)).length, 1);
  assert.equal(parseJsonBytes(fixture.files.get("assets/index.json")).length, 2);
});
