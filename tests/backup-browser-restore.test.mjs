import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CURRENT_SCHEMA_VERSION } from "../src/persistence/migrations.js";
import { inspectBrowserBackup, restoreBrowserBackup, prunePreRestoreCopies } from "../src/backup/browserBackup.js";
import { backupFixture, memoryStorage } from "./fixtures/backup-helpers.mjs";
import { FIXTURE_TIME } from "./fixtures/full-workspace.mjs";

const fixture = await backupFixture();
const key = "life-atlas.workspace.testing";
const inspect = (bytes = fixture.bytes, now = FIXTURE_TIME) => inspectBrowserBackup(bytes, { fileName: "test.lifeatlas", currentSchemaVersion: CURRENT_SCHEMA_VERSION, now });
const options = (storage, extra = {}) => ({ storage, storageKey: key, now: FIXTURE_TIME, writeAttachmentBlob: async () => {}, readAttachmentBlob: async () => null, removeAttachmentBlob: async () => {}, ...extra });

test("inspect returns a summary for a valid package", async () => {
  const result = await inspect();
  assert.ok(result.token);
  assert.deepEqual(result.problems, []);
  assert.equal(result.summary.encrypted, false);
  assert.equal(result.summary.platform, "browser");
  assert.equal(result.summary.fileName, "test.lifeatlas");
  assert.deepEqual(result.summary.counts, fixture.manifest.workspace.counts);
});
test("inspect returns problems and no token for a broken package", async () => {
  const result = await inspect(new Uint8Array([1, 2, 3]));
  assert.equal(result.token, null);
  assert.equal(result.problems[0].code, "NOT_ZIP");
});
test("restore writes a pre-restore copy, attachments and then the workspace", async () => {
  const calls = [];
  const storage = memoryStorage({ [key]: '{"pages":[]}' }, (name) => calls.push(name));
  const { token } = await inspect();
  await restoreBrowserBackup(token, options(storage, { writeAttachmentBlob: async (id) => calls.push(`attachment:${id}`) }));
  assert.ok(calls[0].startsWith("life-atlas.workspace.pre-restore-"));
  assert.deepEqual(calls.slice(1, -1), ["attachment:att-img", "attachment:att-file", "attachment:att-orphan"]);
  assert.equal(calls.at(-1), key);
  assert.equal(JSON.parse(storage.getItem(key)).schemaVersion, CURRENT_SCHEMA_VERSION);
});
test("restore keeps at most three pre-restore copies", async () => {
  const storage = memoryStorage({ [key]: '{"pages":[]}' });
  for (let index = 1; index <= 4; index += 1) storage.setItem(`life-atlas.workspace.pre-restore-2026-09-0${index}`, "{}");
  await restoreBrowserBackup((await inspect()).token, options(storage));
  assert.equal([...storage.values.keys()].filter((name) => name.includes("pre-restore-")).length, 3);
  assert.deepEqual(prunePreRestoreCopies(storage), []);
});
test("restore leaves current data untouched when the pre-restore copy cannot be written", async () => {
  const storage = memoryStorage({ [key]: "original" }, (name) => { if (name.includes("pre-restore-")) throw new Error("quota"); });
  let writes = 0;
  await assert.rejects(restoreBrowserBackup((await inspect()).token, options(storage, { writeAttachmentBlob: async () => { writes += 1; } })), /空间不足/);
  assert.equal(storage.getItem(key), "original");
  assert.equal(writes, 0);
});
test("restore leaves current data untouched when an attachment write fails", async () => {
  const original = JSON.stringify({ attachments: [{ id: "att-img", storageKey: "att-img" }] });
  const storage = memoryStorage({ [key]: original });
  const blobs = new Map([["att-img", new Blob(["old binary"])]]);
  const error = restoreBrowserBackup((await inspect()).token, options(storage, {
    readAttachmentBlob: async (id) => blobs.get(id),
    writeAttachmentBlob: async (id, blob) => { if (id === "att-file") throw new Error("disk full"); blobs.set(id, blob); },
    removeAttachmentBlob: async (id) => blobs.delete(id),
  }));
  await assert.rejects(error, /disk full/);
  assert.equal(storage.getItem(key), original);
  assert.equal(await blobs.get("att-img").text(), "old binary");
  assert.equal(blobs.size, 1);
});
test("restore preserves colliding old attachment bytes through successful restore", async () => {
  const original = JSON.stringify({ attachments: [{ id: "att-img", storageKey: "att-img" }] });
  const storage = memoryStorage({ [key]: original });
  const blobs = new Map([["att-img", new Blob(["old binary"])]]);
  const result = await restoreBrowserBackup((await inspect()).token, options(storage, {
    readAttachmentBlob: async (id) => blobs.get(id),
    writeAttachmentBlob: async (id, blob) => blobs.set(id, blob),
    removeAttachmentBlob: async (id) => blobs.delete(id),
  }));
  assert.equal(await blobs.get("att-img").text(), "old binary");
  const restored = result.workspace.attachments.find((attachment) => attachment.id === "att-img");
  assert.notEqual(restored.storageKey, "att-img");
  assert.deepEqual(new Uint8Array(await blobs.get(restored.storageKey).arrayBuffer()), fixture.attachments.get("att-img"));
});
test("restore rolls staged attachments back when final storage publication fails", async () => {
  const storage = memoryStorage({ [key]: "original" }, (name) => { if (name === key) throw new Error("quota"); });
  const blobs = new Map();
  await assert.rejects(restoreBrowserBackup((await inspect()).token, options(storage, {
    writeAttachmentBlob: async (id, blob) => blobs.set(id, blob),
    removeAttachmentBlob: async (id) => blobs.delete(id),
  })), /quota/);
  assert.equal(storage.getItem(key), "original");
  assert.equal(blobs.size, 0);
});
test("a token can be used only once and expires after ten minutes", async () => {
  const storage = memoryStorage();
  const first = await inspect();
  await restoreBrowserBackup(first.token, options(storage));
  await assert.rejects(restoreBrowserBackup(first.token, options(storage)), /备份已过期/);
  const second = await inspect();
  await assert.rejects(restoreBrowserBackup(second.token, options(storage, { now: Date.parse(FIXTURE_TIME) + 600000 })), /备份已过期/);
});
test("schema 10 package restores and upgrades", async () => {
  const workspace = JSON.parse(readFileSync(new URL("./fixtures/workspace-v10.json", import.meta.url), "utf8"));
  workspace.workspaceId = "ws-v10";
  const exported = await backupFixture({ workspace });
  const storage = memoryStorage();
  const result = await restoreBrowserBackup((await inspect(exported.bytes)).token, options(storage));
  assert.equal(result.workspace.schemaVersion, CURRENT_SCHEMA_VERSION);
  assert.ok(result.workspace.pages.length >= workspace.pages.length);
});
