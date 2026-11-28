import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createBackupService } from "../electron/main/backup/index.js";
import { createDialogs } from "../electron/main/dialogs.js";
import { sha256File } from "../electron/main/backup/files.js";
import { scanPlaintext } from "../tools/scan-plaintext.mjs";
import { createDesktopBackupContext, fastBackupDeriveKey } from "./desktop/backup-helpers.mjs";
import { createIsolatedDirectory, removeIsolatedDirectory } from "./desktop/helpers.mjs";
import { FIXTURE_TIME } from "./fixtures/full-workspace.mjs";

const backupPassword = "Backup-Pass-2026!";
const deferred = () => { let resolve; const promise = new Promise((settle) => { resolve = settle; }); return { promise, resolve }; };

async function fixture(context, { large = false, now = () => FIXTURE_TIME } = {}) {
  const value = await createDesktopBackupContext(context, { large, now });
  const folder = createIsolatedDirectory("encrypted-output");
  const filePath = path.join(folder, "encrypted.lifeatlas");
  const dialogs = createDialogs({ testHooksEnabled: true });
  dialogs.state.queue.showSaveDialog.push(filePath);
  const service = createBackupService({ ...value, dialogs, deriveKey: fastBackupDeriveKey, requestFlush: async () => true });
  context.after(async () => { await service.stop(); removeIsolatedDirectory(folder); });
  return { ...value, folder, filePath, dialogs, service };
}

test("encrypted export leaves no plaintext zip outside the data root", async (context) => {
  const value = await fixture(context);
  const workspace = value.workspaceService.readWorkspace();
  const marker = "LA-WORKSPACE-ENCRYPTED-PRIVATE-TITLE";
  workspace.pages[0].title = marker;
  value.workspaceService.replaceWorkspace(workspace);
  const result = await value.service.exportFull({ includeVault: false, encryptPassword: backupPassword });
  assert.equal(result.filePath, value.filePath);
  assert.deepEqual(fs.readdirSync(value.folder), ["encrypted.lifeatlas"]);
  assert.deepEqual(fs.readdirSync(value.dataRoot).filter((name) => name.startsWith(".staging-export-")), []);
  assert.equal(await scanPlaintext([value.folder], [marker]), 0);
  await value.service.stop();
});

test("encrypted packages need the right password", async (context) => {
  const value = await fixture(context);
  await value.service.exportFull({ includeVault: false, encryptPassword: backupPassword });
  const requested = await value.service.inspectFile(value.filePath);
  assert.equal(requested.needsPassword, true);
  await assert.rejects(value.service.inspectWithPassword({ inspectId: requested.inspectId, password: "wrong-backup-credential" }), { code: "E_BAD_PASSWORD" });
  assert.deepEqual(fs.readdirSync(value.dataRoot).filter((name) => name.startsWith(".staging-import-")), []);
  const inspected = await value.service.inspectWithPassword({ inspectId: requested.inspectId, password: backupPassword });
  assert.ok(inspected.token);
  assert.equal(inspected.summary.encrypted, true);
  assert.equal(inspected.summary.platform, "desktop");
  await value.service.stop();
  assert.deepEqual(fs.readdirSync(value.dataRoot).filter((name) => name.startsWith(".staging-import-")), []);
});

test("staging files are removed after inspect expires or restore finishes", async (context) => {
  let current = Date.parse(FIXTURE_TIME);
  const value = await fixture(context, { now: () => current });
  await value.service.exportFull({ includeVault: false, encryptPassword: backupPassword });
  const request = await value.service.inspectFile(value.filePath);
  const first = await value.service.inspectWithPassword({ inspectId: request.inspectId, password: backupPassword });
  assert.equal(fs.readdirSync(value.dataRoot).filter((name) => name.startsWith(".staging-import-")).length, 1);
  current += 600001;
  const next = await value.service.inspectFile(value.filePath);
  assert.deepEqual(fs.readdirSync(value.dataRoot).filter((name) => name.startsWith(".staging-import-")), []);
  await assert.rejects(value.service.restore({ token: first.token, restoreVault: false }), { code: "E_INVALID_ARGUMENT" });
  const valid = await value.service.inspectWithPassword({ inspectId: next.inspectId, password: backupPassword });
  await value.service.restore({ token: valid.token, restoreVault: false });
  assert.deepEqual(fs.readdirSync(value.dataRoot).filter((name) => name.startsWith(".staging-")), []);
  await value.service.stop();
});

test("encrypted export cancellation preserves the target and removes all staging", async (context) => {
  const value = await fixture(context, { large: true });
  fs.writeFileSync(value.filePath, "existing encrypted target");
  const before = await sha256File(value.filePath);
  value.service.onProgress((progress) => { if (progress.phase === "encrypt" && progress.done > 0) value.service.cancel({ jobId: progress.jobId }); });
  await assert.rejects(value.service.exportFull({ includeVault: false, encryptPassword: backupPassword }), { code: "E_CANCELLED" });
  assert.deepEqual(await sha256File(value.filePath), before);
  assert.deepEqual(fs.readdirSync(value.folder), ["encrypted.lifeatlas"]);
  assert.deepEqual(fs.readdirSync(value.dataRoot).filter((name) => name.startsWith(".staging-")), []);
  await value.service.stop();
});

test("shutdown waits for inspection decryption before removing its staging", async (context) => {
  const value = await fixture(context);
  await value.service.exportFull({ includeVault: false, encryptPassword: backupPassword });
  await value.service.stop();
  const destination = await createDesktopBackupContext(context, { seed: false });
  const entered = deferred();
  const released = deferred();
  const service = createBackupService({ ...destination, deriveKey: async (...args) => { entered.resolve(); await released.promise; return fastBackupDeriveKey(...args); } });
  const request = await service.inspectFile(value.filePath);
  const inspection = service.inspectWithPassword({ inspectId: request.inspectId, password: backupPassword });
  await entered.promise;
  let stopped = false;
  const stopping = service.stop().then(() => { stopped = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(stopped, false);
  released.resolve();
  assert.ok((await inspection).token);
  await stopping;
  assert.deepEqual(fs.readdirSync(destination.dataRoot).filter((name) => name.startsWith(".staging-")), []);
});

test("encrypted verification removes its plaintext staging immediately", async (context) => {
  const value = await fixture(context);
  await value.service.exportFull({ includeVault: false, encryptPassword: backupPassword });
  value.dialogs.state.queue.showOpenDialog.push([value.filePath]);
  const request = await value.service.verify();
  assert.equal(request.needsPassword, true);
  await assert.rejects(value.service.inspectWithPassword({ inspectId: request.inspectId, password: backupPassword }), { code: "E_INVALID_ARGUMENT" });
  const verified = await value.service.verifyWithPassword({ inspectId: request.inspectId, password: backupPassword });
  assert.equal(verified.report.ok, true);
  assert.equal(verified.report.summary.encrypted, true);
  assert.equal(Object.hasOwn(verified, "token"), false);
  assert.deepEqual(fs.readdirSync(value.dataRoot).filter((name) => name.startsWith(".staging-")), []);
  await assert.rejects(value.service.verifyWithPassword({ inspectId: request.inspectId, password: backupPassword }), { code: "E_INVALID_ARGUMENT" });
  await value.service.stop();
});
