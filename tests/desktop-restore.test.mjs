import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { exportFullBackup } from "../electron/main/backup/desktopExport.js";
import { inspectBackupFile, restoreFromToken, restoreFromSnapshot } from "../electron/main/backup/desktopRestore.js";
import { createBackupInspector } from "../electron/main/backup/inspection.js";
import { createZipFileWriter } from "../electron/main/backup/zipNode.js";
import { sha256File } from "../electron/main/backup/files.js";
import { StorageError } from "../electron/main/storage/workspaceDb.js";
import { CURRENT_SCHEMA_VERSION } from "../src/persistence/migrations.js";
import { requiredCollections } from "../src/backup/format.js";
import { jsonBytes, parseJsonBytes } from "../src/backup/serialize.js";
import { exportBrowserBackup } from "../src/backup/browserBackup.js";
import { backupFixture, backupWorkspace, sortedEntities } from "./fixtures/backup-helpers.mjs";
import { fullWorkspaceAttachmentBytes, FIXTURE_TIME } from "./fixtures/full-workspace.mjs";
import { createDesktopBackupContext } from "./desktop/backup-helpers.mjs";

async function ready(context, { large = false, now = () => FIXTURE_TIME } = {}) {
  const source = await createDesktopBackupContext(context, { large, now });
  const destination = await createDesktopBackupContext(context, { seed: false, now });
  const filePath = path.join(source.dataRoot, "source.lifeatlas");
  await exportFullBackup({ ...source, db: source.workspaceService.db, workspace: source.workspaceService.readWorkspace(), targetPath: filePath });
  const inspector = createBackupInspector({ dataRoot: destination.dataRoot, now });
  context.after(() => inspector.stop());
  const inspect = () => inspectBackupFile(filePath, { inspector });
  const restoreContext = { ...destination, inspector, restoreVault: false };
  return { source, destination, filePath, inspector, inspect, restoreContext };
}

function assertWorkspaceEqual(actual, expected) {
  for (const collection of requiredCollections(expected.schemaVersion)) assert.deepEqual(sortedEntities(actual[collection]), sortedEntities(expected[collection]), collection);
  assert.deepEqual(actual.ui, expected.ui);
  assert.equal(actual.savedAt, expected.savedAt);
  assert.equal(actual.workspaceId, expected.workspaceId);
}

async function writeFiles(target, files) {
  const writer = createZipFileWriter(target);
  try { for (const [entryPath, bytes] of files) writer.addBuffer(entryPath, bytes); await writer.finish(); }
  catch (error) { await writer.abort(); throw error; }
}

test("restore replaces the workspace and keeps every entity", async (context) => {
  const fixture = await ready(context, { large: true });
  const oldGeneration = fixture.destination.workspaceService.getMeta("generation");
  fixture.destination.workspaceService.setMeta("lastFullBackupAt", "2026-09-01T12:00:00.000Z");
  const { token } = await fixture.inspect();
  await restoreFromToken(token, fixture.restoreContext);
  assertWorkspaceEqual(fixture.destination.workspaceService.readWorkspace(), fixture.source.workspaceService.readWorkspace());
  assert.notEqual(fixture.destination.workspaceService.getMeta("generation"), oldGeneration);
  assert.equal(fixture.destination.workspaceService.getMeta("lastFullBackupAt"), "2026-09-01T12:00:00.000Z");
  for (const asset of fixture.source.assetStore.list()) assert.deepEqual(await sha256File(fixture.destination.assetStore.filePath(asset.sha256)), await sha256File(fixture.source.assetStore.filePath(asset.sha256)));
});

test("restore converts a browser package", async (context) => {
  const destination = await createDesktopBackupContext(context, { seed: false });
  const bytesById = fullWorkspaceAttachmentBytes();
  const source = backupWorkspace();
  const exported = await exportBrowserBackup({ workspace: source, now: FIXTURE_TIME, appVersion: "0.1.0", readAttachmentBlob: (id) => bytesById.has(id) ? new Blob([bytesById.get(id)]) : null });
  const filePath = path.join(destination.dataRoot, "browser.lifeatlas");
  fs.writeFileSync(filePath, Buffer.from(await exported.blob.arrayBuffer()));
  const inspector = createBackupInspector({ dataRoot: destination.dataRoot, now: FIXTURE_TIME });
  context.after(() => inspector.stop());
  const inspected = await inspector.inspectFile(filePath);
  assert.equal(inspected.summary.platform, "browser");
  await restoreFromToken(inspected.token, { ...destination, inspector, restoreVault: false });
  const workspace = destination.workspaceService.readWorkspace();
  assert.equal(workspace.pages.find((page) => page.id === "p-b1").content.find((block) => block.type === "image").props.url, "life-asset://c414cd0e204de974f73753c7e28d7638e7b3691bb8b1a2bab6b25bb7fed7ce77");
  assert.match(workspace.pages.find((page) => page.id === "p-c1").icon, /^life-asset:\/\//);
  assert.match(workspace.pages.find((page) => page.id === "p-z1").cover.value, /^life-asset:\/\//);
  assert.equal(JSON.stringify(workspace).includes("#life-attachment="), false);
  assert.equal(JSON.stringify(workspace).includes("data:image/png;base64,"), false);
  assert.equal(workspace.attachments.every((attachment) => attachment.provider === "asset"), true);
  for (const asset of destination.assetStore.list()) assert.equal((await sha256File(destination.assetStore.filePath(asset.sha256))).sha256, asset.sha256);
});

test("restore upgrades a schema 10 package", async (context) => {
  const destination = await createDesktopBackupContext(context, { seed: false });
  const source = { ...JSON.parse(fs.readFileSync(new URL("./fixtures/workspace-v10.json", import.meta.url), "utf8")), workspaceId: "ws-frozen-v10" };
  const exported = await exportBrowserBackup({ workspace: source, now: FIXTURE_TIME, appVersion: "0.0.9", readAttachmentBlob: (id) => new Blob([fullWorkspaceAttachmentBytes().get(id)]) });
  const filePath = path.join(destination.dataRoot, "schema10.lifeatlas");
  fs.writeFileSync(filePath, Buffer.from(await exported.blob.arrayBuffer()));
  const inspector = createBackupInspector({ dataRoot: destination.dataRoot, now: FIXTURE_TIME });
  context.after(() => inspector.stop());
  const { token, summary } = await inspector.inspectFile(filePath);
  assert.equal(summary.schemaVersion, 10);
  await restoreFromToken(token, { ...destination, inspector, restoreVault: false });
  const restored = destination.workspaceService.readWorkspace();
  assert.equal(restored.schemaVersion, CURRENT_SCHEMA_VERSION);
  assert.equal(restored.workspaceId, "ws-frozen-v10");
  assert.equal(restored.pages.length, source.pages.length);
  assert.equal(restored.savedAt, source.savedAt);
});

test("broken packages never touch current data", async (context) => {
  const destination = await createDesktopBackupContext(context);
  destination.workspaceService.checkpoint();
  const before = await sha256File(destination.workspaceService.filePath);
  const fixture = await backupFixture();
  const changes = [
    (files) => files.set("manifest.json", Buffer.from("{")),
    (files) => files.delete("workspace/entities/pages.jsonl"),
    (files) => files.set("workspace/entities/pages.jsonl", Buffer.from("bad")),
    (files) => { const manifest = parseJsonBytes(files.get("manifest.json")); manifest.workspace.counts.pages += 1; files.set("manifest.json", jsonBytes(manifest)); },
    (files) => { const manifest = parseJsonBytes(files.get("manifest.json")); manifest.formatVersion += 1; files.set("manifest.json", jsonBytes(manifest)); },
    (files) => { const manifest = parseJsonBytes(files.get("manifest.json")); manifest.workspace.schemaVersion = CURRENT_SCHEMA_VERSION + 1; files.set("manifest.json", jsonBytes(manifest)); },
    (files) => { const manifest = parseJsonBytes(files.get("manifest.json")); manifest.files.push({ path: "../outside", size: 0, sha256: "a".repeat(64) }); files.set("manifest.json", jsonBytes(manifest)); },
  ];
  const inspector = createBackupInspector({ dataRoot: destination.dataRoot, now: FIXTURE_TIME });
  context.after(() => inspector.stop());
  for (let index = 0; index < changes.length; index += 1) {
    const files = new Map(fixture.files);
    changes[index](files);
    const filePath = path.join(destination.dataRoot, `broken-${index}.lifeatlas`);
    await writeFiles(filePath, files);
    const inspected = await inspector.inspectFile(filePath);
    assert.equal(inspected.token, undefined);
    assert.ok(inspected.problems.length > 0);
    assert.deepEqual(await sha256File(destination.workspaceService.filePath), before);
  }
});

test("a failure during swap leaves current data unchanged", async (context) => {
  const fixture = await ready(context);
  fixture.destination.workspaceService.checkpoint();
  const before = await sha256File(fixture.destination.workspaceService.filePath);
  const workspace = fixture.destination.workspaceService.readWorkspace();
  const { token } = await fixture.inspect();
  await assert.rejects(restoreFromToken(token, { ...fixture.restoreContext, injectFailure: (name) => { if (name === "restore-swap") throw new StorageError("E_IO", "injected swap failure"); } }), { code: "E_IO" });
  assert.deepEqual(await sha256File(fixture.destination.workspaceService.filePath), before);
  assertWorkspaceEqual(fixture.destination.workspaceService.readWorkspace(), workspace);
  assert.deepEqual(fs.readdirSync(fixture.destination.dataRoot).filter((name) => name.startsWith(".staging-") || name.includes(".replaced-")), []);
});

test("restore makes a pre-restore snapshot first", async (context) => {
  const fixture = await ready(context);
  const { token } = await fixture.inspect();
  await restoreFromToken(token, fixture.restoreContext);
  const snapshots = fixture.destination.snapshotService.listSnapshots();
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].reason, "pre-restore");
  assert.equal(snapshots[0].includesWorkspace, true);
});

test("a corrupted current database is kept aside after restore", async (context) => {
  const fixture = await ready(context);
  fixture.destination.workspaceService.close();
  const bad = Buffer.from("corrupted database bytes");
  fs.writeFileSync(fixture.destination.workspaceService.filePath, bad);
  await assert.rejects(fixture.destination.workspaceService.reopen(), { code: "E_CORRUPT" });
  const { token } = await fixture.inspect();
  await restoreFromToken(token, fixture.restoreContext);
  const kept = fs.readdirSync(fixture.destination.dataRoot).find((name) => name.startsWith("workspace.db.corrupt-"));
  assert.ok(kept);
  assert.deepEqual(fs.readFileSync(path.join(fixture.destination.dataRoot, kept)), bad);
  assertWorkspaceEqual(fixture.destination.workspaceService.readWorkspace(), fixture.source.workspaceService.readWorkspace());
});

test("restoring a snapshot brings back the earlier state", async (context) => {
  const fixture = await createDesktopBackupContext(context);
  const earlier = fixture.workspaceService.readWorkspace();
  const snapshot = await fixture.snapshotService.createSnapshot();
  const next = structuredClone(earlier);
  next.pages[0].title = "Changed after snapshot";
  fixture.workspaceService.replaceWorkspace(next);
  const generation = fixture.workspaceService.getMeta("generation");
  await restoreFromSnapshot(snapshot.id, { restoreWorkspace: true, restoreVault: false }, fixture);
  assertWorkspaceEqual(fixture.workspaceService.readWorkspace(), earlier);
  assert.notEqual(fixture.workspaceService.getMeta("generation"), generation);
  assert.ok(fixture.snapshotService.listSnapshots().some((entry) => entry.reason === "pre-restore"));
});

test("tokens are single use and expire after ten minutes", async (context) => {
  let current = Date.parse(FIXTURE_TIME);
  const fixture = await ready(context, { now: () => current });
  const first = await fixture.inspect();
  const second = await fixture.inspect();
  await restoreFromToken(first.token, fixture.restoreContext);
  await assert.rejects(restoreFromToken(first.token, fixture.restoreContext), { code: "E_INVALID_ARGUMENT" });
  current += 600001;
  await assert.rejects(restoreFromToken(second.token, fixture.restoreContext), { code: "E_INVALID_ARGUMENT" });
});

test("wal and shm files must be gone before swapping", async (context) => {
  const fixture = await ready(context);
  fixture.destination.workspaceService.checkpoint();
  const before = await sha256File(fixture.destination.workspaceService.filePath);
  const extra = new DatabaseSync(fixture.destination.workspaceService.filePath);
  extra.exec("PRAGMA journal_mode=WAL;");
  extra.prepare("SELECT value FROM meta LIMIT 1").get();
  try {
    const { token } = await fixture.inspect();
    await assert.rejects(restoreFromToken(token, fixture.restoreContext), { code: "E_IO" });
    assert.deepEqual(await sha256File(fixture.destination.workspaceService.filePath), before);
    assert.equal(fixture.destination.workspaceService.status().loaded, true);
  } finally { extra.close(); }
});

test("swap rollback preserves a committed WAL and original main file hash", async (context) => {
  const fixture = await ready(context);
  const changed = fixture.destination.workspaceService.readWorkspace();
  changed.pages[0].title = "Committed in WAL";
  fixture.destination.workspaceService.replaceWorkspace(changed);
  const before = await sha256File(fixture.destination.workspaceService.filePath);
  const generation = fixture.destination.workspaceService.getMeta("generation");
  const { token } = await fixture.inspect();
  await assert.rejects(restoreFromToken(token, { ...fixture.restoreContext, injectFailure: () => { throw new StorageError("E_IO", "failure"); } }), { code: "E_IO" });
  assert.deepEqual(await sha256File(fixture.destination.workspaceService.filePath), before);
  assert.equal(fixture.destination.workspaceService.readWorkspace().pages[0].title, "Committed in WAL");
  assert.equal(fixture.destination.workspaceService.getMeta("generation"), generation);
});

test("a source changed after inspection is rejected before current data changes", async (context) => {
  const fixture = await ready(context);
  fixture.destination.workspaceService.checkpoint();
  const before = await sha256File(fixture.destination.workspaceService.filePath);
  const { token } = await fixture.inspect();
  fs.appendFileSync(fixture.filePath, "changed after inspection");
  await assert.rejects(restoreFromToken(token, fixture.restoreContext), { code: "E_CORRUPT" });
  assert.deepEqual(await sha256File(fixture.destination.workspaceService.filePath), before);
  assert.equal(fixture.destination.snapshotService.listSnapshots().length, 0);
});

test("a secondary rollback failure retains the original recovery files", async (context) => {
  const fixture = await ready(context);
  fixture.destination.workspaceService.checkpoint();
  const before = await sha256File(fixture.destination.workspaceService.filePath);
  const { token } = await fixture.inspect();
  const originalCopy = fs.copyFileSync;
  const originalResume = fixture.destination.workspaceService.resumeWrites;
  let failed = false;
  let resumed = false;
  let failure;
  fixture.destination.workspaceService.resumeWrites = () => { resumed = true; originalResume(); };
  fs.copyFileSync = (source, target, ...options) => { if (failed && path.basename(source) === "original-workspace.db") throw new StorageError("E_IO", "secondary copy failure"); return originalCopy(source, target, ...options); };
  try {
    await assert.rejects(restoreFromToken(token, { ...fixture.restoreContext, injectFailure: () => { failed = true; throw new StorageError("E_IO", "first swap failure"); } }), (error) => {
      failure = error;
      assert.equal(error.code, "E_IO");
      assert.ok(error.recoveryDirectory);
      return true;
    });
    assert.deepEqual(await sha256File(path.join(failure.recoveryDirectory, "original-workspace.db")), before);
    assert.equal(resumed, false);
    assert.ok(fs.readdirSync(fixture.destination.dataRoot).some((name) => name.startsWith(".staging-")));
  } finally { fs.copyFileSync = originalCopy; fixture.destination.workspaceService.resumeWrites = originalResume; }
});
