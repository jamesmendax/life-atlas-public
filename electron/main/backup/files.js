import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { assertPhysicalPath, isPathInside } from "../storage/dataRoot.js";
import { StorageError } from "../storage/workspaceDb.js";

export function backupDate(now) {
  const date = new Date(typeof now === "function" ? now() : now ?? Date.now());
  if (!Number.isFinite(date.getTime())) throw new StorageError("E_INVALID_ARGUMENT", "备份时间无效");
  return date;
}

export function checkCancelled(signal) {
  if (signal?.aborted) throw new StorageError("E_CANCELLED", "操作已取消");
}

export async function sha256File(filePath, { signal } = {}) {
  const file = assertPhysicalPath(filePath, { allowMissing: false });
  const hash = createHash("sha256");
  const stream = fs.createReadStream(file, { highWaterMark: 64 * 1024 });
  let size = 0;
  const abort = () => stream.destroy(new StorageError("E_CANCELLED", "操作已取消"));
  signal?.addEventListener("abort", abort, { once: true });
  try {
    checkCancelled(signal);
    for await (const bytes of stream) {
      checkCancelled(signal);
      size += bytes.length;
      hash.update(bytes);
    }
    return { size, sha256: hash.digest("hex") };
  } finally {
    signal?.removeEventListener("abort", abort);
    stream.destroy();
  }
}

export function createStagingDirectory(dataRoot, prefix) {
  const root = assertPhysicalPath(dataRoot);
  if (!/^\.[a-z-]+-$/.test(prefix)) throw new StorageError("E_INVALID_ARGUMENT", "暂存目录名称无效");
  fs.mkdirSync(root, { recursive: true });
  return fs.mkdtempSync(path.join(root, prefix));
}

export function removeScopedDirectory(directory, root) {
  const target = assertPhysicalPath(directory, { root });
  if (!isPathInside(root, target)) throw new StorageError("E_IO", "不能清理数据目录以外的暂存目录");
  fs.rmSync(target, { recursive: true, force: true });
}

export function syncFile(filePath) {
  const descriptor = fs.openSync(assertPhysicalPath(filePath, { allowMissing: false }), "r+");
  try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
}

export function logBackup(logger, event, fields = {}) {
  if (typeof logger === "function") logger(event, fields);
  else if (typeof logger?.log === "function") logger.log(event, fields);
  else logger?.info?.(event, fields);
}
