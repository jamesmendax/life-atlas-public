import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { createWorkspaceService } from "../electron/main/storage/workspaceService.js";
import { createVaultService } from "../electron/main/vault/vaultService.js";
import { KDF_PARAMS } from "../electron/main/vault/crypto.js";
import { lastTwoGroups } from "../electron/main/vault/recoveryKey.js";
import { openVaultDatabase, VAULT_FORMAT_VERSION } from "../electron/main/vault/vaultStore.js";
import { CURRENT_SCHEMA_VERSION } from "../src/persistence/migrations.js";
import { FIXTURE_TIME } from "./fixtures/full-workspace.mjs";
import { NEXT_PASSWORD, TEST_PASSWORD, vaultItemInputs } from "./fixtures/vault-items.mjs";

function fixtureDirectory(context) {
  const root = fs.realpathSync(os.tmpdir());
  const directory = fs.mkdtempSync(path.join(root, "life-atlas-preflight-"));
  context.after(() => {
    assert.equal(path.dirname(fs.realpathSync(directory)), root);
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return directory;
}

function sqliteFiles(file) {
  const targets = [file, `${file}-wal`, `${file}-shm`];
  return targets.map((target) => fs.existsSync(target) ? fs.readFileSync(target) : null);
}

function crashWithCommittedWal(file, sql, ...args) {
  const script = `import { DatabaseSync } from "node:sqlite";
    const db = new DatabaseSync(process.argv[1]);
    db.exec("PRAGMA wal_autocheckpoint=0");
    ${sql}
    process.exit(0);`;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script, file, ...args], { encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.error?.message || result.stderr);
  assert.ok(fs.statSync(`${file}-wal`).size > 0);
}

async function seedWorkspace(dataRoot) {
  const service = createWorkspaceService({ dataRoot, now: FIXTURE_TIME });
  try { return (await service.load()).workspace; }
  finally { service.close(); }
}

function openVault(dataRoot) {
  return createVaultService({ dataRoot, kdfParams: { ...KDF_PARAMS, memoryKiB: 8192 } });
}

async function seedVault(dataRoot) {
  const service = openVault(dataRoot);
  try {
    const { recoveryKey } = await service.create({ password: TEST_PASSWORD });
    service.confirmRecoveryKey({ lastTwoGroups: lastTwoGroups(recoveryKey) });
    const { summary } = service.createItem({ input: vaultItemInputs()[0] });
    return { recoveryKey, item: service.getItem({ id: summary.id }).item, header: service.exportCiphertext().header };
  } finally {
    await service.lock();
    service.closeDatabase();
  }
}

test("a future workspace schema is identified before reading its new collections, with crash files unchanged", async (context) => {
  const dataRoot = fixtureDirectory(context);
  await seedWorkspace(dataRoot);
  const file = path.join(dataRoot, "workspace.db");
  const futureVersion = CURRENT_SCHEMA_VERSION + 1;
  crashWithCommittedWal(file, `
    db.exec("BEGIN");
    db.prepare("UPDATE meta SET value=? WHERE key='schemaVersion'").run(process.argv[2]);
    db.prepare("INSERT INTO entities VALUES ('futureCollection', 'future-id', '{}', 'unused')").run();
    db.exec("COMMIT");`, String(futureVersion));
  const original = sqliteFiles(file);
  const service = createWorkspaceService({ dataRoot, now: FIXTURE_TIME });
  try {
    await assert.rejects(service.load(), { code: "E_UNSUPPORTED_VERSION" });
    assert.deepEqual(service.status(), { loaded: false, readOnlyError: false });
    assert.deepEqual(sqliteFiles(file), original);
    assert.deepEqual(fs.readdirSync(path.join(dataRoot, "runtime")), []);
  } finally { service.close(); }
});

test("an unstamped existing workspace is backed up before recording the app version", async (context) => {
  const dataRoot = fixtureDirectory(context);
  const originalWorkspace = await seedWorkspace(dataRoot);
  const file = path.join(dataRoot, "workspace.db");
  const original = sqliteFiles(file);
  const appVersion = "30.0.0";
  const destination = path.join(dataRoot, "snapshot.db");
  const noSnapshot = createWorkspaceService({ dataRoot, appVersion });
  try {
    await assert.rejects(noSnapshot.load(), { code: "E_IO" });
    assert.deepEqual(sqliteFiles(file), original);
  } finally { noSnapshot.close(); }

  const service = createWorkspaceService({ dataRoot, appVersion, now: FIXTURE_TIME, beforeUpgrade: async ({ reason, previousAppVersion, workspace, databases }) => {
    assert.equal(reason, "pre-upgrade");
    assert.equal(previousAppVersion, null);
    assert.deepEqual(workspace, originalWorkspace);
    assert.deepEqual(sqliteFiles(file), original);
    await backup(databases[0].db, destination);
  } });
  try {
    assert.deepEqual((await service.load()).workspace, originalWorkspace);
    assert.equal(service.getMeta("lastAppVersion"), appVersion);
    const snapshot = new DatabaseSync(destination, { readOnly: true });
    try { assert.equal(snapshot.prepare("SELECT value FROM meta WHERE key='lastAppVersion'").get(), undefined); }
    finally { snapshot.close(); }
  } finally { service.close(); }
});

test("an unsupported vault version leaves a cold database unchanged", (context) => {
  const dataRoot = fixtureDirectory(context);
  const file = path.join(dataRoot, "vault.db");
  const db = new DatabaseSync(file);
  try {
    db.exec("CREATE TABLE vault_header(id INTEGER PRIMARY KEY, json TEXT NOT NULL)");
    db.prepare("INSERT INTO vault_header VALUES (1, ?)").run(JSON.stringify({ kind: "life-atlas-vault", formatVersion: VAULT_FORMAT_VERSION + 1 }));
  } finally { db.close(); }
  const original = sqliteFiles(file);
  assert.throws(() => openVault(dataRoot), { code: "E_UNSUPPORTED_VERSION" });
  assert.deepEqual(sqliteFiles(file), original);
  assert.deepEqual(fs.readdirSync(dataRoot), ["vault.db"]);
});

test("invalid supported-version vault headers are rejected before writable setup", (context) => {
  const dataRoot = fixtureDirectory(context);
  const file = path.join(dataRoot, "vault.db");
  const db = new DatabaseSync(file);
  try {
    db.exec("CREATE TABLE vault_header(id INTEGER PRIMARY KEY, json TEXT NOT NULL)");
    db.prepare("INSERT INTO vault_header VALUES (1, ?)").run(JSON.stringify({ kind: "life-atlas-vault", formatVersion: VAULT_FORMAT_VERSION }));
  } finally { db.close(); }
  const original = sqliteFiles(file);
  assert.throws(() => openVault(dataRoot), { code: "E_CORRUPT" });
  assert.deepEqual(sqliteFiles(file), original);
  assert.deepEqual(fs.readdirSync(dataRoot), ["vault.db"]);
});

test("an empty file and empty vault tables from interrupted first initialization can still be initialized", async (context) => {
  for (const hasTables of [false, true]) {
    const dataRoot = fixtureDirectory(context);
    const file = path.join(dataRoot, "vault.db");
    if (hasTables) openVaultDatabase(file).close();
    else fs.writeFileSync(file, "", { flag: "wx" });
    const { header } = await seedVault(dataRoot);
    assert.equal(header.formatVersion, VAULT_FORMAT_VERSION);
  }
});

test("a future vault header committed only in WAL is rejected on reopen and create without modifying source files", async (context) => {
  const dataRoot = fixtureDirectory(context);
  const file = path.join(dataRoot, "vault.db");
  const { header } = await seedVault(dataRoot);
  const service = openVault(dataRoot);
  service.closeDatabase();
  const futureHeader = JSON.stringify({ ...header, formatVersion: VAULT_FORMAT_VERSION + 1 });
  crashWithCommittedWal(file, `db.prepare("UPDATE vault_header SET json=? WHERE id = 1").run(process.argv[2]);`, futureHeader);
  const original = sqliteFiles(file);
  const entries = fs.readdirSync(dataRoot);
  assert.throws(() => service.reopenDatabase(), { code: "E_UNSUPPORTED_VERSION" });
  assert.deepEqual(sqliteFiles(file), original);
  assert.deepEqual(fs.readdirSync(dataRoot), entries);

  fs.unlinkSync(`${file}-shm`);
  const withoutShm = sqliteFiles(file);
  await assert.rejects(service.create({ password: NEXT_PASSWORD }), { code: "E_UNSUPPORTED_VERSION" });
  assert.deepEqual(sqliteFiles(file), withoutShm);
  assert.deepEqual(fs.readdirSync(dataRoot), entries.filter((entry) => entry !== "vault.db-shm"));
});

test("a supported vault with committed WAL accepts its original password and recovery key", async (context) => {
  const dataRoot = fixtureDirectory(context);
  const file = path.join(dataRoot, "vault.db");
  const { recoveryKey, item } = await seedVault(dataRoot);
  crashWithCommittedWal(file, `db.prepare("UPDATE vault_state SET value='false' WHERE key='recoveryConfirmed'").run();`);
  const service = openVault(dataRoot);
  try {
    assert.equal(service.status().recoveryConfirmed, false);
    assert.equal((await service.unlock({ password: TEST_PASSWORD })).requiresRecoveryKeyRegeneration, true);
    await service.lock();
    const recovered = await service.unlockWithRecoveryKey({ recoveryKey, newPassword: NEXT_PASSWORD });
    service.confirmRecoveryKey({ lastTwoGroups: lastTwoGroups(recovered.recoveryKey) });
    assert.deepEqual(service.getItem({ id: item.id }).item, item);
  } finally {
    await service.lock();
    service.closeDatabase();
  }
});
