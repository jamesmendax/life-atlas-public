import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createBackupService } from "../electron/main/backup/index.js";
import { createZipFileWriter, openZipFileReader } from "../electron/main/backup/zipNode.js";
import { verifyMarketPack } from "../electron/main/market/package.js";
import { createAssetStore } from "../electron/main/storage/assetStore.js";
import { ensureDataRootMarker } from "../electron/main/storage/dataRoot.js";
import { createSnapshotService } from "../electron/main/storage/snapshots.js";
import { createWorkspaceService } from "../electron/main/storage/workspaceService.js";
import { createVaultService } from "../electron/main/vault/index.js";
import { lastTwoGroups } from "../electron/main/vault/recoveryKey.js";
import { BACKUP_FORMAT_VERSION } from "../src/backup/format.js";
import { blockContext } from "../src/domain/blockDocument.js";
import { resolvePropertyValue } from "../src/domain/database.js";
import { plainTextFromMaterialized } from "../src/domain/documentSemantics.js";
import { CURRENT_SCHEMA_VERSION } from "../src/persistence/migrations.js";

const fixtureRoot = fileURLToPath(new URL("./fixtures/compatibility/", import.meta.url));
const fixtureNames = fs.existsSync(fixtureRoot)
  ? fs.readdirSync(fixtureRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
  : [];
const { version: appVersion } = readJson(new URL("../package.json", import.meta.url));
const testTime = () => new Date().toISOString();
const wrongPassword = "Life Atlas fixture only: wrong password 804c5efb!";
const rotatedPassword = "Life Atlas fixture only: recovered password 51f1acba!";
const destinationTitle = "Compatibility destination before restore";
const destinationSecret = "Life Atlas synthetic destination value b9cb31a4";

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function hash(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function loadFixture(name) {
  const directory = path.join(fixtureRoot, name);
  const fixture = readJson(path.join(directory, "fixture.json"));
  const file = (kind) => {
    const entry = fixture.files[kind];
    assert.ok(entry && typeof entry.file === "string" && path.basename(entry.file) === entry.file, `${name}: ${kind} archive`);
    return path.join(directory, entry.file);
  };
  return { ...fixture, file };
}

function byId(entries, id, description) {
  const entry = entries.find((candidate) => candidate.id === id);
  assert.ok(entry, `${description}: missing ${id}`);
  return entry;
}

async function createDestination(context, profileFile) {
  const tempRoot = fs.realpathSync(os.tmpdir());
  const directory = fs.mkdtempSync(path.join(tempRoot, "life-atlas-legacy-"));
  const dataRoot = path.join(directory, "data");
  let workspaceService;
  let vaultService;
  let snapshotService;
  let backup;
  context.after(async () => {
    try {
      await backup?.stop();
      await snapshotService?.stop();
    } finally {
      vaultService?.lock("app-quit");
      vaultService?.closeDatabase();
      workspaceService?.close();
      if (fs.existsSync(directory)) {
        assert.equal(path.dirname(fs.realpathSync(directory)), tempRoot);
        fs.rmSync(directory, { recursive: true, force: true });
      }
    }
  });
  ensureDataRootMarker(dataRoot, { appVersion, now: testTime() });
  if (profileFile) {
    const profile = await openZipFileReader(profileFile);
    try {
      const entries = profile.entries();
      assert.ok(entries.includes("workspace.db") && entries.includes("vault.db"));
      for (const entry of entries) {
        assert.match(entry, /^(?:(?:workspace|vault)\.db|assets\/[0-9a-f]{2}\/[0-9a-f]{64})$/);
        const target = path.join(dataRoot, entry);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, await profile.read(entry), { flag: "wx" });
      }
    } finally { profile.close(); }
  }
  let inputFile;
  let outputFile;
  const dialogs = {
    showOpenDialog() {
      assert.ok(inputFile, "test selects the archive through the file chooser");
      const filePaths = [inputFile];
      inputFile = undefined;
      return { canceled: false, filePaths };
    },
    showSaveDialog() {
      assert.ok(outputFile, "test selects an isolated destination for the attachment");
      const filePath = outputFile;
      outputFile = undefined;
      return { canceled: false, filePath };
    },
  };
  const requestConfirmation = async () => "confirmed";
  workspaceService = createWorkspaceService({
    dataRoot, appVersion, now: testTime,
    beforeMigration: (input) => snapshotService.beforeMigration(input),
    beforeUpgrade: (input) => snapshotService.beforeUpgrade(input),
  });
  vaultService = createVaultService({ dataRoot, appVersion, dialogs, requestConfirmation });
  snapshotService = createSnapshotService({ dataRoot, workspaceService, vaultService, appVersion, now: testTime });
  const assetStore = createAssetStore({ assetsDir: path.join(dataRoot, "assets"), db: () => workspaceService.db, now: testTime });
  await workspaceService.load();
  backup = createBackupService({
    dataRoot, workspaceService, vaultService, snapshotService, assetStore, appVersion, dialogs, now: testTime, requestFlush: async () => true,
  });
  return {
    directory, workspaceService, vaultService, assetStore, backup,
    async open(file, method) { inputFile = file; return backup[method](); },
    async copyVaultAttachment(itemId, attachmentId) {
      outputFile = path.join(directory, `exported-vault-attachment-${attachmentId}.bin`);
      const savedPath = outputFile;
      assert.deepEqual(await vaultService.saveAttachmentCopy({ id: itemId, attachmentId }), { saved: true });
      return fs.readFileSync(savedPath);
    },
  };
}

async function verifyArchive(destination, file, password) {
  let selected = await destination.open(file, "verify");
  if (password !== undefined) {
    assert.equal(selected.needsPassword, true);
    selected = await destination.backup.verifyWithPassword({ inspectId: selected.inspectId, password });
  }
  assert.equal(selected.report.ok, true, JSON.stringify(selected.report.problems));
  assert.deepEqual(selected.report.problems, []);
  assert.equal(selected.report.summary.encrypted, password !== undefined);
  return selected.report.summary;
}

async function inspectArchive(destination, file, password) {
  let selected = await destination.open(file, "inspect");
  if (password !== undefined) {
    assert.equal(selected.needsPassword, true);
    selected = await destination.backup.inspectWithPassword({ inspectId: selected.inspectId, password });
  }
  assert.ok(selected.token, JSON.stringify(selected.problems));
  return selected;
}

async function assertWorkspace(destination, expected) {
  const workspace = destination.workspaceService.readWorkspace();
  assert.equal(workspace.workspaceId, expected.workspaceId);
  assert.equal(workspace.schemaVersion, CURRENT_SCHEMA_VERSION);
  const page = byId(workspace.pages, expected.page.id, "legacy page");
  assert.equal(page.title, expected.page.title);
  const paragraph = blockContext(page.content, expected.page.paragraphId)?.block;
  assert.equal(paragraph?.type, "paragraph");
  assert.equal(plainTextFromMaterialized([paragraph]), expected.page.paragraphText);
  const database = expected.database;
  const source = byId(workspace.dataSources, database.sourceId, "legacy database");
  const view = byId(workspace.databaseViews, database.viewId, "legacy database view");
  const item = byId(workspace.databaseItems, database.itemId, "legacy database record");
  const recordPage = byId(workspace.pages, database.recordPageId, "legacy database record page");
  assert.equal(source.title, database.title);
  assert.equal(view.sourceId, source.id);
  assert.equal(item.sourceId, source.id);
  assert.equal(item.pageId, recordPage.id);
  assert.equal(recordPage.title, database.recordTitle);
  const titleProperty = source.properties.find((property) => property.type === "title");
  assert.ok(titleProperty);
  assert.equal(item.values[titleProperty.id], database.recordTitle);
  for (const formula of expected.formulas || []) {
    const property = byId(source.properties, formula.id, "saved formula");
    const config = { ...formula.config };
    delete config.formulaSemantics;
    assert.deepEqual(property.config, config);
    // The frozen schema-18 list-length formula changes from string coercion to list concatenation.
    const result = expected.schemaVersion === 18 && formula.id === "legacy-collection" ? 4 : formula.result;
    assert.equal(resolvePropertyValue(workspace, source, item, property), result);
  }
  for (const asset of expected.attachments) {
    const attachment = byId(workspace.attachments, asset.id, "legacy attachment");
    const info = destination.assetStore.get(asset.assetId);
    assert.ok(info, `attachment ${asset.id} has no restored asset`);
    assert.equal(attachment.name, asset.name);
    assert.equal(attachment.storageKey, asset.assetId);
    assert.equal(info.mime, asset.mime);
    assert.equal(info.size, asset.size);
    const bytes = fs.readFileSync(destination.assetStore.filePath(asset.assetId));
    assert.equal(hash(bytes), asset.sha256);
    assert.deepEqual(bytes, Buffer.from(asset.base64, "base64"));
  }
  if (expected.component) {
    const component = expected.component;
    const block = blockContext(page.content, component.id)?.block;
    assert.equal(block?.type, "marketComponent");
    assert.deepEqual(block.props, component.props);
    const info = destination.assetStore.get(component.sha256);
    assert.equal(info?.mime, component.mime);
    assert.equal(info.size, component.size);
    const bytes = fs.readFileSync(destination.assetStore.filePath(component.sha256));
    assert.equal(hash(bytes), component.sha256);
    const { publicKeys } = readJson(new URL("../market/public/trusted-keys.json", import.meta.url));
    const { meta } = await verifyMarketPack(bytes, { appVersion, publicKeys });
    assert.equal(meta.id, block.props.packageId);
    assert.equal(meta.version, block.props.packageVersion);
  }
}

async function assertVault(destination, expected) {
  const { vaultService } = destination;
  const { item } = vaultService.getItem({ id: expected.itemId });
  assert.equal(item.title, expected.title);
  assert.equal((await vaultService.revealField({ id: expected.itemId, fieldId: expected.secretFieldId })).value, expected.secretValue);
  const settings = vaultService.status().settings;
  for (const [key, value] of Object.entries(expected.requiredSettings ?? {})) assert.deepEqual(settings[key], value, key);
  for (const attachment of expected.attachments ?? []) {
    const restored = byId(item.attachments ?? [], attachment.id, "legacy vault attachment");
    assert.equal(restored.name, attachment.name);
    assert.equal(restored.size, attachment.size);
    const bytes = await destination.copyVaultAttachment(item.id, attachment.id);
    assert.equal(hash(bytes), attachment.sha256);
    assert.deepEqual(bytes, Buffer.from(attachment.base64, "base64"));
  }
}

async function rewriteArchive(source, target, change) {
  const reader = await openZipFileReader(source);
  const writer = createZipFileWriter(target);
  try {
    for (const entry of reader.entries()) writer.addBuffer(entry, change(entry, await reader.read(entry)));
    await writer.finish();
  } catch (error) {
    await writer.abort();
    throw error;
  } finally { reader.close(); }
}

function checkRejection(report, code) {
  assert.ok(report.problems?.some((problem) => problem.code === code), JSON.stringify(report.problems));
}

test("released compatibility baselines are present and their frozen files match the recorded hashes", () => {
  for (const name of ["ui40", "apex-20261123", "market-v1", "formula-v18", "formula-v19"]) {
    assert.ok(fixtureNames.includes(name), `missing release baseline ${name}`);
    assert.ok(loadFixture(name).files.liveProfile, `missing original on-disk profile ${name}`);
  }
  for (const name of fixtureNames) {
    const fixture = loadFixture(name);
    for (const kind of Object.keys(fixture.files)) {
      const bytes = fs.readFileSync(fixture.file(kind));
      assert.equal(bytes.length, fixture.files[kind].bytes, `${name}: ${kind} byte length`);
      assert.equal(hash(bytes), fixture.files[kind].sha256.toLowerCase(), `${name}: ${kind} SHA-256`);
    }
  }
});

for (const name of fixtureNames) {
  if (loadFixture(name).files.liveProfile) {
    test(`${name} directly opens the original SQLite workspaces and vault files`, async (context) => {
      const fixture = loadFixture(name);
      const destination = await createDestination(context, fixture.file("liveProfile"));
      await assertWorkspace(destination, fixture.expected);
      assert.equal(destination.workspaceService.getMeta("lastAppVersion"), appVersion);
      if (fixture.source.appVersion !== appVersion) {
        const snapshot = destination.backup.listSnapshots().snapshots.find((entry) => entry.reason === "pre-upgrade");
        assert.ok(snapshot?.includesWorkspace && snapshot?.includesVault);
      }
      await destination.vaultService.unlock({ password: fixture.credentials.masterPassword });
      await assertVault(destination, fixture.expected.vault);
    });
  }

  test(`${name} complete backup verifies, restores the original workspace and unlocks with its original password`, async (context) => {
    const fixture = loadFixture(name);
    const destination = await createDestination(context);
    const { backup, vaultService } = destination;
    const file = fixture.file("backupPlain");
    const summary = await verifyArchive(destination, file);
    assert.equal(summary.schemaVersion, fixture.expected.schemaVersion);
    assert.equal(summary.vault.included, true);
    const selected = await inspectArchive(destination, file);
    assert.deepEqual(selected.summary, summary);
    await backup.restore({ token: selected.token, restoreVault: true });
    await assertWorkspace(destination, fixture.expected);
    assert.equal(vaultService.status().locked, true);
    const ciphertext = vaultService.exportCiphertext();
    if (fixture.files.vaultExport) {
      const legacy = readJson(fixture.file("vaultExport"));
      assert.deepEqual(ciphertext.header, legacy.header);
      assert.deepEqual(ciphertext.items, legacy.items);
    }
    await assert.rejects(vaultService.unlock({ password: wrongPassword }), { code: "E_BAD_PASSWORD" });
    assert.deepEqual(vaultService.exportCiphertext(), ciphertext);
    await vaultService.unlock({ password: fixture.credentials.masterPassword });
    await assertVault(destination, fixture.expected.vault);
  });

  test(`${name} encrypted backup restores into a separate vault and recovers the original secrets using its old recovery key`, async (context) => {
    const fixture = loadFixture(name);
    const destination = await createDestination(context);
    const { backup, vaultService } = destination;
    const file = fixture.file("backupEncrypted");
    const password = fixture.credentials.backupPassword;
    assert.equal(typeof password, "string");
    const summary = await verifyArchive(destination, file, password);
    assert.equal(summary.vault.included, true);
    const selected = await inspectArchive(destination, file, password);
    assert.deepEqual(selected.summary, summary);
    await backup.restore({ token: selected.token, restoreVault: true });
    await assertWorkspace(destination, fixture.expected);
    assert.equal(vaultService.status().locked, true);
    const rotation = await vaultService.unlockWithRecoveryKey({ recoveryKey: fixture.credentials.recoveryKey, newPassword: rotatedPassword });
    assert.notEqual(rotation.recoveryKey, fixture.credentials.recoveryKey);
    vaultService.confirmRecoveryKey({ lastTwoGroups: lastTwoGroups(rotation.recoveryKey) });
    vaultService.lock();
    await assert.rejects(vaultService.unlock({ password: fixture.credentials.masterPassword }), { code: "E_BAD_PASSWORD" });
    await vaultService.unlock({ password: rotatedPassword });
    await assertVault(destination, fixture.expected.vault);
  });
}

test("incompatible or damaged legacy backups leave existing data and vault ciphertext intact", async (context) => {
  const fixture = loadFixture("ui40");
  const destination = await createDestination(context);
  const { backup, vaultService, workspaceService } = destination;
  const modified = workspaceService.readWorkspace();
  modified.pages[0].title = destinationTitle;
  workspaceService.replaceWorkspace(modified);
  const created = await vaultService.create({ password: rotatedPassword });
  vaultService.confirmRecoveryKey({ lastTwoGroups: lastTwoGroups(created.recoveryKey) });
  vaultService.createItem({ input: { type: "secureNote", title: destinationTitle, fields: [{ label: "Secret", kind: "secret", value: destinationSecret, sensitive: true }] } });
  vaultService.lock();
  const originalWorkspace = workspaceService.readWorkspace();
  const originalVault = vaultService.exportCiphertext();
  const snapshots = backup.listSnapshots();

  const locked = await destination.open(fixture.file("backupEncrypted"), "inspect");
  assert.equal(locked.needsPassword, true);
  await assert.rejects(backup.inspectWithPassword({ inspectId: locked.inspectId, password: wrongPassword }), { code: "E_BAD_PASSWORD" });

  for (const [name, code, update] of [
    ["future-format", "FORMAT_TOO_NEW", (manifest) => { manifest.formatVersion = BACKUP_FORMAT_VERSION + 1; }],
    ["future-schema", "SCHEMA_TOO_NEW", (manifest) => { manifest.workspace.schemaVersion = CURRENT_SCHEMA_VERSION + 1; }],
  ]) {
    const target = path.join(destination.directory, `${name}.lifeatlas`);
    await rewriteArchive(fixture.file("backupPlain"), target, (entry, bytes) => {
      if (entry !== "manifest.json") return bytes;
      const manifest = JSON.parse(bytes);
      update(manifest);
      return Buffer.from(JSON.stringify(manifest));
    });
    const verified = await destination.open(target, "verify");
    assert.equal(verified.report.ok, false);
    checkRejection(verified.report, code);
    const rejected = await destination.open(target, "inspect");
    assert.equal(rejected.token, undefined);
    checkRejection(rejected, code);
  }

  const assetPath = `assets/${fixture.expected.attachments[0].sha256}`;
  const corrupted = path.join(destination.directory, "damaged.lifeatlas");
  await rewriteArchive(fixture.file("backupPlain"), corrupted, (entry, bytes) => {
    if (entry === assetPath) { assert.ok(bytes.length); bytes[0] ^= 1; }
    return bytes;
  });
  const damaged = await destination.open(corrupted, "inspect");
  assert.equal(damaged.token, undefined);
  checkRejection(damaged, "HASH_MISMATCH");

  const changed = path.join(destination.directory, "changed-after-inspection.lifeatlas");
  fs.copyFileSync(fixture.file("backupPlain"), changed);
  const selected = await inspectArchive(destination, changed);
  fs.appendFileSync(changed, "file changed after inspection");
  await assert.rejects(backup.restore({ token: selected.token, restoreVault: true }), { code: "E_CORRUPT" });
  assert.deepEqual(workspaceService.readWorkspace(), originalWorkspace);
  assert.deepEqual(vaultService.exportCiphertext(), originalVault);
  assert.deepEqual(backup.listSnapshots(), snapshots);

  const workspaceOnly = fixture.file("workspaceOnly");
  const summary = await verifyArchive(destination, workspaceOnly);
  assert.equal(summary.vault.included, false);
  const noVault = await inspectArchive(destination, workspaceOnly);
  await backup.restore({ token: noVault.token, restoreVault: false });
  await assertWorkspace(destination, fixture.expected);
  assert.deepEqual(vaultService.exportCiphertext(), originalVault);
});
