import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { exportFullBackup } from "../electron/main/backup/desktopExport.js";
import { createZipFileWriter, openZipFileReader } from "../electron/main/backup/zipNode.js";
import { verifyPackage } from "../src/backup/verify.js";
import { filesToWorkspace } from "../src/backup/serialize.js";
import { requiredCollections } from "../src/backup/format.js";
import { CURRENT_SCHEMA_VERSION } from "../src/persistence/migrations.js";
import { sortedEntities } from "./fixtures/backup-helpers.mjs";
import { createDesktopBackupContext } from "./desktop/backup-helpers.mjs";

const options = (fixture, targetPath) => ({ ...fixture, db: fixture.workspaceService.db, workspace: fixture.workspaceService.readWorkspace(), targetPath });

test("export writes a package that verifies and round-trips", async (context) => {
  const fixture = await createDesktopBackupContext(context);
  const workspace = { ...fixture.workspaceService.readWorkspace(), futureMetadata: { retained: true, values: [1, 2, 3] } };
  const targetPath = path.join(fixture.dataRoot, "roundtrip.lifeatlas");
  const result = await exportFullBackup({ ...options(fixture, targetPath), workspace });
  const reader = await openZipFileReader(result.filePath);
  try {
    const report = await verifyPackage(reader, { currentSchemaVersion: CURRENT_SCHEMA_VERSION });
    assert.equal(report.ok, true);
    const files = new Map();
    for (const filePath of reader.entries()) if (filePath.startsWith("workspace/")) files.set(filePath, await reader.read(filePath));
    const restored = filesToWorkspace((filePath) => files.get(filePath));
    for (const collection of requiredCollections(workspace.schemaVersion)) assert.deepEqual(sortedEntities(restored[collection]), sortedEntities(workspace[collection]), collection);
    assert.deepEqual(restored.ui, workspace.ui);
    assert.deepEqual(restored.futureMetadata, workspace.futureMetadata);
    assert.equal(restored.savedAt, workspace.savedAt);
    for (const asset of fixture.assetStore.list()) assert.equal(await reader.sha256(`assets/${asset.sha256}`), asset.sha256);
  } finally { reader.close(); }
});

test("export streams large attachments", async (context) => {
  const fixture = await createDesktopBackupContext(context, { large: true });
  const result = await exportFullBackup(options(fixture, path.join(fixture.dataRoot, "large.lifeatlas")));
  const reader = await openZipFileReader(result.filePath);
  try {
    const asset = "assets/59b2d8236470ac95f49928379d745005e4a1c0778c707530715e6c213cea4c17";
    assert.equal(reader.size(asset), 21 * 1048576);
    assert.equal(await reader.sha256(asset), asset.slice(7));
  } finally { reader.close(); }
});

test("cancel removes the partial file", async (context) => {
  const fixture = await createDesktopBackupContext(context);
  const controller = new AbortController();
  const targetPath = path.join(fixture.dataRoot, "cancelled.lifeatlas");
  await assert.rejects(exportFullBackup({ ...options(fixture, targetPath), signal: controller.signal, onProgress: () => controller.abort() }), { code: "E_CANCELLED" });
  assert.equal(fs.existsSync(targetPath), false);
  assert.deepEqual(fs.readdirSync(fixture.dataRoot).filter((name) => name.includes(".partial-")), []);
});

test("a failed verification removes the partial file", async (context) => {
  const fixture = await createDesktopBackupContext(context);
  const targetPath = path.join(fixture.dataRoot, "unchanged.lifeatlas");
  fs.writeFileSync(targetPath, "previous target");
  const createWriter = (target, writerOptions) => {
    const writer = createZipFileWriter(target, writerOptions);
    return { ...writer, async finish() { await writer.finish(); fs.truncateSync(target, 5); } };
  };
  await assert.rejects(exportFullBackup({ ...options(fixture, targetPath), createWriter }), { code: "E_IO" });
  assert.equal(fs.readFileSync(targetPath, "utf8"), "previous target");
  assert.deepEqual(fs.readdirSync(fixture.dataRoot).filter((name) => name.includes(".partial-")), []);
});
