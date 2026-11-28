import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createBackupService } from "../electron/main/backup/index.js";
import { openZipFileReader } from "../electron/main/backup/zipNode.js";
import { createAssetStore } from "../electron/main/storage/assetStore.js";
import { ensureDataRootMarker } from "../electron/main/storage/dataRoot.js";
import { createSnapshotService } from "../electron/main/storage/snapshots.js";
import { createWorkspaceService } from "../electron/main/storage/workspaceService.js";
import { createVaultService } from "../electron/main/vault/index.js";
import { isPageArchived } from "../src/domain/archive.js";
import { blockContext } from "../src/domain/blockDocument.js";
import { previewDatabaseRestore, restoreDatabaseVersion } from "../src/domain/databaseHistory.js";
import { plainTextFromMaterialized } from "../src/domain/documentSemantics.js";
import { attachmentReferences } from "../src/domain/trash.js";

const directory = fileURLToPath(new URL("./fixtures/compatibility/schema-v20/", import.meta.url));
const fixture = JSON.parse(fs.readFileSync(path.join(directory, "fixture.json"), "utf8"));
const expected = fixture.expected.productV20;
const now = () => fixture.source.fixtureClock;
const appVersion = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function frozenFile(kind) {
  const { file, bytes, sha256: digest } = fixture.files[kind];
  assert.equal(path.basename(file), file);
  const resolved = path.join(directory, file);
  const contents = fs.readFileSync(resolved);
  assert.equal(contents.length, bytes);
  assert.equal(sha256(contents), digest);
  return resolved;
}

function entity(state, collection, id) {
  const value = state[collection].find((entry) => entry.id === id);
  assert.ok(value, `${collection} ${id} must be present`);
  return value;
}

function assertV20(workspace, store) {
  assert.equal(workspace.schemaVersion, 20);
  const archived = entity(workspace, "pages", expected.archive.pageId);
  assert.equal(archived.archivedAt, expected.archive.archivedAt);
  assert.equal(isPageArchived(workspace, archived), true);
  assert.equal(plainTextFromMaterialized(archived.content), expected.archive.body);

  const owner = entity(workspace, "pages", expected.occurrence.pageId);
  const block = blockContext(owner.content, expected.occurrence.blockId).block;
  assert.deepEqual(owner.databaseSourceIds, expected.occurrence.sourceIds);
  assert.deepEqual(JSON.parse(block.props.sourceIdsJson), expected.occurrence.sourceIds);
  assert.deepEqual(JSON.parse(block.props.viewIdsJson), expected.occurrence.viewIds);
  assert.deepEqual(expected.occurrence.viewIds.map((id) => entity(workspace, "databaseViews", id).sourceId), expected.occurrence.sourceIds);

  const live = entity(workspace, "dataSources", expected.history.sourceId);
  assert.deepEqual(live.recordLayout, expected.layout);
  assert.deepEqual(live.dependencyConfig, expected.dependencyConfig);
  const record = entity(workspace, "databaseItems", expected.record.itemId);
  assert.equal(record.parentItemId, expected.record.parentItemId);
  assert.deepEqual(record.dependencyIds, expected.record.dependencyIds);
  const page = entity(workspace, "pages", expected.record.pageId);
  assert.equal(plainTextFromMaterialized(page.content), expected.record.body);
  assert.equal(Object.hasOwn(record.values, expected.history.propertyId), false);
  assert.equal(live.properties.some(({ id }) => id === expected.history.propertyId), false);

  const version = entity(workspace, "databaseVersions", expected.history.id);
  for (const key of ["sourceId", "createdAt", "reason", "signature"]) assert.equal(version[key], expected.history[key]);
  const saved = version.items.find(({ id }) => id === record.id);
  assert.equal(Object.hasOwn(saved, "content"), false);
  assert.deepEqual(saved.dependencyIds, record.dependencyIds);
  assert.deepEqual(saved.values[expected.history.propertyId], [expected.history.attachment.id]);
  assert.equal(version.source.properties.find(({ id }) => id === expected.history.propertyId).type, "files");
  const attachment = entity(workspace, "attachments", expected.history.attachment.id);
  assert.equal(attachmentReferences({ ...workspace, databaseVersions: [] }).has(attachment.id), false);
  assert.equal(attachmentReferences(workspace).has(attachment.id), true);
  assert.equal(attachment.storageKey, expected.history.attachment.assetId);
  assert.equal(store.get(attachment.storageKey).size, expected.history.attachment.size);
  const asset = fs.readFileSync(store.filePath(attachment.storageKey));
  assert.equal(sha256(asset), expected.history.attachment.sha256);
  assert.equal(asset.toString("base64"), expected.history.attachment.base64);

  const impact = previewDatabaseRestore(workspace, version.sourceId, version.id);
  assert.equal(impact.ok, true, impact.reason);
  assert.ok(impact.attachmentIds.includes(attachment.id));
  const reverted = restoreDatabaseVersion(workspace, version.sourceId, version.id, { expectedSignature: impact.expectedSignature, now: now() });
  assert.deepEqual(entity(reverted, "databaseItems", record.id).values[expected.history.propertyId], [attachment.id]);
  assert.deepEqual(reverted.pages.map(({ id, content }) => [id, content]), workspace.pages.map(({ id, content }) => [id, content]));
}

async function fixtureDestination(context, profile) {
  const temp = fs.realpathSync(os.tmpdir());
  const run = fs.mkdtempSync(path.join(temp, "life-atlas-schema20-"));
  const dataRoot = path.join(run, "data");
  ensureDataRootMarker(dataRoot, { appVersion, now: now() });
  const workspace = createWorkspaceService({ dataRoot, appVersion, now,
    beforeUpgrade: (options) => snapshots.beforeUpgrade(options), beforeMigration: (options) => snapshots.beforeMigration(options) });
  const vault = createVaultService({ dataRoot, appVersion });
  const snapshots = createSnapshotService({ dataRoot, workspaceService: workspace, vaultService: vault, appVersion, now });
  const assets = createAssetStore({ assetsDir: path.join(dataRoot, "assets"), db: () => workspace.db, now });
  const backup = createBackupService({ dataRoot, workspaceService: workspace, vaultService: vault, snapshotService: snapshots, assetStore: assets, appVersion, now,
    requestFlush: async () => true, requestConfirmation: async () => "confirmed" });
  context.after(async () => {
    try { await backup.stop(); await snapshots.stop(); }
    finally {
      await vault.lock();
      vault.closeDatabase();
      workspace.close();
      assert.equal(path.dirname(fs.realpathSync(run)), temp);
      fs.rmSync(run, { recursive: true, force: true });
    }
  });
  if (profile) {
    const reader = await openZipFileReader(profile);
    try {
      for (const entry of reader.entries()) {
        assert.match(entry, /^(?:workspace\.db|vault\.db|assets\/[a-f0-9]{2}\/[a-f0-9]{64})$/);
        const resolved = path.join(dataRoot, entry);
        fs.mkdirSync(path.dirname(resolved), { recursive: true });
        fs.writeFileSync(resolved, await reader.read(entry), { flag: "wx" });
      }
    } finally { reader.close(); }
  }
  await workspace.load();
  return { workspace, vault, assets, backup };
}

test("frozen schema 20 live profile reopens archive, occurrence, history, layout, dependency and history-only file state", async (context) => {
  assert.equal(fixture.synthetic, true);
  assert.equal(fixture.source.release, "1.6.0 format candidate");
  assert.equal(fixture.source.packagedImplementation, true);
  assert.match(fixture.source.appAsarSha256, /^[a-f0-9]{64}$/);
  const { workspace, assets } = await fixtureDestination(context, frozenFile("liveProfile"));
  assertV20(workspace.readWorkspace(), assets);
});

for (const [kind, encrypted] of [["backupPlain", false], ["backupEncrypted", true]]) {
  test(`frozen schema 20 ${encrypted ? "encrypted" : "plain"} backup restores archive, occurrence, history and file payload`, async (context) => {
    const { workspace, vault, assets, backup } = await fixtureDestination(context);
    let inspection = await backup.inspectFile(frozenFile(kind));
    if (encrypted) {
      assert.equal(inspection.needsPassword, true);
      inspection = await backup.inspectWithPassword({ inspectId: inspection.inspectId, password: fixture.credentials.backupPassword });
    }
    assert.ok(inspection.token, JSON.stringify(inspection.problems));
    assert.equal(inspection.summary.schemaVersion, 20);
    await backup.restore({ token: inspection.token, restoreVault: true });
    assertV20(workspace.readWorkspace(), assets);
    const unlocked = await vault.unlock({ password: fixture.credentials.masterPassword });
    assert.equal(unlocked.summaries[0].id, fixture.expected.vault.itemId);
  });
}
