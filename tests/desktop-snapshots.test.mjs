import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { selectSnapshotsToDelete, createSnapshot, createSnapshotService, checkDailySnapshot, listSnapshots, readSnapshotMetadata, snapshotDirectory } from "../electron/main/storage/snapshots.js";
import { createBackupService } from "../electron/main/backup/index.js";
import { sha256File } from "../electron/main/backup/files.js";
import { openZipFileReader } from "../electron/main/backup/zipNode.js";
import { assembleWorkspace, openWorkspaceDatabase, readAllRows } from "../electron/main/storage/workspaceDb.js";
import { createWorkspaceService } from "../electron/main/storage/workspaceService.js";
import { createVaultService } from "../electron/main/vault/index.js";
import { blockContext } from "../src/domain/blockDocument.js";
import { plainTextFromMaterialized } from "../src/domain/documentSemantics.js";
import { createIsolatedDirectory, removeIsolatedDirectory } from "./desktop/helpers.mjs";

function fixture(context) {
  const dataRoot = createIsolatedDirectory("snapshots");
  const db = new DatabaseSync(path.join(dataRoot, "source.db"));
  db.exec("CREATE TABLE fixture(id INTEGER PRIMARY KEY, value TEXT); INSERT INTO fixture(value) VALUES ('original');");
  context.after(() => { db.close(); removeIsolatedDirectory(dataRoot); });
  return { dataRoot, databases: [{ name: "workspace.db", db }], appVersion: "0.1.0", schemaVersion: 16, counts: { pages: 1 }, now: "2026-10-01T08:00:00.000Z" };
}

test("an assistant snapshot copies just the workspace while manual snapshots can still include the vault", async (context) => {
  const { dataRoot, databases: [{ db }], now } = fixture(context);
  const workspaceService = { db, status: () => ({ loaded: true }), readWorkspace: () => ({ schemaVersion: 16, pages: [{}] }) };
  const vaultCalls = [];
  const vaultService = {
    status() { vaultCalls.push("status"); return { exists: true }; },
    snapshotTo(file) { vaultCalls.push("snapshot"); fs.writeFileSync(file, "encrypted synthetic vault database"); },
  };
  const snapshotService = createSnapshotService({ dataRoot, workspaceService, vaultService, now });
  const backup = createBackupService({ dataRoot, workspaceService, snapshotService, requestFlush: async () => true, now });
  context.after(() => backup.stop());

  const { snapshot: scoped } = await backup.createWorkspaceSnapshot();
  assert.equal(scoped.includesWorkspace, true);
  assert.equal(scoped.includesVault, false);
  assert.equal(fs.existsSync(path.join(dataRoot, "snapshots", scoped.id, "vault.db")), false);
  assert.deepEqual(vaultCalls, []);

  const { snapshot: manual } = await backup.createSnapshot();
  assert.equal(manual.includesWorkspace, true);
  assert.equal(manual.includesVault, true);
  assert.deepEqual(vaultCalls, ["status", "snapshot"]);
});

test("retention keeps the documented fourteen daily snapshots", () => {
  const snapshots = Array.from({ length: 305 }, (_, index) => {
    const createdAt = new Date(Date.UTC(2026, 0, 1, 3) + index * 86400000).toISOString();
    return { id: `${createdAt.replace(/[:.]/g, "-")}-daily`, createdAt, reason: "daily" };
  });
  const deleted = new Set(selectSnapshotsToDelete(snapshots, "2026-11-01T12:00:00.000Z"));
  const kept = snapshots.filter((snapshot) => !deleted.has(snapshot.id)).map((snapshot) => snapshot.createdAt.slice(5, 10)).sort().reverse();
  assert.deepEqual(kept, ["11-01", "10-31", "10-30", "10-29", "10-28", "10-27", "10-26", "10-25", "10-18", "10-11", "09-30", "08-31", "07-31", "06-30"]);
});

test("retention keeps ten snapshots per non-daily reason", () => {
  const snapshots = ["pre-restore", "pre-upgrade", "pre-migration", "manual"].flatMap((reason) => Array.from({ length: 12 }, (_, index) => ({ id: `${reason}-${String(index).padStart(2, "0")}`, reason, createdAt: new Date(Date.UTC(2026, 9, 1, index)).toISOString() })));
  assert.deepEqual(selectSnapshotsToDelete(snapshots, "2026-11-01T12:00:00.000Z"), ["pre-restore-00", "pre-restore-01", "pre-upgrade-00", "pre-upgrade-01", "pre-migration-00", "pre-migration-01", "manual-00", "manual-01"]);
});

test("retention preserves failed snapshots without counting them toward the quotas", () => {
  const now = "2026-11-01T12:00:00.000Z";
  const snapshots = [["daily", 7], ["manual", 10]].flatMap(([reason, quota]) => [
    ...Array.from({ length: quota + 1 }, (_, index) => ({ id: `${reason}-${index}`, reason, createdAt: new Date(Date.UTC(2026, 10, 1, index)).toISOString() })),
    { id: `${reason}-recent-failure`, reason, createdAt: now, integrity: "failed" },
    { id: `${reason}-old-failure`, reason, createdAt: "2025-01-01T00:00:00.000Z", integrity: "failed" },
  ]);
  assert.deepEqual(selectSnapshotsToDelete(snapshots, now), ["daily-0", "manual-0"]);
});

test("vault-reset snapshots are never deleted", () => {
  const snapshots = Array.from({ length: 100 }, (_, index) => ({ id: `reset-${index}`, reason: "vault-reset", createdAt: new Date(Date.UTC(2026, 0, 1) + index * 86400000).toISOString() }));
  assert.deepEqual(selectSnapshotsToDelete(snapshots, "2026-11-01T12:00:00.000Z"), []);
});

test("daily snapshot is created only after twenty hours", async (context) => {
  const options = fixture(context);
  const first = await checkDailySnapshot(options);
  assert.equal(first.created, true);
  assert.equal((await checkDailySnapshot({ ...options, now: Date.parse(options.now) + 19 * 3600000 })).created, false);
  assert.equal((await checkDailySnapshot({ ...options, now: Date.parse(options.now) + 21 * 3600000 })).created, true);
  assert.equal(listSnapshots(options.dataRoot).length, 2);
});

test("daily snapshot records an integrity result", async (context) => {
  const options = fixture(context);
  const result = await checkDailySnapshot(options);
  const metadata = JSON.parse(fs.readFileSync(path.join(options.dataRoot, "snapshots", result.id, "snapshot.json"), "utf8"));
  assert.equal(metadata.integrity, "ok");
  assert.equal(listSnapshots(options.dataRoot)[0].integrity, "ok");
  assert.equal(metadata.files[0].sha256, (await sha256File(path.join(options.dataRoot, "snapshots", result.id, "workspace.db"))).sha256);
});

test("a failed daily snapshot leaves existing backups in place and can retry immediately", async (context) => {
  const options = fixture(context);
  for (let ageHours = 24; ageHours < 32; ageHours += 1) {
    await createSnapshot({ ...options, reason: "daily", now: Date.parse(options.now) - ageHours * 3600000 });
  }
  const before = listSnapshots(options.dataRoot);
  const logs = [];
  await assert.rejects(checkDailySnapshot({
    ...options,
    databases: [{ name: "workspace.db", snapshotTo: (target) => fs.writeFileSync(target, "invalid SQLite fixture") }],
    logger: (event, fields) => logs.push({ event, ...fields }),
  }), { code: "E_CORRUPT" });

  const [failed, ...remaining] = listSnapshots(options.dataRoot);
  assert.equal(failed.integrity, "failed");
  assert.deepEqual(remaining, before);
  assert.ok(logs.some((entry) => entry.event === "snapshot.integrity-failed" && entry.id === failed.id && entry.code === "E_CORRUPT"));

  const retry = await checkDailySnapshot(options);
  assert.equal(retry.created, true);
  assert.notEqual(retry.id, failed.id);
  const after = listSnapshots(options.dataRoot);
  assert.ok(after.some((entry) => entry.id === failed.id && entry.integrity === "failed"));
  assert.deepEqual(after.filter((entry) => entry.integrity === "ok").map((entry) => entry.id), [retry.id, ...before.slice(0, 6).map((entry) => entry.id)]);
});

test("a recent daily snapshot with legacy metadata still defers the next snapshot", async (context) => {
  const options = fixture(context);
  const snapshot = await createSnapshot({ ...options, reason: "daily" });
  const file = path.join(options.dataRoot, "snapshots", snapshot.id, "snapshot.json");
  const metadata = JSON.parse(fs.readFileSync(file, "utf8"));
  delete metadata.integrity;
  fs.writeFileSync(file, JSON.stringify(metadata));

  const now = Date.parse(options.now) + 19 * 3600000;
  assert.deepEqual(await checkDailySnapshot({ ...options, now }), { created: false, id: snapshot.id });
});

test("pre-upgrade snapshot appears when the app version changes", async (context) => {
  const dataRoot = createIsolatedDirectory("pre-upgrade");
  let service = createWorkspaceService({ dataRoot, appVersion: "0.0.9", now: "2026-10-01T08:00:00.000Z" });
  context.after(() => { service.close(); removeIsolatedDirectory(dataRoot); });
  await service.load();
  service.close();
  const snapshots = createSnapshotService({ dataRoot, appVersion: "0.1.0", now: "2026-10-01T09:00:00.000Z" });
  service = createWorkspaceService({ dataRoot, appVersion: "0.1.0", now: "2026-10-01T09:00:00.000Z", beforeUpgrade: snapshots.beforeUpgrade });
  await service.load();
  assert.equal(service.getMeta("lastAppVersion"), "0.1.0");
  assert.equal(listSnapshots(dataRoot).filter((entry) => entry.reason === "pre-upgrade").length, 1);
  service.close();
  const emptyRoot = createIsolatedDirectory("first-version");
  const empty = createWorkspaceService({ dataRoot: emptyRoot, appVersion: "0.1.0", now: "2026-10-01T09:00:00.000Z", beforeUpgrade: () => assert.fail("a first version must not snapshot") });
  try { await empty.load(); assert.equal(listSnapshots(emptyRoot).length, 0); }
  finally { empty.close(); removeIsolatedDirectory(emptyRoot); }
});

test("desktop upgrades automatically snapshot both databases from a packaged 1.6.0 profile", async (context) => {
  const profileDirectory = new URL("./fixtures/compatibility/schema-v20/", import.meta.url);
  const { source, synthetic, files, expected, credentials } = JSON.parse(fs.readFileSync(new URL("fixture.json", profileDirectory), "utf8"));
  const { version: appVersion } = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(synthetic, true);
  assert.equal(source.packagedImplementation, true);
  assert.equal(source.appVersion, "1.6.0");
  assert.notEqual(appVersion, source.appVersion);

  const dataRoot = createIsolatedDirectory("pre-upgrade-dual");
  let closeServices;
  context.after(async () => {
    try { await closeServices?.(); }
    finally { removeIsolatedDirectory(dataRoot); }
  });

  const archive = fileURLToPath(new URL(files.liveProfile.file, profileDirectory));
  assert.deepEqual(await sha256File(archive), { size: files.liveProfile.bytes, sha256: files.liveProfile.sha256 });
  const reader = await openZipFileReader(archive);
  try {
    for (const name of ["workspace.db", "vault.db"]) {
      fs.writeFileSync(path.join(dataRoot, name), await reader.read(name), { flag: "wx" });
    }
  } finally { reader.close(); }

  const now = () => "2026-11-28T10:30:00.000Z";
  const clock = { now: () => Date.parse(now()) };
  const vaultService = createVaultService({ dataRoot, appVersion, clock });
  const workspaceService = createWorkspaceService({ dataRoot, appVersion, now,
    beforeMigration: (input) => snapshots.beforeMigration(input), beforeUpgrade: (input) => snapshots.beforeUpgrade(input) });
  const snapshots = createSnapshotService({ dataRoot, workspaceService, vaultService, appVersion, now });
  closeServices = async () => {
    await snapshots.stop();
    await vaultService.lock();
    vaultService.closeDatabase();
    workspaceService.close();
  };

  assert.equal(vaultService.status().exists, true);
  assert.equal(vaultService.status().locked, true);
  assert.deepEqual(snapshots.listSnapshots(), []);
  await workspaceService.load();
  assert.equal(workspaceService.getMeta("lastAppVersion"), appVersion);
  const entries = snapshots.listSnapshots();
  assert.equal(entries.length, 1);
  const [snapshot] = entries;
  assert.equal(snapshot.reason, "pre-upgrade");
  assert.equal(snapshot.appVersion, appVersion);
  assert.equal(snapshot.schemaVersion, expected.schemaVersion);
  assert.equal(snapshot.includesWorkspace, true);
  assert.equal(snapshot.includesVault, true);

  const directory = snapshotDirectory(dataRoot, snapshot.id);
  assert.deepEqual(fs.readdirSync(directory).sort(), ["snapshot.json", "vault.db", "workspace.db"]);
  for (const { name, ...checksum } of readSnapshotMetadata(dataRoot, snapshot.id).files) {
    const file = path.join(directory, name);
    assert.deepEqual(await sha256File(file), checksum);
    const bytes = fs.readFileSync(file);
    for (const value of [credentials.masterPassword, credentials.recoveryKey, expected.vault.title, expected.vault.secretValue]) {
      assert.equal(bytes.includes(value), false, `${name} must keep vault contents encrypted`);
    }
  }

  const savedWorkspace = openWorkspaceDatabase(path.join(directory, "workspace.db"), { readOnly: true, immutable: true });
  try {
    const rows = readAllRows(savedWorkspace);
    assert.equal(JSON.parse(rows.meta.get("lastAppVersion")), source.appVersion);
    assert.equal(JSON.parse(rows.meta.get("generation")), workspaceService.getMeta("generation"));
    for (const workspace of [assembleWorkspace(rows), workspaceService.readWorkspace()]) {
      assert.equal(workspace.workspaceId, expected.workspaceId);
      const page = workspace.pages.find(({ id }) => id === expected.page.id);
      assert.equal(page?.title, expected.page.title);
      const paragraph = blockContext(page.content, expected.page.paragraphId)?.block;
      assert.ok(paragraph);
      assert.equal(plainTextFromMaterialized([paragraph]), expected.page.paragraphText);
    }
  } finally { savedWorkspace.close(); }

  const vaultCheckRoot = path.join(dataRoot, "snapshot-vault-check");
  fs.mkdirSync(vaultCheckRoot);
  fs.copyFileSync(path.join(directory, "vault.db"), path.join(vaultCheckRoot, "vault.db"));
  const savedVault = createVaultService({ dataRoot: vaultCheckRoot, appVersion, clock });
  try {
    assert.deepEqual(savedVault.exportCiphertext(), vaultService.exportCiphertext());
    for (const vault of [vaultService, savedVault]) {
      assert.equal(vault.status().locked, true);
      const { summaries } = await vault.unlock({ password: credentials.masterPassword });
      const { itemId: id, title, secretFieldId: fieldId, secretValue } = expected.vault;
      assert.equal(summaries.find((item) => item.id === id)?.title, title);
      assert.equal((await vault.revealField({ id, fieldId })).value, secretValue);
    }
  } finally {
    await savedVault.lock();
    savedVault.closeDatabase();
  }

  await workspaceService.reopen();
  assert.deepEqual(snapshots.listSnapshots(), entries);
});

test("listSnapshots reads snapshot.json and skips broken folders", async (context) => {
  const options = fixture(context);
  const good = await createSnapshot({ ...options, reason: "manual" });
  fs.mkdirSync(path.join(options.dataRoot, "snapshots", "broken"));
  fs.writeFileSync(path.join(options.dataRoot, "snapshots", "broken", "snapshot.json"), "{");
  const logs = [];
  assert.deepEqual(listSnapshots(options.dataRoot, { logger: (event, fields) => logs.push({ event, ...fields }) }).map((entry) => entry.id), [good.id]);
  assert.ok(logs.some((entry) => entry.event === "snapshot.skipped"));
});

test("read-only migration snapshots never change the original database", async (context) => {
  const options = fixture(context);
  const source = path.join(options.dataRoot, "source.db");
  const readonly = new DatabaseSync(source, { readOnly: true });
  const before = await sha256File(source);
  try {
    const snapshot = await createSnapshot({ ...options, reason: "pre-migration", databases: [{ name: "workspace.db", db: readonly, readOnly: true }] });
    assert.deepEqual(await sha256File(source), before);
    const copied = new DatabaseSync(path.join(options.dataRoot, "snapshots", snapshot.id, "workspace.db"), { readOnly: true });
    try { assert.equal(copied.prepare("SELECT value FROM fixture").get().value, "original"); }
    finally { copied.close(); }
  } finally { readonly.close(); }
});
