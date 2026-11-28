import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const releases = {
  ui40: { name: "v9-database-ui-40", sha256: "6f16c92c03349ed27d1e6325124b2325cdaf9983fb98cb9b2ba8c64c6dbd8856" },
  "apex-20261123": { name: "v9-apex-assistant-20261123", sha256: "c5995a1f3a61ed3a5f202d6ec02b0d9ef6ad4adaff8a5d8892aa192063ec93d9" },
  "market-v1": { name: "1.1.0 market test package", sha256: "012373eb3ab38173b170156ad7cb3229b65a530448c48f8dbe9a8c4ff66ff41e" },
};
const [baseline, suppliedArchive, suppliedOutput, suppliedScratch, asarToolDirectory] = process.argv.slice(2);
const source = releases[baseline];
if (!source || ![suppliedArchive, suppliedOutput, suppliedScratch].every((value) => value && path.isAbsolute(value))) {
  throw new Error("Usage: node generate.mjs <ui40|apex-20261123|market-v1> <absolute app.asar> <empty output directory> <isolated scratch directory> [asar tool directory]");
}
const scratch = path.resolve(suppliedScratch);
const output = path.resolve(suppliedOutput);
const asar = path.resolve(suppliedArchive);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fileSha256 = (file) => sha256(fs.readFileSync(file));
assert.equal(fileSha256(asar), source.sha256, "The baseline ASAR fingerprint must match");
assert.notEqual(output, scratch);
const require = createRequire(asarToolDirectory ? path.join(asarToolDirectory, "package.json") : import.meta.url);
const { extractAll } = require("@electron/asar");

const isUI40 = baseline === "ui40";
const isMarket = baseline === "market-v1";
const prefix = isMarket ? "market" : isUI40 ? "ui40" : "apex";
const filenames = {
  backupPlain: "complete.lifeatlas", backupEncrypted: "complete-encrypted.lifeatlas",
  ...(isUI40 ? { workspaceOnly: "workspace-only.lifeatlas", vaultExport: "vault.json" } : {}),
};
const profileName = "live-profile.zip";
const generatedNames = [...Object.values(filenames), profileName, "fixture.json"];
for (const file of generatedNames) assert.ok(!fs.existsSync(path.join(output, file)), `Refusing to overwrite the frozen ${file}`);
fs.mkdirSync(scratch, { recursive: true });
const run = fs.mkdtempSync(path.join(scratch, `generate-${prefix}-`));
const runtime = path.join(run, "app");
const dataRoot = path.join(run, "fixture-data");
const backupDir = path.join(run, "backups");
fs.mkdirSync(runtime);
fs.mkdirSync(backupDir);
extractAll(asar, runtime);

const load = (file) => import(pathToFileURL(path.join(runtime, file)));
const [
  { ensureDataRootMarker }, databaseStore, { createWorkspaceService }, { createAssetStore },
  { createBackupService }, { createVaultService }, { lastTwoGroups }, { openZipFileReader, createZipFileWriter },
  { normalizeLoadedWorkspace, CURRENT_SCHEMA_VERSION }, databaseDomain, { requiredCollections },
] = await Promise.all([
  "electron/main/storage/dataRoot.js", "electron/main/storage/workspaceDb.js", "electron/main/storage/workspaceService.js", "electron/main/storage/assetStore.js",
  "electron/main/backup/index.js", "electron/main/vault/index.js", "electron/main/vault/recoveryKey.js", "electron/main/backup/zipNode.js",
  "src/persistence/normalize.js", "src/domain/database.js", "src/backup/format.js",
].map(load));
const appVersion = JSON.parse(fs.readFileSync(path.join(runtime, "package.json"), "utf8")).version;
const fixedTime = "2026-11-23T12:00:00.000Z";
const now = () => fixedTime;
const clock = { now: () => Date.parse(fixedTime) };
const masterPassword = `${prefix.toUpperCase()}-FIXTURE-MASTER-p0rtable!2026`;
const backupPassword = `${prefix.toUpperCase()}-FIXTURE-ARCHIVE-p0rtable!2026`;
const secretValue = `synthetic-${prefix}-vault-secret-0001`;
const settings = { autoLockMinutes: 15, clipboardClearSeconds: 60, lockOnMinimize: true, verifyBeforeReveal: false };
const marker = { createdAt: fixedTime, updatedAt: fixedTime };
const workspaceId = `ws-${prefix}-golden-v1`;
const page = { id: `${prefix}-page`, title: `${prefix.toUpperCase()} golden page`, paragraphId: `${prefix}-paragraph`, paragraphText: `${prefix.toUpperCase()} legacy fixture paragraph 001` };
const database = { sourceId: `${prefix}-source`, viewId: `${prefix}-view`, itemId: `${prefix}-row`, recordPageId: `${prefix}-record-page`,
  title: `${prefix.toUpperCase()} golden database`, recordTitle: `${prefix.toUpperCase()} golden record` };
const folderId = `${prefix}-folder`;
const databasePageId = `${prefix}-db-page`;
const asset = {
  id: `${prefix}-attachment`, mime: "application/octet-stream", name: `${prefix}-fixture.bin`,
  bytes: Buffer.concat([Buffer.from([0, 255, 137, 201, 10]), Buffer.from(`synthetic ${prefix} workspace attachment\n`)]),
};
const assetHash = sha256(asset.bytes);
const expectedWorkspaceAttachment = { id: asset.id, assetId: assetHash, sha256: assetHash, size: asset.bytes.length, name: asset.name, mime: asset.mime, base64: asset.bytes.toString("base64") };
const expectedVaultAttachments = [];
let componentAsset;
let component;
if (isMarket) {
  assert.equal(CURRENT_SCHEMA_VERSION, 17);
  const { verifyMarketPack } = await load("electron/main/market/package.js");
  const market = path.join(path.dirname(asar), "market");
  const trust = JSON.parse(fs.readFileSync(path.join(market, "trusted-keys.json"), "utf8"));
  const filename = "life-atlas.pomodoro-1.0.0.atlaspack";
  const bytes = fs.readFileSync(path.join(market, "packages", filename));
  const verified = await verifyMarketPack(bytes, { appVersion, publicKeys: trust.publicKeys });
  componentAsset = { bytes, name: filename, mime: "application/vnd.life-atlas.component+zip" };
  const state = JSON.stringify({ phase: "focus", remaining: 1_280_000, endsAt: null });
  component = { id: "market-pomodoro", sha256: verified.hash, size: bytes.length, mime: componentAsset.mime, props: {
    url: `life-asset://${verified.hash}`, title: verified.meta.title, packageId: verified.meta.id, packageVersion: verified.meta.version, state,
  } };
}

ensureDataRootMarker(dataRoot, { appVersion, now: fixedTime });
const documentPage = (id, title, content, extra = {}) => ({ id, title, folderId, icon: "📄", content, sortIndex: 10, ...marker, ...extra });
const sourceRow = databaseDomain.createDataSource({ id: database.sourceId, title: database.title, ownerPageId: databasePageId, ...marker,
  properties: [{ id: "title", name: "Name", type: "title" }, { id: `${prefix}-files`, name: "Files", type: "files" }] });
const view = { ...databaseDomain.createDatabaseView({ id: database.viewId, sourceId: database.sourceId, name: "Table", type: "table" }), ...marker };
const row = databaseDomain.createDatabaseItem({ id: database.itemId, sourceId: database.sourceId, pageId: database.recordPageId,
  values: { title: database.recordTitle, [`${prefix}-files`]: [asset.id] }, ...marker });
const workspaceInput = {
  ...Object.fromEntries(requiredCollections(CURRENT_SCHEMA_VERSION).map((name) => [name, []])),
  workspaceId, schemaVersion: CURRENT_SCHEMA_VERSION, savedAt: fixedTime,
  folders: [{ id: folderId, name: `${prefix.toUpperCase()} fixtures`, parentId: null, color: "stone", sortIndex: 10, ...marker }],
  pages: [documentPage(page.id, page.title, [
    { id: page.paragraphId, type: "paragraph", content: [{ type: "text", text: page.paragraphText, styles: {} }] },
    { id: `${prefix}-file-block`, type: "file", props: { url: `life-asset://${assetHash}`, name: asset.name, caption: "" } },
    ...(component ? [{ id: component.id, type: "marketComponent", props: component.props }] : []),
  ]), documentPage(databasePageId, database.title, [], { pageType: "database", databaseSourceId: database.sourceId, databaseViewId: database.viewId }),
  documentPage(database.recordPageId, database.recordTitle, [], { databaseSourceId: database.sourceId })],
  dataSources: [sourceRow], databaseViews: [view], databaseItems: [row],
  attachments: [{ id: asset.id, name: asset.name, mime: asset.mime, size: asset.bytes.length, provider: "asset", storageKey: assetHash, checksum: assetHash, ...marker }],
  ui: { preferences: { theme: "dark" } },
};
let idCounter = 0;
const idFactory = (kind) => `${kind}-${prefix}-fixture-${++idCounter}`;
const normalized = normalizeLoadedWorkspace(workspaceInput, { fallbackWorkspace: workspaceInput, now: fixedTime, idFactory });
if (!isMarket) {
  const db = databaseStore.openWorkspaceDatabase(path.join(dataRoot, "workspace.db"));
  try {
    databaseStore.prepareWritable(db);
    databaseStore.initializeWorkspace(db, normalized, { generation: `gen-${prefix}-fixture`, now: fixedTime });
    const store = createAssetStore({ assetsDir: path.join(dataRoot, "assets"), db, now });
    assert.equal(store.put(asset).assetId, assetHash);
  } finally { db.close(); }
}

const workspaceService = createWorkspaceService({ dataRoot, appVersion, now, idFactory });
const assetStore = createAssetStore({ assetsDir: path.join(dataRoot, "assets"), db: () => workspaceService.db, now });
const vaultAttachmentPath = path.join(run, `${prefix}-vault-fixture.bin`);
const vaultService = createVaultService({ dataRoot, clock, appVersion, dialogs: { showOpenDialog: async () => ({ filePaths: [vaultAttachmentPath] }) } });
const destinations = [];
const backup = createBackupService({ dataRoot, workspaceService, assetStore, vaultService, appVersion, now, idFactory,
  dialogs: { showSaveDialog: async () => ({ filePath: destinations.shift() }) }, requestFlush: async () => true, requestConfirmation: async () => "confirmed" });

let fixture;
try {
  await workspaceService.load();
  if (component) {
    workspaceService.replaceWorkspace(normalized);
    assert.equal(assetStore.put(asset).assetId, assetHash);
    assert.equal(assetStore.put(componentAsset).assetId, component.sha256);
  }
  const openedPage = workspaceService.readWorkspace().pages.find((entry) => entry.id === page.id);
  assert.equal(openedPage.content[0].content[0].text, page.paragraphText);
  const { recoveryKey } = await vaultService.create({ password: masterPassword });
  vaultService.confirmRecoveryKey({ lastTwoGroups: lastTwoGroups(recoveryKey) });
  vaultService.updateSettings({ patch: settings });
  let attachmentDraftId;
  if (!isUI40) {
    const bytes = Buffer.concat([Buffer.from([0, 20, 255, 7]), Buffer.from(`synthetic ${prefix} vault note attachment\n`)]);
    fs.writeFileSync(vaultAttachmentPath, bytes, { flag: "wx" });
    const draft = await vaultService.pickAttachments();
    attachmentDraftId = draft.draftId;
    expectedVaultAttachments.push({ ...draft.attachments[0], base64: bytes.toString("base64"), sha256: sha256(bytes) });
  }
  const title = `${prefix.toUpperCase()} synthetic vault item`;
  const { summary } = vaultService.createItem({ input: { type: "login", title, tags: ["synthetic-fixture"], favorite: true, fields: [
    { label: "Password", kind: "secret", sensitive: true, value: secretValue },
    { label: "Notes", kind: "multiline", sensitive: false, value: `${prefix.toUpperCase()} synthetic note` },
  ], ...(attachmentDraftId ? { attachmentDraftId } : {}) } });
  const secretFieldId = vaultService.getItem({ id: summary.id }).item.fields.find((field) => field.kind === "secret").id;
  await vaultService.lock();
  assert.equal((await vaultService.unlock({ password: masterPassword })).summaries[0].id, summary.id);
  assert.equal((await vaultService.revealField({ id: summary.id, fieldId: secretFieldId })).value, secretValue);
  const artifact = (name) => path.join(backupDir, filenames[name]);
  destinations.push(artifact("backupPlain"));
  const plain = await backup.exportFull({ includeVault: true, encryptPassword: null });
  destinations.push(artifact("backupEncrypted"));
  const encrypted = await backup.exportFull({ includeVault: true, encryptPassword: backupPassword });
  assert.deepEqual(encrypted.manifest, plain.manifest);
  const inspector = await backup.inspectFile(artifact("backupEncrypted"));
  assert.equal(inspector.needsPassword, true);
  const checked = await backup.inspectWithPassword({ inspectId: inspector.inspectId, password: backupPassword });
  assert.equal(checked.summary.vault.itemCount, 1);
  if (isUI40) {
    destinations.push(artifact("workspaceOnly"));
    const withoutVault = await backup.exportFull({ includeVault: false, encryptPassword: null });
    assert.equal(withoutVault.manifest.vault.included, false);
    const zip = await openZipFileReader(artifact("backupPlain"));
    try { fs.writeFileSync(artifact("vaultExport"), await zip.read("vault/vault.json"), { flag: "wx" }); }
    finally { zip.close(); }
  }
  const encryptedBytes = fs.readFileSync(artifact("backupEncrypted"));
  const encryptedHeader = JSON.parse(encryptedBytes.subarray(12, 12 + encryptedBytes.readUInt32BE(8)).toString("utf8"));
  const vaultHeader = vaultService.exportCiphertext().header;
  const stableKdf = ({ saltB64, ...params }) => params;
  fixture = {
    fixtureVersion: 1, synthetic: true, source: { release: source.name, appVersion, appAsarSha256: source.sha256, packagedImplementation: true, fixtureClock: fixedTime },
    formats: { workspaceSchemaVersion: CURRENT_SCHEMA_VERSION, backupManifestVersion: plain.manifest.formatVersion,
      encryptedContainer: { formatVersion: encryptedHeader.formatVersion, magicHex: encryptedBytes.subarray(0, 8).toString("hex"), cipher: encryptedHeader.cipher, kdf: stableKdf(encryptedHeader.kdf) },
      vault: { formatVersion: vaultHeader.formatVersion, padding: vaultHeader.padding, kdf: stableKdf(vaultHeader.kdf) } },
    credentials: { masterPassword, recoveryKey, backupPassword },
    expected: { workspaceId, schemaVersion: CURRENT_SCHEMA_VERSION, page, database, workspacePreferences: { theme: "dark" }, attachments: [expectedWorkspaceAttachment],
      ...(component ? { component } : {}),
      vault: { itemId: summary.id, title, secretFieldId, secretValue, requiredSettings: settings, ...(expectedVaultAttachments.length ? { attachments: expectedVaultAttachments } : {}) } },
    files: Object.fromEntries(Object.entries(filenames).map(([key, file]) => [key, { file, sha256: fileSha256(artifact(key)), bytes: fs.statSync(artifact(key)).size }])),
    verification: { ...(isMarket
      ? { generatedByPackagedBackupService: true, outerEncryptedBackupOpenedByPackagedReader: true }
      : { generatedByPublishedBackupService: true, outerEncryptedBackupOpenedByPublishedReader: true }), originalMasterPasswordOpenedVault: true,
      excludedVaultInWorkspaceOnlyBackup: isUI40, vaultAttachmentIncluded: expectedVaultAttachments.length === 1 },
  };
} finally { await backup.stop(); await vaultService.lock(); vaultService.closeDatabase(); workspaceService.close(); }

const profileFile = path.join(backupDir, profileName);
const profile = createZipFileWriter(profileFile);
try {
  for (const file of ["workspace.db", "vault.db"]) {
    assert.ok(!fs.existsSync(path.join(dataRoot, `${file}-wal`)), "Close and checkpoint the old database before freezing the profile");
    profile.addBuffer(file, fs.readFileSync(path.join(dataRoot, file)));
  }
  for (const assetId of component ? [assetHash, component.sha256] : [assetHash]) {
    const assetPath = `assets/${assetId.slice(0, 2)}/${assetId}`;
    profile.addBuffer(assetPath, fs.readFileSync(path.join(dataRoot, assetPath)));
  }
  await profile.finish();
} catch (error) { await profile.abort(); throw error; }
fixture.files.liveProfile = { file: profileName, sha256: fileSha256(profileFile), bytes: fs.statSync(profileFile).size };
fs.mkdirSync(output, { recursive: true });
for (const name of [...Object.values(filenames), profileName]) fs.copyFileSync(path.join(backupDir, name), path.join(output, name), fs.constants.COPYFILE_EXCL);
fs.writeFileSync(path.join(output, "fixture.json"), JSON.stringify(fixture, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ baseline, source: fixture.source.release, schemaVersion: fixture.expected.schemaVersion, files: fixture.files, vaultAttachments: expectedVaultAttachments.length }));
