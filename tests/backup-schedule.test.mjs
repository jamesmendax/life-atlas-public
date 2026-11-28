import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { createBackupSchedule, automaticBackupName } from "../electron/main/backup/schedule.js";
import { createBackupService } from "../electron/main/backup/index.js";
import { createDialogs } from "../electron/main/dialogs.js";
import { StorageError } from "../electron/main/storage/workspaceDb.js";
import { createIsolatedDirectory, removeIsolatedDirectory } from "./desktop/helpers.mjs";
import { createDesktopBackupContext, backupVaultFactory, seedBackupVault, assertBackupDataRootsEqual } from "./desktop/backup-helpers.mjs";

const backupPassword = "Backup-Pass-2026!";
const inputFor = (folder, extra = {}) => ({ enabled: true, folder, weekday: 0, hour: 20, keepLast: 8, includeVault: false, encryptPassword: null, ...extra });

function safeStorageFixture() {
  const key = randomBytes(32);
  const calls = [];
  return {
    calls,
    isEncryptionAvailable: () => true,
    encryptString(value) {
      calls.push("encrypt");
      const nonce = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, nonce);
      return Buffer.concat([nonce, cipher.update(value, "utf8"), cipher.final(), cipher.getAuthTag()]);
    },
    decryptString(bytes) {
      calls.push("decrypt");
      const cipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
      cipher.setAuthTag(bytes.subarray(bytes.length - 16));
      return Buffer.concat([cipher.update(bytes.subarray(12, bytes.length - 16)), cipher.final()]).toString("utf8");
    },
  };
}

function fixture(context, extra = {}) {
  const dataRoot = createIsolatedDirectory("schedule-data");
  const folder = createIsolatedDirectory("schedule-output");
  let current = new Date(2026, 10, 1, 19, 59).getTime();
  const runs = [];
  const confirmations = [];
  const logs = [];
  const safeStorage = safeStorageFixture();
  const options = { dataRoot, now: () => current, safeStorage, requestConfirmation: async (args) => { confirmations.push(args); return "confirmed"; }, exportBackup: async (args) => { runs.push(args); fs.writeFileSync(args.targetPath, "automatic-backup"); return { filePath: args.targetPath }; }, logger: (event, details) => logs.push({ event, ...details }), ...extra };
  const service = createBackupSchedule(options);
  context.after(async () => { await service.stop(); removeIsolatedDirectory(dataRoot); removeIsolatedDirectory(folder); });
  return { dataRoot, folder, service, options, runs, confirmations, logs, safeStorage, setClock: (date) => { current = date.getTime(); } };
}

test("the next run is due at the weekly slot", async (context) => {
  const value = fixture(context);
  await value.service.setSchedule(inputFor(value.folder));
  assert.deepEqual(await value.service.checkNow(), { ran: false, filePath: null });
  value.setClock(new Date(2026, 10, 1, 20));
  assert.equal((await value.service.checkNow()).ran, true);
  assert.equal(path.basename(value.runs[0].targetPath), "Life-Atlas-自动备份-20261101-2000.lifeatlas");
  assert.equal((await value.service.checkNow()).ran, false);
  value.setClock(new Date(2026, 10, 8, 20));
  assert.equal((await value.service.checkNow()).ran, true);
  assert.equal(value.runs.length, 2);
});

test("a missed slot runs at the next check after startup", async (context) => {
  const value = fixture(context);
  await value.service.setSchedule(inputFor(value.folder));
  await value.service.stop();
  value.setClock(new Date(2026, 10, 2, 11));
  const restarted = createBackupSchedule(value.options);
  try {
    assert.equal((await restarted.checkNow()).ran, true);
    assert.equal((await restarted.checkNow()).ran, false);
  } finally { await restarted.stop(); }
});

test("keepLast removes only automatic backups", async (context) => {
  const value = fixture(context);
  await value.service.setSchedule(inputFor(value.folder));
  for (let index = 1; index <= 9; index += 1) fs.writeFileSync(path.join(value.folder, `Life-Atlas-自动备份-202610${String(index).padStart(2, "0")}-2000.lifeatlas`), "old");
  fs.writeFileSync(path.join(value.folder, automaticBackupName(new Date(2026, 10, 1, 20))), "previous-target");
  for (const name of ["manual.lifeatlas", "Life-Atlas-自动备份-20261101-2000-copy.lifeatlas"]) fs.writeFileSync(path.join(value.folder, name), "preserve");
  value.setClock(new Date(2026, 10, 1, 20));
  await value.service.checkNow();
  const files = fs.readdirSync(value.folder);
  assert.equal(files.filter((name) => /^Life-Atlas-自动备份-\d{8}-\d{4}\.lifeatlas$/.test(name)).length, 8);
  assert.equal(files.includes("Life-Atlas-自动备份-20261001-2000.lifeatlas"), false);
  assert.equal(files.includes("Life-Atlas-自动备份-20261002-2000.lifeatlas"), false);
  assert.equal(fs.readFileSync(path.join(value.folder, "manual.lifeatlas"), "utf8"), "preserve");
  assert.equal(fs.readFileSync(path.join(value.folder, "Life-Atlas-自动备份-20261101-2000-copy.lifeatlas"), "utf8"), "preserve");
});

test("enabling vault backups asks for confirmation once", async (context) => {
  const value = fixture(context);
  await value.service.setSchedule(inputFor(value.folder, { includeVault: true }));
  await value.service.setSchedule(inputFor(value.folder, { includeVault: true, keepLast: 9 }));
  assert.equal(value.confirmations.length, 1);
  assert.equal(value.confirmations[0].kind, "schedule-backup");
  value.setClock(new Date(2026, 10, 1, 20));
  await value.service.checkNow();
  assert.equal(value.confirmations.length, 1);
  assert.equal(value.runs[0].includeVault, true);
});

test("workspace schedule updates preserve the encrypted key and cannot change a vault schedule", async (context) => {
  const value = fixture(context);
  const file = path.join(value.dataRoot, "backup-schedule.json");
  await value.service.setSchedule(inputFor(value.folder, { encryptPassword: backupPassword }));
  const before = JSON.parse(fs.readFileSync(file, "utf8"));
  const { schedule } = value.service.updateWorkspaceSchedule({ hour: 21, keepLast: 4 });
  const after = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(schedule.encrypt, true);
  assert.equal(after.encryptedPasswordB64, before.encryptedPasswordB64);
  assert.deepEqual(value.safeStorage.calls, ["encrypt"]);
  assert.equal(schedule.hour, 21);
  assert.equal(schedule.keepLast, 4);
  assert.equal(schedule.folder, value.folder);
  value.setClock(new Date(2026, 10, 1, 21));
  assert.equal((await value.service.checkNow()).ran, true);
  assert.equal(value.runs[0].includeVault, false);
  assert.deepEqual(value.safeStorage.calls, ["encrypt", "decrypt"]);

  await value.service.setSchedule(inputFor(value.folder, { includeVault: true, encryptPassword: backupPassword }));
  const protectedSchedule = fs.readFileSync(file, "utf8");
  assert.throws(() => value.service.updateWorkspaceSchedule({ hour: 10 }), { code: "E_FORBIDDEN" });
  assert.throws(() => value.service.updateWorkspaceSchedule({ includeVault: false }), { code: "E_INVALID_ARGUMENT" });
  assert.throws(() => value.service.updateWorkspaceSchedule({ encryptPassword: null }), { code: "E_INVALID_ARGUMENT" });
  assert.equal(fs.readFileSync(file, "utf8"), protectedSchedule);
  assert.equal(value.confirmations.length, 1);
});

test("a workspace-only scheduled export succeeds without calling the vault service", async (context) => {
  const source = await createDesktopBackupContext(context);
  const folder = createIsolatedDirectory("workspace-schedule-output");
  const vaultCalls = [];
  const vaultService = {
    status() { vaultCalls.push("status"); return { exists: true }; },
    exportCiphertext() { vaultCalls.push("export"); },
  };
  let current = new Date(2026, 10, 1, 19, 59).getTime();
  const service = createBackupService({ ...source, vaultService, now: () => current, requestFlush: async () => true });
  context.after(async () => { await service.stop(); removeIsolatedDirectory(folder); });
  await service.updateWorkspaceSchedule({ enabled: true, folder, weekday: 0, hour: 20 });
  current = new Date(2026, 10, 1, 20).getTime();
  const result = await service.schedule.checkNow();
  assert.equal(result.ran, true);
  assert.ok(result.filePath);
  const inspected = await service.inspectFile(result.filePath);
  assert.equal(inspected.summary.vault.included, false);
  assert.deepEqual(vaultCalls, []);
});

test("the backup password is stored only through safeStorage", async (context) => {
  const value = fixture(context);
  await value.service.setSchedule(inputFor(value.folder, { encryptPassword: backupPassword }));
  const file = path.join(value.dataRoot, "backup-schedule.json");
  const stored = fs.readFileSync(file, "utf8");
  assert.equal(stored.includes(backupPassword), false);
  assert.equal(JSON.parse(stored).encrypt, true);
  assert.ok(JSON.parse(stored).encryptedPasswordB64);
  assert.deepEqual(value.safeStorage.calls, ["encrypt"]);
  assert.equal(Object.hasOwn(value.service.getSchedule().schedule, "encryptedPasswordB64"), false);
  assert.equal(Object.hasOwn(value.service.getSchedule().schedule, "enabledAt"), false);
  value.setClock(new Date(2026, 10, 1, 20));
  await value.service.checkNow();
  assert.equal(value.runs[0].encryptPassword, backupPassword);
  assert.deepEqual(value.safeStorage.calls, ["encrypt", "decrypt"]);
  await value.service.setSchedule(inputFor(value.folder));
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).encryptedPasswordB64, null);
  assert.equal(value.service.getSchedule().schedule.encrypt, false);
});

test("failures are recorded and reported once", async (context) => {
  let attempts = 0;
  const value = fixture(context, { exportBackup: async () => { attempts += 1; throw new StorageError("E_IO", "private failure details"); } });
  await value.service.setSchedule(inputFor(value.folder));
  value.setClock(new Date(2026, 10, 1, 20));
  assert.deepEqual(await value.service.checkNow(), { ran: true, filePath: null });
  assert.equal((await value.service.checkNow()).ran, false);
  assert.equal(attempts, 1);
  assert.equal(value.service.getSchedule().schedule.lastResult.ok, false);
  assert.equal(JSON.stringify(value.logs).includes("private failure details"), false);
  assert.equal(value.logs.filter((entry) => entry.event === "backup.schedule" && entry.ok === false).length, 1);
});

test("folders inside the data root are rejected", async (context) => {
  const value = fixture(context);
  const inside = path.join(value.dataRoot, "backups");
  fs.mkdirSync(inside);
  await assert.rejects(value.service.setSchedule(inputFor(inside)), { code: "E_INVALID_ARGUMENT" });
  await assert.rejects(value.service.setSchedule(inputFor(value.dataRoot)), { code: "E_INVALID_ARGUMENT" });
  assert.equal(fs.existsSync(path.join(value.dataRoot, "backup-schedule.json")), false);
});

test("activation time survives restart and resets after reconfiguration", async (context) => {
  const value = fixture(context);
  await value.service.setSchedule(inputFor(value.folder));
  const activated = JSON.parse(fs.readFileSync(path.join(value.dataRoot, "backup-schedule.json"), "utf8")).enabledAt;
  const restarted = createBackupSchedule(value.options);
  try { assert.equal((await restarted.checkNow()).ran, false); } finally { await restarted.stop(); }
  value.setClock(new Date(2026, 10, 2, 10));
  await value.service.setSchedule(inputFor(value.folder, { enabled: false }));
  await value.service.setSchedule(inputFor(value.folder));
  assert.notEqual(JSON.parse(fs.readFileSync(path.join(value.dataRoot, "backup-schedule.json"), "utf8")).enabledAt, activated);
  assert.equal((await value.service.checkNow()).ran, false);
  value.setClock(new Date(2026, 10, 8, 20));
  assert.equal((await value.service.checkNow()).ran, true);
});

test("legacy schedules without activation time still catch up", async (context) => {
  const value = fixture(context);
  const defaults = value.service.getSchedule().schedule;
  fs.writeFileSync(path.join(value.dataRoot, "backup-schedule.json"), JSON.stringify({ ...defaults, enabled: true, folder: value.folder, encryptedPasswordB64: null }));
  const legacy = createBackupSchedule(value.options);
  try {
    assert.equal(legacy.getSchedule().schedule.destination, "local");
    assert.equal((await legacy.checkNow()).ran, true);
  } finally { await legacy.stop(); }
});

test("third-party plans persist their service and isolate rotation in a shared folder", async (context) => {
  const value = fixture(context);
  const settingsFile = path.join(value.dataRoot, "backup-schedule.json");
  await value.service.setSchedule(inputFor(value.folder, { destination: "onedrive", keepLast: 1 }));
  assert.throws(() => value.service.updateWorkspaceSchedule({ folder: value.dataRoot }), { code: "E_FORBIDDEN" });
  assert.deepEqual(await value.service.checkNow(), { ran: false, filePath: null });

  const first = await value.service.runNow();
  assert.equal(first.schedule.destination, "onedrive");
  assert.equal(first.schedule.lastResult.ok, true);
  assert.equal(Object.hasOwn(first.schedule, "cloudBackupId"), false);
  assert.equal(fs.existsSync(first.filePath), true);
  const { cloudBackupId } = JSON.parse(fs.readFileSync(settingsFile, "utf8"));
  const unrelated = ["manual.lifeatlas", "Life-Atlas-自动备份-20261001-2000.lifeatlas", path.basename(first.filePath).replace(cloudBackupId, "aabbccddeeff1122")];
  for (const name of unrelated) fs.writeFileSync(path.join(value.folder, name), "preserve");

  await value.service.stop();
  value.setClock(new Date(2026, 10, 1, 20));
  const restarted = createBackupSchedule(value.options);
  try {
    assert.equal(restarted.getSchedule().schedule.destination, "onedrive");
    const second = await restarted.checkNow();
    assert.equal(second.ran, true);
    assert.equal(path.basename(second.filePath).includes(cloudBackupId), true);
    assert.equal(fs.existsSync(first.filePath), false);
    assert.equal(fs.existsSync(second.filePath), true);
    assert.equal((await restarted.checkNow()).ran, false);
    for (const name of unrelated) assert.equal(fs.readFileSync(path.join(value.folder, name), "utf8"), "preserve");
  } finally { await restarted.stop(); }
});

test("a failed third-party scheduled export retries after an hour", async (context) => {
  let attempts = 0;
  const value = fixture(context, { exportBackup: async ({ targetPath }) => {
    attempts += 1;
    if (attempts === 1) throw new StorageError("E_IO", "offline sample target");
    fs.writeFileSync(targetPath, "automatic-backup");
    return { filePath: targetPath };
  } });
  await value.service.setSchedule(inputFor(value.folder, { destination: "google-drive" }));
  value.setClock(new Date(2026, 10, 1, 20));
  assert.deepEqual(await value.service.checkNow(), { ran: true, filePath: null });
  assert.equal(value.service.getSchedule().schedule.lastResult.ok, false);
  value.setClock(new Date(2026, 10, 1, 20, 59));
  assert.equal((await value.service.checkNow()).ran, false);
  value.setClock(new Date(2026, 10, 1, 21));
  assert.ok((await value.service.checkNow()).filePath);
  assert.equal(value.service.getSchedule().schedule.lastResult.ok, true);
  assert.equal(attempts, 2);
});

test("a third-party backup restores the workspace and attachments from a downloaded copy", async (context) => {
  const source = await createDesktopBackupContext(context);
  const destination = await createDesktopBackupContext(context, { seed: false });
  const syncFolder = createIsolatedDirectory("cloud-sync-folder-fixture");
  const downloadFolder = createIsolatedDirectory("cloud-download-folder-fixture");
  const sourceDialogs = createDialogs({ testHooksEnabled: true });
  const destinationDialogs = createDialogs({ testHooksEnabled: true });
  const backup = createBackupService({ ...source, dialogs: sourceDialogs, requestFlush: async () => true });
  const restore = createBackupService({ ...destination, dialogs: destinationDialogs, requestFlush: async () => true });
  context.after(async () => {
    await Promise.all([backup.stop(), restore.stop()]);
    removeIsolatedDirectory(syncFolder);
    removeIsolatedDirectory(downloadFolder);
  });
  await backup.setSchedule(inputFor(syncFolder, { destination: "google-drive" }));
  const { filePath, schedule } = await backup.runScheduleNow();
  assert.equal(schedule.lastResult.message, "已写入本机备份目录");
  assert.deepEqual(fs.readdirSync(syncFolder), [path.basename(filePath)]);

  sourceDialogs.state.queue.showOpenDialog.push([filePath]);
  const original = await backup.inspectScheduled();
  assert.equal(sourceDialogs.state.calls.at(-1).options.defaultPath, syncFolder);
  assert.ok(original.token);
  assert.ok(original.summary.counts.pages > 0);
  assert.ok(original.summary.assets.count > 0);

  const downloaded = path.join(downloadFolder, path.basename(filePath));
  fs.copyFileSync(filePath, downloaded);
  destinationDialogs.state.queue.showOpenDialog.push([downloaded]);
  const inspected = await restore.inspect();
  assert.deepEqual(inspected.summary, original.summary);
  await restore.restore({ token: inspected.token, restoreVault: false });
  await assertBackupDataRootsEqual(destination.dataRoot, source.dataRoot);
});

test("cancellation and unavailable safeStorage do not persist settings", async (context) => {
  const value = fixture(context, { requestConfirmation: async () => "cancelled", safeStorage: { isEncryptionAvailable: () => false } });
  await assert.rejects(value.service.setSchedule(inputFor(value.folder, { includeVault: true })), { code: "E_CANCELLED" });
  await assert.rejects(value.service.setSchedule(inputFor(value.folder, { encryptPassword: backupPassword })), { code: "E_IO" });
  assert.equal(fs.existsSync(path.join(value.dataRoot, "backup-schedule.json")), false);
});

test("startup checks are delayed two minutes and stop clears timers", async (context) => {
  const timers = { scheduled: [], cleared: [], setTimeout(callback, delay) { const id = { callback, delay }; this.scheduled.push(id); return id; }, setInterval(callback, delay) { const id = { callback, delay }; this.scheduled.push(id); return id; }, clearTimeout(id) { this.cleared.push(id); }, clearInterval(id) { this.cleared.push(id); } };
  const value = fixture(context, { timers });
  value.service.start();
  assert.deepEqual(timers.scheduled.map((timer) => timer.delay), [120000, 3600000]);
  await value.service.stop();
  assert.equal(timers.cleared.length, 2);
});

test("scheduled exports produce a real encrypted vault backup without repeat confirmation", async (context) => {
  const source = await createDesktopBackupContext(context, { vaultService: backupVaultFactory({ production: true }) });
  await seedBackupVault(source.vaultService);
  const folder = createIsolatedDirectory("schedule-integrated-output");
  const safeStorage = safeStorageFixture();
  const confirmations = [];
  const dialogs = createDialogs({ testHooksEnabled: true });
  let current = new Date(2026, 10, 1, 19, 59).getTime();
  const service = createBackupService({ ...source, dialogs, now: () => current, safeStorage, requestFlush: async () => true, requestConfirmation: async (input) => { confirmations.push(input); return "confirmed"; } });
  context.after(async () => { await service.stop(); removeIsolatedDirectory(folder); });
  for (let index = 1; index <= 9; index += 1) fs.writeFileSync(path.join(folder, `Life-Atlas-自动备份-202610${String(index).padStart(2, "0")}-2000.lifeatlas`), "old");
  fs.writeFileSync(path.join(folder, "manual.lifeatlas"), "preserve manual backup");
  await service.setSchedule(inputFor(folder, { includeVault: true, encryptPassword: backupPassword }));
  assert.equal(confirmations.length, 1);
  assert.equal(confirmations[0].kind, "schedule-backup");
  assert.equal((await service.schedule.checkNow()).ran, false);
  current = new Date(2026, 10, 1, 20).getTime();
  const result = await service.schedule.checkNow();
  assert.equal(result.ran, true);
  assert.equal(path.basename(result.filePath), "Life-Atlas-自动备份-20261101-2000.lifeatlas");
  assert.equal(confirmations.length, 1);
  assert.equal(dialogs.state.calls.filter((entry) => entry.kind === "showSaveDialog").length, 0);
  assert.deepEqual(safeStorage.calls, ["encrypt", "decrypt"]);
  assert.equal(fs.readdirSync(folder).filter((name) => /^Life-Atlas-自动备份-\d{8}-\d{4}\.lifeatlas$/.test(name)).length, 8);
  assert.equal(fs.readFileSync(path.join(folder, "manual.lifeatlas"), "utf8"), "preserve manual backup");
  assert.equal(fs.readFileSync(path.join(source.dataRoot, "backup-schedule.json"), "utf8").includes(backupPassword), false);
  const request = await service.inspectFile(result.filePath);
  assert.equal(request.needsPassword, true);
  const inspected = await service.inspectWithPassword({ inspectId: request.inspectId, password: backupPassword });
  assert.equal(inspected.summary.encrypted, true);
  assert.equal(inspected.summary.vault.itemCount, 10);
  assert.equal(service.getStatus().schedule.lastResult.ok, true);
  assert.equal((await service.schedule.checkNow()).ran, false);
  await service.stop();
  assert.deepEqual(fs.readdirSync(source.dataRoot).filter((name) => name.startsWith(".staging-")), []);
});
