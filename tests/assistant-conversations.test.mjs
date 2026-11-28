import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createAssistantConversationStore, validateAssistantConversationBackup } from "../electron/main/assistant/conversations.js";
import { createAssistantConfig } from "../electron/main/assistant/config.js";
import { assistantPromptHistory, createAssistantConversation, createAssistantMessage } from "../src/assistant/conversation.js";

function tempRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "la-assistant-conversations-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

const reply = (content) => ({ id: crypto.randomUUID(), role: "assistant", content });

test("conversation history is lazy, isolated to the data root, and retained after provider changes", (t) => {
  const dataRoot = tempRoot(t);
  const otherRoot = tempRoot(t);
  const store = createAssistantConversationStore({ dataRoot });
  assert.deepEqual(store.listConversations(), { activeId: null, conversations: [] });
  assert.deepEqual(store.selectConversation({ id: null }), { activeId: null });
  assert.deepEqual(store.listAttachmentAssetIds(), []);
  assert.equal(fs.existsSync(path.join(dataRoot, "assistant")), false);
  assert.throws(() => store.selectConversation({ id: crypto.randomUUID() }), { code: "E_NOT_FOUND" });

  const assetId = "a".repeat(64);
  const attachment = { id: "photo", name: "photo.png", mimeType: "image/png", size: 1024, kind: "image", assetUrl: `life-asset://${assetId}`,
    imageUrl: "data:image/png;base64,SHOULD_NOT_BE_SAVED" };
  const firstMessage = createAssistantMessage("描述图片以及这个页面", [attachment], true, "page-context");
  const conversation = createAssistantConversation(firstMessage);
  const meta = store.saveConversation({ conversation, activeId: conversation.id });
  assert.equal(meta.revision, 1);
  const storeAfterRestart = createAssistantConversationStore({ dataRoot });
  const loaded = storeAfterRestart.getConversation({ id: conversation.id });
  assert.deepEqual(loaded.messages, [firstMessage]);
  assert.equal(loaded.messages[0].contextPageId, "page-context");
  assert.equal(Object.hasOwn(loaded.messages[0].attachments[0], "imageUrl"), false);
  assert.deepEqual(storeAfterRestart.listAttachmentAssetIds(), [assetId]);

  const config = createAssistantConfig({ configDirectory: path.join(otherRoot, "provider") });
  config.configure({ baseUrl: "http://127.0.0.1:1234/v1", model: "first" });
  config.configure({ baseUrl: "http://127.0.0.1:1235/v1", model: "second" });
  assert.equal(storeAfterRestart.listConversations().activeId, conversation.id);
  const other = createAssistantConversationStore({ dataRoot: otherRoot });
  assert.deepEqual(other.listConversations(), { activeId: null, conversations: [] });
  assert.throws(() => other.getConversation({ id: conversation.id }), { code: "E_NOT_FOUND" });
});

test("stale revisions cannot overwrite a reply, and rename does not switch the selected history entry", (t) => {
  const dataRoot = tempRoot(t);
  const store = createAssistantConversationStore({ dataRoot });
  const first = createAssistantConversation(createAssistantMessage("第一条对话", [], false));
  store.saveConversation({ conversation: first, activeId: first.id });
  const openFirst = () => store.getConversation({ id: first.id });
  const stale = openFirst();
  const updatedMessages = [...stale.messages, { ...reply("已收到"), reasoning: "先核对查询范围。" }];
  store.saveConversation({ conversation: { ...stale, messages: updatedMessages } });
  assert.throws(() => store.saveConversation({ conversation: { ...stale, title: "过期名称" } }), { code: "E_CONFLICT" });

  const second = createAssistantConversation(createAssistantMessage("第二条对话", [], false));
  store.saveConversation({ conversation: second, activeId: second.id });
  store.saveConversation({ conversation: { ...openFirst(), title: "改好的名称" } });
  assert.equal(store.listConversations().activeId, second.id);
  assert.equal(openFirst().title, "改好的名称");
  assert.deepEqual(openFirst().messages, updatedMessages);
  assert.deepEqual(createAssistantConversationStore({ dataRoot }).getConversation({ id: first.id }).messages, updatedMessages);
  store.selectConversation({ id: null });
  assert.equal(store.listConversations().activeId, null);
  store.selectConversation({ id: first.id });
  assert.equal(createAssistantConversationStore({ dataRoot }).listConversations().activeId, first.id);
});

test("editing forks at the selected turn and keeps completed operations in the original transcript", (t) => {
  const store = createAssistantConversationStore({ dataRoot: tempRoot(t) });
  const first = createAssistantMessage("修改本页", [], true, "page-original");
  const second = createAssistantMessage("写一个更短的摘要", [], true, "page-original");
  const event = { id: crypto.randomUUID(), role: "tool", content: "更新页面" };
  const acknowledgment = reply("页面已更新");
  const initial = createAssistantConversation(first);
  const original = { ...initial, messages: [first, event, acknowledgment, second, reply("旧摘要")] };
  store.saveConversation({ conversation: original, activeId: original.id });

  const revisedMessage = createAssistantMessage("用三点概括上面的回复", [], false);
  const branch = createAssistantConversation(revisedMessage, { source: original, messageId: second.id });
  assert.equal(branch.sourceId, original.id);
  assert.notEqual(branch.id, original.id);
  assert.deepEqual(branch.messages, [first, event, acknowledgment, revisedMessage]);
  assert.deepEqual(assistantPromptHistory(branch.messages), [first, acknowledgment, revisedMessage]);
  assert.equal(revisedMessage.workspaceEnabled, false);
  store.saveConversation({ conversation: branch, activeId: branch.id });

  assert.deepEqual(store.getConversation({ id: original.id }).messages, original.messages);
  assert.equal(store.listConversations().activeId, branch.id);
  assert.equal(store.getConversation({ id: branch.id }).sourceId, original.id);
  assert.equal(store.listConversations().conversations.length, 2);
});

test("conversation storage refuses a redirected data directory", (t) => {
  const dataRoot = tempRoot(t);
  const outside = tempRoot(t);
  fs.symlinkSync(outside, path.join(dataRoot, "assistant"), process.platform === "win32" ? "junction" : "dir");
  const store = createAssistantConversationStore({ dataRoot });
  assert.throws(() => store.listConversations(), { code: "E_INVALID_ARGUMENT" });
  assert.throws(() => store.saveConversation({ conversation: createAssistantConversation(createAssistantMessage("本地数据", [], false)) }), { code: "E_INVALID_ARGUMENT" });
  assert.deepEqual(fs.readdirSync(outside), []);
});

test("portable chat restore stages a local-preserving merge while normal writes are frozen", (t) => {
  const dataRoot = tempRoot(t);
  const local = createAssistantConversationStore({ dataRoot });
  const fromArchive = createAssistantConversationStore({ dataRoot: tempRoot(t) });
  const older = createAssistantConversation(createAssistantMessage("较早的对话", [], false));
  local.saveConversation({ conversation: { ...older, title: "本机名称" }, activeId: older.id });
  fromArchive.saveConversation({ conversation: older, activeId: older.id });
  const assetId = "b".repeat(64);
  const attachment = { id: "file", name: "notes.md", mimeType: "text/markdown", size: 1024, kind: "text", assetUrl: `life-asset://${assetId}` };
  const branch = createAssistantConversation(createAssistantMessage("看附件", [attachment], false), { source: older, messageId: older.messages[0].id });
  fromArchive.saveConversation({ conversation: branch, activeId: branch.id });
  const backup = fromArchive.exportBackup();
  assert.deepEqual(validateAssistantConversationBackup(backup), { attachmentAssetIds: [assetId] });
  assert.throws(() => validateAssistantConversationBackup({ ...backup, conversations: [backup.conversations.find(({ id }) => id === branch.id)] }), { code: "E_CORRUPT" });

  const stage = path.join(dataRoot, "assistant-import.sqlite");
  local.suspendWrites();
  try {
    assert.throws(() => local.selectConversation({ id: null }), { code: "E_LOCKED" });
    assert.deepEqual(local.stageBackup(backup, stage), { attachmentAssetIds: [assetId] });
    assert.deepEqual(local.listConversations().conversations.map(({ id }) => id), [older.id]);
    const db = new DatabaseSync(stage, { readOnly: true });
    try {
      assert.equal(db.prepare("SELECT active_id FROM session").get().active_id, older.id);
      assert.equal(db.prepare("SELECT title FROM conversations WHERE id=?").get(older.id).title, "本机名称");
      assert.equal(db.prepare("SELECT source_id FROM conversations WHERE id=?").get(branch.id).source_id, older.id);
    } finally { db.close(); }
  } finally { local.resumeWrites(); }
  assert.equal(local.selectConversation({ id: null }).activeId, null);
});
