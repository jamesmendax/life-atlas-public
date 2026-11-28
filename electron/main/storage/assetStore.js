import fs from "node:fs";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { assertPhysicalPath } from "./dataRoot.js";
import { StorageError } from "./workspaceDb.js";

export const MAX_ASSET_BYTES = 1024 * 1024 * 1024;
const SHA256 = /^[a-f0-9]{64}$/;

function fileSha256(file) {
  const hash = createHash("sha256");
  const buffer = Buffer.alloc(64 * 1024);
  const descriptor = fs.openSync(file, "r");
  try {
    let read;
    while ((read = fs.readSync(descriptor, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, read));
    return hash.digest("hex");
  } finally {
    fs.closeSync(descriptor);
  }
}

export function createAssetStore({ assetsDir, db, now = () => new Date().toISOString() }) {
  const directory = assertPhysicalPath(assetsDir);
  const connection = () => typeof db === "function" ? db() : db;
  const instant = () => typeof now === "function" ? now() : now;
  const filePath = (sha256) => {
    if (typeof sha256 !== "string" || !SHA256.test(sha256)) throw new StorageError("E_INVALID_ARGUMENT", "附件标识无效");
    return assertPhysicalPath(path.join(directory, sha256.slice(0, 2), sha256), { root: directory });
  };
  const get = (sha256) => {
    filePath(sha256);
    const row = connection()?.prepare("SELECT sha256, size, mime, original_name, created_at FROM assets WHERE sha256=?").get(sha256);
    return row ? { sha256: row.sha256, size: row.size, mime: row.mime, originalName: row.original_name, createdAt: row.created_at } : null;
  };
  return {
    filePath,
    get,
    listByMime(types) {
      const database = connection();
      if (!database || !types.length) return [];
      return database.prepare(`SELECT sha256,size,mime,original_name AS originalName,created_at AS createdAt FROM assets WHERE mime IN (${types.map(() => "?").join(",")}) ORDER BY sha256`).all(...types);
    },
    setMetadata({ sha256, previousMime, mime, originalName }) {
      filePath(sha256);
      if (typeof mime !== "string" || mime.length > 200 || /[\r\n\0]/u.test(mime) || typeof originalName !== "string" || originalName.length > 255 || /[\r\n\0]/u.test(originalName)) throw new StorageError("E_INVALID_ARGUMENT", "附件类型或名称无效");
      return Number(connection().prepare("UPDATE assets SET mime=?,original_name=? WHERE sha256=? AND mime=?").run(mime, originalName, sha256, previousMime).changes) === 1;
    },
    list() {
      return connection().prepare("SELECT sha256 FROM assets ORDER BY sha256").all().map(({ sha256 }) => get(sha256));
    },
    put({ bytes, mime, name }) {
      if (bytes?.byteLength > MAX_ASSET_BYTES) throw new StorageError("E_INVALID_ARGUMENT", "单个文件不能超过 1 GB");
      if (!(bytes instanceof ArrayBuffer) && !ArrayBuffer.isView(bytes)) throw new StorageError("E_INVALID_ARGUMENT", "附件必须是二进制数据");
      if (typeof mime !== "string" || mime.length > 200 || /[\r\n\0]/.test(mime) || typeof name !== "string" || name.length > 255 || /[\r\n\0]/.test(name)) throw new StorageError("E_INVALID_ARGUMENT", "附件类型或名称无效");
      const content = bytes instanceof ArrayBuffer ? Buffer.from(bytes) : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const sha256 = createHash("sha256").update(content).digest("hex");
      const target = filePath(sha256);
      const database = connection();
      if (!database) throw new StorageError("E_IO", "附件数据库尚未就绪");
      const existing = get(sha256);
      if (existing && existing.size !== content.length) throw new StorageError("E_CORRUPT", "附件元数据与文件不一致");
      let created = false;
      fs.mkdirSync(path.dirname(target), { recursive: true });
      if (fs.existsSync(target)) {
        if (!fs.lstatSync(target).isFile() || fs.statSync(target).size !== content.length || fileSha256(target) !== sha256) throw new StorageError("E_CORRUPT", "现有附件文件校验失败，未覆盖原文件");
      } else {
        const temporary = assertPhysicalPath(`${target}.tmp-${randomBytes(4).toString("hex")}`, { root: directory });
        let descriptor;
        try {
          descriptor = fs.openSync(temporary, "wx");
          fs.writeFileSync(descriptor, content);
          fs.fsyncSync(descriptor);
          fs.closeSync(descriptor);
          descriptor = undefined;
          fs.renameSync(temporary, target);
          created = true;
        } finally {
          if (descriptor !== undefined) fs.closeSync(descriptor);
          if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
        }
      }
      try {
        database.prepare("INSERT OR IGNORE INTO assets(sha256, size, mime, original_name, created_at) VALUES (?, ?, ?, ?, ?)").run(sha256, content.length, mime || "application/octet-stream", name, instant());
      } catch (error) {
        throw new StorageError("E_IO", "附件元数据保存失败，请重试");
      }
      return { assetId: sha256, url: `life-asset://${sha256}`, created };
    },
  };
}
