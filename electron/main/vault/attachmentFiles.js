import fs from "node:fs";
import path from "node:path";
import { assertPhysicalPath, isPathInside } from "../storage/dataRoot.js";
import { VaultError, invalidArgument } from "./errors.js";

const MiB = 1024 * 1024;
export const MAX_ATTACHMENT_BYTES = 8 * MiB;
export const MAX_ITEM_ATTACHMENT_BYTES = 16 * MiB;
export const MAX_ITEM_ATTACHMENTS = 32;
export const MAX_ATTACHED_VAULT_BLOB_BYTES = 64 * MiB;

function checkedPath(file, allowMissing) {
  try { return assertPhysicalPath(file, { allowMissing }); }
  catch (error) {
    if (error.code === "E_INVALID_ARGUMENT") invalidArgument("请选择普通文件和无链接的目录");
    throw new VaultError("E_IO", "无法访问所选文件");
  }
}

export async function readAttachmentFile(file, remainingBytes, checkSession) {
  const source = checkedPath(file, false);
  let handle;
  let bytes;
  let succeeded = false;
  try {
    const selected = fs.lstatSync(source);
    if (!selected.isFile()) invalidArgument("请选择普通文件");
    const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0);
    handle = await fs.promises.open(source, flags);
    checkSession();
    const initial = await handle.stat();
    checkSession();
    if (!initial.isFile() || initial.dev !== selected.dev || initial.ino !== selected.ino) {
      throw new VaultError("E_IO", "所选文件在打开时发生变化");
    }
    if (initial.size > MAX_ATTACHMENT_BYTES) invalidArgument("单个附件最多 8 MiB");
    if (initial.size > remainingBytes) invalidArgument("每条密钥的备注附件合计最多 16 MiB");
    bytes = Buffer.alloc(initial.size);
    for (let offset = 0; offset < bytes.length;) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
      checkSession();
      if (!bytesRead) throw new VaultError("E_IO", "所选文件在读取时发生变化");
      offset += bytesRead;
    }
    const final = await handle.stat();
    await handle.close();
    handle = null;
    checkSession();
    if (final.size !== initial.size || final.mtimeMs !== initial.mtimeMs || final.ctimeMs !== initial.ctimeMs) {
      throw new VaultError("E_IO", "所选文件在读取时发生变化");
    }
    succeeded = true;
    return { name: path.basename(source), bytes };
  } catch (error) {
    throw error instanceof VaultError ? error : new VaultError("E_IO", "无法读取所选附件");
  } finally {
    if (!succeeded) bytes?.fill(0);
    if (handle) await handle.close().catch(() => {});
  }
}

export function resolveAttachmentCopyPath(file, dataRoot) {
  const target = checkedPath(file, true);
  let realParent;
  let realRoot;
  try {
    realParent = fs.realpathSync.native(path.dirname(target));
    realRoot = fs.realpathSync.native(dataRoot);
  } catch { throw new VaultError("E_IO", "无法访问保存目录"); }
  const resolved = path.join(realParent, path.basename(target));
  if (isPathInside(dataRoot, target, { allowRoot: true }) || isPathInside(realRoot, resolved, { allowRoot: true })) {
    invalidArgument("请将明文副本保存到 Life Atlas 数据目录以外");
  }
  return resolved;
}

export function writeAttachmentCopy(target, bytes) {
  let descriptor;
  let created;
  try {
    descriptor = fs.openSync(target, "wx", 0o600);
    created = fs.fstatSync(descriptor);
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
  } catch (error) {
    if (created) {
      try {
        const current = fs.lstatSync(target);
        if (current.dev === created.dev && current.ino === created.ino) {
          fs.closeSync(descriptor);
          descriptor = undefined;
          fs.unlinkSync(target);
        }
      } catch {}
    }
    if (error.code === "EEXIST") throw new VaultError("E_CONFLICT", "同名文件已存在，请为副本选择新文件名");
    throw new VaultError("E_IO", "无法保存附件副本");
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}
