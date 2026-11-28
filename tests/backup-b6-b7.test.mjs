import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createBackupService } from "../electron/main/backup/index.js";
import { createDialogs } from "../electron/main/dialogs.js";
import { sha256File } from "../electron/main/backup/files.js";
import { scanPlaintext } from "../tools/scan-plaintext.mjs";
import { requiredCollections } from "../src/backup/format.js";
import { projectViewItems } from "../src/domain/database.js";
import { recordDatabaseVersion } from "../src/domain/databaseHistory.js";
import { createPageVersion } from "../src/domain/pageHistory.js";
import { createDesktopBackupContext, backupVaultFactory, seedBackupVault, readBackupVaultState, fastBackupDeriveKey } from "./desktop/backup-helpers.mjs";

const backupPassword = "Backup-Pass-2026!";
const workspaceMarker = "LA-WORKSPACE-B6-PRIVATE-TITLE";
const unsortedRowIds = (workspace) => projectViewItems(workspace, workspace.databaseViews.find(({ id }) => id === "v-inline-table")).map(({ id }) => id);

function serviceFor(value) {
  const dialogs = createDialogs({ testHooksEnabled: true });
  const service = createBackupService({ ...value, dialogs, deriveKey: fastBackupDeriveKey, requestFlush: async () => true, requestConfirmation: async () => "confirmed" });
  return { service, dialogs };
}

async function fixture(context) {
  const source = await createDesktopBackupContext(context, { vaultService: backupVaultFactory() });
  const seeded = await seedBackupVault(source.vaultService);
  let workspace = source.workspaceService.readWorkspace();
  workspace.pages[0].title = workspaceMarker;
  workspace.databaseItems.reverse();
  const time = source.now();
  workspace.pageVersions = ["z-page-version", "a-page-version"].map((id) => createPageVersion(workspace.pages[0], { reason: "before-edit", now: time, id }));
  workspace = recordDatabaseVersion(workspace, "ds-inline", { now: time, idFactory: () => "z-database-version" });
  workspace = {
    ...workspace,
    databaseItems: workspace.databaseItems.map((item) => item.id === "i-1" ? { ...item, values: { ...item.values, done: false } } : item),
  };
  workspace = recordDatabaseVersion(workspace, "ds-inline", { now: time, idFactory: () => "a-database-version" });
  source.workspaceService.replaceWorkspace(workspace);
  const { service, dialogs } = serviceFor(source);
  const plainFile = path.join(source.dataRoot, "plain.lifeatlas");
  const encryptedFile = path.join(source.dataRoot, "encrypted.lifeatlas");
  dialogs.state.queue.showSaveDialog.push(plainFile, encryptedFile);
  await service.exportFull({ includeVault: true, encryptPassword: null });
  await service.exportFull({ includeVault: true, encryptPassword: backupPassword });
  await service.stop();
  return { source, seeded, plainFile, encryptedFile };
}

test("plain and encrypted archives restore exact SQLite order and unsorted rows", async (context) => {
  const value = await fixture(context);
  const expected = await readBackupVaultState(value.source.vaultService, value.seeded.ids);
  const expectedWorkspace = value.source.workspaceService.readWorkspace();
  assert.deepEqual(unsortedRowIds(expectedWorkspace), ["i-2", "i-1"]);
  assert.deepEqual(expectedWorkspace.pageVersions.map(({ id }) => id), ["z-page-version", "a-page-version"]);
  assert.deepEqual(expectedWorkspace.databaseVersions.map(({ id }) => id), ["z-database-version", "a-database-version"]);
  const restored = [];
  for (const file of [value.plainFile, value.encryptedFile]) {
    const destination = await createDesktopBackupContext(context, { seed: false, vaultService: backupVaultFactory() });
    const { service } = serviceFor(destination);
    try {
      let inspected = await service.inspectFile(file);
      if (inspected.needsPassword) inspected = await service.inspectWithPassword({ inspectId: inspected.inspectId, password: backupPassword });
      await service.restore({ token: inspected.token, restoreVault: true });
      await destination.vaultService.unlock({ password: value.seeded.password });
      assert.deepEqual(await readBackupVaultState(destination.vaultService, value.seeded.ids), expected);
      const workspace = destination.workspaceService.readWorkspace();
      for (const collection of requiredCollections(workspace.schemaVersion)) assert.deepEqual(workspace[collection], expectedWorkspace[collection], collection);
      assert.deepEqual(unsortedRowIds(workspace), ["i-2", "i-1"]);
      assert.deepEqual(workspace.ui, expectedWorkspace.ui);
      const assets = [];
      for (const asset of value.source.assetStore.list()) { const actual = await sha256File(destination.assetStore.filePath(asset.sha256)); assert.deepEqual(actual, await sha256File(value.source.assetStore.filePath(asset.sha256))); assets.push(actual); }
      restored.push({ workspace, vault: await readBackupVaultState(destination.vaultService, value.seeded.ids), assets });
    } finally { await service.stop(); }
  }
  assert.deepEqual(restored[1], restored[0]);
});

test("tampered encrypted packages are rejected", async (context) => {
  const value = await fixture(context);
  const bytes = fs.readFileSync(value.encryptedFile);
  const flipped = Buffer.from(bytes);
  flipped[Math.floor(flipped.length / 2)] ^= 1;
  const variants = [flipped, bytes.subarray(0, bytes.length - 16), Buffer.concat([bytes, Buffer.from([0])])];
  const destination = await createDesktopBackupContext(context, { seed: false });
  destination.workspaceService.checkpoint();
  const before = await sha256File(destination.workspaceService.filePath);
  const { service } = serviceFor(destination);
  try {
    for (const [index, variant] of variants.entries()) {
      const file = path.join(value.source.dataRoot, `tampered-${index}.lifeatlas`);
      fs.writeFileSync(file, variant);
      const requested = await service.inspectFile(file);
      assert.equal(requested.needsPassword, true);
      await assert.rejects(service.inspectWithPassword({ inspectId: requested.inspectId, password: backupPassword }), { code: "E_BAD_PASSWORD" });
      assert.deepEqual(await sha256File(destination.workspaceService.filePath), before);
      assert.deepEqual(fs.readdirSync(destination.dataRoot).filter((name) => name.startsWith(".staging-")), []);
    }
  } finally { await service.stop(); }
});

test("no marker appears in plain or encrypted packages", async (context) => {
  const value = await fixture(context);
  assert.equal(await scanPlaintext([value.plainFile, value.encryptedFile], value.seeded.markers), 0);
  assert.equal(await scanPlaintext([value.encryptedFile], [workspaceMarker]), 0);
  assert.ok(await scanPlaintext([value.plainFile], [workspaceMarker]) > 0);
});
