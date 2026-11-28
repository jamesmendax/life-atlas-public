import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { restoreFromSnapshot } from "../electron/main/backup/desktopRestore.js";
import { sha256File } from "../electron/main/backup/files.js";
import { createAssetStore } from "../electron/main/storage/assetStore.js";
import { createSnapshotService, writeSnapshotMetadata } from "../electron/main/storage/snapshots.js";
import { initializeWorkspace, openWorkspaceDatabase, prepareWritable, StorageError } from "../electron/main/storage/workspaceDb.js";
import { createWorkspaceService } from "../electron/main/storage/workspaceService.js";
import { createVaultService, KDF_PARAMS } from "../electron/main/vault/index.js";
import { lastTwoGroups } from "../electron/main/vault/recoveryKey.js";
import { openVaultDatabase, VAULT_FORMAT_VERSION, writeHeader } from "../electron/main/vault/vaultStore.js";
import { CURRENT_SCHEMA_VERSION } from "../src/persistence/migrations.js";
import { fixtureBytes, FIXTURE_TIME } from "./fixtures/full-workspace.mjs";
import { NEXT_PASSWORD, TEST_PASSWORD } from "./fixtures/vault-items.mjs";

const oldWorkspace = JSON.parse(fs.readFileSync(new URL("./fixtures/workspace-v10.json", import.meta.url), "utf8"));

function writeWorkspace(file, workspace, update) {
  const db = openWorkspaceDatabase(file);
  try {
    prepareWritable(db);
    initializeWorkspace(db, workspace, { generation: "fixture-generation", now: FIXTURE_TIME });
    update?.(db);
  } finally { db.close(); }
}

function fixture(context) {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "life-atlas-snapshot-"));
  let migrations = 0;
  const workspaceService = createWorkspaceService({ dataRoot, now: FIXTURE_TIME, beforeMigration: () => { migrations++; } });
  const vaultService = createVaultService({ dataRoot, clock: { now: () => Date.parse(FIXTURE_TIME) } });
  const snapshotService = createSnapshotService({ dataRoot, workspaceService, vaultService, now: FIXTURE_TIME, appVersion: "0.1.0" });
  context.after(async () => {
    await snapshotService.stop();
    vaultService.closeDatabase();
    workspaceService.close();
    fs.rmSync(dataRoot, { recursive: true, force: true });
  });
  const directory = path.join(dataRoot, "snapshots", "fixture");
  fs.mkdirSync(directory, { recursive: true });
  writeWorkspace(workspaceService.filePath, { ...oldWorkspace, workspaceId: "live-workspace" });
  return {
    directory, migrations: () => migrations, dataRoot, workspaceService, vaultService, snapshotService, now: FIXTURE_TIME,
    metadata: () => writeSnapshotMetadata({ directory, createdAt: FIXTURE_TIME, reason: "manual", appVersion: "0.0.9", schemaVersion: 10 }),
  };
}

async function assertLiveWorkspaceUnopened(value, before) {
  assert.equal(value.workspaceService.status().loaded, false);
  assert.equal(value.migrations(), 0);
  assert.deepEqual(await sha256File(value.workspaceService.filePath), before);
  assert.deepEqual(fs.readdirSync(value.dataRoot).filter((name) => name.startsWith(".staging-")), []);
}

test("a future workspace snapshot is rejected before loading the current workspace", async (context) => {
  const value = fixture(context);
  writeWorkspace(path.join(value.directory, "workspace.db"), oldWorkspace, (db) => {
    db.prepare("UPDATE meta SET value=? WHERE key='schemaVersion'").run(String(CURRENT_SCHEMA_VERSION + 1));
    db.prepare("INSERT INTO entities VALUES (?,?,?,?)").run("futureCollection", "future", '{"id":"future"}', FIXTURE_TIME);
  });
  const snapshot = await value.metadata();
  const before = await sha256File(value.workspaceService.filePath);
  await assert.rejects(restoreFromSnapshot(snapshot.id, { restoreWorkspace: true, restoreVault: false }, value), { code: "E_UNSUPPORTED_VERSION" });
  await assertLiveWorkspaceUnopened(value, before);
});

test("a future vault snapshot is rejected before loading either live database", async (context) => {
  const value = fixture(context);
  writeWorkspace(path.join(value.directory, "workspace.db"), oldWorkspace);
  const db = openVaultDatabase(path.join(value.directory, "vault.db"));
  try {
    const saltB64 = Buffer.alloc(16).toString("base64");
    const blobB64 = Buffer.alloc(60).toString("base64");
    writeHeader(db, {
      kind: "life-atlas-vault", formatVersion: VAULT_FORMAT_VERSION + 1, padding: 512, vaultId: "26a36090-cede-4e72-b899-ec078cd48a52", createdAt: FIXTURE_TIME,
      kdf: { ...KDF_PARAMS, saltB64 },
      wraps: { password: { alg: "A256GCM", blobB64 }, recovery: { alg: "A256GCM", kdf: "hkdf-sha256", saltB64, blobB64 } },
    });
  } finally { db.close(); }
  const snapshot = await value.metadata();
  const before = await sha256File(value.workspaceService.filePath);
  await assert.rejects(restoreFromSnapshot(snapshot.id, { restoreWorkspace: true, restoreVault: true }, value), { code: "E_UNSUPPORTED_VERSION" });
  await assertLiveWorkspaceUnopened(value, before);
  assert.equal(value.vaultService.status().exists, false);
});

test("an older workspace and vault snapshot can be restored and unlocked", async (context) => {
  const value = fixture(context);
  const bytes = Buffer.from(fixtureBytes("snapshot-file", 1024));
  const assetsDir = path.join(value.dataRoot, "assets");
  let snapshotAsset;
  writeWorkspace(path.join(value.directory, "workspace.db"), { ...oldWorkspace, workspaceId: "historical-workspace" }, (db) => {
    const store = createAssetStore({ assetsDir, db, now: FIXTURE_TIME });
    const { assetId } = store.put({ bytes, mime: "application/octet-stream", name: "snapshot-file.bin" });
    snapshotAsset = store.get(assetId);
  });
  const sourceVault = createVaultService({ dataRoot: value.directory, clock: { now: () => Date.parse(FIXTURE_TIME) } });
  let recoveryKey;
  let itemId;
  try {
    ({ recoveryKey } = await sourceVault.create({ password: TEST_PASSWORD }));
    sourceVault.confirmRecoveryKey({ lastTwoGroups: lastTwoGroups(recoveryKey) });
    ({ summary: { id: itemId } } = sourceVault.createItem({
      input: { type: "secureNote", title: "历史凭据", fields: [{ label: "内容", kind: "multiline", value: "snapshot-test-value", sensitive: true }] },
    }));
  } finally { sourceVault.closeDatabase(); }
  const snapshot = await value.metadata();
  const before = await sha256File(value.workspaceService.filePath);

  await restoreFromSnapshot(snapshot.id, { restoreWorkspace: false, restoreVault: true }, value);
  await assertLiveWorkspaceUnopened(value, before);
  assert.equal(value.vaultService.status().locked, true);
  await value.vaultService.unlock({ password: TEST_PASSWORD });
  const { item } = value.vaultService.getItem({ id: itemId });
  const readSecret = () => value.vaultService.revealField({ id: itemId, fieldId: item.fields[0].id });
  assert.equal((await readSecret()).value, "snapshot-test-value");
  value.vaultService.lock();
  const recovered = await value.vaultService.unlockWithRecoveryKey({ recoveryKey, newPassword: NEXT_PASSWORD });
  value.vaultService.confirmRecoveryKey({ lastTwoGroups: lastTwoGroups(recovered.recoveryKey) });
  assert.equal((await readSecret()).value, "snapshot-test-value");

  const selection = { restoreWorkspace: true, restoreVault: true };
  await value.workspaceService.load();
  value.workspaceService.setMeta("lastFullBackupAt", FIXTURE_TIME);
  let swaps = 0;
  await assert.rejects(restoreFromSnapshot(snapshot.id, selection, { ...value, injectFailure() {
    if (++swaps === 2) throw new StorageError("E_IO", "injected vault swap failure");
  } }), { code: "E_IO" });
  assert.equal(value.workspaceService.readWorkspace().workspaceId, "live-workspace");
  await value.vaultService.unlock({ password: NEXT_PASSWORD });
  assert.equal((await readSecret()).value, "snapshot-test-value");

  await restoreFromSnapshot(snapshot.id, selection, value);
  const restored = value.workspaceService.readWorkspace();
  assert.equal(restored.schemaVersion, CURRENT_SCHEMA_VERSION);
  assert.equal(restored.workspaceId, "historical-workspace");
  assert.deepEqual(restored.pages.map(({ id, title }) => ({ id, title })), oldWorkspace.pages.map(({ id, title }) => ({ id, title })));
  const restoredAssets = createAssetStore({ assetsDir, db: value.workspaceService.db });
  assert.deepEqual(restoredAssets.list(), [snapshotAsset]);
  assert.deepEqual(fs.readFileSync(restoredAssets.filePath(snapshotAsset.sha256)), bytes);
  assert.equal(value.workspaceService.getMeta("lastFullBackupAt"), FIXTURE_TIME);
  assert.ok(value.snapshotService.listSnapshots().some((entry) => entry.reason === "pre-restore" && entry.includesVault && entry.includesWorkspace));
  await value.vaultService.unlock({ password: TEST_PASSWORD });
  assert.equal((await readSecret()).value, "snapshot-test-value");
});
