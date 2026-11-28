import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const [archiveArgument, expectedSha256, outputArgument, scratchArgument] = process.argv.slice(2);
assert.ok(process.argv.length === 6 && [archiveArgument, outputArgument, scratchArgument].every((value) => value && path.isAbsolute(value))
  && /^[a-f0-9]{64}$/i.test(expectedSha256 ?? ""),
"Usage: node scripts/generate-v160-fixture.mjs <absolute app.asar> <expected SHA-256> <absolute new output directory> <absolute scratch directory>");

const archive = path.resolve(archiveArgument);
const output = path.resolve(outputArgument);
const scratch = path.resolve(scratchArgument);
const inside = (directory, candidate) => {
  const relative = path.relative(directory, candidate);
  return relative === "" || (!path.isAbsolute(relative) && !relative.startsWith(`..${path.sep}`) && relative !== "..");
};
assert.ok(!inside(output, scratch) && !inside(scratch, output), "Scratch and frozen output must be separate");
assert.equal(path.basename(archive), "app.asar");
assert.ok(fs.lstatSync(archive).isFile(), "Candidate archive must be a physical file");
assert.ok(!fs.existsSync(output) || fs.readdirSync(output).length === 0, "Frozen output directory must be empty");

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function fileHash(file) {
  const digest = createHash("sha256");
  for await (const chunk of fs.createReadStream(file)) digest.update(chunk);
  return digest.digest("hex");
}
const verifiedSha256 = await fileHash(archive);
assert.equal(verifiedSha256, expectedSha256.toLowerCase(), "Candidate ASAR SHA-256 mismatch");

const { extractAll } = createRequire(import.meta.url)("@electron/asar");
fs.mkdirSync(scratch, { recursive: true });
const run = fs.mkdtempSync(path.join(scratch, "generate-schema20-"));
const runtime = path.join(run, "app");
const dataRoot = path.join(run, "data");
const backupDir = path.join(run, "backup");
fs.mkdirSync(backupDir);
extractAll(archive, runtime);

const load = (file) => import(pathToFileURL(path.join(runtime, file)));
const [
  { ensureDataRootMarker }, databaseStore, { createWorkspaceService }, { createAssetStore },
  { createBackupService }, { createVaultService }, { createSnapshotService }, { lastTwoGroups }, { createZipFileWriter }, { requiredCollections },
  { normalizeLoadedWorkspace, CURRENT_SCHEMA_VERSION }, databaseDomain, { recordDatabaseVersion }, { archivePage },
  { normalizeRecordLayout }, { normalizeDependencyConfig }, { checkWorkspaceIntegrity },
] = await Promise.all([
  "electron/main/storage/dataRoot.js", "electron/main/storage/workspaceDb.js", "electron/main/storage/workspaceService.js",
  "electron/main/storage/assetStore.js", "electron/main/backup/index.js", "electron/main/vault/index.js", "electron/main/storage/snapshots.js",
  "electron/main/vault/recoveryKey.js", "electron/main/backup/zipNode.js", "src/backup/format.js", "src/persistence/normalize.js",
  "src/domain/database.js", "src/domain/databaseHistory.js", "src/domain/archive.js",
  "src/domain/recordLayout.js", "src/domain/databaseDependencies.js", "src/domain/integrity.js",
].map(load));

const appVersion = JSON.parse(fs.readFileSync(path.join(runtime, "package.json"), "utf8")).version;
assert.equal(appVersion, "1.6.0");
assert.equal(CURRENT_SCHEMA_VERSION, 20);

const fixedTime = "2026-11-27T10:30:00.000Z";
const archivedAt = "2026-11-27T10:29:00.000Z";
const versionAt = "2026-11-27T10:20:00.000Z";
const now = () => fixedTime;
const clock = { now: () => Date.parse(fixedTime) };
const workspaceId = "schema20-synthetic-workspace";
const masterPassword = "V160-SYNTHETIC-MASTER-portable!2026";
const backupPassword = "V160-SYNTHETIC-ARCHIVE-portable!2026";
const secretValue = "synthetic-schema20-vault-secret-01";
const settings = { autoLockMinutes: 15, clipboardClearSeconds: 60, lockOnMinimize: true, verifyBeforeReveal: false };
const timestamp = { createdAt: fixedTime, updatedAt: fixedTime };
const folderId = "v160-folder";
const ownerId = "v160-owner-page";
const ownerBlockId = "v160-owner-db-block";
const archivedId = "v160-archived-page";
const archivedBody = "Synthetic archived page remains readable";
const page = { id: "v160-page", title: "Schema 20 synthetic page", paragraphId: "v160-paragraph", paragraphText: "Schema 20 synthetic paragraph 001" };
const database = {
  sourceId: "v160-source", viewId: "v160-view", itemId: "v160-record", recordPageId: "v160-record-page",
  title: "Schema 20 synthetic database", recordTitle: "Schema 20 synthetic record",
};
const secondary = { sourceId: "v160-secondary", viewId: "v160-secondary-view" };
const predecessor = { id: "v160-predecessor", pageId: "v160-predecessor-page", title: "Synthetic predecessor" };
const historicalFieldId = "v160-history-files";
const recordBody = "Synthetic record page body at export";

function fixtureAsset(id, name, text) {
  const bytes = Buffer.concat([Buffer.from([0, 0x89, 0xff, 10]), Buffer.from(text, "utf8")]);
  return { id, name, mime: "application/octet-stream", bytes, hash: sha256(bytes) };
}
function expectedAsset(asset) {
  return { id: asset.id, assetId: asset.hash, sha256: asset.hash, size: asset.bytes.length, name: asset.name,
    mime: asset.mime, base64: asset.bytes.toString("base64") };
}
const liveAsset = fixtureAsset("v160-live-file", "v160-live.bin", "Synthetic live attachment");
const historicAsset = fixtureAsset("v160-history-file", "v160-history-only.bin", "Synthetic attachment held only by database history");
const assets = [liveAsset, historicAsset];
let counter = 0;
const idFactory = (kind) => `${kind}-v160-fixture-${++counter}`;
const paragraph = (id, text) => ({ id, type: "paragraph", content: [{ type: "text", text, styles: {} }] });
const documentPage = (id, title, content, extra = {}) => ({ id, title, content, folderId, icon: "📄", sortIndex: 10, ...timestamp, ...extra });
const mainSource = databaseDomain.createDataSource({
  id: database.sourceId, title: database.title, ownerPageId: ownerId, ...timestamp,
  properties: [{ id: "title", name: "Name", type: "title" }, { id: "files", name: "Live files", type: "files" },
    { id: historicalFieldId, name: "History-only files", type: "files" }, { id: "starts", name: "Start", type: "date" },
    { id: "ends", name: "End", type: "date" }],
});
mainSource.recordLayout = normalizeRecordLayout({
  mode: "tabs", pinnedPropertyIds: ["starts"], sections: [{ id: "v160-layout-section", name: "Timing", propertyIds: ["ends"] }],
  views: [{ id: "v160-layout-view", name: "Related records", ...secondary }],
}, mainSource);
mainSource.dependencyConfig = normalizeDependencyConfig(mainSource, { datePropertyId: "starts", mode: "preserve-gap", skipWeekends: true });
const secondarySource = databaseDomain.createDataSource({ id: secondary.sourceId, title: "Schema 20 secondary source", ownerPageId: ownerId,
  properties: [{ id: "title", name: "Name", type: "title" }], ...timestamp });
const view = (id, sourceId, name) => ({ ...databaseDomain.createDatabaseView({ id, sourceId, name, type: "table" }), ...timestamp });
const row = (id, pageId, values, extra = {}) => ({
  ...databaseDomain.createDatabaseItem({ id, sourceId: mainSource.id, pageId, values, ...timestamp }), dependencyIds: [], ...extra,
});
const sourceIds = [mainSource.id, secondarySource.id];
const viewIds = [database.viewId, secondary.viewId];
const workspaceInput = {
  ...Object.fromEntries(requiredCollections(CURRENT_SCHEMA_VERSION).map((name) => [name, []])),
  workspaceId, schemaVersion: CURRENT_SCHEMA_VERSION, savedAt: fixedTime,
  folders: [{ id: folderId, name: "V160 synthetic fixtures", parentId: null, color: "stone", sortIndex: 10, ...timestamp }],
  pages: [
    documentPage(page.id, page.title, [paragraph(page.paragraphId, page.paragraphText), {
      id: "v160-live-file-block", type: "file", props: { url: `life-asset://${liveAsset.hash}`, name: liveAsset.name, caption: "" },
    }]),
    documentPage(archivedId, "Schema 20 archived page", [paragraph("v160-archived-text", archivedBody)]),
    documentPage(ownerId, database.title, [{ id: ownerBlockId, type: "databaseView", props: {
      sourceId: mainSource.id, sourceIdsJson: JSON.stringify(sourceIds), viewId: database.viewId, viewIdsJson: JSON.stringify(viewIds),
    } }], { pageType: "database", databaseSourceId: mainSource.id, databaseSourceIds: sourceIds, databaseViewId: database.viewId }),
    documentPage(database.recordPageId, database.recordTitle, [paragraph("v160-current-record-text", recordBody)], { databaseSourceId: mainSource.id }),
    documentPage(predecessor.pageId, predecessor.title, [], { databaseSourceId: mainSource.id }),
  ],
  dataSources: [mainSource, secondarySource],
  databaseViews: [view(database.viewId, mainSource.id, "Table"), view(secondary.viewId, secondarySource.id, "Secondary")],
  databaseItems: [
    row(database.itemId, database.recordPageId, { title: database.recordTitle, files: [liveAsset.id], [historicalFieldId]: [historicAsset.id],
      starts: { start: "2026-11-28", end: null, includeTime: false, timeZone: null }, ends: { start: "2026-11-29", end: null, includeTime: false, timeZone: null },
    }, { parentItemId: predecessor.id, dependencyIds: [predecessor.id] }),
    row(predecessor.id, predecessor.pageId, { title: predecessor.title }),
  ],
  attachments: assets.map((asset) => ({ id: asset.id, name: asset.name, mime: asset.mime, size: asset.bytes.length, provider: "asset",
    storageKey: asset.hash, checksum: asset.hash, ...timestamp })),
  ui: { preferences: { theme: "dark" } },
};
const normalized = normalizeLoadedWorkspace(workspaceInput, { fallbackWorkspace: workspaceInput, now: fixedTime, idFactory });
const archived = archivePage(normalized, archivedId, true, archivedAt);
const captured = recordDatabaseVersion(archived, mainSource.id, { now: versionAt, idFactory, reason: "manual" });
const version = captured.databaseVersions[0];
const finalSource = { ...mainSource, properties: mainSource.properties.filter(({ id }) => id !== historicalFieldId) };
const finalWorkspace = {
  ...captured,
  dataSources: captured.dataSources.map((source) => source.id === mainSource.id ? finalSource : source),
  databaseItems: captured.databaseItems.map((item) => {
    if (item.id !== database.itemId) return item;
    const values = { ...item.values };
    delete values[historicalFieldId];
    return { ...item, values };
  }),
};
assert.ok(version.items.some((item) => item.values?.[historicalFieldId]?.includes(historicAsset.id)));
assert.ok(!JSON.stringify(finalWorkspace.databaseItems).includes(historicAsset.id));
const integrity = checkWorkspaceIntegrity(finalWorkspace);
assert.equal(integrity.ok, true, JSON.stringify(integrity.problems));

ensureDataRootMarker(dataRoot, { appVersion, now: fixedTime });
const db = databaseStore.openWorkspaceDatabase(path.join(dataRoot, "workspace.db"));
try {
  databaseStore.prepareWritable(db);
  databaseStore.initializeWorkspace(db, finalWorkspace, { generation: "gen-schema20-synthetic-fixture", now: fixedTime });
  const store = createAssetStore({ assetsDir: path.join(dataRoot, "assets"), db, now });
  for (const asset of assets) assert.equal(store.put(asset).assetId, asset.hash);
} finally { db.close(); }

const workspaceService = createWorkspaceService({ dataRoot, appVersion, now, idFactory,
  beforeUpgrade: (options) => snapshotService.beforeUpgrade(options), beforeMigration: (options) => snapshotService.beforeMigration(options) });
const assetStore = createAssetStore({ assetsDir: path.join(dataRoot, "assets"), db: () => workspaceService.db, now });
const vaultService = createVaultService({ dataRoot, clock, appVersion });
const snapshotService = createSnapshotService({ dataRoot, workspaceService, vaultService, appVersion, now });
const filenames = { backupPlain: "complete.lifeatlas", backupEncrypted: "complete-encrypted.lifeatlas", liveProfile: "live-profile.zip" };
const artifact = (kind) => path.join(backupDir, filenames[kind]);
const destinations = [];
const backup = createBackupService({ dataRoot, workspaceService, assetStore, vaultService, snapshotService, appVersion, now, idFactory,
  dialogs: { showSaveDialog: async () => ({ filePath: destinations.shift() }) }, requestFlush: async () => true,
  requestConfirmation: async () => "confirmed" });
const stableKdf = ({ saltB64, ...params }) => params;
let fixture;
try {
  await workspaceService.load();
  const opened = workspaceService.readWorkspace();
  assert.deepEqual(opened.databaseVersions, finalWorkspace.databaseVersions);
  assert.equal(opened.pages.find((entry) => entry.id === archivedId).archivedAt, archivedAt);
  const { recoveryKey } = await vaultService.create({ password: masterPassword });
  vaultService.confirmRecoveryKey({ lastTwoGroups: lastTwoGroups(recoveryKey) });
  vaultService.updateSettings({ patch: settings });
  const title = "Schema 20 synthetic vault item";
  const { summary } = vaultService.createItem({ input: { type: "login", title, tags: ["synthetic-fixture"], favorite: true,
    fields: [{ label: "Password", kind: "secret", sensitive: true, value: secretValue },
      { label: "Notes", kind: "multiline", sensitive: false, value: "Synthetic schema 20 vault note" }],
  } });
  const secretFieldId = vaultService.getItem({ id: summary.id }).item.fields.find((field) => field.kind === "secret").id;
  await vaultService.lock();
  await vaultService.unlock({ password: masterPassword });
  assert.equal((await vaultService.revealField({ id: summary.id, fieldId: secretFieldId })).value, secretValue);

  destinations.push(artifact("backupPlain"));
  const plain = await backup.exportFull({ includeVault: true, encryptPassword: null });
  destinations.push(artifact("backupEncrypted"));
  const encrypted = await backup.exportFull({ includeVault: true, encryptPassword: backupPassword });
  assert.deepEqual(encrypted.manifest, plain.manifest);
  assert.ok(plain.manifest.files.some(({ path: entry }) => entry === `assets/${historicAsset.hash}`));
  const inspection = await backup.inspectFile(artifact("backupEncrypted"));
  assert.equal(inspection.needsPassword, true);
  const inspected = await backup.inspectWithPassword({ inspectId: inspection.inspectId, password: backupPassword });
  assert.equal(inspected.summary.vault.itemCount, 1);
  assert.equal(inspected.summary.schemaVersion, CURRENT_SCHEMA_VERSION);

  const encryptedBytes = fs.readFileSync(artifact("backupEncrypted"));
  const encryptedHeader = JSON.parse(encryptedBytes.subarray(12, 12 + encryptedBytes.readUInt32BE(8)).toString("utf8"));
  const vaultHeader = vaultService.exportCiphertext().header;
  fixture = {
    fixtureVersion: 1, synthetic: true,
    source: { release: "1.6.0 format candidate", appVersion, appAsarSha256: verifiedSha256, packagedImplementation: true, fixtureClock: fixedTime },
    formats: {
      workspaceSchemaVersion: CURRENT_SCHEMA_VERSION, backupManifestVersion: plain.manifest.formatVersion,
      encryptedContainer: { formatVersion: encryptedHeader.formatVersion, magicHex: encryptedBytes.subarray(0, 8).toString("hex"),
        cipher: encryptedHeader.cipher, kdf: stableKdf(encryptedHeader.kdf) },
      vault: { formatVersion: vaultHeader.formatVersion, padding: vaultHeader.padding, kdf: stableKdf(vaultHeader.kdf) },
    },
    credentials: { masterPassword, recoveryKey, backupPassword },
    expected: {
      workspaceId, schemaVersion: CURRENT_SCHEMA_VERSION, page, database, workspacePreferences: { theme: "dark" }, attachments: assets.map(expectedAsset),
      vault: { itemId: summary.id, title, secretFieldId, secretValue, requiredSettings: settings },
      productV20: {
        archive: { pageId: archivedId, archivedAt, body: archivedBody },
        occurrence: { pageId: ownerId, blockId: ownerBlockId, sourceIds, viewIds },
        record: { itemId: database.itemId, pageId: database.recordPageId, parentItemId: predecessor.id, dependencyIds: [predecessor.id], body: recordBody },
        layout: mainSource.recordLayout, dependencyConfig: mainSource.dependencyConfig,
        history: { id: version.id, sourceId: version.sourceId, createdAt: version.createdAt, reason: version.reason,
          signature: version.signature, propertyId: historicalFieldId, itemId: database.itemId, attachment: expectedAsset(historicAsset) },
      },
    },
    verification: { generatedByPackagedBackupService: true, outerEncryptedBackupOpenedByPackagedReader: true, originalMasterPasswordOpenedVault: true },
  };
} finally {
  await backup.stop();
  await snapshotService.stop();
  await vaultService.lock();
  vaultService.closeDatabase();
  workspaceService.close();
}

const profile = createZipFileWriter(artifact("liveProfile"));
try {
  for (const name of ["workspace.db", "vault.db"]) {
    assert.ok(!fs.existsSync(path.join(dataRoot, `${name}-wal`)), "Profile database must be checkpointed");
    profile.addBuffer(name, fs.readFileSync(path.join(dataRoot, name)));
  }
  for (const { hash } of assets) {
    const name = `assets/${hash.slice(0, 2)}/${hash}`;
    profile.addBuffer(name, fs.readFileSync(path.join(dataRoot, name)));
  }
  await profile.finish();
} catch (error) { await profile.abort(); throw error; }

fixture.files = Object.fromEntries(await Promise.all(Object.entries(filenames).map(async ([kind, file]) => [
  kind, { file, sha256: await fileHash(artifact(kind)), bytes: fs.statSync(artifact(kind)).size },
])));
fs.mkdirSync(output, { recursive: true });
for (const [kind, name] of Object.entries(filenames)) fs.copyFileSync(artifact(kind), path.join(output, name), fs.constants.COPYFILE_EXCL);
fs.writeFileSync(path.join(output, "fixture.json"), JSON.stringify(fixture, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ source: fixture.source, formats: fixture.formats, files: fixture.files, scratchRun: run }));
