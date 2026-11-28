import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createVaultService } from "../electron/main/vault/index.js";
import { MAX_ATTACHMENT_BYTES } from "../electron/main/vault/attachmentFiles.js";
import { lastTwoGroups } from "../electron/main/vault/recoveryKey.js";
import { createBackupService } from "../electron/main/backup/index.js";
import { openZipFileReader } from "../electron/main/backup/zipNode.js";
import { createDialogs } from "../electron/main/dialogs.js";
import { TEST_PASSWORD, NEXT_PASSWORD, createVaultTestContext } from "./fixtures/vault-items.mjs";
import { createIsolatedDirectory, removeIsolatedDirectory } from "./desktop/helpers.mjs";
import { createDesktopBackupContext, fastBackupDeriveKey } from "./desktop/backup-helpers.mjs";

const note = { type: "secureNote", title: "附件测试笔记", fields: [{ label: "内容", kind: "multiline", value: "记下恢复步骤", sensitive: true }] };

function testFiles(context) {
  const directory = createIsolatedDirectory("vault-attachment-files");
  context.after(() => removeIsolatedDirectory(directory));
  return (file) => path.join(directory, file);
}

function fixtureDialogs() {
  const openings = [];
  const savings = [];
  return {
    dialogs: {
      showOpenDialog: () => openings.shift() ?? { canceled: true },
      showSaveDialog: () => savings.shift() ?? { canceled: true },
    },
    openings,
    savings,
  };
}

async function createConfirmedVault(service) {
  const { recoveryKey } = await service.create({ password: TEST_PASSWORD });
  service.confirmRecoveryKey({ lastTwoGroups: lastTwoGroups(recoveryKey) });
}

test("vault files commit with the note, are masked, survive key rotation, and export byte for byte", async (context) => {
  const fixture = fixtureDialogs();
  const { service, file, dataRoot } = createVaultTestContext(context, { dialogs: fixture.dialogs });
  const testFile = testFiles(context);
  await createConfirmedVault(service);
  const untouched = service.createItem({ input: note }).summary.id;
  assert.equal(service.getItem({ id: untouched }).item.attachments, undefined);
  const bytes = Buffer.concat([Buffer.from([0, 255, 3]), Buffer.from("VAULT_TEST_ATTACHMENT_BYTES_f01c8ea0")]);
  const source = testFile("说明备份.bin");
  const empty = testFile("空附件.txt");
  fs.writeFileSync(source, bytes);
  fs.writeFileSync(empty, "");
  fixture.openings.push({ filePaths: [source] }, { filePaths: [empty] });
  const first = await service.pickAttachments();
  const selected = await service.pickAttachments({ draftId: first.draftId });
  assert.equal(selected.draftId, first.draftId);
  assert.deepEqual(selected.attachments.map(({ name, size }) => [name, size]), [["说明备份.bin", bytes.length], ["空附件.txt", 0]]);
  const discardedId = selected.attachments[1].id;
  assert.deepEqual(service.discardAttachmentDraft({ draftId: first.draftId, attachmentId: discardedId }).attachments, first.attachments);
  assert.equal(service.list().summaries.length, 1);
  const { id } = service.createItem({ input: { ...note, attachmentDraftId: first.draftId } }).summary;
  assert.throws(() => service.createItem({ input: { ...note, attachmentDraftId: first.draftId } }), { code: "E_NOT_FOUND" });
  const [attachment] = service.getItem({ id }).item.attachments;
  assert.deepEqual(attachment, { id: first.attachments[0].id, name: "说明备份.bin", size: bytes.length });
  assert.ok(service.list().summaries.every((summary) => !Object.hasOwn(summary, "attachments")));
  assert.throws(() => service.updateItem({ id, patch: { title: "unsaved", removeAttachmentIds: [discardedId] } }), { code: "E_NOT_FOUND" });
  assert.equal(service.getItem({ id }).item.title, note.title);

  const rotation = await service.changePassword({ currentPassword: TEST_PASSWORD, newPassword: NEXT_PASSWORD });
  await assert.rejects(service.saveAttachmentCopy({ id, attachmentId: attachment.id }), { code: "E_LOCKED" });
  service.confirmRecoveryKey({ lastTwoGroups: lastTwoGroups(rotation.recoveryKey) });
  assert.deepEqual(service.getItem({ id }).item.attachments, [attachment]);
  for (const filename of [file, `${file}-wal`]) {
    assert.ok(!fs.readFileSync(filename).includes(bytes));
    assert.ok(!fs.readFileSync(filename).includes(Buffer.from(bytes.toString("base64"))));
    assert.ok(!fs.readFileSync(filename).includes(Buffer.from("说明备份.bin")));
  }
  fs.unlinkSync(source);
  const output = testFile("明确保存的副本.bin");
  const blocked = path.join(dataRoot, "workspace-clear.bin");
  fixture.savings.push({ filePath: blocked }, { filePath: output }, { filePath: output });
  await assert.rejects(service.saveAttachmentCopy({ id, attachmentId: attachment.id }), { code: "E_INVALID_ARGUMENT" });
  assert.equal(fs.existsSync(blocked), false);
  assert.deepEqual(await service.saveAttachmentCopy({ id, attachmentId: attachment.id }), { saved: true });
  assert.deepEqual(fs.readFileSync(output), bytes);
  await assert.rejects(service.saveAttachmentCopy({ id, attachmentId: attachment.id }), { code: "E_CONFLICT" });
  assert.deepEqual(fs.readFileSync(output), bytes);

  service.updateItem({ id, patch: { removeAttachmentIds: [attachment.id] } });
  assert.deepEqual(service.getItem({ id }).item.attachments, []);
  await assert.rejects(service.saveAttachmentCopy({ id, attachmentId: attachment.id }), { code: "E_NOT_FOUND" });
});

test("readAttachmentPreview serves in-memory data URLs only for safe raster images and rejects non-images", async (context) => {
  const fixture = fixtureDialogs();
  const { service } = createVaultTestContext(context, { dialogs: fixture.dialogs });
  const testFile = testFiles(context);
  await createConfirmedVault(service);
  const pngBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l7sAAAAASUVORK5CYII=", "base64");
  const pngFile = testFile("qr.png");
  const svgFile = testFile("unsafe.svg");
  fs.writeFileSync(pngFile, pngBytes);
  fs.writeFileSync(svgFile, '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  fixture.openings.push({ filePaths: [pngFile, svgFile] });
  const draft = await service.pickAttachments({ filter: "images" });
  const [pngMeta, svgMeta] = draft.attachments;
  const draftPreview = service.readAttachmentPreview({ draftId: draft.draftId, attachmentId: pngMeta.id });
  assert.equal(draftPreview.previewable, true);
  assert.equal(draftPreview.mimeType, "image/png");
  assert.ok(draftPreview.dataUrl.startsWith("data:image/png;base64,"));
  assert.deepEqual(service.readAttachmentPreview({ draftId: draft.draftId, attachmentId: svgMeta.id }), { previewable: false });

  const { id } = service.createItem({ input: { ...note, attachmentDraftId: draft.draftId } }).summary;
  const savedPreview = service.readAttachmentPreview({ id, attachmentId: pngMeta.id });
  assert.equal(savedPreview.previewable, true);
  assert.equal(savedPreview.dataUrl, draftPreview.dataUrl);
  assert.deepEqual(service.readAttachmentPreview({ id, attachmentId: svgMeta.id }), { previewable: false });
  await service.lock();
  assert.throws(() => service.readAttachmentPreview({ id, attachmentId: pngMeta.id }), { code: "E_LOCKED" });
});

test("draft downloads preserve original bytes and reject discarded selections", async (context) => {
  const fixture = fixtureDialogs();
  const { service, dataRoot } = createVaultTestContext(context, { dialogs: fixture.dialogs });
  const file = testFiles(context);
  await createConfirmedVault(service);
  const original = file("凭据样本.bin");
  const output = file("草稿副本.bin");
  const bytes = Buffer.from([0, 255, 227, 128, 230, 17, 0]);
  fs.writeFileSync(original, bytes);
  fixture.openings.push({ filePaths: [original] });
  const selection = await service.pickAttachments();
  const source = { draftId: selection.draftId, attachmentId: selection.attachments[0].id };
  fs.unlinkSync(original);
  assert.deepEqual(await service.saveAttachmentCopy(source), { cancelled: true });
  fixture.savings.push({ filePath: path.join(dataRoot, "草稿副本.bin") }, { filePath: output });
  await assert.rejects(service.saveAttachmentCopy(source), { code: "E_INVALID_ARGUMENT" });
  assert.deepEqual(await service.saveAttachmentCopy(source), { saved: true });
  assert.deepEqual(fs.readFileSync(output), bytes);
  assert.deepEqual(service.list().summaries, []);

  const dialogOpened = Promise.withResolvers();
  const dialogResult = Promise.withResolvers();
  fixture.dialogs.showSaveDialog = () => { dialogOpened.resolve(); return dialogResult.promise; };
  const pending = service.saveAttachmentCopy(source);
  await dialogOpened.promise;
  service.discardAttachmentDraft({ draftId: source.draftId });
  const discardedCopy = file("已取消的草稿.bin");
  dialogResult.resolve({ filePath: discardedCopy });
  await assert.rejects(pending, { code: "E_NOT_FOUND" });
  assert.equal(fs.existsSync(discardedCopy), false);
});

test("failed picks and locking do not commit files or allow pending copies to be saved", async (context) => {
  const fixture = fixtureDialogs();
  const { service, dataRoot } = createVaultTestContext(context, { dialogs: fixture.dialogs });
  const testFile = testFiles(context);
  await createConfirmedVault(service);
  const normal = testFile("正常文件.txt");
  const big = testFile("过大的文件.bin");
  fs.writeFileSync(normal, "only an isolated fixture");
  fs.closeSync(fs.openSync(big, "wx"));
  fs.truncateSync(big, MAX_ATTACHMENT_BYTES + 1);
  const emptyVault = service.exportCiphertext();
  fixture.openings.push({ filePaths: [normal, big] }, { filePaths: [normal] });
  await assert.rejects(service.pickAttachments(), { code: "E_INVALID_ARGUMENT" });
  assert.deepEqual(service.exportCiphertext(), emptyVault);

  const pending = await service.pickAttachments();
  await service.lock();
  await assert.rejects(service.pickAttachments(), { code: "E_LOCKED" });
  assert.throws(() => service.discardAttachmentDraft({ draftId: pending.draftId }), { code: "E_LOCKED" });
  assert.throws(() => service.createItem({ input: { ...note, attachmentDraftId: pending.draftId } }), { code: "E_LOCKED" });
  await service.unlock({ password: TEST_PASSWORD });
  assert.throws(() => service.createItem({ input: { ...note, attachmentDraftId: pending.draftId } }), { code: "E_NOT_FOUND" });

  const picking = Promise.withResolvers();
  fixture.openings.push(picking.promise);
  const afterLock = assert.rejects(service.pickAttachments(), { code: "E_LOCKED" });
  await service.lock();
  await service.unlock({ password: TEST_PASSWORD });
  picking.resolve({ filePaths: [normal] });
  await afterLock;
  assert.equal(service.list().summaries.length, 0);

  fixture.openings.push({ filePaths: [normal] });
  const approved = await service.pickAttachments();
  const { id } = service.createItem({ input: { ...note, attachmentDraftId: approved.draftId } }).summary;
  const { id: attachmentId } = approved.attachments[0];
  assert.deepEqual(await service.saveAttachmentCopy({ id, attachmentId }), { cancelled: true });
  const saving = Promise.withResolvers();
  fixture.savings.push(saving.promise);
  const beforeLock = assert.rejects(service.saveAttachmentCopy({ id, attachmentId }), { code: "E_LOCKED" });
  await Promise.resolve();
  await service.lock();
  await service.unlock({ password: TEST_PASSWORD });
  const output = testFile("锁定后不得生成.txt");
  saving.resolve({ filePath: output });
  await beforeLock;
  assert.equal(fs.existsSync(output), false);
  assert.ok(!fs.existsSync(path.join(dataRoot, "assets")));
});

test("saving a vault attachment honors the master password confirmation setting", async (context) => {
  const fixture = fixtureDialogs();
  let answer = "canceled";
  const confirmations = [];
  const requestConfirmation = async (input) => { confirmations.push(input); return answer; };
  const { service } = createVaultTestContext(context, { dialogs: fixture.dialogs, requestConfirmation });
  const testFile = testFiles(context);
  await createConfirmedVault(service);
  const source = testFile("fixture.txt");
  const output = testFile("verified-copy.txt");
  fs.writeFileSync(source, "fixture bytes");
  fixture.openings.push({ filePaths: [source] });
  const draft = await service.pickAttachments();
  const { id } = service.createItem({ input: { ...note, attachmentDraftId: draft.draftId } }).summary;
  const { id: attachmentId } = draft.attachments[0];
  fixture.savings.push({ filePath: output });
  service.updateSettings({ patch: { verifyBeforeReveal: true } });
  await assert.rejects(service.saveAttachmentCopy({ id, attachmentId }), { code: "E_CANCELLED" });
  assert.equal(confirmations[0].title, "保存备注附件副本");
  assert.equal(fixture.savings.length, 1);
  assert.equal(fs.existsSync(output), false);
  answer = "confirmed";
  assert.deepEqual(await service.saveAttachmentCopy({ id, attachmentId }), { saved: true });
  assert.equal(fs.readFileSync(output, "utf8"), "fixture bytes");
});

test("full desktop backup restores bytes from a multi-mebibyte vault file", async (context) => {
  const sourceDialogs = fixtureDialogs();
  const destinationDialogs = fixtureDialogs();
  const testFile = testFiles(context);
  const makeVault = (dialogs) => (dataRoot) => createVaultService({ dataRoot, deriveKey: fastBackupDeriveKey, dialogs });
  const source = await createDesktopBackupContext(context, { vaultService: makeVault(sourceDialogs.dialogs) });
  const destination = await createDesktopBackupContext(context, { vaultService: makeVault(destinationDialogs.dialogs), seed: false });
  const backupDialogs = createDialogs({ testHooksEnabled: true });
  const makeBackup = (scope) => createBackupService({ ...scope, dialogs: backupDialogs, requestFlush: async () => true, requestConfirmation: async () => "confirmed" });
  const backup = makeBackup(source);
  const restore = makeBackup(destination);
  try {
    await createConfirmedVault(source.vaultService);
    const bytes = Buffer.alloc(4 * 1024 * 1024, 0xa5);
    const marker = Buffer.from("ISOLATED-VAULT-Backup-bytes-9ca12d42");
    marker.copy(bytes);
    const file = testFile("秘密夹具-vault-file.dat");
    fs.writeFileSync(file, bytes);
    sourceDialogs.openings.push({ filePaths: [file] });
    const draft = await source.vaultService.pickAttachments();
    const { id } = source.vaultService.createItem({ input: { ...note, attachmentDraftId: draft.draftId } }).summary;
    const backupFile = testFile("vault-files.lifeatlas");
    backupDialogs.state.queue.showSaveDialog.push(backupFile);
    await backup.exportFull({ includeVault: true, encryptPassword: null });

    const archive = await openZipFileReader(backupFile);
    try {
      const entry = await archive.read("vault/vault.json");
      assert.ok(!entry.includes(marker));
      assert.ok(!entry.includes(Buffer.from(path.basename(file))));
      assert.ok(!entry.includes(Buffer.from(marker.toString("base64").slice(0, 24))));
    } finally { archive.close(); }
    const inspected = await restore.inspectFile(backupFile);
    assert.equal(inspected.summary.vault.included, true);
    await restore.restore({ token: inspected.token, restoreVault: true });
    assert.equal(destination.vaultService.status().locked, true);
    await destination.vaultService.unlock({ password: TEST_PASSWORD });
    const details = destination.vaultService.getItem({ id }).item;
    assert.deepEqual(details.attachments, draft.attachments);
    assert.equal(details.fields[0].masked, true);
    fs.unlinkSync(file);
    const restored = testFile("restored-vault-file.dat");
    destinationDialogs.savings.push({ filePath: restored });
    assert.deepEqual(await destination.vaultService.saveAttachmentCopy({ id, attachmentId: details.attachments[0].id }), { saved: true });
    assert.deepEqual(fs.readFileSync(restored), bytes);
  } finally { await Promise.all([backup.stop(), restore.stop()]); }
});
