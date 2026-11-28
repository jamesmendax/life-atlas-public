import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createBackupService } from "../electron/main/backup/index.js";
import { createDialogs } from "../electron/main/dialogs.js";
import { sha256File } from "../electron/main/backup/files.js";
import { requiredCollections } from "../src/backup/format.js";
import { sortedEntities } from "./fixtures/backup-helpers.mjs";
import { createDesktopBackupContext, backupVaultFactory, seedBackupVault, readBackupVaultState, seedGigabyteAssets } from "./desktop/backup-helpers.mjs";
import { createIsolatedDirectory, removeIsolatedDirectory } from "./desktop/helpers.mjs";

const backupPassword = "Backup-Pass-2026!";
const budgetBytes = 300 * 1048576;

async function measure(context, label, operation) {
  const baselineRss = process.memoryUsage().rss;
  let peakRss = baselineRss;
  const sample = () => { peakRss = Math.max(peakRss, process.memoryUsage().rss); };
  const timer = setInterval(sample, 100);
  let value;
  try { value = await operation(); }
  finally { sample(); clearInterval(timer); }
  const delta = peakRss - baselineRss;
  context.diagnostic(`${label}=${(delta / 1048576).toFixed(2)}; baselineRss=${baselineRss}; peakRss=${peakRss}; sampleMs=100`);
  assert.ok(delta < budgetBytes, `${label}: ${delta} bytes exceeds the strict ${budgetBytes} byte budget`);
  return value;
}

function serviceFor(value, dialogs = createDialogs({ testHooksEnabled: true })) {
  return { dialogs, service: createBackupService({ ...value, dialogs, requestFlush: async () => true, requestConfirmation: async () => "confirmed" }) };
}

function assertGigabyteAssets(value, hashes) {
  const entries = value.assetStore.list().filter((entry) => hashes.includes(entry.sha256));
  assert.equal(entries.length, 4);
  assert.equal(entries.reduce((total, entry) => total + entry.size, 0), 1073741824);
  for (const entry of entries) assert.equal(fs.statSync(value.assetStore.filePath(entry.sha256)).size, 268435456);
}

test("export of one gigabyte stays within memory budget", async (context) => {
  const source = await createDesktopBackupContext(context);
  const hashes = seedGigabyteAssets(source);
  assertGigabyteAssets(source, hashes);
  const folder = createIsolatedDirectory("plain-gigabyte-output");
  const filePath = path.join(folder, "gigabyte.lifeatlas");
  const { service, dialogs } = serviceFor(source);
  context.after(async () => { await service.stop(); removeIsolatedDirectory(folder); });
  dialogs.state.queue.showSaveDialog.push(filePath);
  const exported = await measure(context, "WP05_EXPORT_PEAK_MB", () => service.exportFull({ includeVault: false, encryptPassword: null }));
  assert.equal(exported.filePath, filePath);
  assert.equal(exported.manifest.assets.totalBytes >= 1073741824, true);
  assert.equal(fs.statSync(filePath).size > 1000000000, true);
  const verified = await service.inspectFile(filePath, { verifyOnly: true });
  assert.equal(verified.report.ok, true);
  const cancelledPath = path.join(folder, "cancelled.lifeatlas");
  dialogs.state.queue.showSaveDialog.push(cancelledPath);
  let cancelledBytes = 0;
  const unsubscribe = service.onProgress((progress) => {
    if (progress.phase !== "write" || cancelledBytes) return;
    const partial = fs.readdirSync(folder).find((name) => name.startsWith("cancelled.lifeatlas.partial-"));
    const size = partial ? fs.statSync(path.join(folder, partial)).size : 0;
    if (size >= 1048576) { cancelledBytes = size; service.cancel({ jobId: progress.jobId }); }
  });
  try { await assert.rejects(service.exportFull({ includeVault: false, encryptPassword: null }), { code: "E_CANCELLED" }); }
  finally { unsubscribe(); }
  assert.ok(cancelledBytes >= 1048576);
  assert.equal(fs.existsSync(cancelledPath), false);
  assert.deepEqual(fs.readdirSync(folder), ["gigabyte.lifeatlas"]);
  context.diagnostic(`WP05_CANCELLED_WRITTEN_BYTES=${cancelledBytes}; actual fixture bytes=1073741824`);
  await service.stop();
});

test("encrypted export and restore of one gigabyte stay within memory budget", async (context) => {
  const source = await createDesktopBackupContext(context, { vaultService: backupVaultFactory({ production: true }) });
  const seeded = await seedBackupVault(source.vaultService);
  const expectedVault = await readBackupVaultState(source.vaultService, seeded.ids);
  const hashes = seedGigabyteAssets(source);
  assertGigabyteAssets(source, hashes);
  const expectedWorkspace = source.workspaceService.readWorkspace();
  const folder = createIsolatedDirectory("encrypted-gigabyte-output");
  const filePath = path.join(folder, "gigabyte-encrypted.lifeatlas");
  const exporting = serviceFor(source);
  exporting.dialogs.state.queue.showSaveDialog.push(filePath);
  context.after(async () => { await exporting.service.stop(); removeIsolatedDirectory(folder); });
  await measure(context, "WP08_EXPORT_PEAK_MB", () => exporting.service.exportFull({ includeVault: true, encryptPassword: backupPassword }));
  assert.deepEqual(fs.readdirSync(folder), ["gigabyte-encrypted.lifeatlas"]);
  assert.deepEqual(fs.readdirSync(source.dataRoot).filter((name) => name.startsWith(".staging-")), []);
  await exporting.service.stop();
  const destination = await createDesktopBackupContext(context, { seed: false, vaultService: backupVaultFactory({ production: true }) });
  const restoring = serviceFor(destination);
  context.after(() => restoring.service.stop());
  await measure(context, "WP08_RESTORE_PEAK_MB", async () => {
    const requested = await restoring.service.inspectFile(filePath);
    const inspected = await restoring.service.inspectWithPassword({ inspectId: requested.inspectId, password: backupPassword });
    assert.equal(inspected.summary.encrypted, true);
    await restoring.service.restore({ token: inspected.token, restoreVault: true });
  });
  const actualWorkspace = destination.workspaceService.readWorkspace();
  for (const collection of requiredCollections(expectedWorkspace.schemaVersion)) assert.deepEqual(sortedEntities(actualWorkspace[collection]), sortedEntities(expectedWorkspace[collection]), collection);
  assert.deepEqual(actualWorkspace.ui, expectedWorkspace.ui);
  assert.equal(actualWorkspace.workspaceId, expectedWorkspace.workspaceId);
  assert.equal(actualWorkspace.savedAt, expectedWorkspace.savedAt);
  assertGigabyteAssets(destination, hashes);
  for (const entry of source.assetStore.list()) assert.deepEqual(await sha256File(destination.assetStore.filePath(entry.sha256)), await sha256File(source.assetStore.filePath(entry.sha256)));
  assert.equal(destination.vaultService.status().locked, true);
  await destination.vaultService.unlock({ password: seeded.password });
  assert.deepEqual(await readBackupVaultState(destination.vaultService, seeded.ids), expectedVault);
  assert.equal(expectedVault.items.length, 10);
  assert.deepEqual(fs.readdirSync(destination.dataRoot).filter((name) => name.startsWith(".staging-")), []);
  context.diagnostic("WP08_GIGABYTE_BYTES=1073741824; vaultItems=10; productionKdfMemoryKiB=131072");
  await restoring.service.stop();
});
