import { DatabaseSync } from "node:sqlite";
import { constants, copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { assertPhysicalPath } from "../storage/dataRoot.js";
import { VaultError } from "./errors.js";

export const VAULT_FORMAT_VERSION = 1;

function checkIntegrity(db) {
  const results = db.prepare("PRAGMA quick_check").all();
  if (results.length !== 1 || results[0].quick_check !== "ok") throw new VaultError("E_CORRUPT", "密钥库文件已损坏");
}

function headerRow(db) {
  return db.prepare("SELECT json FROM vault_header WHERE id = 1").get();
}

function inspectVaultDatabase(file, checkHeader) {
  const root = path.dirname(file);
  let inspectionDirectory;
  let db;
  try {
    assertPhysicalPath(file, { root, allowMissing: false });
    const wal = assertPhysicalPath(`${file}-wal`, { root });
    assertPhysicalPath(`${file}-shm`, { root });
    const journal = assertPhysicalPath(`${file}-journal`, { root });
    if (existsSync(journal) && statSync(journal).size > 0) throw new VaultError("E_CORRUPT", "密钥库含有未处理的 SQLite 日志");
    const hasWal = existsSync(wal) && statSync(wal).size > 0;
    if (!hasWal && statSync(file).size === 0) return;
    let source = `${pathToFileURL(file).href}?immutable=1`;
    if (hasWal) {
      // A read-only WAL connection can still update shared memory. Use a private copy.
      inspectionDirectory = mkdtempSync(path.join(root, "vault-inspect-"));
      source = path.join(inspectionDirectory, "vault.db");
      copyFileSync(file, source, constants.COPYFILE_EXCL);
      copyFileSync(wal, `${source}-wal`, constants.COPYFILE_EXCL);
    }
    db = new DatabaseSync(source, { readOnly: true });
    const row = headerRow(db);
    if (row) {
      const header = JSON.parse(row.json);
      if (header?.kind === "life-atlas-vault" && Number.isSafeInteger(header.formatVersion) && header.formatVersion > VAULT_FORMAT_VERSION) {
        throw new VaultError("E_UNSUPPORTED_VERSION", "这个密钥库需要更新版本的 Life Atlas");
      }
      checkHeader(header);
    } else if (db.prepare("SELECT EXISTS(SELECT 1 FROM vault_items) OR EXISTS(SELECT 1 FROM vault_state) AS has_data").get().has_data) {
      throw new VaultError("E_CORRUPT", "密钥库缺少头部");
    }
    checkIntegrity(db);
  } catch (error) {
    if (error instanceof VaultError || error.code === "E_INVALID_ARGUMENT") throw error;
    throw new VaultError("E_CORRUPT", "无法读取密钥库文件");
  } finally {
    try { db?.close(); }
    finally {
      if (inspectionDirectory) rmSync(assertPhysicalPath(inspectionDirectory, { root }), { recursive: true, force: true });
    }
  }
}

export function openVaultDatabase(file, { checkHeader } = {}) {
  if (checkHeader) inspectVaultDatabase(file, checkHeader);
  mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  try {
    if (!checkHeader) checkIntegrity(db);
    db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA secure_delete = ON; PRAGMA busy_timeout = 5000;");
    db.exec(`CREATE TABLE IF NOT EXISTS vault_header (id INTEGER PRIMARY KEY CHECK (id = 1), json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS vault_items (id TEXT PRIMARY KEY, blob BLOB NOT NULL) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS vault_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

export function readHeader(db) {
  const row = headerRow(db);
  return row ? JSON.parse(row.json) : null;
}

export function writeHeader(db, header) {
  db.prepare("INSERT INTO vault_header(id,json) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json").run(JSON.stringify(header));
}

export function listItemIds(db) {
  return db.prepare("SELECT id FROM vault_items ORDER BY id").all().map((row) => row.id);
}

export function getItemBlob(db, id) {
  const row = db.prepare("SELECT blob FROM vault_items WHERE id=?").get(id);
  return row ? Buffer.from(row.blob) : null;
}

export function otherItemBlobBytes(db, id) {
  return db.prepare("SELECT coalesce(sum(length(blob)), 0) AS bytes FROM vault_items WHERE id != ?").get(id).bytes;
}

export function putItemBlob(db, id, blob) {
  db.prepare("INSERT INTO vault_items(id,blob) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET blob=excluded.blob").run(id, blob);
}

export function insertItemBlob(db, id, blob) {
  db.prepare("INSERT INTO vault_items(id,blob) VALUES(?,?)").run(id, blob);
}

export function deleteItemBlob(db, id) {
  db.prepare("DELETE FROM vault_items WHERE id=?").run(id);
}

export function getState(db, key) {
  return db.prepare("SELECT value FROM vault_state WHERE key=?").get(key)?.value ?? null;
}

export function setState(db, key, value) {
  db.prepare("INSERT INTO vault_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, String(value));
}

export function inTransaction(db, operation) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const value = operation();
    if (value && typeof value.then === "function") throw new Error("vault transaction callback must be synchronous");
    db.exec("COMMIT");
    return value;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function vacuumInto(db, targetFile) {
  if (existsSync(targetFile)) throw new Error("snapshot already exists");
  mkdirSync(path.dirname(targetFile), { recursive: true });
  db.prepare("VACUUM INTO ?").run(targetFile);
}
