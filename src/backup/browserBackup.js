import { CURRENT_SCHEMA_VERSION, upgradeWorkspace } from "../persistence/migrations.js";
import { readBrowserAttachmentBlob, writeBrowserAttachmentBlob, removeBrowserAttachmentBlob } from "../domain/attachments.js";
import { compressionForMime, BACKUP_COLLECTIONS } from "./format.js";
import { sha256Hex } from "./hash.js";
import { workspaceToFiles, filesToWorkspace, jsonBytes, parseJsonBytes } from "./serialize.js";
import { buildManifest } from "./manifest.js";
import { verifyPackage } from "./verify.js";
import { createZipWriter, openZipReader } from "./zipBrowser.js";

const inspections = new Map();
const copyPrefix = "life-atlas.workspace.pre-restore-";
const dateFrom = (now) => new Date(typeof now === "function" ? now() : now ?? Date.now());
const padded = (value) => String(value).padStart(2, "0");

export function backupFileName(now) {
  const date = dateFrom(now);
  return `Life-Atlas-备份-${date.getFullYear()}${padded(date.getMonth() + 1)}${padded(date.getDate())}-${padded(date.getHours())}${padded(date.getMinutes())}.lifeatlas`;
}

export async function exportBrowserBackup({ workspace, readAttachmentBlob = readBrowserAttachmentBlob, now, appVersion = import.meta.env?.VITE_APP_VERSION ?? "0.0.0" }) {
  const files = workspaceToFiles(workspace);
  const assetEntries = [];
  const assetFiles = new Map();
  const skippedAttachmentIds = [];
  for (const attachment of workspace.attachments ?? []) {
    if (attachment.provider !== "local-ref") continue;
    const blob = await readAttachmentBlob(attachment.storageKey || attachment.id);
    if (!blob) { skippedAttachmentIds.push(attachment.id); continue; }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const sha256 = await sha256Hex(bytes);
    const mime = attachment.mime || blob.type || "application/octet-stream";
    assetEntries.push({ sha256, size: bytes.byteLength, mime, originalName: attachment.name, createdAt: attachment.createdAt, legacyAttachmentId: attachment.id });
    assetFiles.set(sha256, { path: `assets/${sha256}`, bytes, sha256, mime });
  }
  files.push({ path: "assets/index.json", bytes: jsonBytes(assetEntries) }, ...assetFiles.values());
  const createdAt = dateFrom(now).toISOString();
  const manifest = await buildManifest({ createdAt, appVersion, platform: "browser", workspace, files, assetEntries });
  const byPath = new Map(files.map((file) => [file.path, file]));
  const writer = createZipWriter();
  writer.add("manifest.json", jsonBytes(manifest));
  for (const entry of manifest.files) {
    const file = byPath.get(entry.path);
    writer.add(file.path, file.bytes, { store: compressionForMime(file.mime) === "STORE" });
  }
  return { blob: new Blob([await writer.finish()], { type: "application/zip" }), fileName: backupFileName(now), manifest, skippedAttachmentIds };
}

export async function inspectBrowserBackup(fileBytes, { fileName = null, currentSchemaVersion = CURRENT_SCHEMA_VERSION, now } = {}) {
  const inspectedAt = dateFrom(now).getTime();
  for (const [token, value] of inspections) if (inspectedAt >= value.expiresAt) inspections.delete(token);
  let reader;
  try { reader = await openZipReader(fileBytes); } catch {
    return { token: null, summary: null, problems: [{ code: "NOT_ZIP", path: null, detail: "不是有效的 ZIP 备份；加密备份请使用桌面版打开" }] };
  }
  const report = await verifyPackage(reader, { currentSchemaVersion, fileName });
  if (!report.ok) return { token: null, summary: report.summary, problems: report.problems };
  if (report.manifest.vault.included) return { token: null, summary: report.summary, problems: [{ code: "BAD_VAULT", path: "vault/vault.json", detail: "包含密钥库的备份请在桌面版中恢复，以免丢失密钥库" }] };
  const files = new Map();
  for (const file of report.manifest.files) if (file.path === "workspace/meta.json" || file.path.startsWith("workspace/entities/")) files.set(file.path, await reader.read(file.path));
  const workspace = filesToWorkspace((filePath) => files.get(filePath));
  const assets = parseJsonBytes(await reader.read("assets/index.json"));
  const token = globalThis.crypto.randomUUID();
  inspections.set(token, { expiresAt: inspectedAt + 600000, reader, workspace, assets });
  return { token, summary: report.summary, problems: report.problems };
}

export function prunePreRestoreCopies(storage, keep = 3) {
  const keys = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(copyPrefix)) keys.push(key);
  }
  const deleted = keys.sort().slice(0, Math.max(0, keys.length - keep));
  for (const key of deleted) storage.removeItem(key);
  return deleted;
}

function referencedAttachmentKeys(storage, rawWorkspace) {
  const keys = new Set();
  const read = (raw) => {
    if (!raw) return;
    try {
      const workspace = JSON.parse(raw);
      for (const attachment of workspace.attachments ?? []) keys.add(attachment.storageKey || attachment.id);
    } catch { return; }
  };
  read(rawWorkspace);
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(copyPrefix)) read(storage.getItem(key));
  }
  return keys;
}

export async function restoreBrowserBackup(token, { storage, storageKey, legacyKeys = [], writeAttachmentBlob = writeBrowserAttachmentBlob, readAttachmentBlob = readBrowserAttachmentBlob, removeAttachmentBlob = removeBrowserAttachmentBlob, now } = {}) {
  const inspection = inspections.get(token);
  inspections.delete(token);
  if (!inspection || dateFrom(now).getTime() >= inspection.expiresAt) throw new Error("备份已过期，请重新选择文件");
  const previous = [storageKey, ...legacyKeys].map((key) => storage.getItem(key)).find((value) => value !== null) ?? null;
  const referenced = referencedAttachmentKeys(storage, previous);
  if (previous !== null) {
    try {
      const copyKey = `${copyPrefix}${dateFrom(now).toISOString().replace(/[:.]/g, "-")}`;
      const uniqueKey = storage.getItem(copyKey) === null ? copyKey : `${copyKey}-${token}`;
      storage.setItem(uniqueKey, previous);
      prunePreRestoreCopies(storage, 3);
    } catch { throw new Error("浏览器存储空间不足，无法保留恢复前副本。当前数据没有改动。"); }
  }
  let workspace = structuredClone(inspection.workspace);
  const written = [];
  try {
    for (const asset of inspection.assets) {
      const attachmentId = asset.legacyAttachmentId || workspace.attachments.find((entry) => entry.checksum === asset.sha256)?.id;
      if (!attachmentId) throw new Error("附件索引缺少工作区引用");
      const collision = referenced.has(attachmentId) || await readAttachmentBlob(attachmentId);
      const targetKey = collision ? `${attachmentId}--restore-${token}` : attachmentId;
      const bytes = await inspection.reader.read(`assets/${asset.sha256}`);
      written.push(targetKey);
      await writeAttachmentBlob(targetKey, new Blob([bytes], { type: asset.mime }));
      workspace.attachments = workspace.attachments.map((entry) => entry.id === attachmentId ? { ...entry, provider: "local-ref", storageKey: targetKey } : entry);
    }
    workspace = { ...upgradeWorkspace(workspace), schemaVersion: CURRENT_SCHEMA_VERSION };
    for (const collection of BACKUP_COLLECTIONS) workspace[collection] ??= [];
    storage.setItem(storageKey, JSON.stringify(workspace));
  } catch (error) {
    for (const key of written) await removeAttachmentBlob(key).catch(() => {});
    throw new Error(`恢复失败，当前工作区没有改动：${error.message}`, { cause: error });
  }
  return { workspace };
}
