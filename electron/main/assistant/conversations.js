import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { maxAssistantAttachmentBytes, maxAssistantAttachments, maxAssistantMessageLength, maxAssistantReasoningLength, maxAssistantTitleLength } from "../../../src/assistant/conversation.js";
import { isNonEmptyString, isPlainObject } from "../ipc/validate.js";
import { assertPhysicalPath } from "../storage/dataRoot.js";
import { assistantError } from "./errors.js";

const idPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const maximumMessages = 2000;
const maximumConversationBytes = 16 * 1024 * 1024;
const metadataColumns = "id, title, updated_at AS updatedAt, revision, source_id AS sourceId";
const assetPrefix = "life-asset://";
const invalid = () => assistantError("E_INVALID_ARGUMENT", "对话格式无效。");
const missing = () => assistantError("E_NOT_FOUND", "找不到这段对话。");
const invalidBackup = () => assistantError("E_CORRUPT", "备份中的助手对话格式无效。");

function validId(value) {
  return typeof value === "string" && idPattern.test(value);
}

function normalizeAttachment(value) {
  if (!isPlainObject(value) || !isNonEmptyString(value.id, 160) || !isNonEmptyString(value.name, 255)
    || !["file", "image", "text"].includes(value.kind) || typeof value.mimeType !== "string" || value.mimeType.length > 128
    || !Number.isSafeInteger(value.size) || value.size < 1 || value.size > maxAssistantAttachmentBytes
    || typeof value.assetUrl !== "string" || !/^life-asset:\/\/[a-f0-9]{64}$/.test(value.assetUrl)) throw invalid();
  const { id, name, kind, mimeType, size, assetUrl } = value;
  return { id, name, kind, mimeType, size, assetUrl };
}

function normalizeConversation(value) {
  if (!isPlainObject(value) || !validId(value.id) || !isNonEmptyString(value.title, maxAssistantTitleLength)
    || !Number.isSafeInteger(value.revision) || value.revision < 0 || value.revision >= Number.MAX_SAFE_INTEGER || !Array.isArray(value.messages) || !value.messages.length
    || (value.sourceId != null && (!validId(value.sourceId) || value.sourceId === value.id))) throw invalid();
  if (value.messages.length > maximumMessages) throw assistantError("E_INVALID_ARGUMENT", "当前对话已达本地存储上限，请新建对话。");
  const ids = new Set();
  const messages = value.messages.map((message) => {
    if (!isPlainObject(message) || !validId(message.id) || ids.has(message.id) || !["user", "assistant", "tool"].includes(message.role)
      || typeof message.content !== "string" || message.content.length > (message.role === "user" ? maxAssistantMessageLength : 32000)) throw invalid();
    ids.add(message.id);
    const { id, role, content } = message;
    if (role === "user") {
      const { attachments, workspaceEnabled, contextPageId } = message;
      if (typeof workspaceEnabled !== "boolean" || !Array.isArray(attachments) || attachments.length > maxAssistantAttachments
        || (!content.trim() && !attachments.length)
        || (contextPageId !== undefined && (!workspaceEnabled || !isNonEmptyString(contextPageId, 200)))) throw invalid();
      return { id, role, content, workspaceEnabled, attachments: attachments.map(normalizeAttachment), ...(contextPageId ? { contextPageId } : {}) };
    }
    if (role === "assistant" && message.reasoning !== undefined) {
      if (typeof message.reasoning !== "string" || message.reasoning.length > maxAssistantReasoningLength) throw invalid();
      if (message.reasoning.trim()) return { id, role, content, reasoning: message.reasoning };
    }
    return { id, role, content, ...(role === "tool" && message.error ? { error: true } : {}) };
  });
  if (messages[0].role !== "user") throw invalid();
  const body = JSON.stringify(messages);
  if (Buffer.byteLength(body) > maximumConversationBytes) throw assistantError("E_INVALID_ARGUMENT", "当前对话已达本地存储上限，请新建对话。");
  return { id: value.id, title: value.title.trim(), revision: value.revision, sourceId: value.sourceId ?? null, body };
}

function transaction(db, operation) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = operation();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    if (db.isTransaction) db.exec("ROLLBACK");
    throw error;
  }
}

function schemaVersion(db) {
  return db.prepare("PRAGMA user_version").get().user_version;
}

function initialize(db) {
  transaction(db, () => {
    const version = schemaVersion(db);
    if (version === 1) return;
    if (version !== 0) throw assistantError("E_UNSUPPORTED_VERSION", "对话数据使用了不支持的版本。");
    db.exec(`CREATE TABLE conversations (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, updated_at TEXT NOT NULL, revision INTEGER NOT NULL,
      source_id TEXT REFERENCES conversations(id), body TEXT NOT NULL
    );
    CREATE TABLE session (
      id INTEGER PRIMARY KEY CHECK (id = 1), active_id TEXT REFERENCES conversations(id)
    );
    PRAGMA user_version = 1;`);
  });
}

function select(db, id) {
  db.prepare("INSERT INTO session (id, active_id) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET active_id=excluded.active_id").run(id);
}

function readConversation({ body, ...metadata }) {
  try { return { ...metadata, messages: JSON.parse(body) }; }
  catch { throw assistantError("E_CORRUPT", "无法读取这段对话。"); }
}

function conversationBackup(db) {
  const rows = db?.prepare(`SELECT ${metadataColumns}, body, (SELECT active_id FROM session WHERE id=1) AS activeId
    FROM conversations ORDER BY updated_at DESC, rowid DESC`).all() ?? [];
  return { formatVersion: 1, activeId: rows[0]?.activeId ?? null, conversations: rows.map(({ activeId, ...row }) => readConversation(row)) };
}

function normalizeBackup(archive) {
  if (!isPlainObject(archive) || archive.formatVersion !== 1 || !Array.isArray(archive.conversations)
    || (archive.activeId !== null && !validId(archive.activeId))) throw invalidBackup();
  const conversations = new Map();
  for (const value of archive.conversations) {
    let entry;
    try { entry = normalizeConversation(value); }
    catch { throw invalidBackup(); }
    if (conversations.has(entry.id) || !entry.revision || typeof value.updatedAt !== "string" || !Number.isFinite(Date.parse(value.updatedAt))
      || new Date(value.updatedAt).toISOString() !== value.updatedAt) throw invalidBackup();
    const assetIds = value.messages.flatMap((message) => message.role === "user" ? message.attachments.map(({ assetUrl }) => assetUrl.slice(assetPrefix.length)) : []);
    conversations.set(entry.id, { ...entry, updatedAt: value.updatedAt, assetIds });
  }
  if ((archive.activeId !== null && !conversations.has(archive.activeId))
    || [...conversations.values()].some(({ sourceId }) => sourceId && !conversations.has(sourceId))) throw invalidBackup();
  const checked = new Set();
  for (const id of conversations.keys()) {
    const chain = new Set();
    for (let ancestor = id; ancestor && !checked.has(ancestor); ancestor = conversations.get(ancestor).sourceId) {
      if (chain.has(ancestor)) throw invalidBackup();
      chain.add(ancestor);
    }
    for (const ancestor of chain) checked.add(ancestor);
  }
  return { activeId: archive.activeId, conversations };
}

function attachmentAssetIds(conversations) {
  return [...new Set([...conversations.values()].flatMap(({ assetIds }) => assetIds))];
}

export function validateAssistantConversationBackup(archive) {
  return { attachmentAssetIds: attachmentAssetIds(normalizeBackup(archive).conversations) };
}

export function createAssistantConversationStore({ dataRoot, now = Date.now }) {
  const databasePath = path.join(dataRoot, "assistant", "conversations.sqlite");
  let writesSuspended = false;

  function withStore(operation, { write = false, create = false } = {}) {
    if (write && writesSuspended) throw assistantError("E_LOCKED", "正在恢复数据，请稍后再保存对话。");
    const file = assertPhysicalPath(databasePath, { root: dataRoot });
    const exists = fs.existsSync(file);
    if (!exists && !create) return operation(null);
    for (const suffix of ["-journal", "-wal", "-shm"]) assertPhysicalPath(`${file}${suffix}`, { root: dataRoot });
    if (!exists) fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    else if (!fs.lstatSync(file).isFile()) throw assistantError("E_CORRUPT", "对话数据无法读取。");
    const db = new DatabaseSync(file, { readOnly: !write && !fs.existsSync(`${file}-journal`), timeout: 5000 });
    try {
      const version = schemaVersion(db);
      if (version === 0 && create) initialize(db);
      else if (version === 0) return operation(null);
      else if (version !== 1) throw assistantError("E_UNSUPPORTED_VERSION", "对话数据使用了不支持的版本。");
      return operation(db);
    } finally { db.close(); }
  }

  return {
    databasePath,
    suspendWrites() { writesSuspended = true; },
    resumeWrites() { writesSuspended = false; },
    exportBackup() { return withStore(conversationBackup); },
    stageBackup(archive, stagedSqlitePath) {
      const archived = normalizeBackup(archive);
      const local = normalizeBackup(withStore(conversationBackup));
      const { conversations } = local;
      const activeId = conversations.size ? local.activeId : archived.activeId;
      for (const [id, entry] of archived.conversations) if (!conversations.has(id)) conversations.set(id, entry);

      const staged = assertPhysicalPath(stagedSqlitePath, { root: dataRoot });
      if (path.relative(staged, databasePath) === "") throw invalidBackup();
      for (const suffix of ["-journal", "-wal", "-shm"]) {
        const sidecar = assertPhysicalPath(`${staged}${suffix}`, { root: dataRoot });
        if (fs.existsSync(sidecar)) throw invalidBackup();
      }
      fs.closeSync(fs.openSync(staged, "wx", 0o600));
      const db = new DatabaseSync(staged);
      try {
        initialize(db);
        transaction(db, () => {
          db.exec("PRAGMA defer_foreign_keys=ON");
          const insert = db.prepare("INSERT INTO conversations (id, title, updated_at, revision, source_id, body) VALUES (?, ?, ?, ?, ?, ?)");
          for (const { id, title, updatedAt, revision, sourceId, body } of [...conversations.values()].reverse()) insert.run(id, title, updatedAt, revision, sourceId, body);
          select(db, activeId);
        });
        const check = db.prepare("PRAGMA quick_check").get().quick_check;
        if (check !== "ok") throw invalidBackup();
      } finally { db.close(); }
      return { attachmentAssetIds: attachmentAssetIds(conversations) };
    },
    listConversations() {
      return withStore((db) => ({
        activeId: db?.prepare("SELECT active_id FROM session WHERE id=1").get()?.active_id ?? null,
        conversations: db?.prepare(`SELECT ${metadataColumns} FROM conversations ORDER BY updated_at DESC, rowid DESC`).all() ?? [],
      }));
    },
    listAttachmentAssetIds() {
      return withStore((db) => db?.prepare(`SELECT DISTINCT json_extract(attachment.value, '$.assetUrl') AS url
        FROM conversations, json_each(body) AS message, json_each(message.value, '$.attachments') AS attachment`).all()
        .map(({ url }) => url.slice(assetPrefix.length)) ?? []);
    },
    getConversation(args) {
      const id = args?.id;
      if (!validId(id)) throw invalid();
      return withStore((db) => {
        const row = db?.prepare(`SELECT ${metadataColumns}, body FROM conversations WHERE id=?`).get(id);
        if (!row) throw missing();
        return readConversation(row);
      });
    },
    saveConversation(args) {
      const conversation = normalizeConversation(args?.conversation);
      const { activeId } = args;
      const { id, title, sourceId, revision, body } = conversation;
      if (activeId !== undefined && activeId !== id) throw invalid();
      return withStore((db) => transaction(db, () => {
        const prior = db.prepare("SELECT revision, source_id AS sourceId FROM conversations WHERE id=?").get(id);
        if ((prior?.revision ?? 0) !== revision) throw assistantError("E_CONFLICT", "这段对话已有新的更改，请重新打开后再试。");
        if (prior && prior.sourceId !== sourceId) throw invalid();
        if (sourceId && !db.prepare("SELECT 1 FROM conversations WHERE id=?").get(sourceId)) throw missing();
        const updatedAt = new Date(now()).toISOString();
        db.prepare(`INSERT INTO conversations (id, title, updated_at, revision, source_id, body) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET title=excluded.title, updated_at=excluded.updated_at, revision=excluded.revision,
            source_id=excluded.source_id, body=excluded.body`).run(id, title, updatedAt, revision + 1, sourceId, body);
        if (activeId !== undefined) select(db, activeId);
        return { id, title, updatedAt, sourceId, revision: revision + 1 };
      }), { write: true, create: true });
    },
    selectConversation(args) {
      const id = args?.id;
      if (id !== null && !validId(id)) throw invalid();
      return withStore((db) => {
        if (!db) {
          if (id === null) return { activeId: null };
          throw missing();
        }
        return transaction(db, () => {
          if (id !== null && !db.prepare("SELECT 1 FROM conversations WHERE id=?").get(id)) throw missing();
          select(db, id);
          return { activeId: id };
        });
      }, { write: true });
    },
  };
}
