import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createAssistantConversationStore } from "../electron/main/assistant/conversations.js";
import { createBackupService } from "../electron/main/backup/index.js";
import { exportFullBackup } from "../electron/main/backup/desktopExport.js";
import { createZipFileWriter, openZipFileReader } from "../electron/main/backup/zipNode.js";
import { jsonBytes, parseJsonBytes } from "../src/backup/serialize.js";
import { createDesktopBackupContext } from "./desktop/backup-helpers.mjs";

const first = "10000000-0000-4000-8000-000000000001";
const second = "10000000-0000-4000-8000-000000000002";
const timestamp = "2026-11-24T00:00:00.000Z";

function chatStore({ dataRoot }) {
  return createAssistantConversationStore({ dataRoot, now: () => timestamp });
}

function saveChat(fixture, store, { id, title, sourceId = null, reasoning }) {
  const bytes = Buffer.from(title);
  const mimeType = "text/plain";
  const name = title + ".txt";
  const asset = fixture.assetStore.put({ bytes, mime: mimeType, name });
  store.saveConversation({
    activeId: id,
    conversation: { id, title, sourceId, revision: 0, messages: [
      { id: "10000000-0000-4000-8000-000000000003", role: "user", content: title, workspaceEnabled: false, attachments: [
        { id: "attachment", name, mimeType, size: bytes.length, assetUrl: asset.url, kind: "text" },
      ] },
      ...(reasoning ? [{ id: "10000000-0000-4000-8000-000000000004", role: "assistant", content: "Archived answer", reasoning }] : []),
    ] },
  });
  return asset.assetId;
}

function makeBackup(context, fixture, options = {}) {
  const service = createBackupService({ ...fixture, ...options });
  context.after(() => service.stop());
  return service;
}

async function portableBackup(context, fixture, store) {
  const file = path.join(fixture.dataRoot, "with-chats.lifeatlas");
  const backup = makeBackup(context, fixture, {
    conversations: store,
    dialogs: { showSaveDialog: async () => ({ filePath: file }) },
  });
  const result = await backup.exportFull({ includeVault: false, encryptPassword: null });
  return { file, manifest: result.manifest };
}

function assertAsset(fixture, id, text) {
  assert.equal(fixture.assetStore.get(id)?.sha256, id);
  assert.equal(fs.readFileSync(fixture.assetStore.filePath(id), "utf8"), text);
}

test("full v1 backups restore assistant chats and attachments across data roots, including setup", async (context) => {
  const source = await createDesktopBackupContext(context);
  const sourceChats = chatStore(source);
  const sourceAsset = saveChat(source, sourceChats, { id: first, title: "Archived conversation" });
  const reasoning = "Check the archived attachment.";
  const branchAsset = saveChat(source, sourceChats, { id: second, title: "Archived fork", sourceId: first, reasoning });
  const { file, manifest } = await portableBackup(context, source, sourceChats);
  assert.equal(manifest.formatVersion, 1);
  assert.ok(manifest.files.some((entry) => entry.path === "assistant/conversations.json"));

  const temporary = await createDesktopBackupContext(context, { seed: false });
  const destination = await createDesktopBackupContext(context, { seed: false });
  const importer = makeBackup(context, { dataRoot: temporary.dataRoot });
  const { token } = await importer.inspectFile(file);
  await importer.restoreToken(token, { ...destination, initialSetup: true });
  const restored = chatStore(destination);
  assert.deepEqual(restored.exportBackup(), sourceChats.exportBackup());
  assert.equal(restored.getConversation({ id: second }).messages.at(-1).reasoning, reasoning);
  assert.equal(fs.existsSync(chatStore(temporary).databasePath), false);
  assertAsset(destination, sourceAsset, "Archived conversation");
  assertAsset(destination, branchAsset, "Archived fork");

  const conflict = await createDesktopBackupContext(context, { seed: false });
  const currentChats = chatStore(conflict);
  const currentAsset = saveChat(conflict, currentChats, { id: first, title: "Current conversation" });
  const currentBackup = makeBackup(context, conflict, { conversations: currentChats });
  const inspected = await currentBackup.inspectFile(file);
  await currentBackup.restore({ token: inspected.token, restoreVault: false });
  assert.equal(currentChats.listConversations().activeId, first);
  assert.equal(currentChats.getConversation({ id: first }).title, "Current conversation");
  assert.equal(currentChats.getConversation({ id: second }).sourceId, first);
  assertAsset(conflict, currentAsset, "Current conversation");
  assertAsset(conflict, branchAsset, "Archived fork");
});

test("restore from a legacy archive or workspace snapshot preserves current assistant attachment metadata", async (context) => {
  const source = await createDesktopBackupContext(context);
  const file = path.join(source.dataRoot, "legacy.lifeatlas");
  const { manifest } = await exportFullBackup({
    ...source, db: source.workspaceService.db, workspace: source.workspaceService.readWorkspace(), targetPath: file,
  });
  assert.ok(!manifest.files.some((entry) => entry.path === "assistant/conversations.json"));

  const destination = await createDesktopBackupContext(context, { seed: false });
  const chat = chatStore(destination);
  const backup = makeBackup(context, destination, { conversations: chat });
  const { snapshot } = await backup.createSnapshot();
  const retained = saveChat(destination, chat, { id: first, title: "Keep local attachment" });
  const current = chat.exportBackup();
  const { token } = await backup.inspectFile(file);
  await backup.restore({ token, restoreVault: false });
  assert.deepEqual(chat.exportBackup(), current);
  assertAsset(destination, retained, "Keep local attachment");

  await backup.restoreSnapshot({ id: snapshot.id, restoreWorkspace: true, restoreVault: false });
  assert.deepEqual(chat.exportBackup(), current);
  assertAsset(destination, retained, "Keep local attachment");
});

test("failure while swapping the assistant database rolls back workspace and chats together", async (context) => {
  const source = await createDesktopBackupContext(context);
  const sourceChats = chatStore(source);
  saveChat(source, sourceChats, { id: second, title: "Incoming chat" });
  const { file } = await portableBackup(context, source, sourceChats);

  const destination = await createDesktopBackupContext(context, { seed: false });
  const currentChats = chatStore(destination);
  const retainedAsset = saveChat(destination, currentChats, { id: first, title: "Existing chat" });
  const before = currentChats.exportBackup();
  const currentWorkspace = destination.workspaceService.readWorkspace();
  let swapCount = 0;
  const importer = makeBackup(context, destination, { conversations: currentChats, injectFailure(phase) {
    if (phase === "restore-swap" && ++swapCount === 2) throw new Error("fixture swap interruption");
  } });
  const { token } = await importer.inspectFile(file);
  await assert.rejects(importer.restore({ token, restoreVault: false }), { code: "E_IO" });
  assert.equal(swapCount, 2);
  assert.deepEqual(currentChats.exportBackup(), before);
  assert.deepEqual(destination.workspaceService.readWorkspace(), currentWorkspace);
  assertAsset(destination, retainedAsset, "Existing chat");
  assert.deepEqual(currentChats.selectConversation({ id: first }), { activeId: first });
});

test("a hashed assistant archive with a missing asset is rejected before it can be restored", async (context) => {
  const source = await createDesktopBackupContext(context);
  const chats = chatStore(source);
  saveChat(source, chats, { id: first, title: "Attachment indexed in the archive" });
  const { file } = await portableBackup(context, source, chats);
  const edited = path.join(source.dataRoot, "missing-chat-attachment.lifeatlas");
  const reader = await openZipFileReader(file);
  const writer = createZipFileWriter(edited);
  try {
    const entryName = "assistant/conversations.json";
    const archive = parseJsonBytes(await reader.read(entryName));
    archive.conversations[0].messages[0].attachments[0].assetUrl = "life-asset://" + "f".repeat(64);
    const replacement = jsonBytes(archive);
    const manifest = parseJsonBytes(await reader.read("manifest.json"));
    Object.assign(manifest.files.find(({ path }) => path === entryName), {
      size: replacement.byteLength,
      sha256: createHash("sha256").update(replacement).digest("hex"),
    });
    writer.addBuffer("manifest.json", jsonBytes(manifest));
    for (const name of reader.entries().slice(1)) writer.addBuffer(name, name === entryName ? replacement : await reader.read(name));
    await writer.finish();
  } catch (error) {
    await writer.abort();
    throw error;
  } finally { reader.close(); }

  const backup = makeBackup(context, source, { conversations: chats });
  const result = await backup.inspectFile(edited);
  assert.equal(result.token, undefined);
  assert.deepEqual(result.problems.map(({ code }) => code), ["BAD_ASSISTANT"]);
});
